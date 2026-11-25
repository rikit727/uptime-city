import { WATER } from '../data';
import { finishRound, solveNetwork, startWaterDay } from '../water';
import type { SimSystem } from './types';

/**
 * Water supply, pressure and wastewater. Every `solveIntervalMinutes` a round
 * starts: one solvable network per tick, then a finish step. The cursor is saved.
 */
export const waterSystem: SimSystem = {
  id: 'water',
  tick({ state, emit, touch }) {
    startWaterDay(state);
    const ws = state.water;
    const cache = state.cache;
    if (ws.cursor < 0) {
      if (state.tick % WATER.solveIntervalMinutes !== WATER.solveOffset) return;
      ws.cursor = 0;
      cache.waterRound = [];
    }
    const L = cache.water;
    const id = L.solvable[ws.cursor];
    const net = id === undefined ? undefined : L.networks[id - 1];
    if (net) {
      cache.waterRound.push(solveNetwork(state, net));
      ws.cursor++;
    } else {
      cache.waterStats = finishRound(state, cache.waterRound, emit);
      ws.cursor = -1;
    }
    touch('water');
  },
};
