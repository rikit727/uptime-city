import { describe, expect, it } from 'vitest';
import { emptyTripTable, trafficCellsAcross } from '../../src/sim/state';
import type { SimState, TripTable } from '../../src/sim/state';
import { refreshTrafficTimes } from '../../src/sim/traffic';
import { buildTrafficGraph, trafficGraphFor, weighTrafficGraph } from '../../src/sim/trafficGraph';
import type { TrafficGraph } from '../../src/sim/trafficGraph';
import { at, testSim } from './helpers';
import type { Simulation } from '../../src/sim/simulation';

const ok = (r: { ok: boolean; reason?: string }) => {
  if (!r.ok) throw new Error(r.reason);
};

const road = (sim: Simulation, x0: number, y0: number, x1: number, y1: number, cls = 'local') =>
  ok(
    sim.dispatch({
      type: 'buildRoad',
      roadClass: cls as 'local',
      from: { x: x0, y: y0 },
      to: { x: x1, y: y1 },
    }),
  );

/**
 * A grid of avenues and locals with a dead-end spur, a ring road with no junction
 * (its own island), a corner and an isolated tile.
 */
function roadsTown(): Simulation {
  const sim = testSim();
  road(sim, 5, 10, 40, 10, 'avenue');
  road(sim, 5, 20, 40, 20);
  road(sim, 5, 11, 5, 19);
  road(sim, 20, 11, 20, 19, 'avenue');
  road(sim, 40, 11, 40, 19);
  road(sim, 30, 21, 30, 28); // dead end
  road(sim, 40, 21, 40, 26); // corner into a bend
  road(sim, 41, 26, 46, 26);
  // A ring with no junction.
  road(sim, 10, 40, 16, 40);
  road(sim, 16, 41, 16, 46);
  road(sim, 15, 46, 10, 46);
  road(sim, 10, 45, 10, 41);
  road(sim, 50, 50, 50, 50); // isolated
  return sim;
}

function tableWith(state: SimState, loads: number[]): TripTable {
  const w = state.world;
  const table = emptyTripTable(trafficCellsAcross(w.width) * trafficCellsAcross(w.height));
  loads.forEach((t, k) => (table.load[k] = t));
  return table;
}

/** Plain tile-by-tile Dijkstra (entering a tile costs its time): the reference. */
function tileCosts(state: SimState, start: number): Float64Array {
  const w = state.world;
  const time = state.cache.traffic.timeSec;
  const cost = new Float64Array(w.road.length).fill(Infinity);
  const done = new Uint8Array(w.road.length);
  cost[start] = 0;
  for (;;) {
    let u = -1;
    for (let t = 0; t < cost.length; t++)
      if (!done[t] && cost[t]! < Infinity && (u < 0 || cost[t]! < cost[u]!)) u = t;
    if (u < 0) break;
    done[u] = 1;
    const x = u % w.width;
    for (const m of [x > 0 ? u - 1 : -1, x < w.width - 1 ? u + 1 : -1, u - w.width, u + w.width]) {
      if (m < 0 || m >= cost.length || w.road[m] === 0 || time[m] === Infinity) continue;
      if (cost[u]! + time[m]! < cost[m]!) cost[m] = cost[u]! + time[m]!;
    }
  }
  return cost;
}

/** Node-level Dijkstra on the graph from a node. */
function graphCosts(g: TrafficGraph, start: number): Float64Array {
  const n = g.nodeTile.length;
  const cost = new Float64Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  cost[start] = 0;
  for (;;) {
    let u = -1;
    for (let k = 0; k < n; k++)
      if (!done[k] && cost[k]! < Infinity && (u < 0 || cost[k]! < cost[u]!)) u = k;
    if (u < 0) break;
    done[u] = 1;
    for (let s = g.adjStart[u]!; s < g.adjStart[u + 1]!; s++) {
      const e = g.adjEdge[s]!;
      const forward = g.edgeA[e] === u;
      const m = forward ? g.edgeB[e]! : g.edgeA[e]!;
      const c = forward ? g.costAB[e]! : g.costBA[e]!;
      if (cost[u]! + c < cost[m]!) cost[m] = cost[u]! + c;
    }
  }
  return cost;
}

