import { describe, expect, it } from 'vitest';
import {
  FAULT,
  conditionOf,
  curveProbability,
  dailyDecay,
  failureProbability,
} from '../../src/sim/assets';
import { addBuilding } from '../../src/sim/buildings';
import { ASSETS, BUILDINGS, WATER, tileAssetClass } from '../../src/sim/data';
import { visitTile } from '../../src/sim/decay';
import type { SimEvent } from '../../src/sim/events';
import { hashState } from '../../src/sim/hash';
import { mttrMinutes, openIncident, severityOf } from '../../src/sim/incidents';
import { planRoute } from '../../src/sim/routing';
import { deserializeState, serializeState } from '../../src/sim/serialize';
import { Simulation } from '../../src/sim/simulation';
import type { Incident } from '../../src/sim/state';
import { MINUTES_PER_DAY } from '../../src/sim/time';
import { at, poweredTown, testSim } from './helpers';

const ok = (r: { ok: boolean; reason?: string }) => {
  if (!r.ok) throw new Error(r.reason);
};

/** Run until `done` holds (or fail after `max` ticks). Returns the events seen. */
function runUntil(sim: Simulation, done: () => boolean, max = 2 * MINUTES_PER_DAY): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < max && !done(); t++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  if (!done()) throw new Error('Condition not reached');
  return events;
}

/** A grown, watered town (see helpers.poweredTown) with a water depot beside the avenue. */
function wateredTown(): Simulation {
  const sim = testSim();
  poweredTown(sim, 'residential', 'low');
  sim.step(MINUTES_PER_DAY);
  ok(sim.dispatch({ type: 'placeFacility', facility: 'waterDepot', at: { x: 33, y: 21 } }));
  sim.step(10);
  sim.drainEvents();
  return sim;
}

/** Buildings on the far (west) side of x = 30 that connect to the avenue main. */
const westHomes = (sim: Simulation) =>
  sim.state.buildings.filter((b) => b.code < 200 && b.x + 1 < 28);

describe('asset decay and failure curves', () => {
  it('the failure curve rises as condition falls and interpolates between points', () => {
    expect(curveProbability(100)).toBeCloseTo(ASSETS.failureCurve[0]![1]);
    expect(curveProbability(0)).toBeCloseTo(0.02);
    expect(curveProbability(70)).toBeCloseTo((0.0001 + 0.0004) / 2);
    for (let c = 0; c < 100; c += 5) {
      expect(curveProbability(c)).toBeGreaterThan(curveProbability(c + 5));
    }
  });

  it('cold snaps multiply the burst rate of mains, storms the fault rate of lines', () => {
    const main = tileAssetClass('main', 1)!;
    const line = tileAssetClass('line', 1)!;
    expect(failureProbability(main, 50, 'coldSnap')).toBeCloseTo(
      4 * failureProbability(main, 50, null),
    );
    expect(failureProbability(main, 50, 'storm')).toBeCloseTo(failureProbability(main, 50, null));
    expect(failureProbability(line, 50, 'storm')).toBeCloseTo(
      3 * failureProbability(line, 50, null),
    );
  });

  it('decays daily by the base rate, faster under load, and resets the peak load', () => {
    const sim = testSim();
    ok(
      sim.dispatch({
        type: 'buildRoad',
        roadClass: 'local',
        from: { x: 5, y: 5 },
        to: { x: 6, y: 5 },
      }),
    );
    const s = sim.state;
    const w = s.world;
    const a = at(sim, 5, 5);
    const b = at(sim, 6, 5);
    expect(w.condition.road[a]).toBe(10000);
    expect(w.condition.main[a]).toBe(10000);
    expect(w.laid.road[a]).toBe(1);
    w.peakLoad.main[b] = 100;
    s.rng = { next: () => 0.99 } as never; // no failures
    visitTile(s, a, () => {});
    visitTile(s, b, () => {});
    const road = tileAssetClass('road', 1)!;
    const main = tileAssetClass('main', 1)!;
    expect(conditionOf(s, { layer: 'road', id: a })).toBeCloseTo(100 - road.decayPerDay, 2);
    expect(conditionOf(s, { layer: 'main', id: a })).toBeCloseTo(100 - main.decayPerDay, 2);
    expect(conditionOf(s, { layer: 'main', id: b })).toBeCloseTo(100 - dailyDecay(main, 1), 2);
    expect(dailyDecay(main, 1)).toBeGreaterThan(main.decayPerDay);
    expect(w.peakLoad.main[b]).toBe(0);
  });

  it('the water solve records main utilisation as peak load', () => {
    const sim = wateredTown();
    const flats = BUILDINGS.types.find((t) => t.id === 'apartmentBlock')!.code;
    for (let x = 41; x <= 51; x += 2) addBuilding(sim.state, flats, x, 19, 1);
    sim.state.minute = 7 * 60 + 30 + MINUTES_PER_DAY; // morning peak
    sim.step(10);
    expect(sim.state.world.peakLoad.main[at(sim, 54, 18)]).toBeGreaterThan(0);
  });

  it('the sweep visits every tile once a day', () => {
    const sim = testSim();
    ok(
      sim.dispatch({
        type: 'buildRoad',
        roadClass: 'local',
        from: { x: 5, y: 5 },
        to: { x: 5, y: 9 },
      }),
    );
    const t = at(sim, 5, 7);
    sim.step(MINUTES_PER_DAY);
    const road = tileAssetClass('road', 1)!;
    expect(conditionOf(sim.state, { layer: 'road', id: t })).toBeCloseTo(100 - road.decayPerDay, 2);
  });

  it('cold snaps burst more mains in a large worn network', () => {
    const count = (coldSnap: boolean): number => {
      const sim = testSim();
      const s = sim.state;
      const w = s.world;
      s.weather.event = coldSnap ? { id: 'coldSnap', startDay: 1, endDay: 9 } : null;
      for (let y = 0; y < 60; y++)
        for (let x = 0; x < 58; x++) {
          const t = y * w.width + x;
          w.water[t] = 1;
          w.condition.main[t] = 2000;
        }
      let n = 0;
      for (let y = 0; y < 60; y++)
        for (let x = 0; x < 58; x++)
          visitTile(s, y * w.width + x, (e) => {
            if (e.type === 'incidentOpened') n++;
          });
      return n;
    };
    const normal = count(false);
    const cold = count(true);
    expect(normal).toBeGreaterThan(5);
    expect(cold).toBeGreaterThan(2.5 * normal);
  });
});

