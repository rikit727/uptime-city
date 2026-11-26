/**
 * A fully built 128×128 map for profiling (milestone 8): a straight river near
 * the east edge, so the city generator fills almost the whole map (16 × 17
 * blocks, every service, depot and landmark, about 4,000 buildings), then a
 * day's warm-up so every round has run once. Used by `profile.perf.ts`
 * (`npm run profile`) and the big-map save written for browser profiling.
 */
import { generateCity } from '../../src/sim/cityGen';
import type { CityParams } from '../../src/sim/cityGen';
import { rebuildCache } from '../../src/sim/cache';
import { createInitialState, initialEconomyState } from '../../src/sim/state';
import type { SimState } from '../../src/sim/state';
import { Simulation } from '../../src/sim/simulation';
import { MINUTES_PER_DAY, MINUTES_PER_HOUR } from '../../src/sim/time';
import { Terrain } from '../../src/sim/types';
import { initWeather } from '../../src/sim/weather';
import { tileIndex } from '../../src/sim/world';

export const BIG_CITY: CityParams = {
  blocksAlong: 17,
  blocksAcross: 16,
  zoneMix: { residential: 0.55, commercial: 0.12, office: 0.1, industrial: 0.23 },
  farms: 6,
  occupancy: [0.8, 1],
  ageYears: [5, 35],
  condition: [40, 95],
  facilities: [
    'stadium',
    'shoppingCentre',
    'hospital',
    'university',
    'conferenceCentre',
    'roadsDepot',
    'waterDepot',
    'powerDepot',
    'fireStation',
    'fireStation',
    'policeStation',
    'policeStation',
    'healthCentre',
    'healthCentre',
    'school',
    'school',
    'school',
    'wasteDepot',
    'wasteDepot',
    'recyclingCentre',
    'landfill',
  ],
  gasPlants: 4,
  extraIntakes: 4,
  storage: 'serviceReservoir',
};

/** Build the big city (about 1 s) and run `warmUpMinutes` of sim. */
export function bigCity(warmUpMinutes = MINUTES_PER_DAY): Simulation {
  const state: SimState = createInitialState({ seed: 8, startingCash: 1_000_000_000 });
  const w = state.world;
  w.terrain.fill(Terrain.Land);
  for (let y = 0; y < w.height; y++)
    for (let x = 119; x <= 121; x++) w.terrain[tileIndex(w, x, y)] = Terrain.Water;
  state.minute = 30 * MINUTES_PER_DAY + 6 * MINUTES_PER_HOUR; // summer 1, 06:00
  initWeather(state);
  generateCity(state, BIG_CITY, 8);
  state.cash = 50_000_000;
  state.economy = initialEconomyState();
  rebuildCache(state);
  const sim = new Simulation(state);
  sim.step(warmUpMinutes);
  sim.drainEvents();
  return sim;
}
