/**
 * The water pressure overlay: every main tile drawn as a flat strip coloured by
 * its pressure (colour-blind-safe viridis ramp, dark = no water), thicker for
 * larger mains, with water-facility footprints outlined. Hidden unless the
 * overlay is on; mains are underground otherwise.
 */
import { Color, Group, Matrix4, MeshBasicMaterial } from 'three';
import { WATER, mainTypeByCode, waterDefOf } from '../../sim';
import type { SimSnapshot } from '../../sim';
import { InstanceBatch } from './instanceBatch';
import { unitBox } from './shapes';

/** Viridis stops from 0 m to `rampMaxM` (water.json `overlay`). */
const STOPS = WATER.overlay.ramp.map((c) => new Color(c));
const RAMP_MAX_M = WATER.overlay.rampMaxM;
const REBUILD_INTERVAL_MS = 400;

/** Colour for a pressure in metres (shared with the HUD legend). */
export function pressureColour(m: number, out = new Color()): Color {
  const t = Math.max(0, Math.min(1, m / RAMP_MAX_M)) * (STOPS.length - 1);
  const k = Math.min(STOPS.length - 2, Math.floor(t));
  return out.copy(STOPS[k]!).lerp(STOPS[k + 1]!, t - k);
}

export class WaterLayer {
  readonly group = new Group();
  private readonly pipes: InstanceBatch;
  private readonly pads: InstanceBatch;
  private readonly m = new Matrix4();
  private readonly c = new Color();
  private builtKey = '';
  private lastBuild = -Infinity;

  constructor() {
    this.pipes = new InstanceBatch(this.group, unitBox(), new MeshBasicMaterial(), 1024, false);
    this.pads = new InstanceBatch(
      this.group,
      unitBox(),
      new MeshBasicMaterial({ color: '#d9e6f2', transparent: true, opacity: 0.55 }),
      32,
      false,
    );
    this.group.visible = false;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  setVisible(on: boolean): void {
    this.group.visible = on;
    if (on) this.builtKey = '';
  }

  invalidate(): void {
    this.builtKey = '';
    this.lastBuild = -Infinity;
  }

  update(snap: SimSnapshot, now: number): void {
    if (!this.group.visible) return;
    const r = snap.revisions;
    const key = `${r.water}:${r.building}`;
    if (key === this.builtKey) return;
    if (this.builtKey !== '' && now - this.lastBuild < REBUILD_INTERVAL_MS) return;
    this.builtKey = key;
    this.lastBuild = now;
    this.rebuild(snap);
  }

  private rebuild(snap: SimSnapshot): void {
    const w = snap.world;
    this.pipes.begin();
    for (let i = 0; i < w.water.length; i++) {
      const code = w.water[i]!;
      if (code === 0) continue;
      const main = mainTypeByCode(code);
      const size = main ? 0.55 + Math.min(0.35, main.diameterMm / 1700) : 0.55;
      const x = (i % w.width) + 0.5;
      const z = Math.floor(i / w.width) + 0.5;
      this.m.makeScale(size, 0.05, size).setPosition(x, 0.06, z);
      this.pipes.add(this.m, pressureColour(w.pressure[i]!, this.c));
    }
    this.pipes.end();
    this.pads.begin();
    for (const b of snap.buildings) {
      const def = waterDefOf(b);
      if (!def) continue;
      const [fw, fd] = def.footprint;
      this.m.makeScale(fw - 0.1, 0.04, fd - 0.1).setPosition(b.x + fw / 2, 0.05, b.y + fd / 2);
      this.pads.add(this.m);
    }
    this.pads.end();
  }
}
