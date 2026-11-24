/**
 * The heads-up display: top bar (time, cash, speed), build toolbar, status line,
 * inspector, toasts and modals. It changes the game only through `UiActions`.
 */
import { GAME_NAME } from '../config';
import { GAME, ZONES, cityTotals, weatherEvent } from '../sim';
import type { DensityId, SimSnapshot } from '../sim';
import type { SlotId, SlotSummary } from '../platform/saves';
import { clear, h } from './dom';
import { formatGameTime, formatInt, formatMW, formatMoney, formatRealDate } from './format';
import { Inspector } from './inspector';
import { Modal } from './modal';
import { CONTROL_ROWS } from './shortcuts';
import { Toasts } from './toasts';
import { TOOLS, toolKey } from './tools';
import type { ToolId } from './tools';

export interface UiActions {
  selectTool(tool: ToolId): void;
  setDensity(d: DensityId): void;
  setSpeed(index: number): void;
  listSaves(): Promise<SlotSummary[]>;
  saveTo(slot: SlotId): Promise<void>;
  loadFrom(slot: SlotId): Promise<void>;
  deleteSlot(slot: SlotId): Promise<void>;
  exportSave(): void;
  importSave(): Promise<void>;
  newGame(seed: number): void;
  setGrid(visible: boolean): void;
  helpClosed(): void;
}

const SLOT_LABELS: Record<SlotId, string> = {
  slot1: 'Slot 1',
  slot2: 'Slot 2',
  slot3: 'Slot 3',
  autosave: 'Autosave',
};

export class Hud {
  readonly root: HTMLDivElement;
  readonly toasts = new Toasts();
  readonly inspector = new Inspector();
  private readonly modal: Modal;
  private readonly timeEl = h('span', { class: 'time' });
  private readonly cashEl = h('span', { class: 'cash' });
  private readonly weatherEl = h('span', { class: 'chip weather' });
  private readonly powerEl = h('span', { class: 'chip power' });
  private readonly popEl = h('span', { class: 'chip population' });
  private lastStatsMinute = -1;
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly toolButtons = new Map<string, HTMLButtonElement>();
  private readonly densityBar = h('div', { class: 'density-bar' });
  private readonly densityButtons = new Map<DensityId, HTMLButtonElement>();
  private readonly statusEl = h('div', { class: 'status' });
  private lastTime = -1;
  private lastCash = Number.NaN;
  private lastSpeed = -1;

  constructor(private readonly actions: UiActions) {
    this.modal = new Modal(() => this.closeModal());
    this.root = h(
      'div',
      { class: 'hud' },
      this.buildTopBar(),
      this.buildToolbar(),
      this.statusEl,
      this.inspector.el,
      this.toasts.el,
      this.modal.el,
    );
  }

  // ---- top bar -----------------------------------------------------------

  private buildTopBar(): HTMLElement {
    const speeds = h('div', { class: 'speeds', role: 'group', 'aria-label': 'Game speed' });
    GAME.speeds.forEach((s, i) => {
      const b = h(
        'button',
        { title: s === 0 ? 'Pause (Space)' : `${s}× speed` },
        s === 0 ? '❚❚' : `${s}×`,
      );
      b.addEventListener('click', () => this.actions.setSpeed(i));
      this.speedButtons.push(b);
      speeds.append(b);
    });
    const menu = h('div', { class: 'menu-buttons' });
    const mk = (label: string, title: string, fn: () => void) => {
      const b = h('button', { title }, label);
      b.addEventListener('click', fn);
      menu.append(b);
    };
    mk('Save / load', 'Save and load (Ctrl+S)', () => this.openSaves());
    mk('New game', 'Start a new city', () => this.openNewGame());
    mk('Help', 'Help and controls (H)', () => this.openHelp());
    return h(
      'header',
      { class: 'panel topbar' },
      h('span', { class: 'title' }, GAME_NAME),
      this.timeEl,
      this.cashEl,
      this.weatherEl,
      this.powerEl,
      this.popEl,
      speeds,
      menu,
    );
  }

  // ---- toolbar -----------------------------------------------------------

  private buildToolbar(): HTMLElement {
    const bar = h('nav', { class: 'panel toolbar', 'aria-label': 'Build tools' });
    let group = '';
    for (const t of TOOLS) {
      if (t.group !== group) {
        group = t.group;
        bar.append(h('div', { class: 'tool-group-label' }, groupLabel(group)));
      }
      const zone =
        t.tool.kind === 'zone'
          ? ZONES.types.find((z) => z.id === (t.tool as { zone: string }).zone)
          : undefined;
      const swatch = zone
        ? h('span', { class: 'swatch', style: `background:${zone.colours.medium}` })
        : null;
      const b = h(
        'button',
        { class: 'tool', title: `${t.label} (${t.keyLabel})` },
        swatch,
        h('span', { class: 'tool-label' }, t.label),
        h('kbd', {}, t.keyLabel),
      );
      b.addEventListener('click', () => this.actions.selectTool(t.tool));
      this.toolButtons.set(t.key, b);
      bar.append(b);
    }
    for (const d of ZONES.densities) {
      const b = h('button', { title: `${d.name} ([ / ])` }, d.name.split(' ')[0]!);
      b.addEventListener('click', () => this.actions.setDensity(d.id));
      this.densityButtons.set(d.id, b);
      this.densityBar.append(b);
    }
    bar.append(this.densityBar);
    return bar;
  }

