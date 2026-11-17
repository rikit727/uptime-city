import { Simulation } from '../../src/sim/simulation';
import { createInitialState } from '../../src/sim/state';
import { Terrain } from '../../src/sim/types';
import { tileIndex } from '../../src/sim/world';

/**
 * A 128×128 game with a controlled map: all land except a straight river in
 * columns 60..62. Tests can rely on exact tile positions.
 */
export function testSim(cash = 1_000_000): Simulation {
  const state = createInitialState({ seed: 1, startingCash: cash });
  const w = state.world;
  w.terrain.fill(Terrain.Land);
  for (let y = 0; y < w.height; y++) {
    for (let x = 60; x <= 62; x++) w.terrain[tileIndex(w, x, y)] = Terrain.Water;
  }
  return new Simulation(state);
}

export const at = (sim: Simulation, x: number, y: number): number =>
  tileIndex(sim.state.world, x, y);
