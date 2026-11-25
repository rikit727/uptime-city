import { hourlyComplaints, tickResidentsRound } from '../happiness';
import { MINUTES_PER_HOUR } from '../time';
import type { SimSystem } from './types';

/**
 * The residents round (taxes and happiness, a slice of buildings per tick from
 * 10 past each hour) and the hourly complaint checks (at 44 past).
 */
export const happinessSystem: SimSystem = {
  id: 'happiness',
  tick({ state }) {
    tickResidentsRound(state);
    if (state.minute % MINUTES_PER_HOUR === 44) hourlyComplaints(state);
  },
};
