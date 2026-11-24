/**
 * A growable InstancedMesh: call begin(), add() any number of instances, then
 * end(). Capacity grows (the mesh is replaced) when a rebuild needs more room,
 * so callers never need to count instances up front.
 */
import { Color, InstancedMesh, Matrix4 } from 'three';
import type { BufferGeometry, Group, Material } from 'three';

export class InstanceBatch {
  mesh: InstancedMesh;
  private n = 0;
  private readonly c = new Color();

  constructor(
    private readonly group: Group,
    private readonly geometry: BufferGeometry,
    private readonly material: Material,
    capacity = 256,
    private readonly shadows = true,
  ) {
    this.mesh = this.create(capacity);
  }

  private create(capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(this.geometry, this.material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = this.shadows;
    mesh.receiveShadow = this.shadows;
    this.group.add(mesh);
    return mesh;
  }

  begin(): void {
    this.n = 0;
  }

  get count(): number {
    return this.n;
  }

  add(matrix: Matrix4, colour?: Color | string): number {
    if (this.n >= this.mesh.instanceMatrix.count) this.grow();
    this.mesh.setMatrixAt(this.n, matrix);
    if (colour !== undefined) {
      this.mesh.setColorAt(this.n, typeof colour === 'string' ? this.c.set(colour) : colour);
    }
    return this.n++;
  }

  /** Replace one instance's matrix (for animation) after end(). */
  setMatrix(index: number, matrix: Matrix4): void {
    this.mesh.setMatrixAt(index, matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private grow(): void {
    const old = this.mesh;
    const next = this.create(Math.ceil(old.instanceMatrix.count * 1.6) + 64);
    const m = new Matrix4();
    for (let i = 0; i < this.n; i++) {
      old.getMatrixAt(i, m);
      next.setMatrixAt(i, m);
      if (old.instanceColor) {
        old.getColorAt(i, this.c);
        next.setColorAt(i, this.c);
      }
    }
    this.group.remove(old);
    old.dispose();
    this.mesh = next;
  }
}
