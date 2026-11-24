import { GAME, density as densityDef, zoneType } from '../data';
import { rectTiles } from '../geometry';
import type { SimState } from '../state';
import { coordOf, edgeDistance, isWater } from '../world';
import { finalisePlan, indicesInBounds, isValidCoord, rejected } from './common';
import type { CommandPlan, ZoneCommand } from './types';

/**
 * Paint a zone over a rectangle. Water and road tiles are skipped. Edge-only
 * zone types (agricultural) can only be painted within `agriculturalEdgeBand`
 * tiles of the map edge. Re-zoning a tile replaces its zone.
 */
export function planZone(state: SimState, cmd: ZoneCommand): CommandPlan {
  if (!isValidCoord(cmd.from) || !isValidCoord(cmd.to)) return rejected('Invalid zone area.');
  let def;
  let densityCode = 0;
  try {
    def = zoneType(cmd.zone);
    if (def.hasDensity) densityCode = densityDef(cmd.density).code;
  } catch {
    return rejected('Unknown zone type.');
  }
  const w = state.world;
  const affected: number[] = [];
  const blocked: number[] = [];
  let edgeBlocked = 0;
  for (const i of indicesInBounds(state, rectTiles(cmd.from, cmd.to))) {
    if (isWater(w, i) || w.road[i] !== 0) {
      blocked.push(i);
      continue;
    }
    if (def.edgeOnly) {
      const c = coordOf(w, i);
      if (edgeDistance(w, c.x, c.y) >= GAME.agriculturalEdgeBand) {
        blocked.push(i);
        edgeBlocked++;
        continue;
      }
    }
    if (w.zone[i] === def.code && w.density[i] === densityCode) continue;
    affected.push(i);
  }
  const nothingReason =
    edgeBlocked > 0 && affected.length === 0
      ? `${def.name} zones must be within ${GAME.agriculturalEdgeBand} tiles of the map edge.`
      : 'Nothing to zone here.';
  return finalisePlan(
    state,
    affected,
    blocked,
    affected.length * def.costPerTile,
    ['zone'],
    nothingReason,
  );
}

export function applyZone(state: SimState, cmd: ZoneCommand, plan: CommandPlan): void {
  const def = zoneType(cmd.zone);
  const densityCode = def.hasDensity ? densityDef(cmd.density).code : 0;
  const w = state.world;
  for (const i of plan.affected) {
    w.zone[i] = def.code;
    w.density[i] = densityCode;
  }
}
