/**
 * The daily asset sweep. A cursor walks the map so every tile is visited once
 * per game day (a slice of tiles per tick). At each tile, every asset there
 * (road, main, line, and a facility whose footprint starts there) loses
 * condition by its class's base rate plus load wear (from the peak load since
 * the last visit, which is then reset), and rolls for failure against the
 * failure curve with `state.rng`. Assets with an open incident or crew on site
 * do not roll.
 */
import {
  FULL_CONDITION,
  CONDITION_SCALE,
  dailyDecay,
  facilityAssetDef,
  failureProbability,
  tileClassAt,
} from './assets';
import type { SimEvent } from './events';
import { decayFactor } from './ledger';
import { incidentOnAsset, openIncident, orderOnAsset } from './incidents';
import type { AssetRef, SimState } from './state';
import { MINUTES_PER_DAY } from './time';
import { TILE_ASSET_LAYERS } from './types';

/** Tiles visited per tick so the whole map is swept once a day. */
export const sweepTilesPerTick = (state: SimState): number =>
  Math.ceil((state.world.width * state.world.height) / MINUTES_PER_DAY);

/** May this asset fail now? Not while it already has an incident or a crew working on it. */
function canFail(state: SimState, ref: AssetRef): boolean {
  if (incidentOnAsset(state, ref)) return false;
  return orderOnAsset(state, ref)?.status !== 'onSite';
}

/** Age one tile's assets by a day. Returns true if anything failed. */
export function visitTile(state: SimState, t: number, emit: (e: SimEvent) => void): boolean {
  const w = state.world;
  const event = state.weather.event?.id ?? null;
  let failed = false;
  for (const layer of TILE_ASSET_LAYERS) {
    const cls = tileClassAt(w, layer, t);
    if (!cls) continue;
    const load = w.peakLoad[layer][t]! / 100;
    w.peakLoad[layer][t] = 0;
    const loss = Math.round(dailyDecay(cls, load) * decayFactor(state, cls.crew) * CONDITION_SCALE);
    const cond = Math.max(0, Math.min(FULL_CONDITION, w.condition[layer][t]! - loss));
    w.condition[layer][t] = cond;
    const ref: AssetRef = { layer, id: t };
    if (!canFail(state, ref)) continue;
    if (state.rng.next() < failureProbability(cls, cond / CONDITION_SCALE, event)) {
      openIncident(state, cls.failure, ref, t, emit);
      failed = true;
    }
  }
  const id = state.cache.buildingAt[t] ?? 0;
  const b = id !== 0 ? state.cache.byId.get(id) : undefined;
  if (b && b.y * w.width + b.x === t) {
    const fa = facilityAssetDef(b);
    if (fa) {
      const loss = dailyDecay(fa.cls, b.peakLoad) * decayFactor(state, fa.cls.crew);
      b.condition = Math.max(0, b.condition - loss);
      b.peakLoad = 0;
      const ref: AssetRef = { layer: 'facility', id: b.id };
      if (
        canFail(state, ref) &&
        state.rng.next() < failureProbability(fa.cls, b.condition, event)
      ) {
        openIncident(state, 'facilityFault', ref, t, emit);
        failed = true;
      }
    }
  }
  return failed;
}

/** Sweep the next slice of tiles. Returns true if any asset failed. */
export function decaySlice(state: SimState, emit: (e: SimEvent) => void): boolean {
  const n = state.world.width * state.world.height;
  const count = sweepTilesPerTick(state);
  let failed = false;
  for (let k = 0; k < count; k++) {
    const t = state.assets.cursor;
    state.assets.cursor = (t + 1) % n;
    if (visitTile(state, t, emit)) failed = true;
  }
  return failed;
}
