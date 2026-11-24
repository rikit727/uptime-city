/**
 * Electricity: the network model (rebuilt when lines or facilities change) and
 * the dispatch run every `power.json: dispatchIntervalMinutes`.
 *
 * Network: line tiles and facility footprints are nodes; 4-adjacent nodes are
 * connected. Each connected group is an island with its own supply. A
 * substation can draw at most its own capacity and the rating of the weakest
 * line on its best route from a generator (a widest-path search; line sharing
 * between substations is not modelled). Each tile is served by the nearest
 * substation within its service radius; a building is served via its centre tile.
 *
 * Dispatch: each building's load follows its zone's time-of-day curve and the
 * temperature. Renewables are used first, then gas, then batteries. If an
 * island or a substation is short, load is shed by priority (power.json
 * `priorityNames`, 0 kept longest), and within a priority by a rota block that
 * moves on every `rota.minutes`, so outages roll round the city.
 */
import { POWER, buildingDef } from './data';
import type { FacilityDef } from './data';
import { centreOf, defOf, residentsOf } from './buildings';
import type { SimEvent } from './events';
import type { Building, PowerIsland, PowerStats, SimState } from './state';
import { emptyPowerStats } from './state';
import { hourFraction } from './time';
import { tileIndex } from './world';

const facilityDefOf = (b: Building): FacilityDef | undefined => {
  const def = defOf(b);
  return def.role === 'facility' ? def : undefined;
};

const isGenerator = (def: FacilityDef): boolean =>
  def.kind === 'gas' || def.kind === 'solar' || def.kind === 'wind' || def.kind === 'battery';

/** Rebuild islands, substation feed limits and coverage from the current layout. */
export function rebuildNetwork(state: SimState): void {
  const w = state.world;
  const n = w.width * w.height;
  const cache = state.cache;
  // Node capacity per tile: line rating, Infinity for facility tiles, 0 = not a node.
  const cap = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const code = w.power[i]!;
    if (code !== 0) cap[i] = POWER.lines.find((l) => l.code === code)?.capacityMW ?? 0;
  }
  const facilities: Building[] = [];
  for (const b of state.buildings) {
    if (!facilityDefOf(b)) continue;
    facilities.push(b);
    const [fw, fd] = defOf(b).footprint;
    for (let dy = 0; dy < fd; dy++)
      for (let dx = 0; dx < fw; dx++) cap[tileIndex(w, b.x + dx, b.y + dy)] = Infinity;
  }

  const neighbours = (t: number, out: number[]): number[] => {
    out.length = 0;
    const x = t % w.width;
    if (x > 0) out.push(t - 1);
    if (x < w.width - 1) out.push(t + 1);
    if (t >= w.width) out.push(t - w.width);
    if (t + w.width < n) out.push(t + w.width);
    return out;
  };
  const nb: number[] = [];

  // Islands by flood fill.
  const island = new Int32Array(n);
  let islandCount = 0;
  const stack: number[] = [];
  for (const f of facilities) {
    const start = tileIndex(w, f.x, f.y);
    if (island[start] !== 0) continue;
    const id = ++islandCount;
    island[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const t = stack.pop()!;
      for (const m of neighbours(t, nb)) {
        if (cap[m] === 0 || island[m] !== 0) continue;
        island[m] = id;
        stack.push(m);
      }
    }
  }
  const islandOf = new Map<number, number>();
  const members: Building[][] = Array.from({ length: islandCount }, () => []);
  for (const f of facilities) {
    const id = island[tileIndex(w, f.x, f.y)]!;
    islandOf.set(f.id, id);
    members[id - 1]!.push(f);
  }
  const islands: PowerIsland[] = members.map((fs, k) => ({
    id: k + 1,
    facilities: fs,
    generationMW: fs.reduce((sum, f) => {
      const def = facilityDefOf(f)!;
      return def.kind === 'substation' || def.kind === 'battery' ? sum : sum + def.capacityMW;
    }, 0),
  }));

  // Widest path: for each rating from high to low, flood from generators through nodes
  // rated at least that much; a substation first reached at rating r can draw r.
  const ratings = [
    Infinity,
    ...[...new Set(POWER.lines.map((l) => l.capacityMW))].sort((a, b) => b - a),
  ];
  const feedMW = new Map<number, number>();
  const substations = facilities.filter((f) => facilityDefOf(f)!.kind === 'substation');
  const seen = new Uint8Array(n);
  for (const r of ratings) {
    seen.fill(0);
    for (const f of facilities) {
      if (!isGenerator(facilityDefOf(f)!)) continue;
      const t0 = tileIndex(w, f.x, f.y);
      if (seen[t0]) continue;
      seen[t0] = 1;
      stack.push(t0);
      while (stack.length > 0) {
        const t = stack.pop()!;
        for (const m of neighbours(t, nb)) {
          if (seen[m] || cap[m]! < r) continue;
          seen[m] = 1;
          stack.push(m);
        }
      }
    }
    for (const s of substations) {
      if (feedMW.has(s.id) || !seen[tileIndex(w, s.x, s.y)]) continue;
      feedMW.set(s.id, Math.min(r, facilityDefOf(s)!.capacityMW));
    }
  }
  for (const s of substations) if (!feedMW.has(s.id)) feedMW.set(s.id, 0);

  // Coverage: nearest substation within its radius (ties go to the lower id).
  const coverage = cache.network.coverage;
  coverage.fill(0);
  const best = new Float64Array(n).fill(Infinity);
  for (const s of substations) {
    const c = centreOf(s);
    const r = facilityDefOf(s)!.serviceRadius ?? 0;
    for (
      let y = Math.max(0, Math.floor(c.y - r));
      y <= Math.min(w.height - 1, Math.ceil(c.y + r));
      y++
    ) {
      for (
        let x = Math.max(0, Math.floor(c.x - r));
        x <= Math.min(w.width - 1, Math.ceil(c.x + r));
        x++
      ) {
        const d = Math.hypot(x - c.x, y - c.y);
        const t = tileIndex(w, x, y);
        if (d <= r && d < best[t]!) {
          best[t] = d;
          coverage[t] = s.id;
        }
      }
    }
  }
  cache.network.islands = islands;
  cache.network.islandOf = islandOf;
  cache.network.feedMW = feedMW;
}

