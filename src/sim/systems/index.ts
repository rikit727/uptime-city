/**
 * Tick order. Every tick runs these systems front to back. Keep this list the
 * single source of truth and document changes in ARCHITECTURE.md ("Sim tick order").
 */
import { clockSystem } from './clock';
import type { SimSystem } from './types';

export type { SimSystem, TickContext } from './types';

export const SYSTEMS: readonly SimSystem[] = [clockSystem];
