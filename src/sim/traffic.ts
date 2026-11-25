/**
 * Road traffic: trip generation per traffic cell, congestion-aware assignment
 * and the derived travel times that crews and the renderer use.
 *
 * - **Cells.** The map is split into `traffic.json: cellSize`² tile cells. Each
 *   building loads onto the first road beside its footprint; a cell's trips
 *   start and end at the access road tile carrying most of its activity.
 * - **Trips** (per hour, PCU): outbound from homes towards jobs and shops;
 *   return trips from jobs and shops back to homes (balanced against the
 *   city's outbound total); freight (HGVs) from industry and shops; slow farm
 *   traffic. Each purpose has its own hourly curve (morning and evening peaks).
 *   Destinations are chosen by a gravity model over congested travel time.
 * - **Assignment.** Every `assignIntervalMinutes` a round starts and fixes its
 *   trip table (saved in `traffic.table`). Each tick
 *   processes origin cells in index order (up to `nodesPerTick` road tiles
 *   settled): one shortest-path tree by current travel time, trips sent down
 *   it, flows accumulated in `traffic.pending` (saved, so a save made
 *   mid-round continues identically). When the last cell is done the new flows
 *   are blended into `world.traffic` and the travel times are refreshed.
 * - **Travel time** per road tile follows the BPR curve
 *   `t0 × (1 + α (v/c)^β)`. Full closures are impassable; lane closures cut
 *   capacity (roads.json `laneClosureCapacity`). Crews pay the same delay
 *   (capped) but pass closures.
 * - Each round writes flow / capacity into `world.peakLoad.road`, so busy roads
 *   wear faster (decay.ts).
 */
import { FAULT } from './assets';
import { GAME, TRAFFIC, TRIP_PURPOSES, buildingDef, roadClassByCode } from './data';
import type { TripPurpose } from './data';
import { eventTrips } from './cityEvents';
import { rebuildClashes } from './roadworks';
import { emptyTripTable, trafficCellsAcross } from './state';
import type { SimState, TripTable } from './state';
import { hourOf } from './time';
import type { WorldState } from './world';

/** `traffic.pending` holds flows in 1/PENDING_SCALE PCU/h so it stays integer. */
export const PENDING_SCALE = 16;

/** Free-flow seconds to cross one tile at a speed. */
export const freeFlowSeconds = (speedKmh: number): number =>
  (GAME.metresPerTile / 1000 / speedKmh) * 3600;

/** BPR travel-time multiplier for a flow and capacity (Infinity when capacity is 0). */
export function bprFactor(flow: number, capacity: number): number {
  if (capacity <= 0) return Infinity;
  const { alpha, beta, maxRatio } = TRAFFIC.bpr;
  const r = Math.min(maxRatio, Math.max(0, flow) / capacity);
  return 1 + alpha * r ** beta;
}

// ---- derived cache ------------------------------------------------------------

const neighbours = (w: WorldState, t: number, out: number[]): number[] => {
  const x = t % w.width;
  out[0] = x > 0 ? t - 1 : -1;
  out[1] = x < w.width - 1 ? t + 1 : -1;
  out[2] = t >= w.width ? t - w.width : -1;
  out[3] = t + w.width < w.width * w.height ? t + w.width : -1;
  return out;
};

/** Number of road tiles 4-adjacent to a tile. */
export function roadDegree(w: WorldState, t: number): number {
  let d = 0;
  for (const m of neighbours(w, t, [0, 0, 0, 0])) if (m >= 0 && w.road[m] !== 0) d++;
  return d;
}

/**
 * Road segments: runs of road between junctions (3+ road neighbours). A
 * junction tile is a segment of its own. Ids follow the lowest tile index.
 */
