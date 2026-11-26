/**
 * Citizens' happiness and the hourly complaint checks.
 *
 * Happiness (hourly, saved; the residents round below also collects taxes):
 * every home scores 0..100 from weighted factors
 * (city.json `happiness.weights`): public services (fire, police, health and
 * school levels), utilities (power and water now; low pressure counts half),
 * waste (bins collected), commute (the cell's mean trip time), pollution (air
 * and noise at the home), taxes (the residential rate) and land value. The
 * city figure is the residents-weighted average, minus a point per complaint
 * in the last day (capped). It feeds residential demand (growth.ts).
 *
 * Complaints (hourly): long water and power outages ("No water on Mill Road
 * for 3 hours"), low pressure, jams, fumes and noise, and missing services
 * near homes. Other modules add their own (fires, events, roadworks, bins).
 */
import { CITY, WATER, buildingDef } from './data';
import { residentsOf } from './buildings';
import { addComplaint, cooldownFor, recentComplaints, streetName } from './complaints';
import { isOpen, isWaterIncident } from './incidents';
import { landValueOf, pollutionAt, pollutionShare } from './pollution';
import { accessOf, binsMissed, serviceLevel } from './services';
import type { Building, HappinessFactor, HappinessState, SimState } from './state';
import { dailyTaxes } from './economy';
import { closedByFire } from './fire';
import { earn } from './ledger';
import { cellOfTile } from './traffic';
import { linksOf } from './water';

const HW = CITY.happiness.weights;

export type HappinessScores = Record<HappinessFactor, number>;

/** Each factor 0..1 for one home. */
export function homeFactors(state: SimState, b: Building): HappinessScores {
  const w = state.world;
  const road = accessOf(state, b);
  const services =
    (serviceLevel(state, b, 'fire') +
      serviceLevel(state, b, 'police') +
      serviceLevel(state, b, 'health') +
      serviceLevel(state, b, 'school')) /
    4;
  let utilities = 1;
  if (b.unpoweredMinutes > 0) utilities -= 0.5;
  if (b.dryMinutes > 0) utilities -= 0.5;
  else {
    const def = buildingDef(b.code);
    const t = def?.role === 'grown' ? linksOf(state, b, def).service : -1;
    if (t >= 0 && w.pressure[t]! < WATER.pressure.lowM) utilities -= 0.25;
  }
  const commuteMin = road >= 0 ? (state.traffic.commute[cellOfTile(w, road)] ?? 0) / 10 : 0;
  const commute = commuteMin <= 15 ? 1 : commuteMin >= 45 ? 0 : 1 - (commuteMin - 15) / 30;
  const centre = b.y * w.width + b.x;
  const pollution =
    1 -
    0.6 * pollutionShare('air', pollutionAt(state, 'air', centre)) -
    0.4 * pollutionShare('noise', pollutionAt(state, 'noise', centre));
  const rate = state.economy.taxRates.residential;
  return {
    services,
    utilities: Math.max(0, utilities),
    waste: binsMissed(state, b) ? 0 : 1,
    commute,
    pollution,
    taxes: Math.max(0, Math.min(1, 1.5 - rate)),
    landValue: landValueOf(state, b),
  };
}

/** One home's happiness 0..100 (before the city-wide complaint penalty). */
export function homeHappiness(state: SimState, b: Building): number {
  const f = homeFactors(state, b);
  let s = 0;
  for (const k of Object.keys(HW) as HappinessFactor[]) s += HW[k] * f[k];
  return Math.max(0, Math.min(100, s));
}

/** Buildings visited per tick by the residents round. */
export const ROUND_BUILDINGS_PER_TICK = 300;
/** Minute past the hour the residents round starts. */
export const ROUND_MINUTE = 10;

const FACTOR_KEYS = Object.keys(HW) as HappinessFactor[];

/**
 * One tick of the hourly residents round: starts at `ROUND_MINUTE`, then visits
 * the next `ROUND_BUILDINGS_PER_TICK` buildings in id order, collecting an
 * hour of their taxes and adding their residents' happiness to the saved
 * partial sums; after the last building the city figure is published.
 * Returns true when a round finished.
 */
