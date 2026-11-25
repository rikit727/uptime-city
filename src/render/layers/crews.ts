/**
 * Crews and incidents on the map: crew vans driving along their routes
 * (coloured by crew type), a marker over every open incident (taller and
 * redder with severity) and barriers around sites where a crew is working.
 * Vans move every frame; markers and barriers rebuild when work changes.
 */
import { Color, Group, Matrix4, MeshLambertMaterial } from 'three';
import { crewPosition, isOpen } from '../../sim';
import type { CrewType, SimSnapshot } from '../../sim';
import { InstanceBatch } from './instanceBatch';
import { unitBox, unitCylinder } from './shapes';

const VAN_COLOURS: Record<CrewType, string> = {
  roads: '#e8a33d',
  water: '#3d85c6',
  power: '#f1c232',
};
/** Severity 1..4: light to dark, and taller, so it reads without colour too. */
const SEVERITY_COLOURS = ['#ffffff', '#fde725', '#f68f46', '#d0413e', '#7a0403'];
const BARRIER = '#ff7f0e';

export class CrewLayer {
  readonly group = new Group();
  private readonly vans: InstanceBatch;
  private readonly markers: InstanceBatch;
  private readonly heads: InstanceBatch;
  private readonly barriers: InstanceBatch;
  private readonly m = new Matrix4();
  private readonly c = new Color();
  private builtKey = '';

  constructor() {
    const mat = () => new MeshLambertMaterial();
    this.vans = new InstanceBatch(this.group, unitBox(), mat(), 16, false);
    this.markers = new InstanceBatch(this.group, unitCylinder(), mat(), 16, false);
    this.heads = new InstanceBatch(
      this.group,
      unitBox(),
      new MeshLambertMaterial({ emissive: '#331100' }),
      16,
      false,
    );
    this.barriers = new InstanceBatch(this.group, unitBox(), mat(), 32, false);
  }

  invalidate(): void {
    this.builtKey = '';
  }

  update(snap: SimSnapshot, now: number): void {
    this.updateVans(snap);
    const orders = snap.workOrders.map((o) => `${o.id}${o.status}`).join();
    const open = snap.incidents
      .filter(isOpen)
      .map((i) => `${i.id}:${i.severity}`)
      .join();
    const key = `${orders}|${open}`;
    if (key !== this.builtKey) {
      this.builtKey = key;
      this.rebuildSites(snap);
    }
    // Markers bob gently so they catch the eye.
    this.heads.mesh.position.y = 0.08 * Math.sin(now / 300);
  }

  private updateVans(snap: SimSnapshot): void {
    this.vans.begin();
    for (const crew of snap.crews) {
      if (crew.status === 'idle') continue;
      const p = crewPosition(snap, crew);
      this.m.makeScale(0.32, 0.22, 0.32).setPosition(p.x, 0.04, p.y);
      this.vans.add(this.m, this.c.set(VAN_COLOURS[crew.type]));
    }
    this.vans.end();
  }

  private rebuildSites(snap: SimSnapshot): void {
    const w = snap.world;
    this.markers.begin();
    this.heads.begin();
    for (const inc of snap.incidents) {
      if (!isOpen(inc)) continue;
      const x = (inc.tile % w.width) + 0.5;
      const z = Math.floor(inc.tile / w.width) + 0.5;
      const hgt = 1 + 0.4 * inc.severity;
      const colour = SEVERITY_COLOURS[inc.severity] ?? SEVERITY_COLOURS[4]!;
      this.m.makeScale(0.06, hgt, 0.06).setPosition(x, 0, z);
      this.markers.add(this.m, this.c.set('#ffffff'));
      this.m.makeScale(0.35, 0.35, 0.35).setPosition(x, hgt, z);
      this.heads.add(this.m, this.c.set(colour));
    }
    this.markers.end();
    this.heads.end();
    this.barriers.begin();
    for (const o of snap.workOrders) {
      if (o.status !== 'onSite') continue;
      const x = o.tile % w.width;
      const z = Math.floor(o.tile / w.width);
      for (const [dx, dz, sx, sz] of [
        [0.5, 0.05, 0.9, 0.06],
        [0.5, 0.95, 0.9, 0.06],
        [0.05, 0.5, 0.06, 0.9],
        [0.95, 0.5, 0.06, 0.9],
      ] as const) {
        this.m.makeScale(sx, 0.18, sz).setPosition(x + dx, 0.02, z + dz);
        this.barriers.add(this.m, this.c.set(BARRIER));
      }
    }
    this.barriers.end();
  }
}
