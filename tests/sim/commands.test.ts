import { describe, expect, it } from 'vitest';
import { addBuilding } from '../../src/sim/buildings';
import {
  BUILDINGS,
  GAME,
  POWER,
  ROADS,
  facilityDef,
  lineType,
  roadClass,
  zoneType,
} from '../../src/sim/data';
import type { RoadClassId } from '../../src/sim/types';
import { at, testSim } from './helpers';

describe('buildRoad', () => {
  it('lays a road and charges per tile', () => {
    const sim = testSim();
    const before = sim.state.cash;
    const r = sim.dispatch({
      type: 'buildRoad',
      roadClass: 'local',
      from: { x: 10, y: 10 },
      to: { x: 19, y: 10 },
    });
    expect(r.ok).toBe(true);
    expect(r.cost).toBe(10 * roadClass('local').costPerTile);
    expect(sim.state.cash).toBe(before - r.cost);
    expect(sim.state.world.road[at(sim, 15, 10)]).toBe(roadClass('local').code);
    expect(sim.revisions.road).toBe(1);
  });

  it('skips tiles that already have the same class, and upgrades others', () => {
    const sim = testSim();
    sim.dispatch({
      type: 'buildRoad',
      roadClass: 'local',
      from: { x: 10, y: 10 },
      to: { x: 14, y: 10 },
    });
    const again = sim.dispatch({
      type: 'buildRoad',
      roadClass: 'local',
      from: { x: 10, y: 10 },
      to: { x: 14, y: 10 },
    });
    expect(again.ok).toBe(false);
    const up = sim.dispatch({
      type: 'buildRoad',
      roadClass: 'avenue',
      from: { x: 10, y: 10 },
      to: { x: 16, y: 10 },
    });
    expect(up.ok).toBe(true);
    expect(up.cost).toBe(7 * roadClass('avenue').costPerTile);
    expect(sim.state.world.road[at(sim, 10, 10)]).toBe(roadClass('avenue').code);
  });

  it('bridges water at a cost multiplier', () => {
    const sim = testSim();
    const r = sim.dispatch({
      type: 'buildRoad',
      roadClass: 'local',
      from: { x: 58, y: 5 },
      to: { x: 64, y: 5 },
    });
    const per = roadClass('local').costPerTile;
    expect(r.cost).toBe(4 * per + 3 * per * ROADS.bridgeCostMultiplier);
  });

  it('refuses when the player cannot afford it and changes nothing', () => {
    const sim = testSim(100);
    const r = sim.dispatch({
      type: 'buildRoad',
      roadClass: 'highway',
      from: { x: 0, y: 0 },
      to: { x: 20, y: 0 },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Not enough cash/);
    expect(sim.state.cash).toBe(100);
    expect(sim.state.world.road.some((v) => v !== 0)).toBe(false);
    expect(sim.commandLog).toHaveLength(0);
  });

  it('clips paths that leave the map and removes zoning underneath', () => {
    const sim = testSim();
    sim.dispatch({
      type: 'zone',
      zone: 'residential',
      density: 'low',
      from: { x: 0, y: 0 },
      to: { x: 3, y: 3 },
    });
    const r = sim.dispatch({
      type: 'buildRoad',
      roadClass: 'local',
      from: { x: -5, y: 1 },
      to: { x: 2, y: 1 },
    });
    expect(r.ok).toBe(true);
    expect(r.cost).toBe(3 * roadClass('local').costPerTile);
    expect(sim.state.world.zone[at(sim, 1, 1)]).toBe(0);
    expect(sim.state.world.zone[at(sim, 1, 2)]).toBe(zoneType('residential').code);
  });

  it('rejects unknown road classes', () => {
    const sim = testSim();
    const r = sim.dispatch({
      type: 'buildRoad',
      roadClass: 'motorway' as RoadClassId, // deliberately invalid input
      from: { x: 0, y: 0 },
      to: { x: 1, y: 0 },
    });
    expect(r.ok).toBe(false);
  });
});

describe('zone', () => {
  it('zones a rectangle, skipping roads and water', () => {
    const sim = testSim();
    sim.dispatch({
      type: 'buildRoad',
      roadClass: 'local',
      from: { x: 55, y: 30 },
      to: { x: 59, y: 30 },
    });
    const plan = sim.preview({
      type: 'zone',
      zone: 'commercial',
      density: 'high',
      from: { x: 55, y: 29 },
      to: { x: 61, y: 31 },
    });
    // 7×3 = 21 tiles; 5 road + 6 water blocked (cols 60, 61 × 3 rows)
    expect(plan.affected).toHaveLength(21 - 5 - 6);
    expect(plan.blocked).toHaveLength(11);
    const r = sim.dispatch({
      type: 'zone',
      zone: 'commercial',
      density: 'high',
      from: { x: 55, y: 29 },
      to: { x: 61, y: 31 },
    });
    expect(r.ok).toBe(true);
    expect(r.cost).toBe(10 * zoneType('commercial').costPerTile);
    expect(sim.state.world.zone[at(sim, 55, 29)]).toBe(zoneType('commercial').code);
    expect(sim.state.world.density[at(sim, 55, 29)]).toBe(3);
  });

  it('re-zones to a different density but skips identical zoning', () => {
    const sim = testSim();
    const cmd = {
      type: 'zone',
      zone: 'residential',
      density: 'low',
      from: { x: 5, y: 5 },
      to: { x: 6, y: 6 },
    } as const;
    expect(sim.dispatch(cmd).ok).toBe(true);
    expect(sim.dispatch(cmd).ok).toBe(false);
    expect(sim.dispatch({ ...cmd, density: 'medium' }).ok).toBe(true);
    expect(sim.state.world.density[at(sim, 5, 5)]).toBe(2);
  });

  it('allows agricultural zoning only near the map edge', () => {
    const sim = testSim();
    const band = GAME.agriculturalEdgeBand;
    const inner = sim.dispatch({
      type: 'zone',
      zone: 'agricultural',
      density: 'low',
      from: { x: 40, y: 40 },
      to: { x: 45, y: 45 },
    });
    expect(inner.ok).toBe(false);
    expect(inner.reason).toMatch(/edge/);
    const plan = sim.preview({
      type: 'zone',
      zone: 'agricultural',
      density: 'low',
      from: { x: band - 2, y: 30 },
      to: { x: band + 1, y: 30 },
    });
    expect(plan.affected).toHaveLength(2);
    expect(plan.blocked).toHaveLength(2);
    const edge = sim.dispatch({
      type: 'zone',
      zone: 'agricultural',
      density: 'high',
      from: { x: 0, y: 30 },
      to: { x: 5, y: 35 },
    });
    expect(edge.ok).toBe(true);
    expect(sim.state.world.density[at(sim, 0, 30)]).toBe(0);
  });
});

describe('bulldoze', () => {
  it('clears roads at a cost and zones for free', () => {
    const sim = testSim();
    sim.dispatch({
      type: 'buildRoad',
      roadClass: 'local',
      from: { x: 10, y: 10 },
      to: { x: 12, y: 10 },
    });
    sim.dispatch({
      type: 'zone',
      zone: 'office',
      density: 'low',
      from: { x: 10, y: 11 },
      to: { x: 12, y: 11 },
    });
    const r = sim.dispatch({ type: 'bulldoze', from: { x: 10, y: 10 }, to: { x: 12, y: 12 } });
    expect(r.ok).toBe(true);
    expect(r.cost).toBe(3 * ROADS.demolishCostPerTile);
    expect(sim.state.world.road.some((v) => v !== 0)).toBe(false);
    expect(sim.state.world.zone.some((v) => v !== 0)).toBe(false);
  });

  it('fails on empty land', () => {
    const sim = testSim();
    expect(sim.dispatch({ type: 'bulldoze', from: { x: 0, y: 0 }, to: { x: 3, y: 3 } }).ok).toBe(
      false,
    );
  });
});

describe('preview', () => {
  it('never changes state', () => {
    const sim = testSim();
    const h = sim.hash();
    sim.preview({
      type: 'buildRoad',
      roadClass: 'highway',
      from: { x: 0, y: 0 },
      to: { x: 100, y: 50 },
    });
    sim.preview({
      type: 'zone',
      zone: 'industrial',
      density: 'high',
      from: { x: 0, y: 0 },
      to: { x: 127, y: 127 },
    });
    expect(sim.hash()).toBe(h);
  });
});

describe('placeFacility', () => {
  it('places on clear land, charges the cost and clears zoning', () => {
    const sim = testSim();
    sim.dispatch({
      type: 'zone',
      zone: 'residential',
      density: 'low',
      from: { x: 10, y: 10 },
      to: { x: 14, y: 14 },
    });
    const before = sim.state.cash;
    const rev = { ...sim.revisions };
    const r = sim.dispatch({ type: 'placeFacility', facility: 'solarFarm', at: { x: 10, y: 10 } });
    expect(r.ok).toBe(true);
    expect(r.cost).toBe(facilityDef('solarFarm').cost);
    expect(sim.state.cash).toBe(before - r.cost);
    expect(sim.state.world.zone[at(sim, 11, 11)]).toBe(0);
    expect(sim.state.cache.buildingAt[at(sim, 12, 12)]).not.toBe(0);
    expect(sim.revisions.building).toBe(rev.building + 1);
    expect(sim.revisions.power).toBe(rev.power + 1);
  });

  it('is blocked by water, roads, other buildings and the map edge', () => {
    const sim = testSim();
    expect(
      sim.preview({ type: 'placeFacility', facility: 'gasPlant', at: { x: 59, y: 5 } }).ok,
    ).toBe(false);
    sim.dispatch({
      type: 'buildRoad',
      roadClass: 'local',
      from: { x: 10, y: 5 },
      to: { x: 10, y: 9 },
    });
    const onRoad = sim.preview({ type: 'placeFacility', facility: 'gasPlant', at: { x: 9, y: 5 } });
    expect(onRoad.ok).toBe(false);
    expect(onRoad.blocked.length).toBe(3);
    sim.dispatch({ type: 'placeFacility', facility: 'battery', at: { x: 20, y: 20 } });
    expect(
      sim.preview({ type: 'placeFacility', facility: 'battery', at: { x: 21, y: 21 } }).ok,
    ).toBe(false);
    expect(
      sim.preview({ type: 'placeFacility', facility: 'gasPlant', at: { x: 126, y: 0 } }).reason,
    ).toMatch(/edge/);
  });
});

describe('buildLine', () => {
  it('lays lines, spans water at a multiplier and upgrades', () => {
    const sim = testSim();
    const r = sim.dispatch({
      type: 'buildLine',
      line: 'distribution',
      from: { x: 57, y: 3 },
      to: { x: 64, y: 3 },
    });
    const per = lineType('distribution').costPerTile;
    expect(r.cost).toBe(5 * per + 3 * per * POWER.lineWaterCostMultiplier);
    expect(sim.state.world.power[at(sim, 61, 3)]).toBe(lineType('distribution').code);
    const up = sim.dispatch({
      type: 'buildLine',
      line: 'transmission',
      from: { x: 57, y: 3 },
      to: { x: 58, y: 3 },
    });
    expect(up.ok).toBe(true);
    expect(sim.state.world.power[at(sim, 57, 3)]).toBe(lineType('transmission').code);
  });

  it('can share a tile with a road but blocks zoning', () => {
    const sim = testSim();
    sim.dispatch({
      type: 'buildRoad',
      roadClass: 'local',
      from: { x: 5, y: 5 },
      to: { x: 15, y: 5 },
    });
    expect(
      sim.dispatch({
        type: 'buildLine',
        line: 'distribution',
        from: { x: 5, y: 5 },
        to: { x: 15, y: 5 },
      }).ok,
    ).toBe(true);
    sim.dispatch({
      type: 'buildLine',
      line: 'distribution',
      from: { x: 5, y: 8 },
      to: { x: 15, y: 8 },
    });
    const z = sim.preview({
      type: 'zone',
      zone: 'residential',
      density: 'low',
      from: { x: 5, y: 7 },
      to: { x: 15, y: 9 },
    });
    expect(z.blocked).toHaveLength(11);
  });

  it('is refused through a grown building', () => {
    const sim = testSim();
    sim.dispatch({
      type: 'zone',
      zone: 'residential',
      density: 'low',
      from: { x: 10, y: 10 },
      to: { x: 10, y: 10 },
    });
    addBuilding(sim.state, BUILDINGS.types[0]!.code, 10, 10, 1);
    const r = sim.dispatch({
      type: 'buildLine',
      line: 'distribution',
      from: { x: 5, y: 10 },
      to: { x: 15, y: 10 },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/building is in the way/);
  });
});

describe('bulldoze buildings', () => {
  it('removes whole buildings and facilities, charging per footprint tile', () => {
    const sim = testSim();
    sim.dispatch({ type: 'placeFacility', facility: 'gasPlant', at: { x: 10, y: 10 } });
    const r = sim.dispatch({ type: 'bulldoze', from: { x: 10, y: 10 }, to: { x: 10, y: 10 } });
    expect(r.ok).toBe(true);
    expect(r.cost).toBe(9 * BUILDINGS.demolishCostPerTile);
    expect(sim.state.buildings).toHaveLength(0);
    expect(sim.state.cache.buildingAt.some((v) => v !== 0)).toBe(false);
    expect(sim.state.cache.network.islands).toHaveLength(0);
  });
});
