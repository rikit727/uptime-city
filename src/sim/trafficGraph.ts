/**
 * The junction-level road graph used by traffic assignment (milestone 8).
 *
 * Searching tile by tile settles every road tile once per origin; on a fully
 * built map that is ~3,500 heap operations per origin and most of the sim's
 * time. Most road tiles sit in plain runs between junctions, so the graph keeps
 * only the tiles where a route can branch or end as **nodes**: junctions (3+
 * road neighbours), dead ends and isolated tiles, every cell's load tile in the
 * round's trip table, and one tile on any loop with no junction. The runs
 * between nodes become **edges** that list their interior tiles in order.
 *
 * Edge costs follow the tile search exactly: entering a tile costs its travel
 * time, so crossing an edge from A to B costs the interior tiles' times plus
 * B's. A closed tile (time Infinity) makes its edge impassable. The graph is
 * derived (never saved): built from the road layout and the round's table on
 * first use, and re-weighted when travel times change (`timesVersion`).
 */
import type { SimState, TripTable } from './state';

export interface TrafficGraph {
  /** The trip table whose load tiles are nodes (identity). */
  table: TripTable;
  /** `TrafficCache.timesVersion` the weights were computed for. */
  weightsVersion: number;
  /** Tile -> node index (-1 = not a node). */
  nodeOf: Int32Array;
  /** Node -> tile (nodes are numbered in tile order). */
  nodeTile: Int32Array;
  /** Adjacency (CSR): node k's edge slots are adjStart[k]..adjStart[k+1]-1. */
  adjStart: Int32Array;
  /** Edge slot -> edge id. */
  adjEdge: Int32Array;
  /** Edge ends (node indices); interior tiles run from A to B. */
  edgeA: Int32Array;
  edgeB: Int32Array;
  /** Edge interior tiles: edgeTiles[edgeStart[e] .. edgeStart[e+1]-1], ordered A -> B. */
  edgeStart: Int32Array;
  edgeTiles: Int32Array;
  /** Cost to cross an edge towards B / towards A, seconds (Infinity = closed). */
  costAB: Float64Array;
  costBA: Float64Array;
  /** Free-flow seconds to cross an edge towards B / towards A. */
  freeAB: Float64Array;
  freeBA: Float64Array;
}

/** Road neighbours of a tile into `out` (left, right, up, down); returns how many. */
function roadNeighbours(road: Uint8Array, width: number, t: number, out: Int32Array): number {
  const n = road.length;
  const x = t % width;
  let k = 0;
  if (x > 0 && road[t - 1] !== 0) out[k++] = t - 1;
  if (x < width - 1 && road[t + 1] !== 0) out[k++] = t + 1;
  if (t >= width && road[t - width] !== 0) out[k++] = t - width;
  if (t + width < n && road[t + width] !== 0) out[k++] = t + width;
  return k;
}

