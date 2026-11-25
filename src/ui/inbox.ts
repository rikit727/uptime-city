/**
 * The incident inbox: open incidents with their work orders, planned work, the
 * roadworks and permit calendar, the crews and the headline service figures
 * (MTTR, customer-minutes, SLA). The player can re-prioritise work, send a
 * particular crew, cancel planned work, send bottled water, combine clashing
 * street works and jump the camera to a site. Reads the snapshot; acts
 * only through the callbacks it is given.
 */
import {
  ASSETS,
  CREW_TYPES,
  buildingDef,
  isOpen,
  isWaterIncident,
  mttrMinutes,
  roadClassByCode,
  severityName,
  slotLabel,
} from '../sim';
import type { Command, Crew, CrewType, Incident, Permit, SimSnapshot, WorkOrder } from '../sim';
import { clear, h } from './dom';
import { formatInt, formatMoney } from './format';

export interface InboxActions {
  dispatch(cmd: Command): void;
  focusTile(tile: number): void;
}

export const CREW_NAMES: Record<CrewType, string> = {
  roads: 'Highways',
  water: 'Water',
  power: 'Electricity',
  fire: 'Fire',
};

const DEPOT_FOR: Record<CrewType, string> = {
  roads: 'highways depot',
  water: 'water depot',
  power: 'electricity depot',
  fire: 'fire station',
};

/** "2 h 05 min", "35 min". */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const hrs = Math.floor(m / 60);
  const rest = m % 60;
  if (hrs >= 48) return `${Math.round(hrs / 24)} days`;
  return rest === 0 ? `${hrs} h` : `${hrs} h ${String(rest).padStart(2, '0')} min`;
}

export const crewLabel = (c: Crew): string => `${CREW_NAMES[c.type]} crew ${c.id}`;

/** "Resurfacing", "Burst water main repair", "Main renewal". */
function workName(snap: SimSnapshot, o: WorkOrder): string {
  if (o.type === 'firefighting') return 'Firefighting';
  if (o.type === 'repair') {
    const inc = snap.incidents.find((i) => i.id === o.incidentId);
    return inc ? `${inc.title} repair` : 'Repair';
  }
  return o.asset.layer === 'road'
    ? 'Resurfacing'
    : o.asset.layer === 'main'
      ? 'Main renewal'
      : 'Maintenance';
}

const place = (snap: SimSnapshot, tile: number): string =>
  `${tile % snap.world.width}, ${Math.floor(tile / snap.world.width)}`;

export class Inbox {
  readonly el = h('aside', { class: 'panel inbox hidden', 'aria-label': 'Incidents and work' });
  private key = '';

