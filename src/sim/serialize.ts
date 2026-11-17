/**
 * Converts SimState to and from plain JSON-safe data. Per-tile layers are
 * run-length encoded ([value, count, value, count, ...]) which keeps saves of a
 * mostly empty 128x128 map to a few kilobytes. Save-file versioning and
 * migrations live in src/platform/saveFormat.ts; this is just the state body.
 */
import { Rng } from './rng';
import type { SimState } from './state';
import type { WorldState } from './world';

export interface SerializedWorld {
  width: number;
  height: number;
  terrain: number[];
  road: number[];
  zone: number[];
  density: number[];
}

export interface SerializedState {
  seed: number;
  tick: number;
  minute: number;
  rngState: number;
  cash: number;
  world: SerializedWorld;
}

export function rleEncode(data: Uint8Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const v = data[i]!;
    let run = 1;
    while (i + run < data.length && data[i + run] === v) run++;
    out.push(v, run);
    i += run;
  }
  return out;
}

export function rleDecode(rle: readonly number[], length: number): Uint8Array {
  if (rle.length % 2 !== 0) throw new Error('Corrupt tile data (odd RLE length).');
  const out = new Uint8Array(length);
  let pos = 0;
  for (let k = 0; k < rle.length; k += 2) {
    const v = rle[k]!;
    const run = rle[k + 1]!;
    if (!Number.isInteger(v) || v < 0 || v > 255 || !Number.isInteger(run) || run < 1) {
      throw new Error('Corrupt tile data (bad RLE pair).');
    }
    if (pos + run > length) throw new Error('Corrupt tile data (too long).');
    out.fill(v, pos, pos + run);
    pos += run;
  }
  if (pos !== length) throw new Error('Corrupt tile data (too short).');
  return out;
}

export function serializeState(state: SimState): SerializedState {
  const w = state.world;
  return {
    seed: state.seed,
    tick: state.tick,
    minute: state.minute,
    rngState: state.rng.state,
    cash: state.cash,
    world: {
      width: w.width,
      height: w.height,
      terrain: rleEncode(w.terrain),
      road: rleEncode(w.road),
      zone: rleEncode(w.zone),
      density: rleEncode(w.density),
    },
  };
}

function num(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Save is missing ${what}.`);
  return v;
}

function arr(v: unknown, what: string): number[] {
  if (!Array.isArray(v)) throw new Error(`Save is missing ${what}.`);
  return v as number[];
}

export function deserializeState(data: SerializedState): SimState {
  const wd = data.world;
  if (typeof wd !== 'object' || wd === null) throw new Error('Save is missing the world.');
  const width = num(wd.width, 'world width');
  const height = num(wd.height, 'world height');
  if (width < 1 || height < 1 || width > 1024 || height > 1024) {
    throw new Error('Save has an invalid map size.');
  }
  const n = width * height;
  const world: WorldState = {
    width,
    height,
    terrain: rleDecode(arr(wd.terrain, 'terrain'), n),
    road: rleDecode(arr(wd.road, 'roads'), n),
    zone: rleDecode(arr(wd.zone, 'zones'), n),
    density: rleDecode(arr(wd.density, 'densities'), n),
  };
  return {
    seed: num(data.seed, 'seed') >>> 0,
    tick: num(data.tick, 'tick'),
    minute: num(data.minute, 'time'),
    rng: new Rng(num(data.rngState, 'RNG state')),
    cash: num(data.cash, 'cash'),
    world,
  };
}
