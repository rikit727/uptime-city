/**
 * Air and noise pollution, and land value.
 *
 * Pollution (hourly, saved in `state.pollution`): sources are summed per
 * coarse cell (city.json `pollution.cellSize` tiles): industry and other
 * buildings with `pollution` emissions (scaled by occupancy), gas power
 * stations in service (by rating), sewage works, road traffic by flow (and highways for
 * noise), fires (smoke) and events at landmarks (crowd noise). Each grid is
 * then spread with an exponential falloff along rows and columns, so a source
 * of strength S adds S × a^(|dx|+|dy|) cells away. Tiles read the grid with
 * bilinear sampling.
 *
 * Land value (on demand, 0..1): a base, plus public services nearby (travel
 * time and served share), landmarks in range and the river, minus air and
 * noise pollution. The layout parts are cached in `cache.services`
 * (services.ts); the rest is read from saved state, so it stays a pure
 * function of the saved state.
 */
import { CITY, SERVICES, buildingDef, customerDefOf, roadClass, serviceDefOf } from './data';
import { centreOf } from './buildings';
import type { Building, SimState } from './state';
import { pollutionCellsAcross } from './state';
import { accessOf } from './services';
import { accessTile } from './traffic';

export type PollutionKind = 'air' | 'noise';

const P = CITY.pollution;

/** Live events add crowd noise at their venue. */
function liveEventNoise(state: SimState): Map<number, number> {
  const m = new Map<number, number>();
  for (const e of state.events) {
    if (e.status !== 'live') continue;
    const def = serviceDefOf(state.cache.byId.get(e.venue)?.code ?? 0);
    if (def?.landmark) m.set(e.venue, (m.get(e.venue) ?? 0) + def.landmark.eventNoise);
  }
  return m;
}

/** Spread one grid in place: exponential falloff along rows, then columns. */
function spread(grid: Float64Array, cx: number, cy: number, tiles: number): void {
  const a = Math.exp(-P.cellSize / Math.max(0.1, tiles));
  const line = (start: number, step: number, len: number) => {
    const fwd = new Float64Array(len);
    let acc = 0;
    for (let i = 0; i < len; i++) {
      acc = grid[start + i * step]! + a * acc;
      fwd[i] = acc;
    }
    acc = 0;
    for (let i = len - 1; i >= 0; i--) {
      const x = grid[start + i * step]!;
      acc = x + a * acc;
      grid[start + i * step] = fwd[i]! + acc - x;
    }
  };
  for (let y = 0; y < cy; y++) line(y * cx, 1, cx);
  for (let x = 0; x < cx; x++) line(x, cx, cy);
}

/** Recompute both pollution grids from the current city. */
export function updatePollution(state: SimState): void {
  const w = state.world;
  const cs = P.cellSize;
  const cx = pollutionCellsAcross(w.width, cs);
  const cy = pollutionCellsAcross(w.height, cs);
  const air = new Float64Array(cx * cy);
  const noise = new Float64Array(cx * cy);
  const cellAt = (x: number, y: number) =>
    Math.min(cy - 1, Math.floor(y / cs)) * cx + Math.min(cx - 1, Math.floor(x / cs));
  const events = liveEventNoise(state);
  for (const b of state.buildings) {
    const def = buildingDef(b.code);
    if (!def) continue;
    const c = centreOf(b);
    const cell = cellAt(Math.round(c.x), Math.round(c.y));
    let a = 0;
    let n = 0;
    if (def.role === 'grown') {
      if (def.pollution) {
        a = def.pollution.air * b.occupancy;
        n = def.pollution.noise * b.occupancy;
      }
    } else if (def.utility === 'service') {
      if (def.pollution) {
        a = def.pollution.air;
        n = def.pollution.noise;
      }
      n += events.get(b.id) ?? 0;
    } else if (def.utility === 'power' && def.kind === 'gas') {
      // Rated output while in service (dispatch figures are not saved, so not used here).
      a = state.cache.faults.offline.has(b.id) ? 0 : def.capacityMW * P.gasAirPerMW;
      n = a * 0.3;
    } else if (def.utility === 'water' && def.kind === 'sewage') {
      a = P.sewageAir;
    }
    air[cell] = air[cell]! + a;
    noise[cell] = noise[cell]! + n;
  }
  const highway = roadClass('highway').code;
  for (let t = 0; t < w.road.length; t++) {
    if (w.road[t] === 0) continue;
    const flow = w.traffic[t]!;
    const x = t % w.width;
    const cell = cellAt(x, (t - x) / w.width);
    air[cell] = air[cell]! + flow * P.traffic.airPerPcu;
    noise[cell] =
      noise[cell]! + flow * P.traffic.noisePerPcu + (w.road[t] === highway ? P.highwayNoise : 0);
  }
  for (const f of state.fires) {
    const x = f.tile % w.width;
    const cell = cellAt(x, (f.tile - x) / w.width);
    air[cell] = air[cell]! + f.intensity * SERVICES.fire.smokeAir;
  }
  spread(air, cx, cy, P.spreadTiles.air);
  spread(noise, cx, cy, P.spreadTiles.noise);
  const q = (v: number) => Math.min(65535, Math.round(v * 10));
  for (let k = 0; k < air.length; k++) {
    state.pollution.air[k] = q(air[k]!);
    state.pollution.noise[k] = q(noise[k]!);
  }
}

