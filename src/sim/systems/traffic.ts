import { tickTraffic } from '../traffic';
import type { SimSystem } from './types';

/**
 * Traffic assignment, sliced across ticks: a round starts every
 * `assignIntervalMinutes` and processes origin cells within a search budget per
 * tick (cursor and partial flows saved). Runs before assets so road wear sees
 * the latest flows.
 */
export const trafficSystem: SimSystem = {
  id: 'traffic',
  tick({ state, touch }) {
    if (tickTraffic(state)) touch('traffic');
  },
};
