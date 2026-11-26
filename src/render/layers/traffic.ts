/**
 * Traffic on the map: cosmetic cars sampled from the assigned flows (they are
 * not agents: each road tile shows a few cars in proportion to its flow,
 * looping along the road at the congested speed) and the traffic overlay
 * (road tiles coloured by volume / capacity on a colour-blind-safe sequential
 * ramp, closures in dark grey and lane closures in lilac).
 */
import { Color, Group, Matrix4, MeshBasicMaterial, MeshLambertMaterial } from 'three';
import { FAULT, TRAFFIC, Terrain } from '../../sim';
import type { SimSnapshot } from '../../sim';
import { InstanceBatch } from './instanceBatch';
import { unitBox } from './shapes';

const RAMP = TRAFFIC.overlay.ramp.map((c) => new Color(c));
const RAMP_MAX = TRAFFIC.overlay.rampMaxRatio;
const CAR_COLOURS = ['#d8d8d8', '#3a3f47', '#9c2b2b', '#2b4f8c', '#e3e3e3', '#6b6f75', '#c9a227'];
const REBUILD_INTERVAL_MS = 500;
/** Tiles per real second a car covers at free flow and 1× speed (cosmetic). */
const CAR_SPEED = 0.9;

/** Overlay colour for a volume / capacity ratio (shared with the HUD legend). */
export function trafficColour(ratio: number, out = new Color()): Color {
  const t = Math.max(0, Math.min(1, ratio / RAMP_MAX)) * (RAMP.length - 1);
  const k = Math.min(RAMP.length - 2, Math.floor(t));
  return out.copy(RAMP[k]!).lerp(RAMP[k + 1]!, t - k);
}

interface Car {
  tile: number;
  /** Along x (true) or along z. */
  alongX: boolean;
  /** +1 or -1: direction of travel; also picks the lane side. */
  dir: number;
  phase: number;
  /** Tiles per second at 1×. */
  speed: number;
  y: number;
}

