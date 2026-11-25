import { POWER, lineType } from '../data';
import { rebuildEstates } from '../estates';
import { roadPath } from '../geometry';
import { layTileAsset } from '../assets';
import { retireAsset } from '../incidents';
import { rebuildNetwork } from '../power';
import type { SimState } from '../state';
import { isWater } from '../world';
import {
  buildingsUnder,
  finalisePlan,
  indicesInBounds,
  isValidCoord,
  refuse,
  rejected,
} from './common';
import type { BuildLineCommand, CommandPlan } from './types';

/**
 * Run a power line along an L-shaped path (like roads). Lines may share tiles
 * with roads and water mains and span water at a cost multiplier; they pass
 * through power facilities (which connect anyway) and are blocked by grown
 * buildings and water facilities. Existing lines of
 * another type are replaced. Zoning under a line is removed.
 */
export function planBuildLine(state: SimState, cmd: BuildLineCommand): CommandPlan {
  if (!isValidCoord(cmd.from) || !isValidCoord(cmd.to)) return rejected('Invalid line position.');
  let def;
  try {
    def = lineType(cmd.line);
  } catch {
    return rejected('Unknown line type.');
  }
  const w = state.world;
  const path = indicesInBounds(state, roadPath(cmd.from, cmd.to));
  const { grown, powerTiles, waterTiles, depotTiles } = buildingsUnder(state, path);
  const grownTiles = new Set(
    path.filter((i) => (state.cache.buildingAt[i] ?? 0) !== 0 && !powerTiles.has(i)),
  );
  const affected: number[] = [];
  const blocked: number[] = [];
  let cost = 0;
  for (const i of path) {
    if (powerTiles.has(i) || w.power[i] === def.code) continue;
    if (grownTiles.has(i)) {
      blocked.push(i);
      continue;
    }
    affected.push(i);
    cost += def.costPerTile * (isWater(w, i) ? POWER.lineWaterCostMultiplier : 1);
  }
  const plan = finalisePlan(
    state,
    affected,
    blocked,
    cost,
    ['zone', 'power'],
    `There is already a ${def.name.toLowerCase()} here.`,
  );
  if (waterTiles.size > 0) return refuse(plan, 'A water facility is in the way.');
  if (depotTiles.size > 0) return refuse(plan, 'A depot is in the way.');
  return grown.length > 0 ? refuse(plan, 'A building is in the way. Bulldoze it first.') : plan;
}

export function applyBuildLine(state: SimState, cmd: BuildLineCommand, plan: CommandPlan): void {
  const code = lineType(cmd.line).code;
  const w = state.world;
  let rezoned = false;
  for (const i of plan.affected) {
    if (w.power[i] !== 0) retireAsset(state, { layer: 'line', id: i });
    w.power[i] = code;
    layTileAsset(state, 'line', i);
    if (w.zone[i] !== 0) rezoned = true;
    w.zone[i] = 0;
    w.density[i] = 0;
  }
  if (rezoned) rebuildEstates(state);
  rebuildNetwork(state);
}
