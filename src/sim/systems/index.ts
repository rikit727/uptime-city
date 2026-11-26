/**
 * Tick order. Every tick runs these systems front to back. Keep this list the
 * single source of truth and document changes in ARCHITECTURE.md ("Sim tick order").
 */
import { assetsSystem } from './assets';
import { clockSystem } from './clock';
import { demandSystem } from './demand';
import { economySystem } from './economy';
import { eventsSystem } from './events';
import { fireSystem } from './fire';
import { happinessSystem } from './happiness';
import { pollutionSystem } from './pollution';
import { servicesSystem } from './services';
import { growthSystem } from './growth';
import { incidentsSystem } from './incidents';
import { kpiSystem } from './kpis';
import { scenarioSystem } from './scenario';
import { powerSystem } from './power';
import { trafficSystem } from './traffic';
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
  trafficSystem,
  assetsSystem,
  incidentsSystem,
  fireSystem,
  eventsSystem,
  servicesSystem,
  growthSystem,
  pollutionSystem,
  economySystem,
  happinessSystem,
  kpiSystem,
  scenarioSystem,
];
