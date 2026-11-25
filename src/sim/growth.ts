/**
 * Zone demand and building growth.
 *
 * Demand (hourly): residential demand is driven by jobs versus workers; job
 * zones by what the population can support (growth.json `demand`). Values are -1..1.
 *
 * Growth (every tick, sliced): a cursor walks `scanTilesPerTick` tiles per tick.
 * An empty zoned tile can sprout a building if its zone has positive demand,
 * a substation that can draw power covers it, and a building type for that
 * zone and density fits with the tile as its top-left corner and a road along
 * its edge. Occupancy then grows hourly with demand while powered, and falls
 * after a long outage. Land value, services and commute times join the growth
 * test in later milestones (see ARCHITECTURE.md decision log).
 */
import { GROWTH, zoneTypeByCode, grownTypesFor } from './data';
import type { GrownBuildingDef } from './data';
import { addBuilding, grownDefOf, jobsOf, residentsOf } from './buildings';
import { isEnergised } from './power';
import type { Building, SimState } from './state';
import { Terrain } from './types';
import type { ZoneId } from './types';
import { inBounds, tileIndex } from './world';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export interface CityTotals {
  residents: number;
  jobs: number;
  jobsByZone: Record<ZoneId, number>;
  buildings: number;
}

export function cityTotals(state: { readonly buildings: readonly Building[] }): CityTotals {
  const jobsByZone: Record<ZoneId, number> = {
    residential: 0,
    commercial: 0,
    office: 0,
    industrial: 0,
    agricultural: 0,
  };
  let residents = 0;
  let jobs = 0;
  for (const b of state.buildings) {
    residents += residentsOf(b);
    const j = jobsOf(b);
    jobs += j;
    const def = grownDefOf(b);
    if (def) jobsByZone[def.zone] += j;
  }
  return { residents, jobs, jobsByZone, buildings: state.buildings.length };
}

export function computeDemand(state: SimState): Record<ZoneId, number> {
  const d = GROWTH.demand;
  const t = cityTotals(state);
  const R = t.residents;
  const ratio = (target: number, have: number): number =>
    clamp((target - have) / Math.max(target, d.minScale), -1, 1);
  const jobsAvailable = t.jobs + d.bootstrapJobs;
  return {
    residential: ratio(jobsAvailable, R * d.workforcePerResident),
    commercial: ratio(
      d.baseCommercialJobs + R * d.commercialJobsPerResident,
      t.jobsByZone.commercial,
    ),
    office: ratio(d.baseOfficeJobs + R * d.officeJobsPerResident, t.jobsByZone.office),
    industrial: ratio(
      d.baseIndustrialJobs + R * d.industrialJobsPerResident,
      t.jobsByZone.industrial,
    ),
    agricultural: ratio(
      d.baseAgriculturalJobs + R * d.agriculturalJobsPerResident,
      t.jobsByZone.agricultural,
    ),
  };
}

/** Can `def` be built with its top-left corner at (x, y)? */
export function fitsAt(state: SimState, def: GrownBuildingDef, x: number, y: number): boolean {
  const w = state.world;
  const [fw, fd] = def.footprint;
  if (!inBounds(w, x, y) || !inBounds(w, x + fw - 1, y + fd - 1)) return false;
  const origin = tileIndex(w, x, y);
  const zone = w.zone[origin]!;
  const dens = w.density[origin]!;
  for (let dy = 0; dy < fd; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      const t = tileIndex(w, x + dx, y + dy);
      if (w.zone[t] !== zone || w.density[t] !== dens) return false;
      if (w.road[t] !== 0 || w.power[t] !== 0 || w.terrain[t] !== Terrain.Land) return false;
      if (state.cache.buildingAt[t] !== 0) return false;
    }
  }
  // Road access: a road on any tile bordering the footprint.
  for (let dx = 0; dx < fw; dx++) {
    if (y > 0 && w.road[tileIndex(w, x + dx, y - 1)] !== 0) return true;
    if (y + fd < w.height && w.road[tileIndex(w, x + dx, y + fd)] !== 0) return true;
  }
  for (let dy = 0; dy < fd; dy++) {
    if (x > 0 && w.road[tileIndex(w, x - 1, y + dy)] !== 0) return true;
    if (x + fw < w.width && w.road[tileIndex(w, x + fw, y + dy)] !== 0) return true;
  }
  return false;
}

/** Scan the next slice of tiles and grow buildings. Returns how many were added. */
export function growSlice(state: SimState, count = GROWTH.scanTilesPerTick): number {
  const w = state.world;
  const n = w.width * w.height;
  let added = 0;
  for (let k = 0; k < count; k++) {
    const t = state.growthCursor;
    state.growthCursor = (state.growthCursor + 1) % n;
    const z = w.zone[t]!;
    if (z === 0 || state.cache.buildingAt[t] !== 0 || w.road[t] !== 0 || w.power[t] !== 0) continue;
    const zone = zoneTypeByCode(z);
    if (!zone) continue;
    const demand = state.demand[zone.id];
    if (demand <= 0 || !isEnergised(state, t)) continue;
    if (!state.rng.chance(GROWTH.spawnChance * demand)) continue;
    const x = t % w.width;
    const y = (t - x) / w.width;
    const options = grownTypesFor(z, w.density[t]!).filter((def) => fitsAt(state, def, x, y));
    if (options.length === 0) continue;
    const total = options.reduce((s, d) => s + d.weight, 0);
    let pick = state.rng.next() * total;
    let def = options[options.length - 1]!;
    for (const o of options) {
      pick -= o.weight;
      if (pick < 0) {
        def = o;
        break;
      }
    }
    addBuilding(state, def.code, x, y, GROWTH.initialOccupancy);
    added++;
  }
  return added;
}

/** Hourly occupancy change for every grown building. */
export function updateOccupancy(state: SimState): void {
  for (const b of state.buildings) {
    const def = grownDefOf(b);
    if (!def) continue;
    if (b.unpoweredMinutes > GROWTH.outageGraceMinutes) {
      b.occupancy = clamp(b.occupancy - GROWTH.occupancyDeclinePerHour, 0, 1);
    } else if (b.unpoweredMinutes === 0) {
      b.occupancy = clamp(
        b.occupancy + GROWTH.occupancyGrowthPerHour * state.demand[def.zone],
        0,
        1,
      );
    }
  }
}
