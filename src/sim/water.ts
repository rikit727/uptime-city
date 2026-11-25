/**
 * Water supply and wastewater.
 *
 * Layout (derived, rebuilt when roads, mains or facilities change): main tiles
 * and water-facility footprints that touch form a network. Pressure zones are
 * the parts of a network separated by booster pumping stations. Sewers are
 * implicit under every road; road tiles and sewage works that touch form a
 * sewer network.
 *
 * Supply (per network, once per solve round): river intakes feed treatment
 * works in the same network; output is limited by both. Service reservoirs and
 * water towers refill from spare output and cover any shortfall. Customers
 * connect to the first main in the ring around their footprint.
 *
 * Pressure (a simplified friction-loss model, not a hydraulic solver): every
 * source gives its tiles a head (treatment works outlet, reservoir or tower).
 * Head is spread outward along the mains, highest first; each main tile loses
 * `length × (baseLoss + lossAtCapacity × (flow / capacity)²)`. Flows are found
 * by sending each customer's demand back along the tree of best routes, then
 * the tree is re-routed once with the loaded losses and heads are recomputed.
 * A booster adds head to everything downstream of it (never back into the zone
 * that feeds it). When a network cannot meet demand, source heads are scaled
 * by (1 - unmet share)², so the far ends lose pressure first.
 *
 * The round is sliced: one solvable network per tick, then a finish step
 * (unconnected customers, farm irrigation from the river, wastewater and storm
 * overflows, city figures and events). Each step reads only saved state, so a
 * save loaded mid-round continues identically.
 */
import { FAULT } from './assets';
import { ASSETS, ECONOMY, GAME, WATER, buildingDef, customerDefOf, mainTypeByCode } from './data';
import type { CustomerDef, GrownBuildingDef, WaterFacilityDef } from './data';
import { residentsOf } from './buildings';
import { eventLoadFactor } from './cityEvents';
import { firefightingDraws } from './fire';
import { spend } from './ledger';
import type { SimEvent } from './events';
import type {
  Building,
  SewerNetwork,
  SimState,
  WaterNetwork,
  WaterNetworkResult,
  WaterStats,
} from './state';
import { emptyWaterStats } from './state';
import { MINUTES_PER_DAY, hourFraction, seasonOf } from './time';
import { Terrain } from './types';
import type { FieldStyle, ZoneId } from './types';
import { tileIndex } from './world';
import type { WorldState } from './world';

/** Litres per second in one megalitre per day. */
export const LPS_PER_MLD = 1e6 / 86400;
const KM_PER_TILE = GAME.metresPerTile / 1000;
const M2_PER_TILE = GAME.metresPerTile * GAME.metresPerTile;

export const waterDefOf = (b: Building): WaterFacilityDef | undefined => {
  const def = buildingDef(b.code);
  return def?.role === 'facility' && def.utility === 'water' ? def : undefined;
};

/** In service (not failed or under maintenance) and powered, unless it draws no power. */
export const running = (state: SimState, b: Building, def: WaterFacilityDef): boolean =>
  !state.cache.faults.offline.has(b.id) && (def.powerKw <= 0 || b.unpoweredMinutes === 0);

export const isFarm = (def: CustomerDef): boolean => def.zone === 'agricultural';

// ---- layout ---------------------------------------------------------------

function flood(
  w: WorldState,
  member: (t: number) => boolean,
  out: Int32Array,
  onGroup?: (id: number, tiles: number[]) => void,
): void {
  const n = w.width * w.height;
  out.fill(0);
  let id = 0;
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (out[s] !== 0 || !member(s)) continue;
    id++;
    out[s] = id;
    stack.push(s);
    const tiles: number[] = [];
    const visit = (m: number): void => {
      if (out[m] !== 0 || !member(m)) return;
      out[m] = id;
      stack.push(m);
    };
    while (stack.length > 0) {
      const t = stack.pop()!;
      tiles.push(t);
      const x = t % w.width;
      if (x > 0) visit(t - 1);
      if (x < w.width - 1) visit(t + 1);
      if (t >= w.width) visit(t - w.width);
      if (t + w.width < n) visit(t + w.width);
    }
    onGroup?.(
      id,
      tiles.sort((a, b) => a - b),
    );
  }
}

