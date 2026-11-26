/**
 * The KPI dashboard (Shift+D or the 📊 button): headline service figures as
 * stat tiles, each with the value now and a sparkline of the last days from
 * `snapshot.kpis.days` (one series per tile, so no legend; hover or focus a
 * sparkline for the day's value), monthly accounts, and a table view of the
 * daily figures. Reads the snapshot only.
 */
import { ledgerExpenses, ledgerIncome, mttrMinutes } from '../sim';
import type { DailyKpi, SimSnapshot } from '../sim';
import { clear, h } from './dom';
import { formatInt, formatMoney } from './format';
import { formatDuration } from './inbox';

/** Sparkline ink: the validated dark-surface blue (dataviz palette slot 1, dark). */
const SERIES = '#338ced';
const SVG = 'http://www.w3.org/2000/svg';
const W = 160;
const H = 38;
const PAD = 5;

interface Tile {
  title: string;
  now: string;
  sub: string;
  series: (d: DailyKpi) => number | null;
  fmt: (v: number) => string;
  /** Draw a zero line (series that go negative). */
  zero?: boolean;
  /** Higher is worse (for the sub-line wording only). */
  bad?: 'up' | 'down';
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** A single-series sparkline with a hover/focus readout. */
function sparkline(days: readonly DailyKpi[], tile: Tile, readout: HTMLElement): Element {
  const pts = days
    .map((d) => ({ day: d.day, v: tile.series(d) }))
    .filter((p): p is { day: number; v: number } => p.v !== null && Number.isFinite(p.v));
  if (pts.length < 2)
    return h('div', { class: 'spark-empty muted' }, 'A line appears after two days.');
  let lo = Math.min(...pts.map((p) => p.v));
  let hi = Math.max(...pts.map((p) => p.v));
  if (tile.zero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (hi - lo < 1e-9) {
    hi += 1;
    lo -= 1;
  }
  const x = (k: number) => PAD + (k * (W - 2 * PAD)) / (pts.length - 1);
  const y = (v: number) => H - PAD - ((v - lo) / (hi - lo)) * (H - 2 * PAD);
  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    width: W,
    height: H,
    class: 'spark',
    tabindex: 0,
    role: 'img',
    'aria-label': `${tile.title}, last ${pts.length} days: from ${tile.fmt(pts[0]!.v)} to ${tile.fmt(pts[pts.length - 1]!.v)}`,
  });
  // Recessive baseline (zero where the series crosses it, else the lowest value).
  const base = tile.zero ? y(0) : H - PAD;
  svg.append(svgEl('line', { x1: PAD, x2: W - PAD, y1: base, y2: base, class: 'spark-base' }));
  svg.append(
    svgEl('polyline', {
      points: pts.map((p, k) => `${x(k).toFixed(1)},${y(p.v).toFixed(1)}`).join(' '),
      fill: 'none',
      stroke: SERIES,
      'stroke-width': 2,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
    }),
  );
  const last = pts[pts.length - 1]!;
  svg.append(
    svgEl('circle', {
      cx: x(pts.length - 1),
      cy: y(last.v),
      r: 4,
      fill: SERIES,
      class: 'spark-dot',
    }),
  );
  const hair = svgEl('line', {
    x1: 0,
    x2: 0,
    y1: 2,
    y2: H - 2,
    class: 'spark-hair',
    visibility: 'hidden',
  });
  const mark = svgEl('circle', { r: 4, fill: SERIES, class: 'spark-dot', visibility: 'hidden' });
  svg.append(hair, mark);
  const idle = readout.textContent ?? '';
  let at = pts.length - 1;
  const show = (k: number) => {
    at = Math.max(0, Math.min(pts.length - 1, k));
    const p = pts[at]!;
    hair.setAttribute('x1', String(x(at)));
    hair.setAttribute('x2', String(x(at)));
    hair.setAttribute('visibility', 'visible');
    mark.setAttribute('cx', String(x(at)));
    mark.setAttribute('cy', String(y(p.v)));
    mark.setAttribute('visibility', 'visible');
    readout.textContent = '';
    readout.append(h('strong', {}, tile.fmt(p.v)), ` day ${p.day}`);
  };
  const hide = () => {
    hair.setAttribute('visibility', 'hidden');
    mark.setAttribute('visibility', 'hidden');
    readout.textContent = idle;
  };
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const fx = ((e.clientX - r.left) / r.width) * W;
    show(Math.round(((fx - PAD) / (W - 2 * PAD)) * (pts.length - 1)));
  });
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('focus', () => show(at));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(at - 1);
    else if (e.key === 'ArrowRight') show(at + 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  return svg;
}

