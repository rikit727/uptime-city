import { describe, expect, it } from 'vitest';
import { addBuilding } from '../../src/sim/buildings';
import { streetName } from '../../src/sim/complaints';
import { BUILDINGS, SERVICES, WATER } from '../../src/sim/data';
import { appliancesFor, startFire, waterShare } from '../../src/sim/fire';
import { hashState } from '../../src/sim/hash';
import { deserializeState, serializeState } from '../../src/sim/serialize';
import {
  binsMissed,
  collectWaste,
  coverageMinutes,
  accessOf,
  landfillUsed,
  serviceLevel,
  updateRatios,
} from '../../src/sim/services';
import { Simulation } from '../../src/sim/simulation';
import type { SimState } from '../../src/sim/state';
import { finishRound, solveNetwork } from '../../src/sim/water';
import { at, poweredTown, testSim } from './helpers';

const code = (id: string) => BUILDINGS.types.find((t) => t.id === id)!.code;

const ok = (r: { ok: boolean; reason?: string }) => {
  if (!r.ok) throw new Error(r.reason);
};

function solveAll(state: SimState): void {
  const results = state.cache.water.solvable.map((id) =>
    solveNetwork(state, state.cache.water.networks[id - 1]!),
  );
  state.cache.waterStats = finishRound(state, results, () => {});
}

/**
 * Two parallel local roads (y = 20 and y = 24, x 5..50) joined only at x = 50,
 * and a fire station above the first at (6, 18).
 */
function twoStreets(): Simulation {
  const sim = testSim();
  sim.state.rules.fires = false;
  for (const y of [20, 24]) {
    ok(
      sim.dispatch({ type: 'buildRoad', roadClass: 'local', from: { x: 5, y }, to: { x: 50, y } }),
    );
  }
  ok(
    sim.dispatch({
      type: 'buildRoad',
      roadClass: 'local',
      from: { x: 50, y: 21 },
      to: { x: 50, y: 23 },
    }),
  );
  ok(sim.dispatch({ type: 'placeFacility', facility: 'fireStation', at: { x: 6, y: 18 } }));
  return sim;
}

describe('service coverage', () => {
  it('is measured by travel time along the roads, not by distance', () => {
    const sim = twoStreets();
    const s = sim.state;
    // Six tiles from the station as the crow flies, but 90 tiles away by road.
    const near = addBuilding(s, code('house'), 6, 25, 1);
    // Twenty-four tiles away along the station's own road.
    const along = addBuilding(s, code('house'), 30, 21, 1);
    const far = coverageMinutes(s, 'fire', accessOf(s, near));
    const close = coverageMinutes(s, 'fire', accessOf(s, along));
    expect(close).toBeLessThan(2);
    expect(far).toBeGreaterThan(4);
    expect(serviceLevel(s, along, 'fire')).toBeGreaterThan(serviceLevel(s, near, 'fire'));
    // A short cut between the streets brings the first house within a minute or so.
    ok(
      sim.dispatch({
        type: 'buildRoad',
        roadClass: 'local',
        from: { x: 8, y: 21 },
        to: { x: 8, y: 23 },
      }),
    );
    expect(coverageMinutes(s, 'fire', accessOf(s, near))).toBeLessThan(1);
    expect(serviceLevel(s, near, 'fire')).toBeGreaterThan(0.4);
  });

  it('gives nothing beyond the maximum time, and halves without power', () => {
    const sim = twoStreets();
    const s = sim.state;
    const house = addBuilding(s, code('house'), 30, 21, 1);
    const station = s.buildings.find((b) => b.code === 500)!;
    station.unpoweredMinutes = 0;
    const full = serviceLevel(s, house, 'fire');
    station.unpoweredMinutes = 30;
    expect(serviceLevel(s, house, 'fire')).toBeCloseTo(full * SERVICES.unpoweredServiceFactor);
    expect(serviceLevel(s, house, 'police')).toBe(0);
  });

  it('shares a station between its catchment: overloaded stations serve less, budgets help', () => {
    const sim = twoStreets();
    const s = sim.state;
    ok(sim.dispatch({ type: 'placeFacility', facility: 'policeStation', at: { x: 10, y: 18 } }));
    const homes = [];
    for (let x = 12; x <= 48; x += 2) {
      homes.push(addBuilding(s, code('apartmentBlock'), x, 21, 1));
      homes.push(addBuilding(s, code('apartmentBlock'), x, 25, 1));
    }
    const residents = homes.length * 260;
    updateRatios(s);
    const police = s.buildings.find((b) => b.code === 501)!;
    expect(s.cache.services.ratio.get(police.id)).toBeCloseTo(6000 / residents, 2);
    const before = serviceLevel(s, homes[0]!, 'police');
    ok(sim.dispatch({ type: 'setBudget', department: 'services', level: 1.5 }));
    expect(s.cache.services.ratio.get(police.id)).toBeCloseTo((6000 * 1.5) / residents, 2);
    expect(serviceLevel(s, homes[0]!, 'police')).toBeGreaterThan(before);
  });
});

