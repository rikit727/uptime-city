/**
 * Scenarios (milestone 7): a starting city from the generator, rules,
 * constraints, objectives and timed events, all from a JSON file in
 * src/data/scenarios/ (see CLAUDE.md "A scenario").
 *
 * `createScenarioState()` builds the game: a fresh map from the scenario's
 * seed, the city from `cityGen.ts`, the clock set to the scenario's start, the
 * rules, cash and budgets, then a short warm-up so power, water and traffic
 * have settled before the player takes over.
 *
 * The scenario system (last in the tick order) runs timed events when they
 * fall due, samples the figures objectives need every 15 minutes (saved in
 * `state.scenario`, so a save made mid-scenario continues identically), and
 * ends the scenario at its end time, or once its fire is out when it ends on
 * that. Each objective scores up to its `points`: in full when met, in part
 * when missed by a little. All objectives met wins.
 *
 * Constraints (`checkConstraints`, called by planCommand): no loans, a cap on
 * capital spending since the start, a cap on department budget levels.
 */
import type { Command, CommandPlan } from './commands';
import { generateCity } from './cityGen';
import { SCENARIOS, SERVICES, facilityDef, scenarioDef, weatherEvent } from './data';
import { tileClassAt } from './assets';
import type { ScenarioDef, ScenarioObjectiveDef } from './data';
import { backlog } from './economy';
import { fireOf, startFire } from './fire';
import { isOpen, openIncident } from './incidents';
import type { SimEvent } from './events';
import { SYSTEMS } from './systems';
import { createInitialState, initialEconomyState, initialKpis } from './state';
import type { ScenarioState, SimState } from './state';
import { DAYS_PER_SEASON, DAYS_PER_YEAR, MINUTES_PER_DAY, MINUTES_PER_HOUR } from './time';
import { CREW_TYPES, SEASON_ORDER } from './types';
import type { TileAssetLayer } from './types';
import { initWeather } from './weather';
import { rebuildCache } from './cache';

type Emit = (e: SimEvent) => void;

/** Minutes of sim run after generating, before the player starts. */
const WARM_UP_MINUTES = 60;
/** Objectives are sampled every this many minutes. */
const SAMPLE_MINUTES = 15;

export { SCENARIOS };

/** Absolute game minute of a scenario's start (before the warm-up). */
export function scenarioStartMinute(def: ScenarioDef): number {
  const s = def.start;
  const season = Math.max(0, SEASON_ORDER.indexOf(s.season));
  const day = (s.year - 1) * DAYS_PER_YEAR + season * DAYS_PER_SEASON + (s.day - 1);
  return day * MINUTES_PER_DAY + s.hour * MINUTES_PER_HOUR - WARM_UP_MINUTES;
}

/** A fresh game for a scenario. Deterministic for a given definition. */
export function createScenarioState(def: ScenarioDef): SimState {
  const state = createInitialState({
    seed: def.seed,
    startingCash: 100_000_000,
    weatherEvents: def.rules.weatherEvents,
    fires: def.rules.fires,
    difficulty: def.rules.difficulty,
  });
  state.rules.licenceFactor = def.rules.licenceFactor ?? 1;
  state.minute = scenarioStartMinute(def);
  initWeather(state);
  generateCity(state, def.city, def.seed);
  state.cash = def.startingCash;
  state.economy = initialEconomyState();
  for (const [d, v] of Object.entries(def.budgets ?? {})) {
    if (v !== undefined) state.economy.budgets[d as keyof typeof state.economy.budgets] = v;
  }
  state.complaints = [];
  rebuildCache(state);
  // Warm up: the first dispatch, water solve and traffic round (events are dropped).
  const ctx = { state, emit: () => {}, touch: () => {} };
  for (let t = 0; t < WARM_UP_MINUTES; t++) for (const sys of SYSTEMS) sys.tick(ctx);
  state.cash = def.startingCash;
  state.economy.month = initialEconomyState().month;
  state.complaints = [];
  state.kpis = initialKpis(state.cash);
  state.kpis.today.incidents = state.assets.kpi.incidents;
  const k = state.assets.kpi;
  state.scenario = {
    id: def.id,
    startMinute: state.minute,
    endMinute: state.minute + Math.round(def.durationHours * MINUTES_PER_HOUR),
    status: 'running',
    eventsDone: 0,
    spent: 0,
    capitalSpent: 0,
    worksSpent: 0,
    base: {
      repairs: k.repairs,
      repairMinutes: k.repairMinutes,
      customerMinutes: k.customerMinutes,
      cash: state.cash,
    },
    supplySamples: 0,
    supplySum: 0,
    supplyMin: 1,
    licenceBreached: false,
    fireBuilding: -1,
    fireStart: -1,
    fireOut: -1,
    smoke: 0,
    taxLost: 0,
    backlog: countBacklog(state, def),
    backlogStart: 0,
    score: 0,
    endedMinute: -1,
  };
  state.scenario.backlogStart = state.scenario.backlog;
  return state;
}

