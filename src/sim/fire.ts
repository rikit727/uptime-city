/**
 * Building fires and the fire service.
 *
 * Ignition: once an hour one roll decides whether a fire starts somewhere in
 * the city (each grown building's chance scales with its footprint and its
 * zone's risk, services.json `fire`); `rules.fires` turns random fires off.
 * `startFire()` can also start one directly (scenarios, tests).
 *
 * A fire opens a `fire` incident and one firefighting work order per
 * appliance needed (more for bigger buildings). Fire engines are crews based
 * at fire stations: they mobilise quickly and drive through the real traffic
 * to the road beside the building, which they close while they work.
 *
 * Growth (every minute): intensity I (share of the building involved, 0..100)
 * grows by `growthPerMinute × (1 + I / accelerationAt) / √area` and each engine
 * on site knocks it back by `suppressionPerAppliance × water / √area`, where
 * water is the share of a good hydrant flow available: from the pressure at
 * the hydrant (the nearest main), or only the engine's tank if none is in
 * reach. While engines work, every one draws `hydrantLps` from that main
 * (water.ts adds it to the network demand), which lowers pressure for the
 * neighbours. A grown building that reaches 100 burns down; one put out is
 * left damaged (occupancy lost in proportion to the worst of the fire).
 *
 * Emergency measures (milestone 7, `fireMeasure` command, services.json
 * `fire.measures`): isolating the building's power (it then gets none, but
 * firefighters work at full rate and the fire is not fed by live electrics), a
 * cordon (roads within a radius close so traffic diverts; without one onlookers
 * slow the work and breathe the smoke) and evacuation (buildings nearby empty:
 * no smoke exposure, but they pay no taxes until the fire is out). Burning
 * buildings pay no taxes either. Smoke exposure is counted every 5 minutes.
 */
import { SERVICES, WATER, buildingDef } from './data';
import { defOf, jobsOf, removeBuildings, residentsOf } from './buildings';
import { addComplaint, streetName } from './complaints';
import type { SimEvent } from './events';
import {
  cancelOrder,
  isOpen,
  newOrder,
  openIncident,
  rebuildFaults,
  resolveIncident,
} from './incidents';
import { crewCount } from './crews';
import type { Building, Fire, Incident, SimState } from './state';
import type { FireMeasure } from './types';
import { accessTile } from './traffic';
import { MINUTES_PER_HOUR } from './time';
import type { WorldState } from './world';

type Emit = (e: SimEvent) => void;
const noEmit: Emit = () => {};

const F = SERVICES.fire;

/** Footprint area in tiles. */
const areaOf = (b: Building): number => {
  const [fw, fd] = defOf(b).footprint;
  return fw * fd;
};

/** Fire engines a building needs. */
export function appliancesFor(area: number): number {
  let n = 1;
  for (const [a, k] of F.appliancesByArea) if (area >= a) n = k;
  return n;
}

/** The nearest main tile within `hydrantSearchTiles` of a footprint, or -1. */
export function hydrantFor(w: WorldState, b: Building): number {
  const [fw, fd] = defOf(b).footprint;
  const r = F.hydrantSearchTiles;
  let best = -1;
  let bestD = Infinity;
  const cx = b.x + (fw - 1) / 2;
  const cy = b.y + (fd - 1) / 2;
  for (let yy = Math.max(0, b.y - r); yy <= Math.min(w.height - 1, b.y + fd - 1 + r); yy++) {
    for (let xx = Math.max(0, b.x - r); xx <= Math.min(w.width - 1, b.x + fw - 1 + r); xx++) {
      const t = yy * w.width + xx;
      if (w.water[t] === 0) continue;
      const d = Math.hypot(xx - cx, yy - cy);
      if (d < bestD - 1e-9) {
        bestD = d;
        best = t;
      }
    }
  }
  return best;
}

export const fireOf = (state: SimState, buildingId: number): Fire | undefined =>
  state.fires.find((f) => f.building === buildingId);

const incidentOf = (state: SimState, f: Fire): Incident | undefined =>
  state.incidents.find((i) => i.id === f.incidentId);