/** Build the graph for the current road layout and a trip table's load tiles. */
export function buildTrafficGraph(state: SimState, table: TripTable): TrafficGraph {
  const w = state.world;
  const road = w.road;
  const width = w.width;
  const n = road.length;
  const nodeOf = new Int32Array(n).fill(-1);
  const isNode = new Uint8Array(n);
  const nb = new Int32Array(4);
  for (let t = 0; t < n; t++) {
    if (road[t] !== 0 && roadNeighbours(road, width, t, nb) !== 2) isNode[t] = 1;
  }
  for (const t of table.load) if (t >= 0 && road[t] !== 0) isNode[t] = 1;

  // Walk runs out of every node; tiles left over are loops with no node.
  const visited = new Uint8Array(n);
  const eA: number[] = [];
  const eB: number[] = [];
  const eStart: number[] = [0];
  const eTiles: number[] = [];
  const nb2 = new Int32Array(4);
  const walkFrom = (a: number): void => {
    const k = roadNeighbours(road, width, a, nb);
    const firsts = Array.from(nb.subarray(0, k));
    for (const first of firsts) {
      const run: number[] = [];
      let prev = a;
      let cur = first;
      while (isNode[cur] === 0) {
        run.push(cur);
        visited[cur] = 1;
        roadNeighbours(road, width, cur, nb2);
        const next = nb2[0] === prev ? nb2[1]! : nb2[0]!;
        prev = cur;
        cur = next;
      }
      const b = cur;
      const last = run.length > 0 ? run[run.length - 1]! : a;
      // Each run is found from both ends: keep it once.
      if (a < b || (a === b && first < last)) {
        eA.push(a);
        eB.push(b);
        for (const t of run) eTiles.push(t);
        eStart.push(eTiles.length);
      }
    }
  };
  for (let t = 0; t < n; t++) if (isNode[t] !== 0) walkFrom(t);
  for (let t = 0; t < n; t++) {
    if (road[t] === 0 || isNode[t] !== 0 || visited[t] !== 0) continue;
    isNode[t] = 1; // a loop with no junction: its lowest tile becomes a node
    walkFrom(t);
  }

  // Number the nodes in tile order and translate edge ends.
  const tiles: number[] = [];
  for (let t = 0; t < n; t++) {
    if (isNode[t] !== 0) {
      nodeOf[t] = tiles.length;
      tiles.push(t);
    }
  }
  const nodes = tiles.length;
  const edges = eA.length;
  const edgeA = new Int32Array(edges);
  const edgeB = new Int32Array(edges);
  const degree = new Int32Array(nodes + 1);
  for (let e = 0; e < edges; e++) {
    edgeA[e] = nodeOf[eA[e]!]!;
    edgeB[e] = nodeOf[eB[e]!]!;
    degree[edgeA[e]!]!++;
    if (edgeB[e] !== edgeA[e]) degree[edgeB[e]!]!++;
  }
  const adjStart = new Int32Array(nodes + 1);
  for (let k = 0; k < nodes; k++) adjStart[k + 1] = adjStart[k]! + degree[k]!;
  const fill = adjStart.slice(0, nodes);
  const adjEdge = new Int32Array(adjStart[nodes]!);
  for (let e = 0; e < edges; e++) {
    adjEdge[fill[edgeA[e]!]!++] = e;
    if (edgeB[e] !== edgeA[e]) adjEdge[fill[edgeB[e]!]!++] = e;
  }
  const graph: TrafficGraph = {
    table,
    weightsVersion: -1,
    nodeOf,
    nodeTile: Int32Array.from(tiles),
    adjStart,
    adjEdge,
    edgeA,
    edgeB,
    edgeStart: Int32Array.from(eStart),
    edgeTiles: Int32Array.from(eTiles),
    costAB: new Float64Array(edges),
    costBA: new Float64Array(edges),
    freeAB: new Float64Array(edges),
    freeBA: new Float64Array(edges),
  };
  return graph;
}

/** Recompute edge costs from the current travel times. */
export function weighTrafficGraph(state: SimState, g: TrafficGraph): void {
  const tc = state.cache.traffic;
  const time = tc.timeSec;
  const freeSec = tc.freeSec;
  const { edgeA, edgeB, edgeStart, edgeTiles, nodeTile, costAB, costBA, freeAB, freeBA } = g;
  for (let e = 0; e < edgeA.length; e++) {
    let c = 0;
    let f = 0;
    for (let i = edgeStart[e]!; i < edgeStart[e + 1]!; i++) {
      const t = edgeTiles[i]!;
      c += time[t]!;
      f += freeSec[t]!;
    }
    const ta = nodeTile[edgeA[e]!]!;
    const tb = nodeTile[edgeB[e]!]!;
    costAB[e] = c + time[tb]!;
    costBA[e] = c + time[ta]!;
    freeAB[e] = f + freeSec[tb]!;
    freeBA[e] = f + freeSec[ta]!;
  }
  g.weightsVersion = tc.timesVersion;
}

/** The graph for the round's table, built or re-weighted as needed. */
export function trafficGraphFor(state: SimState, table: TripTable): TrafficGraph {
  const tc = state.cache.traffic;
  let g = tc.graph;
  if (!g || g.table !== table) {
    g = buildTrafficGraph(state, table);
    tc.graph = g;
  }
  if (g.weightsVersion !== tc.timesVersion) weighTrafficGraph(state, g);
  return g;
}
