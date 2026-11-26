/**
 * The budget panel: this month's and last month's accounts by line, the
 * monthly history, department budget levels (crews on duty, service capacity,
 * automatic maintenance), tax rates per zone, loans, and the maintenance
 * backlog per department. Reads the snapshot; acts only through commands.
 */
import {
  WATER,
  DEPARTMENTS,
  ECONOMY,
  EXPENSE_LINES,
  INCOME_LINES,
  TAX_ZONES,
  ledgerExpenses,
  ledgerIncome,
  zoneType,
} from '../sim';
import type { Command, CrewType, ExpenseLine, IncomeLine, Ledger, SimSnapshot } from '../sim';
import { clear, h } from './dom';
import { formatMoney } from './format';

export interface BudgetActions {
  dispatch(cmd: Command): void;
}

export const INCOME_NAMES: Record<IncomeLine, string> = {
  councilTax: 'Council tax',
  businessRates: 'Business rates',
  farmExports: 'Farm exports',
  electricity: 'Electricity sales',
  water: 'Water charges',
  events: 'Event levies',
};

export const EXPENSE_NAMES: Record<ExpenseLine, string> = {
  capital: 'Building works',
  maintenance: 'Planned maintenance',
  repairs: 'Repairs',
  crews: 'Crew wages',
  upkeep: 'Running costs',
  fuel: 'Gas for power',
  services: 'Event and incident response',
  fines: 'Fines',
  interest: 'Loan interest',
};

const pct = (v: number) => `${Math.round(v * 100)}%`;

export class BudgetPanel {
  readonly el = h('aside', { class: 'panel inbox budget hidden', 'aria-label': 'Budget' });
  private key = '';
  /** Backlog counts are a map scan: refreshed at most once a game hour. */
  private backlogHour = -1;
  private backlogText = new Map<CrewType, string>();