/** Start a fire in a building (no-op if it is already burning). */
export function startFire(state: SimState, buildingId: number, emit: Emit = noEmit): Fire | null {
  const b = state.cache.byId.get(buildingId);
  if (!b || fireOf(state, buildingId)) return null;
  const w = state.world;
  const def = defOf(b);
  const [fw, fd] = def.footprint;
  const road = accessTile(w, b.x, b.y, fw, fd);
  const tile = road >= 0 ? road : b.y * w.width + b.x;
  const inc = openIncident(state, 'fire', { layer: 'facility', id: b.id }, tile, emit);
  const fire: Fire = {
    id: state.services.nextFireId++,
    building: b.id,
    tile,
    hydrant: hydrantFor(w, b),
    startMinute: state.minute,
    intensity: F.startIntensity,
    peak: F.startIntensity,
    incidentId: inc.id,
    firstArrival: -1,
    measures: [],
    evacuated: [],
    smokeExposure: 0,
  };
  state.fires.push(fire);
  state.services.fireKpi.fires++;
  const n = appliancesFor(fw * fd);
  for (let k = 0; k < n; k++) {
    const o = newOrder(
      state,
      'firefighting',
      { layer: 'facility', id: b.id },
      'fire',
      { minutes: 1e7, cost: 0, closure: 'none', night: false, combined: false },
      inc.id,
      1,
    );
    if (k === 0) inc.orderId = o.id;
  }
  if (crewCount(state, 'fire') === 0) emit({ type: 'noCrew', crew: 'fire' });
  addComplaint(
    state,
    'fire',
    `fire:${fire.id}`,
    `Smoke everywhere: a ${def.name.toLowerCase()} is on fire on ${streetName(w, tile)}.`,
    tile,
  );
  return fire;
}

/** Engines working at a fire now. */
export function appliancesOnSite(state: SimState, f: Fire): number {
  let n = 0;
  for (const o of state.workOrders)
    if (o.incidentId === f.incidentId && o.type === 'firefighting' && o.status === 'onSite') n++;
  return n;
}

/** Share of a good firefighting flow available at a fire (0 with no engine there). */
export function waterShare(state: SimState, f: Fire): number {
  const P = WATER.pressure;
  const hyd =
    f.hydrant >= 0 && state.world.water[f.hydrant] !== 0
      ? Math.max(
          0,
          Math.min(
            1,
            (state.world.pressure[f.hydrant]! - P.noSupplyM) / (F.goodHydrantM - P.noSupplyM),
          ),
        )
      : 0;
  return Math.max(F.tankShare, hyd);
}

/** Main tile -> l/s drawn by engines fighting fires (water.ts adds it to demand). */
export function firefightingDraws(state: SimState): Map<number, number> {
  const out = new Map<number, number>();
  for (const f of state.fires) {
    if (f.hydrant < 0 || state.world.water[f.hydrant] === 0) continue;
    const n = appliancesOnSite(state, f);
    if (n > 0) out.set(f.hydrant, (out.get(f.hydrant) ?? 0) + n * F.hydrantLps);
  }
  return out;
}

/** Severity 1..4 from intensity. */
const severityFor = (i: number): number =>
  Math.min(4, 1 + (i >= 15 ? 1 : 0) + (i >= 45 ? 1 : 0) + (i >= 75 ? 1 : 0));

function endFire(state: SimState, f: Fire, outcome: 'cleared' | 'removed', emit: Emit): void {
  const inc = incidentOf(state, f);
  for (const o of [...state.workOrders]) {
    if (o.incidentId === f.incidentId && o.type === 'firefighting') cancelOrder(state, o, false);
  }
  if (inc && isOpen(inc)) resolveIncident(state, inc, outcome, emit);
  state.fires = state.fires.filter((x) => x.id !== f.id);
  if (f.measures.includes('cordon')) rebuildFaults(state);
}

const M = F.measures;

/** Has this measure been ordered at the fire? */
export const hasMeasure = (f: Fire, m: FireMeasure): boolean => f.measures.includes(m);

/** Cost of ordering a measure at a fire now. */
export function fireMeasureCost(state: SimState, f: Fire, m: FireMeasure): number {
  if (m === 'isolatePower') return M.isolatePower.cost;
  if (m === 'cordon') return M.cordon.cost;
  return M.evacuate.costPerBuilding * buildingsNear(state, f, M.evacuate.radiusTiles).length;
}

/** Ids of buildings (ascending) whose footprint lies within `r` tiles of the burning building's. */
export function buildingsNear(state: SimState, f: Fire, r: number): number[] {
  const b = state.cache.byId.get(f.building);
  if (!b) return [];
  const [fw, fd] = defOf(b).footprint;
  const out: number[] = [];
  for (const o of state.buildings) {
    const [ow, od] = defOf(o).footprint;
    const dx = Math.max(0, b.x - (o.x + ow - 1), o.x - (b.x + fw - 1));
    const dy = Math.max(0, b.y - (o.y + od - 1), o.y - (b.y + fd - 1));
    if (dx <= r && dy <= r && (residentsOf(o) > 0 || jobsOf(o) > 0 || o.id === b.id))
      out.push(o.id);
  }
  return out;
}

