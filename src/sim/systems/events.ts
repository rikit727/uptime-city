import { tickEvents } from '../cityEvents';
import { rebuildFaults } from '../incidents';
import type { SimSystem } from './types';

/** The events calendar: booking events at landmarks, crowd windows, outcomes. */
export const eventsSystem: SimSystem = {
  id: 'events',
  tick({ state, emit, touch }) {
    if (state.events.length === 0 && state.minute % 1440 !== 0) return;
    if (tickEvents(state, emit)) {
      // Roads beside a venue opened or closed.
      rebuildFaults(state);
      touch('traffic');
      touch('assets');
    }
  },
};