describe('burst → incident → work order → crew → repair', () => {
  it('cuts supply downstream, leaks, is repaired by a crew and restores supply', () => {
    const sim = wateredTown();
    const s = sim.state;
    const homes = westHomes(sim);
    expect(homes.length).toBeGreaterThan(2);
    const cashBefore = s.cash;
    const tile = at(sim, 30, 20);
    s.world.condition.main[tile] = 3000;
    const inc = openIncident(s, 'burst', { layer: 'main', id: tile }, tile);
    expect(s.cache.faults.tile[tile]! & FAULT.BURST).toBeTruthy();
    const order = s.workOrders.find((o) => o.incidentId === inc.id)!;
    expect(order.crew).toBe('water');
    // Next solve: pressure gone west of the burst, leakage counted.
    sim.step(10);
    expect(s.world.pressure[at(sim, 20, 20)]).toBe(0);
    expect(s.world.pressure[at(sim, 35, 20)]).toBeGreaterThan(WATER.pressure.noSupplyM);
    expect(s.cache.waterStats.leakageLps).toBeGreaterThan(0);
    expect(homes.every((b) => b.dryMinutes > 0)).toBe(true);
    // A crew was dispatched and the incident counts customers.
    const crew = s.crews.find((c) => c.id === order.crewId)!;
    expect(crew.status === 'enRoute' || crew.status === 'onSite').toBe(true);
    expect(inc.customers).toBeGreaterThan(0);
    // Crew arrives and isolates the burst: the leak stops.
    runUntil(sim, () => order.status === 'onSite');
    expect(s.cache.faults.tile[tile]! & FAULT.MAIN_OFF).toBeTruthy();
    // An avenue keeps one lane open for emergency repairs (roads.json repairClosure).
    expect(s.cache.faults.tile[tile]! & FAULT.LANE_CLOSED).toBeTruthy();
    expect(s.permits.find((p) => p.orders.includes(order.id))?.kind).toBe('emergency');
    sim.step(10);
    expect(s.cache.waterStats.leakageLps).toBe(0);
    // Repair finishes: incident resolved, cost paid, condition restored.
    const events = runUntil(sim, () => inc.resolvedMinute >= 0);
    expect(events.some((e) => e.type === 'incidentResolved' && e.id === inc.id)).toBe(true);
    expect(inc.outcome).toBe('repaired');
    expect(s.workOrders).toHaveLength(0);
    expect(conditionOf(s, { layer: 'main', id: tile })).toBe(ASSETS.repairRestoresTo);
    expect(s.cash).toBeLessThanOrEqual(cashBefore - tileAssetClass('main', 1)!.repair.cost);
    sim.step(10);
    expect(s.world.pressure[at(sim, 20, 20)]).toBeGreaterThan(WATER.pressure.lowM);
    expect(homes.every((b) => b.dryMinutes === 0)).toBe(true);
    // KPIs.
    expect(s.assets.kpi.repairs).toBe(1);
    expect(mttrMinutes(s)).toBe(inc.resolvedMinute - inc.openedMinute);
    expect(mttrMinutes(s)).toBeGreaterThan(ASSETS.crews.mobiliseMinutes);
    expect(inc.customerMinutes).toBeGreaterThan(0);
    expect(s.assets.kpi.customerMinutes).toBeGreaterThanOrEqual(inc.customerMinutes);
    // The crew drives home and is free again.
    runUntil(sim, () => crew.status === 'idle');
  });

  it('waits in the queue without a depot and warns that no crew exists', () => {
    const sim = testSim();
    poweredTown(sim);
    const tile = at(sim, 30, 20);
    const events: SimEvent[] = [];
    openIncident(sim.state, 'burst', { layer: 'main', id: tile }, tile, (e) => events.push(e));
    expect(events.some((e) => e.type === 'noCrew' && e.crew === 'water')).toBe(true);
    sim.step(100);
    expect(sim.state.workOrders[0]!.status).toBe('queued');
  });

  it('a cable fault cuts the line and the substation it feeds until repaired', () => {
    const sim = testSim();
    poweredTown(sim);
    ok(sim.dispatch({ type: 'placeFacility', facility: 'powerDepot', at: { x: 33, y: 21 } }));
    sim.step(5);
    const s = sim.state;
    const sub = s.buildings.find((b) => b.x === 50 && b.y === 14)!;
    expect(s.cache.network.feedMW.get(sub.id)).toBeGreaterThan(0);
    const tile = at(sim, 30, 30); // the line runs along y = 30, then up x = 49
    expect(s.world.power[tile]).not.toBe(0);
    const inc = openIncident(s, 'cableFault', { layer: 'line', id: tile }, tile);
    expect(s.cache.network.feedMW.get(sub.id)).toBe(0);
    sim.step(10);
    expect(sub.unpoweredMinutes).toBe(0); // substations themselves draw nothing
    const works = s.buildings.find((b) => b.x === 55 && b.y === 15)!;
    expect(works.unpoweredMinutes).toBeGreaterThan(0);
    runUntil(sim, () => inc.resolvedMinute >= 0);
    expect(s.cache.network.feedMW.get(sub.id)).toBeGreaterThan(0);
  });

  it('a failed facility is out of service until repaired', () => {
    const sim = wateredTown();
    const s = sim.state;
    const works = s.buildings.find((b) => b.x === 55 && b.y === 15)!;
    const inc = openIncident(
      s,
      'facilityFault',
      { layer: 'facility', id: works.id },
      at(sim, 55, 15),
    );
    sim.step(10);
    expect(s.cache.waterStats.productionLps).toBe(0);
    runUntil(sim, () => inc.resolvedMinute >= 0);
    sim.step(10);
    expect(s.cache.waterStats.productionLps).toBeGreaterThan(0);
  });

  it('demolishing a burst main closes its incident and cancels the order', () => {
    const sim = wateredTown();
    const s = sim.state;
    const tile = at(sim, 30, 20);
    const inc = openIncident(s, 'burst', { layer: 'main', id: tile }, tile);
    sim.step(3);
    ok(sim.dispatch({ type: 'bulldoze', from: { x: 30, y: 20 }, to: { x: 30, y: 20 } }));
    expect(inc.outcome).toBe('removed');
    expect(s.workOrders).toHaveLength(0);
    expect(s.cache.faults.tile[tile]).toBe(0);
    expect(s.crews.every((c) => c.orderId === 0)).toBe(true);
  });
});

