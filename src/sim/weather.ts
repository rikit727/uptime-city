/**
 * The weather model. Seasonal means (weather.json) are interpolated smoothly
 * through the year. Each midnight rolls the day (temperature anomaly with
 * persistence, wet or dry, cloud and wind levels, and weather events); each
 * hour rolls showers and new wind/cloud targets; every tick interpolates and
 * computes temperature (with a daily cycle) and solar irradiance.
 * All randomness comes from state.rng.
 */
import { WEATHER, season, weatherEvent } from './data';
import type { SeasonDef, WeatherEventDef } from './data';
import type { Rng } from './rng';
import type { SimEvent } from './events';
import type { SimState, WeatherState } from './state';
import { DAYS_PER_SEASON, dayOf, hourFraction, minuteOfDay, seasonOf, yearPosition } from './time';
import { SEASON_ORDER } from './types';

type NumericSeasonKey = {
  [K in keyof SeasonDef]: SeasonDef[K] extends number ? K : never;
}[keyof SeasonDef];

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Uniform in [-1, 1). */
const spread = (rng: Rng): number => rng.next() * 2 - 1;

/**
 * A seasonal parameter at a point in the year, smoothly interpolated between
 * the middle days of neighbouring seasons (cosine easing).
 */
export function seasonalValue(minute: number, key: NumericSeasonKey): number {
  const n = SEASON_ORDER.length;
  const pos = (yearPosition(minute) - DAYS_PER_SEASON / 2) / DAYS_PER_SEASON;
  const k = Math.floor(pos);
  const t = pos - k;
  const a = season(SEASON_ORDER[((k % n) + n) % n]!)[key];
  const b = season(SEASON_ORDER[(((k + 1) % n) + n) % n]!)[key];
  return lerp(a, b, (1 - Math.cos(Math.PI * t)) / 2);
}

/** Sunrise and sunset (fractional hours) for the time of year. */
export function sunTimes(minute: number): { sunrise: number; sunset: number } {
  const len = seasonalValue(minute, 'dayLengthHours');
  return { sunrise: 12 - len / 2, sunset: 12 + len / 2 };
}

/** Sun height factor 0..1: 0 outside daylight hours, 1 at noon. */
export function solarElevation(minute: number): number {
  const { sunrise, sunset } = sunTimes(minute);
  const h = hourFraction(minute);
  if (h <= sunrise || h >= sunset) return 0;
  return Math.sin((Math.PI * (h - sunrise)) / (sunset - sunrise));
}

/** Ambient daylight 0..1 with about 1¾ hours of twilight, for lighting and street lamps. */
export function daylight(minute: number): number {
  const { sunrise, sunset } = sunTimes(minute);
  const h = hourFraction(minute);
  const fromDark = Math.min(h - sunrise, sunset - h);
  const t = clamp((fromDark + 0.75) / 1.75, 0, 1);
  return t * t * (3 - 2 * t);
}

const activeEvent = (w: WeatherState): WeatherEventDef | undefined =>
  w.event ? weatherEvent(w.event.id) : undefined;

