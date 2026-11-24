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

/**
 * A small powered neighbourhood on the left bank: an avenue along y = 20
 * (x 5..40), zoning on y 21..26 (x 5..30) of the given kind, and a gas plant at
 * (5, 30) with a substation right next to it at (8, 30), so the zone is covered.
 */
export function poweredTown(
  sim: Simulation,
  zone: 'residential' | 'commercial' | 'office' | 'industrial' = 'residential',
  density: 'low' | 'medium' | 'high' = 'low',
): void {
  const ok = (r: { ok: boolean; reason?: string }) => {
    if (!r.ok) throw new Error(r.reason);
  };
  ok(
    sim.dispatch({
      type: 'buildRoad',
      roadClass: 'avenue',
      from: { x: 5, y: 20 },
      to: { x: 40, y: 20 },
    }),
  );
  ok(sim.dispatch({ type: 'zone', zone, density, from: { x: 5, y: 21 }, to: { x: 30, y: 26 } }));
  ok(sim.dispatch({ type: 'placeFacility', facility: 'gasPlant', at: { x: 5, y: 30 } }));
  ok(sim.dispatch({ type: 'placeFacility', facility: 'substation', at: { x: 8, y: 30 } }));
}