export function rebuildSegments(state: SimState): void {
  const w = state.world;
  const seg = state.cache.traffic.segmentAt;
  seg.fill(0);
  const nb = [0, 0, 0, 0];
  let next = 1;
  const stack: number[] = [];
  for (let t = 0; t < seg.length; t++) {
    if (w.road[t] === 0 || seg[t] !== 0) continue;
    const id = next++;
    seg[t] = id;
    if (roadDegree(w, t) >= 3) continue;
    stack.push(t);
    while (stack.length > 0) {
      const c = stack.pop()!;
      for (const m of neighbours(w, c, nb)) {
        if (m < 0 || w.road[m] === 0 || seg[m] !== 0 || roadDegree(w, m) >= 3) continue;
        seg[m] = id;
        stack.push(m);
      }
    }
  }
}

/** Recompute capacities and travel times from the saved flows and the current closures. */
export function refreshTrafficTimes(state: SimState): void {
  const w = state.world;
  const tc = state.cache.traffic;
  const faults = state.cache.faults.tile;
  const maxSlow = TRAFFIC.crews.maxSlowdown;
  for (let t = 0; t < w.road.length; t++) {
    const cls = w.road[t] !== 0 ? roadClassByCode(w.road[t]!) : undefined;
    if (!cls) {
      tc.timeSec[t] = Infinity;
      tc.freeSec[t] = 0;
      tc.capacity[t] = 0;
      tc.crewSlow[t] = 1;
      continue;
    }
    const free = freeFlowSeconds(cls.speedKmh);
    const f = faults[t]!;
    let cap = cls.capacityVehPerHour;
    if (f & FAULT.ROAD_CLOSED) cap = 0;
    else if (f & FAULT.LANE_CLOSED) cap *= cls.laneClosureCapacity;
    const flow = w.traffic[t]!;
    tc.freeSec[t] = free;
    tc.capacity[t] = cap;
    tc.timeSec[t] = free * bprFactor(flow, cap);
    // Crews get through closures (their own works) but sit in the same queues.
    const slow = cap > 0 ? bprFactor(flow, cap) : bprFactor(flow, cls.capacityVehPerHour);
    tc.crewSlow[t] = Math.min(maxSlow, slow);
  }
}

/** Rebuild everything derived for traffic: segments, travel times and permit clashes. */
export function rebuildTraffic(state: SimState): void {
  state.cache.traffic.access.clear();
  rebuildSegments(state);
  refreshTrafficTimes(state);
  rebuildClashes(state);
}

// ---- trip generation ------------------------------------------------------------

export const cellOfTile = (w: WorldState, tile: number): number => {
  const cs = TRAFFIC.cellSize;
  const x = tile % w.width;
  const y = (tile - x) / w.width;
  return Math.floor(y / cs) * trafficCellsAcross(w.width) + Math.floor(x / cs);
};

/** First road tile in the ring around a footprint (row by row), or -1. */
export function accessTile(w: WorldState, x: number, y: number, fw: number, fd: number): number {
  for (let yy = Math.max(0, y - 1); yy <= Math.min(w.height - 1, y + fd); yy++) {
    for (let xx = Math.max(0, x - 1); xx <= Math.min(w.width - 1, x + fw); xx++) {
      if (xx >= x && xx < x + fw && yy >= y && yy < y + fd) continue;
      const t = yy * w.width + xx;
      if (w.road[t] !== 0) return t;
    }
  }
  return -1;
}

