import { addBuilding } from '../buildings';
import { facilityDef } from '../data';
import type { AnyFacilityDef } from '../data';
import { scheduleEvents } from '../cityEvents';
import { createDepotCrews } from '../crews';
import { dutyCrews } from '../economy';
import { rebuildServices, updateRatios } from '../services';
import { rebuildEstates } from '../estates';
import { rebuildNetwork } from '../power';
import type { SimState } from '../state';
import { Terrain } from '../types';
import { rebuildWater } from '../water';
import { inBounds, isWater, tileIndex } from '../world';
import { finalisePlan, isValidCoord, refuse, rejected } from './common';
import type { CommandPlan, PlaceFacilityCommand } from './types';

/** True if any footprint tile has river water on one of its four sides. */
function touchesWater(state: SimState, x: number, y: number, fw: number, fd: number): boolean {
  const w = state.world;
  for (let dy = 0; dy < fd; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      for (const [nx, ny] of [
        [tx - 1, ty],
        [tx + 1, ty],
        [tx, ty - 1],
        [tx, ty + 1],
      ] as const) {
        if (inBounds(w, nx, ny) && w.terrain[tileIndex(w, nx, ny)] === Terrain.Water) return true;
      }
    }
  }
  return false;
}

/**
 * Place a power or water facility or a depot. Its footprint must be clear land: no water,
 * road, power line, water main or building. Zoning under it is removed. A river
 * intake must also sit on the riverbank.
 */
export function planPlaceFacility(state: SimState, cmd: PlaceFacilityCommand): CommandPlan {
  if (!isValidCoord(cmd.at)) return rejected('Invalid position.');
  let def: AnyFacilityDef;
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
        !isWater(w, i) &&
        w.road[i] === 0 &&
        w.power[i] === 0 &&
        w.water[i] === 0 &&
        state.cache.buildingAt[i] === 0;
      (clear ? affected : blocked).push(i);
    }
  }
  const layer =
    def.utility === 'depot' ? 'assets' : def.utility === 'service' ? 'building' : def.utility;
  const plan = finalisePlan(state, affected, blocked, def.cost, ['zone', 'building', layer], '');
  if (affected.length + blocked.length < fw * fd) return refuse(plan, 'Too close to the map edge.');
  if (blocked.length > 0) {
    return refuse(
      plan,
      `A ${def.name.toLowerCase()} needs clear land (no water, roads, lines, mains or buildings).`,
    );
  }
  if (
    def.utility === 'water' &&
    def.kind === 'intake' &&
    !touchesWater(state, cmd.at.x, cmd.at.y, fw, fd)
  ) {
    return refuse(plan, 'A river intake must be built on the riverbank.');
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
  const b = addBuilding(state, def.code, cmd.at.x, cmd.at.y, 1);
  if (rezoned) rebuildEstates(state);
  if (def.utility === 'power') rebuildNetwork(state);
  else if (def.utility === 'water') rebuildWater(state);
  else if (def.utility === 'depot') createDepotCrews(state, b, dutyCrews(state, b));
  else {
    createDepotCrews(state, b, dutyCrews(state, b));
    rebuildServices(state);
    updateRatios(state);
    scheduleEvents(state);
  }
}
