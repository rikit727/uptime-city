/**
 * Public services: fire, police, health, schools and waste.
 *
 * Coverage (derived, `cache.services`): a multi-source search over the road
 * network from every facility of a kind gives each road tile the free-flow
 * minutes to the nearest one and which one that is. It changes only with
 * roads and service facilities (rebuildServices), so it is cheap to keep and
 * a pure function of saved state. A building uses the road tile it loads its
 * traffic onto. Service quality falls from 1 within `goodMinutes` to 0 at
 * `maxMinutes` (services.json `coverage`).
 *
 * Capacity (saved, hourly): each police station, health centre, hospital,
 * school and waste depot serves the buildings whose nearest facility it is;
 * its ratio is capacity × services budget ÷ load, capped at 1. A building's
 * service level = time quality × ratio (halved while the facility has no
 * power or water).
 *
 * Waste (daily at `collectionHour`): depots collect what their catchment
 * produced, recycling centres take the recyclable share up to their capacity,
 * the rest is tipped at landfill until it is full. Buildings out of reach, or
 * beyond what their depot (or the tips) can take, have their bins missed.
 */
import { CITY, ECONOMY, SERVICES, buildingDef, serviceDefOf } from './data';
import type { ServiceFacilityDef } from './data';
import { MinHeap } from './routing';
import type { Building, SimState } from './state';
import { accessTile } from './traffic';
import { COVERAGE_KINDS, Terrain } from './types';
import type { CoverageKind, CrewType } from './types';

/** Crews housed by a building (depots and fire stations), or undefined. */
export function crewSpecOf(b: Building): { type: CrewType; crews: number } | undefined {
  const def = buildingDef(b.code);
  if (def?.role !== 'facility') return undefined;
  if (def.utility === 'depot') return { type: def.crewType, crews: def.crews };
  if (def.utility === 'service' && def.crewType && def.crews)
    return { type: def.crewType, crews: def.crews };
  return undefined;
}

const coverageKindOf = (def: ServiceFacilityDef): CoverageKind | undefined =>
  (COVERAGE_KINDS as readonly string[]).includes(def.kind) ? (def.kind as CoverageKind) : undefined;

/** Road tiles in the ring around a footprint. */
function ringRoads(state: SimState, b: Building, fw: number, fd: number): number[] {
  const w = state.world;
  const out: number[] = [];
  for (let yy = Math.max(0, b.y - 1); yy <= Math.min(w.height - 1, b.y + fd); yy++) {
    for (let xx = Math.max(0, b.x - 1); xx <= Math.min(w.width - 1, b.x + fw); xx++) {
      if (xx >= b.x && xx < b.x + fw && yy >= b.y && yy < b.y + fd) continue;
      const t = yy * w.width + xx;
      if (w.road[t] !== 0) out.push(t);
    }
  }
  return out;
}

/** Rebuild service coverage from the road layout and the service facilities. */
export function rebuildServices(state: SimState): void {
  const w = state.world;
  const sc = state.cache.services;
  const free = state.cache.traffic.freeSec;
  const heap = new MinHeap();
  const width = w.width;
  const cost = new Float64Array(w.road.length);
  for (const kind of COVERAGE_KINDS) {
    const minutes = sc.minutes[kind];
    const nearest = sc.nearest[kind];
    minutes.fill(Infinity);
    nearest.fill(0);
    const limit = SERVICES.coverage[kind].maxMinutes * 60;
    cost.fill(Infinity);
    heap.clear();
    for (const b of state.buildings) {
      const def = serviceDefOf(b.code);
      if (!def || coverageKindOf(def) !== kind) continue;
      for (const t of ringRoads(state, b, def.footprint[0], def.footprint[1])) {
        if (cost[t]! > 0) {
          cost[t] = 0;
          nearest[t] = b.id;
          heap.push(0, t);
        }
      }
    }
    while (heap.size > 0) {
      const t = heap.pop();
      const c = heap.cost;
      if (c > cost[t]!) continue;
      minutes[t] = c / 60;
      const x = t % width;
      for (let k = 0; k < 4; k++) {
        const m =
          k === 0
            ? x > 0
              ? t - 1
              : -1
            : k === 1
              ? x < width - 1
                ? t + 1
                : -1
              : k === 2
                ? t - width
                : t + width;
        if (m < 0 || m >= cost.length || w.road[m] === 0) continue;
        const cand = c + free[m]!;
        if (cand > limit || cand >= cost[m]!) continue;
        cost[m] = cand;
        nearest[m] = nearest[t]!;
        heap.push(cand, m);
      }
    }
  }
  sc.landmarks = state.buildings.filter((b) => serviceDefOf(b.code)?.landmark !== undefined);
  rebuildLandStatic(state);
  refreshRatioCache(state);
}

/**
 * River and landmark parts of land value per tile (layout only): a river bonus
 * within `riverTiles` (Chebyshev distance), plus each landmark's lift falling
 * linearly to nothing at its radius.
 */
