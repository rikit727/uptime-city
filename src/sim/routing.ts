/**
 * Crew routing on the road network: fastest route by road speed (Dijkstra over
 * road tiles), with short off-road legs at each end where the depot or the site
 * is not on a road, or a straight cross-country leg when no road route exists.
 * Congestion joins the edge cost in M5. Positions along a route (for the
 * renderer and for diverting a crew mid-journey) are interpolated by time.
 */
import { ASSETS, GAME, roadClassByCode } from './data';
import type { WorldState } from './world';

export interface Route {
  /** Tiles from start to end; consecutive tiles that are not 4-adjacent are an off-road leg. */
  path: number[];
  /** Driving time, minutes. */
  minutes: number;
}

const SECONDS_PER_KMH = (GAME.metresPerTile / 1000) * 3600;

/** Seconds to drive across one tile of road with this code. */
function roadSeconds(code: number): number {
  const speed = roadClassByCode(code)?.speedKmh ?? ASSETS.crews.offRoadKmh;
  return SECONDS_PER_KMH / speed;
}

/** Per-tile travel-time multipliers for road tiles (1 = free flow). */
export type SlowFactors = ArrayLike<number>;

/**
 * Minutes from tile a to tile b: along the road if they are adjacent road tiles
 * (× the congestion multiplier of b, if given), else off-road.
 */
export function legMinutes(w: WorldState, a: number, b: number, slow?: SlowFactors): number {
  const ax = a % w.width;
  const ay = (a - ax) / w.width;
  const bx = b % w.width;
  const by = (b - bx) / w.width;
  const d = Math.hypot(ax - bx, ay - by);
  if (d === 1 && w.road[a] !== 0 && w.road[b] !== 0) {
    return (roadSeconds(w.road[b]!) * (slow ? (slow[b] ?? 1) : 1)) / 60;
  }
  return (d * SECONDS_PER_KMH) / ASSETS.crews.offRoadKmh / 60;
}

/** The road tile nearest to `tile` within `radius` (Chebyshev), or -1. Ties go to the lower index. */
export function nearestRoad(w: WorldState, tile: number, radius: number): number {
  if (w.road[tile] !== 0) return tile;
  const x = tile % w.width;
  const y = (tile - x) / w.width;
  let best = -1;
  let bestD = Infinity;
  for (let yy = Math.max(0, y - radius); yy <= Math.min(w.height - 1, y + radius); yy++) {
    for (let xx = Math.max(0, x - radius); xx <= Math.min(w.width - 1, x + radius); xx++) {
      const t = yy * w.width + xx;
      if (w.road[t] === 0) continue;
      const d = Math.hypot(xx - x, yy - y);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
  }
  return best;
}

/** Binary min-heap of (cost, tile); ties pop the lower tile first. */
export class MinHeap {
  private c: number[] = [];
  private t: number[] = [];
  get size(): number {
    return this.c.length;
  }
  clear(): void {
    this.c.length = 0;
    this.t.length = 0;
  }
  private less(ca: number, ta: number, cb: number, tb: number): boolean {
    return ca < cb || (ca === cb && ta < tb);
  }
  push(cost: number, tile: number): void {
    const { c, t } = this;
    let i = c.length;
    c.push(cost);
    t.push(tile);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(cost, tile, c[p]!, t[p]!)) break;
      c[i] = c[p]!;
      t[i] = t[p]!;
      i = p;
    }
    c[i] = cost;
    t[i] = tile;
  }
  /** Pop the cheapest; returns [cost, tile]. */
  pop(): [number, number] {
    const { c, t } = this;
    const top: [number, number] = [c[0]!, t[0]!];
    const lc = c.pop()!;
    const lt = t.pop()!;
    const len = c.length;
    if (len > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= len) break;
        const r = l + 1;
        const k = r < len && this.less(c[r]!, t[r]!, c[l]!, t[l]!) ? r : l;
        if (!this.less(c[k]!, t[k]!, lc, lt)) break;
        c[i] = c[k]!;
        t[i] = t[k]!;
        i = k;
      }
      c[i] = lc;
      t[i] = lt;
    }
    return top;
  }
}

/** Fastest road path between two road tiles, or null if they are not connected. */
function roadPath(w: WorldState, from: number, to: number, slow?: SlowFactors): number[] | null {
  if (from === to) return [from];
  const n = w.width * w.height;
  const cost = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  cost[from] = 0;
  heap.push(0, from);
  while (heap.size > 0) {
    const [c, t] = heap.pop();
    if (c > cost[t]!) continue;
    if (t === to) break;
    const x = t % w.width;
    const nb = [x > 0 ? t - 1 : -1, x < w.width - 1 ? t + 1 : -1, t - w.width, t + w.width];
    for (const m of nb) {
      if (m < 0 || m >= n || w.road[m] === 0) continue;
      const cand = c + roadSeconds(w.road[m]!) * (slow ? (slow[m] ?? 1) : 1);
      if (cand < cost[m]!) {
        cost[m] = cand;
        prev[m] = t;
        heap.push(cand, m);
      }
    }
  }
  if (prev[to] === -1) return null;
  const out: number[] = [];
  for (let t = to; t !== -1; t = prev[t]!) out.push(t);
  return out.reverse();
}

/** Plan a crew's drive from one tile to another, optionally slowed by congestion. */
export function planRoute(w: WorldState, from: number, to: number, slow?: SlowFactors): Route {
  const r = ASSETS.crews.roadSearchRadius;
  const a = nearestRoad(w, from, r);
  const b = nearestRoad(w, to, r);
  let path: number[] = [from, to];
  if (from === to) path = [from];
  else if (a >= 0 && b >= 0) {
    const road = roadPath(w, a, b, slow);
    if (road) {
      path = road;
      if (a !== from) path.unshift(from);
      if (b !== to) path.push(to);
    }
  }
  let minutes = 0;
  for (let k = 1; k < path.length; k++) minutes += legMinutes(w, path[k - 1]!, path[k]!, slow);
  return { path, minutes };
}

/**
 * Where along `path` a vehicle is at `minute`, travelling from `depart` to
 * `arrive`: fractional tile coordinates of the tile centre line, plus the index
 * of the path tile it has reached.
 */
export function positionAlong(
  w: WorldState,
  path: readonly number[],
  depart: number,
  arrive: number,
  minute: number,
): { x: number; y: number; index: number } {
  const xy = (t: number) => ({ x: (t % w.width) + 0.5, y: Math.floor(t / w.width) + 0.5 });
  if (path.length === 0) return { x: 0, y: 0, index: 0 };
  if (minute <= depart || path.length === 1) return { ...xy(path[0]!), index: 0 };
  if (minute >= arrive) return { ...xy(path[path.length - 1]!), index: path.length - 1 };
  const legs: number[] = [];
  let total = 0;
  for (let k = 1; k < path.length; k++) {
    const m = legMinutes(w, path[k - 1]!, path[k]!);
    legs.push(m);
    total += m;
  }
  let target = ((minute - depart) / (arrive - depart)) * total;
  for (let k = 0; k < legs.length; k++) {
    const m = legs[k]!;
    if (target <= m || k === legs.length - 1) {
      const f = m > 0 ? Math.min(1, target / m) : 1;
      const p = xy(path[k]!);
      const q = xy(path[k + 1]!);
      return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, index: f >= 1 ? k + 1 : k };
    }
    target -= m;
  }
  return { ...xy(path[path.length - 1]!), index: path.length - 1 };
}
