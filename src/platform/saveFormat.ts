/**
 * The save-file envelope: format tag, version, metadata and the serialised sim
 * state. The same JSON is stored in IndexedDB and used for export/import.
 *
 * Changing the state shape? Bump CURRENT_SAVE_VERSION and add a migration from
 * the previous version to MIGRATIONS. Never edit an existing migration.
 */
import { GAME_NAME } from '../config';
import { ASSETS, Simulation, TRAFFIC, dayOf, deserializeState, serializeState } from '../sim';
import type { SerializedState } from '../sim';

export const SAVE_FORMAT = 'uptime-city-save';
export const CURRENT_SAVE_VERSION = 7;

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
  // v3 -> v4 (milestone 4): asset condition, age and load layers, building
  // condition/built day/peak load, incidents, work orders, crews. Existing
  // assets start at `assets.json: migrationCondition`, laid on the save's day.
  3: (save) => {
    const state = save.state as Record<string, unknown>;
    const world = state.world as Record<string, unknown>;
    const tiles = Number(world.width) * Number(world.height);
    const day = dayOf(Number(state.minute));
    const cond = Math.round(ASSETS.migrationCondition * 100);
    const remap = (rle: number[], v: number) => rle.map((x, k) => (k % 2 === 0 && x !== 0 ? v : x));
    const layers = (v: number) => ({
      road: remap(world.road as number[], v),
      main: remap(world.water as number[], v),
      line: remap(world.power as number[], v),
    });
    return {
      ...save,
      version: 4,
      state: {
        ...state,
        world: {
          ...world,
          condition: layers(cond),
          laid: layers(day),
          peakLoad: { road: [0, tiles], main: [0, tiles], line: [0, tiles] },
        },
        buildings: (state.buildings as unknown[][]).map((b) => [
          ...b,
          ASSETS.migrationCondition,
          day,
          0,
        ]),
        assets: {
          cursor: 0,
          nextIncidentId: 1,
          nextOrderId: 1,
          nextCrewId: 1,
          kpi: {
            incidents: 0,
            repairs: 0,
            repairMinutes: 0,
            slaMet: 0,
            slaMissed: 0,
            customerMinutes: 0,
            customerMinutesToday: 0,
            customerMinutesYesterday: 0,
          },
        },
        incidents: [],
        workOrders: [],
        crews: [],
      },
    };
  },
  // v4 -> v5 (milestone 5): traffic flows, the traffic round and commute times,
  // street works permits; work orders gain closure, night, permit and combined
  // fields (existing works keep closing the road fully, without a permit).
  4: (save) => {
    const state = save.state as Record<string, unknown>;
    const world = state.world as Record<string, unknown>;
    const width = Number(world.width);
    const height = Number(world.height);
    const tiles = width * height;
    const cells = Math.ceil(width / TRAFFIC.cellSize) * Math.ceil(height / TRAFFIC.cellSize);
    const road = new Uint8Array(tiles);
    const rle = world.road as number[];
    for (let k = 0, pos = 0; k + 1 < rle.length; k += 2) {
      road.fill(rle[k]!, pos, pos + rle[k + 1]!);
      pos += rle[k + 1]!;
    }
    const orders = (state.workOrders as Record<string, unknown>[]).map((o) => {
      const asset = o.asset as { layer: string; id: number };
      const onRoad = asset.layer === 'road' || (asset.layer === 'main' && road[asset.id] !== 0);
      return {
        ...o,
        closure: onRoad ? 'full' : 'none',
        night: false,
        permitId: 0,
        combined: false,
      };
    });
    return {
      ...save,
      version: 5,
      state: {
        ...state,
        world: { ...world, traffic: [0, tiles] },
        workOrders: orders,
        traffic: {
          cursor: -1,
          table: {
            load: [-1, cells],
            prod: {
              outbound: [0, cells],
              return: [0, cells],
              freight: [0, cells],
              farm: [0, cells],
            },
            attr: {
              outbound: [0, cells],
              return: [0, cells],
              freight: [0, cells],
              farm: [0, cells],
            },
          },
          pending: [0, tiles],
          commute: [0, cells],
          roundTrips: 0,
          roundTripMinutes: 0,
          roundFreeMinutes: 0,
          roundUnserved: 0,
          tripsPerHour: 0,
          avgTripMinutes: 0,
          congestion: 1,
          unservedPerHour: 0,
          nextPermitId: 1,
          kpi: {
            permits: 0,
            clashes: 0,
            combined: 0,
            combinedSavings: 0,
            overruns: 0,
            nightWorks: 0,
          },
        },
        permits: [],
      },
    };
  },
  // v5 -> v6 (milestone 6): economy (budgets, taxes, accounts, loans), services,
  // fires, events calendar, complaints, happiness, pollution grids, the fires
  // rule and event trip purposes in the traffic round.
  5: (save) => {
    const state = save.state as Record<string, unknown>;
    const world = state.world as Record<string, unknown>;
    const width = Number(world.width);
    const height = Number(world.height);
    const cells = Math.ceil(width / 4) * Math.ceil(height / 4);
    const traffic = state.traffic as Record<string, unknown>;
    const table = traffic.table as Record<string, Record<string, unknown>>;
    const trafficCells = Math.ceil(width / TRAFFIC.cellSize) * Math.ceil(height / TRAFFIC.cellSize);
    const zeroFactors = {
      services: 0,
      utilities: 0,
      waste: 0,
      commute: 0,
      pollution: 0,
      taxes: 0,
      landValue: 0,
    };
    const ledger = () => ({
      income: {
        councilTax: 0,
        businessRates: 0,
        farmExports: 0,
        electricity: 0,
        water: 0,
        events: 0,
      },
      expenses: {
        capital: 0,
        maintenance: 0,
        repairs: 0,
        crews: 0,
        upkeep: 0,
        fuel: 0,
        services: 0,
        fines: 0,
        interest: 0,
      },
      borrowed: 0,
      repaid: 0,
    });
    return {
      ...save,
      version: 6,
      state: {
        ...state,
        rules: { ...(state.rules as object), fires: true },
        traffic: {
          ...traffic,
          table: {
            load: table.load,
            prod: { ...table.prod, eventIn: [0, trafficCells], eventOut: [0, trafficCells] },
            attr: { ...table.attr, eventIn: [0, trafficCells], eventOut: [0, trafficCells] },
          },
        },
        economy: {
          budgets: { roads: 1, water: 1, power: 1, services: 1 },
          taxRates: { residential: 1, commercial: 1, office: 1, industrial: 1, agricultural: 1 },
          month: ledger(),
          lastMonth: null,
          history: [],
          meter: { electricityMWh: 0, gasMWh: 0, waterMl: 0 },
          loans: [],
          nextLoanId: 1,
        },
        services: {
          ratios: [],
          tipping: 1,
          landfill: [],
          waste: { generatedT: 0, collectedT: 0, recycledT: 0, landfilledT: 0, missed: 0 },
          fireKpi: { fires: 0, extinguished: 0, destroyed: 0, responseMinutes: 0, responses: 0 },
          nextFireId: 1,
          nextEventId: 1,
          nextComplaintId: 1,
        },
        fires: [],
        events: [],
        complaints: [],
        happiness: {
          city: 0,
          factors: { ...zeroFactors },
          complaintPenalty: 0,
          cursor: -1,
          sumWeight: 0,
          sumScore: 0,
          sumFactors: { ...zeroFactors },
        },
        pollution: { air: [0, cells], noise: [0, cells] },
      },
    };
  },
  // v6 -> v7 (milestone 7): difficulty, fire measures, KPI history, scenario.
  6: (save) => {
    const state = save.state as Record<string, unknown>;
    const fires = (state.fires as Record<string, unknown>[]).map((f) => ({
      ...f,
      measures: [],
      evacuated: [],
      smokeExposure: 0,
    }));
    return {
      ...save,
      version: 7,
      state: {
        ...state,
        rules: { ...(state.rules as object), difficulty: 'normal', licenceFactor: 1 },
        fires,
        water: { ...(state.water as object), restriction: 0 },
        kpis: {
          today: {
            incidents: Number(
              ((state.assets as Record<string, unknown>).kpi as Record<string, unknown>).incidents,
            ),
            cash: Number(state.cash),
            peakOff: 0,
            congestion: 1,
          },
          days: [],
        },
        scenario: null,
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