describe('waste', () => {
  it('collects bins within reach, tips them at landfill and misses the rest', () => {
    const sim = twoStreets();
    const s = sim.state;
    const homes = [6, 10, 14].map((x) => addBuilding(s, code('flats'), x, 21, 1));
    // No depot: every bin is missed.
    let missed = collectWaste(s);
    expect(missed.length).toBe(homes.length + 1);
    ok(sim.dispatch({ type: 'placeFacility', facility: 'wasteDepot', at: { x: 20, y: 18 } }));
    // A depot but nowhere to tip: still missed.
    updateRatios(s);
    expect(collectWaste(s).length).toBeGreaterThanOrEqual(homes.length);
    expect(s.services.tipping).toBe(0);
    expect(homes.every((b) => binsMissed(s, b))).toBe(true);
    ok(sim.dispatch({ type: 'placeFacility', facility: 'landfill', at: { x: 30, y: 16 } }));
    updateRatios(s);
    missed = collectWaste(s);
    expect(s.services.tipping).toBe(1);
    expect(missed).toEqual([]);
    const fill = s.buildings.find((b) => b.code === 506)!;
    expect(landfillUsed(s, fill.id)).toBeCloseTo(s.services.waste.landfilledT, 2);
    expect(s.services.waste.collectedT).toBeCloseTo(s.services.waste.generatedT, 2);
    // A recycling centre takes the recyclable share.
    ok(sim.dispatch({ type: 'placeFacility', facility: 'recyclingCentre', at: { x: 36, y: 18 } }));
    collectWaste(s);
    expect(s.services.waste.recycledT).toBeCloseTo(
      s.services.waste.generatedT * SERVICES.waste.recyclableShare,
      2,
    );
  });
});

describe('street names', () => {
  it('follow a straight road through junctions and differ between roads', () => {
    const sim = twoStreets();
    const w = sim.state.world;
    expect(streetName(w, at(sim, 10, 20))).toBe(streetName(w, at(sim, 49, 20)));
    expect(streetName(w, at(sim, 10, 20))).not.toBe(streetName(w, at(sim, 10, 24)));
    // A building's street is the road beside it.
    expect(streetName(w, at(sim, 10, 21))).toBe(streetName(w, at(sim, 10, 20)));
  });
});

/** A watered town (poweredTown) with a fire station on the avenue and random fires off. */
function fireTown(): Simulation {
  const sim = testSim();
  sim.state.rules.fires = false;
  poweredTown(sim);
  ok(sim.dispatch({ type: 'placeFacility', facility: 'fireStation', at: { x: 30, y: 18 } }));
  return sim;
}

