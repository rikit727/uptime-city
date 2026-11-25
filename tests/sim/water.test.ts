import { describe, expect, it } from 'vitest';
import { addBuilding } from '../../src/sim/buildings';
import { BUILDINGS, WATER, facilityDef } from '../../src/sim/data';
import type { SimEvent } from '../../src/sim/events';
import { hashState } from '../../src/sim/hash';
import { deserializeState, serializeState } from '../../src/sim/serialize';
import { Simulation } from '../../src/sim/simulation';
import type { Building, SimState } from '../../src/sim/state';
import { MINUTES_PER_DAY } from '../../src/sim/time';
import {
  finishRound,
  irrigationLps,
  serviceTile,
  solveNetwork,
  waterFactors,
} from '../../src/sim/water';
import { at, poweredTown, testSim } from './helpers';

const codeOf = (id: string) => BUILDINGS.types.find((t) => t.id === id)!.code;
const grown = (id: string) => BUILDINGS.types.find((t) => t.id === id)!;

/** Fix the clock and weather so demand is predictable (07:30, mild, dry). */
function morning(state: SimState, tempC = 16): void {
  state.minute = 7 * 60 + 30;
  Object.assign(state.weather, { temperatureC: tempC, rainMmPerHour: 0, event: null });
}

/** Run one full solve round directly (all networks, then the finish step). */
function solveAll(state: SimState): SimEvent[] {
  const events: SimEvent[] = [];
  const results = state.cache.water.solvable.map((id) =>
    solveNetwork(state, state.cache.water.networks[id - 1]!),
  );
  state.cache.waterStats = finishRound(state, results, (e) => events.push(e));
  return events;
}

/**
 * A treatment works at (55, 15) with its intake at (58, 16), and a distribution
 * main along y = 18 from x = 56 west to x = `toX`. Returns the sim.
 */
function lineNetwork(toX = 0): Simulation {
  const sim = testSim();
  sim.dispatch({ type: 'placeFacility', facility: 'intake', at: { x: 58, y: 16 } });
  sim.dispatch({ type: 'placeFacility', facility: 'treatmentWorks', at: { x: 55, y: 15 } });
  const r = sim.dispatch({
    type: 'buildMain',
    main: 'distribution',
    from: { x: 56, y: 18 },
    to: { x: toX, y: 18 },
  });
  if (!r.ok) throw new Error(r.reason);
  return sim;
}

const pressureAt = (sim: Simulation, x: number, y: number) =>
  sim.state.world.pressure[at(sim, x, y)]!;

/** Busy customers: apartment blocks below (and optionally above) the main at x = from..to. */
function blocks(sim: Simulation, from: number, to: number, bothSides = false): Building[] {
  const out: Building[] = [];
  for (let x = from; x <= to; x += 2) {
    out.push(addBuilding(sim.state, codeOf('apartmentBlock'), x, 19, 1));
    if (bothSides) out.push(addBuilding(sim.state, codeOf('apartmentBlock'), x, 16, 1));
  }
  return out;
}

describe('water network', () => {
  it('connects works, intake and mains; a cut main leaves the far side without water', () => {
    const sim = lineNetwork(20);
    const s = sim.state;
    expect(s.cache.water.solvable).toHaveLength(1);
    morning(s);
    solveAll(s);
    expect(pressureAt(sim, 50, 18)).toBeGreaterThan(WATER.pressure.goodM);
    expect(pressureAt(sim, 20, 18)).toBeGreaterThan(WATER.pressure.goodM);
    sim.dispatch({ type: 'bulldoze', from: { x: 40, y: 18 }, to: { x: 40, y: 18 } });
    expect(s.cache.water.networks.length).toBe(2);
    solveAll(s);
    expect(pressureAt(sim, 50, 18)).toBeGreaterThan(WATER.pressure.goodM);
    expect(pressureAt(sim, 20, 18)).toBe(0);
  });

  it('needs an intake: a treatment works alone produces nothing', () => {
    const sim = testSim();
    sim.dispatch({ type: 'placeFacility', facility: 'treatmentWorks', at: { x: 30, y: 15 } });
    sim.dispatch({
      type: 'buildMain',
      main: 'distribution',
      from: { x: 29, y: 16 },
      to: { x: 10, y: 16 },
    });
    morning(sim.state);
    solveAll(sim.state);
    expect(pressureAt(sim, 20, 16)).toBe(0);
  });

  it('roads come with a distribution main and join the network', () => {
    const sim = lineNetwork(20);
    sim.dispatch({
      type: 'buildRoad',
      roadClass: 'local',
      from: { x: 30, y: 19 },
      to: { x: 30, y: 40 },
    });
    expect(sim.state.world.water[at(sim, 30, 35)]).toBe(1);
    morning(sim.state);
    solveAll(sim.state);
    expect(pressureAt(sim, 30, 40)).toBeGreaterThan(WATER.pressure.lowM);
  });
});