/** Road tiles closed by cordons round fires (rebuildFaults adds them). */
export function fireClosures(state: SimState): number[] {
  const out: number[] = [];
  const w = state.world;
  const r = M.cordon.radiusTiles;
  for (const f of state.fires) {
    if (!hasMeasure(f, 'cordon')) continue;
    const b = state.cache.byId.get(f.building);
    if (!b) continue;
    const [fw, fd] = defOf(b).footprint;
    for (let yy = Math.max(0, b.y - r); yy <= Math.min(w.height - 1, b.y + fd - 1 + r); yy++)
      for (let xx = Math.max(0, b.x - r); xx <= Math.min(w.width - 1, b.x + fw - 1 + r); xx++) {
        const t = yy * w.width + xx;
        if (w.road[t] !== 0) out.push(t);
      }
  }
  return out;
}

/** Is this building's power isolated for firefighting? */
export const powerIsolated = (state: SimState, buildingId: number): boolean =>
  state.fires.some((f) => f.building === buildingId && hasMeasure(f, 'isolatePower'));

/** Closed by a fire: burning, or evacuated from one (pays no taxes meanwhile). */
export function closedByFire(state: SimState, buildingId: number): boolean {
  for (const f of state.fires) {
    if (f.building === buildingId) return true;
    if (f.evacuated.length > 0 && binaryHas(f.evacuated, buildingId)) return true;
  }
  return false;
}

