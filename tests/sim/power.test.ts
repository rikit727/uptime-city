import { describe, expect, it } from 'vitest';
import { addBuilding } from '../../src/sim/buildings';
import { BUILDINGS, facilityDef } from '../../src/sim/data';
import type { SimEvent } from '../../src/sim/events';
import {
  availableMW,
  dispatchPower,
  isEnergised,
  rebuildNetwork,
  temperatureFactor,
} from '../../src/sim/power';
import type { SimState } from '../../src/sim/state';
import { at, testSim } from './helpers';

const codeOf = (id: string) => BUILDINGS.types.find((t) => t.id === id)!.code;

/** Fix the weather so dispatch results are predictable. */
function calm(state: SimState, minute = 12 * 60): void {
  state.minute = minute;
  Object.assign(state.weather, { temperatureC: 18, windMs: 12, sunshine: 0.8, cloud: 0.2 });
}

function dispatch(state: SimState): SimEvent[] {
  const events: SimEvent[] = [];
  dispatchPower(state, (e) => events.push(e));
  return events;
}

describe('power network', () => {
  it('connects plants to substations through lines, and splits when a line is cut', () => {
    const sim = testSim();
    const s = sim.state;
    sim.dispatch({ type: 'placeFacility', facility: 'gasPlant', at: { x: 5, y: 5 } });
    sim.dispatch({
      type: 'buildLine',
      line: 'transmission',
      from: { x: 8, y: 6 },
      to: { x: 30, y: 6 },
    });
    sim.dispatch({ type: 'placeFacility', facility: 'substation', at: { x: 31, y: 6 } });
    expect(s.cache.network.islands).toHaveLength(1);
    expect(isEnergised(s, at(sim, 32, 15))).toBe(true);
    expect(isEnergised(s, at(sim, 32, 40))).toBe(false);

    const house = addBuilding(s, codeOf('house'), 32, 12, 1);
    calm(s);
    dispatch(s);
    expect(house.unpoweredMinutes).toBe(0);

    sim.dispatch({ type: 'bulldoze', from: { x: 20, y: 6 }, to: { x: 20, y: 6 } });
    expect(s.cache.network.islands).toHaveLength(2);
    expect(isEnergised(s, at(sim, 32, 15))).toBe(false);
    dispatch(s);
    expect(house.unpoweredMinutes).toBeGreaterThan(0);
  });

  it('crosses the river on line spans', () => {
    const sim = testSim();
    sim.dispatch({ type: 'placeFacility', facility: 'gasPlant', at: { x: 50, y: 5 } });
    const r = sim.dispatch({
      type: 'buildLine',
      line: 'distribution',
      from: { x: 53, y: 6 },
      to: { x: 70, y: 6 },
    });
    expect(r.ok).toBe(true);
    sim.dispatch({ type: 'placeFacility', facility: 'substation', at: { x: 71, y: 6 } });
    expect(isEnergised(sim.state, at(sim, 75, 10))).toBe(true);
  });

  it('limits a substation to its weakest line', () => {
    const sim = testSim();
    const s = sim.state;
    sim.dispatch({ type: 'placeFacility', facility: 'gasPlant', at: { x: 5, y: 5 } });
    sim.dispatch({
      type: 'buildLine',
      line: 'distribution',
      from: { x: 8, y: 6 },
      to: { x: 20, y: 6 },
    });
    sim.dispatch({ type: 'placeFacility', facility: 'substation', at: { x: 21, y: 6 } });
    const sub = s.buildings.find((b) => b.code === facilityDef('substation').code)!;
    expect(s.cache.network.feedMW.get(sub.id)).toBe(12);
    sim.dispatch({
      type: 'buildLine',
      line: 'transmission',
      from: { x: 8, y: 6 },
      to: { x: 20, y: 6 },
    });
    expect(s.cache.network.feedMW.get(sub.id)).toBe(20);
  });

  it('serves everyone when supply is enough', () => {
    const sim = testSim();
    const s = sim.state;
    sim.dispatch({ type: 'placeFacility', facility: 'gasPlant', at: { x: 5, y: 5 } });
    sim.dispatch({ type: 'placeFacility', facility: 'substation', at: { x: 8, y: 5 } });
    for (let x = 10; x < 20; x++) addBuilding(s, codeOf('house'), x, 10, 1);
    calm(s);
    const events = dispatch(s);
    expect(s.cache.power.buildingsOff).toBe(0);
    expect(s.cache.power.shedMW).toBe(0);
    expect(events).toHaveLength(0);
    expect(s.cache.power.servedMW).toBeCloseTo(s.cache.power.demandMW, 6);
  });
});

