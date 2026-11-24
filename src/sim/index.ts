/** Public surface of the simulation. Code outside src/sim should import from here. */
export { Simulation, replay } from './simulation';
export type { LoggedCommand, Revisions, SimSnapshot } from './simulation';
export type { Command, CommandPlan, CommandResult, CommandType, Layer } from './commands';
export type { SimEvent } from './events';
export type { SimState, NewGameOptions } from './state';
export { serializeState, deserializeState } from './serialize';
export type { SerializedState } from './serialize';
export { hashState } from './hash';
export { roadPath, rectTiles } from './geometry';
export * from './data';
export * from './time';
export * from './types';
export { tileIndex, inBounds, coordOf, edgeDistance } from './world';
export type { WorldState } from './world';