/** Trips per hour produced and attracted by each cell at `hour`. */
export function buildCellTable(state: SimState, hour: number): TripTable {
  const w = state.world;
  const cellsX = trafficCellsAcross(w.width);
  const cells = cellsX * trafficCellsAcross(w.height);
  const cs = TRAFFIC.cellSize;
  const homes = new Float64Array(cells);
  const jobs = new Float64Array(cells);
  const shopJobs = new Float64Array(cells);
  const industryJobs = new Float64Array(cells);
  const farms = new Float64Array(cells);
  const access = state.cache.traffic.access;
  const load = new Int32Array(cells).fill(-1);
  const best = new Float64Array(cells);
  const weightAt = new Map<number, number>();
  for (const b of state.buildings) {
    const def = buildingDef(b.code);
    if (!def) continue;
    let res = 0;
    let j = def.jobs;
    let farm = 0;
    let zone = '';
    if (def.role === 'grown') {
      res = Math.round(def.residents * b.occupancy);
      j = Math.round(def.jobs * b.occupancy);
      zone = def.zone;
      if (zone === 'agricultural') farm = b.occupancy;
    } else if (def.utility === 'service' && def.zone === 'commercial') zone = 'commercial';
    if (res + j + farm <= 0) continue;
    let t = access.get(b.id);
    if (t === undefined) {
      t = accessTile(w, b.x, b.y, def.footprint[0], def.footprint[1]);
      access.set(b.id, t);
    }
    if (t < 0) continue;
    const x = t % w.width;
    const c = Math.floor((t - x) / w.width / cs) * cellsX + Math.floor(x / cs);
    homes[c] = homes[c]! + res;
    jobs[c] = jobs[c]! + j;
    if (zone === 'commercial') shopJobs[c] = shopJobs[c]! + j;
    else if (zone === 'industrial') industryJobs[c] = industryJobs[c]! + j;
    farms[c] = farms[c]! + farm;
    const wt = (weightAt.get(t) ?? 0) + res + j + farm;
    weightAt.set(t, wt);
    // The cell loads at its busiest access tile (ties: lower tile).
    if (wt > best[c]! || (wt === best[c]! && t < load[c]!)) {
      best[c] = wt;
      load[c] = t;
    }
  }
  const tr = TRAFFIC.trips;
  const share = (p: TripPurpose) => TRAFFIC.curves[p][hour] ?? 0;
  const table = emptyTripTable(cells);
  table.load.set(load);
  const { prod, attr } = table;
  let residents = 0;
  let attraction = 0;
  for (let c = 0; c < cells; c++) {
    residents += homes[c]!;
    attr.outbound[c] = jobs[c]! + shopJobs[c]! * tr.visitsPerCommercialJob;
    attraction += attr.outbound[c]!;
  }
  for (let c = 0; c < cells; c++) {
    if (load[c]! < 0) continue;
    prod.outbound[c] = homes[c]! * tr.outboundPerResident * share('outbound');
    prod.return[c] =
      attraction > 0
        ? (residents * tr.outboundPerResident * share('return') * attr.outbound[c]!) / attraction
        : 0;
    attr.return[c] = homes[c]!;
    prod.freight[c] =
      (industryJobs[c]! * tr.freightPerIndustrialJob + shopJobs[c]! * tr.freightPerCommercialJob) *
      TRAFFIC.pcu.hgv *
      share('freight');
    attr.freight[c] = attr.outbound[c]!;
    prod.farm[c] = farms[c]! * tr.farmTripsPerFarm * TRAFFIC.pcu.farm * share('farm');
    attr.farm[c] = attr.outbound[c]!;
  }
  // Crowds to and from events: from homes to the venue before, back home after.
  for (const ev of eventTrips(state, hour)) {
    const v = state.cache.byId.get(ev.venue);
    const vdef = v ? buildingDef(v.code) : undefined;
    if (!v || !vdef) continue;
    let t = access.get(v.id);
    if (t === undefined) {
      t = accessTile(w, v.x, v.y, vdef.footprint[0], vdef.footprint[1]);
      access.set(v.id, t);
    }
    if (t < 0) continue;
    const vc = cellOfTile(w, t);
    if (load[vc]! < 0) table.load[vc] = t;
    attr.eventIn[vc] = attr.eventIn[vc]! + ev.in;
    prod.eventOut[vc] = prod.eventOut[vc]! + ev.out;
    for (let c = 0; c < cells; c++) {
      if (residents <= 0 || homes[c]! <= 0 || table.load[c]! < 0) continue;
      prod.eventIn[c] = prod.eventIn[c]! + (ev.in * homes[c]!) / residents;
      if (ev.out > 0) attr.eventOut[c] = homes[c]!;
    }
  }
  const r2 = (v: number) => Math.round(v * 100) / 100;
  for (const p of TRIP_PURPOSES) {
    for (let c = 0; c < cells; c++) {
      prod[p][c] = r2(prod[p][c]!);
      attr[p][c] = r2(attr[p][c]!);
    }
  }
  return table;
}

