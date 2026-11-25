import { tickFires } from '../fire';
import type { SimSystem } from './types';

/** Building fires: the hourly ignition roll, growth and firefighting, burnt-out buildings. */
export const fireSystem: SimSystem = {
  id: 'fire',
  tick({ state, emit, touch }) {
    if (state.fires.length === 0 && state.minute % 60 !== 33) return;
    const r = tickFires(state, emit);
    if (r.changed) touch('assets');
    if (r.buildings) touch('building');
  },
};
