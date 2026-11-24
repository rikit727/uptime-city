/**
 * Owns the Three.js scene. Reads sim snapshots only; never mutates the sim.
 * Each layer rebuilds itself when the matching revision counter changes.
 */
import { PCFSoftShadowMap, Plane, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { daylight } from '../sim';
import type { SimSnapshot } from '../sim';
import { CameraRig } from './cameraRig';
import { BuildingLayer } from './layers/buildings';
import { PowerLayer } from './layers/power';
import { PreviewLayer } from './layers/preview';
import type { PreviewTiles } from './layers/preview';
import { RoadLayer } from './layers/roads';
import { TerrainLayer } from './layers/terrain';
import { ZoneLayer } from './layers/zones';
import { Lighting } from './lighting';

export type { PreviewTiles } from './layers/preview';

export class GameRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly rig: CameraRig;
  private readonly lighting: Lighting;
  private readonly terrain: TerrainLayer;
  private readonly roads: RoadLayer;
  private readonly zones: ZoneLayer;
  private readonly buildings: BuildingLayer;
  private readonly power: PowerLayer;
  private readonly preview: PreviewLayer;
  private readonly raycaster = new Raycaster();
  private readonly groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly ndc = new Vector2();
  private readonly hit = new Vector3();

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly mapWidth: number,
    readonly mapHeight: number,
  ) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.rig = new CameraRig(1, { width: mapWidth, height: mapHeight });
    this.lighting = new Lighting(this.scene, { x: mapWidth / 2, z: mapHeight / 2 });
    this.terrain = new TerrainLayer(mapWidth, mapHeight);
    this.roads = new RoadLayer(mapWidth, mapHeight);
    this.zones = new ZoneLayer(mapWidth, mapHeight);
    this.buildings = new BuildingLayer(mapWidth, mapHeight);
    this.power = new PowerLayer();
    this.preview = new PreviewLayer(mapWidth, mapHeight);
    this.scene.add(
      this.terrain.group,
      this.zones.group,
      this.roads.group,
      this.buildings.group,
      this.power.group,
      this.preview.group,
    );
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.rig.setAspect(w / h);
  }

  setShadows(enabled: boolean): void {
    this.renderer.shadowMap.enabled = enabled;
    this.lighting.setShadows(enabled);
  }

  setGridVisible(v: boolean): void {
    this.terrain.setGridVisible(v);
  }

  setPreview(p: PreviewTiles | null): void {
    this.preview.show(p);
  }

  setCursor(tile: number | null): void {
    this.preview.setCursor(tile);
  }

  /** Tile index under a screen point, or null if off the map. */
  pickTile(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.rig.camera);
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, this.hit)) return null;
    const x = Math.floor(this.hit.x);
    const y = Math.floor(this.hit.z);
    if (x < 0 || y < 0 || x >= this.mapWidth || y >= this.mapHeight) return null;
    return y * this.mapWidth + x;
  }

  /** Rebuild every layer on the next frame (call after swapping in a new Simulation). */
  invalidate(): void {
    this.terrain.invalidate();
    this.roads.invalidate();
    this.zones.invalidate();
    this.buildings.invalidate();
    this.power.invalidate();
    this.preview.show(null);
  }

  /** Draw a frame. `dt` is real seconds since the last frame (for animation). */
  render(snap: SimSnapshot, dt = 0): void {
    const night = 1 - daylight(snap.minute);
    this.terrain.update(snap);
    this.roads.update(snap);
    this.zones.update(snap);
    this.buildings.update(snap, night, dt, performance.now());
    this.power.update(snap, night);
    this.lighting.update(snap.minute, snap.weather.cloud);
    this.renderer.render(this.scene, this.rig.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