// ---- assignment -------------------------------------------------------------------

/**
 * Allocation-free binary min-heap of (cost, tile) on typed arrays; ties pop the
 * lower tile first, so searches are deterministic.
 */
class TileHeap {
  private c = new Float64Array(1024);
  private t = new Int32Array(1024);
  size = 0;
  /** Cost of the tile returned by the last pop(). */
  cost = 0;
  clear(): void {
    this.size = 0;
  }
  push(cost: number, tile: number): void {
    if (this.size === this.c.length) {
      const c = new Float64Array(this.size * 2);
      const t = new Int32Array(this.size * 2);
      c.set(this.c);
      t.set(this.t);
      this.c = c;
      this.t = t;
    }
    const { c, t } = this;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const cp = c[p]!;
      if (cp < cost || (cp === cost && t[p]! < tile)) break;
      c[i] = cp;
      t[i] = t[p]!;
      i = p;
    }
    c[i] = cost;
    t[i] = tile;
  }
  pop(): number {
    const { c, t } = this;
    const top = t[0]!;
    this.cost = c[0]!;
    const len = --this.size;
    if (len > 0) {
      const lc = c[len]!;
      const lt = t[len]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= len) break;
        const r = l + 1;
        let k = l;
        if (r < len && (c[r]! < c[l]! || (c[r] === c[l] && t[r]! < t[l]!))) k = r;
        const ck = c[k]!;
        if (ck > lc || (ck === lc && t[k]! > lt)) break;
        c[i] = ck;
        t[i] = t[k]!;
        i = k;
      }
      c[i] = lc;
      t[i] = lt;
    }
    return top;
  }
}

/** Reusable search buffers (not state: fully reinitialised per search via stamps). */
interface Scratch {
  n: number;
  stamp: number;
  seen: Int32Array;
  done: Int32Array;
  cost: Float64Array;
  free: Float64Array;
  flow: Float64Array;
  prev: Int32Array;
  order: Int32Array;
  heap: TileHeap;
}
let scratch: Scratch | null = null;

function scratchFor(n: number): Scratch {
  if (!scratch || scratch.n !== n) {
    scratch = {
      n,
      stamp: 0,
      seen: new Int32Array(n),
      done: new Int32Array(n),
      cost: new Float64Array(n),
      free: new Float64Array(n),
      flow: new Float64Array(n),
      prev: new Int32Array(n),
      order: new Int32Array(n),
      heap: new TileHeap(),
    };
  }
  return scratch;
}

/**
 * Shortest-path tree by current travel time from a road tile. Returns how many
 * tiles were settled; `order` lists them in settle order.
 */
function searchFrom(state: SimState, start: number, s: Scratch): number {
  const width = state.world.width;
  const n = s.n;
  const time = state.cache.traffic.timeSec;
  const freeSec = state.cache.traffic.freeSec;
  s.stamp++;
  if (s.stamp >= 0x7fffffff) {
    s.seen.fill(0);
    s.done.fill(0);
    s.stamp = 1;
  }
  const stamp = s.stamp;
  const { seen, done, cost, free, prev, order, heap, flow } = s;
  heap.clear();
  seen[start] = stamp;
  cost[start] = 0;
  free[start] = 0;
  prev[start] = -1;
  heap.push(0, start);
  let settled = 0;
  // Non-road and closed tiles have an infinite time, so they are never entered.
  const relax = (t: number, c: number, m: number) => {
    const tm = time[m]!;
    if (tm === Infinity) return;
    const cand = c + tm;
    if (seen[m] !== stamp || cand < cost[m]!) {
      seen[m] = stamp;
      cost[m] = cand;
      free[m] = free[t]! + freeSec[m]!;
      prev[m] = t;
      heap.push(cand, m);
    }
  };
  while (heap.size > 0) {
    const t = heap.pop();
    const c = heap.cost;
    if (done[t] === stamp || c > cost[t]!) continue;
    done[t] = stamp;
    flow[t] = 0;
    order[settled++] = t;
    const x = t % width;
    if (x > 0) relax(t, c, t - 1);
    if (x < width - 1) relax(t, c, t + 1);
    if (t >= width) relax(t, c, t - width);
    if (t + width < n) relax(t, c, t + width);
  }
  return settled;
}

