/**
 * Economy and events commands: department budgets, tax rates, loans, and
 * preparing for events at landmarks (extra policing, stewards and park and
 * ride, closing the roads beside the venue, extra street cleaning).
 */
import { ECONOMY } from '../data';
import { measureCost } from '../cityEvents';
import { reconcileCrews, repayLoan, takeLoan, totalDebt } from '../economy';
import { updateRatios } from '../services';
import type { SimState } from '../state';
import { DEPARTMENTS, EVENT_MEASURES, TAX_ZONES } from '../types';
import { rejected } from './common';
import type {
  CommandPlan,
  PrepareEventCommand,
  RepayLoanCommand,
  SetBudgetCommand,
  SetTaxRateCommand,
  TakeLoanCommand,
} from './types';

const ok = (cost = 0, layers: CommandPlan['layers'] = []): CommandPlan => ({
  ok: true,
  cost,
  affected: [],
  blocked: [],
  demolish: [],
  removed: [],
  layers,
});

const levelOk = (levels: number[], v: number) => levels.some((l) => Math.abs(l - v) < 1e-9);

export function planSetBudget(_state: SimState, cmd: SetBudgetCommand): CommandPlan {
  if (!DEPARTMENTS.includes(cmd.department)) return rejected('Unknown department.');
  if (!levelOk(ECONOMY.budgetLevels, cmd.level))
    return rejected('That budget level is not allowed.');
  return ok(0, ['assets']);
}

export function applySetBudget(state: SimState, cmd: SetBudgetCommand): void {
  state.economy.budgets[cmd.department] = cmd.level;
  reconcileCrews(state);
  if (cmd.department === 'services') updateRatios(state);
}

export function planSetTaxRate(_state: SimState, cmd: SetTaxRateCommand): CommandPlan {
  if (!TAX_ZONES.includes(cmd.zone)) return rejected('Unknown zone.');
  if (!levelOk(ECONOMY.taxes.rateLevels, cmd.rate))
    return rejected('That tax rate is not allowed.');
  return ok();
}

export function applySetTaxRate(state: SimState, cmd: SetTaxRateCommand): void {
  state.economy.taxRates[cmd.zone] = cmd.rate;
}

export function planTakeLoan(state: SimState, cmd: TakeLoanCommand): CommandPlan {
  if (!ECONOMY.loans.amounts.includes(cmd.amount)) return rejected('That loan is not on offer.');
  if (totalDebt(state) + cmd.amount > ECONOMY.loans.maxDebt) {
    return rejected(
      `The council can borrow at most £${ECONOMY.loans.maxDebt.toLocaleString('en-GB')} in total.`,
    );
  }
  return ok();
}

export function applyTakeLoan(state: SimState, cmd: TakeLoanCommand): void {
  takeLoan(state, cmd.amount);
}

export function planRepayLoan(state: SimState, cmd: RepayLoanCommand): CommandPlan {
  const loan = state.economy.loans.find((l) => l.id === cmd.loan);
  if (!loan) return rejected('That loan has been repaid.');
  if (Math.ceil(loan.balance) > state.cash) return rejected('Not enough cash to repay it.');
  return ok();
}

export function applyRepayLoan(state: SimState, cmd: RepayLoanCommand): void {
  repayLoan(state, cmd.loan);
}

export function planPrepareEvent(state: SimState, cmd: PrepareEventCommand): CommandPlan {
  const e = state.events.find((x) => x.id === cmd.event);
  if (!e) return rejected('That event is not in the calendar.');
  if (e.status !== 'booked') return rejected('It is too late to change the arrangements.');
  if (!EVENT_MEASURES.includes(cmd.measure)) return rejected('Unknown arrangement.');
  if (e.measures.includes(cmd.measure)) return rejected('That is already arranged.');
  const cost = measureCost(e, cmd.measure);
  if (cost > state.cash)
    return rejected(`Not enough cash: this costs £${cost.toLocaleString('en-GB')}.`);
  return ok(cost);
}

export function applyPrepareEvent(state: SimState, cmd: PrepareEventCommand): void {
  const e = state.events.find((x) => x.id === cmd.event)!;
  e.measures = EVENT_MEASURES.filter((m) => m === cmd.measure || e.measures.includes(m));
}
