import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../src/sim/state';
import type { SimState } from '../../src/sim/state';
import { DAYS_PER_SEASON, MINUTES_PER_DAY, seasonOf } from '../../src/sim/time';
import { daylight, seasonalValue, solarElevation, tickWeather } from '../../src/sim/weather';
import type { SimEvent } from '../../src/sim/events';

/** Advance only the clock and the weather (much faster than a full sim). */
function run(state: SimState, minutes: number, events: SimEvent[] = []): void {
  for (let i = 0; i < minutes; i++) {
    state.tick++;
    state.minute++;
    tickWeather(state, (e) => events.push(e));
  }
}

describe('weather', () => {
  it('is deterministic for a seed', () => {
    const a = createInitialState({ seed: 42 });
    const b = createInitialState({ seed: 42 });
    run(a, 5 * MINUTES_PER_DAY);
    run(b, 5 * MINUTES_PER_DAY);
    expect(a.weather).toEqual(b.weather);
    expect(a.rng.state).toBe(b.rng.state);
  });

  it('is warmer in summer than in winter, and warmer by day than at night', () => {
    const s = createInitialState({ seed: 9, weatherEvents: false });
    const sums: Record<string, { t: number; n: number }> = {};
    let noon = 0;
    let night = 0;
    for (let day = 0; day < 4 * DAYS_PER_SEASON; day++) {
      for (let m = 0; m < MINUTES_PER_DAY; m += 1) {
        run(s, 1);
        const season = seasonOf(s.minute);
        sums[season] ??= { t: 0, n: 0 };
        sums[season].t += s.weather.temperatureC;
        sums[season].n++;
        const h = (s.minute % MINUTES_PER_DAY) / 60;
        if (h === 15) noon += s.weather.temperatureC;
        if (h === 3) night += s.weather.temperatureC;
      }
    }
    const mean = (k: string) => sums[k]!.t / sums[k]!.n;
    expect(mean('summer')).toBeGreaterThan(mean('spring'));
    expect(mean('summer') - mean('winter')).toBeGreaterThan(8);
    expect(noon).toBeGreaterThan(night);
  });

  it('interpolates seasonal parameters smoothly through the year', () => {
    const midSpring = 15 * MINUTES_PER_DAY;
    const midSummer = 45 * MINUTES_PER_DAY;
    expect(seasonalValue(midSpring, 'meanC')).toBeCloseTo(10, 5);
    expect(seasonalValue(midSummer, 'meanC')).toBeCloseTo(18, 5);
    const between = seasonalValue(30 * MINUTES_PER_DAY, 'meanC');
    expect(between).toBeGreaterThan(10);
    expect(between).toBeLessThan(18);
  });

  it('has no sun at night and longer days in summer', () => {
    const springNoon = 12 * 60;
    expect(solarElevation(springNoon)).toBeGreaterThan(0.95);
    expect(solarElevation(0)).toBe(0);
    expect(daylight(0)).toBe(0);
    expect(daylight(springNoon)).toBe(1);
    const summer6 = 45 * MINUTES_PER_DAY + 5 * 60;
    const winter6 = 105 * MINUTES_PER_DAY + 5 * 60;
    expect(solarElevation(summer6)).toBeGreaterThan(0);
    expect(solarElevation(winter6)).toBe(0);
  });

  it('starts and ends weather events, and never when events are off', () => {
    const on = createInitialState({ seed: 5 });
    const evOn: SimEvent[] = [];
    run(on, 240 * MINUTES_PER_DAY, evOn);
    const started = evOn.filter((e) => e.type === 'weatherEventStarted');
    expect(started.length).toBeGreaterThan(0);
    expect(evOn.some((e) => e.type === 'weatherEventEnded')).toBe(true);

    const off = createInitialState({ seed: 5, weatherEvents: false });
    const evOff: SimEvent[] = [];
    run(off, 240 * MINUTES_PER_DAY, evOff);
    expect(evOff.some((e) => e.type === 'weatherEventStarted')).toBe(false);
  });

  it('a heatwave raises the temperature and a storm brings strong wind and rain', () => {
    const base = createInitialState({ seed: 11, weatherEvents: false });
    run(base, 40 * MINUTES_PER_DAY); // into summer
    const hot = createInitialState({ seed: 11, weatherEvents: false });
    run(hot, 40 * MINUTES_PER_DAY);
    hot.weather.event = { id: 'heatwave', startDay: 41, endDay: 45 };
    run(base, 60);
    run(hot, 60);
    expect(hot.weather.temperatureC - base.weather.temperatureC).toBeCloseTo(9, 5);

    const storm = createInitialState({ seed: 12, weatherEvents: false });
    run(storm, 100 * MINUTES_PER_DAY - 360); // just before midnight on a winter day
    storm.weather.event = { id: 'storm', startDay: 101, endDay: 104 };
    run(storm, 24 * 60);
    expect(storm.weather.windMs).toBeGreaterThan(19);
    expect(storm.weather.rainMmPerHour).toBeGreaterThan(4);
  });
});
