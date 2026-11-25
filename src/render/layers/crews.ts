/**
 * Crews and incidents on the map: crew vans driving along their routes
 * (coloured by crew type), a marker over every open incident (taller and
 * redder with severity) and barriers around sites where a crew is working.
 * Vans move every frame; markers and barriers rebuild when work changes.
 */
import { Color, Group, Matrix4, MeshLambertMaterial } from 'three';
import { buildingDef, crewPosition, isOpen } from '../../sim';
import type { CrewType, SimSnapshot } from '../../sim';
import { InstanceBatch } from './instanceBatch';
import { unitBox, unitCylinder } from './shapes';

const VAN_COLOURS: Record<CrewType, string> = {
  roads: '#e8a33d',
  water: '#3d85c6',
  power: '#f1c232',
  fire: '#d62728',
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
  private readonly flames: InstanceBatch;
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
    this.flames = new InstanceBatch(
      this.group,
      unitBox(),
      new MeshLambertMaterial({ emissive: '#ff5a00', emissiveIntensity: 0.8 }),
      8,
      false,
    );
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
    this.updateFlames(snap, now);
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

  /** Flickering flames over burning buildings, taller as more of the building is alight. */
  private updateFlames(snap: SimSnapshot, now: number): void {
    this.flames.begin();
    for (const f of snap.fires) {
      const b = snap.buildingById.get(f.building);
      const def = b ? buildingDef(b.code) : undefined;
      if (!b || !def) continue;
      const [fw, fd] = def.footprint;
      const k = f.intensity / 100;
      for (let i = 0; i < 3; i++) {
        const flicker = 0.75 + 0.25 * Math.sin(now / 90 + i * 2.1 + f.id);
        const hgt = (0.3 + 1.4 * k) * flicker;
        const sx = fw * (0.25 + 0.35 * k);
        const sz = fd * (0.25 + 0.35 * k);
        const ox = (i - 1) * 0.18 * fw;
        this.m.makeScale(sx / 2, hgt, sz / 2).setPosition(b.x + fw / 2 + ox, 0.3, b.y + fd / 2);
        this.flames.add(this.m, this.c.set(i === 1 ? '#ffb000' : '#e6550d'));
      }
    }
    this.flames.end();
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
