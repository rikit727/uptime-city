/**
 * Browser profiler (milestone 8): main-thread cost per frame on a big map.
 *
 *   npm run build && npm run preview          # serves dist/ at http://localhost:4173
 *   PROFILE_SAVE=/tmp/big-city.json npm run profile   # writes the big city as a save
 *   node scripts/profile-render.mjs /tmp/big-city.json [url]
 *
 * Opens the game in headless Chromium (Playwright), imports the save, closes the
 * menu and, for each case (speeds, overlays), records per frame: the sim step,
 * the renderer and the HUD update (JS time on the main thread). Headless Chromium
 * draws with a software GPU, so whole-frame times here say little about a real
 * laptop; the JS costs are what this measures.
 */
import { createRequire } from 'node:module';

// Playwright is not a project dependency: use a global install (or `npm i -D playwright`).
const { chromium } = createRequire(import.meta.url)('playwright');

const save = process.argv[2];
const url = process.argv[3] ?? 'http://localhost:4173/';
if (!save) {
  console.error('Usage: node scripts/profile-render.mjs <save.json> [url]');
  process.exit(1);
}

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(url);
await page.waitForFunction(() => 'uptimeCity' in window);

// Import the save through the game's own import action.
page.once('filechooser', (fc) => fc.setFiles(save));
await page.evaluate(() => window.uptimeCity.hud.actions.importSave());
await page.waitForFunction(() => window.uptimeCity.sim.state.buildings.length > 1000, null, {
  timeout: 60_000,
});
await page.evaluate(() => {
  const g = window.uptimeCity;
  g.hud.closeModal?.();
  g.settings.pauseInMenus = false;
  // Wrap the per-frame work with timers.
  const t = (window.__prof = { sim: [], render: [], hud: [], frame: [] });
  const wrap = (obj, name, into) => {
    const orig = obj[name].bind(obj);
    obj[name] = (...args) => {
      const a = performance.now();
      const r = orig(...args);
      into.push(performance.now() - a);
      return r;
    };
  };
  wrap(g, 'stepSim', t.sim);
  wrap(g.renderer, 'render', t.render);
  wrap(g.hud, 'update', t.hud);
  // Each render layer's update (rebuilds show up as the slow calls).
  t.layers = {};
  for (const [name, layer] of Object.entries(g.renderer)) {
    if (!layer || typeof layer.update !== 'function' || name === 'rig') continue;
    t.layers[name] = [];
    wrap(layer, 'update', t.layers[name]);
  }
  let last = performance.now();
  const loop = (now) => {
    t.frame.push(now - last);
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  // A view of the whole city.
  const rig = g.renderer.rig;
  rig.target.set(64, 0, 64);
  rig.distance = 150; // about the widest zoom (cameraRig DISTANCE_MAX)
});

const stats = (a) => {
  if (a.length === 0) return 'n/a';
  const s = [...a].sort((x, y) => x - y);
  const avg = s.reduce((x, y) => x + y, 0) / s.length;
  const p = (q) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
  return `avg ${avg.toFixed(2)}  p95 ${p(0.95).toFixed(2)}  max ${s[s.length - 1].toFixed(2)}`;
};

async function measure(label, setup, seconds = 15) {
  await page.evaluate(setup);
  await page.waitForTimeout(1500); // let layers rebuild
  await page.evaluate(() => {
    const t = window.__prof;
    for (const k of ['sim', 'render', 'hud', 'frame']) t[k].length = 0;
    for (const k of Object.keys(t.layers)) t.layers[k].length = 0;
  });
  await page.waitForTimeout(seconds * 1000);
  const r = await page.evaluate(() => window.__prof);
  console.log(`\n${label} (${r.frame.length} frames)`);
  console.log(`  sim    ${stats(r.sim)}`);
  console.log(`  render ${stats(r.render)}`);
  console.log(`  hud    ${stats(r.hud)}`);
  console.log(`  frame  ${stats(r.frame)}`);
  const info = await page.evaluate(() => {
    const i = window.uptimeCity.renderer.renderer.info.render;
    return { calls: i.calls, triangles: i.triangles };
  });
  console.log(`  draw calls ${info.calls}, triangles ${info.triangles.toLocaleString('en-GB')}`);
  for (const [name, a] of Object.entries(r.layers)) {
    const slow = a.filter((v) => v > 1);
    if (slow.length > 0)
      console.log(`    ${name.padEnd(13)} ${slow.length} slow updates: ${stats(slow)}`);
  }
}

const info = await page.evaluate(() => ({
  buildings: window.uptimeCity.sim.state.buildings.length,
  gl: (() => {
    const c = document.createElement('canvas').getContext('webgl2');
    const d = c?.getExtension('WEBGL_debug_renderer_info');
    return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown';
  })(),
}));
console.log(`${info.buildings} buildings; GL: ${info.gl}`);

// Synchronous benchmarks (the frame loop cannot run meanwhile): sim ticks, and the
// renderer re-drawing after every layer changes (what a busy frame costs).
const bench = await page.evaluate(() => {
  const g = window.uptimeCity;
  g.scheduler.setSpeed(0);
  const ticks = [];
  for (let k = 0; k < 600; k++) {
    const a = performance.now();
    g.sim.step();
    ticks.push(performance.now() - a);
  }
  for (const k of Object.keys(window.__prof.layers)) window.__prof.layers[k].length = 0;
  const layers = [];
  const steady = [];
  for (let k = 0; k < 20; k++) {
    for (const key of Object.keys(g.sim.revisions)) g.sim.revisions[key]++;
    let a = performance.now();
    g.renderer.render(g.sim.snapshot(), 0.016);
    layers.push(performance.now() - a);
    a = performance.now();
    g.renderer.render(g.sim.snapshot(), 0.016);
    steady.push(performance.now() - a);
  }
  const perLayer = {};
  for (const [k, a] of Object.entries(window.__prof.layers))
    perLayer[k] = a.filter((_, i) => i % 2 === 0);
  return { ticks, layers, steady, perLayer };
});
console.log(`\nSim ticks in the browser (600): ${stats(bench.ticks)}`);
console.log(`Render, every layer rebuilt: ${stats(bench.layers)}`);
console.log(`Render, nothing changed:     ${stats(bench.steady)}`);
for (const [name, a] of Object.entries(bench.perLayer))
  console.log(`  rebuild ${name.padEnd(13)} ${stats(a)}`);

await measure('Paused', () => window.uptimeCity.scheduler.setSpeed(0));
await measure('1x', () => window.uptimeCity.scheduler.setSpeed(1));
await measure('4x', () => window.uptimeCity.scheduler.setSpeed(3));
for (const id of ['traffic', 'water', 'condition', 'landValue']) {
  await measure(`4x, ${id} overlay`, `window.uptimeCity.setOverlay('${id}')`);
}
await page.evaluate(() => window.uptimeCity.setOverlay('none'));
await browser.close();
