import { describe, expect, it } from 'vitest';
import {
  CURRENT_SAVE_VERSION,
  SAVE_FORMAT,
  createSaveFile,
  migrateSave,
  parseSaveFile,
  simulationFromSave,
} from '../../src/platform/saveFormat';
import { rleDecode, rleEncode } from '../../src/sim/serialize';
import { Simulation } from '../../src/sim/simulation';

function playedSim(): Simulation {
  const sim = Simulation.newGame({ seed: 555 });
  sim.dispatch({
    type: 'buildRoad',
    roadClass: 'highway',
    from: { x: 0, y: 64 },
    to: { x: 127, y: 64 },
  });
  sim.dispatch({
    type: 'zone',
    zone: 'industrial',
    density: 'high',
    from: { x: 2, y: 65 },
    to: { x: 20, y: 75 },
  });
  sim.dispatch({
    type: 'zone',
    zone: 'agricultural',
    density: 'low',
    from: { x: 0, y: 0 },
    to: { x: 10, y: 10 },
  });
  sim.dispatch({
    type: 'zone',
    zone: 'residential',
    density: 'medium',
    from: { x: 2, y: 58 },
    to: { x: 20, y: 63 },
  });
  sim.dispatch({ type: 'placeFacility', facility: 'gasPlant', at: { x: 22, y: 66 } });
  sim.dispatch({ type: 'placeFacility', facility: 'substation', at: { x: 10, y: 66 } });
  sim.dispatch({
    type: 'buildLine',
    line: 'distribution',
    from: { x: 12, y: 67 },
    to: { x: 21, y: 67 },
  });
  sim.dispatch({ type: 'placeFacility', facility: 'battery', at: { x: 22, y: 70 } });
  sim.step(2003);
  return sim;
}

describe('RLE', () => {
  it('round-trips', () => {
    const data = new Uint8Array([0, 0, 0, 1, 1, 2, 0, 0, 255]);
    expect(Array.from(rleDecode(rleEncode(data), data.length))).toEqual(Array.from(data));
  });

  it('rejects corrupt data', () => {
    expect(() => rleDecode([1, 5], 4)).toThrow();
    expect(() => rleDecode([1, 2], 4)).toThrow();
    expect(() => rleDecode([1], 1)).toThrow();
    expect(() => rleDecode([300, 1], 1)).toThrow();
  });
});

describe('save format', () => {
  it('round-trips through JSON with an identical state hash', () => {
    const sim = playedSim();
    const json = JSON.stringify(createSaveFile(sim, 'test'));
    const loaded = simulationFromSave(parseSaveFile(json));
    expect(loaded.hash()).toBe(sim.hash());
  });

  it('saves buildings, estates and weather', () => {
    const sim = playedSim();
    expect(sim.state.buildings.length).toBeGreaterThan(5);
    expect(sim.state.estates.length).toBeGreaterThan(0);
    const loaded = simulationFromSave(parseSaveFile(JSON.stringify(createSaveFile(sim, 't'))));
    expect(loaded.state.buildings).toEqual(sim.state.buildings);
    expect(loaded.state.estates).toEqual(sim.state.estates);
    expect(loaded.state.weather).toEqual(sim.state.weather);
    expect(Array.from(loaded.state.cache.buildingAt)).toEqual(
      Array.from(sim.state.cache.buildingAt),
    );
    expect(Array.from(loaded.state.cache.network.coverage)).toEqual(
      Array.from(sim.state.cache.network.coverage),
    );
  });

  it('a loaded game continues exactly like the original', () => {
    const sim = playedSim();
    const loaded = simulationFromSave(parseSaveFile(JSON.stringify(createSaveFile(sim, 't'))));
    const cmd = {
      type: 'buildRoad',
      roadClass: 'local',
      from: { x: 30, y: 30 },
      to: { x: 40, y: 35 },
    } as const;
    sim.dispatch(cmd);
    loaded.dispatch(cmd);
    sim.step(3000);
    loaded.step(3000);
    expect(loaded.hash()).toBe(sim.hash());
    expect(loaded.state.rng.state).toBe(sim.state.rng.state);
  });

  it('carries format, version and metadata', () => {
    const save = createSaveFile(playedSim(), 'My city', new Date('2026-01-02T03:04:05Z'));
    expect(save.format).toBe(SAVE_FORMAT);
    expect(save.version).toBe(CURRENT_SAVE_VERSION);
    expect(save.meta.label).toBe('My city');
    expect(save.meta.savedAt).toBe('2026-01-02T03:04:05.000Z');
    expect(save.meta.day).toBe(2);
  });

  it('keeps saves small', () => {
    expect(JSON.stringify(createSaveFile(playedSim(), 't')).length).toBeLessThan(20_000);
  });

  it('rejects bad input with readable messages', () => {
    expect(() => parseSaveFile('not json')).toThrow(/not valid JSON/);
    expect(() => parseSaveFile({ format: 'other' })).toThrow(/not a .* save/);
    expect(() => parseSaveFile({ format: SAVE_FORMAT, version: 99 })).toThrow(/newer version/);
    const save = createSaveFile(playedSim(), 't');
    save.state.world.road = [0, 5];
    expect(() => parseSaveFile(JSON.parse(JSON.stringify(save)))).toThrow(/Corrupt/);
  });
});

describe('migrations', () => {
  it('upgrades a version 1 save (milestone 1) to the current version', () => {
    const v1 = {
      format: SAVE_FORMAT,
      version: 1,
      meta: {
        gameName: 'x',
        label: 'old',
        savedAt: '2026-01-01T00:00:00.000Z',
        day: 1,
        minute: 400,
        cash: 5,
        seed: 3,
      },
      state: {
        seed: 3,
        tick: 40,
        minute: 400,
        rngState: 1234,
        cash: 5,
        world: {
          width: 128,
          height: 128,
          terrain: [0, 16384],
          road: [0, 100, 1, 5, 0, 16279],
          zone: [0, 16384],
          density: [0, 16384],
        },
      },
    };
    const save = parseSaveFile(JSON.stringify(v1));
    expect(save.version).toBe(CURRENT_SAVE_VERSION);
    const sim = simulationFromSave(save);
    expect(sim.state.buildings).toHaveLength(0);
    expect(sim.state.world.road[102]).toBe(1);
    expect(sim.state.rules.weatherEvents).toBe(true);
    sim.step(1500); // runs fine after migration
    expect(sim.state.tick).toBe(1540);
  });

  it('runs each step in order up to the target version', () => {
    const migrations = {
      1: (s: { version: number }) => ({ ...s, version: 2, a: 1 }),
      2: (s: { version: number }) => ({ ...s, version: 3, b: 2 }),
    };
    const out = migrateSave({ version: 1 }, migrations, 3);
    expect(out).toEqual({ version: 3, a: 1, b: 2 });
  });

  it('fails loudly when a step is missing or forgets to bump the version', () => {
    expect(() => migrateSave({ version: 1 }, {}, 2)).toThrow(/No migration/);
    expect(() => migrateSave({ version: 1 }, { 1: (s) => s }, 2)).toThrow(/did not bump/);
  });
});
