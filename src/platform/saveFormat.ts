/**
 * The save-file envelope: format tag, version, metadata and the serialised sim
 * state. The same JSON is stored in IndexedDB and used for export/import.
 *
 * Changing the state shape? Bump CURRENT_SAVE_VERSION and add a migration from
 * the previous version to MIGRATIONS. Never edit an existing migration.
 */
import { GAME_NAME } from '../config';
import { Simulation, dayOf, deserializeState, serializeState } from '../sim';
import type { SerializedState } from '../sim';

export const SAVE_FORMAT = 'uptime-city-save';
export const CURRENT_SAVE_VERSION = 3;

export interface SaveMeta {
  gameName: string;
  label: string;
  /** ISO timestamp (real time) when the save was written. */
  savedAt: string;
  day: number;
  minute: number;
  cash: number;
  seed: number;
}

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  version: number;
  meta: SaveMeta;
  state: SerializedState;
}

/**
 * Migrations keyed by the version they upgrade FROM. Each takes a raw save of
 * version N and returns a raw save of version N + 1 (including the new version number).
 */
type RawSave = Record<string, unknown> & { version: number };
export const MIGRATIONS: Record<number, (save: RawSave) => RawSave> = {
  // v1 -> v2 (milestone 2): power layer, buildings, estates, weather, demand, rules.
  1: (save) => {
    const state = save.state as Record<string, unknown>;
    const world = state.world as Record<string, unknown>;
    const tiles = Number(world.width) * Number(world.height);
    return {
      ...save,
      version: 2,
      state: {
        ...state,
        rules: { weatherEvents: true },
        world: { ...world, power: [0, tiles] },
        buildings: [],
        nextBuildingId: 1,
        estates: [],
        nextEstateId: 1,
        weather: {
          temperatureC: 10,
          rainMmPerHour: 0,
          windMs: 5,
          cloud: 0.5,
          sunshine: 0,
          anomalyC: 0,
          wetDay: false,
          dayCloud: 0.5,
          dayWindMs: 5,
          windFrom: 5,
          windTo: 5,
          cloudFrom: 0.5,
          cloudTo: 0.5,
          event: null,
        },
        demand: { residential: 0, commercial: 0, office: 0, industrial: 0, agricultural: 0 },
        growthCursor: 0,
      },
    };
  },
  // v2 -> v3 (milestone 3): water mains (laid under existing roads), pressures,
  // building storage and dry minutes, water state.
  2: (save) => {
    const state = save.state as Record<string, unknown>;
    const world = state.world as Record<string, unknown>;
    const tiles = Number(world.width) * Number(world.height);
    const road = world.road as number[];
    const water = road.map((v, k) => (k % 2 === 0 ? (v === 0 ? 0 : 1) : v));
    return {
      ...save,
      version: 3,
      state: {
        ...state,
        world: { ...world, water, pressure: [0, tiles] },
        buildings: (state.buildings as unknown[][]).map((b) => [...b, 0, 0]),
        water: {
          cursor: -1,
          abstractedTodayMl: 0,
          farmAbstractedTodayMl: 0,
          irrigationCapped: false,
          licenceBreached: false,
          overflowing: false,
          spillMl: 0,
          supplyAlert: false,
          priorityAlert: false,
        },
      },
    };
  },
};

export function createSaveFile(sim: Simulation, label: string, now = new Date()): SaveFile {
  const s = sim.state;
  return {
    format: SAVE_FORMAT,
    version: CURRENT_SAVE_VERSION,
    meta: {
      gameName: GAME_NAME,
      label,
      savedAt: now.toISOString(),
      day: dayOf(s.minute),
      minute: s.minute,
      cash: s.cash,
      seed: s.seed,
    },
    state: serializeState(s),
  };
}

/** Run migrations until the save reaches the current version. */
export function migrateSave(
  raw: RawSave,
  migrations: Record<number, (save: RawSave) => RawSave> = MIGRATIONS,
  target = CURRENT_SAVE_VERSION,
): RawSave {
  let save = raw;
  while (save.version < target) {
    const step = migrations[save.version];
    if (!step) throw new Error(`No migration from save version ${save.version}.`);
    const next = step(save);
    if (next.version !== save.version + 1) {
      throw new Error(`Migration from version ${save.version} did not bump the version.`);
    }
    save = next;
  }
  return save;
}

/** Parse, migrate and validate a save. Throws an Error with a player-facing message. */
export function parseSaveFile(input: string | unknown): SaveFile {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      throw new Error('That file is not valid JSON.');
    }
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('That is not a save file.');
  const r = raw as Record<string, unknown>;
  if (r.format !== SAVE_FORMAT) throw new Error(`That is not a ${GAME_NAME} save file.`);
  if (typeof r.version !== 'number' || !Number.isInteger(r.version) || r.version < 1) {
    throw new Error('The save file has no valid version.');
  }
  if (r.version > CURRENT_SAVE_VERSION) {
    throw new Error('This save was made by a newer version of the game.');
  }
  const migrated = migrateSave(r as RawSave) as unknown as SaveFile;
  // Validate the body by decoding it; throws on corrupt data.
  deserializeState(migrated.state);
  return migrated;
}

/** Build a running simulation from a parsed save. */
export function simulationFromSave(save: SaveFile): Simulation {
  return new Simulation(deserializeState(save.state));
}
