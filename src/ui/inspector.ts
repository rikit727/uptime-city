/** Describes whatever is under the Inspect tool. Reads the snapshot only. */
import {
  GAME,
  Terrain,
  ZONES,
  densityByCodeOf,
  edgeDistance,
  roadClassByCode,
  zoneTypeByCode,
} from '../sim';
import type { SimSnapshot } from '../sim';
import { clear, h } from './dom';

export class Inspector {
  readonly el = h('aside', { class: 'panel inspector hidden', 'aria-label': 'Inspector' });
  private tile: number | null = null;
  private shownKey = '';

  show(tile: number | null): void {
    this.tile = tile;
    this.shownKey = '';
    this.el.classList.toggle('hidden', tile === null);
  }

  update(snap: SimSnapshot): void {
    if (this.tile === null) return;
    const w = snap.world;
    const i = this.tile;
    const key = `${i}:${snap.revisions.road}:${snap.revisions.zone}:${snap.revisions.terrain}`;
    if (key === this.shownKey) return;
    this.shownKey = key;

    const x = i % w.width;
    const y = Math.floor(i / w.width);
    const rows: [string, string][] = [['Tile', `${x}, ${y}`]];
    const water = w.terrain[i] === Terrain.Water;
    rows.push(['Ground', water ? 'River' : 'Open land']);
    const road = roadClassByCode(w.road[i]!);
    if (road) {
      rows.push(['Road', water ? `${road.name} (bridge)` : road.name]);
      rows.push(['Speed limit', `${road.speedKmh} km/h`]);
      rows.push(['Capacity', `${road.capacityVehPerHour.toLocaleString('en-GB')} vehicles/h`]);
    }
    const zone = zoneTypeByCode(w.zone[i]!);
    if (zone) {
      const d = densityByCodeOf(w.density[i]!);
      rows.push([
        'Zone',
        d && zone.hasDensity ? `${zone.name} (${d.name.toLowerCase()})` : zone.name,
      ]);
    }
    const farmOk = edgeDistance(w, x, y) < GAME.agriculturalEdgeBand;
    if (!road && !water && !zone && ZONES.types.some((t) => t.edgeOnly)) {
      rows.push(['Farmland allowed', farmOk ? 'Yes' : 'No (too far from the edge)']);
    }

    clear(this.el);
    this.el.append(
      h('h3', {}, road ? road.name : zone ? zone.name : water ? 'River' : 'Empty land'),
      h('dl', {}, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    );
  }
}