describe('junction-level traffic graph', () => {
  it('covers every road tile exactly once, as a node or inside one edge', () => {
    const sim = roadsTown();
    const s = sim.state;
    const load = at(sim, 12, 20); // mid-run: becomes a node
    const g = buildTrafficGraph(s, tableWith(s, [load]));
    const seen = new Uint8Array(s.world.road.length);
    for (const t of g.nodeTile) seen[t]!++;
    for (const t of g.edgeTiles) seen[t]!++;
    for (let t = 0; t < seen.length; t++) expect(seen[t]).toBe(s.world.road[t] !== 0 ? 1 : 0);
    expect(g.nodeOf[load]).toBeGreaterThanOrEqual(0);
    // Junctions, dead ends and the isolated tile are nodes; plain runs are not.
    for (const [x, y] of [
      [20, 10],
      [30, 28],
      [50, 50],
      [46, 26],
    ])
      expect(g.nodeOf[at(sim, x!, y!)]).toBeGreaterThanOrEqual(0);
    expect(g.nodeOf[at(sim, 25, 10)]).toBe(-1);
    // The ring has one node (its lowest tile) and one edge back to itself.
    const ringNode = g.nodeOf[at(sim, 10, 40)]!;
    expect(ringNode).toBeGreaterThanOrEqual(0);
    const loops = [...g.edgeA.keys()].filter((e) => g.edgeA[e] === ringNode);
    expect(loops.length).toBe(1);
    expect(g.edgeB[loops[0]!]).toBe(ringNode);
  });

  it('gives the same shortest travel times as a tile-by-tile search, closures included', () => {
    const sim = roadsTown();
    const s = sim.state;
    // Congest some tiles so costs are uneven.
    for (let x = 6; x < 20; x++) s.world.traffic[at(sim, x, 10)] = 2500;
    refreshTrafficTimes(s);
    // Searches start at a load tile (always a node): here a corner.
    const start = at(sim, 5, 10);
    const g = buildTrafficGraph(s, tableWith(s, [start, at(sim, 12, 20), at(sim, 30, 25)]));
    weighTrafficGraph(s, g);
    const check = () => {
      const ref = tileCosts(s, start);
      const got = graphCosts(g, g.nodeOf[start]!);
      for (let k = 0; k < g.nodeTile.length; k++) {
        const r = ref[g.nodeTile[k]!]!;
        if (r === Infinity) expect(got[k]).toBe(Infinity);
        else expect(got[k]).toBeCloseTo(r, 6);
      }
    };
    check();
    // Close a tile in the middle of a run: its edge becomes impassable both ways.
    const closed = at(sim, 25, 20);
    s.cache.traffic.timeSec[closed] = Infinity;
    weighTrafficGraph(s, g);
    const e = [...g.edgeA.keys()].find((k) =>
      g.edgeTiles.subarray(g.edgeStart[k]!, g.edgeStart[k + 1]!).includes(closed),
    )!;
    expect(g.costAB[e]).toBe(Infinity);
    expect(g.costBA[e]).toBe(Infinity);
    check();
    // A closed junction cannot be entered either.
    s.cache.traffic.timeSec[at(sim, 20, 20)] = Infinity;
    weighTrafficGraph(s, g);
    check();
  });

  it('is rebuilt for a new trip table and re-weighted when travel times change', () => {
    const sim = roadsTown();
    const s = sim.state;
    const t1 = tableWith(s, [at(sim, 12, 20)]);
    const g1 = trafficGraphFor(s, t1);
    expect(trafficGraphFor(s, t1)).toBe(g1);
    const t2 = tableWith(s, [at(sim, 25, 20)]);
    const g2 = trafficGraphFor(s, t2);
    expect(g2).not.toBe(g1);
    expect(g2.nodeOf[at(sim, 25, 20)]).toBeGreaterThanOrEqual(0);
    const before = g2.weightsVersion;
    refreshTrafficTimes(s);
    expect(trafficGraphFor(s, t2).weightsVersion).toBeGreaterThan(before);
    // A road change drops the graph (rebuildTraffic).
    road(sim, 25, 21, 25, 24);
    expect(s.cache.traffic.graph).toBeNull();
  });
});
