import { describe, expect, it } from 'vitest';
import { FAULT } from '../../src/sim/assets';
import { addBuilding } from '../../src/sim/buildings';
import { eventLoadFactor, eventTrips, scheduleEvents } from '../../src/sim/cityEvents';
import { BUILDINGS, CITY, cityEventDef } from '../../src/sim/data';
import { hashState } from '../../src/sim/hash';
import {
  homeFactors,
  hourlyComplaints,
  tickResidentsRound,
  updateHappiness,
} from '../../src/sim/happiness';
import { openIncident } from '../../src/sim/incidents';
import {
  landValueOf,
  landValueOfTile,
  pollutionAt,
  updatePollution,
} from '../../src/sim/pollution';
import { deserializeState, serializeState } from '../../src/sim/serialize';
import { updateRatios } from '../../src/sim/services';
import { Simulation } from '../../src/sim/simulation';
import type { CityEvent, SimState } from '../../src/sim/state';
import { buildCellTable } from '../../src/sim/traffic';
import { hourOf } from '../../src/sim/time';
import { at, poweredTown, testSim } from './helpers';

const code = (id: string) => BUILDINGS.types.find((t) => t.id === id)!.code;
const ok = (r: { ok: boolean; reason?: string }) => {
  if (!r.ok) throw new Error(r.reason);
};

/** A watered town with homes along the avenue and a stadium beside it. */
function stadiumTown(): Simulation {
  const sim = testSim(5_000_000);
  sim.state.rules.fires = false;
  poweredTown(sim);
  for (let x = 5; x < 30; x++) addBuilding(sim.state, code('flats'), x, 21, 1);
  ok(sim.dispatch({ type: 'placeFacility', facility: 'stadium', at: { x: 32, y: 16 } }));
  return sim;
}

/** Step until the first event is live (crowds arriving). */
function untilLive(sim: Simulation): CityEvent {
  for (let k = 0; k < 6 * 1440; k++) {
    const e = sim.state.events.find((x) => x.status === 'live');
    if (e) return e;
    sim.step(1);
  }
  throw new Error('No event went live');
}

describe('events calendar', () => {
  it('books events at a new venue and keeps one of each type booked', () => {
    const sim = stadiumTown();
    const s = sim.state;
    const types = s.events.map((e) => e.type).sort();
    expect(types).toEqual(['concert', 'match']);
    scheduleEvents(s);
    expect(s.events).toHaveLength(2);
    const match = s.events.find((e) => e.type === 'match')!;
    const def = cityEventDef('match');
    expect(match.end - match.start).toBe(def.hours * 60);
    expect(match.attendance).toBeGreaterThanOrEqual(20000 * def.attendance[0] - 1);
    expect(match.attendance).toBeLessThanOrEqual(20000 * def.attendance[1]);
  });

  it('brings crowds by road, loads the venue and is judged when it ends', () => {
    const sim = stadiumTown();
    const s = sim.state;
    const e = untilLive(sim);
    const venue = s.cache.byId.get(e.venue)!;
    // Arriving crowds are in the trip table, bound for the venue's cell.
    const trips = eventTrips(s, hourOf(s.minute));
    expect(trips.some((t) => t.venue === venue.id && t.in > 0)).toBe(true);
    const table = buildCellTable(s, hourOf(s.minute));
    expect(table.attr.eventIn.reduce((a, v) => a + v, 0)).toBeGreaterThan(0);
    expect(table.prod.eventIn.reduce((a, v) => a + v, 0)).toBeGreaterThan(0);
    // The venue draws more power and water while the event is on.
    s.minute = e.start;
    expect(eventLoadFactor(s, venue).power).toBeGreaterThan(1);
    s.minute = e.start - 30;
    const cash = s.economy.month.income.events;
    for (let k = 0; k < 6 * 60 && e.status !== 'done'; k++) sim.step(1);
    expect(e.status).toBe('done');
    // No police station and nothing arranged: trouble and litter.
    expect(e.trouble).toBe(true);
    expect(e.litter).toBe(true);
    expect(s.economy.month.income.events - cash).toBe(e.revenue);
    expect(s.complaints.some((c) => /Trouble in the crowds/.test(c.text))).toBe(true);
    expect(s.complaints.some((c) => /Litter all over/.test(c.text))).toBe(true);
  });

  it('preparations cost money and prevent trouble; closing roads closes the frontage', () => {
    const sim = stadiumTown();
    const s = sim.state;
    const e = s.events.sort((a, b) => a.start - b.start)[0]!;
    const cash = s.cash;
    for (const measure of ['policing', 'cleanup', 'closeRoads', 'stewarding'] as const) {
      ok(sim.dispatch({ type: 'prepareEvent', event: e.id, measure }));
    }
    expect(sim.dispatch({ type: 'prepareEvent', event: e.id, measure: 'policing' }).ok).toBe(false);
    expect(s.cash).toBeLessThan(cash);
    expect(s.economy.month.expenses.services).toBe(cash - s.cash);
    untilLive(sim);
    const frontage = at(sim, 33, 20);
    expect(s.world.road[frontage]).not.toBe(0);
    expect(s.cache.faults.tile[frontage]! & FAULT.ROAD_CLOSED).toBeTruthy();
    for (let k = 0; k < 8 * 60 && e.status !== 'done'; k++) sim.step(1);
    expect(e.status).toBe('done');
    expect(e.trouble).toBe(false);
    expect(e.litter).toBe(false);
    expect(s.cache.faults.tile[frontage]! & FAULT.ROAD_CLOSED).toBeFalsy();
    expect(sim.dispatch({ type: 'prepareEvent', event: e.id, measure: 'policing' }).ok).toBe(false);
  });
});

