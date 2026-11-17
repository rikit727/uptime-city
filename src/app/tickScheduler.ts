/**
 * Converts real elapsed time into sim ticks for the current speed. Pure logic,
 * no timers, so it is easy to test. At 1x the sim runs
 * GAME.ticksPerRealSecondAt1x ticks per second (2 => one game day ≈ 12 real minutes).
 */
import { GAME } from '../sim';

/** Never carry more than this many seconds of backlog (e.g. after the tab was hidden). */
const MAX_BACKLOG_SECONDS = 1;

export class TickScheduler {
  speedIndex = 1;
  private lastRunningIndex = 1;
  private accumulator = 0;

  constructor(private readonly speeds: readonly number[] = GAME.speeds) {}

  get multiplier(): number {
    return this.speeds[this.speedIndex] ?? 0;
  }

  get paused(): boolean {
    return this.multiplier === 0;
  }

  setSpeed(index: number): void {
    this.speedIndex = Math.max(0, Math.min(this.speeds.length - 1, index));
    if (!this.paused) this.lastRunningIndex = this.speedIndex;
    else this.accumulator = 0;
  }

  togglePause(): void {
    this.setSpeed(this.paused ? this.lastRunningIndex : 0);
  }

  faster(): void {
    this.setSpeed(this.speedIndex + 1);
  }

  slower(): void {
    this.setSpeed(this.speedIndex - 1);
  }

  /** Add real elapsed seconds; returns whole ticks now due. */
  advance(seconds: number): number {
    const rate = GAME.ticksPerRealSecondAt1x * this.multiplier;
    if (rate === 0) return 0;
    this.accumulator = Math.min(this.accumulator + seconds * rate, rate * MAX_BACKLOG_SECONDS);
    const due = Math.floor(this.accumulator);
    this.accumulator -= due;
    return due;
  }

  /** Give back ticks that were due but not run (frame budget exceeded). */
  refund(ticks: number): void {
    this.accumulator += ticks;
  }
}
