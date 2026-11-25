/**
 * Buildings and facilities, drawn from the model parts in the data files
 * (buildings.json, power.json) with one InstancedMesh per primitive shape.
 * Window bands go into a lit (emissive at night) or unlit batch depending on
 * whether the building has power, so outages show after dark. Farms draw their
 * footprint as field tiles coloured by farm type and season. Wind turbine
 * rotors spin with their output.
 */
import { Color, Euler, Group, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from 'three';
import { BUILDINGS, buildingDef, seasonOf } from '../../sim';
import type { BuildingDef, ModelPart, PartShape, SimSnapshot } from '../../sim';
import { InstanceBatch } from './instanceBatch';
import { unitBox, unitCylinder, unitGable, unitRotor, unitTunnel } from './shapes';
import { TileInstances } from './tileInstances';

/** Rebuilds happen at most this often while the city is growing (ms). */
const REBUILD_INTERVAL_MS = 300;
const WINDOW_GLASS = '#33414f';
const WINDOW_LIGHT = '#ffd27a';
const BAND_SPACING = 0.22;
const BAND_HEIGHT = 0.06;

/** Small deterministic hash for per-building variation (render only). */
function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  return (h ^ (h >>> 12)) >>> 0;
}

interface Rotor {
  index: number;
  position: Vector3;
  scale: Vector3;
  buildingId: number;
  capacityMW: number;
  angle: number;
}

export class BuildingLayer {
  readonly group = new Group();
  private readonly batches: Record<Exclude<PartShape, 'rotor'>, InstanceBatch>;
  private readonly rotors: InstanceBatch;
  private readonly windowsLit: InstanceBatch;
  private readonly windowsDark: InstanceBatch;
  private readonly litMaterial: MeshLambertMaterial;
  private readonly fields: TileInstances;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly pos = new Vector3();
  private readonly scl = new Vector3();
  private readonly colourCache = new Map<string, Color>();
  private rotorList: Rotor[] = [];
  private builtKey = '';
  private lastBuild = -Infinity;

  constructor(width: number, height: number) {
    const mat = () => new MeshLambertMaterial({ color: '#ffffff' });
    this.batches = {
      box: new InstanceBatch(this.group, unitBox(), mat(), 1024),
      gable: new InstanceBatch(this.group, unitGable(), mat(), 512),
      cylinder: new InstanceBatch(this.group, unitCylinder(), mat(), 128),
      tunnel: new InstanceBatch(this.group, unitTunnel(), mat(), 64),
    };
    this.rotors = new InstanceBatch(this.group, unitRotor(), mat(), 32);
    this.litMaterial = new MeshLambertMaterial({
      color: WINDOW_GLASS,
      emissive: WINDOW_LIGHT,
      emissiveIntensity: 0,
    });
    this.windowsLit = new InstanceBatch(this.group, unitBox(), this.litMaterial, 1024, false);
    this.windowsDark = new InstanceBatch(
      this.group,
      unitBox(),
      new MeshLambertMaterial({ color: WINDOW_GLASS }),
      256,
      false,
    );
    this.fields = new TileInstances(width * height, width, 0.98, 0.02);
    this.fields.mesh.receiveShadow = true;
    this.group.add(this.fields.mesh);
  }

  invalidate(): void {
    this.builtKey = '';
    this.lastBuild = -Infinity;
  }

  private colour(c: string): Color {
    let col = this.colourCache.get(c);
    if (!col) {
      col = new Color(c);
      this.colourCache.set(c, col);
    }
    return col;
  }

  /**
   * Rebuild when buildings, supply or the season change (throttled), and set
   * the window glow for the time of day. `night` is 0 by day and 1 at night.
   */
  update(snap: SimSnapshot, night: number, dt: number, now: number): void {
    const r = snap.revisions;
    const key = `${r.building}:${r.supply}:${r.power}:${seasonOf(snap.minute)}`;
    if (
      key !== this.builtKey &&
      (this.builtKey === '' || now - this.lastBuild > REBUILD_INTERVAL_MS)
    ) {
      this.builtKey = key;
      this.lastBuild = now;
      this.rebuild(snap);
    }
    this.litMaterial.emissiveIntensity = 0.95 * night;
    this.spinRotors(snap, dt);
  }