/** Assign one origin cell's trips. Returns the number of road tiles settled. */
export function assignOrigin(state: SimState, origin: number): number {
  const ts = state.traffic;
  const table = ts.table;
  const cells = table.load.length;
  const startTile = table.load[origin]!;
  let total = 0;
  for (const p of TRIP_PURPOSES) total += table.prod[p][origin]!;
  if (startTile < 0 || total <= 0) return 0;
  if (state.cache.traffic.timeSec[startTile] === Infinity) {
    ts.roundUnserved += total;
    return 0;
  }
  const s = scratchFor(state.world.width * state.world.height);
  const settled = searchFrom(state, startTile, s);
  const { done, cost, free, flow, prev, order, stamp } = s;
  const tau = TRAFFIC.deterrenceMinutes;
  // Gravity weights over reachable destination cells.
  const reach = new Float64Array(cells);
  const sums: Record<TripPurpose, number> = {
    outbound: 0,
    return: 0,
    freight: 0,
    farm: 0,
    eventIn: 0,
    eventOut: 0,
  };
  for (let j = 0; j < cells; j++) {
    const d = table.load[j]!;
    if (j === origin || d < 0 || done[d] !== stamp) continue;
    const f = Math.exp(-cost[d]! / 60 / tau);
    reach[j] = f;
    for (const p of TRIP_PURPOSES) sums[p] += table.attr[p][j]! * f;
  }
  let trips = 0;
  let minutes = 0;
  let freeMinutes = 0;
  let commuteTrips = 0;
  let commuteMinutes = 0;
  for (const p of TRIP_PURPOSES) {
    if (table.prod[p][origin]! > 0 && sums[p] <= 0) ts.roundUnserved += table.prod[p][origin]!;
  }
  for (let j = 0; j < cells; j++) {
    const f = reach[j]!;
    if (f <= 0) continue;
    const d = table.load[j]!;
    let t = 0;
    for (const p of TRIP_PURPOSES) {
      const P = table.prod[p][origin]!;
      if (P <= 0 || sums[p] <= 0) continue;
      const v = (P * table.attr[p][j]! * f) / sums[p];
      t += v;
      if (p === 'outbound') {
        commuteTrips += v;
        commuteMinutes += (v * cost[d]!) / 60;
      }
    }
    if (t <= 0) continue;
    flow[d] = flow[d]! + t;
    trips += t;
    minutes += (t * cost[d]!) / 60;
    freeMinutes += (t * free[d]!) / 60;
  }
  // Push flows back up the tree to the origin.
  for (let k = settled - 1; k > 0; k--) {
    const t = order[k]!;
    const v = flow[t]!;
    if (v > 0) flow[prev[t]!] = flow[prev[t]!]! + v;
  }
  const pending = ts.pending;
  for (let k = 0; k < settled; k++) {
    const t = order[k]!;
    const v = Math.round(flow[t]! * PENDING_SCALE);
    if (v > 0) pending[t] = Math.min(0xffffffff, pending[t]! + v);
  }
  ts.roundTrips += trips;
  ts.roundTripMinutes += minutes;
  ts.roundFreeMinutes += freeMinutes;
  if (commuteTrips > 0) {
    ts.commute[origin] = Math.min(65535, Math.round((10 * commuteMinutes) / commuteTrips));
  } else if (table.prod.outbound[origin]! <= 0 && table.attr.return[origin]! <= 0) {
    ts.commute[origin] = 0;
  }
  return settled;
}

