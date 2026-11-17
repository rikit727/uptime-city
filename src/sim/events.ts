/**
 * Events the sim emits for the outside world (UI toasts, autosave, audio later).
 * They are notifications only: never part of the state and never read back by the sim.
 */
export type SimEvent =
  { type: 'dayStarted'; day: number } | { type: 'commandApplied'; command: string; cost: number };
