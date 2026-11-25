/**
 * Tick order. Every tick runs these systems front to back. Keep this list the
 * single source of truth and document changes in ARCHITECTURE.md ("Sim tick order").
 */
import { assetsSystem } from './assets';
import { clockSystem } from './clock';
import { demandSystem } from './demand';
import { growthSystem } from './growth';
import { incidentsSystem } from './incidents';
import { powerSystem } from './power';
import { waterSystem } from './water';
import type { SimSystem } from './types';
import { weatherSystem } from './weather';

export type { SimSystem, TickContext } from './types';

export const SYSTEMS: readonly SimSystem[] = [
  clockSystem,
  weatherSystem,
  demandSystem,
  powerSystem,
  waterSystem,
  assetsSystem,
  incidentsSystem,
  growthSystem,
];