/** True if the tile is covered by a substation that can draw power from a generator. */
export function isEnergised(state: SimState, tile: number): boolean {
  const sub = state.cache.network.coverage[tile] ?? 0;
  return sub !== 0 && (state.cache.network.feedMW.get(sub) ?? 0) > 0;
}

/** Demand curve factor for a zone at a fractional hour, interpolated between hours. */
export function curveFactor(zone: keyof typeof POWER.demandCurves, hour: number): number {
  const curve = POWER.demandCurves[zone];
  const h0 = Math.floor(hour) % 24;
  const t = hour - Math.floor(hour);
  return curve[h0]! + (curve[(h0 + 1) % 24]! - curve[h0]!) * t;
}

/** Load multiplier for heating and cooling at a temperature. */
export function temperatureFactor(tempC: number): number {
  const t = POWER.temperature;
  return (
    1 +
    t.heatingPerDegree * Math.max(0, t.heatingBelowC - tempC) +
    t.coolingPerDegree * Math.max(0, tempC - t.coolingAboveC)
  );
}

/** Available output of a facility right now, MW (batteries excluded). */
export function availableMW(state: SimState, def: FacilityDef): number {
  switch (def.kind) {
    case 'gas':
      return def.capacityMW;
    case 'solar':
      return def.capacityMW * state.weather.sunshine;
    case 'wind': {
      const c = def.wind ?? { cutInMs: 3, ratedMs: 12, cutOutMs: 25 };
      const v = state.weather.windMs;
      if (v < c.cutInMs || v >= c.cutOutMs) return 0;
      if (v >= c.ratedMs) return def.capacityMW;
      return (def.capacityMW * (v ** 3 - c.cutInMs ** 3)) / (c.ratedMs ** 3 - c.cutInMs ** 3);
    }
    default:
      return 0;
  }
}

