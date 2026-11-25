/**
 * Incidents, work orders and their effect on the networks.
 *
 * A failure opens an incident (severity, customers affected, SLA timer) and a
 * repair work order for the matching crew type. Planned maintenance orders are
 * raised by the player. Orders are dispatched to the nearest free crew in
 * priority order; the crew drives there (crews.ts), works on site and drives
 * home. Finishing a repair restores the asset's condition and resolves the
 * incident; MTTR and customer-minutes are tracked in `state.assets.kpi`.
 *
 * Fault flags (`cache.faults`) are derived from open incidents and on-site
 * work, so they are rebuilt on load: a burst main leaks and passes no water on
 * until a crew isolates it; a cable fault (or line work) takes the line tile
 * out of the power network; a failed facility (or one being overhauled) is out
 * of service; excavations and resurfacing close the road, fully or one lane
 * (traffic.ts re-routes around them).
 *
 * Works on roads run under street works permits (roadworks.ts): a crew is not
 * sent before its permit's slot starts.
 */
import { ASSETS, buildingDef, customerDefOf } from './data';
import type { FacilityAssetClass, TileAssetClass } from './data';
import {
  FAULT,
  assetKey,
  classOf,
  conditionOf,
  crewForLayer,
  customersOf,
  setCondition,
} from './assets';
import { availableCrews, crewCount, crewPosition, returnCrew, sendCrew } from './crews';
import { eventClosures } from './cityEvents';
import { spend } from './ledger';
import type { SimEvent } from './events';
import { rebuildNetwork } from './power';
import {
  checkOverruns,
  createPermit,
  detachOrder,
  durationFactor,
  onSiteMinutes,
  permitAllows,
  recordDig,
  repairClosure,
  roadTileOf,
} from './roadworks';
import type { AssetRef, Crew, Incident, RoadClosure, SimState, WorkOrder } from './state';
import { refreshTrafficTimes } from './traffic';
import { MINUTES_PER_DAY } from './time';
import type { CrewType, IncidentKind } from './types';
import { serviceTile } from './water';

export { FAULT };

/** Incident impacts are recounted every this many minutes (at tick % interval = offset). */
export const IMPACT_INTERVAL = 5;
const IMPACT_OFFSET = 4;

type Emit = (e: SimEvent) => void;
const noEmit: Emit = () => {};

export const isOpen = (i: Incident): boolean => i.resolvedMinute < 0;

export const incidentDef = (kind: IncidentKind) => ASSETS.incidents[kind];

/** Rebuild fault flags and the asset → incident / order indexes from saved state. */
export function rebuildFaults(state: SimState): void {
  const f = state.cache.faults;
  const w = state.world;
  f.tile.fill(0);
  f.offline.clear();
  f.incidentAt.clear();
  f.orderAt.clear();
  const orders = new Map<number, WorkOrder>();
  for (const o of state.workOrders) {
    orders.set(o.id, o);
    const key = assetKey(o.asset);
    // Several engines can work one fire: the index keeps the first order.
    if (!f.orderAt.has(key)) f.orderAt.set(key, o.id);
  }
  const add = (t: number, bit: number) => {
    f.tile[t] = f.tile[t]! | bit;
  };
  for (const inc of state.incidents) {
    if (!isOpen(inc) || !inc.asset) continue;
    f.incidentAt.set(assetKey(inc.asset), inc.id);
    const { layer, id } = inc.asset;
    const onSite = orders.get(inc.orderId)?.status === 'onSite';
    if (inc.kind === 'burst' && !onSite) add(id, FAULT.BURST);
    else if (inc.kind === 'cableFault') add(id, FAULT.LINE_OFF);
    else if (inc.kind === 'facilityFault' && layer === 'facility') f.offline.add(id);
  }
  // Work in progress takes the asset out of service (and digs up the road over a main).
  for (const o of state.workOrders) {
    if (o.status !== 'onSite') continue;
    const { layer, id } = o.asset;
    // Fire engines close the road they park on.
    if (o.type === 'firefighting') {
      if (w.road[o.tile] !== 0) add(o.tile, FAULT.ROAD_CLOSED);
      continue;
    }
    if (layer === 'facility') f.offline.add(id);
    else if (layer === 'line') add(id, FAULT.LINE_OFF);
    else if (layer === 'main') {
      f.tile[id] = f.tile[id]! & ~FAULT.BURST;
      add(id, FAULT.MAIN_OFF);
    }
    if ((layer === 'road' || layer === 'main') && w.road[id] !== 0 && o.closure !== 'none') {
      add(id, o.closure === 'lane' ? FAULT.LANE_CLOSED : FAULT.ROAD_CLOSED);
    }
  }
  // Roads beside a venue closed for an event (the player's choice when preparing it).
  for (const t of eventClosures(state)) add(t, FAULT.ROAD_CLOSED);
  // A full closure wins over a lane closure on the same tile.
  for (let t = 0; t < f.tile.length; t++) {
    if (f.tile[t]! & FAULT.ROAD_CLOSED) f.tile[t] = f.tile[t]! & ~FAULT.LANE_CLOSED;
  }
  refreshTrafficTimes(state);
}