  constructor(private readonly actions: InboxActions) {}

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }

  toggle(force?: boolean): void {
    const on = force ?? !this.open;
    this.el.classList.toggle('hidden', !on);
    this.key = '';
  }

  update(snap: SimSnapshot): void {
    if (!this.open) return;
    const active = document.activeElement;
    if (active && this.el.contains(active) && active.tagName === 'SELECT') return;
    const orders = snap.workOrders.map((o) => `${o.id}${o.status}${o.priority}${o.crewId}`).join();
    const permits = snap.permits.map((p) => `${p.id}:${p.orders.length}:${p.end}`).join();
    const key = `${Math.floor(snap.minute / 5)}:${snap.assets.nextIncidentId}:${orders}:${permits}:${snap.cash}`;
    if (key === this.key) return;
    this.key = key;
    this.render(snap);
  }

  private render(snap: SimSnapshot): void {
    const el = this.el;
    clear(el);
    const close = h('button', { class: 'close', title: 'Close (`)' }, '×');
    close.addEventListener('click', () => this.toggle(false));
    el.append(h('div', { class: 'inbox-head' }, h('h3', {}, 'Incidents and work'), close));
    el.append(this.kpis(snap));

    const open = snap.incidents
      .filter(isOpen)
      .sort((a, b) => b.severity - a.severity || a.id - b.id);
    el.append(h('h4', {}, `Open incidents (${open.length})`));
    if (open.length === 0) el.append(h('p', { class: 'muted' }, 'Nothing needs attention.'));
    for (const inc of open) el.append(this.incidentCard(snap, inc));

    const planned = snap.workOrders.filter((o) => o.type === 'maintenance');
    el.append(h('h4', {}, `Planned maintenance (${planned.length})`));
    if (planned.length === 0) {
      el.append(
        h(
          'p',
          { class: 'muted' },
          'Use the Plan maintenance tool (;) or the inspector to book work on worn assets.',
        ),
      );
    }
    const list = h('div', { class: 'orders' });
    for (const o of planned.slice(0, 40)) list.append(this.orderRow(snap, o));
    if (planned.length > 40)
      list.append(h('p', { class: 'muted' }, `…and ${planned.length - 40} more`));
    el.append(list);

    el.append(h('h4', {}, `Roadworks and permits (${snap.permits.length})`));
    el.append(this.roadworks(snap));

    el.append(h('h4', {}, 'Crews'));
    el.append(this.crewList(snap));

    const resolved = snap.incidents
      .filter((i) => !isOpen(i))
      .slice(-6)
      .reverse();
    if (resolved.length > 0) {
      el.append(h('h4', {}, 'Recently closed'));
      for (const inc of resolved) {
        const how =
          inc.outcome === 'repaired'
            ? `repaired in ${formatDuration(inc.resolvedMinute - inc.openedMinute)}`
            : inc.outcome === 'cleared'
              ? `cleared after ${formatDuration(inc.resolvedMinute - inc.openedMinute)}`
              : 'asset removed';
        const sla =
          inc.slaMinutes > 0 && inc.outcome !== 'removed'
            ? inc.slaBreached
              ? ' · SLA missed'
              : ' · within SLA'
            : '';
        el.append(h('div', { class: 'closed muted' }, `${inc.title}: ${how}${sla}`));
      }
    }
  }

  private kpis(snap: SimSnapshot): HTMLElement {
    const k = snap.assets.kpi;
    const mttr = mttrMinutes(snap);
    const slaTotal = k.slaMet + k.slaMissed;
    const item = (label: string, value: string) =>
      h('div', { class: 'kpi' }, h('span', { class: 'muted' }, label), h('strong', {}, value));
    return h(
      'div',
      { class: 'kpis' },
      item('Mean time to repair', k.repairs > 0 ? formatDuration(mttr) : '–'),
      item('Customer-minutes today', formatInt(k.customerMinutesToday)),
      item('Yesterday', formatInt(k.customerMinutesYesterday)),
      item('Within SLA', slaTotal > 0 ? `${Math.round((100 * k.slaMet) / slaTotal)}%` : '–'),
    );
  }

  private incidentCard(snap: SimSnapshot, inc: Incident): HTMLElement {
    const age = snap.minute - inc.openedMinute;
    const sla =
      inc.slaMinutes <= 0
        ? ''
        : inc.slaBreached
          ? ' · SLA missed'
          : ` · SLA ${formatDuration(inc.slaMinutes - age)} left`;
    const go = h('button', { class: 'small', title: 'Show on the map' }, 'Go to');
    go.addEventListener('click', () => this.actions.focusTile(inc.tile));
    const card = h(
      'div',
      { class: `incident sev-${inc.severity}` },
      h(
        'div',
        { class: 'incident-title' },
        h('span', { class: `badge sev-${inc.severity}` }, severityName(inc.severity)),
        h('strong', {}, inc.title),
        go,
      ),
      h(
        'div',
        { class: 'muted' },
        `At ${place(snap, inc.tile)} · open ${formatDuration(age)}${sla}`,
      ),
    );
    if (inc.kind === 'overflow') {
      card.append(
        h(
          'div',
          {},
          'Sewage works overwhelmed by storm water. It stops when the rain eases; more works capacity prevents it.',
        ),
      );
      return card;
    }
    if (inc.customers > 0) {
      const pri = inc.priorityCustomers > 0 ? ` (${inc.priorityCustomers} priority)` : '';
      card.append(h('div', {}, `${formatInt(inc.customers)} customers without supply${pri}`));
    }
    if (inc.bottledWater)
      card.append(h('div', { class: 'good' }, 'Bottled water delivered to priority customers.'));
    else if (inc.priorityCustomers > 0 && isWaterIncident(snap.buildingById, inc)) {
      const b = h(
        'button',
        { class: 'small primary' },
        `Send bottled water (${formatMoney(ASSETS.bottledWater.cost)})`,
      );
      b.addEventListener('click', () =>
        this.actions.dispatch({ type: 'sendBottledWater', incident: inc.id }),
      );
      card.append(b);
    }
    const o = snap.workOrders.find((x) => x.id === inc.orderId);
    if (o) card.append(this.orderControls(snap, o));
    return card;
  }

  private orderStatus(snap: SimSnapshot, o: WorkOrder): string {
    const crew = snap.crews.find((c) => c.id === o.crewId);
    switch (o.status) {
      case 'queued': {
        const any = snap.crews.some((c) => c.type === o.crew);
        return any
          ? `Waiting for a ${CREW_NAMES[o.crew].toLowerCase()} crew`
          : `No ${CREW_NAMES[o.crew].toLowerCase()} crew: build a ${DEPOT_FOR[o.crew]}`;
      }
      case 'enRoute': {
        const mins = crew ? crew.arriveMinute - snap.minute : 0;
        const mob = crew && crew.departMinute > snap.minute ? 'mobilising, ' : '';
        return `${crew ? crewLabel(crew) : 'Crew'} ${mob}on site in ${formatDuration(mins)}`;
      }
      case 'onSite':
        return `${crew ? crewLabel(crew) : 'Crew'} on site, done in ${formatDuration(o.startedMinute + o.workMinutes - snap.minute)}`;
    }
  }

  /** Status line, priority picker and crew picker for a work order. */
  private orderControls(snap: SimSnapshot, o: WorkOrder): HTMLElement {
    const row = h('div', { class: 'order-controls' }, h('div', {}, this.orderStatus(snap, o)));
    const pri = h('select', { title: 'Priority' });
    for (let p = 1; p <= 4; p++) {
      const opt = h('option', { value: String(p) }, ASSETS.priorityNames[p] ?? String(p));
      if (p === o.priority) opt.selected = true;
      pri.append(opt);
    }
    pri.addEventListener('change', () =>
      this.actions.dispatch({ type: 'setOrderPriority', order: o.id, priority: Number(pri.value) }),
    );
    const controls = h('div', { class: 'row' }, pri);
    if (o.status !== 'onSite') {
      const crews = snap.crews.filter(
        (c) => c.type === o.crew && c.status !== 'onSite' && c.id !== o.crewId,
      );
      if (crews.length > 0) {
        const pick = h(
          'select',
          { title: 'Send a crew' },
          h('option', { value: '' }, 'Send crew…'),
        );
        for (const c of crews) {
          const busy =
            c.status === 'enRoute' ? ' (divert)' : c.status === 'returning' ? ' (returning)' : '';
          pick.append(h('option', { value: String(c.id) }, `${crewLabel(c)}${busy}`));
        }
        pick.addEventListener('change', () => {
          if (pick.value)
            this.actions.dispatch({ type: 'assignCrew', crew: Number(pick.value), order: o.id });
        });
        controls.append(pick);
      }
    }
    if (o.type === 'maintenance' && o.status !== 'onSite') {
      const cancel = h('button', { class: 'small danger', title: 'Cancel and refund' }, 'Cancel');
      cancel.addEventListener('click', () =>
        this.actions.dispatch({ type: 'cancelOrder', order: o.id }),
      );
      controls.append(cancel);
    }
    row.append(controls);
    return row;
  }

  private orderRow(snap: SimSnapshot, o: WorkOrder): HTMLElement {
    const go = h('button', { class: 'small' }, 'Go to');
    go.addEventListener('click', () => this.actions.focusTile(o.tile));
    let what: string;
    if (o.asset.layer === 'facility') {
      const b = snap.buildingById.get(o.asset.id);
      what = b ? (buildingDef(b.code)?.name ?? 'Facility') : 'Facility';
    } else what = { road: 'Road', main: 'Water main', line: 'Power line' }[o.asset.layer];
    return h(
      'div',
      { class: 'order' },
      h(
        'div',
        { class: 'incident-title' },
        h('strong', {}, `${what} at ${place(snap, o.tile)}`),
        go,
      ),
      h(
        'div',
        { class: 'muted' },
        `${formatDuration(o.workMinutes)} of work · ${formatMoney(o.cost)} paid`,
      ),
      this.orderControls(snap, o),
    );
  }

  /** The permit calendar: every booked or active street works slot, soonest first. */
  private roadworks(snap: SimSnapshot): HTMLElement {
    const box = h('div', { class: 'permits' });
    const k = snap.traffic.kpi;
    box.append(
      h(
        'div',
        { class: 'muted' },
        `${k.combined} works combined (${formatMoney(k.combinedSavings)} saved) · ${k.clashes} clashes · ${k.overruns} overruns · ${k.nightWorks} night jobs`,
      ),
    );
    if (snap.permits.length === 0) {
      box.append(
        h(
          'p',
          { class: 'muted' },
          'No street works. Works on roads (resurfacing, mains under roads) book a permit for their street.',
        ),
      );
      return box;
    }
    const sorted = [...snap.permits].sort((a, b) => a.start - b.start || a.id - b.id);
    for (const p of sorted) box.append(this.permitCard(snap, p));
    return box;
  }

  private permitCard(snap: SimSnapshot, p: Permit): HTMLElement {
    const w = snap.world;
    const first = p.tiles[0] ?? 0;
    const roadName = roadClassByCode(w.road[first] ?? 0)?.name ?? 'Road';
    const active = p.start <= snap.minute;
    const clashes = snap.trafficCache.clashes.get(p.id) ?? [];
    const orders = p.orders
      .map((id) => snap.workOrders.find((o) => o.id === id))
      .filter((o): o is WorkOrder => !!o);
    const what = orders.map((o) => workName(snap, o));
    const unique = [...new Set(what)];
    const go = h('button', { class: 'small', title: 'Show on the map' }, 'Go to');
    go.addEventListener('click', () => this.actions.focusTile(first));
    const flags = h('div', { class: 'flags' });
    const flag = (text: string, bad = false) =>
      flags.append(h('span', { class: `flag${bad ? ' bad' : ''}` }, text));
    flag(p.kind === 'emergency' ? 'Emergency' : 'Planned');
    flag(p.closure === 'full' ? 'Road closed' : 'Lane closed');
    if (p.night) flag('Night works');
    if (p.combined) flag('Combined');
    if (p.overrun) flag('Overrunning', true);
    if (clashes.length > 0) flag('Clash', true);
    const card = h(
      'div',
      { class: `permit${active ? ' active' : ''}${clashes.length > 0 ? ' clash' : ''}` },
      h(
        'div',
        { class: 'incident-title' },
        h('strong', {}, `Permit ${p.id}: ${roadName.toLowerCase()} at ${place(snap, first)}`),
        go,
      ),
      h(
        'div',
        { class: 'muted' },
        `${active ? 'Since' : 'From'} ${slotLabel(snap.minute, p.start)} to ${slotLabel(snap.minute, p.end)} · ${p.tiles.length} tile${p.tiles.length === 1 ? '' : 's'}`,
      ),
      flags,
      h('div', {}, unique.length > 0 ? unique.join(', ') : 'Works'),
    );
    // The button sits on the permit that moves: planned works join an
    // emergency dig; otherwise the later booking joins the earlier one.
    for (const other of clashes) {
      const o = snap.permits.find((x) => x.id === other);
      if (!o) continue;
      const moves = p.kind !== o.kind ? p.kind === 'planned' : p.id > o.id;
      if (!moves) continue;
      const b = h(
        'button',
        {
          class: 'small primary',
          title: 'One closure for both jobs; planned works are discounted',
        },
        `Combine into permit ${o.id}`,
      );
      b.addEventListener('click', () =>
        this.actions.dispatch({ type: 'combinePermits', from: p.id, into: o.id }),
      );
      card.append(b);
    }
    return card;
  }

  private crewList(snap: SimSnapshot): HTMLElement {
    const box = h('div', { class: 'crews' });
    for (const type of CREW_TYPES) {
      const crews = snap.crews.filter((c) => c.type === type);
      if (crews.length === 0) {
        box.append(
          h('div', { class: 'muted' }, `${CREW_NAMES[type]}: none (build a ${DEPOT_FOR[type]})`),
        );
        continue;
      }
      const busy = crews.filter((c) => c.status !== 'idle').length;
      box.append(
        h(
          'div',
          {},
          h('strong', {}, `${CREW_NAMES[type]}`),
          ` · ${crews.length - busy} of ${crews.length} free`,
        ),
      );
      for (const c of crews) {
        const o = snap.workOrders.find((x) => x.id === c.orderId);
        const status =
          c.status === 'idle'
            ? 'at the depot'
            : c.status === 'returning'
              ? 'returning to the depot'
              : c.status === 'enRoute'
                ? `on the way to ${o ? place(snap, o.tile) : 'a job'}`
                : `working at ${o ? place(snap, o.tile) : 'a site'}`;
        box.append(h('div', { class: 'muted crew' }, `${crewLabel(c)}: ${status}`));
      }
    }
    return box;
  }
}