/** End of a round: blend the new flows in, record road loading and the city figures. */
export function finishAssignment(state: SimState): void {
  const w = state.world;
  const ts = state.traffic;
  const tc = state.cache.traffic;
  const blend = TRAFFIC.blend;
  for (let t = 0; t < w.road.length; t++) {
    const cls = w.road[t] !== 0 ? roadClassByCode(w.road[t]!) : undefined;
    if (!cls || tc.capacity[t] === 0) {
      w.traffic[t] = 0;
    } else {
      const fresh = ts.pending[t]! / PENDING_SCALE;
      const old = w.traffic[t]!;
      w.traffic[t] = Math.min(65535, Math.round(old + blend * (fresh - old)));
      const load = Math.min(255, Math.round((100 * w.traffic[t]!) / cls.capacityVehPerHour));
      if (load > w.peakLoad.road[t]!) w.peakLoad.road[t] = load;
    }
  }
  ts.pending.fill(0);
  ts.tripsPerHour = ts.roundTrips;
  ts.avgTripMinutes = ts.roundTrips > 0 ? ts.roundTripMinutes / ts.roundTrips : 0;
  ts.congestion = ts.roundFreeMinutes > 0 ? ts.roundTripMinutes / ts.roundFreeMinutes : 1;
  ts.unservedPerHour = ts.roundUnserved;
  ts.roundTrips = 0;
  ts.roundTripMinutes = 0;
  ts.roundFreeMinutes = 0;
  ts.roundUnserved = 0;
  ts.cursor = -1;
  refreshTrafficTimes(state);
}

/**
 * One tick of traffic assignment. Starts a round on schedule, then processes
 * origin cells until the tick's search budget is spent. Returns true when a
 * round finished (flows changed).
 */
export function tickTraffic(state: SimState): boolean {
  const ts = state.traffic;
  if (ts.cursor < 0) {
    if (state.tick % TRAFFIC.assignIntervalMinutes !== TRAFFIC.assignOffset) return false;
    ts.cursor = 0;
    ts.table = buildCellTable(state, hourOf(state.minute));
    ts.pending.fill(0);
    ts.roundTrips = 0;
    ts.roundTripMinutes = 0;
    ts.roundFreeMinutes = 0;
    ts.roundUnserved = 0;
  }
  const cells = ts.table.load.length;
  let budget = TRAFFIC.nodesPerTick;
  let origins = 0;
  while (ts.cursor < cells && (origins === 0 || budget > 0)) {
    const settled = assignOrigin(state, ts.cursor);
    ts.cursor++;
    if (settled > 0) {
      origins++;
      budget -= settled;
    }
  }
  if (ts.cursor >= cells) {
    finishAssignment(state);
    return true;
  }
  return false;
}

/**
 * Growth multiplier from a tile's commute time (1 when commutes are short or
 * not yet known, falling to `commute.minFactor` at `badMinutes`).
 */
export function commuteFactor(state: SimState, tile: number): number {
  const m = (state.traffic.commute[cellOfTile(state.world, tile)] ?? 0) / 10;
  const c = TRAFFIC.commute;
  if (m <= c.goodMinutes) return 1;
  if (m >= c.badMinutes) return c.minFactor;
  return 1 - ((1 - c.minFactor) * (m - c.goodMinutes)) / (c.badMinutes - c.goodMinutes);
}

/** Volume / capacity ratio of a road tile now (closed roads report Infinity). */
export function vcRatio(world: WorldState, capacity: ArrayLike<number>, tile: number): number {
  const cap = capacity[tile] ?? 0;
  if (world.road[tile] === 0) return 0;
  return cap > 0 ? world.traffic[tile]! / cap : Infinity;
}
