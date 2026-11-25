/** Describes whatever is under the Inspect tool. Reads the snapshot only. */
import {
  FAULT,
  GAME,
  slotLabel,
  LPS_PER_MLD,
  TILE_ASSET_LAYERS,
  ageYears,
  assetKey,
  conditionBand,
  dayOf,
  depotDefOf,
  facilityAssetDef,
  failureProbability,
  severityName,
  tileClassAt,
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
  COVERAGE_KINDS,
  cityEventDef,
  clockString,
  pollutionShare,
} from '../sim';
import type {
  CoverageKind,
  PollutionKind,
  ServiceFacilityDef,
  AssetRef,
  Building,
  Command,
  GrownBuildingDef,
  SimSnapshot,
  TileAssetLayer,
  WaterFacilityDef,
} from '../sim';
import { clear, h } from './dom';
import { formatInt, formatMW, formatMoney } from './format';
import { crewLabel, formatDuration } from './inbox';

type Row = [string, string];

const LAYER_NAMES: Record<TileAssetLayer, string> = {
  road: 'Road',
  main: 'Water main',
  line: 'Power line',
};

export interface InspectorActions {
  dispatch(cmd: Command): void;
}

export class Inspector {
  readonly el = h('aside', { class: 'panel inspector hidden', 'aria-label': 'Inspector' });
  private tile: number | null = null;
  private shownKey = '';
  /** Maintenance buttons for the assets on the shown tile. */
  private buttons: HTMLElement[] = [];