const hash = (n: number): number => {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export class TrafficLayer {
  readonly group = new Group();
  private readonly overlay = new Group();
  private readonly cars: InstanceBatch;
  private readonly tiles: InstanceBatch;
  private readonly m = new Matrix4();
  private readonly c = new Color();
  private list: Car[] = [];
  private carKey = '';
  private overlayKey = '';
  private lastBuild = -Infinity;
  private clock = 0;
  /** Sim speed multiplier (0 when paused): cars stop when the game does. */
  timeScale = 1;

  constructor(private readonly mapWidth: number) {
    this.cars = new InstanceBatch(this.group, unitBox(), new MeshLambertMaterial(), 512, false);
    this.group.add(this.overlay);
    this.tiles = new InstanceBatch(this.overlay, unitBox(), new MeshBasicMaterial(), 1024, false);
    this.overlay.visible = false;
  }

  setCarsVisible(on: boolean): void {
    this.carsOn = on;
    this.carKey = '';
  }

  private carsOn = true;

  get overlayVisible(): boolean {
    return this.overlay.visible;
  }

  setOverlay(on: boolean): void {
    this.overlay.visible = on;
    if (on) this.overlayKey = '';
  }

  invalidate(): void {
    this.carKey = '';
    this.overlayKey = '';
    this.lastBuild = -Infinity;
  }

  update(snap: SimSnapshot, dt: number, now: number): void {
    const r = snap.revisions;
    const key = `${r.traffic}:${r.road}:${r.assets}`;
    if (key !== this.carKey && (this.carKey === '' || now - this.lastBuild > REBUILD_INTERVAL_MS)) {
      this.carKey = key;
      this.lastBuild = now;
      this.buildCars(snap);
    }
    if (this.overlay.visible && key !== this.overlayKey) {
      this.overlayKey = key;
      this.buildOverlay(snap);
    }
    this.clock += dt * Math.min(2, this.timeScale);
    this.moveCars();
  }

  private buildCars(snap: SimSnapshot): void {
    if (!this.carsOn) {
      this.list = [];
      this.cars.begin();
      this.cars.end();
      return;
    }
    const w = snap.world;
    const tc = snap.trafficCache;
    const faults = snap.faults.tile;
    const { pcuPerCar, maxPerTile, maxCars } = TRAFFIC.cars;
    const list: Car[] = [];
    const road = (t: number) => t >= 0 && t < w.road.length && w.road[t] !== 0;
    for (let t = 0; t < w.road.length && list.length < maxCars; t++) {
      const flow = w.traffic[t]!;
      if (flow <= 0 || w.road[t] === 0 || faults[t]! & FAULT.ROAD_CLOSED) continue;
      const x = t % w.width;
      const horiz = (x > 0 && road(t - 1)) || (x < w.width - 1 && road(t + 1));
      const vert = road(t - w.width) || road(t + w.width);
      const alongX = horiz || !vert;
      const want = flow / pcuPerCar;
      const n = Math.min(maxPerTile, Math.floor(want + hash(t * 7 + 1)));
      const free = tc.freeSec[t]!;
      const time = tc.timeSec[t]!;
      const slow = free > 0 && time < Infinity ? free / time : 1;
      const y = w.terrain[t] === Terrain.Water ? 0.32 : 0.1;
      for (let k = 0; k < n; k++) {
        list.push({
          tile: t,
          alongX,
          dir: k % 2 === 0 ? 1 : -1,
          phase: hash(t * 31 + k * 977),
          speed: CAR_SPEED * slow * (0.8 + 0.4 * hash(t + k * 13)),
          y,
        });
      }
    }
    this.list = list;
    this.cars.begin();
    for (let i = 0; i < list.length; i++) {
      const colour = CAR_COLOURS[Math.floor(hash(list[i]!.tile * 3 + i) * CAR_COLOURS.length)]!;
      this.cars.add(this.m.identity(), this.c.set(colour));
    }
    this.cars.end();
  }

  private moveCars(): void {
    const width = this.mapWidth;
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const car = list[i]!;
      const x0 = car.tile % width;
      const z0 = Math.floor(car.tile / width);
      const f = (((car.phase + this.clock * car.speed * car.dir) % 1) + 1) % 1;
      const lane = 0.16 * car.dir;
      const px = car.alongX ? x0 + f : x0 + 0.5 + lane;
      const pz = car.alongX ? z0 + 0.5 + lane : z0 + f;
      const sx = car.alongX ? 0.3 : 0.16;
      const sz = car.alongX ? 0.16 : 0.3;
      this.m.makeScale(sx, 0.12, sz).setPosition(px, car.y, pz);
      this.cars.mesh.setMatrixAt(i, this.m);
    }
    if (list.length > 0) this.cars.mesh.instanceMatrix.needsUpdate = true;
  }

  private buildOverlay(snap: SimSnapshot): void {
    const w = snap.world;
    const tc = snap.trafficCache;
    const faults = snap.faults.tile;
    const closed = new Color(TRAFFIC.overlay.closed);
    const lane = new Color(TRAFFIC.overlay.lane);
    this.tiles.begin();
    for (let t = 0; t < w.road.length; t++) {
      if (w.road[t] === 0) continue;
      const f = faults[t]!;
      let colour: Color;
      if (f & FAULT.ROAD_CLOSED) colour = closed;
      else {
        const cap = tc.capacity[t]!;
        colour = trafficColour(cap > 0 ? w.traffic[t]! / cap : 0, this.c);
        if (f & FAULT.LANE_CLOSED) colour = lane;
      }
      const y = w.terrain[t] === Terrain.Water ? 0.3 : 0.08;
      this.m
        .makeScale(0.92, 0.04, 0.92)
        .setPosition((t % w.width) + 0.5, y, Math.floor(t / w.width) + 0.5);
      this.tiles.add(this.m, colour);
    }
    this.tiles.end();
  }
}
