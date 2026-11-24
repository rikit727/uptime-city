import { tickWeather } from '../weather';
import type { SimSystem } from './types';

/** Seasons and weather: daily and hourly rolls, per-tick temperature and sunshine. */
export const weatherSystem: SimSystem = {
  id: 'weather',
  tick({ state, emit }) {
    tickWeather(state, emit);
  },
};