  private rebuild(snap: SimSnapshot): void {
    const w = snap.world;
    for (const b of Object.values(this.batches)) b.begin();
    this.windowsLit.begin();
    this.windowsDark.begin();
    this.rotors.begin();
    this.fields.begin();
    this.rotorList = [];
    const season = seasonOf(snap.minute);
    for (const b of snap.buildings) {
      const def = buildingDef(b.code);
      if (!def) continue;
      const grown = def.role === 'grown' ? def : undefined;
      const jitter = grown ? grown.heightJitter : 0;
      const vary = 1 + jitter * ((hash(b.id, 99) / 4294967296) * 2 - 1);
      const lit = b.unpoweredMinutes === 0 && b.occupancy > 0.05;
      if (grown?.fields) {
        const fieldColour = this.colour(BUILDINGS.fieldColours[grown.fields][season]);
        const [fw, fd] = def.footprint;
        for (let dy = 0; dy < fd; dy++)
          for (let dx = 0; dx < fw; dx++)
            this.fields.add((b.y + dy) * w.width + b.x + dx, 0.03, fieldColour);
      }
      def.parts.forEach((p, k) => this.addPart(b.id, b.x, b.y, def, p, k, vary, lit));
    }
    for (const b of Object.values(this.batches)) b.end();
    this.windowsLit.end();
    this.windowsDark.end();
    this.rotors.end();
    this.fields.end();
  }

  private addPart(
    id: number,
    bx: number,
    by: number,
    def: BuildingDef,
    p: ModelPart,
    k: number,
    vary: number,
    lit: boolean,
  ): void {
    const colours = Array.isArray(p.colour) ? p.colour : [p.colour];
    const colour = this.colour(colours[hash(id, k) % colours.length]!);
    const y0 = (p.y ?? 0) * vary;
    const h = p.h * vary;
    const cx = bx + p.x;
    const cz = by + p.z;
    if (p.shape === 'rotor') {
      this.pos.set(cx, y0, cz);
      this.scl.set(p.w, p.h, 1);
      this.m.compose(this.pos, this.q.identity(), this.scl);
      const index = this.rotors.add(this.m, colour);
      const cap = def.role === 'facility' ? def.capacityMW : 1;
      this.rotorList.push({
        index,
        position: this.pos.clone(),
        scale: this.scl.clone(),
        buildingId: id,
        capacityMW: cap,
        angle: (hash(id, 7) / 4294967296) * Math.PI * 2,
      });
      return;
    }
    this.m.makeScale(p.w, h, p.d).setPosition(cx, y0, cz);
    this.batches[p.shape].add(this.m, colour);
    if (!p.windows) return;
    const bands = Math.max(1, Math.floor(h / BAND_SPACING));
    const target = lit ? this.windowsLit : this.windowsDark;
    for (let i = 0; i < bands; i++) {
      const y = y0 + ((i + 0.55) * h) / bands - BAND_HEIGHT / 2;
      this.m.makeScale(p.w + 0.02, BAND_HEIGHT, p.d + 0.02).setPosition(cx, y, cz);
      target.add(this.m);
    }
  }

  private spinRotors(snap: SimSnapshot, dt: number): void {
    if (this.rotorList.length === 0) return;
    for (const r of this.rotorList) {
      const out = snap.outputMW.get(r.buildingId) ?? 0;
      const speed = 0.4 + 3.2 * Math.min(1, out / Math.max(0.1, r.capacityMW));
      r.angle = (r.angle + (out > 0 ? speed : 0) * dt) % (Math.PI * 2);
      this.e.set(0, 0, r.angle);
      this.m.compose(r.position, this.q.setFromEuler(this.e), r.scale);
      this.rotors.setMatrix(r.index, this.m);
    }
  }
}