/** Does a fault on this asset change the power network (a line or a power facility)? */
function affectsPower(state: SimState, ref: AssetRef): boolean {
  if (ref.layer === 'line') return true;
  if (ref.layer !== 'facility') return false;
  const b = state.cache.byId.get(ref.id);
  const def = b ? buildingDef(b.code) : undefined;
  return def?.role === 'facility' && def.utility === 'power';
}

/** Faults changed: rebuild the flags, and the power network if it depends on them. */
function faultsChanged(state: SimState, power: boolean): void {
  rebuildFaults(state);
  if (power) rebuildNetwork(state);
}

const severityName = (s: number): string => ASSETS.severity.names[s] ?? String(s);
export { severityName };

/** Current severity from the base, customers affected and priority customers. */
export function severityOf(inc: Incident): number {
  let s = incidentDef(inc.kind).severity;
  for (const step of ASSETS.severity.customerSteps) if (inc.customers >= step) s++;
  if (inc.priorityCustomers > 0 && !inc.bottledWater) s += ASSETS.severity.priorityCustomerBump;
  return Math.max(1, Math.min(4, s));
}

/** Work order priority (1 emergency .. 4 routine) for a severity. */
export const priorityFor = (severity: number): number => Math.max(1, Math.min(4, 5 - severity));

/** Does an incident concern water supply (so bottled water can help)? */
export function isWaterIncident(
  byId: ReadonlyMap<number, { readonly code: number }>,
  inc: Incident,
): boolean {
  if (inc.kind === 'burst') return true;
  if (inc.kind !== 'facilityFault' || !inc.asset) return false;
  const b = byId.get(inc.asset.id);
  const def = b ? buildingDef(b.code) : undefined;
  return def?.role === 'facility' && def.utility === 'water';
}

function siteTileOf(state: SimState, ref: AssetRef): number {
  if (ref.layer !== 'facility') return ref.id;
  const b = state.cache.byId.get(ref.id);
  return b ? b.y * state.world.width + b.x : 0;
}

/** How a new order will be worked: minutes, cost, road closure, night working. */
export interface OrderTerms {
  minutes: number;
  cost: number;
  closure: RoadClosure;
  night: boolean;
  combined: boolean;
}

/** Default terms: the class's figures, full closure for planned works on a road. */
export function defaultTerms(
  state: SimState,
  type: 'repair' | 'maintenance',
  ref: AssetRef,
  cls: TileAssetClass | FacilityAssetClass,
): OrderTerms {
  const spec = type === 'repair' ? cls.repair : cls.maintenance;
  const closure: RoadClosure =
    type === 'repair' ? repairClosure(state, ref) : roadTileOf(state, ref) >= 0 ? 'full' : 'none';
  return {
    minutes: Math.round(spec.minutes * durationFactor(closure, false)),
    cost: spec.cost,
    closure,
    night: false,
    combined: false,
  };
}

