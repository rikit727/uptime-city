import { ROADS } from '../data';
import { rectTiles } from '../geometry';
import type { SimState } from '../state';
import { finalisePlan, indicesInBounds, isValidCoord, rejected } from './common';
import type { BulldozeCommand, CommandPlan } from './types';

/** Clear roads (at a demolition cost per tile) and zoning (free) in a rectangle. */
export function planBulldoze(state: SimState, cmd: BulldozeCommand): CommandPlan {
  if (!isValidCoord(cmd.from) || !isValidCoord(cmd.to)) return rejected('Invalid area.');
  const w = state.world;
  const affected: number[] = [];
  let cost = 0;
  for (const i of indicesInBounds(state, rectTiles(cmd.from, cmd.to))) {
    if (w.road[i] !== 0) {
      affected.push(i);
      cost += ROADS.demolishCostPerTile;
    } else if (w.zone[i] !== 0) {
      affected.push(i);
    }
  }
  return finalisePlan(state, affected, [], cost, ['road', 'zone'], 'Nothing to clear here.');
}

export function applyBulldoze(state: SimState, _cmd: BulldozeCommand, plan: CommandPlan): void {
  const w = state.world;
  for (const i of plan.affected) {
    w.road[i] = 0;
    w.zone[i] = 0;
    w.density[i] = 0;
  }
}
