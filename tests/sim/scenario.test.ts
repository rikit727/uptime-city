import { describe, expect, it } from 'vitest';
import { SCENARIOS, facilityDef, scenarioDef } from '../../src/sim/data';
import { createScenarioState, evaluateScenario, scenarioScore } from '../../src/sim/scenario';
import { Simulation } from '../../src/sim/simulation';
import { serializeState, deserializeState } from '../../src/sim/serialize';
import { cityTotals } from '../../src/sim/growth';
import { generateCity } from '../../src/sim/cityGen';
import { createInitialState } from '../../src/sim/state';
import { hashState } from '../../src/sim/hash';
import { isOpen } from '../../src/sim/incidents';
import { FAULT } from '../../src/sim/assets';
import { closedByFire } from '../../src/sim/fire';
import { tickResidentsRound } from '../../src/sim/happiness';
import type { SimEvent } from '../../src/sim/events';

const run = (sim: Simulation, ticks: number): SimEvent[] => {
  const out: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    sim.step();
    out.push(...sim.drainEvents());
  }
  return out;
};

describe('city generator', () => {
  const params = scenarioDef('heatwave').city;

  it('builds a lived-in city with power and water on either bank', () => {
    for (const seed of [4127, 90210, 31337, 5150, 7, 123456]) {
      const sim = new Simulation(createScenarioState({ ...scenarioDef('heatwave'), seed }));
      const s = sim.state;
      const t = cityTotals(s);
      expect(t.residents).toBeGreaterThan(3000);
      expect(t.jobs).toBeGreaterThan(2000);
      expect(s.cache.power.buildingsOff).toBe(0);
      expect(s.cache.waterStats.noSupply).toBe(0);
      expect(s.cache.waterStats.customers).toBeGreaterThan(200);
    }
  });

  it('is deterministic for the same parameters and seed', () => {
    const make = () => {
      const st = createInitialState({ seed: 99, startingCash: 1e9 });
      generateCity(st, params, 99);
      return hashState(st);
    };
    expect(make()).toBe(make());
  });

  it('applies the age profile: older assets in worse condition, within the ranges', () => {
    const st = createInitialState({ seed: 5, startingCash: 1e9 });
    st.minute = 40 * 120 * 1440;
    const p = {
      ...params,
      ageYears: [20, 30] as [number, number],
      condition: [30, 60] as [number, number],
    };
    generateCity(st, p, 5);
    const w = st.world;
    const today = Math.floor(st.minute / 1440) + 1;
    let n = 0;
    for (let t = 0; t < w.road.length; t++) {
      if (w.laid.road[t] === 0) continue;
      n++;
      const c = w.condition.road[t]! / 100;
      const age = (today - w.laid.road[t]!) / 120;
      expect(c).toBeGreaterThanOrEqual(30 - 1e-6);
      expect(c).toBeLessThanOrEqual(60 + 1e-6);
      expect(age).toBeGreaterThan(19.9);
      expect(age).toBeLessThan(30.1);
    }
    expect(n).toBeGreaterThan(300);
  });
});

