/** Road tiles, coloured by road class. Roads over water are drawn as raised bridges. */
import { Color, Group } from 'three';
import { ROADS, Terrain } from '../../sim';
import type { SimSnapshot } from '../../sim';
import { TileInstances } from './tileInstances';

const BRIDGE_DECK_Y = 0.25;
const ROAD_Y = 0.03;

export class RoadLayer {
  readonly group = new Group();
  private readonly tiles: TileInstances;
  private readonly colours = new Map<number, Color>();
  private builtRev = -1;
  private builtTerrainRev = -1;

  constructor(width: number, height: number) {
    this.tiles = new TileInstances(width * height, width, 1, 0.06);
    this.tiles.mesh.castShadow = true;
    this.tiles.mesh.receiveShadow = true;
    this.group.add(this.tiles.mesh);
    for (const r of ROADS.classes) this.colours.set(r.code, new Color(r.colour));
  }

  /** Force a rebuild on the next update (e.g. after loading a different game). */
  invalidate(): void {
    this.builtRev = -1;
    this.builtTerrainRev = -1;
  }

  update(snap: SimSnapshot): void {
    const { road, terrain } = snap.revisions;
    if (road === this.builtRev && terrain === this.builtTerrainRev) return;
    this.builtRev = road;
    this.builtTerrainRev = terrain;
    const w = snap.world;
    this.tiles.begin();
    for (let i = 0; i < w.road.length; i++) {
      const code = w.road[i]!;
      if (code === 0) continue;
      const y = w.terrain[i] === Terrain.Water ? BRIDGE_DECK_Y : ROAD_Y;
      this.tiles.add(i, y, this.colours.get(code) ?? '#ff00ff');
    }
    this.tiles.end();
  }
}
