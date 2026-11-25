import type { Command } from '../../src/sim/commands';
import { Simulation } from '../../src/sim/simulation';
import { createInitialState } from '../../src/sim/state';
import { Terrain } from '../../src/sim/types';
import type { TileCoord } from '../../src/sim/types';
import { tileIndex } from '../../src/sim/world';
import type { WorldState } from '../../src/sim/world';

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

const ok = (r: { ok: boolean; reason?: string }) => {
  if (!r.ok) throw new Error(r.reason);
};

/**
 * Water for the test map: a river intake at (58, 16) on the left bank, a
 * treatment works at (55, 15), a feeder main along y = 18 to the end of the
 * poweredTown avenue at (40, 20), and a substation at (50, 14) fed by a line
 * from the town's substation at (8, 30). Call after poweredTown().
 */
export function waterSupply(sim: Simulation): void {
  ok(sim.dispatch({ type: 'placeFacility', facility: 'intake', at: { x: 58, y: 16 } }));
  ok(sim.dispatch({ type: 'placeFacility', facility: 'treatmentWorks', at: { x: 55, y: 15 } }));
  ok(
    sim.dispatch({
      type: 'buildMain',
      main: 'feeder',
      from: { x: 56, y: 18 },
      to: { x: 40, y: 20 },
    }),
  );
  ok(sim.dispatch({ type: 'placeFacility', facility: 'substation', at: { x: 50, y: 14 } }));
  ok(
    sim.dispatch({
      type: 'buildLine',
      line: 'distribution',
      from: { x: 10, y: 30 },
      to: { x: 49, y: 14 },
    }),
  );
}

/**
 * A powered water supply on the test map's left bank at rows y..y+4: intake at
 * (58, y + 1), treatment works at (55, y), substation at (50, y + 3) fed by a
 * distribution line from `lineFrom`, and a feeder main from (54, y + 1) to `mainTo`.
 */
export function riverWater(
  sim: Simulation,
  y: number,
  mainTo: TileCoord,
  lineFrom: TileCoord,
): void {
  ok(sim.dispatch({ type: 'placeFacility', facility: 'intake', at: { x: 58, y: y + 1 } }));
  ok(sim.dispatch({ type: 'placeFacility', facility: 'treatmentWorks', at: { x: 55, y } }));
  ok(sim.dispatch({ type: 'placeFacility', facility: 'substation', at: { x: 50, y: y + 3 } }));
  ok(
    sim.dispatch({
      type: 'buildLine',
      line: 'distribution',
      from: lineFrom,
      to: { x: 49, y: y + 3 },
    }),
  );
  ok(sim.dispatch({ type: 'buildMain', main: 'feeder', from: { x: 54, y: y + 1 }, to: mainTo }));
}

/**
 * Commands for a powered water supply on a generated map: an intake on the
 * left bank of the river somewhere in rows `rows`, a treatment works beside it,
 * a substation below the works fed by a line from `lineFrom`, and a feeder main
 * from the works to `mainTo`. Throws if no site fits.
 */
export function waterSupplyCommands(
  world: WorldState,
  rows: [number, number],
  mainTo: (siteX: number) => TileCoord,
  lineFrom: TileCoord,
): Command[] {
  const land = (x: number, y: number) =>
    x >= 0 &&
    y >= 0 &&
    x < world.width &&
    y < world.height &&
    world.terrain[tileIndex(world, x, y)] === Terrain.Land;
  const firstWater = (y: number) => {
    for (let x = 0; x < world.width; x++) if (!land(x, y)) return x;
    return world.width;
  };
  for (let y = rows[0]; y <= rows[1]; y++) {
    const x0 = Math.min(firstWater(y), firstWater(y + 1)) - 2;
    let fits = x0 >= 6;
    for (let yy = y; yy <= y + 4 && fits; yy++)
      for (let xx = x0 - 4; xx <= x0 + 1; xx++) if (!land(xx, yy)) fits = false;
    if (!fits) continue;
    return [
      { type: 'placeFacility', facility: 'intake', at: { x: x0, y } },
      { type: 'placeFacility', facility: 'treatmentWorks', at: { x: x0 - 3, y } },
      { type: 'placeFacility', facility: 'substation', at: { x: x0 - 3, y: y + 3 } },
      { type: 'buildLine', line: 'distribution', from: lineFrom, to: { x: x0 - 4, y: y + 3 } },
      { type: 'buildMain', main: 'feeder', from: { x: x0 - 4, y }, to: mainTo(x0 - 4) },
    ];
  }
  throw new Error('No riverbank site for a water supply.');
}

/**
 * A small powered neighbourhood on the left bank: an avenue along y = 20
 * (x 5..40), zoning on y 21..26 (x 5..30) of the given kind, and a gas plant at
 * (5, 30) with a substation right next to it at (8, 30), so the zone is covered.
 * Pass `water = true` to add waterSupply() as well (growth needs both).
 */
export function poweredTown(
  sim: Simulation,
  zone: 'residential' | 'commercial' | 'office' | 'industrial' = 'residential',
  density: 'low' | 'medium' | 'high' = 'low',
  water = true,
): void {
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
  if (water) waterSupply(sim);
}