/** Create a work order (the caller sets up its incident, permit and payment). */
export function newOrder(
  state: SimState,
  type: WorkOrder['type'],
  ref: AssetRef,
  crew: CrewType,
  terms: OrderTerms,
  incidentId: number,
  priority: number,
): WorkOrder {
  const o: WorkOrder = {
    id: state.assets.nextOrderId++,
    type,
    crew,
    asset: { ...ref },
    tile: siteTileOf(state, ref),
    incidentId,
    priority,
    manualPriority: false,
    status: 'queued',
    createdMinute: state.minute,
    workMinutes: terms.minutes,
    cost: terms.cost,
    prepaid: type === 'maintenance',
    crewId: 0,
    startedMinute: -1,
    closure: terms.closure,
    night: terms.night,
    permitId: 0,
    combined: terms.combined,
  };
  state.workOrders.push(o);
  return o;
}

const orderById = (state: SimState, id: number): WorkOrder | undefined =>
  state.workOrders.find((o) => o.id === id);
const incidentById = (state: SimState, id: number): Incident | undefined =>
  state.incidents.find((i) => i.id === id);

/** The live work order on an asset, if any. */
export function orderOnAsset(state: SimState, ref: AssetRef): WorkOrder | undefined {
  const id = state.cache.faults.orderAt.get(assetKey(ref));
  return id === undefined ? undefined : orderById(state, id);
}

/** The open incident on an asset, if any. */
export function incidentOnAsset(state: SimState, ref: AssetRef): Incident | undefined {
  const id = state.cache.faults.incidentAt.get(assetKey(ref));
  return id === undefined ? undefined : incidentById(state, id);
}

/**
 * Open an incident. Failures of an asset also raise a repair order (replacing
 * any planned work on it, which is refunded).
 */
export function openIncident(
  state: SimState,
  kind: IncidentKind,
  asset: AssetRef | null,
  tile: number,
  emit: Emit = noEmit,
): Incident {
  const def = incidentDef(kind);
  const inc: Incident = {
    id: state.assets.nextIncidentId++,
    kind,
    title: incidentTitle(state, kind, asset),
    asset: asset ? { ...asset } : null,
    tile,
    openedMinute: state.minute,
    slaMinutes: def.slaMinutes,
    resolvedMinute: -1,
    outcome: '',
    severity: def.severity,
    customers: 0,
    peakCustomers: 0,
    priorityCustomers: 0,
    customerMinutes: 0,
    bottledWater: false,
    slaBreached: false,
    orderId: 0,
  };
  state.incidents.push(inc);
  state.assets.kpi.incidents++;
  const cls = asset ? classOf(state, asset) : undefined;
  if (asset && cls) {
    const existing = orderOnAsset(state, asset);
    if (existing) cancelOrder(state, existing, true);
    const crew = asset.layer === 'facility' ? cls.crew : crewForLayer(asset.layer);
    const terms = defaultTerms(state, 'repair', asset, cls);
    const order = newOrder(state, 'repair', asset, crew, terms, inc.id, priorityFor(inc.severity));
    inc.orderId = order.id;
    if (crewCount(state, crew) === 0) emit({ type: 'noCrew', crew });
    if (order.closure !== 'none') {
      createPermit(state, 'emergency', [order], state.minute, false, order.closure, emit);
    }
  }
  const w = state.world;
  emit({
    type: 'incidentOpened',
    id: inc.id,
    kind,
    name: inc.title,
    severity: inc.severity,
    x: tile % w.width,
    y: Math.floor(tile / w.width),
  });
  if (asset) faultsChanged(state, affectsPower(state, asset));
  return inc;
}