describe('severity, priority customers and bottled water', () => {
  const base = (over: Partial<Incident>): Incident => ({
    id: 1,
    kind: 'burst',
    title: 'Burst',
    asset: { layer: 'main', id: 0 },
    tile: 0,
    openedMinute: 0,
    slaMinutes: 360,
    resolvedMinute: -1,
    outcome: '',
    severity: 2,
    customers: 0,
    peakCustomers: 0,
    priorityCustomers: 0,
    customerMinutes: 0,
    bottledWater: false,
    slaBreached: false,
    orderId: 0,
    ...over,
  });

  it('rises with customers affected and with priority customers; bottled water takes that back', () => {
    expect(severityOf(base({}))).toBe(2);
    expect(severityOf(base({ customers: 60 }))).toBe(3);
    expect(severityOf(base({ customers: 300 }))).toBe(4);
    expect(severityOf(base({ customers: 60, priorityCustomers: 1 }))).toBe(4);
    expect(severityOf(base({ customers: 60, priorityCustomers: 1, bottledWater: true }))).toBe(3);
    expect(severityOf(base({ kind: 'roadDefect' }))).toBe(1);
  });

  it('sendBottledWater needs a water incident with priority customers off supply', () => {
    const sim = wateredTown();
    const s = sim.state;
    const tile = at(sim, 30, 20);
    const inc = openIncident(s, 'burst', { layer: 'main', id: tile }, tile);
    expect(sim.dispatch({ type: 'sendBottledWater', incident: inc.id }).ok).toBe(false);
    inc.priorityCustomers = 1;
    inc.severity = severityOf(inc);
    const cash = s.cash;
    ok(sim.dispatch({ type: 'sendBottledWater', incident: inc.id }));
    expect(inc.bottledWater).toBe(true);
    expect(s.cash).toBe(cash - ASSETS.bottledWater.cost);
    expect(inc.severity).toBe(severityOf({ ...inc, priorityCustomers: 0 }));
  });
});

