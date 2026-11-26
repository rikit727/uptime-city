/**
 * The tile overlays (power, wastewater, roadworks, condition, service cover,
 * air, noise, land value): one flat coloured tile per value from
 * `snapshot.city.overlay()`, coloured from `overlays.json` (colour-blind-safe
 * ramps, Okabe-Ito categories). Drawn on top of the scene (no depth test), so
 * tiles under buildings show through. Water pressure and traffic have their
 * own layers (water.ts, traffic.ts).
 */
import { Color, Group, Matrix4, MeshBasicMaterial } from 'three';
import { Terrain, overlayDef } from '../../sim';
import type { OverlayId, SimSnapshot, TileOverlayId } from '../../sim';
import { InstanceBatch } from './instanceBatch';
import { unitBox } from './shapes';

const REBUILD_INTERVAL_MS = 500;

export class OverlayLayer {
  readonly group = new Group();
  private readonly tiles: InstanceBatch;
  private readonly m = new Matrix4();
  private readonly c = new Color();
  private values: Float32Array;
  private id: TileOverlayId | null = null;
  private key = '';
  private lastBuild = -Infinity;
  private ramp: Color[] = [];
  private categories: Color[] = [];

  constructor(size: number) {
    this.values = new Float32Array(size);
    const mat = new MeshBasicMaterial({ transparent: true, opacity: 0.82, depthTest: false });
    this.tiles = new InstanceBatch(this.group, unitBox(), mat, 4096, false);
    this.tiles.mesh.renderOrder = 10;
    this.group.visible = false;
  }

  /** Show a tile overlay, or hide (null). */
  setOverlay(id: OverlayId | null): void {
    const tileId = id && id !== 'none' && id !== 'water' && id !== 'traffic' ? id : null;
    this.id = tileId;
    this.group.visible = tileId !== null;
    this.key = '';
    if (tileId) {
      const def = overlayDef(tileId);
      this.ramp = (def.ramp ?? []).map((c) => new Color(c));
      this.categories = (def.categories ?? []).map((c) => new Color(c.colour));
    }
  }

  get current(): TileOverlayId | null {
    return this.id;
  }

  invalidate(): void {
    this.key = '';
    this.lastBuild = -Infinity;
  }

  update(snap: SimSnapshot, now: number): void {
    if (!this.id) return;
    const r = snap.revisions;
    const key = `${this.id}:${r.road}:${r.building}:${r.power}:${r.supply}:${r.water}:${r.assets}:${r.traffic}:${Math.floor(snap.minute / 15)}`;
    if (key === this.key) return;
    if (this.key !== '' && now - this.lastBuild < REBUILD_INTERVAL_MS) return;
    this.key = key;
    this.lastBuild = now;
    this.rebuild(snap);
  }

  private colourOf(v: number): Color | null {
    if (Number.isNaN(v)) return null;
    if (v < 0) return this.categories[-v - 1] ?? null;
    const stops = this.ramp;
    if (stops.length < 2) return null;
    const x = Math.max(0, Math.min(1, v)) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(x));
    return this.c.copy(stops[k]!).lerp(stops[k + 1]!, x - k);
  }

  private rebuild(snap: SimSnapshot): void {
    const w = snap.world;
    if (this.values.length !== w.width * w.height)
      this.values = new Float32Array(w.width * w.height);
    snap.city.overlay(this.id!, this.values);
    this.tiles.begin();
    for (let t = 0; t < this.values.length; t++) {
      const col = this.colourOf(this.values[t]!);
      if (!col) continue;
      const y = w.terrain[t] === Terrain.Water ? 0.32 : 0.09;
      this.m
        .makeScale(0.96, 0.02, 0.96)
        .setPosition((t % w.width) + 0.5, y, Math.floor(t / w.width) + 0.5);
      this.tiles.add(this.m, col);
    }
    this.tiles.end();
  }
}