  setActiveTool(tool: ToolId, density: DensityId): void {
    const key = toolKey(tool);
    for (const [k, b] of this.toolButtons) b.classList.toggle('active', k === key);
    const zone = tool.kind === 'zone' ? ZONES.types.find((z) => z.id === tool.zone) : undefined;
    this.densityBar.classList.toggle('hidden', !zone || !zone.hasDensity);
    for (const [d, b] of this.densityButtons) b.classList.toggle('active', d === density);
  }

  /** One line of hint text at the bottom (cost preview, reasons, tool hints). */
  setStatus(text: string, kind: 'info' | 'error' = 'info'): void {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('status-error', kind === 'error');
    this.statusEl.classList.toggle('hidden', text === '');
  }

  // ---- per-frame update --------------------------------------------------

  update(snap: SimSnapshot, speedIndex: number): void {
    if (snap.minute !== this.lastTime) {
      this.lastTime = snap.minute;
      this.timeEl.textContent = formatGameTime(snap.minute);
    }
    if (snap.cash !== this.lastCash) {
      this.lastCash = snap.cash;
      this.cashEl.textContent = formatMoney(snap.cash);
      this.cashEl.classList.toggle('negative', snap.cash < 0);
    }
    if (Math.floor(snap.minute / 5) !== this.lastStatsMinute) {
      this.lastStatsMinute = Math.floor(snap.minute / 5);
      this.updateChips(snap);
    }
    if (speedIndex !== this.lastSpeed) {
      this.lastSpeed = speedIndex;
      this.speedButtons.forEach((b, i) => b.classList.toggle('active', i === speedIndex));
    }
    this.inspector.update(snap);
  }

  private updateChips(snap: SimSnapshot): void {
    const wx = snap.weather;
    const sky =
      wx.rainMmPerHour >= 4
        ? 'Heavy rain'
        : wx.rainMmPerHour >= 1
          ? 'Rain'
          : wx.rainMmPerHour > 0
            ? 'Drizzle'
            : wx.cloud < 0.3
              ? wx.sunshine > 0
                ? 'Sunny'
                : 'Clear'
              : wx.cloud < 0.7
                ? 'Partly cloudy'
                : 'Overcast';
    const event = wx.event ? ` · ${weatherEvent(wx.event.id).name}` : '';
    this.weatherEl.textContent = `${Math.round(wx.temperatureC)}°C · ${sky} · ${Math.round(wx.windMs)} m/s${event}`;
    this.weatherEl.classList.toggle('alert', wx.event !== null);
    this.weatherEl.title = `Temperature ${wx.temperatureC.toFixed(1)}°C, rain ${wx.rainMmPerHour} mm/h, wind ${wx.windMs.toFixed(1)} m/s, cloud ${Math.round(wx.cloud * 100)}%`;

    const p = snap.power;
    const shedding = p.shedMW > 0;
    this.powerEl.textContent =
      p.capacityMW === 0 && p.islands.length === 0
        ? 'No power'
        : `⚡ ${formatMW(p.servedMW)} / ${formatMW(p.availableMW)}`;
    this.powerEl.classList.toggle('alert', shedding);
    this.powerEl.classList.toggle('warn', !shedding && p.buildingsOff > 0);
    this.powerEl.title = [
      `Demand ${formatMW(p.demandMW)}, supplied ${formatMW(p.servedMW)}`,
      `Generation available ${formatMW(p.availableMW)} (installed ${formatMW(p.capacityMW)})`,
      `Renewables ${formatMW(p.renewableMW)}`,
      p.storageMWh > 0 ? `Storage ${p.storedMWh.toFixed(1)} / ${p.storageMWh} MWh` : '',
      p.buildingsOff > 0
        ? `${formatInt(p.buildingsOff)} buildings without power (${formatInt(p.residentsOff)} residents)`
        : 'Every building has power',
      shedding ? `Rolling outages: ${formatMW(p.shedMW)} short` : '',
    ]
      .filter((x) => x !== '')
      .join('\n');

    const t = cityTotals(snap);
    this.popEl.textContent = `Pop ${formatInt(t.residents)} · Jobs ${formatInt(t.jobs)}`;
    const d = snap.demand;
    const pct = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
    this.popEl.title = `Demand: residential ${pct(d.residential)}, commercial ${pct(d.commercial)}, office ${pct(d.office)}, industrial ${pct(d.industrial)}, agricultural ${pct(d.agricultural)}`;
  }

  // ---- modals ------------------------------------------------------------

  get modalOpen(): boolean {
    return this.modal.isOpen;
  }

