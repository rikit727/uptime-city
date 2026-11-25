/**
 * Roadworks and street works permits.
 *
 * Every job that closes a road (resurfacing, or work on a main under a road)
 * needs a permit: a booked slot on its road segment (a run of road between
 * junctions, `cache.traffic.segmentAt`). Emergency repairs get a permit
 * starting at once; planned works are booked for now or for tonight (night
 * works cost more and take longer, but traffic is light). A crew is not sent
 * before its permit's slot starts.
 *
 * Permits on the same segment whose slots overlap **clash** (derived here into
 * `cache.traffic.clashes`, counted once when a permit is created). Works can be
 * **combined** instead: planned works joining works already booked on the
 * street share one closure and are discounted; resurfacing a tile whose main
 * was just dug up under the same permit waits for that dig and is quicker.
 * Works running past the booked end are flagged as overrunning.
 *
 * This module only reads crews and asset classes; incidents.ts creates and
 * finishes the work orders and calls in here.
 */
import { addComplaint, streetName } from './complaints';
import { spend } from './ledger';
import { classOf } from './assets';
import { ECONOMY, TRAFFIC, roadClassByCode } from './data';
import { crewCount } from './crews';
import type { SimEvent } from './events';
import type { AssetRef, Permit, RoadClosure, SimState, WorkOrder } from './state';
import { MINUTES_PER_DAY, MINUTES_PER_HOUR, hourOf, minuteOfDay } from './time';
import type { CrewType } from './types';

type Emit = (e: SimEvent) => void;
const noEmit: Emit = () => {};

const RW = TRAFFIC.roadworks;

/** The road tile that works on this asset close, or -1 (off-road mains, lines, facilities). */
export function roadTileOf(state: SimState, ref: AssetRef): number {
  if (ref.layer === 'road') return state.world.road[ref.id] !== 0 ? ref.id : -1;
  if (ref.layer === 'main') return state.world.road[ref.id] !== 0 ? ref.id : -1;
  return -1;
}

/** How an emergency repair on this asset closes the road (roads.json `repairClosure`). */
export function repairClosure(state: SimState, ref: AssetRef): RoadClosure {
  const t = roadTileOf(state, ref);
  if (t < 0) return 'none';
  return roadClassByCode(state.world.road[t]!)?.repairClosure ?? 'full';
}

/** Work-time multiplier for a closure and night working. */
export const durationFactor = (closure: RoadClosure, night: boolean): number =>
  (closure === 'lane' ? RW.laneClosure.durationFactor : 1) * (night ? RW.night.durationFactor : 1);

/** Start of the next night-works window (now, if it is already night). */
export function nightStart(minute: number): number {
  const h = hourOf(minute);
  if (h >= RW.night.startHour || h < RW.night.endHour) return minute;
  return minute - minuteOfDay(minute) + RW.night.startHour * MINUTES_PER_HOUR;
}

export const permitById = (state: SimState, id: number): Permit | undefined =>
  state.permits.find((p) => p.id === id);

const orderById = (state: SimState, id: number): WorkOrder | undefined =>
  state.workOrders.find((o) => o.id === id);

/** Segments a permit's works lie on (ascending). */
export function permitSegments(state: SimState, p: Permit): number[] {
  const seg = state.cache.traffic.segmentAt;
  const out = new Set<number>();
  for (const t of p.tiles) if (seg[t]) out.add(seg[t]!);
  return [...out].sort((a, b) => a - b);
}

/** Estimated minutes to finish a set of orders: crews of each type work in parallel. */
export function worksEstimate(state: SimState, orders: readonly WorkOrder[]): number {
  const byType = new Map<CrewType, { n: number; longest: number }>();
  for (const o of orders) {
    const e = byType.get(o.crew) ?? { n: 0, longest: 0 };
    e.n++;
    e.longest = Math.max(e.longest, o.workMinutes);
    byType.set(o.crew, e);
  }
  let minutes = RW.allowanceMinutes;
  for (const [type, e] of byType) {
    minutes += Math.ceil(e.n / Math.max(1, crewCount(state, type))) * e.longest;
  }
  return minutes;
}

const overlaps = (a: Permit, b: Permit): boolean => a.start < b.end && b.start < a.end;

