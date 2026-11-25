import { describe, expect, it } from 'vitest';
import { TRAFFIC, tileAssetClass } from '../../src/sim/data';
import { openIncident } from '../../src/sim/incidents';
import { deserializeState, serializeState } from '../../src/sim/serialize';
import { Simulation } from '../../src/sim/simulation';
import { hourOf } from '../../src/sim/time';
import { at, testSim } from './helpers';

const ok = (r: { ok: boolean; reason?: string }) => {
  if (!r.ok) throw new Error(r.reason);
};

const RW = TRAFFIC.roadworks;

/**
 * An avenue along y = 20 (x 5..50) crossed by a local road at x = 20, so the
 * avenue has three segments: x 5..19, the junction at 20, and x 21..50. Highways
 * and water depots sit beside it.
 */
function street(): Simulation {
  const sim = testSim();
  ok(
    sim.dispatch({
      type: 'buildRoad',
      roadClass: 'avenue',
      from: { x: 5, y: 20 },
      to: { x: 50, y: 20 },
    }),
  );
  ok(
    sim.dispatch({
      type: 'buildRoad',
      roadClass: 'local',
      from: { x: 20, y: 10 },
      to: { x: 20, y: 30 },
    }),
  );
  ok(sim.dispatch({ type: 'placeFacility', facility: 'roadsDepot', at: { x: 40, y: 21 } }));
  ok(sim.dispatch({ type: 'placeFacility', facility: 'waterDepot', at: { x: 44, y: 21 } }));
  return sim;
}

const resurface = (x: number, extra: Record<string, unknown> = {}) => ({
  type: 'raiseMaintenance' as const,
  from: { x, y: 20 },
  to: { x, y: 20 },
  below: 101,
  only: 'road' as const,
  ...extra,
});

const renewMain = (x: number, extra: Record<string, unknown> = {}) => ({
  ...resurface(x, extra),
  only: 'main' as const,
});

describe('road segments', () => {
  it('splits roads at junctions', () => {
    const sim = street();
    const seg = sim.state.cache.traffic.segmentAt;
    expect(seg[at(sim, 25, 20)]).toBe(seg[at(sim, 50, 20)]);
    expect(seg[at(sim, 10, 20)]).not.toBe(seg[at(sim, 25, 20)]);
    expect(seg[at(sim, 20, 20)]).not.toBe(seg[at(sim, 19, 20)]);
    expect(seg[at(sim, 20, 20)]).not.toBe(seg[at(sim, 21, 20)]);
    expect(seg[at(sim, 25, 21)]).toBe(0);
  });
});

