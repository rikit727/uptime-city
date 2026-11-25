/**
 * Events the sim emits for the outside world (UI toasts, autosave, audio later).
 * They are notifications only: never part of the state and never read back by the sim.
 */
import type { CrewType, IncidentKind, WeatherEventId } from './types';

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
  | { type: 'irrigationLicenceReached'; licenceMl: number }
  | {
      type: 'incidentOpened';
      id: number;
      kind: IncidentKind;
      name: string;
      severity: number;
      x: number;
      y: number;
    }
  | {
      type: 'incidentResolved';
      id: number;
      name: string;
      minutes: number;
      outcome: '' | 'repaired' | 'removed' | 'cleared';
    }
  | { type: 'slaBreached'; id: number; name: string }
  | {
      type: 'priorityCustomersAffected';
      id: number;
      name: string;
      buildings: number;
      /** A bottled-water response can be sent. */
      bottledWater: boolean;
    }
  | { type: 'maintenanceCompleted'; name: string; x: number; y: number }
  | { type: 'noCrew'; crew: CrewType }
  /** A new street works permit overlaps another on the same road segment. */
  | { type: 'permitClash'; id: number; other: number; x: number; y: number }
  /** Works have run past their permit's booked end. */
  | { type: 'permitOverrun'; id: number; x: number; y: number }
  | { type: 'fireOut'; name: string; street: string; minutes: number; damage: number }
  | { type: 'buildingBurntDown'; name: string; street: string; x: number; y: number }
  /** Crowds start arriving for an event at a landmark. */
  | {
      type: 'cityEventStarting';
      id: number;
      name: string;
      venue: string;
      attendance: number;
      prepared: boolean;
    }
  | {
      type: 'cityEventEnded';
      id: number;
      name: string;
      venue: string;
      attendance: number;
      trouble: boolean;
      litter: boolean;
      revenue: number;
    }
  /** A 30-day month's accounts have been filed. */
  | { type: 'monthClosed'; month: number; income: number; expenses: number; cash: number };