  closeModal(): void {
    const wasHelp = this.modal.el.dataset.kind === 'help';
    this.modal.close();
    if (wasHelp) this.actions.helpClosed();
  }

  openHelp(): void {
    this.modal.el.dataset.kind = 'help';
    const body = this.modal.open(`Welcome to ${GAME_NAME}`);
    clear(body);
    body.append(
      h(
        'p',
        {},
        'You run the city day to day. Lay out roads, zone land and keep the lights on: buildings only grow where there is power. Water, traffic, incidents and budgets arrive in later milestones.',
      ),
      h(
        'ol',
        {},
        h(
          'li',
          {},
          'Draw roads with the road tools (drag to lay an L-shaped road). Roads can bridge the river at extra cost.',
        ),
        h(
          'li',
          {},
          'Zone land beside your roads. Farmland must sit near the edge of the map. Industrial plots that touch form a named estate.',
        ),
        h(
          'li',
          {},
          'Build a power station and a substation, and join them with power lines (or place them side by side). Buildings grow within a substation’s reach; demand for each zone is shown on the population counter.',
        ),
        h(
          'li',
          {},
          'Watch the weather and seasons: solar needs sun, wind turbines need wind (but shut down in storms), and heatwaves and cold snaps push demand up. If supply runs short, outages roll round the city; industry is cut before homes.',
        ),
        h(
          'li',
          {},
          'Use the speed controls to run the clock. The game autosaves at the start of each day.',
        ),
      ),
      h('h3', {}, 'Controls'),
      h(
        'table',
        { class: 'controls' },
        h(
          'tbody',
          {},
          ...CONTROL_ROWS.map((r) =>
            h('tr', {}, h('td', {}, h('kbd', {}, r.keys)), h('td', {}, r.action)),
          ),
        ),
      ),
    );
  }

  openNewGame(): void {
    this.modal.el.dataset.kind = 'new';
    const body = this.modal.open('New game');
    clear(body);
    const seedInput = h('input', {
      type: 'number',
      min: '0',
      max: '4294967295',
      value: String(randomSeed()),
    });
    const start = h('button', { class: 'primary' }, 'Start new city');
    start.addEventListener('click', () => {
      const seed = Number.parseInt(seedInput.value, 10);
      this.actions.newGame(Number.isFinite(seed) ? seed >>> 0 : randomSeed());
      this.closeModal();
    });
    body.append(
      h('p', {}, 'Unsaved progress in the current city will be lost.'),
      h('label', { class: 'field' }, 'Map seed ', seedInput),
      h('div', { class: 'row' }, start),
    );
  }

  async openSaves(): Promise<void> {
    this.modal.el.dataset.kind = 'saves';
    const body = this.modal.open('Save and load');
    clear(body);
    body.append(h('p', { class: 'muted' }, 'Loading slots…'));
    let slots: SlotSummary[];
    try {
      slots = await this.actions.listSaves();
    } catch (e) {
      clear(body);
      body.append(h('p', { class: 'error' }, (e as Error).message));
      return;
    }
    clear(body);
    const list = h('div', { class: 'slots' });
    for (const s of slots) {
      const info = s.meta
        ? `Day ${s.meta.day} · ${formatMoney(s.meta.cash)} · saved ${formatRealDate(s.meta.savedAt)}`
        : 'Empty';
      const row = h(
        'div',
        { class: 'slot' },
        h(
          'div',
          { class: 'slot-info' },
          h('strong', {}, SLOT_LABELS[s.slot]),
          h('span', { class: 'muted' }, info),
        ),
      );
      const btns = h('div', { class: 'slot-buttons' });
      const add = (label: string, fn: () => Promise<void>, cls = '') => {
        const b = h('button', { class: cls }, label);
        b.addEventListener('click', () => {
          void fn().then(() => {
            if (this.modal.isOpen && this.modal.el.dataset.kind === 'saves') void this.openSaves();
          });
        });
        btns.append(b);
      };
      const label = SLOT_LABELS[s.slot];
      if (s.slot !== 'autosave') {
        add(
          s.meta ? 'Overwrite' : 'Save here',
          async () => {
            if (s.meta && !window.confirm(`Overwrite ${label}?`)) return;
            await this.actions.saveTo(s.slot);
          },
          'primary',
        );
      }
      if (s.meta) {
        add('Load', async () => {
          await this.actions.loadFrom(s.slot);
          this.closeModal();
        });
        add(
          'Delete',
          async () => {
            if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
            await this.actions.deleteSlot(s.slot);
          },
          'danger',
        );
      }
      row.append(btns);
      list.append(row);
    }
    const exp = h('button', {}, 'Export current city (JSON)');
    exp.addEventListener('click', () => this.actions.exportSave());
    const imp = h('button', {}, 'Import a save file…');
    imp.addEventListener('click', () => {
      void this.actions.importSave().then(() => this.closeModal());
    });
    body.append(list, h('div', { class: 'row' }, exp, imp));
  }
}

function groupLabel(group: string): string {
  return { select: 'Select', roads: 'Roads', zones: 'Zones', demolish: 'Demolish' }[group] ?? group;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