  constructor(private readonly actions: InspectorActions) {}

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
    const work = snap.workOrders.map((o) => o.status).join();
    const key = `${i}:${r.road}:${r.zone}:${r.terrain}:${r.building}:${r.power}:${r.supply}:${r.water}:${r.traffic}:${snap.permits.length}:${Math.floor(snap.minute / 10)}:${snap.assets.nextIncidentId}:${snap.assets.nextOrderId}:${work}:${snap.cash < 0}`;
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
      this.trafficRows(snap, i, road.capacityVehPerHour, rows);
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
    this.buttons = [];
    for (const layer of TILE_ASSET_LAYERS) this.tileAssetRows(snap, layer, i, rows);
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
    if (this.buttons.length > 0)
      this.el.append(h('div', { class: 'inspector-actions' }, ...this.buttons));
  }

  /** Condition, age, risk and work for one asset; adds a "book maintenance" button. */
  /** Flow, capacity, speed, closures and permits on a road tile. */
  private trafficRows(snap: SimSnapshot, i: number, baseCap: number, rows: Row[]): void {
    const tc = snap.trafficCache;
    const f = snap.faults.tile[i]!;
    const flow = snap.world.traffic[i]!;
    const cap = tc.capacity[i]!;
    const closed = (f & FAULT.ROAD_CLOSED) !== 0;
    const lane = (f & FAULT.LANE_CLOSED) !== 0;
    rows.push([
      'Capacity',
      closed
        ? 'Closed for works'
        : `${formatInt(Math.round(cap))} vehicles/h${lane ? ` (one lane closed; ${formatInt(baseCap)} normally)` : ''}`,
    ]);
    rows.push([
      'Traffic',
      `${formatInt(flow)} vehicles/h${cap > 0 ? ` (${Math.round((100 * flow) / cap)}% of capacity)` : ''}`,
    ]);
    const free = tc.freeSec[i]!;
    const time = tc.timeSec[i]!;
    if (!closed && free > 0 && time < Infinity) {
      const speed = GAME.metresPerTile / 1000 / (time / 3600);
      rows.push([
        'Speed now',
        `${Math.round(speed)} km/h${time > free * 1.05 ? ' (congested)' : ''}`,
      ]);
    }
    for (const p of snap.permits) {
      if (!p.tiles.includes(i)) continue;
      const clash = (tc.clashes.get(p.id) ?? []).length > 0 ? ' · clashes with other works' : '';
      const when = p.start <= snap.minute ? 'under way' : `from ${slotLabel(snap.minute, p.start)}`;
      rows.push([
        'Street works',
        `Permit ${p.id} (${p.kind}, ${p.closure === 'full' ? 'road closed' : 'lane closed'}${p.night ? ', night works' : ''}) ${when}, until ${slotLabel(snap.minute, p.end)}${p.overrun ? ' · overrunning' : ''}${clash}`,
      ]);
    }
  }

  private assetRows(
    snap: SimSnapshot,
    ref: AssetRef,
    label: string,
    condition: number,
    laidDay: number,
    risk: number,
    maintenance: { name: string; cost: number; minutes: number },
    rows: Row[],
  ): void {
    const age = laidDay > 0 ? dayOf(snap.minute) - laidDay : 0;
    const years = ageYears(age);
    const ageText =
      age < 1
        ? 'new'
        : years < 1
          ? `${age} day${age === 1 ? '' : 's'} old`
          : `${years.toFixed(1)} years old`;
    rows.push([
      `${label} condition`,
      `${Math.round(condition)}/100 (${conditionBand(condition)}), ${ageText}`,
    ]);
    rows.push([`${label} failure risk`, `${(risk * 100).toFixed(risk < 0.001 ? 3 : 2)}% a day`]);
    const key = assetKey(ref);
    const incId = snap.faults.incidentAt.get(key);
    const inc = incId !== undefined ? snap.incidents.find((x) => x.id === incId) : undefined;
    if (inc)
      rows.push([
        `${label} incident`,
        `${inc.title} (${severityName(inc.severity).toLowerCase()})`,
      ]);
    const orderId = snap.faults.orderAt.get(key);
    const o = orderId !== undefined ? snap.workOrders.find((x) => x.id === orderId) : undefined;
    if (o) {
      const status =
        o.status === 'queued'
          ? 'waiting for a crew'
          : o.status === 'enRoute'
            ? 'crew on the way'
            : 'crew on site';
      rows.push([
        `${label} work`,
        `${o.type === 'repair' ? 'Repair' : maintenance.name}: ${status}`,
      ]);
      return;
    }
    const b = h(
      'button',
      {
        class: 'small',
        title: `${formatDuration(maintenance.minutes)} of work; takes it out of service while the crew is on site`,
      },
      `${maintenance.name}: ${label.toLowerCase()} (${formatMoney(maintenance.cost)})`,
    );
    const x = ref.layer === 'facility' ? -1 : ref.id % snap.world.width;
    const y = ref.layer === 'facility' ? -1 : Math.floor(ref.id / snap.world.width);
    b.addEventListener('click', () => {
      const at =
        ref.layer === 'facility'
          ? (() => {
              const bb = snap.buildingById.get(ref.id)!;
              return { x: bb.x, y: bb.y };
            })()
          : { x, y };
      this.actions.dispatch({
        type: 'raiseMaintenance',
        from: at,
        to: at,
        below: 101,
        only: ref.layer,
      });
    });
    this.buttons.push(b);
  }

  private tileAssetRows(snap: SimSnapshot, layer: TileAssetLayer, tile: number, rows: Row[]): void {
    const w = snap.world;
    const cls = tileClassAt(w, layer, tile);
    if (!cls) return;
    const c = w.condition[layer][tile]! / 100;
    const risk = failureProbability(cls, c, snap.weather.event?.id ?? null);
    this.assetRows(
      snap,
      { layer, id: tile },
      LAYER_NAMES[layer],
      c,
      w.laid[layer][tile]!,
      risk,
      cls.maintenance,
      rows,
    );
  }

  private facilityAssetRows(snap: SimSnapshot, b: Building, rows: Row[]): void {
    const fa = facilityAssetDef(b);
    if (!fa) return;
    const risk = failureProbability(fa.cls, b.condition, snap.weather.event?.id ?? null);
    this.assetRows(
      snap,
      { layer: 'facility', id: b.id },
      'Plant',
      b.condition,
      b.builtDay,
      risk,
      fa.cls.maintenance,
      rows,
    );
    if (snap.faults.offline.has(b.id)) rows.push(['Service', 'Out of service']);
  }

  private serviceRows(snap: SimSnapshot, b: Building, def: ServiceFacilityDef, rows: Row[]): void {
    const city = snap.city;
    rows.push(['Jobs', formatInt(def.jobs)]);
    rows.push(['Power', def.powerKw > 0 ? powerStatus(b) : 'Not needed']);
    if (def.waterLpd > 0) rows.push(['Water', b.dryMinutes > 0 ? 'No supply' : 'Supplied']);
    if (def.priority === 0) rows.push(['Priority customer', 'Yes: kept supplied first']);
    const served = city.facilityRatio(b.id);
    switch (def.kind) {
      case 'fire': {
        const crews = snap.crews.filter((c) => c.depot === b.id);
        const busy = crews.filter((c) => c.status !== 'idle').length;
        rows.push(['Fire engines', `${crews.length} on duty, ${busy} out`]);
        for (const c of crews) {
          const status =
            c.status === 'idle'
              ? 'at the station'
              : c.status === 'enRoute'
                ? 'on the way to a fire'
                : c.status === 'onSite'
                  ? 'fighting a fire'
                  : 'returning';
          rows.push([crewLabel(c), status]);
        }
        break;
      }
      case 'police':
      case 'health':
        rows.push([
          'Serves',
          `up to ${formatInt((def.capacity ?? 0) * snap.economy.budgets.services)} residents`,
        ]);
        rows.push(['Coping with demand', `${Math.round(served * 100)}%`]);
        break;
      case 'school':
        rows.push(['Places', formatInt((def.capacity ?? 0) * snap.economy.budgets.services)]);
        rows.push(['Pupils with a place', `${Math.round(served * 100)}%`]);
        break;
      case 'waste':
        rows.push([
          'Collects',
          `${((def.capacity ?? 0) * snap.economy.budgets.services).toFixed(0)} t a day`,
        ]);
        rows.push(['Coping with demand', `${Math.round(served * 100)}%`]);
        break;
      case 'recycling':
        rows.push(['Recycles', `up to ${def.capacity ?? 0} t a day`]);
        break;
      case 'landfill': {
        const used = city.landfillUsed(b.id);
        const cap = def.capacity ?? 1;
        rows.push([
          'Filled',
          `${formatInt(used)} of ${formatInt(cap)} t (${Math.round((100 * used) / cap)}%)`,
        ]);
        break;
      }
      default:
        break;
    }
    if (def.landmark) {
      if (def.capacity) rows.push(['Capacity', `${formatInt(def.capacity)} people`]);
      if (def.landmark.ratesPerDay > 0)
        rows.push(['Business rates', `${formatMoney(city.dailyTaxes(b).businessRates)} a day`]);
      const next = snap.events
        .filter((e) => e.venue === b.id && e.status !== 'done')
        .sort((a, z) => a.start - z.start)[0];
      if (next) {
        rows.push([
          'Next event',
          `${cityEventDef(next.type).name}, day ${dayOf(next.start)} at ${clockString(next.start)} (${formatInt(next.attendance)})`,
        ]);
      } else if (def.landmark.events.length > 0) rows.push(['Next event', 'None booked yet']);
    }
    rows.push(['Running cost', `${formatMoney(city.dailyUpkeep(b))} a day`]);
    rows.push(['Cost to build', formatMoney(def.cost)]);
    this.fireRows(snap, b, rows);
  }

  /** Street, fire, land value, pollution, services, bins, happiness and taxes for a building. */
  private cityRows(snap: SimSnapshot, b: Building, rows: Row[], home: boolean): void {
    const city = snap.city;
    const w = snap.world;
    const tile = b.y * w.width + b.x;
    rows.push(['Street', city.streetName(tile)]);
    this.fireRows(snap, b, rows);
    rows.push(['Land value', `${Math.round(city.landValue(b) * 100)}%`]);
    const air = city.pollution('air', tile);
    const noise = city.pollution('noise', tile);
    rows.push(['Air / noise', `${pollutionLabel('air', air)} / ${pollutionLabel('noise', noise)}`]);
    const parts = COVERAGE_KINDS.map((k) => {
      const m = city.coverageMinutes(b, k);
      const lvl = city.serviceLevel(b, k);
      return `${SERVICE_NAMES[k]} ${Number.isFinite(m) ? `${Math.round(m)} min` : '—'}${Number.isFinite(m) && lvl < 0.995 ? ` (${Math.round(lvl * 100)}%)` : ''}`;
    });
    rows.push(['Services', parts.join(', ')]);
    if (city.wasteTonnes(b) > 0)
      rows.push(['Bins', city.binsMissed(b) ? 'Missed at the last round' : 'Collected']);
    if (home) rows.push(['Happiness', `${Math.round(city.happiness(b))} / 100`]);
    const t = city.dailyTaxes(b);
    if (t.councilTax > 0) rows.push(['Council tax', `${formatMoney(t.councilTax)} a day`]);
    if (t.businessRates > 0) rows.push(['Business rates', `${formatMoney(t.businessRates)} a day`]);
    if (t.farmExports > 0) rows.push(['Exports', `${formatMoney(t.farmExports)} a day`]);
  }

  private fireRows(snap: SimSnapshot, b: Building, rows: Row[]): void {
    const f = snap.city.fireAt(b.id);
    if (!f) return;
    const engines = snap.city.enginesOnSite(f);
    rows.push([
      'Fire',
      `${Math.round(f.intensity)}% of the building alight, ${engines} engine${engines === 1 ? '' : 's'} on site${engines > 0 ? `, water ${Math.round(snap.city.fireWater(f) * 100)}%` : ''}`,
    ]);
  }

  private depotRows(snap: SimSnapshot, b: Building, rows: Row[]): void {
    const crews = snap.crews.filter((c) => c.depot === b.id);
    rows.push(['Crews', `${crews.length}`]);
    for (const c of crews) {
      const status =
        c.status === 'idle'
          ? 'at the depot'
          : c.status === 'enRoute'
            ? 'on the way to a job'
            : c.status === 'onSite'
              ? 'on site'
              : 'returning';
      rows.push([crewLabel(c), status]);
    }
    const def = depotDefOf(b);
    if (def) rows.push(['Cost to build', formatMoney(def.cost)]);
    const near = snap.world.road;
    const [fw, fd] = def?.footprint ?? [2, 2];
    let road = false;
    for (let yy = b.y - 1; yy <= b.y + fd && !road; yy++)
      for (let xx = b.x - 1; xx <= b.x + fw; xx++) {
        if (xx < 0 || yy < 0 || xx >= snap.world.width || yy >= snap.world.height) continue;
        if (near[yy * snap.world.width + xx] !== 0) road = true;
      }
    if (!road) rows.push(['Access', 'No road beside it: crews drive off-road slowly']);
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
      this.cityRows(snap, b, rows, def.residents > 0);
      return def.name;
    }
    if (def.utility === 'depot') {
      this.depotRows(snap, b, rows);
      return def.name;
    }
    if (def.utility === 'service') {
      this.serviceRows(snap, b, def, rows);
      return def.name;
    }
    this.facilityAssetRows(snap, b, rows);
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

const SERVICE_NAMES: Record<CoverageKind, string> = {
  fire: 'fire',
  police: 'police',
  health: 'health',
  school: 'school',
  waste: 'bins',
};

function pollutionLabel(kind: PollutionKind, v: number): string {
  const share = pollutionShare(kind, v);
  return share <= 0 ? 'clean' : share < 0.4 ? 'some' : share < 0.8 ? 'poor' : 'bad';
}

function powerStatus(b: Building): string {
  if (b.unpoweredMinutes === 0) return 'Supplied';
  const hrs = b.unpoweredMinutes / 60;
  return hrs < 1
    ? `Off for ${b.unpoweredMinutes} minutes`
    : `Off for ${hrs < 10 ? hrs.toFixed(1) : Math.round(hrs)} hours`;
}