describe('outages on a capacity shortfall', () => {
  /** One wind turbine (3.5 MW at rated wind) feeding homes and industry that need more. */
  function shortTown() {
    const sim = testSim();
    const s = sim.state;
    sim.dispatch({ type: 'placeFacility', facility: 'windTurbine', at: { x: 5, y: 5 } });
    sim.dispatch({ type: 'placeFacility', facility: 'substation', at: { x: 6, y: 5 } });
    const homes = [];
    for (let x = 10; x < 18; x++) homes.push(addBuilding(s, codeOf('flats'), x, 8, 1));
    const industry = [];
    for (let x = 10; x < 18; x += 2)
      industry.push(addBuilding(s, codeOf('heavyIndustry'), x, 12, 1));
    calm(s);
    return { sim, s, homes, industry };
  }

  it('sheds load by priority: industry before homes, never exceeding supply', () => {
    const { s, homes, industry } = shortTown();
    const events = dispatch(s);
    const p = s.cache.power;
    expect(p.demandMW).toBeGreaterThan(p.availableMW);
    expect(p.servedMW).toBeLessThanOrEqual(p.availableMW + 1e-9);
    expect(p.shedMW).toBeGreaterThan(0);
    expect(homes.every((b) => b.unpoweredMinutes === 0)).toBe(true);
    expect(industry.some((b) => b.unpoweredMinutes > 0)).toBe(true);
    expect(events.some((e) => e.type === 'powerShortfall')).toBe(true);
  });

  it('rolls the outage round different buildings over time', () => {
    const { s, industry } = shortTown();
    dispatch(s);
    const offFirst = industry.filter((b) => b.unpoweredMinutes > 0).map((b) => b.id);
    s.minute += 60; // next rota period
    dispatch(s);
    const offNext = industry
      .filter((b) => b.unpoweredMinutes > 0 && b.unpoweredMinutes <= 5)
      .map((b) => b.id);
    expect(offFirst.length).toBeGreaterThan(0);
    expect(offNext).not.toEqual(offFirst);
  });

  it('restores supply and reports it when capacity is added', () => {
    const { sim, s } = shortTown();
    dispatch(s);
    sim.dispatch({ type: 'placeFacility', facility: 'gasPlant', at: { x: 2, y: 5 } });
    sim.dispatch({
      type: 'buildLine',
      line: 'transmission',
      from: { x: 5, y: 6 },
      to: { x: 5, y: 6 },
    });
    const events = dispatch(s);
    expect(s.cache.power.shedMW).toBe(0);
    expect(events).toContainEqual({ type: 'powerRestored' });
  });

  it('batteries charge from spare capacity and cover a shortfall', () => {
    const { sim, s, industry } = shortTown();
    sim.dispatch({ type: 'placeFacility', facility: 'battery', at: { x: 3, y: 5 } });
    sim.dispatch({
      type: 'buildLine',
      line: 'distribution',
      from: { x: 5, y: 6 },
      to: { x: 5, y: 6 },
    });
    const battery = s.buildings.find((b) => b.code === facilityDef('battery').code)!;
    // At night with no load beyond the turbine, it charges.
    for (const b of industry) b.occupancy = 0;
    s.minute = 3 * 60;
    for (let k = 0; k < 12; k++) dispatch(s);
    expect(battery.storedMWh).toBeGreaterThan(0);
    // Full load again: the battery discharges and fewer buildings are cut off.
    for (const b of industry) b.occupancy = 1;
    battery.storedMWh = facilityDef('battery').storageMWh!;
    calm(s);
    dispatch(s);
    expect(battery.storedMWh).toBeLessThan(facilityDef('battery').storageMWh!);
    expect(s.cache.power.shedMW).toBe(0);
  });
});

describe('demand and renewables', () => {
  it('raises demand for heating and cooling', () => {
    expect(temperatureFactor(18)).toBe(1);
    expect(temperatureFactor(0)).toBeGreaterThan(1.4);
    expect(temperatureFactor(34)).toBeGreaterThan(1.4);
  });

  it('solar follows sunshine; wind cuts in, rates and cuts out', () => {
    const s = testSim().state;
    const solar = facilityDef('solarFarm');
    const wind = facilityDef('windTurbine');
    s.weather.sunshine = 0;
    expect(availableMW(s, solar)).toBe(0);
    s.weather.sunshine = 0.5;
    expect(availableMW(s, solar)).toBeCloseTo(solar.capacityMW / 2);
    s.weather.windMs = 2;
    expect(availableMW(s, wind)).toBe(0);
    s.weather.windMs = 8;
    expect(availableMW(s, wind)).toBeGreaterThan(0);
    expect(availableMW(s, wind)).toBeLessThan(wind.capacityMW);
    s.weather.windMs = 15;
    expect(availableMW(s, wind)).toBe(wind.capacityMW);
    s.weather.windMs = 27; // storm: turbines shut down
    expect(availableMW(s, wind)).toBe(0);
  });

  it('a building on an unpowered island is cut off', () => {
    const sim = testSim();
    const s = sim.state;
    sim.dispatch({ type: 'placeFacility', facility: 'substation', at: { x: 8, y: 5 } });
    const h = addBuilding(s, codeOf('house'), 10, 10, 1);
    rebuildNetwork(s);
    dispatch(s);
    expect(h.unpoweredMinutes).toBeGreaterThan(0);
  });
});
