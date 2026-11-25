import { describe, expect, it } from 'vitest';
import { addBuilding } from '../../src/sim/buildings';
import { BUILDINGS, ECONOMY } from '../../src/sim/data';
import {
  autoMaintenance,
  closeMonth,
  dailyTaxes,
  dailyUpkeep,
  decayFactor,
  isMonthStart,
  ledgerExpenses,
  ledgerIncome,
  loanPayment,
  settleHour,
} from '../../src/sim/economy';
import { computeDemand } from '../../src/sim/growth';
import { landValueOf } from '../../src/sim/pollution';
import { checkOverruns } from '../../src/sim/roadworks';
import { MINUTES_PER_DAY } from '../../src/sim/time';
import { at, poweredTown, testSim } from './helpers';

const code = (id: string) => BUILDINGS.types.find((t) => t.id === id)!.code;
const ok = (r: { ok: boolean; reason?: string }) => {
  if (!r.ok) throw new Error(r.reason);
};

describe('taxes', () => {
  it('council tax per resident, scaled by the rate and land value', () => {
    const sim = testSim();
    poweredTown(sim);
    const s = sim.state;
    const flats = addBuilding(s, code('flats'), 12, 21, 1);
    const lv = landValueOf(s, flats);
    const w = ECONOMY.taxes.landValueWeight.residential;
    const expected = 30 * ECONOMY.taxes.perResident * (1 + w * (lv - 0.5) * 2);
    expect(dailyTaxes(s, flats).councilTax).toBeCloseTo(expected, 6);
    ok(sim.dispatch({ type: 'setTaxRate', zone: 'residential', rate: 1.5 }));
    expect(dailyTaxes(s, flats).councilTax).toBeCloseTo(expected * 1.5, 6);
    expect(sim.dispatch({ type: 'setTaxRate', zone: 'residential', rate: 3 }).ok).toBe(false);
  });

  it('business rates per job by zone; farms pay little but export', () => {
    const sim = testSim();
    const s = sim.state;
    const shop = addBuilding(s, code('highStreetShops'), 12, 21, 1);
    const farm = addBuilding(s, code('arableFarm'), 2, 100, 1);
    const t = dailyTaxes(s, shop);
    expect(t.councilTax).toBe(0);
    expect(t.businessRates).toBeGreaterThan(14 * ECONOMY.taxes.perJob.commercial * 0.5);
    const f = dailyTaxes(s, farm);
    expect(f.farmExports).toBe(600);
    expect(f.businessRates).toBeLessThan(4);
  });

  it('high business rates damp demand', () => {
    const sim = testSim();
    poweredTown(sim);
    for (let x = 5; x < 25; x++) addBuilding(sim.state, code('flats'), x, 21, 1);
    const base = computeDemand(sim.state).industrial;
    expect(base).toBeGreaterThan(0);
    ok(sim.dispatch({ type: 'setTaxRate', zone: 'industrial', rate: 1.5 }));
    expect(computeDemand(sim.state).industrial).toBeLessThan(base);
  });
});

describe('running costs and income', () => {
  it('sells electricity and water at the tariffs and pays for gas, upkeep and wages', () => {
    const sim = testSim();
    poweredTown(sim);
    ok(sim.dispatch({ type: 'placeFacility', facility: 'waterDepot', at: { x: 20, y: 17 } }));
    const s = sim.state;
    const cash = s.cash;
    s.economy.meter = { electricityMWh: 10, gasMWh: 8, waterMl: 2 };
    settleHour(s);
    const m = s.economy.month;
    expect(m.income.electricity).toBe(10 * ECONOMY.tariffs.electricityPerMWh);
    expect(m.income.water).toBe(2 * ECONOMY.tariffs.waterPerMl);
    expect(m.expenses.fuel).toBe(8 * ECONOMY.fuel.gasPerMWh);
    let upkeep = 0;
    for (const b of s.buildings) upkeep += dailyUpkeep(s, b);
    expect(m.expenses.upkeep).toBe(Math.round(upkeep / 24));
    expect(m.expenses.crews).toBe(Math.round((2 * ECONOMY.crewCostPerDay.water) / 24));
    expect(s.cash).toBe(cash + ledgerIncome(m) - (ledgerExpenses(m) - m.expenses.capital));
    expect(s.economy.meter.electricityMWh).toBe(0);
  });

  it('power dispatch and the water solve run the meters', () => {
    const sim = testSim();
    poweredTown(sim);
    for (let x = 5; x < 25; x++) addBuilding(sim.state, code('flats'), x, 21, 1);
    sim.step(20);
    expect(sim.state.economy.meter.electricityMWh).toBeGreaterThan(0);
    expect(sim.state.economy.meter.gasMWh).toBeGreaterThan(0);
    expect(sim.state.economy.meter.waterMl).toBeGreaterThan(0);
  });

  it('books command costs to the accounts', () => {
    const sim = testSim();
    const s = sim.state;
    ok(sim.dispatch({ type: 'placeFacility', facility: 'gasPlant', at: { x: 5, y: 30 } }));
    expect(s.economy.month.expenses.capital).toBe(60000);
  });

  it('upkeep scales with the department budget', () => {
    const sim = testSim();
    poweredTown(sim);
    const s = sim.state;
    const gas = s.buildings.find((b) => b.code === 200)!;
    expect(dailyUpkeep(s, gas)).toBe(ECONOMY.upkeepPerDay.gas);
    ok(sim.dispatch({ type: 'setBudget', department: 'power', level: 0.5 }));
    expect(dailyUpkeep(s, gas)).toBe(ECONOMY.upkeepPerDay.gas! / 2);
    expect(decayFactor(s, 'power')).toBeCloseTo(1.5);
    expect(decayFactor(s, 'roads')).toBe(1);
  });

  it('fines permit overruns', () => {
    const sim = testSim();
    poweredTown(sim, 'residential', 'low', false);
    const s = sim.state;
    // No highways depot: the booked resurfacing never starts and overruns its slot.
    ok(
      sim.dispatch({
        type: 'raiseMaintenance',
        from: { x: 10, y: 20 },
        to: { x: 10, y: 20 },
        below: 101,
        only: 'road',
      }),
    );
    const p = s.permits[0]!;
    s.minute = p.end + 1;
    checkOverruns(s, () => {});
    expect(s.economy.month.expenses.fines).toBe(ECONOMY.fines.permitOverrun);
  });
});

