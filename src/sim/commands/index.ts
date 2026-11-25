/**
 * Command registry. To add a command: define its type in types.ts, write
 * `planX` (pure, no mutation) and `applyX` (mutates using the plan), and
 * register both here.
 */
import type { SimState } from '../state';
import {
  applyAssignCrew,
  applyCancelOrder,
  applyCombinePermits,
  applyRaiseMaintenance,
  applySendBottledWater,
  applySetOrderPriority,
  planAssignCrew,
  planCancelOrder,
  planCombinePermits,
  planRaiseMaintenance,
  planSendBottledWater,
  planSetOrderPriority,
} from './assets';
import { applyBulldoze, planBulldoze } from './bulldoze';
import { rejected } from './common';
import { applyPlaceFacility, planPlaceFacility } from './facilities';
import { applyBuildLine, planBuildLine } from './power';
import { applyBuildRoad, planBuildRoad } from './roads';
import type { Command, CommandPlan } from './types';
import { applyBuildMain, planBuildMain } from './water';
import { applyZone, planZone } from './zoning';

export type { Command, CommandPlan, CommandResult, CommandType, Layer } from './types';

interface Handler<C extends Command> {
  plan(state: SimState, cmd: C): CommandPlan;
  apply(state: SimState, cmd: C, plan: CommandPlan): void;
}

type HandlerMap = { [K in Command['type']]: Handler<Extract<Command, { type: K }>> };

const handlers: HandlerMap = {
  buildRoad: { plan: planBuildRoad, apply: applyBuildRoad },
  zone: { plan: planZone, apply: applyZone },
  bulldoze: { plan: planBulldoze, apply: applyBulldoze },
  placeFacility: { plan: planPlaceFacility, apply: applyPlaceFacility },
  buildLine: { plan: planBuildLine, apply: applyBuildLine },
  buildMain: { plan: planBuildMain, apply: applyBuildMain },
  raiseMaintenance: { plan: planRaiseMaintenance, apply: applyRaiseMaintenance },
  setOrderPriority: { plan: planSetOrderPriority, apply: applySetOrderPriority },
  assignCrew: { plan: planAssignCrew, apply: applyAssignCrew },
  cancelOrder: { plan: planCancelOrder, apply: applyCancelOrder },
  sendBottledWater: { plan: planSendBottledWater, apply: applySendBottledWater },
  combinePermits: { plan: planCombinePermits, apply: applyCombinePermits },
};

function handlerFor(cmd: Command): Handler<Command> | undefined {
  return (handlers as Record<string, Handler<Command> | undefined>)[cmd.type];
}

/** Plan a command without changing state. */
export function planCommand(state: SimState, cmd: Command): CommandPlan {
  const h = handlerFor(cmd);
  return h ? h.plan(state, cmd) : rejected('Unknown command.');
}

/** Plan and, if valid, apply a command, charging its cost. */
export function executeCommand(state: SimState, cmd: Command): CommandPlan {
  const h = handlerFor(cmd);
  if (!h) return rejected('Unknown command.');
  const plan = h.plan(state, cmd);
  if (!plan.ok) return plan;
  h.apply(state, cmd, plan);
  state.cash -= plan.cost;
  return plan;
}
