import { describe, expect, it } from 'vitest';
import { addBuilding } from '../../src/sim/buildings';
import { TRAFFIC, roadClass } from '../../src/sim/data';
import { planRoute } from '../../src/sim/routing';
import { deserializeState, serializeState } from '../../src/sim/serialize';
import { Simulation } from '../../src/sim/simulation';
import {
  bprFactor,
  buildCellTable,
  freeFlowSeconds,
  refreshTrafficTimes,
  tickTraffic,
} from '../../src/sim/traffic';
import { hourOf } from '../../src/sim/time';
import { at, testSim } from './helpers';

const ok = (r: { ok: boolean; reason?: string }) => {
  if (!r.ok) throw new Error(r.reason);
};

/**
 * Homes at the west end of an avenue along y = 20 (x 5..50) and offices at the
 * east end, with a local-road bypass via y = 30 (x 12..43).
 */
function trafficTown(sim: Simulation, bypass = true): void {
  ok(
    sim.dispatch({
      type: 'buildRoad',
      roadClass: 'avenue',
      from: { x: 5, y: 20 },
      to: { x: 50, y: 20 },
    }),
  );
  if (bypass) {
    ok(
      sim.dispatch({
        type: 'buildRoad',
        roadClass: 'local',
        from: { x: 12, y: 21 },
        to: { x: 12, y: 30 },
      }),
    );
    ok(
      sim.dispatch({
        type: 'buildRoad',
        roadClass: 'local',
        from: { x: 13, y: 30 },
        to: { x: 43, y: 30 },
      }),
    );
    ok(
      sim.dispatch({
        type: 'buildRoad',
        roadClass: 'local',
        from: { x: 43, y: 29 },
        to: { x: 43, y: 21 },
      }),
    );
  }
  const s = sim.state;
  for (let x = 5; x <= 11; x++) {
    addBuilding(s, 4, x, 19, 1); // flats
    addBuilding(s, 4, x, 21, 1);
  }
  for (let x = 44; x <= 49; x++) {
    addBuilding(s, 42, x, 19, 1); // office blocks
    addBuilding(s, 42, x, 21, 1);
  }
}

/**
 * A grid of local roads (rows every 4 tiles from y = 10 to 50, columns at
 * x = 5, 25 and 45) with homes west of x = 25 and workplaces east of it on
 * every tile beside a road.
 */
function gridTown(sim: Simulation, home: number, work: number): void {
  for (let y = 10; y <= 50; y += 4) {
    ok(
      sim.dispatch({ type: 'buildRoad', roadClass: 'local', from: { x: 5, y }, to: { x: 45, y } }),
    );
  }
  for (const x of [5, 25, 45]) {
    ok(
      sim.dispatch({ type: 'buildRoad', roadClass: 'local', from: { x, y: 10 }, to: { x, y: 50 } }),
    );
  }
  const s = sim.state;
  const w = s.world;
  for (let y = 11; y < 50; y++) {
    if ((y - 10) % 4 === 0 || (y - 10) % 4 === 2) continue;
    for (let x = 6; x < 45; x++) {
      if (x === 25 || w.road[at(sim, x, y)] !== 0) continue;
      addBuilding(s, x < 25 ? home : work, x, y, 1);
    }
  }
}

/** Step until the clock reaches an hour of the day, then until a round finishes. */
function runToHour(sim: Simulation, hour: number): void {
  for (let k = 0; k < 2000 && hourOf(sim.state.minute) !== hour; k++) sim.step();
  finishRound(sim);
}

function finishRound(sim: Simulation): void {
  let rounds = 0;
  for (let k = 0; k < 200 && rounds < 1; k++) {
    const before = sim.revisions.traffic;
    sim.step();
    if (sim.revisions.traffic !== before) rounds++;
  }
  expect(rounds).toBe(1);
}

