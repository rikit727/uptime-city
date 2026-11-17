import { ROADS, roadClass } from '../data';
import { roadPath } from '../geometry';
import type { SimState } from '../state';
import { isWater } from '../world';
import { finalisePlan, indicesInBounds, isValidCoord, rejected } from './common';
import type { BuildRoadCommand, CommandPlan } from './types';

/**
 * Lay a road along an L-shaped path. Existing roads of another class are
 * replaced (upgrade or downgrade) at the full cost of the new class; tiles that
 * already carry this class are skipped. Roads over water become bridges at a
 * cost multiplier. Building a road over a zoned tile removes the zoning.
 */
export function planBuildRoad(state: SimState, cmd: BuildRoadCommand): CommandPlan {
  if (!isValidCoord(cmd.from) || !isValidCoord(cmd.to)) return rejected('Invalid road position.');
  let def;
  try {
    def = roadClass(cmd.roadClass);
  } catch {
    return rejected('Unknown road type.');
  }
  const w = state.world;
  const affected: number[] = [];
  let cost = 0;
  for (const i of indicesInBounds(state, roadPath(cmd.from, cmd.to))) {
    if (w.road[i] === def.code) continue;
    affected.push(i);
    cost += def.costPerTile * (isWater(w, i) ? ROADS.bridgeCostMultiplier : 1);
  }
  return finalisePlan(
    state,
    affected,
    [],
    cost,
    ['road', 'zone'],
    `There is already a ${def.name.toLowerCase()} here.`,
  );
}

export function applyBuildRoad(state: SimState, cmd: BuildRoadCommand, plan: CommandPlan): void {
  const code = roadClass(cmd.roadClass).code;
  const w = state.world;
  for (const i of plan.affected) {
    w.road[i] = code;
    w.zone[i] = 0;
    w.density[i] = 0;
  }
}
