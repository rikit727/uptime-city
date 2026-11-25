/**
 * Rebuilds SimState.cache from the saved fields. Called for new games and
 * after loading; commands call the individual rebuilds when they change the
 * layout. Everything here must be a pure function of the saved state.
 */
import { rebuildBuildingIndex } from './buildings';
import { rebuildEstates } from './estates';
import { rebuildNetwork } from './power';
import type { SimState } from './state';

export function rebuildCache(state: SimState): void {
  rebuildBuildingIndex(state);
  rebuildEstates(state);
  rebuildNetwork(state);
}