describe('pressure', () => {
  it('falls with distance from the treatment works', () => {
    const sim = lineNetwork(0);
    morning(sim.state);
    solveAll(sim.state);
    const p = [50, 40, 30, 20, 10, 0].map((x) => pressureAt(sim, x, 18));
    for (let k = 1; k < p.length; k++) expect(p[k]!).toBeLessThanOrEqual(p[k - 1]!);
    expect(p[0]! - p[p.length - 1]!).toBeGreaterThanOrEqual(1);
  });

  it('falls with flow: busy customers at the end of a main get low pressure at peak', () => {
    const sim = lineNetwork(0);
    const s = sim.state;
    morning(s);
    solveAll(s);
    const quiet = pressureAt(sim, 2, 18);
    // About 11,000 residents on one 150 mm main: well over its capacity at the morning peak.
    const flats = blocks(sim, 0, 40, true);
    solveAll(s);
    const busy = pressureAt(sim, 2, 18);
    expect(busy).toBeLessThan(quiet - 15);
    // The customers furthest out are affected first.
    const near = flats.find((b) => b.x === 40)!;
    const far = flats.find((b) => b.x === 0)!;
    expect(s.world.pressure[serviceTile(s.world, near, grown('apartmentBlock'))]!).toBeGreaterThan(
      s.world.pressure[serviceTile(s.world, far, grown('apartmentBlock'))]!,
    );
    // At night the same main copes.
    s.minute = 3 * 60;
    solveAll(s);
    expect(pressureAt(sim, 2, 18)).toBeGreaterThan(busy);
  });

  it('a larger main carries the same flow with less loss', () => {
    const sim = lineNetwork(0);
    const s = sim.state;
    blocks(sim, 0, 40, true);
    morning(s);
    solveAll(s);
    const small = pressureAt(sim, 2, 18);
    sim.dispatch({
      type: 'buildMain',
      main: 'feeder',
      from: { x: 54, y: 18 },
      to: { x: 0, y: 18 },
    });
    solveAll(s);
    expect(pressureAt(sim, 2, 18)).toBeGreaterThan(small + 10);
  });

  it('recovers downstream when a booster pumping station is added, and boosters separate zones', () => {
    const sim = lineNetwork(0);
    const s = sim.state;
    blocks(sim, 0, 20);
    morning(s);
    solveAll(s);
    const before = pressureAt(sim, 2, 18);
    const upstream = pressureAt(sim, 40, 18);
    // Replace one main tile with a booster.
    sim.dispatch({ type: 'bulldoze', from: { x: 30, y: 18 }, to: { x: 30, y: 18 } });
    const r = sim.dispatch({ type: 'placeFacility', facility: 'booster', at: { x: 30, y: 18 } });
    expect(r.ok).toBe(true);
    expect(s.cache.water.zoneAt[at(sim, 29, 18)]).not.toBe(s.cache.water.zoneAt[at(sim, 31, 18)]);
    expect(s.cache.water.netAt[at(sim, 29, 18)]).toBe(s.cache.water.netAt[at(sim, 31, 18)]);
    solveAll(s);
    const after = pressureAt(sim, 2, 18);
    expect(after).toBeGreaterThan(before + 15);
    // Upstream of the booster nothing improves.
    expect(pressureAt(sim, 40, 18)).toBeLessThanOrEqual(upstream);
    const booster = s.buildings.find((b) => b.code === facilityDef('booster').code)!;
    expect(s.cache.waterFlowLps.get(booster.id)).toBeGreaterThan(0);
  });

  it('draws power for pumps: an unpowered booster gives no boost', () => {
    const sim = lineNetwork(0);
    const s = sim.state;
    blocks(sim, 0, 20);
    sim.dispatch({ type: 'bulldoze', from: { x: 30, y: 18 }, to: { x: 30, y: 18 } });
    sim.dispatch({ type: 'placeFacility', facility: 'booster', at: { x: 30, y: 18 } });
    morning(s);
    solveAll(s);
    const boosted = pressureAt(sim, 2, 18);
    const booster = s.buildings.find((b) => b.code === facilityDef('booster').code)!;
    booster.unpoweredMinutes = 10;
    solveAll(s);
    expect(pressureAt(sim, 2, 18)).toBeLessThan(boosted - 15);
  });
});

