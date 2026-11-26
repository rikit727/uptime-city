/**
 * The seeded city generator: builds a working, lived-in city on a fresh map
 * for scenarios (milestone 7), so starting maps never need drawing by hand.
 *
 * Layout: the city fills the wider bank of the river as a grid of 6×6 blocks
 * between roads (avenues every third road), with a strip of land left between
 * the city and the river for the waterworks (river intake, treatment works, a
 * service reservoir and their substation, joined to the grid by a feeder
 * main). Feeder mains run under every avenue. Blocks are given, from the
 * centre outwards: landmarks, commercial, office, a block of services,
 * residential, then industry; farms take the outer column. A gas power station
 * on the outer edge feeds substations (every second block each way) through
 * distribution lines run along the roads. Everything is built through the
 * ordinary commands, so the result obeys the same rules as the player.
 *
 * Then every zoned block is filled with grown buildings (any type that fits,
 * picked by weight), and the age profile is applied: every road, main, line
 * and facility gets an age and a condition from the given ranges (older assets
 * in worse condition). Randomness comes from its own seeded stream, so the same
 * parameters and seed give the same city.
 */
import { executeCommand } from './commands';
import type { Command } from './commands';
import { addBuilding } from './buildings';
import { buildingDef, facilityDef, grownTypesFor, zoneType } from './data';
import type { DensityId, FacilityId, ZoneId } from './types';
import { Terrain, TILE_ASSET_LAYERS } from './types';
import { fitsAt } from './growth';
import { facilityAssetDef } from './assets';
import { Rng, seedState } from './rng';
import type { SimState } from './state';
import { DAYS_PER_YEAR, dayOf } from './time';
import { tileIndex } from './world';

/** RNG stream for the generator (0 is the live sim, 1 the terrain). */
const CITYGEN_STREAM = 2;
/** Distance between road lines: a road and a 6-tile block. */
const PITCH = 7;
const INNER = PITCH - 1;
/** Free columns between the city's last road and the river, for the waterworks. */
const STRIP = 11;
/** Land kept clear between the city and the map edge. */
const MARGIN = 3;

/** Generator parameters (scenario JSON `city`). */
export interface CityParams {
  /** Rows of blocks along the river (the city is as wide as the bank allows, up to `blocksAcross`). */
  blocksAlong: number;
  blocksAcross: number;
  /** Shares of the zoned blocks (farms aside), normalised. */
  zoneMix: Partial<Record<Exclude<ZoneId, 'agricultural'>, number>>;
  /** Farm blocks on the outer column (at most the column's length). */
  farms: number;
  /** Occupancy of grown buildings, min..max. */
  occupancy: [number, number];
  /** Asset age in years and condition in %, each min..max (older means worse). */
  ageYears: [number, number];
  condition: [number, number];
  /** Extra facilities placed in the city's service blocks (services, depots, landmarks, plant). */
  facilities: FacilityId[];
  /** Facilities placed in the block farthest from the centre instead (optional). */
  outskirts?: FacilityId[];
  /** Gas power stations on the outer edge (at least 1). */
  gasPlants: number;
  /** Extra river intakes beside the first (each adds abstraction capacity and licence). */
  extraIntakes: number;
  /** Water storage beside the treatment works. */
  storage: 'serviceReservoir' | 'waterTower' | null;
}

export interface GeneratedCity {
  /** Gas plant, treatment works, landmarks etc. by facility id: the first building of each. */
  facilities: Partial<Record<FacilityId, number>>;
  /** Grid bounds (world tiles) and the centre. */
  centre: { x: number; y: number };
}

interface Block {
  i: number;
  j: number;
  /** Local coordinates of the road intersection at the block's top-left. */
  bx: number;
  by: number;
  dist: number;
  use: 'free' | 'facility' | 'farm' | ZoneId;
  density: DensityId;
}

/** Slots for 2×2 facilities inside a block (all touch the block's edge); (4,4) is the substation's. */
const SMALL_SLOTS: readonly [number, number][] = [
  [0, 0],
  [2, 0],
  [4, 0],
  [0, 2],
  [0, 4],
  [2, 4],
];