describe('BPR volume/delay', () => {
  it('is 1 with no traffic, 1 + alpha at capacity, capped, and closed at zero capacity', () => {
    const { alpha, beta, maxRatio } = TRAFFIC.bpr;
    expect(bprFactor(0, 600)).toBe(1);
    expect(bprFactor(600, 600)).toBeCloseTo(1 + alpha);
    expect(bprFactor(300, 600)).toBeCloseTo(1 + alpha * 0.5 ** beta);
    expect(bprFactor(900, 600)).toBeGreaterThan(bprFactor(600, 600));
    expect(bprFactor(100000, 600)).toBeCloseTo(1 + alpha * maxRatio ** beta);
    expect(bprFactor(10, 0)).toBe(Infinity);
  });

  it('turns flows into tile travel times', () => {
    const sim = testSim();
    trafficTown(sim, false);
    const s = sim.state;
    const t = at(sim, 30, 20);
    const free = freeFlowSeconds(roadClass('avenue').speedKmh);
    expect(s.cache.traffic.timeSec[t]).toBeCloseTo(free);
    s.world.traffic[t] = 1600;
    refreshTrafficTimes(s);
    expect(s.cache.traffic.timeSec[t]).toBeCloseTo(free * (1 + TRAFFIC.bpr.alpha), 3);
    expect(s.cache.traffic.timeSec[at(sim, 30, 25)]).toBe(Infinity);
  });
});