describe('supply and storage', () => {
  it('a network that cannot meet demand loses pressure, and low-pressure customers are counted', () => {
    // A reservoir as the only source, feeding apartment blocks along y = 18.
    const sim = testSim();
    const s = sim.state;
    sim.dispatch({ type: 'placeFacility', facility: 'serviceReservoir', at: { x: 20, y: 15 } });
    sim.dispatch({
      type: 'buildMain',
      main: 'distribution',
      from: { x: 21, y: 18 },
      to: { x: 0, y: 18 },
    });
    const res = s.buildings.find((b) => b.code === facilityDef('serviceReservoir').code)!;
    blocks(sim, 0, 18);
    morning(s);
    res.storedMl = 10;
    solveAll(s);
    const full = pressureAt(sim, 2, 18);
    expect(s.cache.waterStats.lowPressure).toBe(0);
    // Enough left for half of this step's demand: source head falls to a quarter.
    const demand = s.cache.waterStats.demandLps;
    res.storedMl = (0.5 * demand * WATER.solveIntervalMinutes * 60) / 1e6;
    solveAll(s);
    expect(pressureAt(sim, 2, 18)).toBeLessThan(full - 10);
    expect(s.cache.waterStats.lowPressure + s.cache.waterStats.noSupply).toBeGreaterThan(0);
    expect(res.storedMl).toBeCloseTo(0, 9);
  });

  it('a service reservoir fills from spare output and covers the works losing power', () => {
    const sim = lineNetwork(20);
    const s = sim.state;
    sim.dispatch({ type: 'placeFacility', facility: 'serviceReservoir', at: { x: 20, y: 19 } });
    const res = s.buildings.find((b) => b.code === facilityDef('serviceReservoir').code)!;
    blocks(sim, 24, 40);
    morning(s);
    solveAll(s);
    expect(res.storedMl).toBeGreaterThan(0);
    res.storedMl = 10;
    const works = s.buildings.find((b) => b.code === facilityDef('treatmentWorks').code)!;
    works.unpoweredMinutes = 5;
    solveAll(s);
    expect(res.storedMl).toBeLessThan(10);
    expect(pressureAt(sim, 30, 18)).toBeGreaterThan(WATER.pressure.lowM);
    expect(s.cache.waterStats.noSupply).toBe(0);
  });

  it('without any source customers lose supply, and the event fires once', () => {
    const sim = lineNetwork(20);
    const s = sim.state;
    const flats = blocks(sim, 24, 30);
    morning(s);
    expect(solveAll(s).some((e) => e.type === 'waterSupplyLost')).toBe(false);
    const works = s.buildings.find((b) => b.code === facilityDef('treatmentWorks').code)!;
    works.unpoweredMinutes = 5;
    const ev = solveAll(s);
    expect(ev.some((e) => e.type === 'waterSupplyLost')).toBe(true);
    expect(flats.every((b) => b.dryMinutes > 0)).toBe(true);
    expect(solveAll(s).some((e) => e.type === 'waterSupplyLost')).toBe(false);
    works.unpoweredMinutes = 0;
    expect(solveAll(s).some((e) => e.type === 'waterSupplyRestored')).toBe(true);
    expect(flats.every((b) => b.dryMinutes === 0)).toBe(true);
  });

  it('flags priority customers (care homes) without water', () => {
    const sim = lineNetwork(20);
    const s = sim.state;
    addBuilding(s, codeOf('careHome'), 30, 19, 1);
    morning(s);
    solveAll(s);
    const works = s.buildings.find((b) => b.code === facilityDef('treatmentWorks').code)!;
    works.unpoweredMinutes = 5;
    const ev = solveAll(s);
    expect(ev).toContainEqual({ type: 'priorityCustomersWithoutWater', buildings: 1 });
    expect(s.cache.waterStats.priorityNoSupply).toBe(1);
  });

  it('counts abstraction against the licence and reports a breach once a day', () => {
    const sim = lineNetwork(20);
    const s = sim.state;
    morning(s);
    s.water.abstractedTodayMl = 30;
    const ev = solveAll(s);
    expect(ev.some((e) => e.type === 'abstractionLicenceBreached')).toBe(true);
    expect(solveAll(s).some((e) => e.type === 'abstractionLicenceBreached')).toBe(false);
  });
});

