/**
 * The council's economy (economy.json).
 *
 * Taxes (`dailyTaxes`, collected hour by hour in the residents round,
 * happiness.ts): council tax per resident, business rates per job by zone,
 * both scaled by land value and the zone's tax rate; farms pay low rates plus
 * their export income; landmarks pay flat rates.
 *
 * Hourly settlement (at minute 51 past): electricity and water sold since the
 * last hour at the tariffs,
 * gas burnt, facility upkeep and crew wages. Department budget levels (50% to
 * 150%) scale upkeep, set the crews on duty at each depot and fire station
 * (depot crews × level, at least one), the services' capacity, the daily
 * automatic maintenance allowance and how fast assets decay (an underfunded
 * department's assets wear faster).
 *
 * Automatic maintenance (daily at `autoMaintenance.hour`): each utility
 * department raises planned maintenance (night works on roads) on its worst
 * assets below `belowCondition`, while its allowance lasts. The rest of the
 * backlog is the player's to book or leave.
 *
 * Months are 30 days. At the end of a month loan interest and repayments are
 * taken, the month's accounts are filed in `history` and a new month starts.
 */
import { conditionOf, classOf } from './assets';
import { residentsOf } from './buildings';
import { executeCommand, planCommand } from './commands';
import { ECONOMY, buildingDef, serviceDefOf } from './data';
import type { SimEvent } from './events';
import { decayFactor, deptOfCrew, earn, spend } from './ledger';

export { decayFactor, deptOfCrew };
import { orderOnAsset, incidentOnAsset } from './incidents';
import { landValueOf } from './pollution';
import { createCrew } from './crews';
import { crewSpecOf, upkeepOf } from './services';
import type { AssetRef, Building, Ledger, Loan, SimState } from './state';
import { emptyLedger } from './state';
import { MINUTES_PER_DAY, MINUTES_PER_HOUR, dayOf } from './time';
import { TILE_ASSET_LAYERS } from './types';
import type { CrewType, Department, ZoneId } from './types';
import { assetCodeLayer } from './world';

type Emit = (e: SimEvent) => void;

export const SETTLE_MINUTE = 51;

/** The department that runs a building (undefined for grown buildings). */
export function deptOf(b: Building): Department | undefined {
  const def = buildingDef(b.code);
  if (def?.role !== 'facility') return undefined;
  if (def.utility === 'power' || def.utility === 'water') return def.utility;
  if (def.utility === 'depot') return deptOfCrew(def.crewType);
  return 'services';
}

/** Crews on duty at a depot or fire station for the current budget. */
export function dutyCrews(state: SimState, b: Building): number {
  const spec = crewSpecOf(b);
  if (!spec) return 0;
  return Math.max(1, Math.round(spec.crews * state.economy.budgets[deptOfCrew(spec.type)]));
}

/** Add or stand down crews so each depot has its budgeted number (busy crews finish first). */
export function reconcileCrews(state: SimState): boolean {
  let changed = false;
  for (const b of state.buildings) {
    const spec = crewSpecOf(b);
    if (!spec) continue;
    const want = dutyCrews(state, b);
    const mine = state.crews.filter((c) => c.depot === b.id);
    for (let k = mine.length; k < want; k++) {
      createCrew(state, b, spec.type);
      changed = true;
    }
    let extra = mine.length - want;
    if (extra <= 0) continue;
    const idle = mine.filter((c) => c.status === 'idle').sort((a, z) => z.id - a.id);
    const gone = new Set<number>();
    for (const c of idle) {
      if (extra-- <= 0) break;
      gone.add(c.id);
    }
    if (gone.size > 0) {
      state.crews = state.crews.filter((c) => !gone.has(c.id));
      changed = true;
    }
  }
  return changed;
}

const lvFactor = (zone: ZoneId, lv: number): number =>
  1 + (ECONOMY.taxes.landValueWeight[zone] ?? 0) * (lv - 0.5) * 2;

