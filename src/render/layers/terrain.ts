/** Ground plane, water tiles and an optional tile grid. */
import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
} from 'three';
import { Terrain } from '../../sim';
import type { SimSnapshot } from '../../sim';

export const GROUND_COLOUR = '#7fa45c';
export const WATER_COLOUR = '#3f7fb3';

export class TerrainLayer {
  readonly group = new Group();
  private water: InstancedMesh | null = null;
  private readonly grid: LineSegments;
  private builtRev = -1;

  constructor(width: number, height: number) {
    const ground = new Mesh(
      new PlaneGeometry(width, height),
      new MeshLambertMaterial({ color: GROUND_COLOUR }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(width / 2, 0, height / 2);
    ground.receiveShadow = true;
    this.group.add(ground);

    const pts: number[] = [];
    for (let x = 0; x <= width; x++) pts.push(x, 0.015, 0, x, 0.015, height);
    for (let z = 0; z <= height; z++) pts.push(0, 0.015, z, width, 0.015, z);
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pts, 3));
    this.grid = new LineSegments(
      g,
      new LineBasicMaterial({ color: '#000000', transparent: true, opacity: 0.08 }),
    );
    this.group.add(this.grid);
  }

  setGridVisible(v: boolean): void {
    this.grid.visible = v;
  }

  /** Force a rebuild on the next update (e.g. after loading a different game). */
  invalidate(): void {
    this.builtRev = -1;
  }

  update(snap: SimSnapshot): void {
    if (snap.revisions.terrain === this.builtRev) return;
    this.builtRev = snap.revisions.terrain;
    const w = snap.world;
    if (this.water) {
      this.group.remove(this.water);
      this.water.dispose();
    }
    let count = 0;
    for (let i = 0; i < w.terrain.length; i++) if (w.terrain[i] === Terrain.Water) count++;
    const mesh = new InstancedMesh(
      new BoxGeometry(1, 0.05, 1),
      new MeshLambertMaterial({ color: WATER_COLOUR }),
      Math.max(1, count),
    );
    const m = new Matrix4();
    let k = 0;
    for (let i = 0; i < w.terrain.length; i++) {
      if (w.terrain[i] !== Terrain.Water) continue;
      m.makeTranslation((i % w.width) + 0.5, 0.0, Math.floor(i / w.width) + 0.5);
      mesh.setMatrixAt(k++, m);
    }
    mesh.count = count;
    mesh.receiveShadow = true;
    this.water = mesh;
    this.group.add(mesh);
  }
}
