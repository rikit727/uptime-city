/**
 * Power lines (a pylon per line tile, cables to neighbouring line tiles) and
 * street lamps along roads. Lamps glow at night where an energised substation
 * covers the road and its island has power to give.
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshLambertMaterial,
} from 'three';
import { lineTypeByCode } from '../../sim';
import type { SimSnapshot } from '../../sim';
import { InstanceBatch } from './instanceBatch';
import { unitBox } from './shapes';

/** Pylons stand near a tile corner so cables run beside roads rather than over them. */
const OFFSET = 0.82;
const PYLON_HEIGHT: Record<number, number> = { 1: 0.55, 2: 1.1 };
const LAMP_HEIGHT = 0.22;

export class PowerLayer {
  readonly group = new Group();
  private readonly pylons: InstanceBatch;
  private readonly arms: InstanceBatch;
  private readonly lampPosts: InstanceBatch;
  private readonly lampsLit: InstanceBatch;
  private readonly lampsDark: InstanceBatch;
  private readonly lampMaterial: MeshLambertMaterial;
  private cables: LineSegments | null = null;
  private readonly m = new Matrix4();
  private builtLines = -1;
  private builtLamps = '';

  constructor() {
    const grey = new MeshLambertMaterial({ color: '#b9bdc1' });
    this.pylons = new InstanceBatch(this.group, unitBox(), grey, 256);
    this.arms = new InstanceBatch(this.group, unitBox(), grey, 256);
    this.lampPosts = new InstanceBatch(
      this.group,
      unitBox(),
      new MeshLambertMaterial({ color: '#4a4f55' }),
      512,
      false,
    );
    this.lampMaterial = new MeshLambertMaterial({
      color: '#d9d4c0',
      emissive: '#ffcf70',
      emissiveIntensity: 0,
    });
    this.lampsLit = new InstanceBatch(this.group, unitBox(), this.lampMaterial, 512, false);
    this.lampsDark = new InstanceBatch(
      this.group,
      unitBox(),
      new MeshLambertMaterial({ color: '#6c6f73' }),
      64,
      false,
    );
  }

  invalidate(): void {
    this.builtLines = -1;
    this.builtLamps = '';
  }

  update(snap: SimSnapshot, night: number): void {
    if (snap.revisions.power !== this.builtLines) {
      this.builtLines = snap.revisions.power;
      this.rebuildLines(snap);
    }
    const r = snap.revisions;
    // Island supply can change without a revision (e.g. solar at dusk): also refresh hourly.
    const lampKey = `${r.road}:${r.power}:${r.supply}:${Math.floor(snap.minute / 60)}`;
    if (lampKey !== this.builtLamps) {
      this.builtLamps = lampKey;
      this.rebuildLamps(snap);
    }
    this.lampMaterial.emissiveIntensity = 1.2 * night;
  }

  private rebuildLines(snap: SimSnapshot): void {
    const w = snap.world;
    this.pylons.begin();
    this.arms.begin();
    const pts: number[] = [];
    const colours: number[] = [];
    const topOf = (code: number) => PYLON_HEIGHT[code] ?? 0.6;
    for (let i = 0; i < w.power.length; i++) {
      const code = w.power[i]!;
      if (code === 0) continue;
      const x = (i % w.width) + OFFSET;
      const z = Math.floor(i / w.width) + OFFSET;
      const h = topOf(code);
      const thick = code === 2 ? 0.07 : 0.045;
      this.m.makeScale(thick, h, thick).setPosition(x, 0, z);
      this.pylons.add(this.m);
      this.m.makeScale(0.32, 0.03, 0.05).setPosition(x, h - 0.06, z);
      this.arms.add(this.m);
      const def = lineTypeByCode(code);
      const rgb = hexToRgb(def?.colour ?? '#999999');
      for (const nb of [i + 1, i + w.width]) {
        if (nb === i + 1 && (i + 1) % w.width === 0) continue;
        const other = w.power[nb] ?? 0;
        if (other === 0) continue;
        const h2 = topOf(other);
        const x2 = (nb % w.width) + OFFSET;
        const z2 = Math.floor(nb / w.width) + OFFSET;
        pts.push(x, h - 0.05, z, x2, h2 - 0.05, z2);
        colours.push(...rgb, ...rgb);
      }
    }
    this.pylons.end();
    this.arms.end();
    if (this.cables) {
      this.group.remove(this.cables);
      this.cables.geometry.dispose();
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pts, 3));
    g.setAttribute('color', new Float32BufferAttribute(colours, 3));
    this.cables = new LineSegments(g, new LineBasicMaterial({ vertexColors: true }));
    this.group.add(this.cables);
  }

  private rebuildLamps(snap: SimSnapshot): void {
    const w = snap.world;
    const net = snap.network;
    const islandHasPower = new Map<number, boolean>();
    for (const isl of snap.power.islands) islandHasPower.set(isl.id, isl.availableMW > 0);
    this.lampPosts.begin();
    this.lampsLit.begin();
    this.lampsDark.begin();
    for (let i = 0; i < w.road.length; i++) {
      if (w.road[i] === 0 || w.terrain[i] !== 0) continue;
      const tx = i % w.width;
      const ty = Math.floor(i / w.width);
      if ((tx + 2 * ty) % 3 !== 0) continue;
      const x = tx + 0.12;
      const z = ty + 0.12;
      this.m.makeScale(0.03, LAMP_HEIGHT, 0.03).setPosition(x, 0, z);
      this.lampPosts.add(this.m);
      const sub = net.coverage[i] ?? 0;
      const on =
        sub !== 0 &&
        (net.feedMW.get(sub) ?? 0) > 0 &&
        islandHasPower.get(net.islandOf.get(sub) ?? -1) === true;
      this.m.makeScale(0.08, 0.04, 0.08).setPosition(x, LAMP_HEIGHT, z);
      (on ? this.lampsLit : this.lampsDark).add(this.m);
    }
    this.lampPosts.end();
    this.lampsLit.end();
    this.lampsDark.end();
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
