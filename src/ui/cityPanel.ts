/**
 * The city panel: happiness and what drives it, the events calendar (with the
 * preparations the player can book), the complaints feed and the service
 * figures (fires, waste). Reads the snapshot; acts only through commands.
 */
import {
  CITY,
  EVENT_MEASURES,
  SERVICES,
  cityEventDef,
  clockString,
  crowdWindow,
  dayOf,
} from '../sim';
import type { CityEvent, Command, EventMeasure, HappinessFactor, SimSnapshot } from '../sim';
import { clear, h } from './dom';
import { formatInt, formatMoney } from './format';
import { formatDuration } from './inbox';

export interface CityPanelActions {
  dispatch(cmd: Command): void;
  focusTile(tile: number): void;
}

export const FACTOR_NAMES: Record<HappinessFactor, string> = {
  services: 'Public services',
  utilities: 'Power and water',
  waste: 'Bin collections',
  commute: 'Commutes',
  pollution: 'Clean, quiet air',
  taxes: 'Council tax',
  landValue: 'Neighbourhood',
};

const MEASURE_NAMES: Record<EventMeasure, string> = {
  policing: 'Extra police',
  stewarding: 'Stewards and park and ride',
  closeRoads: 'Close roads by the venue',
  cleanup: 'Street cleaning',
};

const MEASURE_HELP: Record<EventMeasure, string> = {
  policing: 'Enough officers for the crowd, whatever the local station can spare',
  stewarding: `About ${Math.round(SERVICES.eventMeasures.stewarding.carReduction * 100)}% fewer cars to and from the event`,
  closeRoads:
    'Roads beside the venue close while the crowds are there: safer crowds, but traffic must go round',
  cleanup: 'Litter is cleared straight away instead of going into the next bin round',
};

/** "Day 12, 15:00". */
const when = (minute: number) => `Day ${dayOf(minute)}, ${clockString(minute)}`;

export class CityPanel {
  readonly el = h('aside', { class: 'panel inbox citypanel hidden', 'aria-label': 'City' });
  private key = '';

