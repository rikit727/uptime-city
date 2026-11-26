/**
 * Daily KPI history for the dashboard: each midnight one record of the day
 * just ended (customer-minutes lost, incidents opened, the most buildings off
 * supply at once, MTTR, the worst congestion, cash and cash flow, happiness,
 * fire response). Running peaks are sampled every 5 minutes into
 * `kpis.today`, which is saved so a save made mid-day continues identically.
 */
import { GAME } from './data';
import { mttrMinutes } from './incidents';
import type { DailyKpi, SimState } from './state';
import { MINUTES_PER_DAY, dayOf } from './time';

/** Buildings without water or power right now (from the last solve and dispatch). */
export const buildingsOffSupply = (state: SimState): number =>
  state.cache.waterStats.noSupply + state.cache.power.buildingsOff;

/** Sample the running peaks (every 5 minutes). */
export function sampleKpis(state: SimState): void {
  const t = state.kpis.today;
  t.peakOff = Math.max(t.peakOff, buildingsOffSupply(state));
  t.congestion = Math.max(t.congestion, state.traffic.congestion);
}

/** Close the day that just ended (call at midnight, after the incidents system reset). */
export function closeKpiDay(state: SimState): DailyKpi {
  const k = state.assets.kpi;
  const t = state.kpis.today;
  const fk = state.services.fireKpi;
  const rec: DailyKpi = {
    day: dayOf(state.minute - 1),
    customerMinutes: Math.round(k.customerMinutesYesterday),
    incidents: k.incidents - t.incidents,
    peakOff: t.peakOff,
    mttrMinutes: k.repairs > 0 ? Math.round(mttrMinutes(state)) : -1,
    congestion: Math.round(t.congestion * 100) / 100,
    cash: state.cash,
    cashFlow: state.cash - t.cash,
    happiness: Math.round(state.happiness.city * 10) / 10,
    fireResponse: fk.responses > 0 ? Math.round((fk.responseMinutes / fk.responses) * 10) / 10 : -1,
  };
  const days = state.kpis.days;
  days.push(rec);
  if (days.length > GAME.kpiHistoryDays) days.splice(0, days.length - GAME.kpiHistoryDays);
  state.kpis.today = {
    incidents: k.incidents,
    cash: state.cash,
    peakOff: buildingsOffSupply(state),
    congestion: state.traffic.congestion,
  };
  return rec;
}

/** One tick: midnight closes the day; every 5 minutes samples the peaks. */
export function tickKpis(state: SimState): void {
  if (state.minute % MINUTES_PER_DAY === 0) closeKpiDay(state);
  else if (state.minute % 5 === 4) sampleKpis(state);
}