describe('fire', () => {
  it('firefighting draws water from the hydrant and lowers the neighbours’ pressure', () => {
    const sim = fireTown();
    const s = sim.state;
    s.minute = 7 * 60 + 30;
    Object.assign(s.weather, { temperatureC: 16, rainMmPerHour: 0, event: null });
    const house = addBuilding(s, code('house'), 12, 21, 1);
    solveAll(s);
    const neighbour = at(sim, 14, 20);
    const before = s.world.pressure[neighbour]!;
    expect(before).toBeGreaterThan(WATER.pressure.lowM);
    const fire = startFire(s, house.id)!;
    expect(fire.hydrant).toBeGreaterThanOrEqual(0);
    // Put the engine to work on site.
    for (const o of s.workOrders.filter((x) => x.incidentId === fire.incidentId)) {
      o.status = 'onSite';
      o.startedMinute = s.minute;
    }
    solveAll(s);
    const during = s.world.pressure[neighbour]!;
    expect(during).toBeLessThan(before);
    expect(waterShare(s, fire)).toBeGreaterThan(SERVICES.fire.tankShare);
  });

  it('an engine drives out through traffic and puts the fire out; the building survives damaged', () => {
    const sim = fireTown();
    const s = sim.state;
    const house = addBuilding(s, code('semi'), 12, 21, 1);
    sim.step(30);
    const fire = startFire(s, house.id)!;
    expect(s.incidents.find((i) => i.id === fire.incidentId)?.kind).toBe('fire');
    expect(s.workOrders.filter((o) => o.type === 'firefighting')).toHaveLength(1);
    for (let k = 0; k < 240 && s.fires.length > 0; k++) sim.step(1);
    expect(s.fires).toHaveLength(0);
    expect(s.cache.byId.has(house.id)).toBe(true);
    expect(house.occupancy).toBeLessThan(1);
    const kpi = s.services.fireKpi;
    expect(kpi.extinguished).toBe(1);
    expect(kpi.responses).toBe(1);
    expect(kpi.responseMinutes).toBeGreaterThan(0);
    expect(s.workOrders.filter((o) => o.type === 'firefighting')).toHaveLength(0);
    expect(s.incidents.find((i) => i.id === fire.incidentId)?.outcome).toBe('cleared');
  });

  it('grows with nobody to fight it and burns the building down', () => {
    const sim = testSim();
    sim.state.rules.fires = false;
    poweredTown(sim);
    const s = sim.state;
    const house = addBuilding(s, code('house'), 12, 21, 1);
    const fire = startFire(s, house.id)!;
    let last = fire.intensity;
    sim.step(10);
    expect(fire.intensity).toBeGreaterThan(last);
    last = fire.intensity;
    for (let k = 0; k < 300 && s.fires.length > 0; k++) sim.step(1);
    expect(s.cache.byId.has(house.id)).toBe(false);
    expect(s.services.fireKpi.destroyed).toBe(1);
    expect(s.complaints.some((c) => /burnt down/.test(c.text))).toBe(true);
    expect(last).toBeGreaterThan(SERVICES.fire.startIntensity);
  });

  it('without water in the mains the engine cannot stop it (tank water only)', () => {
    const sim = testSim();
    sim.state.rules.fires = false;
    poweredTown(sim, 'residential', 'low', false); // roads (and dry mains), no water supply
    ok(sim.dispatch({ type: 'placeFacility', facility: 'fireStation', at: { x: 30, y: 18 } }));
    const s = sim.state;
    const house = addBuilding(s, code('house'), 12, 21, 1);
    const fire = startFire(s, house.id)!;
    for (let k = 0; k < 400 && s.fires.length > 0; k++) sim.step(1);
    expect(fire.firstArrival).toBeGreaterThan(0);
    expect(s.cache.byId.has(house.id)).toBe(false);
  });

  it('big buildings need more engines', () => {
    expect(appliancesFor(1)).toBe(1);
    expect(appliancesFor(4)).toBe(2);
    expect(appliancesFor(16)).toBe(3);
  });

  it('random fires are deterministic and a save made during a fire continues identically', () => {
    const run = () => {
      const sim = fireTown();
      for (let x = 6; x < 30; x++) addBuilding(sim.state, code('house'), x, 21, 1);
      sim.step(20);
      startFire(sim.state, sim.state.buildings.find((b) => b.code === code('house'))!.id);
      sim.step(15);
      return sim;
    };
    const a = run();
    const b = run();
    expect(a.hash()).toBe(b.hash());
    const loaded = new Simulation(deserializeState(serializeState(a.state)));
    expect(hashState(loaded.state)).toBe(a.hash());
    a.step(120);
    loaded.step(120);
    expect(loaded.hash()).toBe(a.hash());
  });
});
