/**
 * Game time and the calendar. One sim tick is one game minute. `minute` is the
 * absolute number of minutes since the game epoch (Year 1, spring, day 1, 00:00).
 * A year has four seasons of `game.json: calendar.daysPerSeason` days.
 */
import { GAME } from './data';
import { SEASON_ORDER } from './types';
import type { SeasonId } from './types';

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
export const DAYS_PER_SEASON = GAME.calendar.daysPerSeason;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASON_ORDER.length;

/** 1-based day number since the game began. */
export const dayOf = (minute: number): number => Math.floor(minute / MINUTES_PER_DAY) + 1;

/** Minutes since midnight, 0..1439. */
export const minuteOfDay = (minute: number): number =>
  ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;

export const hourOf = (minute: number): number =>
  Math.floor(minuteOfDay(minute) / MINUTES_PER_HOUR);

/** Fractional hour of the day, 0 ≤ h < 24. */
export const hourFraction = (minute: number): number => minuteOfDay(minute) / MINUTES_PER_HOUR;

/** 0-based day within the year. */
export const dayOfYear = (minute: number): number => (dayOf(minute) - 1) % DAYS_PER_YEAR;

/** Fractional position in the year, 0 ≤ t < DAYS_PER_YEAR (days, including time of day). */
export const yearPosition = (minute: number): number =>
  (((minute / MINUTES_PER_DAY) % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;

/** 1-based year number. */
export const yearOf = (minute: number): number =>
  Math.floor((dayOf(minute) - 1) / DAYS_PER_YEAR) + 1;

export const seasonIndexOf = (minute: number): number =>
  Math.floor(dayOfYear(minute) / DAYS_PER_SEASON);

export const seasonOf = (minute: number): SeasonId => SEASON_ORDER[seasonIndexOf(minute)]!;

/** 1-based day within the season. */
export const dayOfSeason = (minute: number): number => (dayOfYear(minute) % DAYS_PER_SEASON) + 1;

/** "HH:MM" in 24-hour clock. */
export function clockString(minute: number): string {
  const m = minuteOfDay(minute);
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
