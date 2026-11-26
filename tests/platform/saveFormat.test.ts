import { describe, expect, it } from 'vitest';
import {
  CURRENT_SAVE_VERSION,
  MIGRATIONS,
  SAVE_FORMAT,
  createSaveFile,
  migrateSave,
  parseSaveFile,
  simulationFromSave,
} from '../../src/platform/saveFormat';
import { rleDecode, rleEncode } from '../../src/sim/serialize';
import { Simulation } from '../../src/sim/simulation';
import { poweredTown, testSim, waterSupplyCommands } from '../sim/helpers';

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
  const water = waterSupplyCommands(sim.state.world, [70, 100], (x) => ({ x, y: 65 }), {
    x: 10,
    y: 68,
  });
  for (const cmd of water) {
    const r = sim.dispatch(cmd);
    if (!r.ok) throw new Error(r.reason);
  }
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
    expect(sim.state.world.water[102]).toBe(1);
    expect(sim.state.world.water[99]).toBe(0);
    expect(sim.state.rules.weatherEvents).toBe(true);
    sim.step(1500); // runs fine after migration
    expect(sim.state.tick).toBe(1540);
  });

  it('upgrades a version 2 save (milestone 2): mains under roads, building water fields', () => {
    const v2 = MIGRATIONS[1]!({
      format: SAVE_FORMAT,
      version: 1,
      meta: { gameName: 'x', label: 'm2', savedAt: '', day: 1, minute: 400, cash: 5, seed: 3 },
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
          road: [0, 128 * 20, 2, 30, 0, 16384 - 128 * 20 - 30],
          zone: [0, 16384],
          density: [0, 16384],
        },
      },
    });
    (v2.state as { buildings: unknown[] }).buildings = [[1, 1, 5, 21, 0.5, 0, 0]];
    const save = parseSaveFile(JSON.stringify(v2));
    expect(save.version).toBe(CURRENT_SAVE_VERSION);
    const sim = simulationFromSave(save);
    expect(sim.state.world.water[128 * 20 + 5]).toBe(1);
    expect(sim.state.world.water[128 * 21 + 5]).toBe(0);
    expect(sim.state.buildings[0]).toMatchObject({ storedMl: 0, dryMinutes: 0, condition: 100 });
    expect(sim.state.water.cursor).toBe(-1);
    expect(sim.state.cache.water.networks).toHaveLength(1);
    sim.step(30);
    // No water source yet, so the old house is now without water.
    expect(sim.state.buildings[0]!.dryMinutes).toBeGreaterThan(0);
  });

  it('upgrades a version 3 save (milestone 3): asset condition, ages, incidents, crews', () => {
    const v3 = MIGRATIONS[2]!(
      MIGRATIONS[1]!({
        format: SAVE_FORMAT,
        version: 1,
        meta: { gameName: 'x', label: 'm3', savedAt: '', day: 3, minute: 3000, cash: 5, seed: 3 },
        state: {
          seed: 3,
          tick: 2640,
          minute: 3000,
          rngState: 1234,
          cash: 5,
          world: {
            width: 128,
            height: 128,
            terrain: [0, 16384],
            road: [0, 128 * 20, 2, 30, 0, 16384 - 128 * 20 - 30],
            zone: [0, 16384],
            density: [0, 16384],
          },
        },
      }),
    );
    const st = v3.state as { buildings: unknown[]; world: { power: number[] } };
    st.buildings = [[1, 200, 5, 30, 1, 0, 0, 0, 0]];
    st.world.power = [0, 128 * 40, 1, 10, 0, 16384 - 128 * 40 - 10];
    const save = parseSaveFile(JSON.stringify(v3));
    expect(save.version).toBe(CURRENT_SAVE_VERSION);
    const sim = simulationFromSave(save);
    const w = sim.state.world;
    expect(w.condition.road[128 * 20 + 5]).toBe(10000);
    expect(w.condition.main[128 * 20 + 5]).toBe(10000);
    expect(w.condition.line[128 * 40 + 3]).toBe(10000);
    expect(w.condition.road[128 * 21]).toBe(0);
    expect(w.laid.road[128 * 20 + 5]).toBe(3);
    expect(sim.state.buildings[0]).toMatchObject({ condition: 100, builtDay: 3, peakLoad: 0 });
    expect(sim.state.incidents).toEqual([]);
    expect(sim.state.crews).toEqual([]);
    sim.step(30);
  });

  it('upgrades a version 4 save (milestone 4): traffic, permits, work order closures', () => {
    const v4 = MIGRATIONS[3]!(
      MIGRATIONS[2]!(
        MIGRATIONS[1]!({
          format: SAVE_FORMAT,
          version: 1,
          meta: { gameName: 'x', label: 'm4', savedAt: '', day: 3, minute: 3000, cash: 5, seed: 3 },
          state: {
            seed: 3,
            tick: 2640,
            minute: 3000,
            rngState: 1234,
            cash: 5,
            world: {
              width: 128,
              height: 128,
              terrain: [0, 16384],
              road: [0, 128 * 20, 2, 30, 0, 16384 - 128 * 20 - 30],
              zone: [0, 16384],
              density: [0, 16384],
            },
          },
        }),
      ),
    );
    const order = (layer: string, id: number, n: number) => ({
      id: n,
      type: 'maintenance',
      crew: layer === 'road' ? 'roads' : 'water',
      asset: { layer, id },
      tile: id,
      incidentId: 0,
      priority: 4,
      manualPriority: false,
      status: 'queued',
      createdMinute: 3000,
      workMinutes: 300,
      cost: 100,
      prepaid: true,
      crewId: 0,
      startedMinute: -1,
    });
    const st = v4.state as { workOrders: unknown[]; world: { water: number[] } };
    st.workOrders = [
      order('road', 128 * 20 + 3, 1),
      order('main', 128 * 20 + 4, 2),
      order('main', 5, 3),
    ];
    st.world.water = [1, 6, 0, 128 * 20 - 6, 1, 30, 0, 16384 - 128 * 20 - 30];
    const save = parseSaveFile(JSON.stringify(v4));
    expect(save.version).toBe(CURRENT_SAVE_VERSION);
    const sim = simulationFromSave(save);
    const s = sim.state;
    expect(s.workOrders.map((o) => o.closure)).toEqual(['full', 'full', 'none']);
    expect(s.workOrders.every((o) => o.permitId === 0 && !o.night)).toBe(true);
    expect(s.permits).toEqual([]);
    expect(s.traffic.cursor).toBe(-1);
    expect(s.world.traffic.every((v) => v === 0)).toBe(true);
    expect(s.cache.traffic.segmentAt[128 * 20 + 5]).toBeGreaterThan(0);
    sim.step(60);
  });

  it('upgrades a version 5 save (milestone 5): economy, services, events, city state', () => {
    // A current save stripped back to its version 5 shape.
    const sim = testSim();
    poweredTown(sim);
    sim.step(30);
    const cur = createSaveFile(sim, 'v5') as unknown as {
      version: number;
      state: Record<string, unknown>;
    };
    const st = { ...cur.state };
    for (const k of [
      'economy',
      'services',
      'fires',
      'events',
      'complaints',
      'happiness',
      'pollution',
    ])
      delete st[k];
    st.rules = { weatherEvents: true };
    const traffic = st.traffic as {
      table: { prod: Record<string, unknown>; attr: Record<string, unknown> };
    };
    for (const part of [traffic.table.prod, traffic.table.attr]) {
      delete part.eventIn;
      delete part.eventOut;
    }
    const save = parseSaveFile(JSON.stringify({ ...cur, version: 5, state: st }));
    expect(save.version).toBe(CURRENT_SAVE_VERSION);
    const loaded = simulationFromSave(save);
    const s = loaded.state;
    expect(s.rules.fires).toBe(true);
    expect(s.economy.budgets.water).toBe(1);
    expect(s.economy.taxRates.residential).toBe(1);
    expect(s.events).toEqual([]);
    expect(s.happiness.cursor).toBe(-1);
    expect(s.pollution.air.length).toBe(32 * 32);
    expect(s.cash).toBe(sim.state.cash);
    loaded.step(120);
  });

  it('upgrades a version 6 save (milestone 6): difficulty, fire measures, KPIs, scenario', () => {
    const sim = testSim();
    poweredTown(sim);
    sim.step(90);
    const cur = createSaveFile(sim, 'v6');
    const st = JSON.parse(JSON.stringify(cur.state)) as Record<string, unknown>;
    delete st.kpis;
    delete st.scenario;
    st.rules = { weatherEvents: true, fires: true };
    st.water = { ...(st.water as object) };
    delete (st.water as Record<string, unknown>).restriction;
    const save = parseSaveFile(JSON.stringify({ ...cur, version: 6, state: st }));
    expect(save.version).toBe(CURRENT_SAVE_VERSION);
    const s = simulationFromSave(save).state;
    expect(s.rules.difficulty).toBe('normal');
    expect(s.rules.licenceFactor).toBe(1);
    expect(s.water.restriction).toBe(0);
    expect(s.kpis.days).toEqual([]);
    expect(s.kpis.today.incidents).toBe(sim.state.assets.kpi.incidents);
    expect(s.scenario).toBeNull();
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
