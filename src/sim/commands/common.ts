import type { SimState } from '../state';
import type { TileCoord } from '../types';
import { inBounds, tileIndex } from '../world';
import type { CommandPlan, Layer } from './types';

/** Convert coords to tile indices, dropping any outside the map. */
export function indicesInBounds(state: SimState, tiles: readonly TileCoord[]): number[] {
  const w = state.world;
  const out: number[] = [];
  for (const t of tiles) if (inBounds(w, t.x, t.y)) out.push(tileIndex(w, t.x, t.y));
  return out;
}

export function isValidCoord(c: unknown): c is TileCoord {
  if (typeof c !== 'object' || c === null) return false;
  const { x, y } = c as Record<string, unknown>;
  return Number.isInteger(x) && Number.isInteger(y);
}

export function rejected(reason: string, blocked: number[] = []): CommandPlan {
  return { ok: false, reason, cost: 0, affected: [], blocked, layers: [] };
}

/** Finish a plan: fail if nothing changes or the player cannot afford it. */
export function finalisePlan(
  state: SimState,
  affected: number[],
  blocked: number[],
  cost: number,
  layers: Layer[],
  nothingReason: string,
): CommandPlan {
  if (affected.length === 0) {
    return { ok: false, reason: nothingReason, cost: 0, affected, blocked, layers: [] };
  }
  if (cost > state.cash) {
    return {
      ok: false,
      reason: `Not enough cash: this costs £${cost.toLocaleString('en-GB')}.`,
      cost,
      affected,
      blocked,
      layers,
    };
  }
  return { ok: true, cost, affected, blocked, layers };
}
