/**
 * Industrial estates: each group of industrial-zoned tiles that touch (side by
 * side, or across a single road or power-line tile, so an estate keeps its
 * internal roads) is one named estate, tracked as a unit for power load now and HGV traffic and
 * pollution later. Names persist through reshaping: a recomputed group keeps
 * the name of the oldest estate whose anchor tile it still contains.
 * rebuildEstates() is idempotent, so it is safe to call after load.
 */
import { GROWTH, zoneType } from './data';
import { residentsOf, jobsOf } from './buildings';
import { seedState } from './rng';
import type { Building, Estate, SimState } from './state';

const STEPS: readonly [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/** RNG-free name stream so estate names do not consume the sim RNG. */
const NAME_STREAM = 7;

function estateName(state: SimState, id: number, taken: Set<string>): string {
  const { names, suffixes } = GROWTH.estates;
  const h = seedState(state.seed, NAME_STREAM);
  const base = `${names[(h + id * 7) % names.length]!} ${suffixes[((h >>> 8) + id) % suffixes.length]!}`;
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
  return name;
}

export function rebuildEstates(state: SimState): void {
  const w = state.world;
  const n = w.width * w.height;
  const ind = zoneType('industrial').code;
  const at = state.cache.estateAt;
  at.fill(0);
  const comp = new Int32Array(n);
  const groups: number[][] = [];
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (w.zone[i] !== ind || comp[i] !== 0) continue;
    const k = groups.length + 1;
    const tiles: number[] = [];
    comp[i] = k;
    stack.push(i);
    while (stack.length > 0) {
      const t = stack.pop()!;
      tiles.push(t);
      const x = t % w.width;
      const y = (t - x) / w.width;
      for (const [dx, dy] of STEPS) {
        const x1 = x + dx;
        const y1 = y + dy;
        if (x1 < 0 || y1 < 0 || x1 >= w.width || y1 >= w.height) continue;
        let nb = y1 * w.width + x1;
        if (w.zone[nb] !== ind) {
          // Hop over one road or line tile to the plot on the other side.
          const x2 = x1 + dx;
          const y2 = y1 + dy;
          const link = w.road[nb] !== 0 || w.power[nb] !== 0;
          if (!link || x2 < 0 || y2 < 0 || x2 >= w.width || y2 >= w.height) continue;
          nb = y2 * w.width + x2;
          if (w.zone[nb] !== ind) continue;
        }
        if (comp[nb] !== 0) continue;
        comp[nb] = k;
        stack.push(nb);
      }
    }
    // tiles[0] is i, the group's lowest index: any lower industrial tile would have claimed it.
    groups.push(tiles);
  }

  const old = [...state.estates].sort((a, b) => a.id - b.id);
  const used = new Set<number>();
  const next: Estate[] = [];
  const taken = new Set<string>();
  const pending: { k: number; anchor: number }[] = [];
  groups.forEach((tiles, idx) => {
    const k = idx + 1;
    const keep = old.find((e) => !used.has(e.id) && comp[e.anchor] === k);
    if (keep) {
      used.add(keep.id);
      next.push(keep);
      taken.add(keep.name);
      for (const t of tiles) at[t] = keep.id;
    } else {
      pending.push({ k, anchor: tiles[0]! });
    }
  });
  // New estates are named after kept ones so a new name never clashes with an existing one.
  for (const p of pending) {
    const id = state.nextEstateId++;
    const name = estateName(state, id, taken);
    taken.add(name);
    next.push({ id, name, anchor: p.anchor });
    for (const t of groups[p.k - 1]!) at[t] = id;
  }
  state.estates = next.sort((a, b) => a.id - b.id);
}

export interface EstateStats {
  tiles: number;
  buildings: number;
  jobs: number;
  residents: number;
  loadKw: number;
}

export interface EstateSource {
  readonly world: { readonly width: number };
  readonly buildings: readonly Building[];
  readonly estateAt: Int32Array;
  readonly loadKw: ReadonlyMap<number, number>;
}

/**
 * Aggregate figures for one estate (buildings are counted by their top-left
 * tile). Takes plain data so the UI can call it with a snapshot.
 */
export function estateStats(src: EstateSource, estateId: number): EstateStats {
  const at = src.estateAt;
  const out: EstateStats = { tiles: 0, buildings: 0, jobs: 0, residents: 0, loadKw: 0 };
  for (let i = 0; i < at.length; i++) if (at[i] === estateId) out.tiles++;
  for (const b of src.buildings) {
    if (at[b.y * src.world.width + b.x] !== estateId) continue;
    out.buildings++;
    out.jobs += jobsOf(b);
    out.residents += residentsOf(b);
    out.loadKw += src.loadKw.get(b.id) ?? 0;
  }
  return out;
}
