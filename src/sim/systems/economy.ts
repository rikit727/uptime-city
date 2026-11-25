import { tickEconomy } from '../economy';
import type { SimSystem } from './types';

/** Hourly taxes, tariffs and running costs; crews on duty; daily maintenance; monthly accounts. */
export const economySystem: SimSystem = {
  id: 'economy',
  tick({ state, emit, touch }) {
    if (tickEconomy(state, emit)) touch('assets');
  },
};
