import type { Layer } from '../commands/types';
import type { SimEvent } from '../events';
import type { SimState } from '../state';

export interface TickContext {
  readonly state: SimState;
  emit(event: SimEvent): void;
  /** Mark a render layer as changed (bumps Simulation.revisions). */
  touch(layer: Layer): void;
}

/**
 * A simulation system runs once per tick, in the order listed in
 * systems/index.ts. Systems with heavy work should spread it across ticks
 * (e.g. process a slice of the network each tick) to stay inside the frame budget.
 */
export interface SimSystem {
  readonly id: string;
  tick(ctx: TickContext): void;
}
