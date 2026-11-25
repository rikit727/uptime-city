/**
 * Asset and incident commands: raise planned maintenance over an area (booking
 * street works permits for work on roads), change a work order's priority,
 * assign or cancel crews' work, send bottled water to priority customers and
 * combine works on the same street.
 */
import { classOf, conditionOf } from '../assets';
import { ASSETS } from '../data';
import { rectTiles } from '../geometry';
import {
  assignCrewToOrder,
  cancelOrder,
  isOpen,
  isWaterIncident,
  orderOnAsset,
  raiseMaintenance,
  rebuildFaults,
  sendBottledWater,
} from '../incidents';
import {
  applyCombine,
  bookingNote,
  createPermit,
  joinPermit,
  permitAllows,
  permitById,
  planBooking,
  planCombine,
  slotLabel,
} from '../roadworks';
import type { BookingOptions } from '../roadworks';
import type { AssetRef, SimState, WorkOrder } from '../state';
import { TILE_ASSET_LAYERS } from '../types';
import { assetCodeLayer } from '../world';
import { indicesInBounds, isValidCoord, rejected } from './common';
import type {
  AssignCrewCommand,
  CancelOrderCommand,
  CombinePermitsCommand,
  CommandPlan,
  RaiseMaintenanceCommand,
  SendBottledWaterCommand,
  SetOrderPriorityCommand,
} from './types';

function okPlan(
  state: SimState,
  cost: number,
  affected: number[] = [],
  layers: CommandPlan['layers'] = ['assets'],
): CommandPlan {
  if (cost > state.cash) {
    return {
      ...rejected(`Not enough cash: this costs £${cost.toLocaleString('en-GB')}.`),
      cost,
      affected,
    };
  }
  return { ok: true, cost, affected, blocked: [], demolish: [], removed: [], layers };
}

const bookingOptions = (cmd: RaiseMaintenanceCommand): BookingOptions => ({
  night: cmd.night === true,
  closure: cmd.closure === 'lane' ? 'lane' : 'full',
  combine: cmd.combine !== false,
});

/** Assets a maintenance command would cover, in a fixed order (tiles, then facilities by id). */
export function maintenanceTargets(state: SimState, cmd: RaiseMaintenanceCommand): AssetRef[] {
  const w = state.world;
  const tiles = indicesInBounds(state, rectTiles(cmd.from, cmd.to)).sort((a, b) => a - b);
  const out: AssetRef[] = [];
  const want = (ref: AssetRef): boolean => {
    const cls = classOf(state, ref);
    if (!cls || (cmd.crew && cls.crew !== cmd.crew)) return false;
    if (cmd.only && cmd.only !== ref.layer) return false;
    return conditionOf(state, ref) < cmd.below && !orderOnAsset(state, ref);
  };
  for (const t of tiles) {
    for (const layer of TILE_ASSET_LAYERS) {
      if (assetCodeLayer(w, layer)[t] === 0) continue;
      const ref: AssetRef = { layer, id: t };
      if (want(ref)) out.push(ref);
    }
  }
  const ids = new Set<number>();
  for (const t of tiles) {
    const id = state.cache.buildingAt[t] ?? 0;
    if (id !== 0) ids.add(id);
  }
  for (const id of [...ids].sort((a, b) => a - b)) {
    const ref: AssetRef = { layer: 'facility', id };
    if (want(ref)) out.push(ref);
  }
  return out;
}

export function planRaiseMaintenance(state: SimState, cmd: RaiseMaintenanceCommand): CommandPlan {
  if (!isValidCoord(cmd.from) || !isValidCoord(cmd.to) || typeof cmd.below !== 'number') {
    return rejected('Invalid area.');
  }
  const targets = maintenanceTargets(state, cmd);
  if (targets.length === 0) {
    return rejected('Nothing here needs maintenance at that threshold (or it is already booked).');
  }
  const opts = bookingOptions(cmd);
  const booking = planBooking(state, targets, opts);
  const tiles = new Set<number>();
  const w = state.world;
  for (const ref of targets) {
    if (ref.layer === 'facility') {
      const b = state.cache.byId.get(ref.id)!;
      tiles.add(b.y * w.width + b.x);
    } else tiles.add(ref.id);
  }
  const plan = okPlan(
    state,
    booking.cost,
    [...tiles].sort((a, b) => a - b),
    ['assets', 'traffic'],
  );
  const note = bookingNote(booking, opts);
  return plan.ok && note ? { ...plan, note } : plan;
}

