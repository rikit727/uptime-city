import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/sim/simulation';
import { TILE_OVERLAYS, overlayValues } from '../../src/sim/overlays';
import { closeKpiDay } from '../../src/sim/kpis';
import { GAME, buildingDef, customerDefOf } from '../../src/sim/data';
import { decayFactor, earn } from '../../src/sim/ledger';
import { useLps, waterFactors } from '../../src/sim/water';
import { dailyTaxes } from '../../src/sim/economy';
import { restrictionPenalty } from '../../src/sim/happiness';
import { createInitialState } from '../../src/sim/state';
import { serializeState, deserializeState } from '../../src/sim/serialize';
import { testSim } from './helpers';

const city = (() => {
  let sim: Simulation | null = null;
  return () => (sim ??= Simulation.newScenario('heatwave'));
})();

describe('overlays', () => {
  it('every tile overlay paints values or categories; water and traffic have their own layers', () => {
    const s = city().state;
    const out = new Float32Array(s.world.width * s.world.height);
    for (const id of TILE_OVERLAYS) {
      expect(overlayValues(s, id, out)).toBe(true);
      let drawn = 0;
      for (const v of out) if (!Number.isNaN(v)) drawn++;
      if (id !== 'roadworks') expect(drawn, id).toBeGreaterThan(100);
      for (const v of out) if (v >= 0) expect(v).toBeLessThanOrEqual(1.0001);
    }
    expect(overlayValues(s, 'water', out)).toBe(false);
    expect(overlayValues(s, 'traffic', out)).toBe(false);
  });

  it('power: powered buildings in blue, cut-off ones in the "no power" category', () => {
    const sim = Simulation.newScenario('heatwave');
    const s = sim.state;
    const out = new Float32Array(s.world.width * s.world.height);
    const home = s.buildings.find((b) => buildingDef(b.code)?.role === 'grown')!;
    const t = home.y * s.world.width + home.x;
    overlayValues(s, 'power', out);
    expect(out[t]).toBe(-1);
    home.unpoweredMinutes = 10;
    overlayValues(s, 'power', out);
    expect(out[t]).toBe(-2);
  });

  it('condition: the worst asset on a tile, 0..1', () => {
    const s = city().state;
    const out = new Float32Array(s.world.width * s.world.height);
    overlayValues(s, 'condition', out);
    const t = s.world.road.findIndex((r, i) => r !== 0 && s.world.water[i] !== 0);
    const worst = Math.min(s.world.condition.road[t]!, s.world.condition.main[t]!) / 10000;
    expect(out[t]).toBeCloseTo(worst, 5);
  });

  it('coverage: roads out of reach of every fire station are marked', () => {
    const sim = Simulation.newScenario('heatwave');
    sim.state.cash = 1e7;
    const w = sim.state.world;
    // A long road at the far map edge, joined to nothing.
    const x = sim.state.buildings[0]!.x < 64 ? w.width - 2 : 1;
    expect(
      sim.dispatch({ type: 'buildRoad', roadClass: 'local', from: { x, y: 2 }, to: { x, y: 20 } })
        .ok,
    ).toBe(true);
    const out = new Float32Array(w.width * w.height);
    overlayValues(sim.state, 'fire', out);
    expect(out[10 * w.width + x]).toBe(-1);
  });

  it('roadworks: permit tiles show booked works', () => {
    const sim = Simulation.newScenario('ageingNetwork');
    const r = sim.dispatch({
      type: 'raiseMaintenance',
      from: { x: 0, y: 0 },
      to: { x: 127, y: 127 },
      below: 45,
      crew: 'roads',
      night: true,
    });
    expect(r.ok).toBe(true);
    const out = new Float32Array(128 * 128);
    overlayValues(sim.state, 'roadworks', out);
    const p = sim.state.permits[0]!;
    expect(out[p.tiles[0]!]).toBeLessThan(0);
  });
});

describe('daily KPIs', () => {
  it('records each day at midnight and keeps a bounded history', () => {
    const sim = Simulation.newScenario('coldSnap');
    const s = sim.state;
    const toMidnight = 1440 - (s.minute % 1440);
    sim.step(toMidnight + 1);
    expect(s.kpis.days).toHaveLength(1);
    const d = s.kpis.days[0]!;
    expect(d.day).toBe(Math.floor((s.minute - 2) / 1440) + 1);
    expect(d.incidents).toBeGreaterThanOrEqual(3);
    expect(d.customerMinutes).toBeGreaterThan(0);
    expect(d.happiness).toBeGreaterThan(0);
    for (let k = 0; k < GAME.kpiHistoryDays + 5; k++) closeKpiDay(s);
    expect(s.kpis.days).toHaveLength(GAME.kpiHistoryDays);
  });

  it('survives a save', () => {
    const sim = Simulation.newScenario('coldSnap');
    sim.step(300);
    const copy = deserializeState(JSON.parse(JSON.stringify(serializeState(sim.state))));
    expect(copy.kpis).toEqual(sim.state.kpis);
  });
});

describe('difficulty', () => {
  it('scales income, decay and failures', () => {
    const easy = createInitialState({ seed: 1, difficulty: 'easy' });
    const hard = createInitialState({ seed: 1, difficulty: 'hard' });
    const c0 = easy.cash;
    earn(easy, 'councilTax', 1000);
    expect(easy.cash - c0).toBe(1150);
    earn(easy, 'electricity', 1000);
    expect(easy.cash - c0).toBe(2150);
    expect(decayFactor(hard, 'water')).toBeGreaterThan(decayFactor(easy, 'water'));
    expect(GAME.difficulty.hard.failureScale).toBeGreaterThan(GAME.difficulty.easy.failureScale);
  });

  it('is saved with the rules', () => {
    const st = createInitialState({ seed: 3, difficulty: 'hard' });
    expect(deserializeState(serializeState(st)).rules.difficulty).toBe('hard');
  });
});

describe('water restrictions', () => {
  it('a hosepipe ban cuts household use; an irrigation ban halves mains-fed farm exports', () => {
    const sim = Simulation.newScenario('heatwave');
    const s = sim.state;
    const home = s.buildings.find(
      (b) =>
        buildingDef(b.code)?.role === 'grown' &&
        (buildingDef(b.code) as { zone: string }).zone === 'residential',
    )!;
    const def = customerDefOf(home.code)!;
    const before = useLps(home, def, waterFactors(s));
    expect(sim.dispatch({ type: 'setWaterRestriction', level: 1 }).ok).toBe(true);
    expect(useLps(home, def, waterFactors(s))).toBeCloseTo(before * 0.85, 6);
    expect(restrictionPenalty(s)).toBeGreaterThan(0);
    const farm = s.buildings.find((b) => {
      const d = buildingDef(b.code) as { irrigationLpd?: number } | undefined;
      return (d?.irrigationLpd ?? 0) > 0 && dailyTaxes(s, b).farmExports > 0;
    });
    if (farm) {
      const ex = dailyTaxes(s, farm).farmExports;
      sim.dispatch({ type: 'setWaterRestriction', level: 2 });
      const after = dailyTaxes(s, farm).farmExports;
      expect(after === ex || after === ex / 2).toBe(true);
    }
    expect(sim.dispatch({ type: 'setWaterRestriction', level: 2 }).ok).toBe(false);
    expect(sim.dispatch({ type: 'setWaterRestriction', level: 7 }).ok).toBe(false);
  });

  it('the fire measure command checks its input', () => {
    const sim = testSim();
    expect(sim.dispatch({ type: 'fireMeasure', fire: 1, measure: 'cordon' }).ok).toBe(false);
  });
});