function binaryHas(list: readonly number[], v: number): boolean {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const x = list[mid]!;
    if (x === v) return true;
    if (x < v) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

/** People in a building now (residents plus staff). */
const peopleIn = (b: Building): number => residentsOf(b) + jobsOf(b);

/** Order an emergency measure at a fire (the command pays for it). */
export function orderFireMeasure(state: SimState, f: Fire, m: FireMeasure): void {
  if (hasMeasure(f, m)) return;
  f.measures = [...f.measures, m].sort(
    (a, b) => MEASURE_ORDER.indexOf(a) - MEASURE_ORDER.indexOf(b),
  );
  const w = state.world;
  if (m === 'cordon') rebuildFaults(state);
  if (m === 'evacuate') {
    f.evacuated = buildingsNear(state, f, M.evacuate.radiusTiles);
    addComplaint(
      state,
      'fire',
      `evac:${f.id}`,
      `We've been evacuated from ${streetName(w, f.tile)} because of a fire. How long until we can go home?`,
      f.tile,
    );
  }
}

const MEASURE_ORDER: readonly FireMeasure[] = ['isolatePower', 'cordon', 'evacuate'];

/** Smoke over the last 5 minutes: person-minutes breathed by people not evacuated. */
function smokeStep(state: SimState, f: Fire): number {
  const S = F.smoke;
  if (f.intensity < S.minIntensity) return 0;
  const share = f.intensity / 100;
  let people = 0;
  for (const id of buildingsNear(state, f, S.radiusTiles)) {
    if (id === f.building) continue;
    if (f.evacuated.length > 0 && binaryHas(f.evacuated, id)) continue;
    const o = state.cache.byId.get(id);
    if (o) people += peopleIn(o);
  }
  if (!hasMeasure(f, 'cordon')) {
    // Onlookers and passing traffic on the roads round the fire.
    let pcu = 0;
    for (const t of roadsNear(state, f, M.cordon.radiusTiles)) pcu += state.world.traffic[t]!;
    people += (pcu / 60) * M.cordon.peoplePerPcu * 5;
  }
  return people * share * 5;
}

function roadsNear(state: SimState, f: Fire, r: number): number[] {
  const out: number[] = [];
  const b = state.cache.byId.get(f.building);
  if (!b) return out;
  const w = state.world;
  const [fw, fd] = defOf(b).footprint;
  for (let yy = Math.max(0, b.y - r); yy <= Math.min(w.height - 1, b.y + fd - 1 + r); yy++)
    for (let xx = Math.max(0, b.x - r); xx <= Math.min(w.width - 1, b.x + fw - 1 + r); xx++) {
      const t = yy * w.width + xx;
      if (w.road[t] !== 0) out.push(t);
    }
  return out;
}

/** Hourly ignition roll (one roll for the whole city). */
function maybeIgnite(state: SimState, emit: Emit): boolean {
  if (!state.rules.fires) return false;
  const weights: number[] = [];
  const ids: number[] = [];
  let total = 0;
  for (const b of state.buildings) {
    const def = buildingDef(b.code);
    if (def?.role !== 'grown' || b.occupancy <= 0) continue;
    const wgt =
      F.ignitionPerBuildingDay * (F.zoneRisk[def.zone] ?? 1) * def.footprint[0] * def.footprint[1];
    total += wgt;
    weights.push(wgt);
    ids.push(b.id);
  }
  if (total <= 0 || !state.rng.chance(Math.min(1, total / 24))) return false;
  let pick = state.rng.next() * total;
  let id = ids[ids.length - 1]!;
  for (let k = 0; k < ids.length; k++) {
    pick -= weights[k]!;
    if (pick < 0) {
      id = ids[k]!;
      break;
    }
  }
  return startFire(state, id, emit) !== null;
}

/** One minute of fires. Returns true if anything visible changed (buildings or sites). */
export function tickFires(state: SimState, emit: Emit): { changed: boolean; buildings: boolean } {
  let changed = false;
  let buildings = false;
  if (state.minute % MINUTES_PER_HOUR === 33 && maybeIgnite(state, emit)) changed = true;
  const w = state.world;
  for (const f of [...state.fires]) {
    const b = state.cache.byId.get(f.building);
    const inc = incidentOf(state, f);
    if (!b || !inc || !isOpen(inc)) {
      endFire(state, f, 'removed', emit);
      changed = true;
      continue;
    }
    const engines = appliancesOnSite(state, f);
    if (engines > 0 && f.firstArrival < 0) {
      f.firstArrival = state.minute;
      state.services.fireKpi.responseMinutes += state.minute - f.startMinute;
      state.services.fireKpi.responses++;
      changed = true;
    }
    const root = Math.sqrt(areaOf(b));
    const isolated = hasMeasure(f, 'isolatePower');
    const growth =
      ((F.growthPerMinute * (1 + f.intensity / F.accelerationAt)) / root) *
      (isolated ? 1 : M.isolatePower.liveGrowthFactor);
    const handicap =
      (isolated ? 1 : M.isolatePower.liveSuppressionFactor) *
      (hasMeasure(f, 'cordon') ? 1 : M.cordon.noCordonSuppressionFactor);
    const knock =
      engines > 0
        ? (engines * F.suppressionPerAppliance * waterShare(state, f) * handicap) / root
        : 0;
    if (state.minute % 5 === 0) {
      const dose = smokeStep(state, f);
      const before = f.smokeExposure;
      f.smokeExposure += dose;
      if (state.scenario) state.scenario.smoke += dose;
      if (before < F.smoke.complaintExposure && f.smokeExposure >= F.smoke.complaintExposure) {
        addComplaint(
          state,
          'fire',
          `smoke:${f.id}`,
          `Thick smoke from the fire on ${streetName(w, f.tile)} is coming into our homes and offices. Why haven't we been told to leave?`,
          f.tile,
        );
      }
    }
    f.intensity = Math.max(0, Math.min(100, f.intensity + growth - knock));
    f.peak = Math.max(f.peak, f.intensity);
    const sev = severityFor(f.intensity);
    if (sev !== inc.severity) {
      inc.severity = sev;
      changed = true;
    }
    const def = defOf(b);
    const street = streetName(w, f.tile);
    if (f.intensity >= 100 && def.role === 'grown') {
      state.services.fireKpi.destroyed++;
      endFire(state, f, 'removed', emit);
      removeBuildings(state, [b.id]);
      emit({ type: 'buildingBurntDown', name: def.name, street, x: b.x, y: b.y });
      const late = f.firstArrival < 0 || f.firstArrival - f.startMinute > F.targetResponseMinutes;
      addComplaint(
        state,
        'fire',
        `burnt:${f.id}`,
        `A ${def.name.toLowerCase()} on ${street} has burnt down.${late ? ' Where was the fire brigade?' : ''}`,
        f.tile,
      );
      changed = true;
      buildings = true;
    } else if (f.intensity <= 0) {
      state.services.fireKpi.extinguished++;
      if (def.role === 'grown') {
        b.occupancy = Math.max(0, b.occupancy * (1 - (F.damageOccupancy * f.peak) / 100));
      } else if (f.peak >= 100) b.condition = Math.min(b.condition, F.gutsCondition);
      endFire(state, f, 'cleared', emit);
      emit({
        type: 'fireOut',
        name: def.name,
        street,
        minutes: state.minute - f.startMinute,
        damage: Math.round(f.peak),
      });
      changed = true;
      buildings = true;
    }
  }
  return { changed, buildings };
}