/** Taxes a building pays per day: council tax, business rates and farm exports. */
export function dailyTaxes(
  state: SimState,
  b: Building,
): { councilTax: number; businessRates: number; farmExports: number } {
  const out = { councilTax: 0, businessRates: 0, farmExports: 0 };
  const def = buildingDef(b.code);
  if (!def) return out;
  const T = ECONOMY.taxes;
  const rates = state.economy.taxRates;
  if (def.role === 'grown') {
    const lv = landValueOf(state, b);
    const res = residentsOf(b);
    if (res > 0)
      out.councilTax = res * T.perResident * rates.residential * lvFactor('residential', lv);
    if (def.zone !== 'residential') {
      const perJob = T.perJob[def.zone as keyof typeof T.perJob] ?? 0;
      out.businessRates =
        def.jobs * b.occupancy * perJob * rates[def.zone] * lvFactor(def.zone, lv);
    }
    if (def.exportPerDay) out.farmExports = def.exportPerDay * b.occupancy;
  } else {
    const lm = serviceDefOf(b.code)?.landmark;
    if (lm) out.businessRates = lm.ratesPerDay * rates.commercial;
  }
  return out;
}

/** Running cost per day of a facility at its department's budget level. */
export function dailyUpkeep(state: SimState, b: Building): number {
  const def = buildingDef(b.code);
  const dept = deptOf(b);
  if (def?.role !== 'facility' || !dept) return 0;
  return upkeepOf(def) * state.economy.budgets[dept];
}

/**
 * The hourly settlement: tariffs, fuel, upkeep and wages. (Taxes are collected
 * building by building in the residents round, happiness.ts.)
 */
export function settleHour(state: SimState): void {
  let upkeep = 0;
  for (const b of state.buildings) upkeep += dailyUpkeep(state, b);
  const m = state.economy.meter;
  earn(state, 'electricity', m.electricityMWh * ECONOMY.tariffs.electricityPerMWh);
  earn(state, 'water', m.waterMl * ECONOMY.tariffs.waterPerMl);
  spend(state, 'fuel', m.gasMWh * ECONOMY.fuel.gasPerMWh);
  m.electricityMWh = 0;
  m.waterMl = 0;
  m.gasMWh = 0;
  spend(state, 'upkeep', upkeep / 24);
  let wages = 0;
  for (const c of state.crews) wages += ECONOMY.crewCostPerDay[c.type] ?? 0;
  spend(state, 'crews', wages / 24);
}

/** Assets of a crew type in need of maintenance, worst first (then tile / id order). */
export function backlog(state: SimState, crew: CrewType, below: number): AssetRef[] {
  const w = state.world;
  const found: { ref: AssetRef; c: number; k: number }[] = [];
  const free = (ref: AssetRef) => !orderOnAsset(state, ref) && !incidentOnAsset(state, ref);
  let k = 0;
  for (const layer of TILE_ASSET_LAYERS) {
    const codes = assetCodeLayer(w, layer);
    const cond = w.condition[layer];
    for (let t = 0; t < codes.length; t++) {
      if (codes[t] === 0 || cond[t]! >= below * 100) continue;
      const ref: AssetRef = { layer, id: t };
      if (classOf(state, ref)?.crew !== crew || !free(ref)) continue;
      found.push({ ref, c: cond[t]! / 100, k: k++ });
    }
  }
  for (const b of state.buildings) {
    if (b.condition >= below) continue;
    const ref: AssetRef = { layer: 'facility', id: b.id };
    if (classOf(state, ref)?.crew !== crew || !free(ref)) continue;
    found.push({ ref, c: b.condition, k: k++ });
  }
  found.sort((a, b) => a.c - b.c || a.k - b.k);
  return found.map((f) => f.ref);
}

/** Daily automatic maintenance within each utility department's allowance. */
export function autoMaintenance(state: SimState): number {
  const w = state.world;
  let raised = 0;
  for (const crew of ['roads', 'water', 'power'] as const) {
    const dept = deptOfCrew(crew);
    let allowance = ECONOMY.departments[dept].maintenancePerDay * state.economy.budgets[dept];
    if (allowance <= 0) continue;
    for (const ref of backlog(state, crew, ECONOMY.autoMaintenance.belowCondition).slice(0, 40)) {
      if (conditionOf(state, ref) >= ECONOMY.autoMaintenance.belowCondition) continue;
      const tile = ref.layer === 'facility' ? state.cache.byId.get(ref.id)! : undefined;
      const t = tile ? tile.y * w.width + tile.x : ref.id;
      const at = { x: t % w.width, y: Math.floor(t / w.width) };
      const cmd = {
        type: 'raiseMaintenance' as const,
        from: at,
        to: at,
        below: ECONOMY.autoMaintenance.belowCondition,
        crew,
        only: ref.layer,
        night: true,
      };
      const preview = planCommand(state, cmd);
      if (!preview.ok || preview.cost > allowance) continue;
      const plan = executeCommand(state, cmd);
      if (!plan.ok) continue;
      allowance -= plan.cost;
      raised++;
    }
  }
  return raised;
}

