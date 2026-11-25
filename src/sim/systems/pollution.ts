import { updatePollution } from '../pollution';
import { MINUTES_PER_HOUR } from '../time';
import type { SimSystem } from './types';

/** Hourly air and noise pollution (at 3 past, clear of the power dispatch ticks). */
export const pollutionSystem: SimSystem = {
  id: 'pollution',
  tick({ state }) {
    if (state.minute % MINUTES_PER_HOUR === 3) updatePollution(state);
  },
};
