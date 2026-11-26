/**
 * Sim profiler (milestone 8): `npm run profile`. Builds the big city
 * (`bigCity.ts`), then runs two game days timing every system on every tick, and
 * times the cache rebuilds, every tile overlay and a save. Prints a table; fails
 * if the 99th-percentile tick goes over twice the 4 ms frame budget, so a
 * regression shows. Not part of `npm test` (it takes ~30 s).
 *
 * Set PROFILE_SAVE=path to also write the big city as a save file for browser
 * profiling (import it from Save / load).
 */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { expect, test } from 'vitest';
import { createSaveFile } from '../../src/platform/saveFormat';
import { rebuildBuildingIndex, residentsOf } from '../../src/sim/buildings';
import { rebuildEstates } from '../../src/sim/estates';
import { rebuildFaults } from '../../src/sim/incidents';
import { overlayValues, TILE_OVERLAYS } from '../../src/sim/overlays';
import { rebuildNetwork } from '../../src/sim/power';
import { serializeState } from '../../src/sim/serialize';
import { rebuildServices } from '../../src/sim/services';
import { SCENARIOS } from '../../src/sim/data';
import { Simulation } from '../../src/sim/simulation';
import { SYSTEMS } from '../../src/sim/systems';
import type { TickContext } from '../../src/sim/systems';
import { MINUTES_PER_DAY } from '../../src/sim/time';
import { rebuildTraffic } from '../../src/sim/traffic';
import { rebuildWater } from '../../src/sim/water';
import { bigCity } from './bigCity';

const DAYS = Number(process.env.PROFILE_DAYS ?? 2);

const ms = (v: number): string => v.toFixed(2).padStart(7);

function timeIt(fn: () => void, runs = 5): { avg: number; max: number } {
  let sum = 0;
  let max = 0;
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    fn();
    const dt = performance.now() - t0;
    sum += dt;
    max = Math.max(max, dt);
  }
  return { avg: sum / runs, max };
}