/** Recompute which permits clash (same segment, overlapping slots). */
export function rebuildClashes(state: SimState): void {
  const clashes = state.cache.traffic.clashes;
  clashes.clear();
  const segs = state.permits.map((p) => new Set(permitSegments(state, p)));
  for (let i = 0; i < state.permits.length; i++) {
    for (let j = i + 1; j < state.permits.length; j++) {
      const a = state.permits[i]!;
      const b = state.permits[j]!;
      if (!overlaps(a, b)) continue;
      let shared = false;
      for (const s of segs[i]!) if (segs[j]!.has(s)) shared = true;
      if (!shared) continue;
      clashes.set(a.id, [...(clashes.get(a.id) ?? []), b.id]);
      clashes.set(b.id, [...(clashes.get(b.id) ?? []), a.id]);
    }
  }
}

const tilesOf = (state: SimState, orders: readonly WorkOrder[]): number[] => {
  const tiles = new Set<number>();
  for (const o of orders) {
    const t = roadTileOf(state, o.asset);
    if (t >= 0) tiles.add(t);
  }
  return [...tiles].sort((a, b) => a - b);
};

/** Book a permit for these orders, starting at `start`. Flags and reports a clash. */
export function createPermit(
  state: SimState,
  kind: Permit['kind'],
  orders: readonly WorkOrder[],
  start: number,
  night: boolean,
  closure: 'lane' | 'full',
  emit: Emit = noEmit,
): Permit {
  const ts = state.traffic;
  const p: Permit = {
    id: ts.nextPermitId++,
    kind,
    tiles: tilesOf(state, orders),
    start,
    end: start + worksEstimate(state, orders),
    night,
    closure,
    orders: orders.map((o) => o.id).sort((a, b) => a - b),
    overrun: false,
    combined: false,
    dug: [],
  };
  for (const o of orders) o.permitId = p.id;
  state.permits.push(p);
  ts.kpi.permits++;
  if (night) ts.kpi.nightWorks++;
  rebuildClashes(state);
  const other = state.cache.traffic.clashes.get(p.id);
  if (other && other.length > 0) {
    ts.kpi.clashes++;
    spend(state, 'fines', ECONOMY.fines.permitClash);
    const w = state.world;
    const t = p.tiles[0] ?? 0;
    addComplaint(
      state,
      'roadworks',
      `clash:${p.id}`,
      `Roadworks on ${streetName(w, t)} again! Why can't they dig it up once?`,
      t,
    );
    emit({
      type: 'permitClash',
      id: p.id,
      other: other[0]!,
      x: t % w.width,
      y: Math.floor(t / w.width),
    });
  }
  return p;
}

/** Add orders to an existing permit (combining works); extends the booked end if needed. */
export function joinPermit(state: SimState, p: Permit, orders: readonly WorkOrder[]): void {
  for (const o of orders) {
    o.permitId = p.id;
    if (!p.orders.includes(o.id)) p.orders.push(o.id);
  }
  p.orders.sort((a, b) => a - b);
  const all = p.orders.map((id) => orderById(state, id)).filter((o): o is WorkOrder => !!o);
  p.tiles = tilesOf(state, all);
  p.combined = true;
  p.end = Math.max(p.end, Math.max(p.start, state.minute) + worksEstimate(state, all));
  state.traffic.kpi.combined++;
  rebuildClashes(state);
}

/** An order finished or was cancelled: take it off its permit (and end the permit if empty). */
export function detachOrder(state: SimState, o: WorkOrder): void {
  const p = o.permitId ? permitById(state, o.permitId) : undefined;
  o.permitId = 0;
  if (!p) return;
  p.orders = p.orders.filter((id) => id !== o.id);
  if (p.orders.length === 0) state.permits = state.permits.filter((x) => x.id !== p.id);
  else {
    const all = p.orders.map((id) => orderById(state, id)).filter((x): x is WorkOrder => !!x);
    p.tiles = tilesOf(state, all);
  }
  rebuildClashes(state);
}

/** Main works under a road finished: remember the dig so resurfacing there is quicker. */
export function recordDig(state: SimState, o: WorkOrder): void {
  const p = o.permitId ? permitById(state, o.permitId) : undefined;
  const t = roadTileOf(state, o.asset);
  if (p && o.asset.layer === 'main' && t >= 0 && !p.dug.includes(t)) {
    p.dug.push(t);
    p.dug.sort((a, b) => a - b);
  }
}

