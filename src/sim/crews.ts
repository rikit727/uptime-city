/**
 * Crews and depots: crews are created with their depot and removed with it.
 * A crew sets off after mobilising (from the depot) or straight away (when
 * diverted on the road), drives along its planned route (slowed by the
 * congestion at the moment it sets out), works on site and drives back. Work orders and their lifecycle live in incidents.ts.
 */
import { ASSETS, buildingDef } from './data';
import type { DepotDef } from './data';
import { planRoute, positionAlong } from './routing';
import { crewSpecOf } from './services';
import type { Building, Crew, SimState } from './state';
import type { CrewType } from './types';
import { tileIndex } from './world';
import type { WorldState } from './world';

export const depotDefOf = (b: Building): DepotDef | undefined => {
  const def = buildingDef(b.code);
  return def?.role === 'facility' && def.utility === 'depot' ? def : undefined;
};

/** The road tile a depot's vans use (first road beside the footprint), else its corner tile. */
export function depotExitTile(state: SimState, b: Building): number {
  const w = state.world;
  const def = buildingDef(b.code)!;
  const [fw, fd] = def.footprint;
  for (let yy = Math.max(0, b.y - 1); yy <= Math.min(w.height - 1, b.y + fd); yy++) {
    for (let xx = Math.max(0, b.x - 1); xx <= Math.min(w.width - 1, b.x + fw); xx++) {
      if (xx >= b.x && xx < b.x + fw && yy >= b.y && yy < b.y + fd) continue;
      const t = tileIndex(w, xx, yy);
      if (w.road[t] !== 0) return t;
    }
  }
  return tileIndex(w, b.x, b.y);
}

/** Add one crew of a type at a depot or fire station (kept in ascending id order). */
export function createCrew(state: SimState, depot: Building, type: CrewType): void {
  state.crews.push({
    id: state.assets.nextCrewId++,
    type,
    depot: depot.id,
    status: 'idle',
    orderId: 0,
    path: [],
    departMinute: 0,
    arriveMinute: 0,
    tile: depotExitTile(state, depot),
  });
}

/** Add the crews of a newly placed depot or fire station (as many as its budget allows). */
export function createDepotCrews(state: SimState, depot: Building, count?: number): void {
  const spec = crewSpecOf(depot);
  if (!spec) return;
  for (let k = 0; k < (count ?? spec.crews); k++) createCrew(state, depot, spec.type);
}

export const isMoving = (c: Crew): boolean => c.status === 'enRoute' || c.status === 'returning';

/** Fractional tile position of a crew now (for rendering), and the path tile it has reached. */
export function crewPosition(
  state: { readonly world: WorldState; readonly minute: number },
  c: Crew,
): { x: number; y: number; tile: number } {
  const w = state.world;
  if (!isMoving(c) || c.path.length === 0) {
    return { x: (c.tile % w.width) + 0.5, y: Math.floor(c.tile / w.width) + 0.5, tile: c.tile };
  }
  const p = positionAlong(w, c.path, c.departMinute, c.arriveMinute, state.minute);
  return { x: p.x, y: p.y, tile: c.path[p.index]! };
}

/**
 * Send a crew to a tile from wherever it is now. Crews at their depot mobilise
 * first; crews already on the road set off at once.
 */
export function sendCrew(state: SimState, c: Crew, to: number): void {
  const from = crewPosition(state, c).tile;
  const route = planRoute(state.world, from, to, state.cache.traffic.crewSlow);
  const mobilise =
    c.status === 'idle' ? (ASSETS.crews.mobiliseByType[c.type] ?? ASSETS.crews.mobiliseMinutes) : 0;
  c.path = route.path;
  c.departMinute = state.minute + mobilise;
  c.arriveMinute = c.departMinute + Math.max(1, Math.ceil(route.minutes));
  c.tile = from;
}

/** Send a crew back to its depot (or leave it idle if the depot is gone). */
export function returnCrew(state: SimState, c: Crew): void {
  c.orderId = 0;
  const depot = state.cache.byId.get(c.depot);
  if (!depot) return;
  const home = depotExitTile(state, depot);
  if (crewPosition(state, c).tile === home && !isMoving(c)) {
    c.status = 'idle';
    c.path = [];
    c.tile = home;
    return;
  }
  sendCrew(state, c, home);
  c.status = 'returning';
}

/** Crews of a type that could take a new job now (idle or heading home). */
export function availableCrews(state: SimState, type: CrewType): Crew[] {
  return state.crews.filter(
    (c) => c.type === type && (c.status === 'idle' || c.status === 'returning'),
  );
}

/** Number of crews of each type. */
export function crewCount(state: SimState, type: CrewType): number {
  let n = 0;
  for (const c of state.crews) if (c.type === type) n++;
  return n;
}