export function generateCity(state: SimState, params: CityParams, seed: number): GeneratedCity {
  const rng = new Rng(seedState(seed, CITYGEN_STREAM));
  const w = state.world;
  const W = w.width;
  const run = (cmd: Command): void => {
    const plan = executeCommand(state, cmd);
    // Lines and mains often retrace one already laid: that is fine.
    if (!plan.ok && !(cmd.type !== 'placeFacility' && plan.reason?.includes('already')))
      throw new Error(`City generator: ${cmd.type} failed: ${plan.reason ?? '?'}`);
  };

  // ---- which bank, and where the river is on each row ------------------------------------
  const firstWater = (y: number): number => {
    for (let x = 0; x < W; x++) if (w.terrain[tileIndex(w, x, y)] === Terrain.Water) return x;
    return W;
  };
  const lastWater = (y: number): number => {
    for (let x = W - 1; x >= 0; x--) if (w.terrain[tileIndex(w, x, y)] === Terrain.Water) return x;
    return -1;
  };
  const mid = w.height >> 1;
  const left = firstWater(mid) >= W - 1 - lastWater(mid);
  /** Local x (0 = the outer map edge) -> world x for a footprint `fw` wide. */
  const X = (lx: number, fw = 1): number => (left ? lx : W - lx - fw);
  const riverAt = (y: number): number => (left ? firstWater(y) : W - 1 - lastWater(y));

  const rows = Math.max(
    2,
    Math.min(params.blocksAlong, Math.floor((w.height - 2 * MARGIN - 1) / PITCH)),
  );
  const y0 = Math.max(MARGIN, mid - ((rows * PITCH) >> 1));
  const y1 = y0 + rows * PITCH;
  let river = W;
  for (let y = y0; y <= y1; y++) river = Math.min(river, riverAt(y));
  const cols = Math.max(
    2,
    Math.min(params.blocksAcross, Math.floor((river - STRIP - MARGIN) / PITCH)),
  );
  const x0 = MARGIN;
  const x1 = x0 + cols * PITCH;

  // ---- roads ---------------------------------------------------------------------------
  const avenue = (k: number, n: number) => k === 0 || k === n || k % 3 === 0;
  for (let c = 0; c <= cols; c++) {
    const lx = x0 + c * PITCH;
    run({
      type: 'buildRoad',
      roadClass: avenue(c, cols) ? 'avenue' : 'local',
      from: { x: X(lx), y: y0 },
      to: { x: X(lx), y: y1 },
    });
  }
  for (let r = 0; r <= rows; r++) {
    const ly = y0 + r * PITCH;
    run({
      type: 'buildRoad',
      roadClass: avenue(r, rows) ? 'avenue' : 'local',
      from: { x: X(x0), y: ly },
      to: { x: X(x1), y: ly },
    });
  }
  // Feeder mains under the avenues.
  for (let c = 0; c <= cols; c++) {
    if (!avenue(c, cols)) continue;
    const lx = x0 + c * PITCH;
    run({ type: 'buildMain', main: 'feeder', from: { x: X(lx), y: y0 }, to: { x: X(lx), y: y1 } });
  }
  for (let r = 0; r <= rows; r++) {
    if (!avenue(r, rows)) continue;
    const ly = y0 + r * PITCH;
    run({ type: 'buildMain', main: 'feeder', from: { x: X(x0), y: ly }, to: { x: X(x1), y: ly } });
  }

  // ---- blocks and their uses ----------------------------------------------------------------
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const blocks: Block[] = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      blocks.push({
        i,
        j,
        bx: x0 + i * PITCH,
        by: y0 + j * PITCH,
        dist: Math.hypot((i - cx) * 1.0, (j - cy) * 1.0) + i * 0.001 + j * 0.0001,
        use: 'free',
        density: 'low',
      });
    }
  const byDist = [...blocks].sort((a, b) => a.dist - b.dist);
  const outer = blocks.filter((b) => b.i === 0);
  // Gas plant(s): outer column, round the middle.
  const plantBlocks = [...outer].sort((a, b) => Math.abs(a.j - cy) - Math.abs(b.j - cy));
  const plants = plantBlocks.slice(0, Math.max(1, params.gasPlants));
  for (const b of plants) b.use = 'facility';
  // Farms: the outer column's ends.
  const farmCandidates = outer
    .filter((b) => b.use === 'free')
    .sort((a, b) => Math.abs(b.j - cy) - Math.abs(a.j - cy));
  for (const b of farmCandidates.slice(0, params.farms)) b.use = 'farm';

  // Facilities: landmarks (big) take central blocks; small ones are packed six to a block.
  const big = params.facilities.filter((f) => {
    const [fw, fd] = facilityDef(f).footprint;
    return fw > 2 || fd > 2;
  });
  const small = params.facilities.filter((f) => !big.includes(f));
  const free = () => byDist.filter((b) => b.use === 'free');
  const placements: { f: FacilityId; block: Block; ox: number; oy: number }[] = [];
  for (const f of big) {
    const b = free()[0];
    if (!b) throw new Error('City generator: no room for ' + f);
    b.use = 'facility';
    placements.push({ f, block: b, ox: 0, oy: 0 });
  }
  // Outskirts: the farthest free block.
  (params.outskirts ?? []).forEach((f) => {
    const list = free();
    const b = list[list.length - 1];
    if (!b) throw new Error('City generator: no room for ' + f);
    b.use = 'facility';
    placements.push({ f, block: b, ox: 0, oy: 0 });
  });
  // Small facilities go a little way out from the centre.
  let slot = SMALL_SLOTS.length;
  let current: Block | undefined;
  for (const f of small) {
    if (slot >= SMALL_SLOTS.length) {
      const list = free();
      current = list[Math.min(list.length - 1, Math.floor(list.length * 0.35))];
      if (!current) throw new Error('City generator: no room for ' + f);
      current.use = 'facility';
      slot = 0;
    }
    const [ox, oy] = SMALL_SLOTS[slot++]!;
    placements.push({ f, block: current!, ox, oy });
  }

  // Zones for the rest, centre outwards: commercial, office, residential, industrial last.
  const rest = free();
  const mix = params.zoneMix;
  const order: Exclude<ZoneId, 'agricultural'>[] = [
    'commercial',
    'office',
    'residential',
    'industrial',
  ];
  const total = order.reduce((s, z) => s + (mix[z] ?? 0), 0) || 1;
  let k = 0;
  for (const z of order) {
    const n =
      z === 'industrial' ? rest.length - k : Math.round((rest.length * (mix[z] ?? 0)) / total);
    for (let m = 0; m < n && k < rest.length; m++, k++) rest[k]!.use = z;
  }
  rest.forEach((b, r) => {
    const t = r / Math.max(1, rest.length);
    b.density = t < 0.25 ? 'high' : t < 0.6 ? 'medium' : 'low';
    // Job zones stop at medium density, or a small town would have a tower block of offices.
    if (b.use !== 'residential' && b.density === 'high') b.density = 'medium';
  });

  // ---- zoning (before facilities, which clear the zoning under them) ---------------------------
  for (const b of blocks) {
    if (b.use === 'free' || b.use === 'facility') continue;
    const zone: ZoneId = b.use === 'farm' ? 'agricultural' : b.use;
    const ax = X(b.bx + 1, INNER);
    run({
      type: 'zone',
      zone,
      density: zoneType(zone).hasDensity ? b.density : 'low',
      from: { x: ax, y: b.by + 1 },
      to: { x: ax + INNER - 1, y: b.by + INNER },
    });
  }

  // ---- facilities --------------------------------------------------------------------------
  const out: GeneratedCity = {
    facilities: {},
    centre: { x: X(Math.round(x0 + (cols * PITCH) / 2)), y: Math.round(y0 + (rows * PITCH) / 2) },
  };
  const place = (f: FacilityId, lx: number, ly: number): void => {
    const [fw] = facilityDef(f).footprint;
    const before = state.nextBuildingId;
    run({ type: 'placeFacility', facility: f, at: { x: X(lx, fw), y: ly } });
    out.facilities[f] ??= before;
  };
  for (const b of plants) place('gasPlant', b.bx + 1, b.by + 1);
  for (const p of placements) place(p.f, p.block.bx + 1 + p.ox, p.block.by + 1 + p.oy);

  // Substations every second block each way, in the block's bottom-right corner.
  const hub = plants[0]!;
  const hx = hub.bx + 1;
  const hy = hub.by;
  const line = (ax: number, ay: number, bx: number, by: number): void => {
    if (ax === bx && ay === by) return;
    run({
      type: 'buildLine',
      line: 'distribution',
      from: { x: X(ax), y: ay },
      to: { x: X(bx), y: by },
    });
  };
  /** A line from the hub along road lines only: along the hub's row, then down a road column. */
  const feedTo = (col: number, ty: number): void => {
    line(hx, hy, col, hy);
    line(col, hy, col, ty);
  };
  for (const b of blocks) {
    if (b.i % 2 !== 0 || b.j % 2 !== 0) continue;
    place('substation', b.bx + 5, b.by + 5);
    feedTo(b.bx + PITCH, b.by + 5);
  }
  // (A substation covers its own block and the next one each way, so every block is in reach.)
  for (const b of plants.slice(1)) {
    line(x0, hy, x0, b.by);
    line(x0, b.by, b.bx + 1, b.by);
  }

  // ---- waterworks in the strip ------------------------------------------------------------
  const R = x1; // the city's last road column (local)
  const wy = y0 + Math.max(1, Math.floor(rows / 2)) * PITCH - PITCH; // a road row near the middle
  const rs = Math.min(riverAt(wy + 1), riverAt(wy + 2));
  place('intake', rs - 2, wy + 1);
  place('treatmentWorks', rs - 5, wy + 1);
  const main = (ax: number, ay: number, bx: number, by: number): void =>
    run({ type: 'buildMain', main: 'feeder', from: { x: X(ax), y: ay }, to: { x: X(bx), y: by } });
  main(rs - 6, wy + 2, R, wy + 2);
  // Extra intakes upstream, each joined to the works' main by a short feeder.
  for (let n = 1; n <= params.extraIntakes; n++) {
    const ry = wy - 3 * n;
    const xi = Math.min(riverAt(ry), riverAt(ry + 1)) - 2;
    place('intake', xi, ry);
    main(xi - 1, ry, rs - 7, ry);
    main(rs - 7, ry, rs - 7, wy + 2);
  }
  if (params.storage === 'serviceReservoir') place('serviceReservoir', rs - 9, wy + 3);
  else if (params.storage === 'waterTower') place('waterTower', rs - 8, wy + 3);
  place('substation', rs - 5, wy + 5);
  line(hx, hy, R, hy);
  line(R, hy, R, wy + 6);
  line(R, wy + 6, rs - 6, wy + 6);
  // Sewage works beside the last road, below the waterworks.
  place('sewageWorks', R + 1, wy + PITCH + 1);

  // ---- grown buildings ----------------------------------------------------------------------
  const [occLo, occHi] = params.occupancy;
  for (const b of blocks) {
    if (b.use === 'free' || b.use === 'facility') continue;
    for (let dy = 0; dy < INNER; dy++)
      for (let dx = 0; dx < INNER; dx++) {
        const x = X(b.bx + 1 + dx);
        const y = b.by + 1 + dy;
        const t = tileIndex(w, x, y);
        if (state.cache.buildingAt[t] !== 0 || w.zone[t] === 0) continue;
        // Mirrored maps fill from the other corner, so footprints still start at the top-left.
        const options = grownTypesFor(w.zone[t]!, w.density[t]!).filter((d) =>
          fitsAt(state, d, x, y),
        );
        if (options.length === 0) continue;
        const sum = options.reduce((s, d) => s + d.weight, 0);
        let pick = rng.next() * sum;
        let def = options[options.length - 1]!;
        for (const o of options) {
          pick -= o.weight;
          if (pick < 0) {
            def = o;
            break;
          }
        }
        addBuilding(state, def.code, x, y, occLo + (occHi - occLo) * rng.next());
      }
  }

  // Storage starts full: it has been filling for years.
  for (const b of state.buildings) {
    const def = buildingDef(b.code);
    if (def?.role === 'facility' && def.utility === 'water' && def.kind === 'storage')
      b.storedMl = def.storageMl ?? 0;
  }
  ageAssets(state, params, rng);
  return out;
}

