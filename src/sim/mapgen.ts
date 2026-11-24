/**
 * Terrain generation. v1 terrain is flat land with one river running from the
 * north edge to the south edge; the river is the raw water source for later
 * milestones. Same seed => same map.
 */
import { GAME } from './data';
import { Rng, seedState } from './rng';
import { Terrain } from './types';
import { tileIndex } from './world';
import type { WorldState } from './world';

/** RNG stream id for map generation, so it never shares a sequence with the live sim. */
const MAPGEN_STREAM = 1;

export function generateTerrain(world: WorldState, seed: number): void {
  const rng = new Rng(seedState(seed, MAPGEN_STREAM));
  const { width, height } = world;
  const { minWidth, maxWidth } = GAME.river;

  // Centre line: starts in the middle third, wanders with two sine waves plus a random walk.
  // Per-row movement stays under the minimum width, so the river is one connected body.
  const cx = rng.range(width * 0.38, width * 0.62);
  const amp1 = rng.range(4, 9);
  const freq1 = rng.range(0.02, 0.04);
  const phase1 = rng.range(0, Math.PI * 2);
  const amp2 = rng.range(1.5, 3.5);
  const freq2 = rng.range(0.07, 0.12);
  const phase2 = rng.range(0, Math.PI * 2);
  let drift = 0;
  const margin = Math.max(24, GAME.agriculturalEdgeBand + 4);

  for (let y = 0; y < height; y++) {
    drift += rng.range(-0.35, 0.35);
    drift = Math.max(-6, Math.min(6, drift));
    const centre =
      cx + amp1 * Math.sin(y * freq1 + phase1) + amp2 * Math.sin(y * freq2 + phase2) + drift;
    const clamped = Math.max(margin, Math.min(width - 1 - margin, centre));
    const halfWidth =
      (minWidth + (maxWidth - minWidth) * (0.5 + 0.5 * Math.sin(y * 0.05 + phase2))) / 2;
    const x0 = Math.round(clamped - halfWidth);
    const x1 = Math.round(clamped + halfWidth);
    for (let x = x0; x < x1; x++) {
      if (x >= 0 && x < width) world.terrain[tileIndex(world, x, y)] = Terrain.Water;
    }
  }
}