interface Consumer {
  /** Index into state.buildings. */
  k: number;
  sub: number;
  mw: number;
  key: number;
}

/** Run one dispatch. Returns true if any building's powered state changed. */
export function dispatchPower(state: SimState, emit: (e: SimEvent) => void): boolean {
  const interval = POWER.dispatchIntervalMinutes;
  const dtH = interval / 60;
  const cache = state.cache;
  const net = cache.network;
  const w = state.world;
  const { blocks, minutes } = POWER.rota;
  const offset = Math.floor(state.minute / minutes) % blocks;
  const stats: PowerStats = emptyPowerStats();
  const islandIndex = new Map<number, number>();
  net.islands.forEach((isl, k) => islandIndex.set(isl.id, k));
  const consumers: Consumer[][] = net.islands.map(() => []);
  const buildings = state.buildings;
  const served = new Uint8Array(buildings.length);
  let changed = false;

  // Per-zone load factor (time of day and temperature) is the same for every building.
  const hour = hourFraction(state.minute);
  const temp = temperatureFactor(state.weather.temperatureC);
  const zoneFactor = {} as Record<keyof typeof POWER.demandCurves, number>;
  for (const z of Object.keys(POWER.demandCurves) as (keyof typeof POWER.demandCurves)[]) {
    zoneFactor[z] = curveFactor(z, hour) * temp;
  }
  const vacant = POWER.vacantLoadFraction;

  cache.loadKw.clear();
  for (let k = 0; k < buildings.length; k++) {
    const b = buildings[k]!;
    const def = buildingDef(b.code);
    if (def?.role !== 'grown') continue;
    const kw = def.powerKw * zoneFactor[def.zone] * (vacant + (1 - vacant) * b.occupancy);
    cache.loadKw.set(b.id, kw);
    stats.demandMW += kw / 1000;
    const tile =
      (b.y + ((def.footprint[1] - 1) >> 1)) * w.width + b.x + ((def.footprint[0] - 1) >> 1);
    const sub = net.coverage[tile] ?? 0;
    if (sub === 0 || (net.feedMW.get(sub) ?? 0) <= 0) continue;
    const isl = islandIndex.get(net.islandOf.get(sub) ?? -1);
    if (isl === undefined) continue;
    const rank = ((((b.id % blocks) - offset + blocks) % blocks) + blocks) % blocks;
    consumers[isl]!.push({ k, sub, mw: kw / 1000, key: def.priority * blocks + rank });
  }

  cache.outputMW.clear();
  let islandShed = 0;
  net.islands.forEach((isl, k) => {
    const list = consumers[k]!;
    let renewAvail = 0;
    let gasCap = 0;
    let dischargeAvail = 0;
    const batteries: { b: Building; def: FacilityDef }[] = [];
    for (const f of isl.facilities) {
      const def = facilityDefOf(f)!;
      if (def.kind === 'battery') {
        batteries.push({ b: f, def });
        dischargeAvail += Math.min(def.capacityMW, f.storedMWh / dtH);
        stats.storageMWh += def.storageMWh ?? 0;
      } else if (def.kind === 'gas') gasCap += def.capacityMW;
      else if (def.kind !== 'substation') renewAvail += availableMW(state, def);
    }
    const available = renewAvail + gasCap + dischargeAvail;
    const demand = list.reduce((s, c) => s + c.mw, 0);
    const subLoad = new Map<number, number>();
    for (const c of list) subLoad.set(c.sub, (subLoad.get(c.sub) ?? 0) + c.mw);
    const subsOk = [...subLoad].every(([sub, mw]) => mw <= (net.feedMW.get(sub) ?? 0));
    let servedMW = 0;
    if (demand <= available && subsOk) {
      for (const c of list) served[c.k] = 1;
      servedMW = demand;
    } else {
      const order = [...list].sort((a, b) => a.key - b.key || a.k - b.k);
      const subLeft = new Map<number, number>();
      for (const sub of subLoad.keys()) subLeft.set(sub, net.feedMW.get(sub) ?? 0);
      let left = available;
      for (const c of order) {
        const sl = subLeft.get(c.sub)!;
        if (c.mw > left || c.mw > sl) continue;
        left -= c.mw;
        subLeft.set(c.sub, sl - c.mw);
        served[c.k] = 1;
        servedMW += c.mw;
      }
      islandShed += demand - servedMW;
    }

    // Meet the served load: renewables, then gas, then batteries.
    const renewUsed = Math.min(servedMW, renewAvail);
    const gasUsed = Math.min(servedMW - renewUsed, gasCap);
    let discharge = Math.max(0, servedMW - renewUsed - gasUsed);
    // Charge batteries from what is left over, renewables first.
    let spareRenew = renewAvail - renewUsed;
    let spareGas = gasCap - gasUsed;
    let renewTotal = renewUsed;
    let gasTotal = gasUsed;
    for (const { b, def } of batteries) {
      const eff = def.efficiency ?? 1;
      if (discharge > 0) {
        const out = Math.min(discharge, def.capacityMW, b.storedMWh / dtH);
        b.storedMWh = Math.max(0, b.storedMWh - out * dtH);
        discharge -= out;
        cache.outputMW.set(b.id, out);
        continue;
      }
      const room = ((def.storageMWh ?? 0) - b.storedMWh) / (eff * dtH);
      const want = Math.max(0, Math.min(def.capacityMW, room));
      const fromRenew = Math.min(want, spareRenew);
      const fromGas = Math.min(want - fromRenew, spareGas);
      spareRenew -= fromRenew;
      spareGas -= fromGas;
      renewTotal += fromRenew;
      gasTotal += fromGas;
      b.storedMWh = Math.min(def.storageMWh ?? 0, b.storedMWh + (fromRenew + fromGas) * eff * dtH);
      cache.outputMW.set(b.id, -(fromRenew + fromGas));
    }
    // Share generation between plants in proportion to what each could give.
    for (const f of isl.facilities) {
      const def = facilityDefOf(f)!;
      if (def.kind === 'gas')
        cache.outputMW.set(f.id, gasCap > 0 ? (gasTotal * def.capacityMW) / gasCap : 0);
      else if (def.kind === 'solar' || def.kind === 'wind') {
        const a = availableMW(state, def);
        cache.outputMW.set(f.id, renewAvail > 0 ? (renewTotal * a) / renewAvail : 0);
      }
    }
    const stored = batteries.reduce((s, x) => s + x.b.storedMWh, 0);
    stats.capacityMW += isl.generationMW;
    stats.availableMW += available;
    stats.servedMW += servedMW;
    stats.renewableMW += renewTotal;
    stats.storedMWh += stored;
    stats.islands.push({
      id: isl.id,
      capacityMW: isl.generationMW,
      availableMW: available,
      demandMW: demand,
      servedMW,
      storedMWh: stored,
    });
  });

  for (let k = 0; k < buildings.length; k++) {
    const b = buildings[k]!;
    if (buildingDef(b.code)?.role !== 'grown') continue;
    const was = b.unpoweredMinutes === 0;
    if (served[k] === 1) b.unpoweredMinutes = 0;
    else {
      b.unpoweredMinutes += interval;
      stats.buildingsOff++;
      stats.residentsOff += residentsOf(b);
    }
    if (was !== (b.unpoweredMinutes === 0)) changed = true;
  }
  stats.shedMW = islandShed;
  cache.power = stats;

  const shedding = islandShed > 1e-6;
  if (shedding && !cache.shedding) {
    emit({ type: 'powerShortfall', shedMW: islandShed, buildingsOff: stats.buildingsOff });
  } else if (!shedding && cache.shedding) {
    emit({ type: 'powerRestored' });
  }
  cache.shedding = shedding;
  return changed;
}
