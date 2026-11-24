import { describe, expect, it } from 'vitest';
import {
  DAYS_PER_SEASON,
  DAYS_PER_YEAR,
  MINUTES_PER_DAY,
  dayOfSeason,
  seasonOf,
  yearOf,
} from '../../src/sim/time';

const dayStart = (day: number) => (day - 1) * MINUTES_PER_DAY;

describe('calendar', () => {
  it('has four seasons of 30 days', () => {
    expect(DAYS_PER_SEASON).toBe(30);
    expect(DAYS_PER_YEAR).toBe(120);
  });

  it('starts in spring and cycles through the seasons into the next year', () => {
    expect(seasonOf(dayStart(1))).toBe('spring');
    expect(dayOfSeason(dayStart(1))).toBe(1);
    expect(seasonOf(dayStart(30) + 1439)).toBe('spring');
    expect(seasonOf(dayStart(31))).toBe('summer');
    expect(seasonOf(dayStart(61))).toBe('autumn');
    expect(seasonOf(dayStart(91))).toBe('winter');
    expect(dayOfSeason(dayStart(95))).toBe(5);
    expect(yearOf(dayStart(120))).toBe(1);
    expect(yearOf(dayStart(121))).toBe(2);
    expect(seasonOf(dayStart(121))).toBe('spring');
  });
});
