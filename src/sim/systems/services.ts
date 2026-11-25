import { SERVICES } from '../data';
import { eventLitterTonnes } from '../cityEvents';
import { binComplaints } from '../happiness';
import { collectWaste, updateRatios } from '../services';
import { MINUTES_PER_DAY, MINUTES_PER_HOUR } from '../time';
import type { SimSystem } from './types';

/** Hourly service capacity (served shares) and the daily waste collection. */
export const servicesSystem: SimSystem = {
  id: 'services',
  tick({ state }) {
    if (state.minute % MINUTES_PER_HOUR === 7) updateRatios(state);
    if (state.minute % MINUTES_PER_DAY === SERVICES.waste.collectionHour * MINUTES_PER_HOUR + 17) {
      binComplaints(state, collectWaste(state, eventLitterTonnes(state)));
    }
  },
};