// ---- objectives -------------------------------------------------------------------------

export type ObjectiveStatus = 'onTrack' | 'atRisk' | 'met' | 'failed';

export interface ObjectiveView {
  id: string;
  label: string;
  /** Current value, formatted for the player (British English). */
  value: string;
  target: string;
  status: ObjectiveStatus;
  /** 0..1 share of the points earned so far (or finally). */
  share: number;
  points: number;
}

const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-GB');
const fmtMoney = (n: number): string => `£${fmtInt(n)}`;
const fmtMins = (m: number): string =>
  m < 60
    ? `${Math.round(m)} min`
    : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} min`;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Assets below the objective's condition, across every crew type that maintains assets. */
function countBacklog(state: SimState, def: ScenarioDef): number {
  const o = def.objectives.find((x) => x.kind === 'backlog');
  if (!o) return 0;
  let n = 0;
  for (const c of CREW_TYPES) if (c !== 'fire') n += backlog(state, c, o.below ?? 45).length;
  return n;
}

/** Mean time to repair since the start, counting open repairs at their age so far. */
function scenarioMttr(state: SimState, sc: ScenarioState): { minutes: number; n: number } {
  const k = state.assets.kpi;
  let minutes = k.repairMinutes - sc.base.repairMinutes;
  let n = k.repairs - sc.base.repairs;
  for (const i of state.incidents) {
    if (!isOpen(i) || i.openedMinute < sc.startMinute) continue;
    if (i.kind === 'overflow' || i.kind === 'fire') continue;
    minutes += state.minute - i.openedMinute;
    n++;
  }
  return { minutes: n > 0 ? minutes / n : 0, n };
}

/** Minutes the scenario's fire burned (so far, if still burning; -1 if none yet). */
export function containmentMinutes(state: SimState, sc: ScenarioState): number {
  if (sc.fireStart < 0) return -1;
  return (sc.fireOut >= 0 ? sc.fireOut : state.minute) - sc.fireStart;
}

function evaluateOne(state: SimState, sc: ScenarioState, o: ScenarioObjectiveDef): ObjectiveView {
  const done = sc.status !== 'running';
  const points = o.points ?? 100;
  const view = (
    value: string,
    target: string,
    share: number,
    met: boolean,
    failedNow = false,
  ): ObjectiveView => ({
    id: o.id,
    label: o.label,
    value,
    target,
    share: clamp01(share),
    points,
    status: failedNow ? 'failed' : done ? (met ? 'met' : 'failed') : met ? 'onTrack' : 'atRisk',
  });
  switch (o.kind) {
    case 'supplyShare': {
      const avg = sc.supplySamples > 0 ? sc.supplySum / sc.supplySamples : 1;
      const t = o.target;
      const met = avg >= t;
      return view(
        `${(avg * 100).toFixed(2)}% (lowest ${(sc.supplyMin * 100).toFixed(1)}%)`,
        `${(t * 100).toFixed(0)}%`,
        met ? 1 : (avg - 0.9) / (t - 0.9),
        met,
      );
    }
    case 'noLicenceBreach': {
      const ok = !sc.licenceBreached;
      return view(ok ? 'Within the licence' : 'Licence breached', 'No breach', ok ? 1 : 0, ok, !ok);
    }
    case 'mttr': {
      const m = scenarioMttr(state, sc);
      const met = m.n === 0 || m.minutes <= o.target;
      return view(
        m.n === 0 ? 'No repairs yet' : `${fmtMins(m.minutes)} over ${m.n}`,
        `Under ${fmtMins(o.target)}`,
        met ? 1 : 1 - (m.minutes - o.target) / o.target,
        met,
      );
    }
    case 'backlog': {
      const met = sc.backlog <= o.target;
      const share = met
        ? 1
        : sc.backlogStart > o.target
          ? (sc.backlogStart - sc.backlog) / (sc.backlogStart - o.target)
          : 0;
      return view(
        `${fmtInt(sc.backlog)} assets (from ${fmtInt(sc.backlogStart)})`,
        `${fmtInt(o.target)} or fewer below ${o.below ?? 45}%`,
        share,
        met,
      );
    }
    case 'budget': {
      const met = sc.spent <= o.target;
      return view(
        fmtMoney(sc.spent),
        `${fmtMoney(o.target)} or less`,
        met ? 1 : 1 - (sc.spent - o.target) / o.target,
        met,
        !met,
      );
    }
    case 'worksBudget': {
      const met = sc.worksSpent <= o.target;
      return view(
        fmtMoney(sc.worksSpent),
        `${fmtMoney(o.target)} or less`,
        met ? 1 : 1 - (sc.worksSpent - o.target) / o.target,
        met,
        !met,
      );
    }
    case 'cashAbove': {
      const met = state.cash >= o.target;
      return view(
        fmtMoney(state.cash),
        `${fmtMoney(o.target)} or more`,
        met ? 1 : state.cash / Math.max(1, o.target),
        met,
      );
    }
    case 'customerMinutes': {
      const cm = state.assets.kpi.customerMinutes - sc.base.customerMinutes;
      const met = cm <= o.target;
      return view(
        fmtInt(cm),
        `${fmtInt(o.target)} or fewer`,
        met ? 1 : 1 - (cm - o.target) / o.target,
        met,
        !met && done,
      );
    }
    case 'fireContained': {
      const m = containmentMinutes(state, sc);
      const burnt = sc.fireBuilding >= 0 && !state.cache.byId.has(sc.fireBuilding);
      if (m < 0) return view('No fire yet', `Out within ${fmtMins(o.target)}`, 1, true);
      const out = sc.fireOut >= 0;
      const met = out && !burnt && m <= o.target;
      const failedNow = burnt || m > o.target;
      return view(
        out ? `Out after ${fmtMins(m)}` : `Burning for ${fmtMins(m)}`,
        `Out within ${fmtMins(o.target)}`,
        out ? (met ? 1 : 1 - (m - o.target) / o.target) : 0,
        met,
        failedNow,
      );
    }
    case 'happiness': {
      const v = state.happiness.city;
      const met = v >= o.target;
      return view(`${Math.round(v)}`, `${o.target} or more`, met ? 1 : v / o.target, met);
    }
    case 'cost': {
      const smoke = sc.smoke * SERVICES.fire.smoke.costPerPersonMinute;
      const c = sc.spent + sc.taxLost + smoke;
      const met = c <= o.target;
      return view(
        `${fmtMoney(c)} (spent ${fmtMoney(sc.spent)}, taxes lost ${fmtMoney(sc.taxLost)}, smoke ${fmtMoney(smoke)})`,
        `${fmtMoney(o.target)} or less`,
        met ? 1 : 1 - (c - o.target) / o.target,
        met,
      );
    }
  }
}

/** Every objective of the running (or finished) scenario, for the UI. */
export function evaluateScenario(state: SimState): ObjectiveView[] {
  const sc = state.scenario;
  if (!sc) return [];
  return scenarioDef(sc.id).objectives.map((o) => evaluateOne(state, sc, o));
}

/** Score so far (final once the scenario has ended) and the maximum. */
export function scenarioScore(state: SimState): { score: number; max: number } {
  const views = evaluateScenario(state);
  const max = views.reduce((s, v) => s + v.points, 0);
  const score = views.reduce((s, v) => s + Math.round(v.share * v.points), 0);
  return { score, max };
}

// ---- timed events ----------------------------------------------------------------------------

function runEvent(state: SimState, def: ScenarioDef, k: number, emit: Emit): void {
  const ev = def.events[k]!;
  const sc = state.scenario!;
  switch (ev.kind) {
    case 'message':
      emit({ type: 'scenarioMessage', text: ev.text ?? '', tone: ev.tone ?? 'info' });
      break;
    case 'weather': {
      if (!ev.event) break;
      const day = Math.floor(state.minute / MINUTES_PER_DAY) + 1;
      const days = ev.days ?? 3;
      state.weather.event = { id: ev.event, startDay: day, endDay: day + days };
      emit({
        type: 'weatherEventStarted',
        event: ev.event,
        name: weatherEvent(ev.event).name,
        days,
      });
      break;
    }
    case 'fire': {
      const code = ev.target ? facilityDef(ev.target).code : -1;
      const b = state.buildings.find((x) => x.code === code);
      if (!b) break;
      const f = startFire(state, b.id, emit);
      if (f) {
        sc.fireBuilding = b.id;
        sc.fireStart = state.minute;
        // A big fire: well alight by the time it is reported.
        f.intensity = Math.max(f.intensity, ev.intensity ?? f.intensity);
        f.peak = f.intensity;
      }
      if (ev.text) emit({ type: 'scenarioMessage', text: ev.text, tone: 'error' });
      break;
    }
    case 'failures': {
      if (ev.target) {
        // A facility trips out (the first of its kind).
        const code = facilityDef(ev.target).code;
        const b = state.buildings.find((x) => x.code === code);
        if (b)
          openIncident(
            state,
            'facilityFault',
            { layer: 'facility', id: b.id },
            b.y * state.world.width + b.x,
            emit,
          );
        if (ev.text) emit({ type: 'scenarioMessage', text: ev.text, tone: ev.tone ?? 'warn' });
        break;
      }
      // The worst assets of a layer fail at once.
      const layer = (ev.layer ?? 'main') as TileAssetLayer;
      const w = state.world;
      const cond = w.condition[layer];
      const tiles: number[] = [];
      for (let t = 0; t < cond.length; t++) if (w.laid[layer][t]! > 0) tiles.push(t);
      tiles.sort((a, b) => cond[a]! - cond[b]! || a - b);
      const pool = tiles.slice(0, Math.max(ev.count ?? 1, (ev.count ?? 1) * 4));
      for (let n = 0; n < (ev.count ?? 1) && pool.length > 0; n++) {
        const t = pool.splice(state.rng.int(0, pool.length - 1), 1)[0]!;
        const cls = tileClassAt(w, layer, t);
        if (cls) openIncident(state, cls.failure, { layer, id: t }, t, emit);
      }
      if (ev.text) emit({ type: 'scenarioMessage', text: ev.text, tone: ev.tone ?? 'warn' });
      break;
    }
  }
}

function sample(state: SimState, def: ScenarioDef): void {
  const sc = state.scenario!;
  const ws = state.cache.waterStats;
  if (ws.customers > 0) {
    const share = 1 - ws.noSupply / ws.customers;
    sc.supplySamples++;
    sc.supplySum += share;
    sc.supplyMin = Math.min(sc.supplyMin, share);
  }
  if (state.water.licenceBreached) sc.licenceBreached = true;
  if (sc.fireBuilding >= 0 && sc.fireOut < 0 && !fireOf(state, sc.fireBuilding)) {
    sc.fireOut = state.minute;
    if (def.endOnFireOut) {
      sc.endMinute = Math.min(
        sc.endMinute,
        state.minute + Math.round((def.afterFireHours ?? 2) * MINUTES_PER_HOUR),
      );
    }
  }
  sc.backlog = countBacklog(state, def);
}

function finish(state: SimState, emit: Emit): void {
  const sc = state.scenario!;
  sample(state, scenarioDef(sc.id));
  sc.status = 'lost';
  const views = evaluateScenario(state);
  sc.status = views.every((v) => v.share >= 1 && v.status !== 'failed') ? 'won' : 'lost';
  sc.endedMinute = state.minute;
  const fresh = evaluateScenario(state);
  sc.score = fresh.reduce((s, v) => s + Math.round(v.share * v.points), 0);
  emit({ type: 'scenarioEnded', won: sc.status === 'won', score: sc.score });
}

/** One tick of the scenario. Returns true if anything the UI shows changed. */
export function tickScenario(state: SimState, emit: Emit): boolean {
  const sc = state.scenario;
  if (!sc || sc.status !== 'running') return false;
  const def = scenarioDef(sc.id);
  let changed = false;
  while (sc.eventsDone < def.events.length) {
    const ev = def.events[sc.eventsDone]!;
    if (state.minute < sc.startMinute + Math.round(ev.afterHours * MINUTES_PER_HOUR)) break;
    runEvent(state, def, sc.eventsDone, emit);
    sc.eventsDone++;
    changed = true;
  }
  // A fire put out is noticed straight away (the scenario may end on it).
  if (sc.fireBuilding >= 0 && sc.fireOut < 0 && !fireOf(state, sc.fireBuilding)) {
    sample(state, def);
    changed = true;
  }
  if ((state.minute - sc.startMinute) % SAMPLE_MINUTES === 0) {
    sample(state, def);
    changed = true;
  }
  if (state.minute >= sc.endMinute) {
    finish(state, emit);
    changed = true;
  }
  return changed;
}

// ---- constraints ---------------------------------------------------------------------------

/** Scenario constraints on a planned command: returns the plan, refused if a rule forbids it. */
export function checkConstraints(state: SimState, cmd: Command, plan: CommandPlan): CommandPlan {
  const sc = state.scenario;
  // Rules come before the command's own checks, so the player hears the real reason.
  if (!sc || sc.status !== 'running') return plan;
  const c = scenarioDef(sc.id).constraints;
  const refuse = (reason: string): CommandPlan => ({ ...plan, ok: false, reason });
  if (c.noLoans && cmd.type === 'takeLoan')
    return refuse('Loans are not allowed in this scenario.');
  if (c.noNewFacilities && cmd.type === 'placeFacility' && c.noNewFacilities.includes(cmd.facility))
    return refuse(c.noNewFacilitiesReason ?? 'That cannot be built in this scenario.');
  if (c.maxBudget !== undefined && cmd.type === 'setBudget' && cmd.level > c.maxBudget + 1e-9)
    return refuse(`Budgets are capped at ${Math.round(c.maxBudget * 100)}% in this scenario.`);
  if (!plan.ok) return plan;
  if (c.capitalLimit !== undefined && plan.cost > 0 && CAPITAL.has(cmd.type)) {
    const left = c.capitalLimit - sc.capitalSpent;
    if (plan.cost > left)
      return refuse(`Over the scenario's capital allowance: ${fmtMoney(Math.max(0, left))} left.`);
  }
  return plan;
}

/** Commands whose cost is capital spending (see LEDGER_LINE in commands/index.ts). */
const CAPITAL: ReadonlySet<Command['type']> = new Set([
  'buildRoad',
  'zone',
  'bulldoze',
  'placeFacility',
  'buildLine',
  'buildMain',
]);
