/**
 * Read-only questions the UI asks about the city (service levels, land value,
 * pollution, happiness, taxes, street names, fires). Bound to one state by
 * the Simulation and exposed on the snapshot, so the UI never needs SimState.
 * None of these change saved state (some fill derived caches).
 */
import { measureCost } from './cityEvents';
import { streetName } from './complaints';
import { backlog, dailyTaxes, dailyUpkeep, dutyCrews, loanPayment, totalDebt } from './economy';
import { appliancesOnSite, fireOf, waterShare } from './fire';
import { homeFactors, homeHappiness } from './happiness';
import type { HappinessScores } from './happiness';
import { landValueOf, landValueOfTile, pollutionAt } from './pollution';
import type { PollutionKind } from './pollution';
import {
  accessOf,
  binsMissed,
  coverageMinutes,
  landfillUsed,
  serviceLevel,
  wasteTonnes,
} from './services';
import type { AssetRef, Building, CityEvent, Fire, SimState } from './state';
import type { CoverageKind, CrewType, EventMeasure } from './types';

export interface CityView {
  serviceLevel(b: Building, kind: CoverageKind): number;
  /** Free-flow minutes from the nearest facility of a kind (Infinity = out of reach). */
  coverageMinutes(b: Building, kind: CoverageKind): number;
  /** Served share of a police station, health centre, school or waste depot (1 if none). */
  facilityRatio(id: number): number;
  landValue(b: Building): number;
  landValueAtTile(tile: number): number;
  pollution(kind: PollutionKind, tile: number): number;
  happiness(b: Building): number;
  happinessFactors(b: Building): HappinessScores;
  binsMissed(b: Building): boolean;
  wasteTonnes(b: Building): number;
  dailyTaxes(b: Building): { councilTax: number; businessRates: number; farmExports: number };
  dailyUpkeep(b: Building): number;
  dutyCrews(b: Building): number;
  landfillUsed(id: number): number;
  streetName(tile: number): string;
  fireAt(buildingId: number): Fire | undefined;
  enginesOnSite(f: Fire): number;
  fireWater(f: Fire): number;
  /** Assets of a crew type below a condition, worst first (scans the map: call sparingly). */
  backlog(crew: CrewType, below: number): AssetRef[];
  measureCost(e: CityEvent, m: EventMeasure): number;
  totalDebt(): number;
  loanPayment(amount: number): number;
}

export function cityView(state: SimState): CityView {
  return {
    serviceLevel: (b, k) => serviceLevel(state, b, k),
    coverageMinutes: (b, k) => coverageMinutes(state, k, accessOf(state, b)),
    facilityRatio: (id) => state.cache.services.ratio.get(id) ?? 1,
    landValue: (b) => landValueOf(state, b),
    landValueAtTile: (t) => landValueOfTile(state, t),
    pollution: (k, t) => pollutionAt(state, k, t),
    happiness: (b) => homeHappiness(state, b),
    happinessFactors: (b) => homeFactors(state, b),
    binsMissed: (b) => binsMissed(state, b),
    wasteTonnes: (b) => wasteTonnes(b),
    dailyTaxes: (b) => dailyTaxes(state, b),
    dailyUpkeep: (b) => dailyUpkeep(state, b),
    dutyCrews: (b) => dutyCrews(state, b),
    landfillUsed: (id) => landfillUsed(state, id),
    streetName: (t) => streetName(state.world, t),
    fireAt: (id) => fireOf(state, id),
    enginesOnSite: (f) => appliancesOnSite(state, f),
    fireWater: (f) => waterShare(state, f),
    backlog: (c, below) => backlog(state, c, below),
    measureCost,
    totalDebt: () => totalDebt(state),
    loanPayment,
  };
}