export function tickResidentsRound(state: SimState, perTick = ROUND_BUILDINGS_PER_TICK): boolean {
  const hp = state.happiness;
  if (hp.cursor < 0) {
    if (state.minute % 60 !== ROUND_MINUTE) return false;
    hp.cursor = 0;
    hp.sumWeight = 0;
    hp.sumScore = 0;
    for (const k of FACTOR_KEYS) hp.sumFactors[k] = 0;
  }
  const list = state.buildings;
  // First building with an id above the cursor (the list is in ascending id order).
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.id <= hp.cursor) lo = mid + 1;
    else hi = mid;
  }
  const taxes = { councilTax: 0, businessRates: 0, farmExports: 0 };
  const end = Math.min(list.length, lo + perTick);
  for (let k = lo; k < end; k++) {
    const b = list[k]!;
    const t = dailyTaxes(state, b);
    if (state.fires.length > 0 && closedByFire(state, b.id)) {
      // Burning or evacuated: closed, so nothing is paid this hour.
      if (state.scenario)
        state.scenario.taxLost += (t.councilTax + t.businessRates + t.farmExports) / 24;
    } else {
      taxes.councilTax += t.councilTax;
      taxes.businessRates += t.businessRates;
      taxes.farmExports += t.farmExports;
    }
    const r = residentsOf(b);
    if (r > 0) {
      const f = homeFactors(state, b);
      let sc = 0;
      for (const key of FACTOR_KEYS) {
        sc += HW[key] * f[key];
        hp.sumFactors[key] += f[key] * r;
      }
      hp.sumScore += sc * r;
      hp.sumWeight += r;
    }
    hp.cursor = b.id;
  }
  earn(state, 'councilTax', taxes.councilTax / 24);
  earn(state, 'businessRates', taxes.businessRates / 24);
  earn(state, 'farmExports', taxes.farmExports / 24);
  if (end < list.length) return false;
  finishRound(state);
  return true;
}

/** Points off happiness for water restrictions in force. */
export function restrictionPenalty(state: SimState): number {
  const r = WATER.restrictions;
  const lvl = state.water.restriction;
  return (
    (lvl >= 1 ? r.hosepipeBan.happinessPenalty : 0) +
    (lvl >= 2 ? r.irrigationBan.happinessPenalty : 0)
  );
}

function finishRound(state: SimState): void {
  const hp = state.happiness;
  const H = CITY.happiness;
  hp.complaintPenalty = Math.min(
    H.maxComplaintPenalty,
    recentComplaints(state) * H.complaintPenalty,
  );
  if (hp.sumWeight > 0) {
    for (const k of FACTOR_KEYS) {
      hp.factors[k] = Math.round((hp.sumFactors[k] / hp.sumWeight) * 1000) / 1000;
    }
    hp.city =
      Math.round(
        Math.max(0, hp.sumScore / hp.sumWeight - hp.complaintPenalty - restrictionPenalty(state)) *
          10,
      ) / 10;
  } else {
    hp.city = 0;
    for (const k of FACTOR_KEYS) hp.factors[k] = 0;
  }
  hp.cursor = -1;
}

/** Run a whole residents round now (tests and tools). */
export function updateHappiness(state: SimState): HappinessState {
  state.happiness.cursor = -1;
  const minute = state.minute;
  state.minute = minute - (minute % 60) + ROUND_MINUTE;
  try {
    while (!tickResidentsRound(state, 1e9));
  } finally {
    state.minute = minute;
  }
  return state.happiness;
}

const hoursOpen = (state: SimState, opened: number): number =>
  Math.floor((state.minute - opened) / 60);