describe('department budgets', () => {
  it('set the crews on duty: more with a bigger budget, fewer (idle ones first) with less', () => {
    const sim = testSim();
    ok(
      sim.dispatch({
        type: 'buildRoad',
        roadClass: 'local',
        from: { x: 5, y: 20 },
        to: { x: 30, y: 20 },
      }),
    );
    ok(sim.dispatch({ type: 'placeFacility', facility: 'roadsDepot', at: { x: 10, y: 18 } }));
    const s = sim.state;
    const count = () => s.crews.filter((c) => c.type === 'roads').length;
    expect(count()).toBe(2);
    ok(sim.dispatch({ type: 'setBudget', department: 'roads', level: 1.5 }));
    expect(count()).toBe(3);
    ok(sim.dispatch({ type: 'setBudget', department: 'roads', level: 0.5 }));
    expect(count()).toBe(1);
    expect(s.crews.map((c) => c.id)).toEqual([...s.crews.map((c) => c.id)].sort((a, b) => a - b));
  });

  it('fund automatic maintenance of the worst assets within the daily allowance', () => {
    const sim = testSim();
    ok(
      sim.dispatch({
        type: 'buildRoad',
        roadClass: 'local',
        from: { x: 5, y: 20 },
        to: { x: 40, y: 20 },
      }),
    );
    ok(sim.dispatch({ type: 'placeFacility', facility: 'roadsDepot', at: { x: 10, y: 18 } }));
    const s = sim.state;
    for (let x = 5; x <= 40; x++) s.world.condition.road[at(sim, x, 20)] = 3000;
    s.world.condition.road[at(sim, 33, 20)] = 1000;
    const raised = autoMaintenance(s);
    expect(raised).toBeGreaterThan(0);
    const roads = s.workOrders.filter((o) => o.crew === 'roads' && o.type === 'maintenance');
    expect(roads.length).toBe(raised);
    // The worst first.
    expect(roads.some((o) => o.asset.id === at(sim, 33, 20))).toBe(true);
    const spent = s.economy.month.expenses.maintenance;
    expect(spent).toBeGreaterThan(0);
    expect(spent).toBeLessThanOrEqual(ECONOMY.departments.roads.maintenancePerDay);
    expect(roads.every((o) => o.night)).toBe(true);
  });
});

describe('loans and monthly accounts', () => {
  it('lends up to the limit, charges interest monthly and repays', () => {
    const sim = testSim(100_000);
    const s = sim.state;
    ok(sim.dispatch({ type: 'takeLoan', amount: 250000 }));
    expect(s.cash).toBe(350_000);
    expect(s.economy.month.borrowed).toBe(250000);
    ok(sim.dispatch({ type: 'takeLoan', amount: 250000 }));
    expect(sim.dispatch({ type: 'takeLoan', amount: 250000 }).ok).toBe(false);
    const loan = s.economy.loans[0]!;
    expect(loan.payment).toBe(loanPayment(250000));
    const cash = s.cash;
    closeMonth(s, () => {});
    const interest = Math.round(250000 * ECONOMY.loans.ratePerMonth);
    expect(s.economy.lastMonth!.expenses.interest).toBe(interest * 2);
    expect(loan.balance).toBeCloseTo(
      250000 - (loan.payment - 250000 * ECONOMY.loans.ratePerMonth),
      0,
    );
    expect(loan.monthsLeft).toBe(ECONOMY.loans.termMonths - 1);
    expect(cash - s.cash).toBeCloseTo(2 * loan.payment, -1);
    expect(s.economy.history).toHaveLength(1);
    ok(sim.dispatch({ type: 'repayLoan', loan: loan.id }));
    expect(s.economy.loans).toHaveLength(1);
  });

  it('closes a month every 30 days with the accounts filed', () => {
    const sim = testSim();
    const s = sim.state;
    expect(isMonthStart(30 * MINUTES_PER_DAY)).toBe(true);
    expect(isMonthStart(29 * MINUTES_PER_DAY)).toBe(false);
    s.minute = 30 * MINUTES_PER_DAY - 1;
    const events: string[] = [];
    sim.step(1);
    for (const e of sim.drainEvents()) events.push(e.type);
    expect(events).toContain('monthClosed');
    expect(s.economy.history[0]!.month).toBe(1);
    expect(s.economy.lastMonth).not.toBeNull();
  });
});