/** Rebuild water networks, pressure zones and sewer networks from the layout. */
export function rebuildWater(state: SimState): void {
  const w = state.world;
  const n = w.width * w.height;
  const L = state.cache.water;
  // 0 = not a node, 1 = main, 2 = facility, 3 = booster.
  const node = new Uint8Array(n);
  const sewerNode = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (w.water[i] !== 0) node[i] = 1;
    if (w.road[i] !== 0) sewerNode[i] = 1;
  }
  const facilities: Building[] = [];
  const works: Building[] = [];
  for (const b of state.buildings) {
    const def = waterDefOf(b);
    if (!def) continue;
    const [fw, fd] = def.footprint;
    const mark = def.kind === 'sewage' ? 0 : def.kind === 'booster' ? 3 : 2;
    for (let dy = 0; dy < fd; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        const t = tileIndex(w, b.x + dx, b.y + dy);
        if (mark === 0) sewerNode[t] = 1;
        else node[t] = mark;
      }
    }
    (def.kind === 'sewage' ? works : facilities).push(b);
  }

  const groups: number[][] = [];
  flood(
    w,
    (t) => node[t] !== 0,
    L.netAt,
    (_id, tiles) => groups.push(tiles),
  );
  flood(w, (t) => node[t] === 1 || node[t] === 2, L.zoneAt);
  const members: Building[][] = groups.map(() => []);
  for (const f of facilities) members[L.netAt[tileIndex(w, f.x, f.y)]! - 1]!.push(f);
  L.networks = groups.map((tiles, k): WaterNetwork => ({
    id: k + 1,
    tiles,
    facilities: members[k]!,
    solvable: members[k]!.some((f) => {
      const kind = waterDefOf(f)!.kind;
      return kind === 'treatment' || kind === 'storage';
    }),
  }));
  L.solvable = L.networks.filter((net) => net.solvable).map((net) => net.id);

  const sewerTiles: number[] = [];
  flood(
    w,
    (t) => sewerNode[t] === 1,
    L.sewerAt,
    (_id, tiles) => sewerTiles.push(tiles.length),
  );
  const sewerWorks: Building[][] = sewerTiles.map(() => []);
  for (const b of works) sewerWorks[L.sewerAt[tileIndex(w, b.x, b.y)]! - 1]!.push(b);
  L.sewers = sewerTiles.map((tiles, k): SewerNetwork => ({
    id: k + 1,
    tiles,
    works: sewerWorks[k]!,
  }));
}

/**
 * Scan the ring of tiles around a footprint (within `connectionRange`), row by
 * row, and return the first that passes `test`, or -1.
 */
function ringFind(
  w: WorldState,
  x: number,
  y: number,
  fw: number,
  fd: number,
  test: (t: number) => boolean,
): number {
  const r = WATER.connectionRange;
  for (let yy = Math.max(0, y - r); yy <= Math.min(w.height - 1, y + fd - 1 + r); yy++) {
    for (let xx = Math.max(0, x - r); xx <= Math.min(w.width - 1, x + fw - 1 + r); xx++) {
      if (xx >= x && xx < x + fw && yy >= y && yy < y + fd) continue;
      const t = yy * w.width + xx;
      if (test(t)) return t;
    }
  }
  return -1;
}

/** The main tile that serves a building (its connection), or -1 if none is close enough. */
export function serviceTile(w: WorldState, b: Building, def: CustomerDef): number {
  const [fw, fd] = def.footprint;
  return ringFind(w, b.x, b.y, fw, fd, (t) => w.water[t] !== 0);
}

/** The road tile whose sewer a building drains into, or -1. */
export function sewerTile(w: WorldState, b: Building, def: CustomerDef): number {
  const [fw, fd] = def.footprint;
  return ringFind(w, b.x, b.y, fw, fd, (t) => w.road[t] !== 0);
}

/** True if a footprint is within the irrigation abstraction range of the river. */
export function nearRiver(w: WorldState, x: number, y: number, fw: number, fd: number): boolean {
  const r = WATER.irrigation.riverRangeTiles;
  for (let yy = Math.max(0, y - r); yy <= Math.min(w.height - 1, y + fd - 1 + r); yy++) {
    for (let xx = Math.max(0, x - r); xx <= Math.min(w.width - 1, x + fw - 1 + r); xx++) {
      if (w.terrain[yy * w.width + xx] === Terrain.Water) return true;
    }
  }
  return false;
}