describe('scenarios', () => {
  it('ships four scenarios that all start', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual([
      'heatwave',
      'coldSnap',
      'ageingNetwork',
      'commercialFire',
    ]);
    for (const def of SCENARIOS) {
      const sim = Simulation.newScenario(def.id);
      const sc = sim.state.scenario!;
      expect(sc.status).toBe('running');
      expect(sim.state.cash).toBe(def.startingCash);
      expect(evaluateScenario(sim.state)).toHaveLength(def.objectives.length);
      expect(sim.state.happiness.city).toBeGreaterThan(0);
    }
  });

  it('runs timed events: the heatwave and drought order', () => {
    const sim = Simulation.newScenario('heatwave');
    const ev = run(sim, 2);
    expect(sim.state.weather.event?.id).toBe('heatwave');
    expect(ev.some((e) => e.type === 'scenarioMessage')).toBe(true);
    run(sim, 10);
    expect(sim.state.cache.waterStats.licenceMlPerDay).toBeCloseTo(3, 5);
  });

  it('cold snap: mains burst at the timed events', () => {
    const sim = Simulation.newScenario('coldSnap');
    run(sim, 61);
    const bursts = sim.state.incidents.filter((i) => i.kind === 'burst' && isOpen(i));
    expect(bursts.length).toBeGreaterThanOrEqual(3);
  });

  it('enforces constraints: no loans, no new intakes, capital allowance', () => {
    const hw = Simulation.newScenario('heatwave');
    expect(hw.dispatch({ type: 'takeLoan', amount: 50_000 }).reason).toMatch(/not allowed/);
    const r = hw.dispatch({ type: 'placeFacility', facility: 'intake', at: { x: 1, y: 1 } });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/abstraction licences/);
    const ag = Simulation.newScenario('ageingNetwork');
    ag.state.scenario!.capitalSpent = 199_000;
    const road = ag.dispatch({
      type: 'buildRoad',
      roadClass: 'highway',
      from: { x: 1, y: 1 },
      to: { x: 1, y: 120 },
    });
    expect(road.ok).toBe(false);
    expect(road.reason).toMatch(/capital allowance/);
  });

  it('counts spending since the start', () => {
    const sim = Simulation.newScenario('ageingNetwork');
    const before = sim.state.scenario!.spent;
    const r = sim.dispatch({
      type: 'raiseMaintenance',
      from: { x: 0, y: 0 },
      to: { x: 127, y: 40 },
      below: 45,
    });
    expect(r.ok).toBe(true);
    expect(sim.state.scenario!.spent - before).toBe(r.cost);
    expect(sim.state.scenario!.worksSpent).toBe(r.cost);
  });

  it('commercial fire: the fire starts, ends the scenario once out, and is scored', () => {
    const sim = Simulation.newScenario('commercialFire');
    const sc = sim.state.scenario!;
    const ev = run(sim, 16);
    expect(sim.state.fires).toHaveLength(1);
    const centre = sim.state.cache.byId.get(sim.state.fires[0]!.building)!;
    expect(centre.code).toBe(facilityDef('shoppingCentre').code);
    expect(sc.fireStart).toBeGreaterThan(0);
    expect(ev.some((e) => e.type === 'incidentOpened')).toBe(true);
    const all = run(sim, 12 * 60);
    const end = all.find((e) => e.type === 'scenarioEnded');
    expect(end).toBeDefined();
    expect(sc.status).not.toBe('running');
    expect(sc.fireOut).toBeGreaterThan(sc.fireStart);
    expect(sc.endedMinute).toBeLessThanOrEqual(sc.fireOut + 2 * 60 + 15);
    const { score, max } = scenarioScore(sim.state);
    expect(max).toBe(1000);
    expect(score).toBe(sc.score);
  });

  it('emergency measures put the fire out sooner and cost less', () => {
    const play = (measures: string[]) => {
      const sim = Simulation.newScenario('commercialFire');
      for (let t = 0; t < 600 && sim.state.scenario!.status === 'running'; t++) {
        sim.step();
        const f = sim.state.fires[0];
        if (f)
          for (const m of measures)
            if (!f.measures.includes(m as never))
              expect(
                sim.dispatch({ type: 'fireMeasure', fire: f.id, measure: m as never }).ok,
              ).toBe(true);
      }
      const sc = sim.state.scenario!;
      return {
        minutes: sc.fireOut - sc.fireStart,
        smoke: sc.smoke,
        score: scenarioScore(sim.state).score,
      };
    };
    const none = play([]);
    const all = play(['isolatePower', 'cordon', 'evacuate']);
    expect(all.minutes).toBeLessThan(none.minutes);
    expect(all.smoke).toBeLessThan(none.smoke / 4);
    expect(all.score).toBeGreaterThan(none.score);
  });

  it('a save made mid-scenario continues identically', () => {
    const sim = Simulation.newScenario('commercialFire');
    run(sim, 40);
    const copy = new Simulation(
      deserializeState(JSON.parse(JSON.stringify(serializeState(sim.state)))),
    );
    run(sim, 200);
    run(copy, 200);
    expect(copy.hash()).toBe(sim.hash());
    expect(copy.state.scenario).toEqual(sim.state.scenario);
  });

  it('is deterministic: the same scenario gives the same city', () => {
    expect(Simulation.newScenario('coldSnap').hash()).toBe(
      Simulation.newScenario('coldSnap').hash(),
    );
  });

  it('cordons close the roads round the fire, and they reopen when it is out', () => {
    const sim = Simulation.newScenario('commercialFire');
    run(sim, 16);
    const f = sim.state.fires[0]!;
    const count = () => {
      let n = 0;
      for (const v of sim.state.cache.faults.tile) if (v & FAULT.ROAD_CLOSED) n++;
      return n;
    };
    const before = count();
    expect(sim.dispatch({ type: 'fireMeasure', fire: f.id, measure: 'cordon' }).ok).toBe(true);
    expect(count()).toBeGreaterThan(before + 4);
    expect(sim.dispatch({ type: 'fireMeasure', fire: f.id, measure: 'cordon' }).ok).toBe(false);
    for (let t = 0; t < 600 && sim.state.fires.length > 0; t++) sim.step();
    expect(sim.state.fires).toHaveLength(0);
    expect(count()).toBeLessThanOrEqual(before);
  });

  it('power isolation cuts the building off; evacuation stops its neighbours paying taxes', () => {
    const sim = Simulation.newScenario('commercialFire');
    run(sim, 16);
    const f = sim.state.fires[0]!;
    sim.dispatch({ type: 'fireMeasure', fire: f.id, measure: 'isolatePower' });
    sim.dispatch({ type: 'fireMeasure', fire: f.id, measure: 'evacuate' });
    run(sim, 6);
    expect(sim.state.cache.byId.get(f.building)!.unpoweredMinutes).toBeGreaterThan(0);
    expect(f.evacuated.length).toBeGreaterThan(5);
    const neighbour = f.evacuated.find((id) => id !== f.building)!;
    expect(closedByFire(sim.state, neighbour)).toBe(true);
    // Taxes are collected hour by hour in the residents round: closed buildings pay nothing.
    const lost = sim.state.scenario!.taxLost;
    sim.state.happiness.cursor = 0;
    tickResidentsRound(sim.state, 100_000);
    expect(sim.state.scenario!.taxLost).toBeGreaterThan(lost);
    for (let t = 0; t < 600 && sim.state.fires.length > 0; t++) sim.step();
    expect(closedByFire(sim.state, neighbour)).toBe(false);
  });
});