describe('pollution and land value', () => {
  it('spreads from heavy industry and falls with distance', () => {
    const sim = testSim();
    const s = sim.state;
    addBuilding(s, code('heavyIndustry'), 20, 60, 1);
    updatePollution(s);
    const here = pollutionAt(s, 'air', at(sim, 20, 60));
    const near = pollutionAt(s, 'air', at(sim, 28, 60));
    const far = pollutionAt(s, 'air', at(sim, 50, 60));
    expect(here).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThanOrEqual(0);
    expect(here).toBeGreaterThan(1);
  });

  it('busy roads make noise', () => {
    const sim = testSim();
    ok(
      sim.dispatch({
        type: 'buildRoad',
        roadClass: 'avenue',
        from: { x: 5, y: 60 },
        to: { x: 40, y: 60 },
      }),
    );
    const s = sim.state;
    updatePollution(s);
    const quiet = pollutionAt(s, 'noise', at(sim, 20, 60));
    for (let x = 5; x <= 40; x++) s.world.traffic[at(sim, x, 60)] = 1400;
    updatePollution(s);
    expect(pollutionAt(s, 'noise', at(sim, 20, 60))).toBeGreaterThan(quiet + 1);
  });

  it('pollution lowers land value; landmarks and services raise it', () => {
    const sim = testSim();
    poweredTown(sim);
    const s = sim.state;
    const home = addBuilding(s, code('flats'), 12, 21, 1);
    const base = landValueOf(s, home);
    for (let x = 14; x < 26; x += 2) addBuilding(s, code('heavyIndustry'), x, 22, 1);
    updatePollution(s);
    const dirty = landValueOf(s, home);
    expect(dirty).toBeLessThan(base);
    ok(sim.dispatch({ type: 'placeFacility', facility: 'university', at: { x: 8, y: 14 } }));
    expect(landValueOf(s, home)).toBeGreaterThan(dirty);
    const before = landValueOfTile(s, at(sim, 20, 21));
    ok(sim.dispatch({ type: 'placeFacility', facility: 'school', at: { x: 20, y: 18 } }));
    updateRatios(s);
    expect(landValueOfTile(s, at(sim, 20, 21))).toBeGreaterThan(before);
  });
});

