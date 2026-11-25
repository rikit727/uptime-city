import { describe, expect, it } from 'vitest';
import { createSaveFile, parseSaveFile, simulationFromSave } from '../../src/platform/saveFormat';
import { estateStats } from '../../src/sim/estates';
import { at, testSim } from './helpers';

const zoneInd = (x0: number, y0: number, x1: number, y1: number) =>
  ({
    type: 'zone',
    zone: 'industrial',
    density: 'low',
    from: { x: x0, y: y0 },
    to: { x: x1, y: y1 },
  }) as const;

describe('industrial estates', () => {
  it('groups adjacent industrial plots into named estates', () => {
    const sim = testSim();
    sim.dispatch(zoneInd(5, 5, 10, 10));
    sim.dispatch(zoneInd(20, 5, 25, 10));
    const s = sim.state;
    expect(s.estates).toHaveLength(2);
    expect(s.estates[0]!.name).not.toBe(s.estates[1]!.name);
    expect(s.cache.estateAt[at(sim, 5, 5)]).toBe(s.estates[0]!.id);
    expect(s.cache.estateAt[at(sim, 25, 10)]).toBe(s.estates[1]!.id);
    expect(s.cache.estateAt[at(sim, 15, 5)]).toBe(0);
    const src = {
      world: s.world,
      buildings: s.buildings,
      estateAt: s.cache.estateAt,
      loadKw: s.cache.loadKw,
    };
    expect(estateStats(src, s.estates[0]!.id).tiles).toBe(36);
  });

  it('merging keeps the older name; splitting keeps it for the anchored part', () => {
    const sim = testSim();
    sim.dispatch(zoneInd(5, 5, 10, 10));
    sim.dispatch(zoneInd(20, 5, 25, 10));
    const [first, second] = sim.state.estates;
    sim.dispatch(zoneInd(11, 7, 19, 7)); // bridge them
    expect(sim.state.estates).toHaveLength(1);
    expect(sim.state.estates[0]!.name).toBe(first!.name);
    // A single road keeps the estate together (estates have internal roads).
    sim.dispatch({
      type: 'buildRoad',
      roadClass: 'local',
      from: { x: 15, y: 0 },
      to: { x: 15, y: 20 },
    });
    expect(sim.state.estates).toHaveLength(1);
    // Clearing a wider gap splits it: the left part keeps the name, the right gets a new one.
    sim.dispatch({ type: 'bulldoze', from: { x: 13, y: 7 }, to: { x: 17, y: 7 } });
    expect(sim.state.estates).toHaveLength(2);
    expect(sim.state.cache.estateAt[at(sim, 5, 5)]).toBe(first!.id);
    const right = sim.state.estates.find((e) => e.id !== first!.id)!;
    expect(right.id).toBeGreaterThan(second!.id);
  });

  it('keeps names through save and load', () => {
    const sim = testSim();
    sim.dispatch(zoneInd(5, 5, 10, 10));
    sim.dispatch(zoneInd(20, 5, 25, 10));
    const loaded = simulationFromSave(parseSaveFile(JSON.stringify(createSaveFile(sim, 't'))));
    expect(loaded.state.estates).toEqual(sim.state.estates);
    expect(Array.from(loaded.state.cache.estateAt)).toEqual(Array.from(sim.state.cache.estateAt));
  });
});
