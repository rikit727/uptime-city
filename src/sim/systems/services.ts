import { SERVICES } from '../data';
import { eventLitterTonnes } from '../cityEvents';
import { binComplaints } from '../happiness';
import { collectWaste, updateRatios } from '../services';
import { MINUTES_PER_DAY, MINUTES_PER_HOUR } from '../time';
import type { SimSystem } from './types';

/**
 * Hourly service capacity (served shares, :06) and the daily waste collection
 * (:21 past `collectionHour`). Both sit on minutes ≡ 1 (mod 5), clear of the power
 * dispatch (≡ 0), the water solve (≡ 2) and the traffic round start (≡ 1 mod 15).
 */
const RATIO_MINUTE = 6;
const WASTE_MINUTE = 21;
export const servicesSystem: SimSystem = {
  id: 'services',
  tick({ state }) {
    if (state.minute % MINUTES_PER_HOUR === RATIO_MINUTE) updateRatios(state);
    if (
      state.minute % MINUTES_PER_DAY ===
      SERVICES.waste.collectionHour * MINUTES_PER_HOUR + WASTE_MINUTE
    ) {
      binComplaints(state, collectWaste(state, eventLitterTonnes(state)));
    }
  },
};