function rebuildLandStatic(state: SimState): void {
  const w = state.world;
  const L = CITY.landValue;
  const out = state.cache.services.landStatic;
  const n = w.width * w.height;
  const dist = new Int32Array(n).fill(-1);
  const queue: number[] = [];
  for (let t = 0; t < n; t++) {
    if (w.terrain[t] === Terrain.Water) {
      dist[t] = 0;
      queue.push(t);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const t = queue[q]!;
    const d = dist[t]!;
    if (d >= L.riverTiles) continue;
    const x = t % w.width;
    const y = (t - x) / w.width;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w.width || yy >= w.height) continue;
        const m = yy * w.width + xx;
        if (dist[m] !== -1) continue;
        dist[m] = d + 1;
        queue.push(m);
      }
    }
  }
  for (let t = 0; t < n; t++) out[t] = dist[t]! > 0 ? L.riverBonus : 0;
  for (const b of state.cache.services.landmarks) {
    const lm = serviceDefOf(b.code)?.landmark;
    if (!lm) continue;
    const [fw, fd] = serviceDefOf(b.code)!.footprint;
    const cx = b.x + (fw - 1) / 2;
    const cy = b.y + (fd - 1) / 2;
    const r = lm.landValueRadius;
    for (let yy = Math.max(0, Math.floor(cy - r)); yy <= Math.min(w.height - 1, cy + r); yy++) {
      for (let xx = Math.max(0, Math.floor(cx - r)); xx <= Math.min(w.width - 1, cx + r); xx++) {
        const d = Math.hypot(xx - cx, yy - cy);
        if (d < r) out[yy * w.width + xx] = out[yy * w.width + xx]! + lm.landValue * (1 - d / r);
      }
    }
  }
}

function refreshRatioCache(state: SimState): void {
  const sc = state.cache.services;
  const m = sc.ratio;
  m.clear();
  for (const [id, r] of state.services.ratios) m.set(id, r);
  // Services score per road tile for land value (planning view: no outages).
  const w = state.world;
  const out = sc.roadServices;
  out.fill(0);
  const kinds = ['fire', 'police', 'health', 'school'] as const;
  for (let t = 0; t < out.length; t++) {
    if (w.road[t] === 0) continue;
    let v = 0;
    for (const k of kinds) {
      const q = timeQuality(k, sc.minutes[k][t]!);
      if (q > 0) v += q * (m.get(sc.nearest[k][t]!) ?? 1);
    }
    out[t] = v / kinds.length;
  }
}

/** The road tile a building is served from (its traffic access tile), or -1. */
export function accessOf(state: SimState, b: Building): number {
  const access = state.cache.traffic.access;
  let t = access.get(b.id);
  if (t === undefined) {
    const def = buildingDef(b.code);
    if (!def) return -1;
    t = accessTile(state.world, b.x, b.y, def.footprint[0], def.footprint[1]);
    access.set(b.id, t);
  }
  return t;
}

/** 1 within `goodMinutes`, falling linearly to 0 at `maxMinutes`. */
export function timeQuality(kind: CoverageKind, minutes: number): number {
  const c = SERVICES.coverage[kind];
  if (!Number.isFinite(minutes) || minutes > c.maxMinutes) return 0;
  if (minutes <= c.goodMinutes) return 1;
  return 1 - (minutes - c.goodMinutes) / (c.maxMinutes - c.goodMinutes);
}

/** Minutes from the nearest facility of a kind to a road tile (Infinity = out of reach). */
export const coverageMinutes = (state: SimState, kind: CoverageKind, road: number): number =>
  road < 0 ? Infinity : (state.cache.services.minutes[kind][road] ?? Infinity);

/** Share of its usual service a facility gives now (half while it has no power or water). */
function operating(state: SimState, f: Building | undefined): number {
  if (!f) return 0;
  const off = f.unpoweredMinutes > 0 || f.dryMinutes > 0 || state.cache.faults.offline.has(f.id);
  return off ? SERVICES.unpoweredServiceFactor : 1;
}

/** Service level 0..1 at a road tile (time quality × capacity ratio × operating). */
export function serviceLevelAt(state: SimState, kind: CoverageKind, road: number): number {
  if (road < 0) return 0;
  const q = timeQuality(kind, coverageMinutes(state, kind, road));
  if (q <= 0) return 0;
  const id = state.cache.services.nearest[kind][road] ?? 0;
  const f = state.cache.byId.get(id);
  return q * operating(state, f) * (state.cache.services.ratio.get(id) ?? 1);
}

export const serviceLevel = (state: SimState, b: Building, kind: CoverageKind): number =>
  serviceLevelAt(state, kind, accessOf(state, b));

/** Average of the fire, police, health and school levels (what residents notice). */
export function servicesScoreAt(state: SimState, road: number): number {
  return (
    (serviceLevelAt(state, 'fire', road) +
      serviceLevelAt(state, 'police', road) +
      serviceLevelAt(state, 'health', road) +
      serviceLevelAt(state, 'school', road)) /
    4
  );
}

// ---- capacity ------------------------------------------------------------------

/** Waste a building produces per day, tonnes. */
export function wasteTonnes(b: Building): number {
  const def = buildingDef(b.code);
  if (!def) return 0;
  const W = SERVICES.waste;
  const residents = def.role === 'grown' ? def.residents * b.occupancy : 0;
  const jobs = def.role === 'grown' ? def.jobs * b.occupancy : def.jobs;
  return residents * W.tonnesPerResident + jobs * W.tonnesPerJob;
}

