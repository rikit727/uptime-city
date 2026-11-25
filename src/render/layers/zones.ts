/** Zoned (not yet built) land, drawn as flat coloured tiles by zone type and density. */
import { Color, Group } from 'three';
import type { MeshLambertMaterial } from 'three';
import { ZONES, densityByCodeOf } from '../../sim';
import type { SimSnapshot } from '../../sim';
import { TileInstances } from './tileInstances';

export class ZoneLayer {
  readonly group = new Group();
  private readonly tiles: TileInstances;
  /** colour by zoneCode * 4 + densityCode */
  private readonly colours = new Map<number, Color>();
  private builtRev = -1;

  constructor(width: number, height: number) {
    this.tiles = new TileInstances(width * height, width, 0.9, 0.02);
    this.tiles.mesh.receiveShadow = true;
    this.group.add(this.tiles.mesh);
    for (const z of ZONES.types) {
      for (let d = 0; d <= 3; d++) {
        const id = densityByCodeOf(d)?.id ?? 'low';
        this.colours.set(z.code * 4 + d, new Color(z.colours[id]));
      }
    }
  }

  /** Dim zoning so an overlay stands out. */
  setDim(on: boolean): void {
    (this.tiles.mesh.material as MeshLambertMaterial).color.set(on ? '#5a5a5a' : '#ffffff');
  }

  /** Force a rebuild on the next update (e.g. after loading a different game). */
  invalidate(): void {
    this.builtRev = -1;
  }

  update(snap: SimSnapshot): void {
    if (snap.revisions.zone === this.builtRev) return;
    this.builtRev = snap.revisions.zone;
    const w = snap.world;
    this.tiles.begin();
    for (let i = 0; i < w.zone.length; i++) {
      const z = w.zone[i]!;
      if (z === 0) continue;
      this.tiles.add(i, 0.015, this.colours.get(z * 4 + w.density[i]!) ?? '#ff00ff');
    }
    this.tiles.end();
  }
}