/** Player-facing title, e.g. "Burst water main (feeder main)". */
export function incidentTitle(state: SimState, kind: IncidentKind, asset: AssetRef | null): string {
  const def = incidentDef(kind);
  if (!asset) return def.name;
  if (asset.layer === 'facility') {
    const b = state.cache.byId.get(asset.id);
    const name = b ? buildingDef(b.code)?.name : undefined;
    return name ? `${def.name}: ${name.toLowerCase()}` : def.name;
  }
  const cls = classOf(state, asset);
  return cls && 'name' in cls ? `${def.name} (${cls.name.toLowerCase()})` : def.name;
}

/** Close an incident. Repaired incidents count towards MTTR and the SLA figures. */
export function resolveIncident(
  state: SimState,
  inc: Incident,
  outcome: Incident['outcome'],
  emit: Emit = noEmit,
): void {
  if (!isOpen(inc)) return;
  inc.resolvedMinute = state.minute;
  inc.outcome = outcome;
  inc.customers = 0;
  inc.priorityCustomers = 0;
  const minutes = state.minute - inc.openedMinute;
  const kpi = state.assets.kpi;
  if (outcome === 'repaired') {
    kpi.repairs++;
    kpi.repairMinutes += minutes;
  }
  if (outcome !== 'removed' && inc.slaMinutes > 0) {
    if (minutes <= inc.slaMinutes) kpi.slaMet++;
    else kpi.slaMissed++;
  }
  emit({ type: 'incidentResolved', id: inc.id, name: inc.title, minutes, outcome });
  pruneResolved(state);
}

function pruneResolved(state: SimState): void {
  let resolved = 0;
  for (const i of state.incidents) if (!isOpen(i)) resolved++;
  const drop = resolved - ASSETS.resolvedKept;
  if (drop <= 0) return;
  let k = 0;
  state.incidents = state.incidents.filter((i) => isOpen(i) || k++ >= drop);
}

/** Remove a work order: refund planned work if asked and send its crew home. */
export function cancelOrder(state: SimState, o: WorkOrder, refund: boolean): void {
  if (refund && o.prepaid) spend(state, 'maintenance', -o.cost);
  const crew = state.crews.find((c) => c.id === o.crewId);
  if (crew) returnCrew(state, crew);
  state.workOrders = state.workOrders.filter((x) => x.id !== o.id);
  detachOrder(state, o);
  const inc = o.incidentId ? incidentById(state, o.incidentId) : undefined;
  if (inc && inc.orderId === o.id) inc.orderId = 0;
  state.cache.faults.orderAt.delete(assetKey(o.asset));
}

/**
 * Raise a planned maintenance order (the caller charges its cost and books
 * any permit: see roadworks.ts `planBooking`).
 */
export function raiseMaintenance(
  state: SimState,
  ref: AssetRef,
  terms?: OrderTerms,
): WorkOrder | undefined {
  const cls = classOf(state, ref);
  if (!cls || orderOnAsset(state, ref)) return undefined;
  const crew = ref.layer === 'facility' ? cls.crew : crewForLayer(ref.layer);
  const t = terms ?? defaultTerms(state, 'maintenance', ref, cls);
  const o = newOrder(state, 'maintenance', ref, crew, t, 0, 4);
  state.cache.faults.orderAt.set(assetKey(ref), o.id);
  return o;
}

/**
 * An asset was demolished or replaced: close its incidents and cancel its work
 * (planned work is refunded). Call before changing the layout.
 */
export function retireAsset(state: SimState, ref: AssetRef): void {
  const key = assetKey(ref);
  let changed = false;
  for (const inc of state.incidents) {
    if (isOpen(inc) && inc.asset && assetKey(inc.asset) === key) {
      resolveIncident(state, inc, 'removed');
      changed = true;
    }
  }
  for (const o of [...state.workOrders]) {
    if (assetKey(o.asset) === key) {
      cancelOrder(state, o, true);
      changed = true;
    }
  }
  if (changed) rebuildFaults(state);
}