/**
 * Can a new building of this type get water at (x, y)? A main with at least
 * low-pressure head must be in reach; farms can also draw from a nearby river.
 */
export function waterServiceFor(
  state: SimState,
  def: GrownBuildingDef,
  x: number,
  y: number,
): boolean {
  const w = state.world;
  const [fw, fd] = def.footprint;
  const ok = ringFind(
    w,
    x,
    y,
    fw,
    fd,
    (t) => w.water[t] !== 0 && w.pressure[t]! >= WATER.pressure.lowM,
  );
  return ok >= 0 || (isFarm(def) && nearRiver(w, x, y, fw, fd));
}

// ---- demand ---------------------------------------------------------------

export interface WaterFactors {
  hour: number;
  /** Household and process use multiplier from temperature. */
  temperature: number;
  /** Irrigation multiplier per field style (season, temperature, rain, heatwave). */
  irrigation: Record<FieldStyle, number>;
}

function curve(zone: ZoneId, hour: number): number {
  const c = WATER.demandCurves[zone];
  const h0 = Math.floor(hour) % 24;
  const t = hour - Math.floor(hour);
  return c[h0]! + (c[(h0 + 1) % 24]! - c[h0]!) * t;
}

export function waterFactors(state: SimState): WaterFactors {
  const wx = state.weather;
  const irr = WATER.irrigation;
  const heat = 1 + irr.perDegreeAbove * Math.max(0, wx.temperatureC - irr.refC);
  const wave = wx.event?.id === 'heatwave' ? irr.heatwaveFactor : 1;
  const raining = wx.rainMmPerHour >= irr.rainStopsMmPerHour;
  return {
    hour: hourFraction(state.minute),
    temperature:
      1 + WATER.temperature.perDegreeAbove * Math.max(0, wx.temperatureC - WATER.temperature.refC),
    irrigation: {
      arable: raining ? 0 : irr.seasonFactor[seasonOf(state.minute)] * heat * wave,
      // Livestock drink all year; glasshouses are watered under cover.
      pasture: heat * wave,
      glasshouse: heat * wave,
    },
  };
}

const activity = (b: Building): number =>
  WATER.vacantUseFraction + (1 - WATER.vacantUseFraction) * b.occupancy;

/** Household, business or process water use now, l/s (irrigation excluded). */
export function useLps(b: Building, def: CustomerDef, f: WaterFactors): number {
  return (def.waterLpd / 86400) * curve(def.zone, f.hour) * f.temperature * activity(b);
}

/** Farm irrigation or livestock watering now, l/s. */
export function irrigationLps(b: Building, def: CustomerDef, f: WaterFactors): number {
  if (def.role !== 'grown' || !def.irrigationLpd) return 0;
  const style = def.fields ?? 'arable';
  return (
    (def.irrigationLpd / 86400) * curve('agricultural', f.hour) * f.irrigation[style] * activity(b)
  );
}

/** Does this farm water its fields from the river right now (rather than the mains)? */
export function irrigatesFromRiver(state: SimState, b: Building, def: CustomerDef): boolean {
  if (def.role !== 'grown' || !def.irrigationLpd || state.water.irrigationCapped) return false;
  return nearRiver(state.world, b.x, b.y, def.footprint[0], def.footprint[1]);
}

// ---- hydraulics -------------------------------------------------------------

