/**
 * Commands are the only way to change the simulation from outside. The UI
 * builds them, the sim validates and applies them, and they are logged with
 * their tick so a game can be replayed exactly.
 */
import type {
  DensityId,
  FacilityId,
  LineTypeId,
  MainTypeId,
  RoadClassId,
  TileCoord,
  ZoneId,
} from '../types';

export interface BuildRoadCommand {
  type: 'buildRoad';
  roadClass: RoadClassId;
  from: TileCoord;
  to: TileCoord;
}

export interface ZoneCommand {
  type: 'zone';
  zone: ZoneId;
  /** Ignored for zone types without density (agricultural). */
  density: DensityId;
  from: TileCoord;
  to: TileCoord;
}

export interface BulldozeCommand {
  type: 'bulldoze';
  from: TileCoord;
  to: TileCoord;
}

/** Place a power or water facility with its footprint's top-left corner at `at`. */
export interface PlaceFacilityCommand {
  type: 'placeFacility';
  facility: FacilityId;
  at: TileCoord;
}

export interface BuildLineCommand {
  type: 'buildLine';
  line: LineTypeId;
  from: TileCoord;
  to: TileCoord;
}

/** Lay (or upgrade to) a water main along an L-shaped path. */
export interface BuildMainCommand {
  type: 'buildMain';
  main: MainTypeId;
  from: TileCoord;
  to: TileCoord;
}

export type Command =
  | BuildRoadCommand
  | ZoneCommand
  | BulldozeCommand
  | PlaceFacilityCommand
  | BuildLineCommand
  | BuildMainCommand;
export type CommandType = Command['type'];

/**
 * Which state layers changed, so renderers know what to rebuild. `building`:
 * buildings added or removed; `power`: lines or facilities; `supply`: which
 * buildings have power (lights at night); `water`: mains, water facilities or
 * pressures.
 */
export type Layer = 'terrain' | 'road' | 'zone' | 'building' | 'power' | 'supply' | 'water';

/**
 * The outcome of planning a command against the current state, without changing it.
 * The UI uses plans for previews; `apply` executes exactly the same plan.
 */
export interface CommandPlan {
  ok: boolean;
  /** Player-facing reason when `ok` is false (British English). */
  reason?: string;
  /** Total cost in pounds. */
  cost: number;
  /** Tile indices that will change. */
  affected: number[];
  /** Tile indices in the drag area that cannot be used (for red preview tiles). */
  blocked: number[];
  /** Ids of buildings the command will demolish. */
  demolish: number[];
  /** Footprint tiles of those buildings (for orange preview tiles). */
  removed: number[];
  /** Layers the command touches. */
  layers: Layer[];
}

export interface CommandResult {
  ok: boolean;
  reason?: string;
  cost: number;
}
