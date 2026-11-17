/**
 * A reusable "one flat box per tile" InstancedMesh with per-instance colours,
 * sized for the whole map so it never needs reallocating.
 */
import { BoxGeometry, Color, InstancedMesh, Matrix4, MeshLambertMaterial } from 'three';
import type { Material } from 'three';

export class TileInstances {
  readonly mesh: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly c = new Color();
  private n = 0;

  constructor(
    capacity: number,
    private readonly mapWidth: number,
    size: number,
    thickness: number,
    material: Material = new MeshLambertMaterial({ color: '#ffffff' }),
  ) {
    this.mesh = new InstancedMesh(new BoxGeometry(size, thickness, size), material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  begin(): void {
    this.n = 0;
  }

  add(tileIndex: number, y: number, colour: Color | string): void {
    const x = (tileIndex % this.mapWidth) + 0.5;
    const z = Math.floor(tileIndex / this.mapWidth) + 0.5;
    this.m.makeTranslation(x, y, z);
    this.mesh.setMatrixAt(this.n, this.m);
    this.mesh.setColorAt(this.n, typeof colour === 'string' ? this.c.set(colour) : colour);
    this.n++;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