/** A depot is being demolished: its crews go and their jobs return to the queue. */
export function removeDepotCrews(state: SimState, depotId: number): void {
  const gone = state.crews.filter((c) => c.depot === depotId);
  if (gone.length === 0) return;
  for (const c of gone) {
    const o = orderById(state, c.orderId);
    if (o) {
      o.status = 'queued';
      o.crewId = 0;
      o.startedMinute = -1;
    }
  }
  state.crews = state.crews.filter((c) => c.depot !== depotId);
  rebuildFaults(state);
}

/** Send a specific crew to an order (diverting it if it was heading elsewhere). */
export function assignCrewToOrder(state: SimState, crewId: number, orderId: number): boolean {
  const crew = state.crews.find((c) => c.id === crewId);
  const o = orderById(state, orderId);
  if (!crew || !o || crew.type !== o.crew || o.status === 'onSite') return false;
  if (crew.status === 'onSite') return false;
  if (crew.orderId === o.id) return true;
  if (crew.orderId !== 0) {
    const prev = orderById(state, crew.orderId);
    if (prev) {
      prev.status = 'queued';
      prev.crewId = 0;
    }
  }
  if (o.crewId !== 0) {
    const other = state.crews.find((c) => c.id === o.crewId);
    if (other) returnCrew(state, other);
  }
  dispatch(state, crew, o);
  return true;
}

function dispatch(state: SimState, crew: Crew, o: WorkOrder): void {
  sendCrew(state, crew, o.tile);
  crew.status = 'enRoute';
  crew.orderId = o.id;
  o.status = 'enRoute';
  o.crewId = crew.id;
}

/** Finish a job: restore the asset, close the incident, charge repairs, send the crew home. */
function completeOrder(state: SimState, o: WorkOrder, emit: Emit): void {
  const w = state.world;
  if (o.type === 'repair') {
    spend(state, 'repairs', o.cost);
    setCondition(state, o.asset, Math.max(conditionOf(state, o.asset), ASSETS.repairRestoresTo));
    const inc = incidentById(state, o.incidentId);
    if (inc) resolveIncident(state, inc, 'repaired', emit);
  } else {
    setCondition(state, o.asset, ASSETS.maintenanceRestoresTo);
    emit({
      type: 'maintenanceCompleted',
      name: classOf(state, o.asset)?.maintenance.name ?? 'Maintenance',
      x: o.tile % w.width,
      y: Math.floor(o.tile / w.width),
    });
  }
  // Digging up a road to reach a main leaves a patch.
  if (o.asset.layer === 'main' && w.road[o.asset.id] !== 0) {
    const road: AssetRef = { layer: 'road', id: o.asset.id };
    setCondition(state, road, conditionOf(state, road) - ASSETS.excavationRoadWear);
    recordDig(state, o);
  }
  const crew = state.crews.find((c) => c.id === o.crewId);
  state.workOrders = state.workOrders.filter((x) => x.id !== o.id);
  detachOrder(state, o);
  if (crew) returnCrew(state, crew);
}

/** Send free crews to queued orders, most urgent first (then oldest). */
function assignCrews(state: SimState): boolean {
  let any = false;
  const queued = state.workOrders.filter((o) => o.status === 'queued');
  if (queued.length === 0) return false;
  queued.sort((a, b) => a.priority - b.priority || a.id - b.id);
  const w = state.world;
  for (const o of queued) {
    if (!permitAllows(state, o)) continue;
    const free = availableCrews(state, o.crew);
    if (free.length === 0) continue;
    const ox = o.tile % w.width;
    const oy = Math.floor(o.tile / w.width);
    let best = free[0]!;
    let bestD = Infinity;
    for (const c of free) {
      const p = crewPosition(state, c);
      const d = Math.hypot(p.x - 0.5 - ox, p.y - 0.5 - oy);
      if (d < bestD - 1e-9) {
        bestD = d;
        best = c;
      }
    }
    dispatch(state, best, o);
    any = true;
  }
  return any;
}

