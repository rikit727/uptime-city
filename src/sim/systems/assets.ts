import { decaySlice } from '../decay';
import type { SimSystem } from './types';

/** Daily asset decay and failure rolls, swept across the map a slice per tick. */
export const assetsSystem: SimSystem = {
  id: 'assets',
  tick({ state, emit, touch }) {
    if (decaySlice(state, emit)) {
      touch('assets');
      touch('power');
      touch('water');
    }
  },
};
