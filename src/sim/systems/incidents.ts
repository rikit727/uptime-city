import { tickIncidents } from '../incidents';
import type { SimSystem } from './types';

/** Incidents, work orders and crews: arrivals, repairs, dispatch, impacts and SLA timers. */
export const incidentsSystem: SimSystem = {
  id: 'incidents',
  tick({ state, emit, touch }) {
    if (tickIncidents(state, emit)) touch('assets');
  },
};
