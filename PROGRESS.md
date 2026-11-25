# Progress

Spec: `docs/BUILD_PROMPT.md`. Architecture: `ARCHITECTURE.md`. Conventions: `CLAUDE.md`.

## Milestones

| #   | Milestone                                                              | Status      |
| --- | ---------------------------------------------------------------------- | ----------- |
| 1   | Scaffold, PWA, CI + Pages, grid, camera, roads, zoning, save/load      | **Done**    |
| 2   | Sim core: time, seasons, weather, growth (incl. farms), power          | **Done**    |
| 3   | Water, wastewater, pressure zones, irrigation                          | **Done**    |
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

## Milestone 3: what exists

- Data (`src/data/water.json`): river intake, water treatment works, service
  reservoir, water tower, booster pumping station, sewage treatment works
  (codes 300–305); 150 / 300 / 600 mm mains with capacity and friction-loss
  figures; pressure thresholds (good 20 m, low 15 m, no supply 5 m); hourly
  demand curves; temperature, irrigation (season, heat, heatwave, rain) and
  storm runoff factors; farm irrigation licence; overlay ramp. Every building
  type has `waterLpd`; farms have `irrigationLpd`. New grown building: care home
  (code 7, priority customer).
- Network (`src/sim/water.ts`): mains layer laid automatically under every
  road (150 mm) plus a tool for feeder/trunk mains (on or off road, pipe
  bridges, never downgrades); networks, pressure zones split by boosters, and
  implicit sewers under roads. River intakes must sit on the riverbank.
- Supply and pressure: output = min(powered intakes, powered works); reservoirs
  and towers fill from spare output and cover shortfalls; friction-loss
  pressure (distance and load), routed twice; boosters add head downstream only;
  shortfalls drop pressure at the far ends first. Solve sliced one network per
  tick (cursor saved), finish step every 5 minutes. Per-tile pressure saved.
- Growth needs water at good pressure (farms may use the river); occupancy
  falls after 4 hours without water. Water facilities draw power (priority
  "essential services") and stop when unpowered.
- Wastewater: dry-weather flow plus storm runoff per sewer network against
  powered works capacity; spills and untreated flow tracked; overflow
  start/end events.
- Irrigation from the river up to a daily farm licence, then from the mains (or
  none); public supply licence per intake with a once-a-day breach event; both
  reset at midnight.
- Render/UI: water tools (J, K, 9, 0, -, =, C, Y), water facility models,
  pressure overlay (O or click the 💧 chip; viridis ramp, legend, buildings and
  zones dimmed), top-bar water chip with tooltip, inspector rows for mains,
  pressure, sewers, building supply/use/irrigation and every water facility,
  toasts for supply loss/restore, priority customers, overflows and licences,
  help text and controls list. Panels under the top bar now follow its height.
- Saves: version 3 with a v2 → v3 migration (mains under existing roads).
- Tests (113, 28 new): network connectivity and cut mains, intake required,
  roads carry mains, pressure falling with distance and with flow, larger mains,
  booster recovery and zone separation, unpowered booster, reservoir refill and
  cover, shortfall and low-pressure counting, supply loss/restore events,
  priority customers, licence breach, irrigation rising with temperature and
  heatwave and stopping at the licence, mains fallback, storm overflow,
  untreated sewage, growth needing water, water outages emptying buildings,
  determinism including a save loaded mid-round, water commands, power draw,
  v2 migration.
- Measured on a dense map (~1,200 buildings, one 4,700-tile network): network
  solve 2.1 ms (once per 5 ticks, never on the power tick), finish step 0.3 ms,
  average tick 0.64 ms.

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
  (`exportPerDay`) and running costs arrive with the economy in M6. Licence
  breaches and spills have no fines yet.
- Growth ignores land value, services and commute times for now (decision
  19). Buildings never redevelop to a higher density in place; re-zoning
  demolishes them.
- Several substations on one line are not limited jointly (decision 22).
- Power dispatch scales with building count (~2 ms on a full map every 5th
  tick); slice it in the M8 performance pass if profiling shows the need.
- The water solve is one network per tick; a single map-wide network of
  ~5,000 main tiles takes ~2 ms. If M8 profiling shows a bigger network near
  the 4 ms budget, split the two routing passes across ticks (they would need
  their flows saved, see decision 33).
- Cities from v2 saves lose water (and slowly occupancy) until the player
  builds an intake and treatment works; the migration only lays mains.
- A sewage works without power counts all its inflow as spill.
- The toolbar now has 26 tools and scrolls on short screens; tidy in M7.
- Running many days at once from the console stacks "Autosaved." toasts.
- `npm audit` reports 4 moderate advisories in build-time dependencies
  (minimatch via vite-plugin-pwa/workbox-build). Nothing ships to the browser;
  recheck when upgrading.

## Exact next step

Start **milestone 4** (asset condition, incidents, crews, work orders):

1. Data: `src/data/assets.json` with asset classes for road segments (per
   class), water mains (per size), power lines, substations, pumps (boosters,
   intakes), treatment and sewage works and power plants: base decay per day,
   load-dependent decay (traffic later, main utilisation and line loading
   now), a failure curve (daily failure probability against condition), cold
   snap burst multiplier for mains, repair crew type, repair duration, repair
   cost. Update the "asset type" section of CLAUDE.md.
2. State: condition (0–100) and age for tile assets (Uint8 condition layers for
   roads, mains and lines, plus a laid-on day layer) and on facility Building
   records. Bump the save version with a migration (existing assets start new
   or at a configurable condition).
3. Systems: daily decay (sliced across ticks, cursor in state) and failure
   rolls with `state.rng`. A burst main removes the tile from the water network
   (pressure downstream falls; add leakage to demand) and needs an excavation;
   a cable fault cuts a line tile.
4. Incidents with severity (priority customers raise it; offer a bottled water
   response), customers affected and an SLA timer; work orders with priorities;
   crew types (roads, water, power) based at depots (new facilities), limited
   in number, travelling along roads (shortest path by road speed now,
   congestion in M5) and spending time on site. Planned maintenance work orders
   from the player. Track MTTR and customer-minutes lost.
5. UI: incident inbox with the work order queue and crew assignment; inspector
   condition rows; toasts.
6. Tests: decay and failure curves, burst → incident → work order → crew
   travels → repair → supply restored, cold snap burst rate, MTTR and
   customer-minutes, determinism, save round-trip; update ARCHITECTURE.md
   (tick order: asset decay and failures after water, before growth),
   CLAUDE.md and this file.
