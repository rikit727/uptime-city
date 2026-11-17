import { MINUTES_PER_DAY, dayOf } from '../time';
import type { SimSystem } from './types';

/** Advances game time by one minute and announces each new day. */
export const clockSystem: SimSystem = {
  id: 'clock',
  tick({ state, emit }) {
    state.tick += 1;
    state.minute += 1;
    if (state.minute % MINUTES_PER_DAY === 0)
      emit({ type: 'dayStarted', day: dayOf(state.minute) });
  },
};