describe('planned maintenance', () => {
  it('raises orders below a threshold, isolates the main while on site, restores condition', () => {
    const sim = wateredTown();
    const s = sim.state;
    const tile = at(sim, 30, 20);
    s.world.condition.main[tile] = 4000;
    const cash = s.cash;
    const plan = sim.preview({
      type: 'raiseMaintenance',
      from: { x: 30, y: 20 },
      to: { x: 30, y: 20 },
      below: 50,
    });
    expect(plan.ok).toBe(true);
    expect(plan.cost).toBe(tileAssetClass('main', 1)!.maintenance.cost); // road is above 50
    ok(
      sim.dispatch({
        type: 'raiseMaintenance',
        from: { x: 30, y: 20 },
        to: { x: 30, y: 20 },
        below: 50,
      }),
    );
    expect(s.cash).toBe(cash - plan.cost);
    const order = s.workOrders[0]!;
    expect(order.type).toBe('maintenance');
    // Already booked: a second request finds nothing.
    expect(
      sim.preview({
        type: 'raiseMaintenance',
        from: { x: 30, y: 20 },
        to: { x: 30, y: 20 },
        below: 50,
      }).ok,
    ).toBe(false);
    runUntil(sim, () => order.status === 'onSite');
    expect(s.cache.faults.tile[tile]! & FAULT.MAIN_OFF).toBeTruthy();
    sim.step(10);
    expect(s.world.pressure[at(sim, 20, 20)]).toBe(0);
    runUntil(sim, () => s.workOrders.length === 0);
    expect(conditionOf(s, { layer: 'main', id: tile })).toBe(100);
    expect(s.cache.faults.tile[tile]).toBe(0);
  });

  it('cancelling planned work refunds it; repairs cannot be cancelled', () => {
    const sim = wateredTown();
    const s = sim.state;
    const cash = s.cash;
    ok(
      sim.dispatch({
        type: 'raiseMaintenance',
        from: { x: 10, y: 20 },
        to: { x: 12, y: 20 },
        below: 101,
      }),
    );
    expect(s.workOrders.length).toBe(6); // three tiles × (road + main)
    expect(s.cash).toBeLessThan(cash);
    for (const o of [...s.workOrders]) ok(sim.dispatch({ type: 'cancelOrder', order: o.id }));
    expect(s.cash).toBe(cash);
    const tile = at(sim, 30, 20);
    const inc = openIncident(s, 'burst', { layer: 'main', id: tile }, tile);
    expect(sim.dispatch({ type: 'cancelOrder', order: inc.orderId }).ok).toBe(false);
  });

  it('work orders go to crews by priority and the player can re-prioritise', () => {
    const sim = wateredTown();
    const s = sim.state;
    ok(
      sim.dispatch({
        type: 'raiseMaintenance',
        from: { x: 10, y: 20 },
        to: { x: 12, y: 20 },
        below: 101,
        crew: 'water',
      }),
    );
    expect(s.workOrders.length).toBe(3);
    // Two crews: the two oldest routine orders go first; bump the third to emergency first.
    const third = s.workOrders[2]!;
    // Pause dispatch by re-queuing: set priority before the next tick runs.
    ok(sim.dispatch({ type: 'setOrderPriority', order: third.id, priority: 1 }));
    sim.step();
    expect(third.status).toBe('enRoute');
    expect(s.workOrders.filter((o) => o.status === 'enRoute').length).toBe(2);
  });
});

