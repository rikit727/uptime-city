import { describe, expect, it } from 'vitest';
import { TickScheduler } from '../../src/app/tickScheduler';
import { GAME } from '../../src/sim/data';
import { MINUTES_PER_DAY } from '../../src/sim/time';

describe('TickScheduler', () => {
  it('runs one game day in about 12 real minutes at 1x', () => {
    const s = new TickScheduler();
    s.setSpeed(1);
    let ticks = 0;
    for (let i = 0; i < 12 * 60 * 60; i++) ticks += s.advance(1 / 60);
    expect(ticks).toBeGreaterThanOrEqual(MINUTES_PER_DAY - 1);
    expect(ticks).toBeLessThanOrEqual(MINUTES_PER_DAY + 1);
  });

  it('scales with speed and stops when paused', () => {
    const s = new TickScheduler();
    s.setSpeed(3);
    expect(s.multiplier).toBe(4);
    let ticks = 0;
    for (let i = 0; i < 60; i++) ticks += s.advance(1 / 60);
    expect(Math.abs(ticks - GAME.ticksPerRealSecondAt1x * 4)).toBeLessThanOrEqual(1);
    s.togglePause();
    expect(s.paused).toBe(true);
    expect(s.advance(10)).toBe(0);
    s.togglePause();
    expect(s.speedIndex).toBe(3);
  });

  it('caps the backlog after a long stall', () => {
    const s = new TickScheduler();
    s.setSpeed(1);
    expect(s.advance(600)).toBeLessThanOrEqual(GAME.ticksPerRealSecondAt1x);
  });
});
