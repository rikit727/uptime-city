# Progress

Spec: `docs/BUILD_PROMPT.md`. Architecture: `ARCHITECTURE.md`. Conventions: `CLAUDE.md`.

## Milestones

| #   | Milestone                                                              | Status      |
| --- | ---------------------------------------------------------------------- | ----------- |
| 1   | Scaffold, PWA, CI + Pages, grid, camera, roads, zoning, save/load      | **Done**    |
| 2   | Sim core: time, seasons, weather, growth (incl. farms), power          | **Done**    |
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

## Milestone 2: what exists

- Calendar: 4 seasons × 30 days (120-day year), shown as "Spring 3, Year 1 ·
  07:30". Seasonal day length drives lighting and solar output.
- Weather (`src/sim/weather.ts`, `weather.json`): temperature (seasonal mean +
  persistent daily anomaly + daily cycle), cloud, showers, wind; heatwave,
  cold snap and storm events with toasts; `rules.weatherEvents` switch.
- Buildings and growth (`buildings.json`, `growth.json`): 25 building types
  across residential, commercial (high-street shops, retail parks), office
  (office blocks, business parks), industrial (light, heavy, warehousing) and
  farms (arable, livestock, glasshouses). Multi-tile footprints; residents and
  jobs as per-building aggregates; hourly zone demand; growth scan sliced
  across ticks; occupancy grows with demand and falls after long outages.
  Roads or re-zoning over buildings demolish them (farms included).
- Industrial estates: industrial plots that touch (or face each other across
  one road) form a named estate, with persistent names and aggregate jobs and
  power load in the inspector.
- Power (`power.json`, `src/sim/power.ts`): gas power station, solar farm,
  wind turbine (power curve with storm cut-out), battery storage, substations,
  distribution (12 MW) and transmission (150 MW) lines. Islands, widest-path
  substation feed limits, substation coverage radius; demand by zone curve,
  time of day and temperature; dispatch every 5 minutes; rolling outages by
  priority and rota block on shortfall, with toasts.
- Render: buildings from data-defined parts via growable `InstancedMesh`
  batches, seasonal farm fields, polytunnels, turbine rotors spinning with
  output, pylons and cables, street lamps; window bands and lamps glow at
  night and stay dark without power; sky dims with cloud.
- UI: Power tool group (P/T lines, U substation, N/L/V/M facilities; click to
  place with a footprint preview), top-bar chips for weather, power and
  population (tooltips with demand by zone and power detail), inspector for
  buildings, facilities, estates and power coverage, updated help.
- Saves: version 2 with a v1 → v2 migration (tested).
- Tests (85): calendar, weather (determinism, seasons, events, heatwave,
  storm, sun), growth (needs power and road, farms, demolition, outages),
  estates (merge/split/names/save), power (connectivity, river spans, line
  limits, shortfall by priority, rolling rota, restore, batteries,
  renewables), new commands, save round-trip with buildings, migration,
  determinism with a growing powered city.
- Measured on a dense test map (~2,100 buildings): average tick 0.17 ms,
  power dispatch 0.6 ms (every 5th tick), network rebuild 0.2 ms.

## In progress

Nothing.

## Known issues / notes

- GitHub Pages must be enabled once in the repository settings
  (Settings → Pages → Source: GitHub Actions) before `deploy.yml` can publish.
- The main JS chunk is ~600 kB (mostly Three.js); fine for now, revisit in M8.
- Settings (shadows, edge scroll, autosave) are stored but only the grid has a
  UI toggle (G). The settings panel arrives in M7. The weather-events rule
  has no UI yet (M7 sandbox settings).
- No main menu yet; the game opens on a new random-seed city (M7).
- The game keeps running while a modal is open (decision 15).
- No income yet: cash only goes down. Taxes, tariffs, farm exports
  (`exportPerDay`) and running costs arrive with the economy in M6.
- Growth ignores land value, services and commute times for now (decision
  19). Buildings never redevelop to a higher density in place; re-zoning
  demolishes them.
- Several substations on one line are not limited jointly (decision 22).
- Power dispatch scales with building count (~2 ms on a full map every 5th
  tick); slice it in the M8 performance pass if profiling shows the need.
- Running many days at once from the console stacks "Autosaved." toasts.
- `npm audit` reports 4 moderate advisories in build-time dependencies
  (minimatch via vite-plugin-pwa/workbox-build). Nothing ships to the browser;
  recheck when upgrading.

## Exact next step

Start **milestone 3** (water, wastewater, pressure zones, irrigation):

1. Data: `src/data/water.json` with intake, treatment works, service
   reservoir, water tower, pumping/booster station, sewage treatment works
   (codes 300+ in the shared building code space), main diameters and
   capacities, pressure thresholds (low / no supply), demand per building
   (add `waterLpd` to building types; farms get irrigation and livestock
   demand that rises with temperature and in heatwaves), abstraction licence
   cap per day.
2. Network: mains and sewers along roads by default (decide whether they are
   implicit on every road tile or laid by a tool; record in the decision
   log). Intake must sit beside river water. Pressure zones separated by
   pumping stations. Friction-loss pressure model: pressure drops with main
   length and how close flow is to capacity; boosters raise pressure
   downstream at an energy cost (add their load to the power dispatch).
   Recompute sliced across ticks (keep a cursor in state).
3. Growth: require water service as well as power (add to `growSlice`).
   Priority customers flagged for later incidents.
4. Wastewater: sewage works capacity; storm rainfall (`weather.rainMmPerHour`)
   adds inflow and can trigger an overflow event.
5. Irrigation: farm demand from mains or a river abstraction with a capped
   daily licence; stop at the cap.
6. Render/UI: tools, pipes along roads (only visible in the water overlay,
   which is M7, or a simple toggle now), inspector rows, toasts.
7. Bump the save version with a migration; tests for pressure falling with
   distance and flow, recovering with a booster, irrigation rising with
   temperature and stopping at the licence cap, sewer overflow in storms,
   determinism; update ARCHITECTURE.md (tick order: water after power, before
   growth), CLAUDE.md and this file.
