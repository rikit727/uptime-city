import { tickScenario } from '../scenario';
import type { SimSystem } from './types';

/** Scenarios: timed events, objective samples every 15 minutes, the end and the score. */
export const scenarioSystem: SimSystem = {
  id: 'scenario',
  tick({ state, emit, touch }) {
    if (!state.scenario) return;
    if (tickScenario(state, emit)) touch('assets');
  },
};