/** Max-heap of (head, tile); ties pop the lower tile first. */
class HeadHeap {
  private h: number[] = [];
  private t: number[] = [];
  /** Head of the tile returned by the last pop(). */
  lastHead = 0;
  get size(): number {
    return this.h.length;
  }
  private above(ha: number, ta: number, hb: number, tb: number): boolean {
    return ha > hb || (ha === hb && ta < tb);
  }
  push(head: number, tile: number): void {
    const { h, t } = this;
    let i = h.length;
    h.push(head);
    t.push(tile);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.above(head, tile, h[p]!, t[p]!)) break;
      h[i] = h[p]!;
      t[i] = t[p]!;
      i = p;
    }
    h[i] = head;
    t[i] = tile;
  }
  pop(): number {
    const { h, t } = this;
    const top = t[0]!;
    this.lastHead = h[0]!;
    const lh = h.pop()!;
    const lt = t.pop()!;
    const len = h.length;
    if (len > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= len) break;
        const r = l + 1;
        const c = r < len && this.above(h[r]!, t[r]!, h[l]!, t[l]!) ? r : l;
        if (!this.above(h[c]!, t[c]!, lh, lt)) break;
        h[i] = h[c]!;
        t[i] = t[c]!;
        i = c;
      }
      h[i] = lh;
      t[i] = lt;
    }
    return top;
  }
}

interface Source {
  tiles: number[];
  head: number;
}

interface Hydraulics {
  head: Float64Array;
  flow: Float64Array;
}

// Loss coefficients by main code (index 0 = facility tile: no loss).
const LOSS_BASE = new Float64Array(256);
const LOSS_CAP = new Float64Array(256);
const INV_CAP = new Float64Array(256);
for (let code = 1; code < 256; code++) {
  const m = mainTypeByCode(code);
  if (!m) continue;
  LOSS_BASE[code] = KM_PER_TILE * m.baseLossPerKm;
  LOSS_CAP[code] = KM_PER_TILE * m.lossPerKmAtCapacity;
  INV_CAP[code] = 1 / m.capacityLps;
}

/** Head loss across one main tile carrying `flow` l/s. Facility tiles lose nothing. */
function tileLoss(code: number, flow: number): number {
  const u = flow * INV_CAP[code]!;
  return LOSS_BASE[code]! + LOSS_CAP[code]! * u * u;
}

/**
 * Heads and flows for one network: route (best head first), load, re-route,
 * load again, then recompute heads along the final routes.
 */