/**
 * Count customers without supply and attribute them to open incidents:
 * water incidents count the dry customers in their water network, power
 * incidents the customers without power in the islands next to the fault.
 * Also accrues city-wide customer-minutes (each customer once).
 */
function updateImpacts(state: SimState, emit: Emit): void {
  const w = state.world;
  const cache = state.cache;
  const L = cache.water;
  const net = cache.network;
  const waterOut = new Map<number, [number, number]>();
  const powerOut = new Map<number, [number, number]>();
  const bump = (m: Map<number, [number, number]>, k: number, c: number, pri: boolean) => {
    const v = m.get(k) ?? [0, 0];
    v[0] += c;
    if (pri) v[1]++;
    m.set(k, v);
  };
  let cityOut = 0;
  for (const b of state.buildings) {
    const def = customerDefOf(b.code);
    if (!def) continue;
    const dry = b.dryMinutes > 0;
    const off = b.unpoweredMinutes > 0;
    if (!dry && !off) continue;
    const c = customersOf(b, def);
    cityOut += c;
    const pri = def.priority === 0;
    if (dry) {
      const t = serviceTile(w, b, def);
      if (t >= 0) bump(waterOut, L.netAt[t]!, c, pri);
    }
    if (off) {
      const centre =
        (b.y + ((def.footprint[1] - 1) >> 1)) * w.width + b.x + ((def.footprint[0] - 1) >> 1);
      const sub = net.coverage[centre] ?? 0;
      const isl = sub !== 0 ? net.islandOf.get(sub) : undefined;
      if (isl !== undefined) bump(powerOut, isl, c, pri);
    }
  }
  const kpi = state.assets.kpi;
  kpi.customerMinutes += cityOut * IMPACT_INTERVAL;
  kpi.customerMinutesToday += cityOut * IMPACT_INTERVAL;

  for (const inc of state.incidents) {
    if (!isOpen(inc)) continue;
    // Fires set their own severity from their intensity (fire.ts).
    if (inc.kind === 'fire') {
      checkSla(inc, state.minute, emit);
      continue;
    }
    let found: [number, number] = [0, 0];
    const sum = (v: [number, number] | undefined) => {
      if (v) found = [found[0] + v[0], found[1] + v[1]];
    };
    if (inc.asset) {
      const { layer, id } = inc.asset;
      const water = isWaterIncident(state.cache.byId, inc);
      if (inc.kind === 'burst') sum(waterOut.get(L.netAt[id]!));
      else if (layer === 'facility' && water) sum(waterOut.get(L.netAt[inc.tile]!));
      else if (layer === 'facility') sum(powerOut.get(net.islandOf.get(id) ?? -1));
      else if (inc.kind === 'cableFault') {
        const seen = new Set<number>();
        const x = id % w.width;
        for (const m of [
          x > 0 ? id - 1 : -1,
          x < w.width - 1 ? id + 1 : -1,
          id - w.width,
          id + w.width,
        ]) {
          if (m < 0 || m >= w.width * w.height) continue;
          const isl = net.islandAt[m] ?? 0;
          if (isl !== 0 && !seen.has(isl)) {
            seen.add(isl);
            sum(powerOut.get(isl));
          }
        }
      }
    }
    const hadPriority = inc.priorityCustomers > 0;
    inc.customers = found[0];
    inc.priorityCustomers = found[1];
    inc.peakCustomers = Math.max(inc.peakCustomers, inc.customers);
    inc.customerMinutes += inc.customers * IMPACT_INTERVAL;
    if (!hadPriority && inc.priorityCustomers > 0) {
      emit({
        type: 'priorityCustomersAffected',
        id: inc.id,
        name: inc.title,
        buildings: inc.priorityCustomers,
        bottledWater: isWaterIncident(state.cache.byId, inc) && !inc.bottledWater,
      });
    }
    inc.severity = severityOf(inc);
    const o = inc.orderId ? orderById(state, inc.orderId) : undefined;
    if (o && !o.manualPriority) o.priority = priorityFor(inc.severity);
    checkSla(inc, state.minute, emit);
  }
}

