/**
 * The overlay switcher: a top-bar button that opens a list of every map
 * overlay (grouped as in overlays.json), and the legend for the active one.
 * O cycles through them in the same order. Colours come from the data files,
 * so the legend always matches the map.
 */
import { OVERLAYS, TRAFFIC, WATER } from '../sim';
import type { OverlayId } from '../sim';
import { clear, h } from './dom';

/** Overlay order for the O key and the menu. */
export const OVERLAY_ORDER: readonly OverlayId[] = ['none', ...OVERLAYS.map((o) => o.id)];

export const overlayName = (id: OverlayId): string =>
  id === 'none' ? 'No overlay' : (OVERLAYS.find((o) => o.id === id)?.name ?? id);

export class OverlayMenu {
  readonly button = h('button', { class: 'chip overlay-chip', title: 'Map overlays (O cycles)' });
  readonly menu = h('div', { class: 'panel overlay-menu hidden', role: 'menu' });
  readonly legend = h('div', { class: 'panel legend hidden', 'aria-live': 'polite' });
  private readonly items = new Map<OverlayId, HTMLButtonElement>();
  private current: OverlayId = 'none';

  constructor(private readonly choose: (id: OverlayId) => void) {
    this.button.addEventListener('click', () => this.menu.classList.toggle('hidden'));
    const add = (id: OverlayId) => {
      const b = h('button', { role: 'menuitemradio' }, overlayName(id));
      b.addEventListener('click', () => {
        this.menu.classList.add('hidden');
        this.choose(id);
      });
      this.items.set(id, b);
      return b;
    };
    this.menu.append(add('none'));
    let group = '';
    for (const o of OVERLAYS) {
      if (o.group !== group) {
        group = o.group;
        this.menu.append(h('div', { class: 'tool-group-label' }, group));
      }
      this.menu.append(add(o.id));
    }
    this.set('none');
  }

  get open(): boolean {
    return !this.menu.classList.contains('hidden');
  }

  close(): void {
    this.menu.classList.add('hidden');
  }

  set(id: OverlayId): void {
    this.current = id;
    this.button.textContent = id === 'none' ? '🗺 Overlays' : `🗺 ${overlayName(id)}`;
    this.button.classList.toggle('active', id !== 'none');
    for (const [k, b] of this.items) {
      b.classList.toggle('active', k === id);
      b.setAttribute('aria-checked', String(k === id));
    }
    clear(this.legend);
    this.legend.classList.toggle('hidden', id === 'none');
    if (id === 'none') return;
    this.legend.append(...legendFor(id));
  }

  get overlay(): OverlayId {
    return this.current;
  }
}

const swatch = (colour: string) =>
  h('span', { class: 'legend-swatch', style: `background:${colour}` });

function bar(ramp: readonly string[]): HTMLElement {
  return h('div', {
    class: 'legend-bar',
    style: `background: linear-gradient(to right, ${ramp.join(', ')})`,
  });
}

function marks(list: readonly (readonly [number, string])[]): HTMLElement {
  const el = h('div', { class: 'legend-marks' });
  for (const [pos, label] of list) el.append(h('span', { style: `left:${pos * 100}%` }, label));
  return el;
}

/** Legend contents for an overlay. */
function legendFor(id: Exclude<OverlayId, 'none'> | OverlayId): HTMLElement[] {
  if (id === 'water') {
    const { ramp, rampMaxM } = WATER.overlay;
    const p = WATER.pressure;
    return [
      h('strong', {}, 'Water pressure'),
      bar(ramp),
      marks([
        [p.noSupplyM / rampMaxM, `${p.noSupplyM}`],
        [p.lowM / rampMaxM, `${p.lowM}`],
        [p.goodM / rampMaxM, `${p.goodM}`],
        [1, `${rampMaxM}+ m`],
      ]),
      h(
        'div',
        { class: 'muted' },
        `Below ${p.noSupplyM} m no supply · below ${p.lowM} m low · ${p.goodM} m+ good`,
      ),
    ];
  }
  if (id === 'traffic') {
    const { ramp, rampMaxRatio, closed, lane } = TRAFFIC.overlay;
    return [
      h('strong', {}, 'Traffic (flow / capacity)'),
      bar(ramp),
      marks([
        [0, '0%'],
        [0.5 / rampMaxRatio, '50%'],
        [1, `${Math.round(rampMaxRatio * 100)}%+`],
      ]),
      h('div', { class: 'muted' }, swatch(closed), ' road closed · ', swatch(lane), ' lane closed'),
    ];
  }
  const def = OVERLAYS.find((o) => o.id === id);
  if (!def) return [];
  const out: HTMLElement[] = [h('strong', {}, def.name)];
  if (def.ramp) {
    out.push(bar(def.ramp));
    if (def.rampLabels) out.push(marks(def.rampLabels));
  }
  if (def.categories) {
    const cats = h('div', { class: 'legend-cats' });
    for (const c of def.categories) cats.append(h('span', {}, swatch(c.colour), ` ${c.label}`));
    out.push(cats);
  }
  return out;
}