/** Midnight roll: end or start weather events, then roll the day's character. */
function rollDay(state: SimState, emit: (e: SimEvent) => void): void {
  const w = state.weather;
  const rng = state.rng;
  const day = dayOf(state.minute);
  if (w.event && day >= w.event.endDay) {
    emit({ type: 'weatherEventEnded', event: w.event.id, name: weatherEvent(w.event.id).name });
    w.event = null;
  }
  if (!w.event && state.rules.weatherEvents) {
    const current = seasonOf(state.minute);
    for (const ev of WEATHER.events) {
      if (!ev.seasons.includes(current)) continue;
      if (!rng.chance(ev.chancePerDay)) continue;
      const days = rng.int(ev.minDays, ev.maxDays);
      w.event = { id: ev.id, startDay: day, endDay: day + days };
      emit({ type: 'weatherEventStarted', event: ev.id, name: ev.name, days });
      break;
    }
  }
  const ev = activeEvent(w);
  const a = WEATHER.anomaly;
  // Sum of three uniforms is roughly normal; scaled to the configured spread.
  const noise = (rng.next() + rng.next() + rng.next() - 1.5) * 2 * a.dailySpreadC;
  w.anomalyC = clamp(a.persistence * w.anomalyC + noise, -a.maxC, a.maxC);
  const wetChance = clamp(
    seasonalValue(state.minute, 'wetDayChance') * (ev?.wetFactor ?? 1),
    0,
    0.95,
  );
  w.wetDay = rng.chance(wetChance);
  const c = WEATHER.cloud;
  const cloud =
    seasonalValue(state.minute, 'cloudMean') +
    spread(rng) * c.dailySpread +
    (w.wetDay ? c.wetDayBoost : 0);
  w.dayCloud = clamp(cloud * (ev?.cloudFactor ?? 1), 0, 1);
  const wind =
    seasonalValue(state.minute, 'windMeanMs') *
    (1 + spread(rng) * WEATHER.wind.dailySpread) *
    (ev?.windFactor ?? 1);
  w.dayWindMs = clamp(Math.max(wind, ev?.minWindMs ?? 0), 0, WEATHER.wind.maxMs);
}

/** Hourly roll: showers and the wind and cloud targets for the coming hour. */
function rollHour(state: SimState): void {
  const w = state.weather;
  const rng = state.rng;
  const ev = activeEvent(w);
  w.windFrom = w.windMs;
  let windTo = w.dayWindMs * (1 + spread(rng) * WEATHER.wind.hourlyJitter);
  if (ev && ev.minWindMs > 0) windTo = Math.max(windTo, ev.minWindMs * (0.9 + 0.3 * rng.next()));
  w.windTo = clamp(windTo, 0, WEATHER.wind.maxMs);
  w.cloudFrom = w.cloud;
  w.cloudTo = clamp(w.dayCloud + spread(rng) * WEATHER.cloud.hourlyJitter, 0, 1);
  const r = WEATHER.rain;
  let rain = 0;
  if (w.wetDay && rng.chance(r.showerChancePerHour)) {
    rain = Math.min(r.maxMmPerHour, -Math.log(1 - rng.next()) * r.meanMmPerHour);
  }
  if (ev && ev.minRainMmPerHour > 0) {
    rain = Math.max(rain, ev.minRainMmPerHour * (0.8 + 0.4 * rng.next()));
  }
  w.rainMmPerHour = Math.round(rain * 10) / 10;
}

/** Per-tick values: interpolate wind and cloud, then temperature and sunshine. */
function updateNow(state: SimState): void {
  const w = state.weather;
  const m = state.minute;
  const f = (minuteOfDay(m) % 60) / 60;
  w.windMs = lerp(w.windFrom, w.windTo, f);
  w.cloud = lerp(w.cloudFrom, w.cloudTo, f);
  const range = seasonalValue(m, 'diurnalRangeC') * (1 - 0.4 * w.cloud);
  // Coldest around 03:00, warmest around 15:00.
  const diurnal = (range / 2) * Math.cos((2 * Math.PI * (hourFraction(m) - 15)) / 24);
  const offset = activeEvent(w)?.tempOffsetC ?? 0;
  w.temperatureC = seasonalValue(m, 'meanC') + w.anomalyC + offset + diurnal;
  w.sunshine =
    seasonalValue(m, 'solarPeak') *
    solarElevation(m) *
    (1 - WEATHER.cloud.irradianceLoss * w.cloud);
}

/** Roll the first day and hour for a new game. */
export function initWeather(state: SimState): void {
  const ignore = (): void => {};
  rollDay(state, ignore);
  state.weather.windMs = state.weather.dayWindMs;
  state.weather.cloud = state.weather.dayCloud;
  rollHour(state);
  updateNow(state);
}

/** Advance the weather by one tick (call after the clock has advanced). */
export function tickWeather(state: SimState, emit: (e: SimEvent) => void): void {
  const mod = minuteOfDay(state.minute);
  if (mod === 0) rollDay(state, emit);
  if (mod % 60 === 0) rollHour(state);
  updateNow(state);
}