/** Give every tile asset and facility an age and a condition (older means worse). */
export function ageAssets(state: SimState, params: CityParams, rng: Rng): void {
  const w = state.world;
  const today = dayOf(state.minute);
  const [a0, a1] = params.ageYears;
  const [c0, c1] = params.condition;
  const roll = (): { laid: number; condition: number } => {
    const u = rng.next();
    const years = a0 + (a1 - a0) * u;
    const jitter = (rng.next() - 0.5) * 0.3 * (c1 - c0);
    const condition = Math.max(c0, Math.min(c1, c1 - (c1 - c0) * u + jitter));
    return { laid: Math.max(1, Math.round(today - years * DAYS_PER_YEAR)), condition };
  };
  for (const layer of TILE_ASSET_LAYERS) {
    const cond = w.condition[layer];
    const laid = w.laid[layer];
    for (let t = 0; t < cond.length; t++) {
      if (laid[t] === 0) continue;
      const r = roll();
      laid[t] = r.laid;
      cond[t] = Math.round(r.condition * 100);
    }
  }
  for (const b of state.buildings) {
    if (!facilityAssetDef(b)) continue;
    const r = roll();
    b.builtDay = r.laid;
    b.condition = r.condition;
  }
  // Grown buildings were built over the years too (display only).
  for (const b of state.buildings) {
    if (buildingDef(b.code)?.role === 'grown')
      b.builtDay = Math.max(1, today - rng.int(0, Math.round(a1 * DAYS_PER_YEAR)));
  }
}
