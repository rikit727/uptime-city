/**
 * Values for the map overlays (milestone 7): one number per tile, which the
 * renderer colours from `overlays.json`. NaN = not drawn; 0..1 = a position on
 * the overlay's ramp; -(k + 1) = the overlay's category k. Water pressure and
 * traffic have their own render layers and are not computed here.
 *
 * Reads saved state and the derived caches only; changes nothing.
 */
import { FAULT } from './assets';
import { buildingDef } from './data';
import { defOf } from './buildings';
import { isEnergised } from './power';
import { landValueOfTile, pollutionAt, pollutionShare } from './pollution';
import { coverageMinutes, serviceLevel, serviceLevelAt } from './services';
import type { Building, SimState } from './state';
import { COVERAGE_KINDS, TILE_ASSET_LAYERS, Terrain } from './types';
import type { CoverageKind, OverlayId } from './types';
import { LPS_PER_MLD, waterDefOf as waterFacilityDef } from './water';

/** Category k as an overlay value. */
const cat = (k: number): number => -(k + 1);

/** Overlays this module computes (the others have their own layers). */
export type TileOverlayId = Exclude<OverlayId, 'none' | 'water' | 'traffic'>;

export const TILE_OVERLAYS: readonly TileOverlayId[] = [
  'power',
  'wastewater',
  'roadworks',
  'condition',
  ...COVERAGE_KINDS,
  'air',
  'noise',
  'landValue',
];

function paintFootprint(state: SimState, b: Building, v: number, out: Float32Array): void {
  const [fw, fd] = defOf(b).footprint;
  const w = state.world.width;
  for (let dy = 0; dy < fd; dy++)
    for (let dx = 0; dx < fw; dx++) out[(b.y + dy) * w + b.x + dx] = v;
}

/** Does a building draw power? (grown buildings, services and pumped water facilities) */
function drawsPower(b: Building): boolean {
  const def = buildingDef(b.code);
  if (!def) return false;
  if (def.role === 'grown') return true;
  return (def.utility === 'water' || def.utility === 'service') && def.powerKw > 0;
}

function powerOverlay(state: SimState, out: Float32Array): void {
  const w = state.world;
  for (let t = 0; t < out.length; t++) {
    if (w.power[t] !== 0) {
      out[t] = state.cache.faults.tile[t]! & FAULT.LINE_OFF ? cat(5) : cat(4);
    } else if (
      w.terrain[t] === Terrain.Land &&
      w.road[t] === 0 &&
      state.cache.buildingAt[t] === 0 &&
      isEnergised(state, t)
    )
      out[t] = cat(2);
  }
  for (const b of state.buildings) {
    const def = buildingDef(b.code);
    if (def?.role === 'facility' && def.utility === 'power')
      paintFootprint(state, b, state.cache.faults.offline.has(b.id) ? cat(5) : cat(3), out);
    else if (drawsPower(b))
      paintFootprint(state, b, b.unpoweredMinutes === 0 ? cat(0) : cat(1), out);
  }
}

function wastewaterOverlay(state: SimState, out: Float32Array): void {
  const L = state.cache.water;
  const share = new Map<number, number>();
  for (const net of L.sewers) {
    let cap = 0;
    let flow = 0;
    for (const b of net.works) {
      const def = waterFacilityDef(b);
      if (!def) continue;
      flow += state.cache.waterFlowLps.get(b.id) ?? 0;
      if (b.unpoweredMinutes === 0 && !state.cache.faults.offline.has(b.id))
        cap += (def.capacityMlPerDay ?? 0) * LPS_PER_MLD;
    }
    share.set(
      net.id,
      net.works.length === 0 ? cat(1) : flow > cap + 1e-6 ? cat(0) : cap > 0 ? flow / cap : cat(0),
    );
  }
  for (let t = 0; t < out.length; t++) {
    const id = L.sewerAt[t]!;
    if (id !== 0) out[t] = share.get(id) ?? Number.NaN;
  }
}

function roadworksOverlay(state: SimState, out: Float32Array): void {
  const faults = state.cache.faults.tile;
  const clashing = new Set<number>();
  for (const [id, others] of state.cache.traffic.clashes) if (others.length > 0) clashing.add(id);
  for (const p of state.permits) {
    const v = clashing.has(p.id) ? cat(4) : p.start <= state.minute ? cat(1) : cat(0);
    for (const t of p.tiles) {
      const prev = out[t]!;
      // Clashes show above everything; works under way above booked ones.
      if (Number.isNaN(prev) || v === cat(4) || (v === cat(1) && prev === cat(0))) out[t] = v;
    }
  }
  for (let t = 0; t < out.length; t++) {
    const f = faults[t]!;
    if (out[t] === cat(4)) continue;
    if (f & FAULT.ROAD_CLOSED) out[t] = cat(3);
    else if (f & FAULT.LANE_CLOSED) out[t] = cat(2);
  }
}

function conditionOverlay(state: SimState, out: Float32Array): void {
  const w = state.world;
  const faults = state.cache.faults.tile;
  for (let t = 0; t < out.length; t++) {
    let worst = Infinity;
    for (const layer of TILE_ASSET_LAYERS) {
      if (w.laid[layer][t] === 0) continue;
      worst = Math.min(worst, w.condition[layer][t]! / 10000);
    }
    if (worst === Infinity) continue;
    out[t] = faults[t]! & (FAULT.BURST | FAULT.LINE_OFF | FAULT.MAIN_OFF) ? cat(0) : worst;
  }
  for (const b of state.buildings) {
    const def = buildingDef(b.code);
    if (def?.role !== 'facility' || def.utility === 'service') continue;
    if (def.utility === 'depot') continue;
    paintFootprint(
      state,
      b,
      state.cache.faults.offline.has(b.id) ? cat(0) : b.condition / 100,
      out,
    );
  }
}

function coverageOverlay(state: SimState, kind: CoverageKind, out: Float32Array): void {
  const w = state.world;
  for (let t = 0; t < out.length; t++) {
    if (w.road[t] === 0) continue;
    out[t] = Number.isFinite(coverageMinutes(state, kind, t))
      ? serviceLevelAt(state, kind, t)
      : cat(0);
  }
  for (const b of state.buildings) {
    if (buildingDef(b.code)?.role !== 'grown') continue;
    const lvl = serviceLevel(state, b, kind);
    paintFootprint(state, b, lvl > 0 ? lvl : cat(0), out);
  }
}

/**
 * Fill `out` (one value per tile) for an overlay. Returns false for overlays
 * that are drawn by their own layer (water, traffic).
 */
export function overlayValues(state: SimState, id: OverlayId, out: Float32Array): boolean {
  out.fill(Number.NaN);
  const w = state.world;
  switch (id) {
    case 'none':
    case 'water':
    case 'traffic':
      return false;
    case 'power':
      powerOverlay(state, out);
      return true;
    case 'wastewater':
      wastewaterOverlay(state, out);
      return true;
    case 'roadworks':
      roadworksOverlay(state, out);
      return true;
    case 'condition':
      conditionOverlay(state, out);
      return true;
    case 'air':
    case 'noise':
      for (let t = 0; t < out.length; t++)
        if (w.terrain[t] === Terrain.Land) out[t] = pollutionShare(id, pollutionAt(state, id, t));
      return true;
    case 'landValue':
      for (let t = 0; t < out.length; t++)
        if (w.terrain[t] === Terrain.Land) out[t] = landValueOfTile(state, t);
      return true;
    default:
      coverageOverlay(state, id, out);
      return true;
  }
}
