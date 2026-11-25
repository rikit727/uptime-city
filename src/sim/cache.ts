/**
 * Rebuilds SimState.cache from the saved fields. Called for new games and
 * after loading; commands call the individual rebuilds (estates, power
 * network, water layout, traffic segments) when they change the layout. Everything here must be a pure function of the saved state.
 */
import { rebuildBuildingIndex } from './buildings';
import { rebuildEstates } from './estates';
import { rebuildFaults } from './incidents';
import { rebuildNetwork } from './power';
import { rebuildTraffic } from './traffic';
import type { SimState } from './state';
import { rebuildWater } from './water';

export function rebuildCache(state: SimState): void {
  rebuildBuildingIndex(state);
  rebuildEstates(state);
  rebuildFaults(state);
  rebuildNetwork(state);
  rebuildWater(state);
  rebuildTraffic(state);
}
