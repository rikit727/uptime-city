import { computeDemand } from '../growth';
import { MINUTES_PER_HOUR } from '../time';
import type { SimSystem } from './types';

/** Recomputes zone demand from city totals once per game hour. */
export const demandSystem: SimSystem = {
  id: 'demand',
  tick({ state }) {
    if (state.minute % MINUTES_PER_HOUR === 0) state.demand = computeDemand(state);
  },
};
