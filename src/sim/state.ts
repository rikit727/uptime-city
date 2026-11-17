/**
 * The complete simulation state. Everything that must survive a save/load or
 * feed the determinism hash lives here; nothing else in the sim is authoritative.
 */
import { GAME } from './data';
import { generateTerrain } from './mapgen';
import { Rng, seedState } from './rng';
import { createWorld } from './world';
import type { WorldState } from './world';

/** RNG stream id for the live simulation. */
export const SIM_STREAM = 0;

export interface SimState {
  /** Seed the game was created from. */
  readonly seed: number;
  /** Ticks run since the game started. */
  tick: number;
  /** Absolute game minute (see time.ts). */
  minute: number;
  /** The live simulation RNG. Its state is saved. */
  rng: Rng;
  /** Cash balance in whole pounds. Can go negative later via loans. */
  cash: number;
  world: WorldState;
}

export interface NewGameOptions {
  seed: number;
  startingCash?: number;
  mapSize?: number;
}

export function createInitialState(opts: NewGameOptions): SimState {
  const size = opts.mapSize ?? GAME.mapSize;
  const world = createWorld(size, size);
  generateTerrain(world, opts.seed);
  return {
    seed: opts.seed >>> 0,
    tick: 0,
    minute: GAME.startMinute,
    rng: new Rng(seedState(opts.seed, SIM_STREAM)),
    cash: opts.startingCash ?? GAME.startingCash,
    world,
  };
}