/**
 * May this order's crew be sent now? Not before its permit's slot starts, and
 * resurfacing waits for main works on the same tile under the same permit.
 */
export function permitAllows(state: SimState, o: WorkOrder): boolean {
  if (!o.permitId) return true;
  const p = permitById(state, o.permitId);
  if (!p) return true;
  if (state.minute < p.start) return false;
  if (o.asset.layer !== 'road') return true;
  for (const id of p.orders) {
    if (id === o.id) continue;
    const other = orderById(state, id);
    if (other && other.asset.layer === 'main' && other.asset.id === o.asset.id) return false;
  }
  return true;
}

/** Work minutes once the crew is on site (resurfacing over a fresh dig is quicker). */
export function onSiteMinutes(state: SimState, o: WorkOrder): number {
  const p = o.permitId ? permitById(state, o.permitId) : undefined;
  if (p && o.asset.layer === 'road' && o.type === 'maintenance' && p.dug.includes(o.asset.id)) {
    return Math.max(1, Math.round(o.workMinutes * RW.combine.resurfaceFactor));
  }
  return o.workMinutes;
}

/** Flag permits whose works run past their booked end. */
export function checkOverruns(state: SimState, emit: Emit): boolean {
  let any = false;
  const w = state.world;
  for (const p of state.permits) {
    if (p.overrun || state.minute <= p.end) continue;
    p.overrun = true;
    state.traffic.kpi.overruns++;
    spend(state, 'fines', ECONOMY.fines.permitOverrun);
    const t = p.tiles[0] ?? 0;
    emit({ type: 'permitOverrun', id: p.id, x: t % w.width, y: Math.floor(t / w.width) });
    any = true;
  }
  return any;
}

// ---- booking planned works ---------------------------------------------------

export interface BookingOptions {
  night: boolean;
  closure: 'full' | 'lane';
  combine: boolean;
}

/** One planned order as it will be raised. */
export interface OrderSpec {
  ref: AssetRef;
  closure: RoadClosure;
  night: boolean;
  minutes: number;
  cost: number;
  combined: boolean;
}

/** A group of new orders on one segment: joining a permit (id) or a new one (0). */
export interface BookingGroup {
  join: number;
  specs: number[];
}

export interface BookingPlan {
  specs: OrderSpec[];
  groups: BookingGroup[];
  cost: number;
  /** Pounds saved by combining. */
  saved: number;
  /** Permits joined, and new permits that will clash. */
  joined: number;
  clashes: number;
  start: number;
}

/** Live permits on a segment, ascending id. */
const permitsOnSegment = (state: SimState, seg: number): Permit[] =>
  state.permits.filter((p) => permitSegments(state, p).includes(seg));

/**
 * Work out how planned maintenance on these assets will be booked: closures,
 * night working, permit groups (joining existing works when combining), costs
 * and clashes. Pure: the command's plan and apply both call it.
 */
export function planBooking(
  state: SimState,
  refs: readonly AssetRef[],
  opts: BookingOptions,
): BookingPlan {
  const seg = state.cache.traffic.segmentAt;
  const specs: OrderSpec[] = [];
  const bySeg = new Map<number, number[]>();
  for (const ref of refs) {
    const cls = classOf(state, ref);
    if (!cls) continue;
    const t = roadTileOf(state, ref);
    const closure: RoadClosure = t >= 0 ? opts.closure : 'none';
    const night = opts.night && closure !== 'none';
    const k = specs.length;
    specs.push({
      ref,
      closure,
      night,
      minutes: Math.round(cls.maintenance.minutes * durationFactor(closure, night)),
      cost: Math.round(cls.maintenance.cost * (night ? RW.night.costFactor : 1)),
      combined: false,
    });
    if (t >= 0) bySeg.set(seg[t]!, [...(bySeg.get(seg[t]!) ?? []), k]);
  }
  const start = opts.night ? nightStart(state.minute) : state.minute;
  const groups: BookingGroup[] = [];
  let saved = 0;
  let joined = 0;
  let clashes = 0;
  const discount = (k: number) => {
    const s = specs[k]!;
    if (s.combined) return;
    const off = Math.round(s.cost * RW.combine.discount);
    s.cost -= off;
    s.combined = true;
    saved += off;
  };
  for (const [segment, ks] of bySeg) {
    const existing = permitsOnSegment(state, segment);
    const target = opts.combine ? existing[0] : undefined;
    if (target) {
      for (const k of ks) discount(k);
      groups.push({ join: target.id, specs: ks });
      joined++;
      continue;
    }
    // A main and its road resurfaced in one booking are combined works too.
    const mains = new Set(
      ks.filter((k) => specs[k]!.ref.layer === 'main').map((k) => specs[k]!.ref.id),
    );
    for (const k of ks)
      if (specs[k]!.ref.layer === 'road' && mains.has(specs[k]!.ref.id)) discount(k);
    groups.push({ join: 0, specs: ks });
    const est = RW.allowanceMinutes + Math.max(...ks.map((k) => specs[k]!.minutes));
    if (existing.some((p) => p.start < start + est && start < p.end)) clashes++;
  }
  const cost = specs.reduce((sum, s) => sum + s.cost, 0);
  return { specs, groups, cost, saved, joined, clashes, start };
}