/** Recompute every facility's served share from its catchment (hourly). */
export function updateRatios(state: SimState): void {
  const sc = state.cache.services;
  const load = new Map<number, number>();
  const W = SERVICES.waste;
  const add = (id: number, v: number) => {
    if (v > 0 && id !== 0) load.set(id, (load.get(id) ?? 0) + v);
  };
  for (const b of state.buildings) {
    const t = accessOf(state, b);
    if (t < 0) continue;
    const def = buildingDef(b.code);
    if (!def) continue;
    const residents = def.role === 'grown' ? def.residents * b.occupancy : 0;
    const jobs = def.role === 'grown' ? def.jobs * b.occupancy : def.jobs;
    // Unreachable tiles have nearest = 0, which add() ignores.
    add(sc.nearest.police[t]!, residents);
    add(sc.nearest.health[t]!, residents);
    add(sc.nearest.school[t]!, residents * SERVICES.pupilsPerResident);
    add(sc.nearest.waste[t]!, residents * W.tonnesPerResident + jobs * W.tonnesPerJob);
  }
  const level = state.economy.budgets.services;
  const ratios: [number, number][] = [];
  for (const b of state.buildings) {
    const def = serviceDefOf(b.code);
    if (!def || def.capacity === undefined) continue;
    const kind = coverageKindOf(def);
    if (!kind || kind === 'fire') continue;
    const l = load.get(b.id) ?? 0;
    const r = l > 0 ? Math.min(1, (def.capacity * level) / l) : 1;
    ratios.push([b.id, Math.round(r * 1000) / 1000]);
  }
  state.services.ratios = ratios;
  refreshRatioCache(state);
}

// ---- waste --------------------------------------------------------------------

const hashShare = (id: number): number => (Math.imul(id, 2654435761) >>> 0) / 4294967296;

/** Were this building's bins missed at the last collection? */
export function binsMissed(state: SimState, b: Building): boolean {
  if (wasteTonnes(b) <= 0) return false;
  const t = accessOf(state, b);
  if (t < 0 || timeQuality('waste', coverageMinutes(state, 'waste', t)) <= 0) return true;
  const id = state.cache.services.nearest.waste[t]!;
  const share = (state.cache.services.ratio.get(id) ?? 1) * state.services.tipping;
  return hashShare(b.id) >= share * operating(state, state.cache.byId.get(id));
}

/**
 * The daily collection: tonnes produced (plus `extraT` of event litter), collected,
 * recycled and tipped; landfill fills up. Returns the buildings missed.
 */
export function collectWaste(state: SimState, extraT = 0): Building[] {
  const sv = state.services;
  const level = state.economy.budgets.services;
  let generated = extraT;
  for (const b of state.buildings) generated += wasteTonnes(b);
  let recyclingCap = 0;
  let depotCap = 0;
  const landfills: { id: number; room: number }[] = [];
  const tipped = new Map(sv.landfill);
  for (const b of state.buildings) {
    const def = serviceDefOf(b.code);
    if (!def) continue;
    const on = operating(state, b);
    if (def.kind === 'recycling') recyclingCap += (def.capacity ?? 0) * level * on;
    else if (def.kind === 'waste') depotCap += (def.capacity ?? 0) * level * on;
    else if (def.kind === 'landfill') {
      const used = tipped.get(b.id) ?? 0;
      landfills.push({ id: b.id, room: Math.max(0, (def.capacity ?? 0) - used) });
    }
  }
  const collectable = Math.min(generated, depotCap);
  const recycled = Math.min(collectable * SERVICES.waste.recyclableShare, recyclingCap);
  let toTip = collectable - recycled;
  let landfilled = 0;
  for (const l of landfills) {
    const take = Math.min(l.room, toTip);
    if (take <= 0) continue;
    tipped.set(l.id, (tipped.get(l.id) ?? 0) + take);
    toTip -= take;
    landfilled += take;
  }
  sv.landfill = landfills.map((l) => [l.id, Math.round((tipped.get(l.id) ?? 0) * 100) / 100]);
  sv.tipping =
    collectable > 0 ? Math.round(((recycled + landfilled) / collectable) * 1000) / 1000 : 1;
  const missed = state.buildings.filter((b) => binsMissed(state, b));
  sv.waste = {
    generatedT: round2(generated),
    collectedT: round2(recycled + landfilled),
    recycledT: round2(recycled),
    landfilledT: round2(landfilled),
    missed: missed.length,
  };
  return missed;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Tonnes tipped at a landfill so far. */
export const landfillUsed = (state: SimState, id: number): number =>
  state.services.landfill.find(([k]) => k === id)?.[1] ?? 0;

/** Daily running cost of a facility at full budget (service upkeep, or economy.json by kind). */
export function upkeepOf(def: { kind: string; upkeepPerDay?: number }): number {
  return def.upkeepPerDay ?? ECONOMY.upkeepPerDay[def.kind] ?? 0;
}
