/** Describes whatever is under the Inspect tool. Reads the snapshot only. */
import {
  GAME,
  POWER,
  Terrain,
  ZONES,
  buildingDef,
  densityByCodeOf,
  edgeDistance,
  estateStats,
  jobsOf,
  lineTypeByCode,
  residentsOf,
  roadClassByCode,
  season,
  seasonOf,
  zoneTypeByCode,
} from '../sim';
import type { Building, SimSnapshot } from '../sim';
import { clear, h } from './dom';
import { formatInt, formatMW, formatMoney } from './format';

type Row = [string, string];

export class Inspector {
  readonly el = h('aside', { class: 'panel inspector hidden', 'aria-label': 'Inspector' });
  private tile: number | null = null;
  private shownKey = '';

  show(tile: number | null): void {
    this.tile = tile;
    this.shownKey = '';
    this.el.classList.toggle('hidden', tile === null);
  }

  update(snap: SimSnapshot): void {
    if (this.tile === null) return;
    const w = snap.world;
    const i = this.tile;
    const r = snap.revisions;
    // Live figures (load, output, weather) refresh every 10 game minutes.
    const key = `${i}:${r.road}:${r.zone}:${r.terrain}:${r.building}:${r.power}:${r.supply}:${Math.floor(snap.minute / 10)}`;
    if (key === this.shownKey) return;
    this.shownKey = key;

    const x = i % w.width;
    const y = Math.floor(i / w.width);
    const rows: Row[] = [['Tile', `${x}, ${y}`]];
    const water = w.terrain[i] === Terrain.Water;
    rows.push(['Ground', water ? 'River' : 'Open land']);
    const road = roadClassByCode(w.road[i]!);
    if (road) {
      rows.push(['Road', water ? `${road.name} (bridge)` : road.name]);
      rows.push(['Speed limit', `${road.speedKmh} km/h`]);
      rows.push(['Capacity', `${road.capacityVehPerHour.toLocaleString('en-GB')} vehicles/h`]);
    }
    const line = lineTypeByCode(w.power[i]!);
    if (line) rows.push(['Power line', `${line.name}, rated ${line.capacityMW} MW`]);
    const zone = zoneTypeByCode(w.zone[i]!);
    if (zone) {
      const d = densityByCodeOf(w.density[i]!);
      rows.push([
        'Zone',
        d && zone.hasDensity ? `${zone.name} (${d.name.toLowerCase()})` : zone.name,
      ]);
      rows.push(['Zone demand', percent(snap.demand[zone.id])]);
    }
    const estateId = snap.estateAt[i] ?? 0;
    if (estateId !== 0) {
      const estate = snap.estates.find((e) => e.id === estateId);
      const st = estateStats(snap, estateId);
      rows.push(['Estate', estate?.name ?? 'Industrial estate']);
      rows.push([
        'Estate size',
        `${st.tiles} plots, ${st.buildings} buildings, ${formatInt(st.jobs)} jobs`,
      ]);
      rows.push(['Estate load', formatMW(st.loadKw / 1000)]);
    }
    const bId = snap.buildingAt[i] ?? 0;
    const building = bId !== 0 ? snap.buildingById.get(bId) : undefined;
    let title = road ? road.name : zone ? zone.name : water ? 'River' : 'Empty land';
    if (building) title = this.buildingRows(snap, building, rows);
    else if (!road && !water) this.coverageRows(snap, i, rows);
    const farmOk = edgeDistance(w, x, y) < GAME.agriculturalEdgeBand;
    if (!road && !water && !zone && !building && ZONES.types.some((t) => t.edgeOnly)) {
      rows.push(['Farmland allowed', farmOk ? 'Yes' : 'No (too far from the edge)']);
    }

    clear(this.el);
    this.el.append(
      h('h3', {}, title),
      h('dl', {}, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    );
  }

  private coverageRows(snap: SimSnapshot, tile: number, rows: Row[]): void {
    const sub = snap.network.coverage[tile] ?? 0;
    if (sub === 0) rows.push(['Power', 'No substation in range']);
    else if ((snap.network.feedMW.get(sub) ?? 0) <= 0) {
      rows.push(['Power', 'Substation not connected to a power station']);
    } else rows.push(['Power', 'Covered by a substation']);
  }

  /** Adds rows for a building and returns the panel title. */
  private buildingRows(snap: SimSnapshot, b: Building, rows: Row[]): string {
    const def = buildingDef(b.code);
    if (!def) return 'Building';
    if (def.role === 'grown') {
      rows.push(['Type', def.category]);
      if (def.residents > 0) {
        rows.push(['Residents', `${formatInt(residentsOf(b))} of ${formatInt(def.residents)}`]);
      }
      if (def.jobs > 0) rows.push(['Jobs', `${formatInt(jobsOf(b))} of ${formatInt(def.jobs)}`]);
      rows.push(['Occupancy', `${Math.round(b.occupancy * 100)}%`]);
      if (def.fields) {
        rows.push(['Season', season(seasonOf(snap.minute)).name]);
        if (def.exportPerDay)
          rows.push(['Exports at capacity', `${formatMoney(def.exportPerDay)} a day`]);
      }
      const load = snap.loadKw.get(b.id) ?? 0;
      rows.push(['Electricity', `${load.toFixed(1)} kW now (peak ${def.powerKw} kW)`]);
      rows.push(['Power', powerStatus(b)]);
      rows.push(['Outage priority', POWER.priorityNames[def.priority] ?? String(def.priority)]);
      return def.name;
    }
    const out = snap.outputMW.get(b.id) ?? 0;
    const island = snap.network.islandOf.get(b.id);
    const stats = snap.power.islands.find((s) => s.id === island);
    switch (def.kind) {
      case 'substation': {
        const feed = snap.network.feedMW.get(b.id) ?? 0;
        rows.push(['Capacity', `${def.capacityMW} MW`]);
        rows.push([
          'Can draw',
          feed > 0
            ? `${formatMW(feed)} (limited by its weakest line)`
            : 'Nothing: no power station connected',
        ]);
        rows.push(['Reach', `${def.serviceRadius ?? 0} tiles`]);
        break;
      }
      case 'battery':
        rows.push(['Storage', `${b.storedMWh.toFixed(1)} of ${def.storageMWh ?? 0} MWh`]);
        rows.push([
          'Now',
          out > 0
            ? `Discharging ${formatMW(out)}`
            : out < 0
              ? `Charging ${formatMW(-out)}`
              : 'Idle',
        ]);
        rows.push(['Rate', `${def.capacityMW} MW`]);
        break;
      default:
        rows.push(['Capacity', `${def.capacityMW} MW`]);
        rows.push(['Output now', formatMW(out)]);
        if (def.kind === 'wind') rows.push(['Wind', `${snap.weather.windMs.toFixed(1)} m/s`]);
        if (def.kind === 'solar')
          rows.push(['Sunshine', `${Math.round(snap.weather.sunshine * 100)}%`]);
    }
    if (stats) {
      rows.push([
        'Grid',
        `${formatMW(stats.servedMW)} supplied of ${formatMW(stats.demandMW)} demand`,
      ]);
    }
    rows.push(['Cost to build', formatMoney(def.cost)]);
    return def.name;
  }
}

function percent(v: number): string {
  return `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
}

function powerStatus(b: Building): string {
  if (b.unpoweredMinutes === 0) return 'Supplied';
  const hrs = b.unpoweredMinutes / 60;
  return hrs < 1
    ? `Off for ${b.unpoweredMinutes} minutes`
    : `Off for ${hrs < 10 ? hrs.toFixed(1) : Math.round(hrs)} hours`;
}
