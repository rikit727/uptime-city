/**
 * Commands are the only way to change the simulation from outside. The UI
 * builds them, the sim validates and applies them, and they are logged with
 * their tick so a game can be replayed exactly.
 */
import type { DensityId, RoadClassId, TileCoord, ZoneId } from '../types';

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

export type Command = BuildRoadCommand | ZoneCommand | BulldozeCommand;
export type CommandType = Command['type'];

/** Which state layers a command changes, so renderers know what to rebuild. */
export type Layer = 'terrain' | 'road' | 'zone';

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
  /** Layers the command touches. */
  layers: Layer[];
}

export interface CommandResult {
  ok: boolean;
  reason?: string;
  cost: number;
}
