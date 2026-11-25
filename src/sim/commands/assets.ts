/**
 * Asset and incident commands: raise planned maintenance over an area, change
 * a work order's priority, assign or cancel crews' work, and send bottled
 * water to priority customers.
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
import type { AssetRef, SimState } from '../state';
import { TILE_ASSET_LAYERS } from '../types';
import { assetCodeLayer } from '../world';
import { indicesInBounds, isValidCoord, rejected } from './common';
import type {
  AssignCrewCommand,
  CancelOrderCommand,
  CommandPlan,
  RaiseMaintenanceCommand,
  SendBottledWaterCommand,
  SetOrderPriorityCommand,
} from './types';

function okPlan(state: SimState, cost: number, affected: number[] = []): CommandPlan {
  if (cost > state.cash) {
    return {
      ...rejected(`Not enough cash: this costs £${cost.toLocaleString('en-GB')}.`),
      cost,
      affected,
    };
  }
  return { ok: true, cost, affected, blocked: [], demolish: [], removed: [], layers: ['assets'] };
}

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
  let cost = 0;
  const tiles = new Set<number>();
  const w = state.world;
  for (const ref of targets) {
    cost += classOf(state, ref)!.maintenance.cost;
    if (ref.layer === 'facility') {
      const b = state.cache.byId.get(ref.id)!;
      tiles.add(b.y * w.width + b.x);
    } else tiles.add(ref.id);
  }
  return okPlan(
    state,
    cost,
    [...tiles].sort((a, b) => a - b),
  );
}

export function applyRaiseMaintenance(state: SimState, cmd: RaiseMaintenanceCommand): void {
  for (const ref of maintenanceTargets(state, cmd)) raiseMaintenance(state, ref);
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