  constructor(private readonly actions: CityPanelActions) {}

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
    const events = snap.events.map((e) => `${e.id}${e.status}${e.measures.length}`).join();
    const last = snap.complaints[snap.complaints.length - 1]?.id ?? 0;
    const key = `${Math.floor(snap.minute / 10)}:${events}:${last}:${snap.cash}`;
    if (key === this.key) return;
    this.key = key;
    this.render(snap);
  }

  private render(snap: SimSnapshot): void {
    const el = this.el;
    clear(el);
    const close = h('button', { class: 'close', title: 'Close (Shift+N)' }, '×');
    close.addEventListener('click', () => this.toggle(false));
    el.append(h('div', { class: 'inbox-head' }, h('h3', {}, 'The city'), close));

    const hp = snap.happiness;
    el.append(h('h4', {}, `Happiness ${Math.round(hp.city)} / 100`));
    const W = CITY.happiness.weights;
    for (const k of Object.keys(W) as HappinessFactor[]) {
      const v = hp.factors[k];
      el.append(
        h(
          'div',
          { class: 'factor' },
          h('span', {}, FACTOR_NAMES[k]),
          h('span', { class: 'meter' }, h('span', { style: `width:${Math.round(v * 100)}%` })),
          h('span', { class: 'muted num' }, `${Math.round(v * W[k])}/${W[k]}`),
        ),
      );
    }
    if (hp.complaintPenalty > 0)
      el.append(
        h('div', { class: 'muted' }, `Complaints in the last day: −${hp.complaintPenalty}`),
      );

    el.append(h('h4', {}, 'Events calendar'));
    const upcoming = snap.events
      .filter((e) => e.status !== 'done')
      .sort((a, b) => a.start - b.start);
    if (upcoming.length === 0) {
      el.append(
        h(
          'p',
          { class: 'muted' },
          'Build a stadium, shopping centre, university or events centre to host events.',
        ),
      );
    }
    for (const e of upcoming) el.append(this.eventCard(snap, e));
    const done = snap.events
      .filter((e) => e.status === 'done')
      .slice(-4)
      .reverse();
    for (const e of done) {
      const def = cityEventDef(e.type);
      const notes = [
        `${formatInt(e.attendance)} came`,
        `levy ${formatMoney(e.revenue)}`,
        e.trouble ? 'crowd trouble' : 'no trouble',
        e.litter ? 'litter left' : 'streets cleaned',
        e.congestion > 0 ? `traffic index ${e.congestion.toFixed(2)}` : '',
      ].filter((x) => x !== '');
      el.append(
        h('div', { class: 'closed muted' }, `${def.name} (${when(e.start)}): ${notes.join(', ')}`),
      );
    }

    el.append(h('h4', {}, `Complaints (${snap.complaints.length})`));
    if (snap.complaints.length === 0) el.append(h('p', { class: 'muted' }, 'No complaints. Yet.'));
    for (const c of [...snap.complaints].reverse().slice(0, 20)) {
      const row = h(
        'button',
        { class: 'complaint', title: 'Show on the map' },
        h('span', { class: 'muted' }, `${formatDuration(snap.minute - c.minute)} ago · `),
        c.text,
      );
      if (c.tile >= 0) row.addEventListener('click', () => this.actions.focusTile(c.tile));
      el.append(row);
    }

    const f = snap.services.fireKpi;
    const w = snap.services.waste;
    el.append(h('h4', {}, 'Fire and waste'));
    el.append(
      h(
        'div',
        { class: 'muted' },
        `Fires ${f.fires} · put out ${f.extinguished} · burnt down ${f.destroyed} · average response ${f.responses > 0 ? formatDuration(f.responseMinutes / f.responses) : '–'}`,
      ),
      h(
        'div',
        { class: 'muted' },
        `Last bin round: ${w.collectedT.toFixed(1)} of ${w.generatedT.toFixed(1)} t collected (${w.recycledT.toFixed(1)} t recycled), ${formatInt(w.missed)} buildings missed`,
      ),
    );
  }

  private eventCard(snap: SimSnapshot, e: CityEvent): HTMLElement {
    const def = cityEventDef(e.type);
    const venue = snap.buildingById.get(e.venue);
    const [from] = crowdWindow(e);
    const status =
      e.status === 'live'
        ? snap.minute < e.start
          ? 'crowds arriving'
          : snap.minute < e.end
            ? 'under way'
            : 'crowds leaving'
        : `in ${formatDuration(from - snap.minute)}`;
    const card = h(
      'div',
      { class: `incident event ${e.status}` },
      h(
        'div',
        { class: 'incident-title' },
        h('strong', {}, def.name),
        venue ? this.goButton(venue.y * snap.world.width + venue.x) : null,
      ),
      h(
        'div',
        { class: 'muted' },
        `${when(e.start)} · ${formatInt(e.attendance)} expected · ${status}`,
      ),
    );
    const row = h('div', { class: 'row measures' });
    for (const m of EVENT_MEASURES) {
      const done = e.measures.includes(m);
      const cost = snap.city.measureCost(e, m);
      const b = h(
        'button',
        {
          class: `small${done ? ' active' : ''}`,
          title: `${MEASURE_HELP[m]} (${formatMoney(cost)})`,
        },
        `${MEASURE_NAMES[m]}${done ? ' ✓' : ` ${formatMoney(cost)}`}`,
      );
      if (done || e.status !== 'booked') b.setAttribute('disabled', '');
      else
        b.addEventListener('click', () =>
          this.actions.dispatch({ type: 'prepareEvent', event: e.id, measure: m }),
        );
      row.append(b);
    }
    card.append(row);
    return card;
  }

  private goButton(tile: number): HTMLElement {
    const go = h('button', { class: 'small', title: 'Show on the map' }, 'Go to');
    go.addEventListener('click', () => this.actions.focusTile(tile));
    return go;
  }
}