/** Hourly complaints from what residents are living with right now. */
export function hourlyComplaints(state: SimState): void {
  const w = state.world;
  const C = CITY.complaints;
  // Long outages, at 3, 6, 12 and 24 hours (water) or 2, 4, 8 and 16 hours (power).
  for (const inc of state.incidents) {
    if (!isOpen(inc) || inc.customers <= 0 || inc.kind === 'fire') continue;
    const water = isWaterIncident(state.cache.byId, inc);
    const steps = water ? C.waterHours : C.powerHours;
    const hrs = hoursOpen(state, inc.openedMinute);
    const step = [...steps].reverse().find((s) => hrs >= s);
    if (step === undefined) continue;
    const street = streetName(w, inc.tile);
    const text = water
      ? `No water on ${street} for ${step} hours.`
      : `No power on ${street} for ${step} hours.`;
    addComplaint(state, water ? 'water' : 'power', `out:${inc.id}:${step}`, text, inc.tile);
  }
  // The worst-off home for each everyday grievance (first by id on ties).
  let lowPressure: Building | undefined;
  let fumes: { b: Building; v: number } | undefined;
  let noise: { b: Building; v: number } | undefined;
  let noSchool: Building | undefined;
  let rota: Building | undefined;
  const T = CITY.pollution.thresholds;
  for (const b of state.buildings) {
    const def = buildingDef(b.code);
    if (def?.role !== 'grown' || def.residents <= 0) continue;
    const st = linksOf(state, b, def).service;
    if (!lowPressure && b.dryMinutes === 0 && st >= 0 && w.pressure[st]! < WATER.pressure.lowM)
      lowPressure = b;
    // (Saved state only: the dispatch's shedding flag is not saved.)
    if (!rota && b.unpoweredMinutes >= 60) rota = b;
    const centre = b.y * w.width + b.x;
    const a = pollutionAt(state, 'air', centre);
    if (a >= T.air.bad && (!fumes || a > fumes.v)) fumes = { b, v: a };
    const n = pollutionAt(state, 'noise', centre);
    if (n >= T.noise.bad && (!noise || n > noise.v)) noise = { b, v: n };
    if (!noSchool && def.residents >= 14 && serviceLevel(state, b, 'school') <= 0) noSchool = b;
  }
  const at = (b: Building) => b.y * w.width + b.x;
  const street = (b: Building) =>
    streetName(w, accessOf(state, b) >= 0 ? accessOf(state, b) : at(b));
  if (lowPressure) {
    const s = street(lowPressure);
    addComplaint(
      state,
      'pressure',
      `pressure:${s}`,
      `The water barely trickles out of the taps on ${s}.`,
      at(lowPressure),
      cooldownFor('pressure'),
    );
  }
  if (rota) {
    const s = street(rota);
    addComplaint(
      state,
      'power',
      `rota:${s}`,
      `Another power cut on ${s}.`,
      at(rota),
      cooldownFor('rota'),
    );
  }
  if (fumes) {
    const s = street(fumes.b);
    addComplaint(
      state,
      'pollution',
      `fumes:${s}`,
      `Fumes from the traffic and industry on ${s} are making people ill.`,
      at(fumes.b),
      cooldownFor('pollution'),
    );
  }
  if (noise) {
    const s = street(noise.b);
    addComplaint(
      state,
      'noise',
      `noise:${s}`,
      `It is far too noisy on ${s} to sleep.`,
      at(noise.b),
      cooldownFor('noise'),
    );
  }
  if (noSchool) {
    const s = street(noSchool);
    addComplaint(
      state,
      'services',
      `school:${s}`,
      `No school within reach of ${s}.`,
      at(noSchool),
      cooldownFor('services'),
    );
  }
  // The busiest road, if it is over capacity.
  let worst = -1;
  let worstVc = C.vcComplaint;
  const cap = state.cache.traffic.capacity;
  for (let t = 0; t < w.road.length; t++) {
    if (w.road[t] === 0 || cap[t]! <= 0) continue;
    const vc = w.traffic[t]! / cap[t]!;
    if (vc > worstVc) {
      worstVc = vc;
      worst = t;
    }
  }
  if (worst >= 0) {
    const s = streetName(w, worst);
    addComplaint(
      state,
      'traffic',
      `jam:${s}`,
      `Stuck in traffic on ${s} again.`,
      worst,
      cooldownFor('traffic'),
    );
  }
}

/** Daily: complaints for missed bins (a couple of streets) after the collection. */
export function binComplaints(state: SimState, missed: readonly Building[]): void {
  const w = state.world;
  const seen = new Set<string>();
  for (const b of missed) {
    if (seen.size >= 2) break;
    const def = buildingDef(b.code);
    if (def?.role !== 'grown' || def.residents <= 0) continue;
    const road = accessOf(state, b);
    const s = streetName(w, road >= 0 ? road : b.y * w.width + b.x);
    if (seen.has(s)) continue;
    seen.add(s);
    addComplaint(
      state,
      'bins',
      `bins:${s}`,
      `Bins not collected on ${s}.`,
      b.y * w.width + b.x,
      cooldownFor('bins'),
    );
  }
}
