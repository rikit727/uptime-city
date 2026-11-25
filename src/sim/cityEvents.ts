/**
 * The events calendar: match days, concerts, conferences, shopping weekends
 * and graduations at landmarks (services.json `events`; each landmark lists
 * the event types it hosts).
 *
 * Scheduling (at midnight): every venue keeps one booked event of each type it
 * hosts, `everyDays` (± `jitterDays`, rolled with `state.rng`) after the last,
 * looking `scheduleAheadDays` ahead. Attendance is rolled when it is booked.
 *
 * An event is `live` from `arrivalHours` before it starts until
 * `departureHours` after it ends (the crowd window). While live:
 * - traffic: the trip table gets `eventIn` trips from homes to the venue before
 *   the start and `eventOut` trips back afterwards (cars per attendee, fewer with
 *   stewarding and park and ride);
 * - power and water: the venue's load is multiplied while the event is on;
 * - noise at the venue (pollution.ts); roads beside it can be closed (a
 *   preparation), which traffic routes round;
 * - police and waste: judged when it ends. Without enough police (the local
 *   station's service level, or extra policing booked) there is crowd trouble;
 *   without extra cleaning the litter goes into the next waste collection.
 *
 * Preparations (`prepareEvent`) are booked and paid while the event is booked.
 */
import { SERVICES, cityEventDef, serviceDefOf } from './data';
import type { CityEventDef } from './data';
import { centreOf } from './buildings';
import { addComplaint, streetName } from './complaints';
import type { SimEvent } from './events';
import { earn } from './ledger';
import { accessOf, serviceLevelAt } from './services';
import type { Building, CityEvent, SimState } from './state';
import { MINUTES_PER_DAY, MINUTES_PER_HOUR, dayOf } from './time';
import type { EventMeasure } from './types';

type Emit = (e: SimEvent) => void;

const H = MINUTES_PER_HOUR;

/** First and last minute of an event's crowd window. */
export function crowdWindow(e: CityEvent): [number, number] {
  const def = cityEventDef(e.type);
  return [e.start - def.arrivalHours * H, e.end + def.departureHours * H];
}

const venueDef = (state: SimState, e: CityEvent) =>
  serviceDefOf(state.cache.byId.get(e.venue)?.code ?? 0);

/** Is an event under way now (between its start and end)? */
export const isOn = (e: CityEvent, minute: number): boolean =>
  e.status === 'live' && minute >= e.start && minute < e.end;

/** Power and water multipliers for a building now (1 unless it is hosting an event). */
export function eventLoadFactor(state: SimState, b: Building): { power: number; water: number } {
  for (const e of state.events) {
    if (e.venue !== b.id || !isOn(e, state.minute)) continue;
    const lm = serviceDefOf(b.code)?.landmark;
    if (lm) return { power: lm.eventPowerFactor, water: lm.eventWaterFactor };
  }
  return { power: 1, water: 1 };
}

/** Road tiles closed for live events whose roads were closed as a preparation. */
export function eventClosures(state: SimState): number[] {
  const out: number[] = [];
  const w = state.world;
  for (const e of state.events) {
    if (e.status !== 'live' || !e.measures.includes('closeRoads')) continue;
    const b = state.cache.byId.get(e.venue);
    const def = venueDef(state, e);
    if (!b || !def) continue;
    const [fw, fd] = def.footprint;
    for (let yy = Math.max(0, b.y - 1); yy <= Math.min(w.height - 1, b.y + fd); yy++) {
      for (let xx = Math.max(0, b.x - 1); xx <= Math.min(w.width - 1, b.x + fw); xx++) {
        if (xx >= b.x && xx < b.x + fw && yy >= b.y && yy < b.y + fd) continue;
        const t = yy * w.width + xx;
        if (w.road[t] !== 0) out.push(t);
      }
    }
  }
  return out;
}

/** Cars an hour to (in) and from (out) each venue in a given hour of the current day. */
export function eventTrips(
  state: SimState,
  hour: number,
): { venue: number; in: number; out: number }[] {
  const out: { venue: number; in: number; out: number }[] = [];
  const dayStart = Math.floor(state.minute / MINUTES_PER_DAY) * MINUTES_PER_DAY;
  const m0 = dayStart + hour * H;
  for (const e of state.events) {
    if (e.status === 'done') continue;
    const def = cityEventDef(e.type);
    const cars =
      e.attendance *
      def.carsPerAttendee *
      (e.measures.includes('stewarding') ? 1 - SERVICES.eventMeasures.stewarding.carReduction : 1);
    const arriveFrom = e.start - def.arrivalHours * H;
    const inPerHour = m0 >= arriveFrom && m0 < e.start ? cars / def.arrivalHours : 0;
    const outPerHour =
      m0 >= e.end && m0 < e.end + def.departureHours * H ? cars / def.departureHours : 0;
    if (inPerHour > 0 || outPerHour > 0)
      out.push({ venue: e.venue, in: inPerHour, out: outPerHour });
  }
  return out;
}

/** Cost of a preparation for an event. */
export function measureCost(e: CityEvent, m: EventMeasure): number {
  const M = SERVICES.eventMeasures;
  const k = e.attendance / 1000;
  switch (m) {
    case 'policing':
      return Math.round(M.policing.costPer1000 * k);
    case 'stewarding':
      return Math.round(M.stewarding.costPer1000 * k);
    case 'cleanup':
      return Math.round(M.cleanup.costPer1000 * k);
    case 'closeRoads':
      return M.closeRoads.cost;
  }
}