test('profile a fully built map', { timeout: 600_000 }, () => {
  const t0 = performance.now();
  const sim = bigCity();
  const s = sim.state;
  const roads = s.world.road.reduce((n, r) => n + (r ? 1 : 0), 0);
  const mains = s.world.laid.main.reduce((n, r) => n + (r ? 1 : 0), 0);
  const residents = s.buildings.reduce((n, b) => n + residentsOf(b), 0);
  console.log(
    `Big city built and warmed up in ${((performance.now() - t0) / 1000).toFixed(1)} s: ` +
      `${s.buildings.length} buildings, ${residents} residents, ${roads} road tiles, ${mains} main tiles, ` +
      `${s.cache.network.islands.length} power islands`,
  );
  if (process.env.PROFILE_SAVE) {
    writeFileSync(process.env.PROFILE_SAVE, JSON.stringify(createSaveFile(sim, 'Big city')));
    console.log(`Save written to ${process.env.PROFILE_SAVE}`);
  }

  // ---- per-system timing over DAYS game days --------------------------------------------
  const ctx: TickContext = { state: s, emit: () => {}, touch: () => {} };
  const n = SYSTEMS.length;
  const sum = new Float64Array(n);
  const max = new Float64Array(n);
  const maxAt = new Int32Array(n);
  const per: number[][] = SYSTEMS.map(() => []);
  const ticks = DAYS * MINUTES_PER_DAY;
  const totals: number[] = [];
  const worst: { total: number; minute: number; parts: string }[] = [];
  let rounds = 0;
  let roundTicks = 0;
  for (let k = 0; k < ticks; k++) {
    if (s.traffic.cursor >= 0) roundTicks++;
    const wasRunning = s.traffic.cursor >= 0;
    let total = 0;
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      const a = performance.now();
      SYSTEMS[i]!.tick(ctx);
      const dt = performance.now() - a;
      total += dt;
      sum[i]! += dt;
      per[i]!.push(dt);
      if (dt > max[i]!) {
        max[i] = dt;
        maxAt[i] = s.minute % MINUTES_PER_DAY;
      }
      if (dt > 0.5) parts.push(`${SYSTEMS[i]!.id} ${dt.toFixed(1)}`);
    }
    if (wasRunning && s.traffic.cursor < 0) rounds++;
    totals.push(total);
    worst.push({ total, minute: s.minute % MINUTES_PER_DAY, parts: parts.join(', ') });
  }
  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  console.log(`\nSystems over ${DAYS} game days (${ticks} ticks), ms:`);
  console.log('system        avg/tick  p99.9     max  (at)   ticks >2 ms');
  for (let i = 0; i < n; i++) {
    const sortedI = per[i]!.sort((a, b) => a - b);
    const p999 = sortedI[Math.floor(sortedI.length * 0.999)]!;
    const over2 = sortedI.filter((v) => v > 2).length;
    console.log(
      `${SYSTEMS[i]!.id.padEnd(12)} ${ms(sum[i]! / ticks)} ${ms(p999)} ${ms(max[i]!)}  ${hhmm(maxAt[i]!)}  ${String(over2).padStart(5)}`,
    );
  }
  const sorted = [...totals].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
  const over = totals.filter((t) => t > 4).length;
  console.log(
    `Tick total: avg ${(totals.reduce((a, b) => a + b, 0) / ticks).toFixed(2)}, p50 ${pct(0.5).toFixed(2)}, ` +
      `p99 ${pct(0.99).toFixed(2)}, max ${sorted[sorted.length - 1]!.toFixed(2)}; ticks over 4 ms: ${over}`,
  );
  console.log(
    `Traffic: ${rounds} assignment rounds, ${(roundTicks / Math.max(1, rounds)).toFixed(0)} ticks (game minutes) each`,
  );
  worst.sort((a, b) => b.total - a.total);
  console.log('Worst ticks:');
  for (const w of worst.slice(0, 8))
    console.log(`  ${ms(w.total)} at ${hhmm(w.minute)}: ${w.parts}`);

  // ---- rebuilds, overlays and saves -------------------------------------------------------
  console.log('\nOn demand (avg / max of 5), ms:');
  const report = (name: string, fn: () => void) => {
    const r = timeIt(fn);
    console.log(`${name.padEnd(22)} ${ms(r.avg)} ${ms(r.max)}`);
  };
  report('rebuildBuildingIndex', () => rebuildBuildingIndex(s));
  report('rebuildEstates', () => rebuildEstates(s));
  report('rebuildFaults', () => rebuildFaults(s));
  report('rebuildNetwork', () => rebuildNetwork(s));
  report('rebuildWater', () => rebuildWater(s));
  report('rebuildTraffic', () => rebuildTraffic(s));
  report('rebuildServices', () => rebuildServices(s));
  const out = new Float32Array(s.world.width * s.world.height);
  for (const id of TILE_OVERLAYS) report(`overlay ${id}`, () => overlayValues(s, id, out));
  report('serializeState', () => serializeState(s));
  report('save JSON', () => JSON.stringify(createSaveFile(sim, 'x')));

  // The p99, not the max: single ticks pick up machine noise and first-call compiles.
  expect(pct(0.99)).toBeLessThan(8);
});

test('profile the scenario cities', { timeout: 600_000 }, () => {
  console.log('\nScenario cities, one game day each (ms per tick):');
  for (const id of SCENARIOS.map((d) => d.id)) {
    const t0 = performance.now();
    const sim = Simulation.newScenario(id);
    const built = performance.now() - t0;
    const times: number[] = [];
    for (let k = 0; k < MINUTES_PER_DAY; k++) {
      const a = performance.now();
      sim.step();
      times.push(performance.now() - a);
    }
    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(
      `${id.padEnd(16)} ${String(sim.state.buildings.length).padStart(5)} buildings, built in ${built.toFixed(0)} ms; ` +
        `avg ${avg.toFixed(2)}, p99 ${times[Math.floor(times.length * 0.99)]!.toFixed(2)}, max ${times[times.length - 1]!.toFixed(2)}`,
    );
  }
});