describe('irrigation', () => {
  /** An arable farm on the riverbank (x 54..57, y 30..33), not on the mains. */
  function riverFarm(): { sim: Simulation; farm: Building } {
    const sim = testSim();
    const farm = addBuilding(sim.state, codeOf('arableFarm'), 54, 30, 1);
    return { sim, farm };
  }

  it('rises with temperature and in a heatwave', () => {
    const { sim, farm } = riverFarm();
    const s = sim.state;
    s.minute = 30 * MINUTES_PER_DAY + 12 * 60; // summer, midday
    Object.assign(s.weather, { temperatureC: 18, rainMmPerHour: 0, event: null });
    const mild = irrigationLps(farm, grown('arableFarm'), waterFactors(s));
    s.weather.temperatureC = 30;
    const hot = irrigationLps(farm, grown('arableFarm'), waterFactors(s));
    s.weather.event = { id: 'heatwave', startDay: 30, endDay: 33 };
    const wave = irrigationLps(farm, grown('arableFarm'), waterFactors(s));
    expect(hot).toBeGreaterThan(mild * 1.5);
    expect(wave).toBeGreaterThan(hot);
    s.weather.rainMmPerHour = 3;
    expect(irrigationLps(farm, grown('arableFarm'), waterFactors(s))).toBe(0);
  });

  it('draws from the river until the daily licence, then stops', () => {
    const { sim, farm } = riverFarm();
    const s = sim.state;
    s.minute = 30 * MINUTES_PER_DAY + 12 * 60;
    Object.assign(s.weather, { temperatureC: 30, rainMmPerHour: 0, event: null });
    s.water.farmAbstractedTodayMl = WATER.irrigation.farmLicenceMlPerDay - 0.0001;
    const ev = solveAll(s);
    expect(ev).toContainEqual({
      type: 'irrigationLicenceReached',
      licenceMl: WATER.irrigation.farmLicenceMlPerDay,
    });
    expect(s.water.irrigationCapped).toBe(true);
    expect(s.water.farmAbstractedTodayMl).toBe(WATER.irrigation.farmLicenceMlPerDay);
    solveAll(s);
    expect(s.water.farmAbstractedTodayMl).toBe(WATER.irrigation.farmLicenceMlPerDay);
    // A farm by the river keeps its household water.
    expect(farm.dryMinutes).toBe(0);
    // The licence resets at midnight.
    sim.state.minute = 31 * MINUTES_PER_DAY - 1;
    sim.step();
    expect(s.water.irrigationCapped).toBe(false);
    expect(s.water.farmAbstractedTodayMl).toBe(0);
  });

  it('a farm on the mains irrigates from the mains once the river licence is used up', () => {
    const sim = lineNetwork(40);
    const s = sim.state;
    // Beside the main at y = 18 and within reach of the river.
    const farm = addBuilding(s, codeOf('arableFarm'), 54, 19, 1);
    s.minute = 30 * MINUTES_PER_DAY + 12 * 60;
    Object.assign(s.weather, { temperatureC: 28, rainMmPerHour: 0, event: null });
    solveAll(s);
    const fromRiver = s.cache.waterUseLps.get(farm.id)!;
    s.water.irrigationCapped = true;
    solveAll(s);
    expect(s.cache.waterUseLps.get(farm.id)!).toBeGreaterThan(fromRiver * 5);
  });
});

