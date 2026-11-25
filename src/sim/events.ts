/**
 * Events the sim emits for the outside world (UI toasts, autosave, audio later).
 * They are notifications only: never part of the state and never read back by the sim.
 */
import type { WeatherEventId } from './types';

export type SimEvent =
  | { type: 'dayStarted'; day: number }
  | { type: 'commandApplied'; command: string; cost: number }
  | { type: 'weatherEventStarted'; event: WeatherEventId; name: string; days: number }
  | { type: 'weatherEventEnded'; event: WeatherEventId; name: string }
  | { type: 'powerShortfall'; shedMW: number; buildingsOff: number }
  | { type: 'powerRestored' }
  | { type: 'waterSupplyLost'; buildings: number; residents: number }
  | { type: 'waterSupplyRestored' }
  | { type: 'priorityCustomersWithoutWater'; buildings: number }
  | { type: 'sewerOverflow'; spillLps: number }
  | { type: 'sewerOverflowEnded'; spilledMl: number }
  | { type: 'abstractionLicenceBreached'; usedMl: number; licenceMl: number }
  | { type: 'irrigationLicenceReached'; licenceMl: number };