describe('routing', () => {
  it('drives along roads and goes off-road only at the ends', () => {
    const sim = testSim();
    ok(
      sim.dispatch({
        type: 'buildRoad',
        roadClass: 'avenue',
        from: { x: 5, y: 20 },
        to: { x: 40, y: 20 },
      }),
    );
    const w = sim.state.world;
    const r = planRoute(w, at(sim, 5, 22), at(sim, 40, 21));
    expect(r.path[0]).toBe(at(sim, 5, 22));
    expect(r.path[r.path.length - 1]).toBe(at(sim, 40, 21));
    expect(r.path.slice(1, -1).every((t) => w.road[t] !== 0)).toBe(true);
    // 35 tiles at 50 km/h ≈ 1.05 min, plus two short off-road legs.
    expect(r.minutes).toBeGreaterThan(1);
    expect(r.minutes).toBeLessThan(4);
    const far = planRoute(w, at(sim, 5, 100), at(sim, 40, 100));
    expect(far.path).toEqual([at(sim, 5, 100), at(sim, 40, 100)]);
    expect(far.minutes).toBeGreaterThan(r.minutes * 3);
  });
});

describe('determinism and saves', () => {
  /** A worn town that will see failures, crews and repairs. */
  function wornTown(): Simulation {
    const sim = wateredTown();
    ok(sim.dispatch({ type: 'placeFacility', facility: 'powerDepot', at: { x: 36, y: 21 } }));
    ok(sim.dispatch({ type: 'placeFacility', facility: 'roadsDepot', at: { x: 33, y: 24 } }));
    const w = sim.state.world;
    for (const layer of ['road', 'main', 'line'] as const) {
      const c = w.condition[layer];
      for (let t = 0; t < c.length; t++) if (c[t]! > 0) c[t] = 300;
    }
    for (const b of sim.state.buildings) b.condition = 3;
    return sim;
  }

  it('failures, crews and repairs are deterministic', () => {
    const a = wornTown();
    const b = wornTown();
    a.step(2 * MINUTES_PER_DAY);
    b.step(2 * MINUTES_PER_DAY);
    expect(a.state.assets.kpi.incidents).toBeGreaterThan(2);
    expect(a.state.assets.kpi.repairs).toBeGreaterThan(0);
    expect(a.hash()).toBe(b.hash());
  });

  it('a save made mid-repair round-trips and continues identically', () => {
    const sim = wornTown();
    sim.step(600);
    expect(sim.state.incidents.length).toBeGreaterThan(0);
    const body = JSON.parse(JSON.stringify(serializeState(sim.state)));
    const loaded = new Simulation(deserializeState(body));
    expect(hashState(loaded.state)).toBe(sim.hash());
    expect(Array.from(loaded.state.cache.faults.tile)).toEqual(
      Array.from(sim.state.cache.faults.tile),
    );
    sim.step(900);
    loaded.step(900);
    expect(loaded.hash()).toBe(sim.hash());
  });
});