/** Pollution index at a tile (bilinear from the coarse grid). */
export function pollutionAt(state: SimState, kind: PollutionKind, tile: number): number {
  const w = state.world;
  const cs = P.cellSize;
  const cx = pollutionCellsAcross(w.width, cs);
  const cy = pollutionCellsAcross(w.height, cs);
  const grid = state.pollution[kind];
  const x = tile % w.width;
  const y = (tile - x) / w.width;
  const gx = Math.max(0, Math.min(cx - 1, (x + 0.5) / cs - 0.5));
  const gy = Math.max(0, Math.min(cy - 1, (y + 0.5) / cs - 0.5));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(cx - 1, x0 + 1);
  const y1 = Math.min(cy - 1, y0 + 1);
  const fx = gx - x0;
  const fy = gy - y0;
  const v = (xx: number, yy: number) => grid[yy * cx + xx]! / 10;
  return (
    (v(x0, y0) * (1 - fx) + v(x1, y0) * fx) * (1 - fy) +
    (v(x0, y1) * (1 - fx) + v(x1, y1) * fx) * fy
  );
}

/** 0 when clean, rising to 1 at the "bad" threshold. */
export function pollutionShare(kind: PollutionKind, value: number): number {
  const t = P.thresholds[kind];
  return Math.max(0, Math.min(1, (value - t.quiet) / (t.bad - t.quiet)));
}

/**
 * Land value 0..1 at a tile, served from road tile `road` (-1 = none): the base,
 * public services reachable from that road, the river and landmarks nearby
 * (cached per tile), less air and noise pollution.
 */
export function landValueAt(state: SimState, tile: number, road: number): number {
  const L = CITY.landValue;
  const sc = state.cache.services;
  let v = L.base + (sc.landStatic[tile] ?? 0);
  if (road >= 0) v += L.services * (sc.roadServices[road] ?? 0);
  v -= L.airPenalty * pollutionShare('air', pollutionAt(state, 'air', tile));
  v -= L.noisePenalty * pollutionShare('noise', pollutionAt(state, 'noise', tile));
  return Math.max(0, Math.min(1, v));
}

/** Land value under a building (at its footprint centre, served from its access road). */
export function landValueOf(state: SimState, b: Building): number {
  const c = centreOf(b);
  const tile = Math.round(c.y) * state.world.width + Math.round(c.x);
  return landValueAt(state, tile, accessOf(state, b));
}

/** Land value of an empty tile (for growth), served from the first road beside it. */
export function landValueOfTile(state: SimState, tile: number): number {
  const w = state.world;
  const x = tile % w.width;
  const road = accessTile(w, x, (tile - x) / w.width, 1, 1);
  return landValueAt(state, tile, road);
}

/** Growth multiplier from land value (city.json `landValue.growthMin` .. `growthMax`). */
export function landValueGrowth(lv: number): number {
  const L = CITY.landValue;
  return L.growthMin + (L.growthMax - L.growthMin) * lv;
}

/** A building's own pollution at the tile under it (for the inspector). */
export function emissionsOf(b: Building): { air: number; noise: number } | undefined {
  const def = customerDefOf(b.code);
  return def?.pollution;
}