/** Monthly payment of a loan (annuity). */
export function loanPayment(principal: number): number {
  const { ratePerMonth: r, termMonths: n } = ECONOMY.loans;
  return Math.ceil(r > 0 ? (principal * r) / (1 - (1 + r) ** -n) : principal / n);
}

export const totalDebt = (state: SimState): number =>
  state.economy.loans.reduce((s, l) => s + l.balance, 0);

/** Take out a loan (the command checks the limit). */
export function takeLoan(state: SimState, amount: number): Loan {
  const e = state.economy;
  const loan: Loan = {
    id: e.nextLoanId++,
    principal: amount,
    balance: amount,
    payment: loanPayment(amount),
    monthsLeft: ECONOMY.loans.termMonths,
  };
  e.loans.push(loan);
  state.cash += amount;
  e.month.borrowed += amount;
  return loan;
}

/** Pay off a loan's balance early. */
export function repayLoan(state: SimState, id: number): void {
  const e = state.economy;
  const loan = e.loans.find((l) => l.id === id);
  if (!loan) return;
  const v = Math.ceil(loan.balance);
  state.cash -= v;
  e.month.repaid += v;
  e.loans = e.loans.filter((l) => l.id !== id);
}

const total = (r: Record<string, number>): number => Object.values(r).reduce((s, v) => s + v, 0);
export const ledgerIncome = (l: Ledger): number => total(l.income);
export const ledgerExpenses = (l: Ledger): number => total(l.expenses);

/** End of a 30-day month: loans, then file the accounts. */
export function closeMonth(state: SimState, emit: Emit): void {
  const e = state.economy;
  for (const loan of e.loans) {
    const interest = loan.balance * ECONOMY.loans.ratePerMonth;
    spend(state, 'interest', interest);
    const principal = Math.min(loan.balance, Math.max(0, loan.payment - interest));
    loan.balance = Math.max(0, Math.round((loan.balance - principal) * 100) / 100);
    loan.monthsLeft--;
    state.cash -= Math.round(principal);
    e.month.repaid += Math.round(principal);
    if (loan.monthsLeft <= 0 && loan.balance > 0) {
      state.cash -= Math.ceil(loan.balance);
      e.month.repaid += Math.ceil(loan.balance);
      loan.balance = 0;
    }
  }
  e.loans = e.loans.filter((l) => l.balance > 0);
  const month = Math.floor((dayOf(state.minute) - 1) / ECONOMY.daysPerMonth);
  const income = ledgerIncome(e.month);
  const expenses = ledgerExpenses(e.month);
  e.history.push({ month, income, expenses, cash: state.cash });
  if (e.history.length > ECONOMY.historyMonths) e.history.shift();
  e.lastMonth = e.month;
  e.month = emptyLedger();
  emit({ type: 'monthClosed', month, income, expenses, cash: state.cash });
}

/** Is this minute the start of a new month (midnight after day 30, 60, ...)? */
export const isMonthStart = (minute: number): boolean =>
  minute % MINUTES_PER_DAY === 0 && (dayOf(minute) - 1) % ECONOMY.daysPerMonth === 0;

/** One minute of the economy. Returns true if crews changed. */
export function tickEconomy(state: SimState, emit: Emit): boolean {
  let crews = false;
  if (state.minute > 0 && isMonthStart(state.minute)) closeMonth(state, emit);
  if (state.minute % MINUTES_PER_HOUR === SETTLE_MINUTE) {
    settleHour(state);
    crews = reconcileCrews(state);
  }
  if (state.minute % MINUTES_PER_DAY === ECONOMY.autoMaintenance.hour * MINUTES_PER_HOUR + 30) {
    autoMaintenance(state);
  }
  return crews;
}