export function applyRaiseMaintenance(state: SimState, cmd: RaiseMaintenanceCommand): void {
  const opts = bookingOptions(cmd);
  const booking = planBooking(state, maintenanceTargets(state, cmd), opts);
  const orders: (WorkOrder | undefined)[] = booking.specs.map((s) =>
    raiseMaintenance(state, s.ref, {
      minutes: s.minutes,
      cost: s.cost,
      closure: s.closure,
      night: s.night,
      combined: s.combined,
    }),
  );
  for (const g of booking.groups) {
    const list = g.specs.map((k) => orders[k]).filter((o): o is WorkOrder => !!o);
    if (list.length === 0) continue;
    const target = g.join ? permitById(state, g.join) : undefined;
    if (target) joinPermit(state, target, list);
    else createPermit(state, 'planned', list, booking.start, opts.night, opts.closure);
  }
  state.traffic.kpi.combinedSavings += booking.saved;
  rebuildFaults(state);
}

const findOrder = (state: SimState, id: number) => state.workOrders.find((o) => o.id === id);

export function planSetOrderPriority(state: SimState, cmd: SetOrderPriorityCommand): CommandPlan {
  const o = findOrder(state, cmd.order);
  if (!o) return rejected('That work order no longer exists.');
  if (!Number.isInteger(cmd.priority) || cmd.priority < 1 || cmd.priority > 4) {
    return rejected('Priority must be 1 to 4.');
  }
  return okPlan(state, 0);
}

export function applySetOrderPriority(state: SimState, cmd: SetOrderPriorityCommand): void {
  const o = findOrder(state, cmd.order)!;
  o.priority = cmd.priority;
  o.manualPriority = true;
}

export function planAssignCrew(state: SimState, cmd: AssignCrewCommand): CommandPlan {
  const o = findOrder(state, cmd.order);
  const crew = state.crews.find((c) => c.id === cmd.crew);
  if (!o || !crew) return rejected('That crew or work order no longer exists.');
  if (crew.type !== o.crew) return rejected('That crew cannot do this kind of work.');
  if (o.status === 'onSite') return rejected('A crew is already working on this.');
  if (crew.status === 'onSite') return rejected('That crew is busy on site.');
  if (!permitAllows(state, o)) {
    const p = permitById(state, o.permitId);
    return rejected(
      p && state.minute < p.start
        ? `The street works permit starts ${slotLabel(state.minute, p.start).toLowerCase()}.`
        : 'This waits for the main works on the same spot to finish.',
    );
  }
  return okPlan(state, 0);
}

export function applyAssignCrew(state: SimState, cmd: AssignCrewCommand): void {
  assignCrewToOrder(state, cmd.crew, cmd.order);
}

export function planCancelOrder(state: SimState, cmd: CancelOrderCommand): CommandPlan {
  const o = findOrder(state, cmd.order);
  if (!o) return rejected('That work order no longer exists.');
  if (o.type !== 'maintenance') return rejected('Repairs cannot be cancelled.');
  if (o.status === 'onSite') return rejected('Work has started; it cannot be cancelled now.');
  return okPlan(state, -o.cost);
}

export function applyCancelOrder(state: SimState, cmd: CancelOrderCommand): void {
  // The refund comes from the plan's negative cost.
  cancelOrder(state, findOrder(state, cmd.order)!, false);
  rebuildFaults(state);
}

export function planSendBottledWater(state: SimState, cmd: SendBottledWaterCommand): CommandPlan {
  const inc = state.incidents.find((i) => i.id === cmd.incident);
  if (!inc || !isOpen(inc)) return rejected('That incident is closed.');
  if (!isWaterIncident(state.cache.byId, inc))
    return rejected('Bottled water only helps with water supply.');
  if (inc.bottledWater) return rejected('Bottled water is already on its way.');
  if (inc.priorityCustomers === 0) return rejected('No priority customers are without water.');
  return okPlan(state, ASSETS.bottledWater.cost, [inc.tile]);
}

export function applySendBottledWater(state: SimState, cmd: SendBottledWaterCommand): void {
  sendBottledWater(
    state,
    state.incidents.find((i) => i.id === cmd.incident)!,
  );
}

export function planCombinePermits(state: SimState, cmd: CombinePermitsCommand): CommandPlan {
  const c = planCombine(state, cmd.from, cmd.into);
  if (!c.ok) return rejected(c.reason ?? 'Those works cannot be combined.');
  const into = permitById(state, cmd.into)!;
  const plan = okPlan(state, -c.refund, [...into.tiles], ['assets', 'traffic']);
  return c.refund > 0
    ? { ...plan, note: `Works combined: £${c.refund.toLocaleString('en-GB')} refunded.` }
    : { ...plan, note: 'Works combined under one permit.' };
}

export function applyCombinePermits(state: SimState, cmd: CombinePermitsCommand): void {
  applyCombine(state, cmd.from, cmd.into);
  rebuildFaults(state);
}