function checkSla(inc: Incident, minute: number, emit: Emit): void {
  if (inc.slaMinutes > 0 && !inc.slaBreached && minute - inc.openedMinute > inc.slaMinutes) {
    inc.slaBreached = true;
    emit({ type: 'slaBreached', id: inc.id, name: inc.title });
  }
}

/** Open or clear the storm overflow incident as the sewers start and stop spilling. */
function trackOverflow(state: SimState, emit: Emit): boolean {
  const open = state.incidents.find((i) => i.kind === 'overflow' && isOpen(i));
  if (state.water.overflowing && !open) {
    const works = state.buildings.find((b) => {
      const def = buildingDef(b.code);
      return def?.role === 'facility' && def.utility === 'water' && def.kind === 'sewage';
    });
    const tile = works ? works.y * state.world.width + works.x : 0;
    openIncident(state, 'overflow', null, tile, emit);
    return true;
  }
  if (!state.water.overflowing && open) {
    resolveIncident(state, open, 'cleared', emit);
    return true;
  }
  return false;
}

/** One tick of incidents, crews and work orders. Returns true if anything visible changed. */
export function tickIncidents(state: SimState, emit: Emit): boolean {
  const kpi = state.assets.kpi;
  if (state.minute % MINUTES_PER_DAY === 0) {
    kpi.customerMinutesYesterday = kpi.customerMinutesToday;
    kpi.customerMinutesToday = 0;
  }
  let changed = false;
  let faults = false;
  let power = false;
  const now = state.minute;
  for (const c of state.crews) {
    if (c.status === 'enRoute' && now >= c.arriveMinute) {
      c.status = 'onSite';
      c.tile = c.path[c.path.length - 1] ?? c.tile;
      c.path = [];
      const o = orderById(state, c.orderId);
      if (o) {
        o.status = 'onSite';
        o.startedMinute = now;
        o.workMinutes = onSiteMinutes(state, o);
        faults = true;
        if (affectsPower(state, o.asset)) power = true;
      } else returnCrew(state, c);
      changed = true;
    } else if (c.status === 'returning' && now >= c.arriveMinute) {
      c.status = 'idle';
      c.tile = c.path[c.path.length - 1] ?? c.tile;
      c.path = [];
      changed = true;
    } else if (c.status === 'enRoute' || c.status === 'returning') changed = true;
  }
  for (const o of [...state.workOrders]) {
    if (o.status === 'onSite' && now >= o.startedMinute + o.workMinutes) {
      if (affectsPower(state, o.asset)) power = true;
      completeOrder(state, o, emit);
      faults = true;
      changed = true;
    }
  }
  if (assignCrews(state)) changed = true;
  if (trackOverflow(state, emit)) changed = true;
  if (state.permits.length > 0 && checkOverruns(state, emit)) changed = true;
  if (faults) faultsChanged(state, power);
  if (state.tick % IMPACT_INTERVAL === IMPACT_OFFSET) {
    updateImpacts(state, emit);
    changed = true;
  }
  return changed;
}

/** Send bottled water to the priority customers of a water incident (the caller charges it). */
export function sendBottledWater(state: SimState, inc: Incident): void {
  inc.bottledWater = true;
  inc.severity = severityOf(inc);
  const o = inc.orderId ? orderById(state, inc.orderId) : undefined;
  if (o && !o.manualPriority) o.priority = priorityFor(inc.severity);
}

/** Mean time to repair in minutes (0 before the first repair). */
export const mttrMinutes = (state: { assets: SimState['assets'] }): number =>
  state.assets.kpi.repairs > 0 ? state.assets.kpi.repairMinutes / state.assets.kpi.repairs : 0;
