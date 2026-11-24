import { growSlice, updateOccupancy } from '../growth';
import { MINUTES_PER_HOUR } from '../time';
import type { SimSystem } from './types';

/** Building growth (a slice of tiles per tick) and hourly occupancy changes. */
export const growthSystem: SimSystem = {
  id: 'growth',
  tick({ state, touch }) {
    if (growSlice(state) > 0) touch('building');
    if (state.minute % MINUTES_PER_HOUR === 0) updateOccupancy(state);
  },
};
