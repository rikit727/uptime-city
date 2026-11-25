import { POWER } from '../data';
import { dispatchPower } from '../power';
import type { SimSystem } from './types';

/** Power dispatch every `dispatchIntervalMinutes`: generation, storage and rolling outages. */
export const powerSystem: SimSystem = {
  id: 'power',
  tick({ state, emit, touch }) {
    if (state.tick % POWER.dispatchIntervalMinutes !== 0) return;
    if (dispatchPower(state, emit)) touch('supply');
  },
};
