/**
 * Deterministic state hash (FNV-1a, 32-bit) over the serialised state. Used by
 * the determinism tests and handy for debugging desyncs.
 */
import { serializeState } from './serialize';
import type { SimState } from './state';

export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashState(state: SimState): string {
  return fnv1a(JSON.stringify(serializeState(state)))
    .toString(16)
    .padStart(8, '0');
}
