/**
 * Game time. One sim tick is one game minute. `minute` is the absolute number
 * of minutes since the game epoch (day 1, 00:00).
 */
export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/** 1-based day number. */
export const dayOf = (minute: number): number => Math.floor(minute / MINUTES_PER_DAY) + 1;

/** Minutes since midnight, 0..1439. */
export const minuteOfDay = (minute: number): number =>
  ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;

export const hourOf = (minute: number): number =>
  Math.floor(minuteOfDay(minute) / MINUTES_PER_HOUR);

/** "HH:MM" in 24-hour clock. */
export function clockString(minute: number): string {
  const m = minuteOfDay(minute);
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