describe('happiness and complaints', () => {
  it('rises with services and falls with outages', () => {
    const sim = testSim();
    poweredTown(sim);
    const s = sim.state;
    const homes = [];
    for (let x = 5; x < 20; x++) homes.push(addBuilding(s, code('flats'), x, 21, 1));
    updateHappiness(s);
    const plain = s.happiness.city;
    expect(plain).toBeGreaterThan(0);
    for (const [facility, x] of [
      ['fireStation', 6],
      ['policeStation', 9],
      ['healthCentre', 12],
      ['school', 15],
    ] as const) {
      ok(sim.dispatch({ type: 'placeFacility', facility, at: { x, y: 18 } }));
    }
    updateRatios(s);
    updateHappiness(s);
    expect(s.happiness.factors.services).toBeGreaterThan(0.5);
    expect(s.happiness.city).toBeGreaterThan(plain);
    homes[0]!.dryMinutes = 120;
    expect(homeFactors(s, homes[0]!).utilities).toBeLessThan(homeFactors(s, homes[1]!).utilities);
  });

  it('collects taxes and happiness in a sliced round that survives a save', () => {
    const sim = testSim();
    poweredTown(sim);
    const s = sim.state;
    for (let x = 5; x < 30; x++) addBuilding(s, code('flats'), x, 21, 1);
    s.minute = s.minute - (s.minute % 60) + 10;
    expect(tickResidentsRound(s, 4)).toBe(false);
    expect(s.happiness.cursor).toBeGreaterThan(0);
    const copy: SimState = deserializeState(serializeState(s));
    expect(hashState(copy)).toBe(hashState(s));
    while (!tickResidentsRound(s, 4));
    while (!tickResidentsRound(copy, 4));
    expect(hashState(copy)).toBe(hashState(s));
    expect(s.happiness.city).toBeGreaterThan(0);
    expect(s.economy.month.income.councilTax).toBeGreaterThan(0);
  });

  it('residents complain about long water outages, naming the street', () => {
    const sim = testSim();
    poweredTown(sim);
    const s = sim.state;
    const inc = openIncident(s, 'burst', { layer: 'main', id: at(sim, 20, 20) }, at(sim, 20, 20));
    inc.customers = 12;
    (inc as { openedMinute: number }).openedMinute = s.minute - 3 * 60 - 5;
    hourlyComplaints(s);
    const c = s.complaints.find((x) => x.kind === 'water');
    expect(c?.text).toMatch(/^No water on [A-Z][a-z]+ (Avenue|Parade|Boulevard) for 3 hours\.$/);
    // Not repeated within the same step...
    hourlyComplaints(s);
    expect(s.complaints.filter((x) => x.kind === 'water')).toHaveLength(1);
    // ...but again when it reaches 6 hours.
    (inc as { openedMinute: number }).openedMinute -= 3 * 60;
    hourlyComplaints(s);
    expect(s.complaints.filter((x) => x.kind === 'water')).toHaveLength(2);
    expect(s.complaints.length).toBeLessThanOrEqual(CITY.complaints.kept);
  });

  it('complaints cost happiness', () => {
    const sim = testSim();
    poweredTown(sim);
    const s = sim.state;
    for (let x = 5; x < 20; x++) addBuilding(s, code('flats'), x, 21, 1);
    updateHappiness(s);
    const calm = s.happiness.city;
    for (let k = 0; k < 4; k++) {
      s.complaints.push({
        id: 100 + k,
        minute: s.minute,
        kind: 'x',
        text: 'x',
        tile: 0,
        key: `x${k}`,
      });
    }
    updateHappiness(s);
    expect(s.happiness.city).toBeCloseTo(calm - 4 * CITY.happiness.complaintPenalty, 1);
  });
});

describe('a whole city (determinism)', () => {
  const build = () => {
    const sim = testSim(5_000_000);
    poweredTown(sim, 'residential', 'medium');
    for (const [facility, x, y] of [
      ['fireStation', 6, 18],
      ['policeStation', 9, 18],
      ['school', 12, 18],
      ['wasteDepot', 15, 18],
      ['landfill', 20, 15],
      ['stadium', 30, 16],
    ] as const) {
      ok(sim.dispatch({ type: 'placeFacility', facility, at: { x, y } }));
    }
    return sim;
  };

  it('same commands, same city; a save made mid-day continues identically', () => {
    const a = build();
    const b = build();
    a.step(1500);
    b.step(1500);
    expect(a.hash()).toBe(b.hash());
    const loaded = new Simulation(deserializeState(serializeState(a.state)));
    expect(loaded.hash()).toBe(a.hash());
    a.step(1700);
    loaded.step(1700);
    expect(loaded.hash()).toBe(a.hash());
    expect(a.state.events.some((e) => e.status === 'done')).toBe(true);
    expect(a.state.economy.month.income.councilTax).toBeGreaterThan(0);
  });
});
