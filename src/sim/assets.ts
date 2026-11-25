/**
 * The asset model: which class an asset belongs to, its condition and age,
 * the failure curve and the "customers" counted by incidents. Pure helpers
 * shared by the decay sweep (decay.ts), incidents (incidents.ts), commands and
 * the UI. Tile assets (roads, mains, lines) keep condition in hundredths of a
 * point in `world.condition`; facilities keep it on their Building record.
 */
import { ASSETS, buildingDef, facilityAssetClass, tileAssetClass } from './data';
import type { AnyFacilityDef, FacilityAssetClass, GrownBuildingDef, TileAssetClass } from './data';
import type { AssetRef, Building, SimState } from './state';
import { DAYS_PER_YEAR, dayOf } from './time';
import type { CrewType, TileAssetLayer, WeatherEventId } from './types';
import { assetCodeLayer } from './world';
import type { WorldState } from './world';

/** Condition is stored ×100 in the tile layers. */
export const CONDITION_SCALE = 100;
export const FULL_CONDITION = 100 * CONDITION_SCALE;

/** Bits in `cache.faults.tile` (derived from incidents and on-site work; see incidents.ts). */
export const FAULT = {
  /** Road closed for an excavation or resurfacing. */
  ROAD_CLOSED: 1,
  /** Burst main: leaks and passes no water on. */
  BURST: 2,
  /** Main isolated (valves shut): no water enters the tile. */
  MAIN_OFF: 4,
  /** Line tile out of the power network. */
  LINE_OFF: 8,
} as const;

export const assetKey = (ref: AssetRef): string => `${ref.layer}:${ref.id}`;

export const tileClassAt = (
  w: WorldState,
  layer: TileAssetLayer,
  tile: number,
): TileAssetClass | undefined => tileAssetClass(layer, assetCodeLayer(w, layer)[tile]!);

/** Facility definition of a building that is a maintainable asset, or undefined. */
export function facilityAssetDef(
  b: Building,
): { def: AnyFacilityDef; cls: FacilityAssetClass } | undefined {
  const def = buildingDef(b.code);
  if (def?.role !== 'facility') return undefined;
  const cls = facilityAssetClass(def.kind);
  return cls ? { def, cls } : undefined;
}

/** The asset class behind a reference (undefined if the asset is gone). */
export function classOf(
  state: SimState,
  ref: AssetRef,
): TileAssetClass | FacilityAssetClass | undefined {
  if (ref.layer === 'facility') {
    const b = state.cache.byId.get(ref.id);
    return b ? facilityAssetDef(b)?.cls : undefined;
  }
  return tileClassAt(state.world, ref.layer, ref.id);
}

/** Condition 0..100 of an asset (0 if it no longer exists). */
export function conditionOf(state: SimState, ref: AssetRef): number {
  if (ref.layer === 'facility') return state.cache.byId.get(ref.id)?.condition ?? 0;
  return state.world.condition[ref.layer][ref.id]! / CONDITION_SCALE;
}

export function setCondition(state: SimState, ref: AssetRef, value: number): void {
  const v = Math.max(0, Math.min(100, value));
  if (ref.layer === 'facility') {
    const b = state.cache.byId.get(ref.id);
    if (b) b.condition = v;
  } else state.world.condition[ref.layer][ref.id] = Math.round(v * CONDITION_SCALE);
}

/** Age in days of an asset at the current time. */
export function ageDaysOf(state: SimState, ref: AssetRef): number {
  const laid =
    ref.layer === 'facility'
      ? (state.cache.byId.get(ref.id)?.builtDay ?? 0)
      : state.world.laid[ref.layer][ref.id]!;
  return laid === 0 ? 0 : dayOf(state.minute) - laid;
}

export const ageYears = (days: number): number => days / DAYS_PER_YEAR;

/** Mark a tile asset as newly laid (new or replaced road, main or line). */
export function layTileAsset(state: SimState, layer: TileAssetLayer, tile: number): void {
  const w = state.world;
  w.condition[layer][tile] = FULL_CONDITION;
  w.laid[layer][tile] = dayOf(state.minute);
  w.peakLoad[layer][tile] = 0;
}

/** Clear a tile asset's condition layers (asset removed). */
export function clearTileAsset(state: SimState, layer: TileAssetLayer, tile: number): void {
  const w = state.world;
  w.condition[layer][tile] = 0;
  w.laid[layer][tile] = 0;
  w.peakLoad[layer][tile] = 0;
}

/** Daily failure probability on the shared curve at a condition (0..100). */
export function curveProbability(condition: number): number {
  const c = ASSETS.failureCurve;
  if (condition >= c[0]![0]) return c[0]![1];
  for (let k = 1; k < c.length; k++) {
    const [c1, p1] = c[k]!;
    if (condition >= c1) {
      const [c0, p0] = c[k - 1]!;
      return p1 + ((p0 - p1) * (condition - c1)) / (c0 - c1);
    }
  }
  return c[c.length - 1]![1];
}

/** Daily failure probability of an asset class at a condition, in the given weather. */
export function failureProbability(
  cls: TileAssetClass | FacilityAssetClass,
  condition: number,
  weatherEvent: WeatherEventId | null,
): number {
  const w = weatherEvent ? (cls.weather?.[weatherEvent] ?? 1) : 1;
  return Math.min(1, curveProbability(condition) * cls.failureScale * w);
}

/** Condition points lost in one day at a peak load share. */
export const dailyDecay = (cls: TileAssetClass | FacilityAssetClass, load: number): number =>
  cls.decayPerDay + cls.loadDecayPerDay * Math.min(2, load) ** 2;

/** Player-facing condition band. */
export function conditionBand(c: number): string {
  if (c >= 80) return 'good';
  if (c >= 60) return 'fair';
  if (c >= 40) return 'poor';
  if (c >= 20) return 'very poor';
  return 'critical';
}

/**
 * Customers a building counts for in incidents and customer-minutes: households
 * for homes (residents / household size, at least 1), one for anything else.
 */
export function customersOf(b: Building, def: GrownBuildingDef): number {
  if (def.residents <= 0) return 1;
  return Math.max(1, Math.round((def.residents * b.occupancy) / ASSETS.householdSize));
}

/** Crew type that works on a tile asset layer. */
export const crewForLayer = (layer: TileAssetLayer): CrewType =>
  layer === 'road' ? 'roads' : layer === 'main' ? 'water' : 'power';

/** Short name of an asset for messages, e.g. "Distribution main" or "Gas power station". */
export function assetName(state: SimState, ref: AssetRef): string {
  if (ref.layer === 'facility') {
    const b = state.cache.byId.get(ref.id);
    const def = b ? buildingDef(b.code) : undefined;
    return def?.name ?? 'Facility';
  }
  return tileClassAt(state.world, ref.layer, ref.id)?.name ?? 'Asset';
}
