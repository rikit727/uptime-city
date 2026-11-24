import { describe, expect, it } from 'vitest';
import type { Command } from '../../src/sim';
import { GAME } from '../../src/sim/data';
import { Simulation, replay } from '../../src/sim/simulation';
import { MINUTES_PER_DAY, clockString, dayOf } from '../../src/sim/time';

const script: { atTick: number; cmd: Command }[] = [
  {
    atTick: 0,
    cmd: { type: 'buildRoad', roadClass: 'avenue', from: { x: 5, y: 20 }, to: { x: 40, y: 20 } },
  },
  {
    atTick: 10,
    cmd: {
      type: 'zone',
      zone: 'residential',
      density: 'medium',
      from: { x: 5, y: 21 },
      to: { x: 30, y: 26 },
    },
  },
  {
    atTick: 500,
    cmd: { type: 'buildRoad', roadClass: 'local', from: { x: 10, y: 21 }, to: { x: 10, y: 30 } },
  },
  { atTick: 900, cmd: { type: 'bulldoze', from: { x: 6, y: 22 }, to: { x: 8, y: 24 } } },
  { atTick: 20, cmd: { type: 'placeFacility', facility: 'gasPlant', at: { x: 5, y: 30 } } },
  { atTick: 20, cmd: { type: 'placeFacility', facility: 'substation', at: { x: 30, y: 30 } } },
  {
    atTick: 21,
    cmd: { type: 'buildLine', line: 'distribution', from: { x: 8, y: 31 }, to: { x: 29, y: 31 } },
  },
  { atTick: 25, cmd: { type: 'placeFacility', facility: 'windTurbine', at: { x: 5, y: 34 } } },
];

function runScripted(seed: number, ticks: number): Simulation {
  const sim = Simulation.newGame({ seed });
  for (let t = 0; t <= ticks; t++) {
    for (const s of script) if (s.atTick === t) sim.dispatch(s.cmd);
    if (t < ticks) sim.step();
  }
  return sim;
}

describe('clock', () => {
  it('advances one game minute per tick from the configured start time', () => {
    const sim = Simulation.newGame({ seed: 3 });
    expect(sim.state.minute).toBe(GAME.startMinute);
    sim.step(90);
    expect(sim.state.tick).toBe(90);
    expect(clockString(sim.state.minute)).toBe('07:30');
  });

  it('emits dayStarted at midnight', () => {
    const sim = Simulation.newGame({ seed: 3 });
    sim.step(MINUTES_PER_DAY - GAME.startMinute - 1);
    expect(sim.drainEvents().some((e) => e.type === 'dayStarted')).toBe(false);
    sim.step();
    expect(sim.drainEvents()).toContainEqual({ type: 'dayStarted', day: 2 });
    expect(dayOf(sim.state.minute)).toBe(2);
  });
});

describe('determinism', () => {
  it('same seed and commands give the same state hash', () => {
    const a = runScripted(2024, 1500);
    const b = runScripted(2024, 1500);
    expect(a.hash()).toBe(b.hash());
  });

  it('the scripted city grows and draws power, deterministically', () => {
    const a = runScripted(99, 3000);
    expect(a.state.buildings.length).toBeGreaterThan(6);
    expect(a.state.cache.power.servedMW).toBeGreaterThan(0);
    expect(runScripted(99, 3000).hash()).toBe(a.hash());
  });

  it('a different seed gives a different hash', () => {
    expect(runScripted(2024, 100).hash()).not.toBe(runScripted(2025, 100).hash());
  });

  it('replaying the command log reproduces the game', () => {
    const live = runScripted(7, 1200);
    const replayed = replay({ seed: 7 }, live.commandLog, 1200);
    expect(live.commandLog.length).toBe(script.length);
    expect(replayed.hash()).toBe(live.hash());
  });
});