/** Book the next event of a type at a venue if none is booked. */
function scheduleAt(state: SimState, b: Building, def: CityEventDef, capacity: number): void {
  const mine = state.events.filter((e) => e.venue === b.id);
  if (mine.some((e) => e.type === def.id && e.status !== 'done')) return;
  const today = dayOf(state.minute);
  const last = mine.filter((e) => e.type === def.id).pop();
  const base = last ? dayOf(last.start) + def.everyDays : today + 1;
  let day = Math.max(today + 1, base + state.rng.int(-def.jitterDays, def.jitterDays));
  if (day > today + SERVICES.scheduleAheadDays) return;
  const clash = (d: number) => mine.some((e) => e.status !== 'done' && dayOf(e.start) === d);
  while (clash(day)) day++;
  const start = (day - 1) * MINUTES_PER_DAY + def.startHour * H;
  const [a0, a1] = def.attendance;
  state.events.push({
    id: state.services.nextEventId++,
    type: def.id,
    venue: b.id,
    start,
    end: start + def.hours * H,
    attendance: Math.round(capacity * state.rng.range(a0, a1)),
    measures: [],
    status: 'booked',
    congestion: 0,
    trouble: false,
    litter: false,
    revenue: 0,
  });
}

/** Keep every venue's calendar filled (called at midnight and when a venue opens). */
export function scheduleEvents(state: SimState): void {
  for (const b of state.cache.services.landmarks) {
    const def = serviceDefOf(b.code);
    if (!def?.landmark) continue;
    for (const type of def.landmark.events)
      scheduleAt(state, b, cityEventDef(type), def.capacity ?? 0);
  }
  state.events.sort((a, b) => a.id - b.id);
}

/** The event has finished: judge policing, litter and traffic, take the levy. */
function finishEvent(state: SimState, e: CityEvent, emit: Emit): void {
  const def = cityEventDef(e.type);
  const b = state.cache.byId.get(e.venue);
  const vdef = venueDef(state, e);
  e.status = 'done';
  if (!b || !vdef) return;
  const road = accessOf(state, b);
  const police = e.measures.includes('policing') ? 1 : serviceLevelAt(state, 'police', road);
  const risk =
    def.crowdRisk *
    (e.measures.includes('closeRoads') ? SERVICES.eventMeasures.closeRoads.crowdRiskFactor : 1);
  e.trouble = risk * (1 - police) > 0.3;
  e.litter = !e.measures.includes('cleanup');
  e.revenue = Math.round(e.attendance * def.levyPerAttendee);
  earn(state, 'events', e.revenue);
  const c = centreOf(b);
  const tile = Math.round(c.y) * state.world.width + Math.round(c.x);
  const street = streetName(state.world, road >= 0 ? road : tile);
  const venue = vdef.name.toLowerCase();
  if (e.trouble)
    addComplaint(
      state,
      'events',
      `trouble:${e.id}`,
      `Trouble in the crowds after the ${def.name.toLowerCase()} at the ${venue} on ${street}: not enough police.`,
      tile,
    );
  if (e.litter)
    addComplaint(
      state,
      'events',
      `litter:${e.id}`,
      `Litter all over ${street} after the ${def.name.toLowerCase()} at the ${venue}.`,
      tile,
    );
  if (e.congestion >= 1.3)
    addComplaint(
      state,
      'traffic',
      `eventTraffic:${e.id}`,
      `Gridlock round the ${venue} before the ${def.name.toLowerCase()}.`,
      tile,
    );
  emit({
    type: 'cityEventEnded',
    id: e.id,
    name: def.name,
    venue: vdef.name,
    attendance: e.attendance,
    trouble: e.trouble,
    litter: e.litter,
    revenue: e.revenue,
  });
}

/**
 * One minute of the calendar: schedule at midnight, open and close crowd
 * windows. Returns true if road closures changed (the caller rebuilds faults).
 */
export function tickEvents(state: SimState, emit: Emit): boolean {
  if (state.minute % MINUTES_PER_DAY === 0) scheduleEvents(state);
  let closures = false;
  for (const e of state.events) {
    if (e.status === 'done') continue;
    if (!state.cache.byId.has(e.venue)) {
      if (e.status === 'live' && e.measures.includes('closeRoads')) closures = true;
      e.status = 'done';
      continue;
    }
    const [from, to] = crowdWindow(e);
    if (e.status === 'booked' && state.minute >= from) {
      e.status = 'live';
      if (e.measures.includes('closeRoads')) closures = true;
      const def = cityEventDef(e.type);
      emit({
        type: 'cityEventStarting',
        id: e.id,
        name: def.name,
        venue: venueDef(state, e)?.name ?? 'venue',
        attendance: e.attendance,
        prepared: e.measures.length > 0,
      });
    }
    if (e.status === 'live' && state.minute === e.start) e.congestion = state.traffic.congestion;
    if (e.status === 'live' && state.minute >= to) {
      if (e.measures.includes('closeRoads')) closures = true;
      finishEvent(state, e, emit);
    }
  }
  // Keep the last few finished events for the calendar.
  let drop = state.events.filter((e) => e.status === 'done').length - SERVICES.eventsKept;
  if (drop > 0) state.events = state.events.filter((e) => e.status !== 'done' || drop-- <= 0);
  return closures;
}

/** Litter from events that ended in the last day without extra cleaning, tonnes. */
export function eventLitterTonnes(state: SimState): number {
  let t = 0;
  for (const e of state.events) {
    if (e.status === 'done' && e.litter && state.minute - e.end < MINUTES_PER_DAY)
      t += e.attendance * SERVICES.waste.litterTonnesPerAttendee;
  }
  return t;
}
