/** Describes whatever is under the Inspect tool. Reads the snapshot only. */
import {
  GAME,
  LPS_PER_MLD,
  POWER,
  Terrain,
  WATER,
  ZONES,
  buildingDef,
  isFarm,
  mainTypeByCode,
  nearRiver,
  serviceTile,
  sewerTile,
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
import type { Building, GrownBuildingDef, SimSnapshot, WaterFacilityDef } from '../sim';
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
    const key = `${i}:${r.road}:${r.zone}:${r.terrain}:${r.building}:${r.power}:${r.supply}:${r.water}:${Math.floor(snap.minute / 10)}`;
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
    const main = mainTypeByCode(w.water[i]!);
    if (main) {
      rows.push(['Water main', `${main.name}, ${main.capacityLps} l/s`]);
      rows.push(['Pressure', pressureText(w.pressure[i]!)]);
    }
    if (road) rows.push(['Sewer', sewerText(snap, snap.waterLayout.sewerAt[i] ?? 0)]);
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
    if (snap.world.water[tile] !== 0) return;
    // Best main next to this tile (what a building here would connect to).
    const w = snap.world;
    const x = tile % w.width;
    const y = Math.floor(tile / w.width);
    let best = -1;
    for (let yy = Math.max(0, y - 1); yy <= Math.min(w.height - 1, y + 1); yy++)
      for (let xx = Math.max(0, x - 1); xx <= Math.min(w.width - 1, x + 1); xx++) {
        const t = yy * w.width + xx;
        if (w.water[t] !== 0) best = Math.max(best, w.pressure[t]!);
      }
    rows.push([
      'Water',
      best < 0 ? 'No water main beside this tile' : `Main beside it: ${pressureText(best)}`,
    ]);
  }

  private waterRows(snap: SimSnapshot, b: Building, def: GrownBuildingDef, rows: Row[]): void {
    const w = snap.world;
    const tile = serviceTile(w, b, def);
    const river = isFarm(def) && nearRiver(w, b.x, b.y, def.footprint[0], def.footprint[1]);
    let status: string;
    if (b.dryMinutes > 0) status = `No supply for ${duration(b.dryMinutes)}`;
    else if (tile >= 0 && w.pressure[tile]! > 0)
      status = `Supplied, ${pressureText(w.pressure[tile]!)}`;
    else if (river) status = 'From the river';
    else status = 'Supplied';
    rows.push(['Water', status]);
    if (tile < 0 && !river) rows.push(['Water main', 'None beside the plot']);
    const use = snap.waterUseLps.get(b.id);
    if (use !== undefined) rows.push(['Water use', `${use.toFixed(2)} l/s at the last reading`]);
    if (def.irrigationLpd) {
      const label = def.fields === 'pasture' ? 'Livestock water' : 'Irrigation';
      let src: string;
      if (river && !snap.water.irrigationCapped) src = 'From the river (abstraction licence)';
      else if (tile >= 0)
        src = river ? 'From the mains (river licence used up today)' : 'From the mains';
      else src = 'None: river licence used up today';
      rows.push([label, src]);
    }
    if (def.priority === 0) rows.push(['Priority customer', 'Yes: a loss of supply is serious']);
    if (!isFarm(def)) {
      const st = sewerTile(w, b, def);
      rows.push([
        'Sewer',
        st < 0 ? 'Not connected' : sewerText(snap, snap.waterLayout.sewerAt[st] ?? 0),
      ]);
    }
  }

  private waterFacilityRows(
    snap: SimSnapshot,
    b: Building,
    def: WaterFacilityDef,
    rows: Row[],
  ): void {
    const flow = snap.waterFlowLps.get(b.id) ?? 0;
    const mld = (lps: number) => `${(lps / LPS_PER_MLD).toFixed(1)} Ml/day`;
    switch (def.kind) {
      case 'intake':
        rows.push(['Capacity', `${def.capacityMlPerDay ?? 0} Ml/day`]);
        rows.push(['Abstracting', `${flow.toFixed(0)} l/s (${mld(flow)})`]);
        rows.push(['Licence', `${def.licenceMlPerDay ?? 0} Ml/day`]);
        rows.push([
          'City today',
          `${snap.water.abstractedTodayMl.toFixed(1)} of ${snap.waterStats.licenceMlPerDay} Ml licensed`,
        ]);
        break;
      case 'treatment':
        rows.push(['Capacity', `${def.capacityMlPerDay ?? 0} Ml/day`]);
        rows.push(['Output', `${flow.toFixed(0)} l/s (${mld(flow)})`]);
        rows.push(['Outlet pressure', `${def.headM ?? 0} m`]);
        break;
      case 'storage':
        rows.push(['Stored', `${b.storedMl.toFixed(2)} of ${def.storageMl ?? 0} Ml`]);
        rows.push([
          'Now',
          flow > 0.01
            ? `Supplying ${flow.toFixed(0)} l/s`
            : flow < -0.01
              ? `Filling at ${(-flow).toFixed(0)} l/s`
              : b.storedMl <= 0
                ? 'Empty'
                : 'Standing by',
        ]);
        rows.push(['Pressure head', `${def.headM ?? 0} m while it holds water`]);
        break;
      case 'booster':
        rows.push(['Boost', `+${def.boostM ?? 0} m downstream`]);
        rows.push(['Pumping', `${flow.toFixed(1)} l/s`]);
        break;
      case 'sewage':
        rows.push(['Capacity', `${def.capacityMlPerDay ?? 0} Ml/day`]);
        rows.push(['Inflow', `${flow.toFixed(0)} l/s`]);
        {
          // A sewer network holding only this works' own footprint has no roads in it.
          const net = snap.waterLayout.sewers.find((s) => s.works.some((x) => x.id === b.id));
          const own = def.footprint[0] * def.footprint[1];
          if (!net || net.tiles <= own)
            rows.push(['Sewers', 'Not beside a road: nothing drains here']);
        }
        break;
    }
    if (def.powerKw > 0) {
      rows.push(['Electricity', `${def.powerKw} kW`]);
      rows.push(['Power', b.unpoweredMinutes === 0 ? 'Supplied' : 'Off: not running']);
    }
    rows.push(['Cost to build', formatMoney(def.cost)]);
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
      this.waterRows(snap, b, def, rows);
      return def.name;
    }
    if (def.utility === 'water') {
      this.waterFacilityRows(snap, b, def, rows);
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

function pressureText(m: number): string {
  const p = WATER.pressure;
  if (m < p.noSupplyM) return `${m} m (no supply)`;
  if (m < p.lowM) return `${m} m (low)`;
  return `${m} m (${m >= p.goodM ? 'good' : 'adequate'})`;
}

function sewerText(snap: SimSnapshot, id: number): string {
  const s = snap.waterLayout.sewers.find((x) => x.id === id);
  if (!s || s.works.length === 0) return 'No sewage works connected: sewage goes untreated';
  return `Drains to ${s.works.length === 1 ? 'a sewage works' : `${s.works.length} sewage works`}`;
}

function duration(minutes: number): string {
  const hrs = minutes / 60;
  return hrs < 1 ? `${minutes} minutes` : `${hrs < 10 ? hrs.toFixed(1) : Math.round(hrs)} hours`;
}

function powerStatus(b: Building): string {
  if (b.unpoweredMinutes === 0) return 'Supplied';
  const hrs = b.unpoweredMinutes / 60;
  return hrs < 1
    ? `Off for ${b.unpoweredMinutes} minutes`
    : `Off for ${hrs < 10 ? hrs.toFixed(1) : Math.round(hrs)} hours`;
}
