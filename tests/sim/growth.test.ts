import { describe, expect, it } from 'vitest';
import { buildingTiles, defOf } from '../../src/sim/buildings';
import { zoneType } from '../../src/sim/data';
import { computeDemand, cityTotals } from '../../src/sim/growth';
import { MINUTES_PER_DAY } from '../../src/sim/time';
import { at, poweredTown, riverWater, testSim } from './helpers';

describe('demand', () => {
  it('starts positive for every zone in an empty city', () => {
    const d = computeDemand(testSim().state);
    for (const v of Object.values(d)) expect(v).toBeGreaterThan(0);
  });
});

describe('growth', () => {
  it('grows buildings on powered, zoned land beside a road', () => {
    const sim = testSim();
    poweredTown(sim, 'residential', 'low');
    sim.step(2 * MINUTES_PER_DAY);
    const s = sim.state;
    expect(s.buildings.length).toBeGreaterThan(10);
    const res = zoneType('residential').code;
    for (const b of s.buildings) {
      const def = defOf(b);
      if (def.role !== 'grown') continue;
      expect(def.zone).toBe('residential');
      expect(def.densities).toContain('low');
      for (const t of buildingTiles(s, b)) {
        expect(s.world.zone[t]).toBe(res);
        expect(s.cache.buildingAt[t]).toBe(b.id);
      }
    }
    // Only the row next to the road (y = 21) can grow 1×1 buildings.
    const grown = s.buildings.filter((b) => defOf(b).role === 'grown');
    expect(grown.every((b) => b.y === 21)).toBe(true);
    expect(cityTotals(s).residents).toBeGreaterThan(0);
  });

  it('needs power: nothing grows without a substation', () => {
    const sim = testSim();
    sim.dispatch({
      type: 'buildRoad',
      roadClass: 'local',
      from: { x: 5, y: 20 },
      to: { x: 40, y: 20 },
    });
    sim.dispatch({
      type: 'zone',
      zone: 'residential',
      density: 'low',
      from: { x: 5, y: 21 },
      to: { x: 30, y: 22 },
    });
    sim.step(MINUTES_PER_DAY);
    expect(sim.state.buildings).toHaveLength(0);
  });

  it('needs a road: zoning away from roads stays empty', () => {
    const sim = testSim();
    poweredTown(sim);
    // A zoned block not touching any road, inside the substation's radius.
    sim.dispatch({
      type: 'zone',
      zone: 'commercial',
      density: 'low',
      from: { x: 12, y: 32 },
      to: { x: 15, y: 34 },
    });
    sim.step(MINUTES_PER_DAY);
    const onBlock = sim.state.buildings.filter((b) => b.y >= 32);
    expect(onBlock).toHaveLength(0);
  });

  it('grows farms on agricultural land and their occupancy rises', () => {
    const sim = testSim();
    sim.dispatch({
      type: 'buildRoad',
      roadClass: 'local',
      from: { x: 0, y: 40 },
      to: { x: 19, y: 40 },
    });
    sim.dispatch({
      type: 'buildRoad',
      roadClass: 'local',
      from: { x: 0, y: 60 },
      to: { x: 19, y: 60 },
    });
    sim.dispatch({
      type: 'zone',
      zone: 'agricultural',
      density: 'low',
      from: { x: 0, y: 41 },
      to: { x: 19, y: 59 },
    });
    sim.dispatch({ type: 'placeFacility', facility: 'gasPlant', at: { x: 22, y: 45 } });
    sim.dispatch({ type: 'placeFacility', facility: 'substation', at: { x: 8, y: 49 } });
    expect(
      sim.dispatch({
        type: 'buildLine',
        line: 'distribution',
        from: { x: 21, y: 46 },
        to: { x: 10, y: 49 },
      }).ok,
    ).toBe(true);
    riverWater(sim, 41, { x: 19, y: 40 }, { x: 25, y: 46 });
    // Farms appear along both roads.
    sim.step(4 * MINUTES_PER_DAY);
    const farms = sim.state.buildings.filter((b) => defOf(b).role === 'grown');
    expect(farms.length).toBeGreaterThan(3);
    for (const f of farms) expect((defOf(f) as { zone: string }).zone).toBe('agricultural');
    expect(farms.some((f) => f.occupancy > 0.25)).toBe(true);
  });

  it('building a road over a farm removes the farm', () => {
    const sim = testSim();
    sim.dispatch({
      type: 'buildRoad',
      roadClass: 'local',
      from: { x: 0, y: 40 },
      to: { x: 19, y: 40 },
    });
    sim.dispatch({
      type: 'zone',
      zone: 'agricultural',
      density: 'low',
      from: { x: 0, y: 41 },
      to: { x: 19, y: 50 },
    });
    sim.dispatch({ type: 'placeFacility', facility: 'gasPlant', at: { x: 22, y: 41 } });
    sim.dispatch({ type: 'placeFacility', facility: 'substation', at: { x: 22, y: 44 } });
    riverWater(sim, 30, { x: 19, y: 40 }, { x: 25, y: 42 });
    sim.step(2 * MINUTES_PER_DAY);
    const farm = sim.state.buildings.find((b) => defOf(b).role === 'grown');
    expect(farm).toBeDefined();
    const plan = sim.preview({
      type: 'buildRoad',
      roadClass: 'local',
      from: { x: farm!.x + 1, y: 41 },
      to: { x: farm!.x + 1, y: 50 },
    });
    expect(plan.demolish).toContain(farm!.id);
    expect(plan.removed.length).toBe(buildingTiles(sim.state, farm!).length);
    sim.dispatch({
      type: 'buildRoad',
      roadClass: 'local',
      from: { x: farm!.x + 1, y: 41 },
      to: { x: farm!.x + 1, y: 50 },
    });
    expect(sim.state.cache.byId.has(farm!.id)).toBe(false);
    expect(sim.state.cache.buildingAt[at(sim, farm!.x, farm!.y)]).toBe(0);
  });

  it('re-zoning a built tile demolishes the building', () => {
    const sim = testSim();
    poweredTown(sim);
    sim.step(MINUTES_PER_DAY);
    const b = sim.state.buildings.find((x) => defOf(x).role === 'grown')!;
    const r = sim.dispatch({
      type: 'zone',
      zone: 'office',
      density: 'low',
      from: { x: b.x, y: b.y },
      to: { x: b.x, y: b.y },
    });
    expect(r.ok).toBe(true);
    expect(sim.state.cache.byId.has(b.id)).toBe(false);
  });

  it('long outages empty buildings', () => {
    const sim = testSim();
    poweredTown(sim);
    sim.step(MINUTES_PER_DAY);
    const before = sim.state.buildings.filter((b) => defOf(b).role === 'grown');
    expect(before.length).toBeGreaterThan(0);
    // Remove the substation: everything loses power.
    sim.dispatch({ type: 'bulldoze', from: { x: 8, y: 30 }, to: { x: 9, y: 31 } });
    sim.step(MINUTES_PER_DAY);
    for (const b of sim.state.buildings) {
      if (defOf(b).role !== 'grown') continue;
      expect(b.unpoweredMinutes).toBeGreaterThan(0);
    }
    const occ = sim.state.buildings.reduce(
      (s, b) => s + (defOf(b).role === 'grown' ? b.occupancy : 0),
      0,
    );
    const occBefore = before.length * 0.25;
    expect(occ).toBeLessThan(occBefore * 2);
    expect(sim.state.buildings.some((b) => defOf(b).role === 'grown' && b.occupancy < 0.2)).toBe(
      true,
    );
  });
});