describe('street works permits', () => {
  it('books a permit for planned works on a road, and none off the road', () => {
    const sim = street();
    const s = sim.state;
    ok(sim.dispatch(resurface(30)));
    expect(s.permits).toHaveLength(1);
    const p = s.permits[0]!;
    expect(p.kind).toBe('planned');
    expect(p.tiles).toEqual([at(sim, 30, 20)]);
    expect(p.start).toBe(s.minute);
    expect(p.end).toBeGreaterThan(p.start + s.workOrders[0]!.workMinutes);
    expect(s.workOrders[0]!.permitId).toBe(p.id);
    // Works on a feeder main laid across open ground need no permit.
    ok(
      sim.dispatch({
        type: 'buildMain',
        main: 'feeder',
        from: { x: 30, y: 40 },
        to: { x: 35, y: 40 },
      }),
    );
    ok(
      sim.dispatch({
        type: 'raiseMaintenance',
        from: { x: 32, y: 40 },
        to: { x: 32, y: 40 },
        below: 101,
        only: 'main',
      }),
    );
    expect(s.workOrders[1]!.closure).toBe('none');
    expect(s.workOrders[1]!.permitId).toBe(0);
    expect(s.permits).toHaveLength(1);
    // The permit ends when the works are done.
    for (let k = 0; k < 2000 && s.workOrders.length > 0; k++) sim.step();
    expect(s.workOrders).toHaveLength(0);
    expect(s.permits).toHaveLength(0);
  });

  it('gives emergency repairs a permit at once, flags clashes and combines works', () => {
    const sim = street();
    const s = sim.state;
    const burst = at(sim, 30, 20);
    openIncident(s, 'burst', { layer: 'main', id: burst }, burst);
    expect(s.permits).toHaveLength(1);
    const emergency = s.permits[0]!;
    expect(emergency.kind).toBe('emergency');
    expect(emergency.closure).toBe('lane'); // avenues keep a lane open for repairs
    // Planned resurfacing further along the same segment, booked separately: a clash.
    const cost = tileAssetClass('road', 2)!.maintenance.cost;
    const preview = sim.preview(resurface(35, { combine: false }));
    expect(preview.cost).toBe(cost);
    expect(preview.note).toMatch(/clash/);
    const r = sim.dispatch(resurface(35, { combine: false }));
    expect(r.note).toMatch(/clash/);
    expect(s.permits).toHaveLength(2);
    const planned = s.permits[1]!;
    expect(s.cache.traffic.clashes.get(planned.id)).toEqual([emergency.id]);
    expect(s.cache.traffic.clashes.get(emergency.id)).toEqual([planned.id]);
    expect(s.traffic.kpi.clashes).toBe(1);
    // Works on a different segment do not clash.
    ok(sim.dispatch(resurface(10, { combine: false })));
    expect(s.cache.traffic.clashes.get(s.permits[2]!.id)).toBeUndefined();
    // Combine the planned works into the emergency dig: a refund and one permit.
    const cash = s.cash;
    const c = sim.dispatch({ type: 'combinePermits', from: planned.id, into: emergency.id });
    expect(c.ok).toBe(true);
    expect(s.cash - cash).toBe(Math.round(cost * RW.combine.discount));
    expect(s.permits.map((p) => p.id)).not.toContain(planned.id);
    expect(emergency.orders).toHaveLength(2);
    expect(emergency.combined).toBe(true);
    expect(s.cache.traffic.clashes.size).toBe(0);
    expect(s.traffic.kpi.combined).toBe(1);
    expect(s.traffic.kpi.combinedSavings).toBe(Math.round(cost * RW.combine.discount));
    // Different streets cannot be combined.
    expect(
      sim.dispatch({ type: 'combinePermits', from: s.permits[1]!.id, into: emergency.id }).ok,
    ).toBe(false);
  });

  it('combines planned works on the same street automatically, at a discount', () => {
    const sim = street();
    const s = sim.state;
    const before = s.cash;
    ok(sim.dispatch(renewMain(30)));
    expect(before - s.cash).toBe(tileAssetClass('main', 1)!.maintenance.cost);
    const roadCost = tileAssetClass('road', 2)!.maintenance.cost;
    const p = sim.preview(resurface(30));
    const net = roadCost - Math.round(roadCost * RW.combine.discount);
    expect(p.cost).toBe(net);
    expect(p.note).toMatch(/saved/);
    ok(sim.dispatch(resurface(30)));
    expect(s.permits).toHaveLength(1);
    expect(s.permits[0]!.orders).toHaveLength(2);
    const road = s.workOrders.find((o) => o.asset.layer === 'road')!;
    const main = s.workOrders.find((o) => o.asset.layer === 'main')!;
    expect(road.combined).toBe(true);
    expect(road.cost).toBe(net);
    // Resurfacing waits for the dig, then is quicker over the open trench.
    for (let k = 0; k < 2000 && s.workOrders.includes(main); k++) {
      sim.step();
      if (s.workOrders.includes(main)) expect(road.status).toBe('queued');
    }
    expect(s.permits[0]!.dug).toEqual([at(sim, 30, 20)]);
    const planned = tileAssetClass('road', 2)!.maintenance.minutes;
    for (let k = 0; k < 500 && road.status !== 'onSite'; k++) sim.step();
    expect(road.status).toBe('onSite');
    expect(road.workMinutes).toBe(Math.round(planned * RW.combine.resurfaceFactor));
  });

  it('books night works for 20:00, holds the crew until then, and charges more', () => {
    const sim = street();
    const s = sim.state;
    expect(hourOf(s.minute)).toBeLessThan(RW.night.startHour);
    const cls = tileAssetClass('road', 2)!.maintenance;
    const preview = sim.preview(resurface(30, { night: true }));
    expect(preview.cost).toBe(Math.round(cls.cost * RW.night.costFactor));
    ok(sim.dispatch(resurface(30, { night: true })));
    const p = s.permits[0]!;
    const o = s.workOrders[0]!;
    expect(p.night).toBe(true);
    expect(hourOf(p.start)).toBe(RW.night.startHour);
    expect(o.workMinutes).toBe(Math.round(cls.minutes * RW.night.durationFactor));
    expect(s.traffic.kpi.nightWorks).toBe(1);
    const crew = s.crews.find((c) => c.type === 'roads')!;
    expect(sim.dispatch({ type: 'assignCrew', crew: crew.id, order: o.id }).ok).toBe(false);
    while (s.minute < p.start - 1) {
      sim.step();
      expect(o.status).toBe('queued');
    }
    sim.step(2);
    expect(o.status).toBe('enRoute');
  });

  it('flags works that overrun their slot', () => {
    const sim = street();
    const s = sim.state;
    // No highways crew: nobody turns up.
    const depot = s.buildings.find((b) => b.code === 400)!;
    ok(
      sim.dispatch({
        type: 'bulldoze',
        from: { x: depot.x, y: depot.y },
        to: { x: depot.x, y: depot.y },
      }),
    );
    ok(sim.dispatch(resurface(30)));
    const p = s.permits[0]!;
    const events = [];
    while (s.minute <= p.end + 1) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    expect(p.overrun).toBe(true);
    expect(s.traffic.kpi.overruns).toBe(1);
    expect(events.some((e) => e.type === 'permitOverrun' && e.id === p.id)).toBe(true);
  });

  it('survives a save and load with permits and works in progress', () => {
    const sim = street();
    const s = sim.state;
    ok(sim.dispatch(renewMain(30)));
    ok(sim.dispatch(resurface(30)));
    ok(sim.dispatch(resurface(10, { night: true, closure: 'lane' })));
    sim.step(60);
    const loaded = new Simulation(deserializeState(JSON.parse(JSON.stringify(serializeState(s)))));
    expect(loaded.state.permits).toEqual(s.permits);
    expect(loaded.state.workOrders).toEqual(s.workOrders);
    expect(loaded.hash()).toBe(sim.hash());
    sim.step(900);
    loaded.step(900);
    expect(loaded.hash()).toBe(sim.hash());
  });
});
