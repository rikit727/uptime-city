import { tickKpis } from '../kpis';
import type { SimSystem } from './types';

/** Daily KPI history (dashboard): midnight records, 5-minute peak samples. */
export const kpiSystem: SimSystem = {
  id: 'kpis',
  tick({ state }) {
    tickKpis(state);
  },
};