export class Dashboard {
  readonly el = h('aside', { class: 'panel inbox dashboard hidden', 'aria-label': 'Dashboard' });
  private key = '';
  private table = false;

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
    // Do not rebuild under the pointer or keyboard focus (it would end a hover readout).
    if (this.el.matches(':hover') && this.key !== '') return;
    const key = `${Math.floor(snap.minute / 15)}:${snap.kpis.days.length}:${this.table}`;
    if (key === this.key) return;
    this.key = key;
    this.render(snap);
  }

  private tiles(snap: SimSnapshot): Tile[] {
    const k = snap.assets.kpi;
    const fk = snap.services.fireKpi;
    const m = snap.economy.month;
    const net = ledgerIncome(m) - ledgerExpenses(m);
    const off = snap.city.buildingsOffSupply();
    const openInc = snap.incidents.filter((i) => i.resolvedMinute < 0 && i.customers > 0).length;
    const mins = (v: number) => (v < 0 ? 'none yet' : formatDuration(v));
    return [
      {
        title: 'Supply interruptions',
        now: off === 0 ? 'None now' : `${formatInt(off)} off supply`,
        sub: `${openInc} incident${openInc === 1 ? '' : 's'} affecting customers · daily: incidents opened`,
        series: (d) => d.incidents,
        fmt: (v) => `${formatInt(v)} incidents`,
      },
      {
        title: 'Customer-minutes lost',
        now: formatInt(k.customerMinutesToday),
        sub: `today · yesterday ${formatInt(k.customerMinutesYesterday)}`,
        series: (d) => d.customerMinutes,
        fmt: (v) => formatInt(v),
      },
      {
        title: 'Mean time to repair',
        now: k.repairs > 0 ? formatDuration(mttrMinutes(snap)) : 'No repairs yet',
        sub: `${formatInt(k.repairs)} repairs · SLA met ${formatInt(k.slaMet)}, missed ${formatInt(k.slaMissed)}`,
        series: (d) => (d.mttrMinutes >= 0 ? d.mttrMinutes : null),
        fmt: mins,
      },
      {
        title: 'Congestion index',
        now: snap.traffic.congestion.toFixed(2),
        sub: `trips take ${Math.max(0, Math.round((snap.traffic.congestion - 1) * 100))}% longer than on empty roads · daily peak`,
        series: (d) => d.congestion,
        fmt: (v) => v.toFixed(2),
      },
      {
        title: 'Cash flow',
        now: formatMoney(net),
        sub: `this month so far · cash ${formatMoney(snap.cash)} · daily change`,
        series: (d) => d.cashFlow,
        fmt: (v) => formatMoney(v),
        zero: true,
      },
      {
        title: 'Happiness',
        now: snap.happiness.city > 0 ? `${Math.round(snap.happiness.city)} / 100` : '–',
        sub: `${snap.complaints.length} recent complaints`,
        series: (d) => (d.happiness > 0 ? d.happiness : null),
        fmt: (v) => `${Math.round(v)}`,
      },
      {
        title: 'Fire response',
        now: fk.responses > 0 ? formatDuration(fk.responseMinutes / fk.responses) : 'No fires yet',
        sub: `${formatInt(fk.fires)} fires · ${formatInt(fk.extinguished)} put out, ${formatInt(fk.destroyed)} burnt down`,
        series: (d) => (d.fireResponse >= 0 ? d.fireResponse : null),
        fmt: mins,
      },
    ];
  }

  private render(snap: SimSnapshot): void {
    const el = this.el;
    clear(el);
    const close = h('button', { class: 'close', title: 'Close (Shift+D)' }, '×');
    close.addEventListener('click', () => this.toggle(false));
    const view = h('button', { class: 'small' }, this.table ? 'Show charts' : 'Show table');
    view.addEventListener('click', () => {
      this.table = !this.table;
      this.key = '';
      this.update(snap);
    });
    el.append(
      h('div', { class: 'inbox-head' }, h('h3', {}, 'Dashboard'), h('div', {}, view, close)),
    );
    const days = snap.kpis.days.slice(-30);
    if (this.table) el.append(this.tableView(days));
    else {
      const grid = h('div', { class: 'kpi-tiles' });
      for (const t of this.tiles(snap)) {
        const readout = h('div', { class: 'kpi-tile-sub muted' }, t.sub);
        grid.append(
          h(
            'section',
            { class: 'kpi-tile' },
            h('div', { class: 'kpi-tile-title' }, t.title),
            h('div', { class: 'kpi-tile-now' }, t.now),
            sparkline(days, t, readout),
            readout,
          ),
        );
      }
      el.append(grid);
      if (days.length === 0)
        el.append(h('p', { class: 'muted' }, 'Daily figures are recorded at midnight.'));
    }
    el.append(h('h4', {}, 'Monthly accounts'));
    const hist = snap.economy.history.slice(-6);
    if (hist.length === 0)
      el.append(h('p', { class: 'muted' }, 'The first month closes on day 30.'));
    else {
      el.append(
        h(
          'table',
          { class: 'kpi-table' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', {}, 'Month'),
              h('th', {}, 'Income'),
              h('th', {}, 'Spending'),
              h('th', {}, 'Net'),
            ),
          ),
          h(
            'tbody',
            {},
            ...hist.map((mo) =>
              h(
                'tr',
                {},
                h('td', {}, String(mo.month)),
                h('td', {}, formatMoney(mo.income)),
                h('td', {}, formatMoney(mo.expenses)),
                h('td', {}, formatMoney(mo.income - mo.expenses)),
              ),
            ),
          ),
        ),
      );
    }
  }

  private tableView(days: readonly DailyKpi[]): HTMLElement {
    if (days.length === 0)
      return h('p', { class: 'muted' }, 'Daily figures are recorded at midnight.');
    const mins = (v: number) => (v < 0 ? '–' : formatDuration(v));
    return h(
      'div',
      { class: 'kpi-table-wrap' },
      h(
        'table',
        { class: 'kpi-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            ...[
              'Day',
              'Incidents',
              'Most off',
              'Cust.-min',
              'MTTR',
              'Congestion',
              'Cash flow',
              'Happy',
            ].map((c) => h('th', {}, c)),
          ),
        ),
        h(
          'tbody',
          {},
          ...[...days]
            .reverse()
            .map((d) =>
              h(
                'tr',
                {},
                h('td', {}, String(d.day)),
                h('td', {}, formatInt(d.incidents)),
                h('td', {}, formatInt(d.peakOff)),
                h('td', {}, formatInt(d.customerMinutes)),
                h('td', {}, mins(d.mttrMinutes)),
                h('td', {}, d.congestion.toFixed(2)),
                h('td', {}, formatMoney(d.cashFlow)),
                h('td', {}, d.happiness > 0 ? String(Math.round(d.happiness)) : '–'),
              ),
            ),
        ),
      ),
    );
  }
}