  constructor(private readonly actions: BudgetActions) {}

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }

  toggle(force?: boolean): void {
    const on = force ?? !this.open;
    this.el.classList.toggle('hidden', !on);
    this.key = '';
    this.backlogHour = -1;
  }

  update(snap: SimSnapshot): void {
    if (!this.open) return;
    const e = snap.economy;
    const key = `${Math.floor(snap.minute / 60)}:${snap.cash}:${JSON.stringify(e.budgets)}:${JSON.stringify(e.taxRates)}:${e.loans.length}:${snap.water.restriction}`;
    if (key === this.key) return;
    this.key = key;
    this.render(snap);
  }

  private render(snap: SimSnapshot): void {
    const el = this.el;
    clear(el);
    const close = h('button', { class: 'close', title: 'Close (Shift+B)' }, '×');
    close.addEventListener('click', () => this.toggle(false));
    el.append(h('div', { class: 'inbox-head' }, h('h3', {}, 'Council budget'), close));
    const e = snap.economy;
    const month = Math.floor((Math.floor(snap.minute / 1440) + 0) / ECONOMY.daysPerMonth) + 1;
    const net = ledgerIncome(e.month) - ledgerExpenses(e.month);
    const item = (label: string, value: string, cls = '') =>
      h(
        'div',
        { class: 'kpi' },
        h('span', { class: 'muted' }, label),
        h('strong', { class: cls }, value),
      );
    el.append(
      h(
        'div',
        { class: 'kpis' },
        item('Cash', formatMoney(snap.cash), snap.cash < 0 ? 'bad' : ''),
        item(`Month ${month} so far`, formatMoney(net), net < 0 ? 'bad' : 'good'),
        item('Debt', formatMoney(snap.city.totalDebt())),
        item(
          'Last month',
          e.lastMonth ? formatMoney(ledgerIncome(e.lastMonth) - ledgerExpenses(e.lastMonth)) : '–',
        ),
      ),
    );
    el.append(h('h4', {}, 'Accounts'));
    el.append(this.ledgerTable(e.month, e.lastMonth));
    if (e.history.length > 0) {
      el.append(h('h4', {}, 'Past months'));
      const rows = e.history
        .slice(-6)
        .reverse()
        .map((m) =>
          h(
            'tr',
            {},
            h('td', {}, `Month ${m.month}`),
            h('td', { class: 'num' }, formatMoney(m.income)),
            h('td', { class: 'num' }, formatMoney(m.expenses)),
            h(
              'td',
              { class: `num ${m.income - m.expenses < 0 ? 'bad' : 'good'}` },
              formatMoney(m.income - m.expenses),
            ),
          ),
        );
      el.append(
        h(
          'table',
          { class: 'ledger' },
          h(
            'thead',
            {},
            h('tr', {}, h('th', {}, ''), h('th', {}, 'In'), h('th', {}, 'Out'), h('th', {}, 'Net')),
          ),
          h('tbody', {}, ...rows),
        ),
      );
    }

    el.append(h('h4', {}, 'Department budgets'));
    el.append(
      h(
        'p',
        { class: 'muted small-text' },
        'Higher budgets put more crews on duty, give services more capacity and fund more automatic maintenance; below 100% assets wear faster.',
      ),
    );
    for (const d of DEPARTMENTS) {
      el.append(
        this.levelRow(ECONOMY.departments[d].name, ECONOMY.budgetLevels, e.budgets[d], (level) =>
          this.actions.dispatch({ type: 'setBudget', department: d, level }),
        ),
      );
    }
    this.refreshBacklog(snap);
    el.append(h('h4', {}, 'Maintenance backlog (below 50%)'));
    for (const crew of ['roads', 'water', 'power'] as const) {
      el.append(
        h(
          'div',
          { class: 'muted' },
          `${ECONOMY.departments[crew].name}: ${this.backlogText.get(crew) ?? '–'}`,
        ),
      );
    }

    el.append(h('h4', {}, 'Water restrictions'));
    const levels = ['None', 'Hosepipe ban', 'Hosepipe and irrigation ban'];
    const help = [
      'Normal water use.',
      `Homes use ${Math.round(WATER.restrictions.hosepipeBan.residentialSaving * 100)}% less water; residents are less happy.`,
      'As well, farms on the mains stop irrigating: their exports halve.',
    ];
    const cur = snap.water.restriction;
    const row = h('div', { class: 'level-row' });
    levels.forEach((label, lvl) => {
      const b = h(
        'button',
        { class: `small${lvl === cur ? ' active' : ''}`, title: help[lvl]! },
        label,
      );
      b.addEventListener('click', () =>
        this.actions.dispatch({ type: 'setWaterRestriction', level: lvl }),
      );
      row.append(b);
    });
    el.append(row, h('p', { class: 'muted small-text' }, help[cur] ?? ''));

    el.append(h('h4', {}, 'Tax rates'));
    for (const z of TAX_ZONES) {
      el.append(
        this.levelRow(zoneType(z).name, ECONOMY.taxes.rateLevels, e.taxRates[z], (rate) =>
          this.actions.dispatch({ type: 'setTaxRate', zone: z, rate }),
        ),
      );
    }
    el.append(
      h(
        'p',
        { class: 'muted small-text' },
        'High council tax makes residents unhappy; high business rates put off new shops, offices, industry and farms.',
      ),
    );

    el.append(h('h4', {}, 'Loans'));
    for (const loan of e.loans) {
      const pay = h('button', { class: 'small' }, 'Repay now');
      pay.addEventListener('click', () =>
        this.actions.dispatch({ type: 'repayLoan', loan: loan.id }),
      );
      el.append(
        h(
          'div',
          { class: 'row loan' },
          h(
            'span',
            {},
            `${formatMoney(loan.principal)} loan: ${formatMoney(loan.balance)} left, ${formatMoney(loan.payment)} a month for ${loan.monthsLeft} months`,
          ),
          pay,
        ),
      );
    }
    const offers = h('div', { class: 'row' });
    for (const amount of ECONOMY.loans.amounts) {
      const b = h(
        'button',
        {
          class: 'small',
          title: `${formatMoney(snap.city.loanPayment(amount))} a month for ${ECONOMY.loans.termMonths} months (${(ECONOMY.loans.ratePerMonth * 100).toFixed(1)}% a month)`,
        },
        `Borrow ${formatMoney(amount)}`,
      );
      b.addEventListener('click', () => this.actions.dispatch({ type: 'takeLoan', amount }));
      offers.append(b);
    }
    el.append(offers);
  }

  private refreshBacklog(snap: SimSnapshot): void {
    const hour = Math.floor(snap.minute / 60);
    if (hour === this.backlogHour) return;
    this.backlogHour = hour;
    for (const crew of ['roads', 'water', 'power'] as const) {
      const n = snap.city.backlog(crew, 50).length;
      this.backlogText.set(crew, n === 0 ? 'nothing below 50%' : `${n} assets`);
    }
  }

  private ledgerTable(month: Ledger, last: Ledger | null): HTMLElement {
    const row = (name: string, a: number, b: number | null, cls = '') =>
      h(
        'tr',
        { class: cls },
        h('td', {}, name),
        h('td', { class: 'num' }, formatMoney(a)),
        h('td', { class: 'num muted' }, b === null ? '–' : formatMoney(b)),
      );
    const body = h('tbody', {});
    body.append(row('Income', ledgerIncome(month), last ? ledgerIncome(last) : null, 'total'));
    for (const k of INCOME_LINES) {
      if (month.income[k] === 0 && (!last || last.income[k] === 0)) continue;
      body.append(row(INCOME_NAMES[k], month.income[k], last ? last.income[k] : null));
    }
    body.append(
      row('Spending', ledgerExpenses(month), last ? ledgerExpenses(last) : null, 'total'),
    );
    for (const k of EXPENSE_LINES) {
      if (month.expenses[k] === 0 && (!last || last.expenses[k] === 0)) continue;
      body.append(row(EXPENSE_NAMES[k], month.expenses[k], last ? last.expenses[k] : null));
    }
    if (month.borrowed > 0 || month.repaid > 0) {
      body.append(row('Borrowed', month.borrowed, last ? last.borrowed : null));
      body.append(row('Loan repayments', month.repaid, last ? last.repaid : null));
    }
    return h(
      'table',
      { class: 'ledger' },
      h(
        'thead',
        {},
        h('tr', {}, h('th', {}, ''), h('th', {}, 'This month'), h('th', {}, 'Last month')),
      ),
      body,
    );
  }

  private levelRow(
    label: string,
    levels: readonly number[],
    current: number,
    set: (v: number) => void,
  ): HTMLElement {
    const group = h('div', { class: 'levels', role: 'group', 'aria-label': label });
    for (const l of levels) {
      const b = h('button', { class: 'small' }, pct(l));
      b.classList.toggle('active', Math.abs(l - current) < 1e-9);
      b.addEventListener('click', () => set(l));
      group.append(b);
    }
    return h('div', { class: 'level-row' }, h('span', {}, label), group);
  }
}
