import { addBuilding } from '../buildings';
import { POWER, facilityDef, lineType } from '../data';
import { rebuildEstates } from '../estates';
import { roadPath } from '../geometry';
import { rebuildNetwork } from '../power';
import type { SimState } from '../state';
import { inBounds, isWater, tileIndex } from '../world';
import {
  buildingsUnder,
  finalisePlan,
  indicesInBounds,
  isValidCoord,
  refuse,
  rejected,
} from './common';
import type { BuildLineCommand, CommandPlan, PlaceFacilityCommand } from './types';

/**
 * Place a power facility. Its footprint must be clear land: no water, road,
 * power line or building. Zoning under it is removed.
 */
export function planPlaceFacility(state: SimState, cmd: PlaceFacilityCommand): CommandPlan {
  if (!isValidCoord(cmd.at)) return rejected('Invalid position.');
  let def;
  try {
    def = facilityDef(cmd.facility);
  } catch {
    return rejected('Unknown facility.');
  }
  const w = state.world;
  const [fw, fd] = def.footprint;
  const affected: number[] = [];
  const blocked: number[] = [];
  for (let dy = 0; dy < fd; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      const x = cmd.at.x + dx;
      const y = cmd.at.y + dy;
      if (!inBounds(w, x, y)) continue;
      const i = tileIndex(w, x, y);
      const clear =
        !isWater(w, i) && w.road[i] === 0 && w.power[i] === 0 && state.cache.buildingAt[i] === 0;
      (clear ? affected : blocked).push(i);
    }
  }
  const plan = finalisePlan(state, affected, blocked, def.cost, ['zone', 'building', 'power'], '');
  if (affected.length + blocked.length < fw * fd) return refuse(plan, 'Too close to the map edge.');
  if (blocked.length > 0) {
    return refuse(
      plan,
      `A ${def.name.toLowerCase()} needs clear land (no water, roads, lines or buildings).`,
    );
  }
  return plan;
}

export function applyPlaceFacility(
  state: SimState,
  cmd: PlaceFacilityCommand,
  plan: CommandPlan,
): void {
  const def = facilityDef(cmd.facility);
  const w = state.world;
  let rezoned = false;
  for (const i of plan.affected) {
    if (w.zone[i] !== 0) rezoned = true;
    w.zone[i] = 0;
    w.density[i] = 0;
  }
  addBuilding(state, def.code, cmd.at.x, cmd.at.y, 1);
  if (rezoned) rebuildEstates(state);
  rebuildNetwork(state);
}

/**
 * Run a power line along an L-shaped path (like roads). Lines may share tiles
 * with roads and span water at a cost multiplier; they pass through facilities
 * (which connect anyway) and are blocked by grown buildings. Existing lines of
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
  const { grown, facilityTiles } = buildingsUnder(state, path);
  const grownTiles = new Set(
    path.filter((i) => (state.cache.buildingAt[i] ?? 0) !== 0 && !facilityTiles.has(i)),
  );
  const affected: number[] = [];
  const blocked: number[] = [];
  let cost = 0;
  for (const i of path) {
    if (facilityTiles.has(i) || w.power[i] === def.code) continue;
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
  return grown.length > 0 ? refuse(plan, 'A building is in the way. Bulldoze it first.') : plan;
}

export function applyBuildLine(state: SimState, cmd: BuildLineCommand, plan: CommandPlan): void {
  const code = lineType(cmd.line).code;
  const w = state.world;
  let rezoned = false;
  for (const i of plan.affected) {
    w.power[i] = code;
    if (w.zone[i] !== 0) rezoned = true;
    w.zone[i] = 0;
    w.density[i] = 0;
  }
  if (rezoned) rebuildEstates(state);
  rebuildNetwork(state);
}