describe('trip generation and assignment', () => {
  it('produces morning trips from homes towards jobs and loads the roads between', () => {
    const sim = testSim();
    trafficTown(sim, false);
    const s = sim.state;
    const morning = buildCellTable(s, 8);
    const night = buildCellTable(s, 3);
    const sum = (a: Float64Array) => a.reduce((x, v) => x + v, 0);
    expect(sum(morning.prod.outbound)).toBeGreaterThan(5 * sum(night.prod.outbound));
    expect(sum(morning.prod.outbound)).toBeGreaterThan(sum(morning.prod.return));
    runToHour(sim, 8);
    const w = s.world;
    expect(w.traffic[at(sim, 30, 20)]).toBeGreaterThan(0);
    expect(w.traffic[at(sim, 30, 21)]).toBe(0);
    expect(s.traffic.tripsPerHour).toBeGreaterThan(0);
    expect(s.traffic.avgTripMinutes).toBeGreaterThan(0);
    expect(s.traffic.congestion).toBeGreaterThanOrEqual(1);
    // Road wear starts to follow traffic.
    expect(w.peakLoad.road[at(sim, 30, 20)]).toBeGreaterThan(0);
    // Commute times are known for the homes' cell.
    expect(s.traffic.commute.some((v) => v > 0)).toBe(true);
  });

  it('builds up congestion when flows approach capacity', () => {
    const quiet = testSim();
    gridTown(quiet, 1, 40); // houses and small offices
    const busy = testSim();
    gridTown(busy, 6, 43); // residential towers and office towers
    for (const sim of [quiet, busy]) {
      runToHour(sim, 8);
      finishRound(sim);
    }
    expect(busy.state.traffic.tripsPerHour).toBeGreaterThan(10 * quiet.state.traffic.tripsPerHour);
    expect(quiet.state.traffic.congestion).toBeLessThan(1.02);
    expect(busy.state.traffic.congestion).toBeGreaterThan(1.2);
    expect(busy.state.traffic.avgTripMinutes).toBeGreaterThan(quiet.state.traffic.avgTripMinutes);
  });

  it('re-routes traffic around a full road closure', () => {
    const sim = testSim();
    trafficTown(sim);
    const s = sim.state;
    ok(sim.dispatch({ type: 'placeFacility', facility: 'roadsDepot', at: { x: 30, y: 21 } }));
    runToHour(sim, 8);
    const main = at(sim, 30, 20);
    const bypass = at(sim, 30, 30);
    const before = { main: s.world.traffic[main]!, bypass: s.world.traffic[bypass]! };
    expect(before.main).toBeGreaterThan(before.bypass);
    ok(
      sim.dispatch({
        type: 'raiseMaintenance',
        from: { x: 30, y: 20 },
        to: { x: 30, y: 20 },
        below: 101,
        only: 'road',
      }),
    );
    const order = s.workOrders[0]!;
    expect(order.closure).toBe('full');
    for (let k = 0; k < 200 && order.status !== 'onSite'; k++) sim.step();
    expect(order.status).toBe('onSite');
    expect(s.cache.traffic.timeSec[main]).toBe(Infinity);
    finishRound(sim);
    finishRound(sim);
    expect(s.world.traffic[main]).toBe(0);
    expect(s.world.traffic[bypass]!).toBeGreaterThan(before.bypass);
  });

  it('keeps traffic moving through a lane closure at reduced capacity', () => {
    const sim = testSim();
    trafficTown(sim);
    const s = sim.state;
    ok(sim.dispatch({ type: 'placeFacility', facility: 'roadsDepot', at: { x: 30, y: 21 } }));
    ok(
      sim.dispatch({
        type: 'raiseMaintenance',
        from: { x: 30, y: 20 },
        to: { x: 30, y: 20 },
        below: 101,
        only: 'road',
        closure: 'lane',
      }),
    );
    const order = s.workOrders[0]!;
    for (let k = 0; k < 200 && order.status !== 'onSite'; k++) sim.step();
    const t = at(sim, 30, 20);
    const avenue = roadClass('avenue');
    expect(s.cache.traffic.capacity[t]).toBeCloseTo(
      avenue.capacityVehPerHour * avenue.laneClosureCapacity,
    );
    expect(s.cache.traffic.timeSec[t]).toBeLessThan(Infinity);
    runToHour(sim, 8);
    expect(s.world.traffic[t]).toBeGreaterThan(0);
  });

  it('is deterministic, and a save made mid-round continues identically', () => {
    const make = () => {
      const sim = testSim();
      gridTown(sim, 4, 42);
      return sim;
    };
    const a = make();
    const b = make();
    a.step(150);
    b.step(150);
    expect(a.hash()).toBe(b.hash());
    // Step into the middle of a round.
    let k = 0;
    while (a.state.traffic.cursor <= 0 && k++ < 50) a.step();
    expect(a.state.traffic.cursor).toBeGreaterThan(0);
    expect(a.state.traffic.pending.some((v) => v > 0)).toBe(true);
    const loaded = new Simulation(
      deserializeState(JSON.parse(JSON.stringify(serializeState(a.state)))),
    );
    expect(loaded.hash()).toBe(a.hash());
    a.step(300);
    loaded.step(300);
    expect(loaded.hash()).toBe(a.hash());
  });

  it('spreads a round over several ticks within the search budget', () => {
    const small = testSim();
    trafficTown(small);
    const big = testSim();
    gridTown(big, 4, 42);
    const ticksFor = (sim: Simulation) => {
      const s = sim.state;
      while (s.tick % TRAFFIC.assignIntervalMinutes !== TRAFFIC.assignOffset) s.tick++;
      let n = 1;
      while (!tickTraffic(s)) n++;
      return n;
    };
    expect(ticksFor(small)).toBe(1);
    expect(ticksFor(big)).toBeGreaterThan(1);
  });
});

describe('crews and congestion', () => {
  it('slows crews on congested roads and steers them round jams', () => {
    const sim = testSim();
    trafficTown(sim);
    const s = sim.state;
    const from = at(sim, 6, 20);
    const to = at(sim, 49, 20);
    const free = planRoute(s.world, from, to, s.cache.traffic.crewSlow);
    for (let x = 14; x <= 42; x++) s.world.traffic[at(sim, x, 20)] = 3000;
    refreshTrafficTimes(s);
    const jammed = planRoute(s.world, from, to, s.cache.traffic.crewSlow);
    expect(jammed.minutes).toBeGreaterThan(free.minutes);
    // The bypass (y = 30) is now the quicker way round.
    expect(jammed.path).toContain(at(sim, 30, 30));
    expect(free.path).toContain(at(sim, 30, 20));
  });
});