/** Player-facing summary of a booking for the status line. */
export function bookingNote(plan: BookingPlan, opts: BookingOptions): string {
  const parts: string[] = [];
  const permits = plan.groups.filter((g) => g.join === 0).length;
  if (permits > 0) {
    const when = opts.night ? 'tonight from 20:00' : 'now';
    parts.push(`${permits} street works permit${permits === 1 ? '' : 's'} booked ${when}`);
  }
  if (plan.saved > 0) {
    parts.push(`combined with other works: £${plan.saved.toLocaleString('en-GB')} saved`);
  }
  if (plan.clashes > 0) {
    parts.push(
      `clashes with works already booked on ${plan.clashes === 1 ? 'that street' : `${plan.clashes} streets`}`,
    );
  }
  return parts.join('; ');
}

// ---- combining existing permits ---------------------------------------------------

export interface CombinePlan {
  ok: boolean;
  reason?: string;
  /** Refund for discounted planned works moved across. */
  refund: number;
}

export function planCombine(state: SimState, fromId: number, intoId: number): CombinePlan {
  const from = permitById(state, fromId);
  const into = permitById(state, intoId);
  if (!from || !into) return { ok: false, reason: 'That permit has ended.', refund: 0 };
  if (from.id === into.id) return { ok: false, reason: 'Pick two different permits.', refund: 0 };
  const shared = permitSegments(state, from).some((s) => permitSegments(state, into).includes(s));
  if (!shared)
    return { ok: false, reason: 'Works can only be combined on the same street.', refund: 0 };
  let refund = 0;
  for (const id of from.orders) {
    const o = orderById(state, id);
    if (!o) continue;
    if (o.status === 'onSite') {
      return {
        ok: false,
        reason: 'Work has started under that permit; it cannot move.',
        refund: 0,
      };
    }
    if (o.prepaid && !o.combined) refund += Math.round(o.cost * RW.combine.discount);
  }
  return { ok: true, refund };
}

/** Move every order of `from` into `into`, discounting planned works, and end `from`. */
export function applyCombine(state: SimState, fromId: number, intoId: number): number {
  const from = permitById(state, fromId)!;
  const into = permitById(state, intoId)!;
  const moved: WorkOrder[] = [];
  let saved = 0;
  for (const id of from.orders) {
    const o = orderById(state, id);
    if (!o) continue;
    if (o.prepaid && !o.combined) {
      const off = Math.round(o.cost * RW.combine.discount);
      o.cost -= off;
      saved += off;
    }
    o.combined = true;
    moved.push(o);
  }
  state.permits = state.permits.filter((p) => p.id !== from.id);
  for (const t of from.dug) if (!into.dug.includes(t)) into.dug.push(t);
  into.dug.sort((a, b) => a - b);
  joinPermit(state, into, moved);
  state.traffic.kpi.combinedSavings += saved;
  return saved;
}

/** "Tonight 20:00", "Day 4 08:15": when a slot starts relative to now. */
export function slotLabel(now: number, minute: number): string {
  const day = (m: number) => Math.floor(m / MINUTES_PER_DAY);
  const hh = String(Math.floor(minuteOfDay(minute) / 60)).padStart(2, '0');
  const mm = String(minuteOfDay(minute) % 60).padStart(2, '0');
  const d = day(minute) - day(now);
  const when = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `Day ${day(minute) + 1}`;
  return `${when} ${hh}:${mm}`;
}
