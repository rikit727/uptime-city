# Progress

Spec: `docs/BUILD_PROMPT.md`. Architecture: `ARCHITECTURE.md`. Conventions: `CLAUDE.md`.

## Milestones

| #   | Milestone                                                              | Status      |
| --- | ---------------------------------------------------------------------- | ----------- |
| 1   | Scaffold, PWA, CI + Pages, grid, camera, roads, zoning, save/load      | **Done**    |
| 2   | Sim core: time, seasons, weather, growth (incl. farms), power          | Not started |
| 3   | Water, wastewater, pressure zones, irrigation                          | Not started |
| 4   | Asset condition, incidents, crews, work orders                         | Not started |
| 5   | Traffic, roadworks, permits                                            | Not started |
| 6   | Services, landmarks, events, pollution, economy, happiness, complaints | Not started |
| 7   | Overlays, dashboard, menus and settings, scenarios, UI polish          | Not started |
| 8   | Performance pass and final docs review                                 | Not started |

## Milestone 1: what exists

- Tooling: Vite 8, TypeScript 6 (strict), Three.js r187, Vitest 5, ESLint 10 +
  typescript-eslint, Prettier. `npm run lint`, `npm test`, `npm run build`
  all pass.
- PWA via vite-plugin-pwa (manifest, generated icons, offline precache);
  verified the service worker registers in Chromium.
- GitHub Actions: `ci.yml` (lint, test, build on every push/PR) and
  `deploy.yml` (build with `BASE_PATH=/<repo>/`, publish to Pages on push to
  `main`).
- Sim: seeded RNG, 128×128 grid, river generator, clock system (1 tick = 1
  minute, `dayStarted` events), commands `buildRoad` (L-path, 3 classes,
  bridges, upgrades), `zone` (5 types, 3 densities, farmland edge band),
  `bulldoze`; plan/apply split used for previews; command log + `replay()`;
  state hash.
- Render: ground, river, grid lines, instanced road and zone tiles, bridges,
  drag preview (white = change, orange = remove, red = blocked/unaffordable),
  hover cursor, hemisphere + sun lighting following the clock, shadows
  toggle (setting, default off).
- Camera: orbit/pan/zoom, pitch clamped 30°–70°, WASD/arrows, Q/E rotate,
  R/F tilt, Z/X and wheel zoom, right-drag rotate, middle-drag or left-drag
  (Inspect) pan, optional edge scroll (setting, default off).
- UI: top bar (day/time, cash, speed buttons), toolbar with shortcuts, density
  selector, status line with cost preview, tile inspector, toasts, help panel
  (shown on first run), new game (seed), save/load modal.
- Saves: IndexedDB slots 1–3 + autosave each game day; JSON export/import;
  versioned envelope with a migration hook.
- Tests (46): RNG, geometry, map generation, all commands, clock,
  determinism (same seed + commands → same hash; replay; continue after load),
  save round-trip, RLE, migrations, IndexedDB slots (fake-indexeddb), tick
  scheduler.

## In progress

Nothing.

## Known issues / notes

- GitHub Pages must be enabled once in the repository settings
  (Settings → Pages → Source: GitHub Actions) before `deploy.yml` can publish.
- The main JS chunk is ~580 kB (mostly Three.js); fine for now, revisit in M8.
- Settings (shadows, edge scroll, autosave) are stored but only the grid has a
  UI toggle (G). The settings panel arrives in M7.
- No main menu yet; the game opens on a new random-seed city (M7).
- The game keeps running while a modal is open (decision 15).
- Zones are flat coloured tiles; buildings arrive with growth in M2.
- `npm audit` reports 4 moderate advisories in build-time dependencies
  (minimatch via vite-plugin-pwa/workbox-build). Nothing ships to the browser;
  recheck when upgrading.

## Exact next step

Start **milestone 2**:

1. Add a calendar to `src/sim/time.ts` (days per season/year; suggest 30 days
   per season, 120 per year) and a `weather` system with a seeded model for
   temperature, rainfall, wind and sunshine plus heatwave / cold snap / storm
   events. Put tunables in `src/data/weather.json`.
2. Add `src/data/buildings.json` and a `growth` system that grows buildings
   on zoned tiles next to roads (aggregate residents/jobs per building),
   including farm types (arable, livestock, glasshouses) and industrial
   estates (flood-fill adjacent industrial plots). Render buildings with
   `InstancedMesh`; windows and lamps emissive at night.
3. Add power: plants (gas, solar, wind, battery), substations and lines as
   new commands/tools and data; demand by zone and time of day; supply
   connectivity; rolling outages by priority on shortfall; weather-driven
   renewable output.
4. Bump the save version with a migration, add tests for each system
   (network connectivity, outage on capacity shortfall), update docs.
