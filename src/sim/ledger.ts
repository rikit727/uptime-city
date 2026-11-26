/**
 * The council's books: every change to cash outside command costs goes through
 * here so it lands on a line of this month's accounts (economy.ts closes the
 * month). Kept separate from economy.ts so low-level modules (incidents,
 * water, roadworks) can charge fines and repairs without import cycles.
 */
import { ECONOMY, difficultyDef } from './data';
import type { ExpenseLine, IncomeLine, SimState } from './state';
import type { CrewType, Department } from './types';

/** The department that pays for a crew type. */
export const deptOfCrew = (t: CrewType): Department => (t === 'fire' ? 'services' : t);

/** Decay multiplier for assets worked by a crew type (1 at full budget or more). */
export function decayFactor(state: SimState, crew: CrewType): number {
  const level = state.economy.budgets[deptOfCrew(crew)];
  return (
    (1 + ECONOMY.underfundedDecayFactor * Math.max(0, 1 - level)) *
    difficultyDef(state.rules.difficulty).decayScale
  );
}

/** Income lines scaled by the difficulty's `incomeScale`. */
const SCALED_INCOME: ReadonlySet<IncomeLine> = new Set([
  'councilTax',
  'businessRates',
  'farmExports',
]);

/** Pay `amount` pounds (rounded) and book it to an expense line. Negative amounts are refunds. */
export function spend(state: SimState, line: ExpenseLine, amount: number): void {
  const v = Math.round(amount);
  if (v === 0) return;
  state.cash -= v;
  state.economy.month.expenses[line] += v;
  trackScenarioSpend(state, line, v);
}

/** Scenarios count what is spent from their start (scenario.ts objectives and constraints). */
function trackScenarioSpend(state: SimState, line: ExpenseLine, v: number): void {
  const sc = state.scenario;
  if (!sc || sc.status !== 'running') return;
  sc.spent += v;
  if (line === 'capital') sc.capitalSpent += v;
  if (line === 'maintenance' || line === 'repairs') sc.worksSpent += v;
}

/** Receive `amount` pounds (rounded) on an income line. */
export function earn(state: SimState, line: IncomeLine, amount: number): void {
  const scale = SCALED_INCOME.has(line) ? difficultyDef(state.rules.difficulty).incomeScale : 1;
  const v = Math.round(amount * scale);
  if (v === 0) return;
  state.cash += v;
  state.economy.month.income[line] += v;
}

/** Book a cost already taken off cash (command costs) to an expense line. */
export function bookSpend(state: SimState, line: ExpenseLine, amount: number): void {
  state.economy.month.expenses[line] += Math.round(amount);
  trackScenarioSpend(state, line, Math.round(amount));
}
