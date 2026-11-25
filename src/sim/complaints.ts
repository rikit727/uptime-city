/**
 * Residents' complaints, generated from real sim events ("No water on Mill
 * Road for 3 hours"), and the street names they quote.
 *
 * Street names are a pure function of the road layout: a tile takes the name
 * of the straight run of road it is on (horizontal first), hashed into the
 * name and suffix lists in city.json. So a street keeps its name along its
 * length, through junctions, until the layout changes. Complaints save their
 * text when they are made.
 */
import { CITY, roadClassByCode } from './data';
import { nearestRoad } from './routing';
import type { Complaint, SimState } from './state';
import type { WorldState } from './world';

const hash = (a: number, b: number, c: number): number => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f) ^ c;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  return (h ^ (h >>> 15)) >>> 0;
};

/** The name of the street at or nearest to a tile ("the area" if there is no road nearby). */
export function streetName(w: WorldState, tile: number): string {
  const t = nearestRoad(w, tile, 3);
  if (t < 0) return 'the area';
  const x = t % w.width;
  const y = (t - x) / w.width;
  const road = (xx: number, yy: number) =>
    xx >= 0 && yy >= 0 && xx < w.width && yy < w.height && w.road[yy * w.width + xx] !== 0;
  let key: number;
  if (road(x - 1, y) || road(x + 1, y)) {
    let sx = x;
    while (road(sx - 1, y)) sx--;
    key = hash(1, y, sx);
  } else {
    let sy = y;
    while (road(x, sy - 1)) sy--;
    key = hash(2, x, sy);
  }
  const S = CITY.streets;
  const cls = roadClassByCode(w.road[t]!)?.id ?? 'local';
  const suffixes = S[cls];
  const name = S.names[key % S.names.length]!;
  const suffix = suffixes[Math.floor(key / S.names.length) % suffixes.length]!;
  return `${name} ${suffix}`;
}

/**
 * Record a complaint unless one with the same key was made within `cooldownHours`
 * (0 = only once while it is still in the feed). Returns true if it was added.
 */
export function addComplaint(
  state: SimState,
  kind: string,
  key: string,
  text: string,
  tile: number,
  cooldownHours = 0,
): boolean {
  for (let k = state.complaints.length - 1; k >= 0; k--) {
    const c = state.complaints[k]!;
    if (c.key !== key) continue;
    if (cooldownHours <= 0 || state.minute - c.minute < cooldownHours * 60) return false;
    break;
  }
  const c: Complaint = {
    id: state.services.nextComplaintId++,
    minute: state.minute,
    kind,
    text,
    tile,
    key,
  };
  state.complaints.push(c);
  const drop = state.complaints.length - CITY.complaints.kept;
  if (drop > 0) state.complaints.splice(0, drop);
  return true;
}

/** Complaints made in the last day. */
export function recentComplaints(state: SimState, minutes = 1440): number {
  let n = 0;
  for (const c of state.complaints) if (state.minute - c.minute < minutes) n++;
  return n;
}

/** Cooldown for a kind of complaint (city.json `complaints.cooldownHours`). */
export const cooldownFor = (kind: string): number => CITY.complaints.cooldownHours[kind] ?? 24;
