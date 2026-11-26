/**
 * Menu screens shown in the HUD's modal: the main menu, the sandbox set-up
 * (seed, starting cash, difficulty, weather events, random fires), the
 * scenario list and briefing, the settings panel (graphics, shadows,
 * autosave, controls list) and the end-of-scenario results. They change the
 * game only through the callbacks they are given.
 */
import { GAME_NAME } from '../config';
import { DIFFICULTIES, GAME, SCENARIOS, difficultyDef, scenarioDef } from '../sim';
import type { Difficulty, ObjectiveView } from '../sim';
import type { Settings } from '../platform/settings';
import { clear, h } from './dom';
import { formatMoney } from './format';
import { CONTROL_ROWS } from './shortcuts';

export interface SandboxOptions {
  seed: number;
  startingCash: number;
  difficulty: Difficulty;
  weatherEvents: boolean;
  fires: boolean;
}

export interface MenuActions {
  newSandbox(opts: SandboxOptions): void;
  newScenario(id: string): void;
  /** Load the autosave; resolves false if there is none. */
  continueGame(): Promise<void>;
  hasAutosave(): Promise<boolean>;
  openSaves(): void;
  openHelp(): void;
  settings(): Settings;
  changeSettings(patch: Partial<Settings>): void;
  close(): void;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

export function renderMainMenu(body: HTMLElement, a: MenuActions, inGame: boolean): void {
  clear(body);
  const list = h('div', { class: 'menu-list' });
  const add = (label: string, hint: string, fn: () => void, cls = '') => {
    const b = h(
      'button',
      { class: `menu-item ${cls}` },
      h('strong', {}, label),
      h('span', { class: 'muted' }, hint),
    );
    b.addEventListener('click', fn);
    list.append(b);
    return b;
  };
  if (inGame) add('Resume', 'Back to the city', () => a.close(), 'primary');
  const cont = add('Continue', 'Load the autosave', () => void a.continueGame());
  cont.disabled = true;
  void a.hasAutosave().then((yes) => {
    cont.disabled = !yes;
    if (!yes) cont.querySelector('span')!.textContent = 'No autosave yet';
  });
  add('New sandbox city', 'An empty map: build the city your way', () =>
    renderSandbox(body, a, inGame),
  );
  add('Scenarios', `${SCENARIOS.length} challenges on ready-built cities`, () =>
    renderScenarios(body, a, inGame),
  );
  add('Load a city', 'Save slots, import and export', () => a.openSaves());
  add('Settings', 'Graphics, autosave, controls', () => renderSettings(body, a, inGame));
  add('Help', 'How to play', () => a.openHelp());
  body.append(
    h(
      'p',
      { class: 'muted' },
      `Run a modern city day to day: utilities, roads, maintenance, incidents and budgets.`,
    ),
    list,
  );
}

const back = (body: HTMLElement, a: MenuActions, inGame: boolean): HTMLButtonElement => {
  const b = h('button', {}, '← Back');
  b.addEventListener('click', () => renderMainMenu(body, a, inGame));
  return b;
};

export function renderSandbox(body: HTMLElement, a: MenuActions, inGame: boolean): void {
  clear(body);
  const seed = h('input', {
    type: 'number',
    min: '0',
    max: '4294967295',
    value: String(randomSeed()),
  });
  const diff = h('select', {});
  for (const d of DIFFICULTIES) {
    const def = difficultyDef(d);
    diff.append(h('option', { value: d, ...(d === 'normal' ? { selected: '' } : {}) }, def.name));
  }
  const cash = h('input', {
    type: 'number',
    min: '0',
    step: '10000',
    value: String(GAME.startingCash),
  });
  diff.addEventListener('change', () => {
    cash.value = String(difficultyDef(diff.value as Difficulty).startingCash);
  });
  const weather = h('input', { type: 'checkbox', checked: '' });
  const fires = h('input', { type: 'checkbox', checked: '' });
  const start = h('button', { class: 'primary' }, 'Start the city');
  start.addEventListener('click', () => {
    const s = Number.parseInt(seed.value, 10);
    const c = Number.parseInt(cash.value, 10);
    a.newSandbox({
      seed: Number.isFinite(s) ? s >>> 0 : randomSeed(),
      startingCash: Number.isFinite(c) ? Math.max(0, c) : GAME.startingCash,
      difficulty: diff.value as Difficulty,
      weatherEvents: weather.checked,
      fires: fires.checked,
    });
  });
  const help = h('p', { class: 'muted' });
  const explain = () => {
    const d = difficultyDef(diff.value as Difficulty);
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    help.textContent = `${d.name}: assets fail ${pct(d.failureScale)} and wear ${pct(d.decayScale)} as fast as standard; taxes and exports ${pct(d.incomeScale)}.`;
  };
  diff.addEventListener('change', explain);
  explain();
  body.append(
    h('p', {}, inGame ? 'Unsaved progress in the current city will be lost.' : 'Set up a new map.'),
    h(
      'div',
      { class: 'form' },
      h('label', { class: 'field' }, 'Map seed ', seed),
      h('label', { class: 'field' }, 'Difficulty ', diff),
      help,
      h('label', { class: 'field' }, 'Starting cash (£) ', cash),
      h('label', { class: 'check' }, weather, ' Weather events (heatwaves, cold snaps, storms)'),
      h('label', { class: 'check' }, fires, ' Random building fires'),
    ),
    h('div', { class: 'row' }, back(body, a, inGame), start),
  );
}

export function renderScenarios(body: HTMLElement, a: MenuActions, inGame: boolean): void {
  clear(body);
  const list = h('div', { class: 'menu-list' });
  for (const s of SCENARIOS) {
    const b = h(
      'button',
      { class: 'menu-item' },
      h('strong', {}, s.name),
      h('span', { class: 'muted' }, s.summary),
    );
    b.addEventListener('click', () => renderBriefing(body, a, s.id, inGame, true));
    list.append(b);
  }
  body.append(
    h(
      'p',
      { class: 'muted' },
      'Each scenario starts on a ready-built city with its own rules and objectives.',
    ),
    list,
    h('div', { class: 'row' }, back(body, a, inGame)),
  );
}

/** A scenario's briefing; with `startButton` it offers to start it, otherwise just to close. */
export function renderBriefing(
  body: HTMLElement,
  a: MenuActions,
  id: string,
  inGame: boolean,
  startButton: boolean,
): void {
  clear(body);
  const def = scenarioDef(id);
  const hours = def.durationHours;
  const length = hours >= 48 ? `${Math.round(hours / 24)} days` : `${hours} hours`;
  const rules: string[] = [
    `Lasts up to ${length}`,
    `Starting cash ${formatMoney(def.startingCash)}`,
  ];
  const c = def.constraints;
  if (c.noLoans) rules.push('No loans');
  if (c.capitalLimit !== undefined)
    rules.push(`Capital spending capped at ${formatMoney(c.capitalLimit)}`);
  if (c.maxBudget !== undefined) rules.push(`Budgets capped at ${Math.round(c.maxBudget * 100)}%`);
  if (c.noNewFacilities?.length)
    rules.push(c.noNewFacilitiesReason ?? 'Some facilities cannot be built');
  body.append(
    h('h3', {}, def.name),
    ...def.briefing.map((p) => h('p', {}, p)),
    h('h4', {}, 'Objectives'),
    h(
      'ul',
      {},
      ...def.objectives.map((o) => h('li', {}, `${o.label} (${o.points ?? 100} points)`)),
    ),
    h('h4', {}, 'Rules'),
    h('ul', {}, ...rules.map((r) => h('li', {}, r))),
  );
  const row = h('div', { class: 'row' });
  if (startButton) {
    row.append(h('button', {}, '← Scenarios'));
    row.lastElementChild!.addEventListener('click', () => renderScenarios(body, a, inGame));
    const go = h('button', { class: 'primary' }, 'Start scenario');
    go.addEventListener('click', () => a.newScenario(id));
    row.append(go);
  } else {
    const ok = h('button', { class: 'primary' }, 'Back to the city');
    ok.addEventListener('click', () => a.close());
    row.append(ok);
  }
  body.append(row);
}

export function renderSettings(body: HTMLElement, a: MenuActions, inGame: boolean): void {
  clear(body);
  const s = a.settings();
  const check = (key: keyof Settings, label: string) => {
    const input = h('input', { type: 'checkbox', ...(s[key] ? { checked: '' } : {}) });
    input.addEventListener('change', () => a.changeSettings({ [key]: input.checked }));
    return h('label', { class: 'check' }, input, ` ${label}`);
  };
  const res = h('select', {});
  for (const [v, label] of [
    [1, 'Standard (fastest)'],
    [1.5, 'High'],
    [2, 'Full (sharpest)'],
  ] as const) {
    res.append(
      h('option', { value: String(v), ...(s.pixelRatio === v ? { selected: '' } : {}) }, label),
    );
  }
  res.addEventListener('change', () => a.changeSettings({ pixelRatio: Number(res.value) }));
  body.append(
    h('h4', {}, 'Graphics'),
    h('label', { class: 'field' }, 'Resolution ', res),
    check('shadows', 'Shadows (slower)'),
    check('cars', 'Show traffic (cosmetic cars)'),
    check('showGrid', 'Tile grid (G)'),
    h('h4', {}, 'Game'),
    check('autosave', 'Autosave at the start of every day'),
    check('pauseInMenus', 'Pause while a menu or dialog is open'),
    check('edgeScroll', 'Scroll the map at the screen edge'),
    h('h4', {}, 'Controls'),
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
    h('div', { class: 'row' }, back(body, a, inGame)),
  );
}

/** End-of-scenario results. */
export function renderResults(
  body: HTMLElement,
  a: MenuActions,
  name: string,
  won: boolean,
  score: { score: number; max: number },
  views: readonly ObjectiveView[],
): void {
  clear(body);
  const again = h('button', {}, 'Main menu');
  again.addEventListener('click', () => renderMainMenu(body, a, true));
  const stay = h('button', { class: 'primary' }, 'Keep playing this city');
  stay.addEventListener('click', () => a.close());
  body.append(
    h(
      'p',
      { class: won ? 'result good' : 'result bad' },
      won ? `${name}: objectives met.` : `${name}: not every objective was met.`,
    ),
    h('p', { class: 'score' }, `Score ${score.score} / ${score.max}`),
    h(
      'table',
      { class: 'kpi-table' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', {}, 'Objective'),
          h('th', {}, 'Result'),
          h('th', {}, 'Target'),
          h('th', {}, 'Points'),
        ),
      ),
      h(
        'tbody',
        {},
        ...views.map((v) =>
          h(
            'tr',
            {},
            h('td', {}, `${v.status === 'met' ? '✔' : '✘'} ${v.label}`),
            h('td', {}, v.value),
            h('td', {}, v.target),
            h('td', {}, `${Math.round(v.share * v.points)} / ${v.points}`),
          ),
        ),
      ),
    ),
    h(
      'p',
      { class: 'muted' },
      `The city carries on as a sandbox if you keep playing. ${GAME_NAME} saves it like any other city.`,
    ),
    h('div', { class: 'row' }, again, stay),
  );
}