function solveHydraulics(
  state: SimState,
  net: WaterNetwork,
  demand: Float64Array,
  sources: Source[],
  boosters: Map<number, { id: number; boostM: number }>,
): Hydraulics {
  const w = state.world;
  const n = w.width * w.height;
  const L = state.cache.water;
  const head = new Float64Array(n);
  const parent = new Int32Array(n);
  const flow = new Float64Array(n);
  const firstChild = new Int32Array(n);
  const nextSibling = new Int32Array(n);
  const order: number[] = [];
  const netAt = L.netAt;
  const zoneAt = L.zoneAt;
  const water = w.water;
  const fault = state.cache.faults.tile;
  const width = w.width;
  const id = net.id;
  const hasBoosters = boosters.size > 0;

  const route = (loadFlow: Float64Array): void => {
    for (const t of net.tiles) {
      head[t] = -Infinity;
      parent[t] = -1;
    }
    const heap = new HeadHeap();
    for (const s of sources) {
      for (const t of s.tiles) {
        if (s.head > head[t]!) {
          head[t] = s.head;
          heap.push(s.head, t);
        }
      }
    }
    const inlet = new Map<number, number>();
    const nb = [0, 0, 0, 0];
    while (heap.size > 0) {
      const t = heap.pop();
      const h = heap.lastHead;
      if (h < head[t]!) continue;
      // A burst main takes water in (and leaks it) but passes none on.
      if ((fault[t]! & FAULT.BURST) !== 0) continue;
      const bt = hasBoosters ? boosters.get(t) : undefined;
      const x = t % width;
      nb[0] = x > 0 ? t - 1 : -1;
      nb[1] = x < width - 1 ? t + 1 : -1;
      nb[2] = t - width;
      nb[3] = t + width < n ? t + width : -1;
      for (let k = 0; k < 4; k++) {
        const m = nb[k]!;
        if (m < 0 || netAt[m] !== id || (fault[m]! & FAULT.MAIN_OFF) !== 0) continue;
        let cand: number;
        const bm = hasBoosters ? boosters.get(m) : undefined;
        if (bm && bt && bm.id === bt.id) cand = h;
        else if (bm) {
          // Entering a booster: its head is fixed by the first (highest) feed.
          if (inlet.has(bm.id)) continue;
          inlet.set(bm.id, zoneAt[t]!);
          cand = h + bm.boostM;
        } else if (bt) {
          // Leaving a booster: never back into the zone that feeds it.
          if (zoneAt[m] === inlet.get(bt.id)) continue;
          cand = h - tileLoss(water[m]!, loadFlow[m]!);
        } else cand = h - tileLoss(water[m]!, loadFlow[m]!);
        if (cand > head[m]! + 1e-9) {
          head[m] = cand;
          parent[m] = t;
          heap.push(cand, m);
        }
      }
    }
    // Pre-order of the route tree (parents before children).
    order.length = 0;
    const tiles = net.tiles;
    for (const t of tiles) firstChild[t] = -1;
    for (let k = tiles.length - 1; k >= 0; k--) {
      const t = tiles[k]!;
      const p = parent[t]!;
      if (p >= 0) {
        nextSibling[t] = firstChild[p]!;
        firstChild[p] = t;
      }
    }
    const stack: number[] = [];
    for (let k = tiles.length - 1; k >= 0; k--) {
      const t = tiles[k]!;
      if (parent[t] === -1 && head[t] !== -Infinity) stack.push(t);
    }
    while (stack.length > 0) {
      const t = stack.pop()!;
      order.push(t);
      // Push children in reverse so the lowest tile comes out first.
      const start = stack.length;
      for (let c = firstChild[t]!; c !== -1; c = nextSibling[c]!) stack.push(c);
      for (let i = start, j = stack.length - 1; i < j; i++, j--) {
        const tmp = stack[i]!;
        stack[i] = stack[j]!;
        stack[j] = tmp;
      }
    }
  };

  const load = (): void => {
    for (const t of net.tiles) flow[t] = 0;
    for (let k = order.length - 1; k >= 0; k--) {
      const t = order[k]!;
      flow[t] = flow[t]! + demand[t]!;
      const p = parent[t]!;
      if (p >= 0) flow[p] = flow[p]! + flow[t]!;
    }
  };

  route(flow);
  load();
  route(flow.slice());
  load();
  // Final heads along the routes with the loaded losses.
  for (const t of order) {
    const p = parent[t]!;
    if (p < 0) continue;
    const bt = hasBoosters ? boosters.get(t) : undefined;
    const bp = hasBoosters ? boosters.get(p) : undefined;
    if (bt && bp && bt.id === bp.id) head[t] = head[p]!;
    else if (bt) head[t] = head[p]! + bt.boostM;
    else head[t] = head[p]! - tileLoss(water[t]!, flow[t]!);
  }
  return { head, flow };
}

// ---- solve one network --------------------------------------------------------