describe('wastewater', () => {
  /** poweredTown with water, two days of growth, and a sewage works at the avenue's east end. */
  function sewered(): Simulation {
    const sim = testSim();
    poweredTown(sim, 'residential', 'high');
    const r = sim.dispatch({
      type: 'placeFacility',
      facility: 'sewageWorks',
      at: { x: 41, y: 19 },
    });
    if (!r.ok) throw new Error(r.reason);
    sim.step(2 * MINUTES_PER_DAY);
    return sim;
  }

  it('treats dry-weather flow, and a storm overflows the works', () => {
    const sim = sewered();
    const s = sim.state;
    expect(s.buildings.filter((b) => b.code < 200).length).toBeGreaterThan(3);
    morning(s);
    solveAll(s);
    expect(s.cache.waterStats.sewageInflowLps).toBeGreaterThan(0);
    expect(s.cache.waterStats.spillLps).toBe(0);
    // Find the runoff per mm of rain, then rain hard enough to exceed the works' capacity.
    const dry = s.cache.waterStats.sewageInflowLps;
    s.weather.rainMmPerHour = 1;
    solveAll(s);
    const perMm = s.cache.waterStats.sewageInflowLps - dry;
    expect(perMm).toBeGreaterThan(0);
    expect(s.cache.waterStats.spillLps).toBe(0);
    s.weather.rainMmPerHour = (1.5 * (s.cache.waterStats.sewageCapacityLps - dry)) / perMm;
    let ev = solveAll(s);
    expect(ev.some((e) => e.type === 'sewerOverflow')).toBe(true);
    expect(s.cache.waterStats.spillLps).toBeGreaterThan(0);
    expect(s.water.spillMl).toBeGreaterThan(0);
    s.weather.rainMmPerHour = 0;
    ev = solveAll(s);
    expect(ev.find((e) => e.type === 'sewerOverflowEnded')).toBeDefined();
  });

  it('counts sewage as untreated without a works', () => {
    const sim = testSim();
    poweredTown(sim, 'residential', 'high');
    sim.step(MINUTES_PER_DAY);
    morning(sim.state);
    solveAll(sim.state);
    expect(sim.state.cache.waterStats.untreatedLps).toBeGreaterThan(0);
  });
});

describe('growth and water', () => {
  it('nothing grows without water, even with power and roads', () => {
    const sim = testSim();
    poweredTown(sim, 'residential', 'low', false);
    sim.step(MINUTES_PER_DAY);
    expect(sim.state.buildings.filter((b) => b.code < 200)).toHaveLength(0);
  });

  it('grows with water and keeps everyone supplied', () => {
    const sim = testSim();
    poweredTown(sim, 'residential', 'medium');
    sim.step(2 * MINUTES_PER_DAY);
    const homes = sim.state.buildings.filter((b) => b.code < 200);
    expect(homes.length).toBeGreaterThan(10);
    expect(homes.every((b) => b.dryMinutes === 0)).toBe(true);
    expect(sim.state.cache.waterStats.customers).toBe(homes.length);
  });

  it('long water outages empty buildings', () => {
    const sim = testSim();
    poweredTown(sim);
    sim.step(MINUTES_PER_DAY);
    // Remove the intake: the works stops and the town runs dry.
    sim.dispatch({ type: 'bulldoze', from: { x: 58, y: 16 }, to: { x: 59, y: 17 } });
    sim.step(MINUTES_PER_DAY);
    const homes = sim.state.buildings.filter((b) => b.code < 200);
    expect(homes.every((b) => b.dryMinutes > WATER.outageGraceMinutes)).toBe(true);
    expect(homes.some((b) => b.occupancy < 0.2)).toBe(true);
  });
});

describe('water determinism', () => {
  it('same commands give the same hash, and a save loaded mid-round continues identically', () => {
    const run = () => {
      const sim = testSim();
      poweredTown(sim, 'residential', 'medium');
      sim.step(MINUTES_PER_DAY + 3);
      return sim;
    };
    const a = run();
    const b = run();
    expect(a.hash()).toBe(b.hash());
    // Find a tick in the middle of a solve round, save there, and continue both.
    expect(a.state.cache.water.solvable.length).toBeGreaterThan(0);
    // After a network step and before the finish step, the cursor is above 0.
    for (let k = 0; k < 20 && a.state.water.cursor <= 0; k++) a.step();
    expect(a.state.water.cursor).toBeGreaterThan(0);
    const loaded = new Simulation(
      deserializeState(JSON.parse(JSON.stringify(serializeState(a.state)))),
    );
    expect(hashState(loaded.state)).toBe(a.hash());
    a.step(500);
    loaded.step(500);
    expect(loaded.hash()).toBe(a.hash());
  });
});
