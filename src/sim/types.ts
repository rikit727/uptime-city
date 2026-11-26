/** Core value types shared across the simulation. Pure data, no behaviour. */

export interface TileCoord {
  readonly x: number;
  readonly y: number;
}

/** Terrain codes stored in `WorldState.terrain`. */
export const Terrain = {
  Land: 0,
  Water: 1,
} as const;
export type TerrainCode = (typeof Terrain)[keyof typeof Terrain];

/** Road class ids. Numeric codes live in src/data/roads.json (`code`), 0 = no road. */
export type RoadClassId = 'local' | 'avenue' | 'highway';

/** Zone type ids. Numeric codes live in src/data/zones.json (`code`), 0 = unzoned. */
export type ZoneId = 'residential' | 'commercial' | 'office' | 'industrial' | 'agricultural';

/** Zone density ids. Numeric codes live in src/data/zones.json, 0 = not applicable. */
export type DensityId = 'low' | 'medium' | 'high';

/** Season ids, in calendar order. Definitions live in src/data/weather.json. */
export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASON_ORDER: readonly SeasonId[] = ['spring', 'summer', 'autumn', 'winter'];

/** Weather event ids (src/data/weather.json `events`). */
export type WeatherEventId = 'heatwave' | 'coldSnap' | 'storm';

/** Power facility ids (src/data/power.json `facilities`). */
export type PowerFacilityId = 'gasPlant' | 'solarFarm' | 'windTurbine' | 'battery' | 'substation';
export type FacilityKind = 'gas' | 'solar' | 'wind' | 'battery' | 'substation';

/** Water and wastewater facility ids (src/data/water.json `facilities`). */
export type WaterFacilityId =
  'intake' | 'treatmentWorks' | 'serviceReservoir' | 'waterTower' | 'booster' | 'sewageWorks';
/** intake: river abstraction; treatment: clean-water works; storage: reservoir or tower. */
export type WaterFacilityKind = 'intake' | 'treatment' | 'storage' | 'booster' | 'sewage';

/** Maintenance depots (src/data/assets.json `depots`). */
export type DepotId = 'roadsDepot' | 'waterDepot' | 'powerDepot';

/** Public services and landmarks (src/data/services.json `facilities`). */
export type ServiceFacilityId =
  | 'fireStation'
  | 'policeStation'
  | 'healthCentre'
  | 'school'
  | 'wasteDepot'
  | 'recyclingCentre'
  | 'landfill'
  | 'stadium'
  | 'shoppingCentre'
  | 'hospital'
  | 'university'
  | 'conferenceCentre';
export type ServiceKind =
  'fire' | 'police' | 'health' | 'school' | 'waste' | 'recycling' | 'landfill' | 'landmark';
/** Services whose coverage is measured by road travel time. */
export type CoverageKind = 'fire' | 'police' | 'health' | 'school' | 'waste';
export const COVERAGE_KINDS: readonly CoverageKind[] = [
  'fire',
  'police',
  'health',
  'school',
  'waste',
];

/** Any player-placed facility. */
export type FacilityId = PowerFacilityId | WaterFacilityId | DepotId | ServiceFacilityId;

/** Crew types, each based at its own kind of depot (fire engines at fire stations). */
export type CrewType = 'roads' | 'water' | 'power' | 'fire';
export const CREW_TYPES: readonly CrewType[] = ['roads', 'water', 'power', 'fire'];

/** Council departments with a budget (economy.json `departments`). */
export type Department = 'roads' | 'water' | 'power' | 'services';
export const DEPARTMENTS: readonly Department[] = ['roads', 'water', 'power', 'services'];

/** Zones that pay taxes at an adjustable rate. */
export const TAX_ZONES: readonly ZoneId[] = [
  'residential',
  'commercial',
  'office',
  'industrial',
  'agricultural',
];

/** Event types at landmarks (services.json `events`). */
export type CityEventType = 'match' | 'concert' | 'conference' | 'sale' | 'graduation';

/** Preparations the player can make for an event. */
export type EventMeasure = 'policing' | 'stewarding' | 'closeRoads' | 'cleanup';
export const EVENT_MEASURES: readonly EventMeasure[] = [
  'policing',
  'stewarding',
  'closeRoads',
  'cleanup',
];

/** Emergency measures at a fire (milestone 7). */
export type FireMeasure = 'isolatePower' | 'cordon' | 'evacuate';
export const FIRE_MEASURES: readonly FireMeasure[] = ['isolatePower', 'cordon', 'evacuate'];

/** Sandbox difficulty (game.json `difficulty`). */
export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/** Map overlays (one at a time). Coverage overlays are named after their service kind. */
export type OverlayId =
  | 'none'
  | 'power'
  | 'water'
  | 'wastewater'
  | 'traffic'
  | 'condition'
  | CoverageKind
  | 'air'
  | 'noise'
  | 'landValue'
  | 'roadworks';

/** Tile assets: one per utility layer on a tile. */
export type TileAssetLayer = 'road' | 'main' | 'line';
export const TILE_ASSET_LAYERS: readonly TileAssetLayer[] = ['road', 'main', 'line'];
/** What an incident or work order is about: a tile asset (id = tile) or a facility (id = building id). */
export type AssetLayer = TileAssetLayer | 'facility';

/** Incident kinds (src/data/assets.json `incidents`). */
export type IncidentKind =
  'burst' | 'cableFault' | 'roadDefect' | 'facilityFault' | 'overflow' | 'fire';
export const INCIDENT_KINDS: readonly IncidentKind[] = [
  'burst',
  'cableFault',
  'roadDefect',
  'facilityFault',
  'overflow',
  'fire',
];

/** Water main ids (src/data/water.json `mains`). Codes live in the world's water layer. */
export type MainTypeId = 'distribution' | 'feeder' | 'trunk';

/** Power line type ids (src/data/power.json `lines`). Codes live in the world's power layer. */
export type LineTypeId = 'distribution' | 'transmission';

/** Farm field styles, used for seasonal field colours. */
export type FieldStyle = 'arable' | 'pasture' | 'glasshouse';