/** Solve supply, storage and pressure for one network and update its customers. */
export function solveNetwork(state: SimState, net: WaterNetwork): WaterNetworkResult {
  const w = state.world;
  const n = w.width * w.height;
  const cache = state.cache;
  const L = cache.water;
  const interval = WATER.solveIntervalMinutes;
  const dt = interval * 60;
  const f = waterFactors(state);

  // Customers and demand per connection tile.
  const demand = new Float64Array(n);
  const customers: { b: Building; tile: number }[] = [];
  let D = 0;
  for (const b of state.buildings) {
    const def = customerDefOf(b.code);
    if (!def) continue;
    const tile = serviceTile(w, b, def);
    if (tile < 0 || L.netAt[tile] !== net.id) continue;
    let q = useLps(b, def, f) * eventLoadFactor(state, b).water;
    if (!irrigatesFromRiver(state, b, def)) q += irrigationLps(b, def, f);
    demand[tile] = demand[tile]! + q;
    D += q;
    customers.push({ b, tile });
    cache.waterUseLps.set(b.id, q);
  }
  // Unisolated bursts leak a share of their main's capacity.
  let leak = 0;
  const fault = cache.faults.tile;
  for (const t of net.tiles) {
    if ((fault[t]! & FAULT.BURST) === 0) continue;
    const q = ASSETS.burstLeakFraction * (mainTypeByCode(w.water[t]!)?.capacityLps ?? 0);
    demand[t] = demand[t]! + q;
    leak += q;
  }
  D += leak;
  // Fire engines draw from hydrants on the mains.
  for (const [t, q] of firefightingDraws(state)) {
    if (L.netAt[t] !== net.id) continue;
    demand[t] = demand[t]! + q;
    D += q;
  }

  // Production: treatment output is limited by the intakes feeding it.
  let intakeCap = 0;
  let worksCap = 0;
  const intakes: { b: Building; cap: number }[] = [];
  const works: { b: Building; cap: number; def: WaterFacilityDef }[] = [];
  const stores: { b: Building; def: WaterFacilityDef }[] = [];
  const boosters = new Map<number, { id: number; boostM: number }>();
  for (const fac of net.facilities) {
    const def = waterDefOf(fac)!;
    const on = running(state, fac, def);
    const cap = (def.capacityMlPerDay ?? 0) * LPS_PER_MLD;
    switch (def.kind) {
      case 'intake':
        if (on) intakeCap += cap;
        intakes.push({ b: fac, cap: on ? cap : 0 });
        break;
      case 'treatment':
        if (on) worksCap += cap;
        works.push({ b: fac, cap: on ? cap : 0, def });
        break;
      case 'storage':
        if (!cache.faults.offline.has(fac.id)) stores.push({ b: fac, def });
        else cache.waterFlowLps.set(fac.id, 0);
        break;
      case 'booster': {
        const [fw, fd] = def.footprint;
        for (let dy = 0; dy < fd; dy++)
          for (let dx = 0; dx < fw; dx++)
            boosters.set(tileIndex(w, fac.x + dx, fac.y + dy), {
              id: fac.id,
              boostM: on ? (def.boostM ?? 0) : 0,
            });
        break;
      }
      default:
        break;
    }
  }
  const P = Math.min(intakeCap, worksCap);

  // Sources are fixed before storage moves this step.
  const sources: Source[] = [];
  const footprint = (b: Building, def: WaterFacilityDef): number[] => {
    const out: number[] = [];
    for (let dy = 0; dy < def.footprint[1]; dy++)
      for (let dx = 0; dx < def.footprint[0]; dx++) out.push(tileIndex(w, b.x + dx, b.y + dy));
    return out;
  };
  if (P > 0) {
    for (const k of works)
      if (k.cap > 0) sources.push({ tiles: footprint(k.b, k.def), head: k.def.headM ?? 0 });
  }
  for (const s of stores) {
    if (s.b.storedMl > 1e-9) sources.push({ tiles: footprint(s.b, s.def), head: s.def.headM ?? 0 });
  }

  // Balance: spare output refills storage; storage covers a shortfall.
  let produced: number;
  let deficit = 0;
  if (P >= D) {
    produced = D;
    let spare = P - D;
    for (const s of stores) {
      const room = (((s.def.storageMl ?? 0) - s.b.storedMl) * 1e6) / dt;
      const take = Math.max(0, Math.min(spare, room));
      s.b.storedMl = Math.min(s.def.storageMl ?? 0, s.b.storedMl + (take * dt) / 1e6);
      spare -= take;
      produced += take;
      cache.waterFlowLps.set(s.b.id, -take);
    }
  } else {
    produced = P;
    let need = D - P;
    for (const s of stores) {
      const out = Math.min(need, (s.b.storedMl * 1e6) / dt);
      s.b.storedMl = Math.max(0, s.b.storedMl - (out * dt) / 1e6);
      need -= out;
      cache.waterFlowLps.set(s.b.id, out);
    }
    deficit = Math.max(0, need);
  }
  state.water.abstractedTodayMl += (produced * dt) / 1e6;
  for (const k of works) {
    const q = worksCap > 0 ? (produced * k.cap) / worksCap : 0;
    cache.waterFlowLps.set(k.b.id, q);
    if (k.cap > 0) k.b.peakLoad = Math.max(k.b.peakLoad, q / k.cap);
  }
  for (const k of intakes) {
    const q = intakeCap > 0 ? (produced * k.cap) / intakeCap : 0;
    cache.waterFlowLps.set(k.b.id, q);
    if (k.cap > 0) k.b.peakLoad = Math.max(k.b.peakLoad, q / k.cap);
  }

  // Pressure.
  const share = D > 0 ? deficit / D : 0;
  const scale = (1 - share) ** WATER.deficitHeadExponent;
  for (const s of sources) s.head *= scale;
  const { head, flow } = solveHydraulics(state, net, demand, sources, boosters);
  const maxM = WATER.pressure.maxM;
  const mainLoad = w.peakLoad.main;
  for (const t of net.tiles) {
    const h = head[t]!;
    w.pressure[t] = h === -Infinity ? 0 : Math.max(0, Math.min(maxM, Math.round(h)));
    const code = w.water[t]!;
    if (code !== 0) {
      // Peak utilisation since the last daily decay (asset wear).
      const pct = Math.min(255, Math.round(flow[t]! * INV_CAP[code]! * 100));
      if (pct > mainLoad[t]!) mainLoad[t] = pct;
    }
  }
  for (const [t, bst] of boosters) cache.waterFlowLps.set(bst.id, flow[t]!);

  // Customers: supplied while the head at their connection is above the no-supply line.
  for (const { b, tile } of customers) {
    if (w.pressure[tile]! < WATER.pressure.noSupplyM) b.dryMinutes += interval;
    else b.dryMinutes = 0;
  }
  return { demandLps: D, suppliedLps: D - deficit, productionLps: P, leakLps: leak };
}

// ---- finish the round -------------------------------------------------------------

/**
 * Finish a solve round: clear pressure where no source can reach, update
 * customers off the mains, farm irrigation from the river, wastewater and storm
 * overflows, the licence checks and the city-wide figures.
 */
export function finishRound(
  state: SimState,
  results: readonly WaterNetworkResult[],
  emit: (e: SimEvent) => void,
): WaterStats {
  const w = state.world;
  const n = w.width * w.height;
  const L = state.cache.water;
  const ws = state.water;
  const P = WATER.pressure;
  const interval = WATER.solveIntervalMinutes;
  const dt = interval * 60;
  const f = waterFactors(state);
  const solvable = new Set(L.solvable);
  for (let t = 0; t < n; t++) {
    if (w.pressure[t] !== 0 && !solvable.has(L.netAt[t]!)) w.pressure[t] = 0;
  }

  const stats = emptyWaterStats();
  for (const r of results) {
    state.economy.meter.waterMl += ((r.suppliedLps - r.leakLps) * dt) / 1e6;
    stats.demandLps += r.demandLps;
    stats.suppliedLps += r.suppliedLps;
    stats.productionLps += r.productionLps;
    stats.leakageLps += r.leakLps;
  }
  const sewerFlow = new Float64Array(L.sewers.length + 1);
  const sewerRoof = new Float64Array(L.sewers.length + 1);
  let riverDraw = 0;
  for (const b of state.buildings) {
    const def = customerDefOf(b.code);
    if (!def) continue;
    const tile = serviceTile(w, b, def);
    const onMains = tile >= 0 && solvable.has(L.netAt[tile]!);
    const farm = isFarm(def);
    const river = farm && nearRiver(w, b.x, b.y, def.footprint[0], def.footprint[1]);
    if (!onMains) {
      if (river) b.dryMinutes = 0;
      else b.dryMinutes += interval;
    }
    stats.customers++;
    if (b.dryMinutes > 0) {
      stats.noSupply++;
      stats.residentsNoSupply += residentsOf(b);
      if (def.priority === 0) stats.priorityNoSupply++;
    } else if (onMains && w.pressure[tile]! < P.lowM) stats.lowPressure++;

    const irr = irrigationLps(b, def, f);
    if (irr > 0) {
      stats.irrigationLps += irr;
      if (irrigatesFromRiver(state, b, def)) riverDraw += irr;
    }
    if (!farm && b.dryMinutes === 0) {
      const st = sewerTile(w, b, def);
      const sid = st >= 0 ? L.sewerAt[st]! : 0;
      if (sid !== 0) {
        sewerFlow[sid] = sewerFlow[sid]! + useLps(b, def, f) * WATER.wastewater.returnFraction;
        sewerRoof[sid] = sewerRoof[sid]! + def.footprint[0] * def.footprint[1];
      }
    }
  }

  // Farm abstraction from the river stops at the daily licence.
  const farmLicence = WATER.irrigation.farmLicenceMlPerDay;
  if (riverDraw > 0) {
    const vol = (riverDraw * dt) / 1e6;
    if (ws.farmAbstractedTodayMl + vol >= farmLicence) {
      ws.farmAbstractedTodayMl = farmLicence;
      ws.irrigationCapped = true;
      emit({ type: 'irrigationLicenceReached', licenceMl: farmLicence });
    } else ws.farmAbstractedTodayMl += vol;
  }

  // Wastewater: dry-weather flow plus storm runoff from roads and roofs.
  const rain = state.weather.rainMmPerHour;
  for (const s of L.sewers) {
    const dwf = sewerFlow[s.id]!;
    let cap = 0;
    for (const b of s.works) {
      const def = waterDefOf(b)!;
      if (running(state, b, def)) cap += (def.capacityMlPerDay ?? 0) * LPS_PER_MLD;
    }
    if (s.works.length === 0) {
      stats.untreatedLps += dwf;
      continue;
    }
    const area = (s.tiles + sewerRoof[s.id]!) * M2_PER_TILE;
    const storm = (rain * area * WATER.wastewater.runoffCoefficient) / 3600;
    const inflow = dwf + storm;
    const treated = Math.min(inflow, cap);
    stats.sewageInflowLps += inflow;
    stats.sewageCapacityLps += cap;
    stats.spillLps += inflow - treated;
    for (const b of s.works) {
      const def = waterDefOf(b)!;
      const c = running(state, b, def) ? (def.capacityMlPerDay ?? 0) * LPS_PER_MLD : 0;
      state.cache.waterFlowLps.set(b.id, cap > 0 ? (inflow * c) / cap : inflow / s.works.length);
      if (c > 0) b.peakLoad = Math.max(b.peakLoad, Math.min(2, (inflow * c) / cap / c));
    }
  }
  const spilling = stats.spillLps > 1e-6;
  if (spilling) {
    if (!ws.overflowing) {
      ws.spillMl = 0;
      emit({ type: 'sewerOverflow', spillLps: stats.spillLps });
    }
    const vol = (stats.spillLps * dt) / 1e6;
    ws.spillMl += vol;
    spend(state, 'fines', vol * ECONOMY.fines.spillPerMl);
  } else if (ws.overflowing) {
    emit({ type: 'sewerOverflowEnded', spilledMl: ws.spillMl });
  }
  ws.overflowing = spilling;

  // Storage and licences.
  for (const net of L.networks) {
    for (const b of net.facilities) {
      const def = waterDefOf(b)!;
      if (def.kind === 'storage') {
        stats.storedMl += b.storedMl;
        stats.storageMl += def.storageMl ?? 0;
      } else if (def.kind === 'intake') stats.licenceMlPerDay += def.licenceMlPerDay ?? 0;
    }
  }
  stats.farmLicenceMlPerDay = farmLicence;
  if (!ws.licenceBreached && ws.abstractedTodayMl > stats.licenceMlPerDay + 1e-9) {
    ws.licenceBreached = true;
    spend(state, 'fines', ECONOMY.fines.licenceBreach);
    emit({
      type: 'abstractionLicenceBreached',
      usedMl: ws.abstractedTodayMl,
      licenceMl: stats.licenceMlPerDay,
    });
  }

  // Supply alerts (start and end).
  const dry = stats.noSupply > 0;
  if (dry && !ws.supplyAlert) {
    emit({
      type: 'waterSupplyLost',
      buildings: stats.noSupply,
      residents: stats.residentsNoSupply,
    });
  } else if (!dry && ws.supplyAlert) emit({ type: 'waterSupplyRestored' });
  ws.supplyAlert = dry;
  const pri = stats.priorityNoSupply > 0;
  if (pri && !ws.priorityAlert)
    emit({ type: 'priorityCustomersWithoutWater', buildings: stats.priorityNoSupply });
  ws.priorityAlert = pri;
  return stats;
}

/** Reset the daily abstraction counters at midnight. */
export function startWaterDay(state: SimState): void {
  if (state.minute % MINUTES_PER_DAY !== 0) return;
  const ws = state.water;
  ws.abstractedTodayMl = 0;
  ws.farmAbstractedTodayMl = 0;
  ws.irrigationCapped = false;
  ws.licenceBreached = false;
}
