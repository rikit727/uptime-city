# Progress

Spec: `docs/BUILD_PROMPT.md`. Architecture: `ARCHITECTURE.md`. Conventions: `CLAUDE.md`.

## Milestones

| #   | Milestone                                                              | Status      |
| --- | ---------------------------------------------------------------------- | ----------- |
| 1   | Scaffold, PWA, CI + Pages, grid, camera, roads, zoning, save/load      | **Done**    |
| 2   | Sim core: time, seasons, weather, growth (incl. farms), power          | **Done**    |
| 3   | Water, wastewater, pressure zones, irrigation                          | **Done**    |
| 4   | Asset condition, incidents, crews, work orders                         | **Done**    |
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

## Milestone 4: what exists

- Data (`src/data/assets.json`): asset classes for the 3 road classes, 3 main
  sizes and 2 line types (tile assets) and the 10 power/water facility kinds:
  base decay, load decay, failure scale, weather multipliers (cold snap ×4 for
  mains, ×2 for roads; storm ×3 for lines, ×2 for wind turbines), crew type,
  repair and maintenance minutes and cost. Shared failure curve (0.003% a day
  at 100 → 2% at 0). Incident kinds with base severity and SLA. Three depots
  (highways, water, electricity; codes 400–402, 2 crews each).
- State: Uint16 condition (×100) and laid-day layers plus Uint8 peak-load
  layers per tile asset; facility condition, built day and peak load on
  Building records; incidents, work orders, crews and KPIs. Save version 4
  with a v3 → v4 migration (existing assets start at condition 100, laid on the
  save's day).
- Systems: `assets` (daily decay sweep, a slice of tiles per tick, load wear
  from the water solve and power dispatch peaks, failure rolls with
  `state.rng`) and `incidents` (crew arrivals, finished work, dispatch by
  priority to the nearest free crew, storm overflow incident, impacts every 5
  minutes: customers, priority customers, severity, SLA, customer-minutes).
- Effects: a burst main leaks and passes no water on, so pressure falls
  downstream until a crew isolates it (and closes the road over it); cable
  faults and line work cut the line tile out of the power network; facility
  faults and overhauls take the facility out of service; resurfacing closes the
  road (closures are flags for M5 traffic).
- Crews from depots drive the fastest road route by road speed (Dijkstra) with
  off-road end legs, mobilise for 30 minutes, work on site and return; they can
  be diverted. Repairs restore condition to 60 (and patch the road over a
  main), maintenance to 100. MTTR, SLA met/missed and customer-minutes (today,
  yesterday, all time) are tracked.
- Commands: `raiseMaintenance` (area, condition threshold, optional crew type
  or single asset), `setOrderPriority`, `assignCrew`, `cancelOrder` (refund),
  `sendBottledWater` (water incidents with priority customers cut off).
- Render/UI: crew vans, incident markers (taller and darker with severity),
  barriers round work sites; 🛠 top-bar chip and incident inbox (`) with KPIs,
  open incidents (severity, customers, SLA, crew status, priority and crew
  pickers, bottled water), planned work (cancel), crews and recently closed
  incidents; inspector rows for condition, age, failure risk, incident and work
  per asset with one-click maintenance buttons; depot crew lists; Plan
  maintenance tool (;) with a threshold bar ([ / ]); depot tools (Shift+1/2/3);
  toasts; help text and controls list.
- Tests (133, 20 new): failure curve, weather multipliers, decay with load and
  peak-load reset, water solve recording utilisation, daily sweep coverage,
  cold-snap burst rate, burst → incident → work order → crew → isolation →
  repair → supply restored (with MTTR, customer-minutes, cost), no-crew warning,
  cable fault cutting a substation's feed, facility fault, demolishing a burst
  main, severity and bottled water, planned maintenance (threshold, isolation,
  restore, cancel/refund, priorities), routing, determinism with failures and
  repairs, save mid-repair continuing identically, v3 migration.
- Measured on a 120×120 road grid with 64 substations and aged assets: the
  assets and incidents systems average about 0.04 ms per tick; a cable fault or
  its repair rebuilds the power network (about 2 ms on that grid), the only
  spike; a crew route is under 1 ms.

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
- The toolbar now has 30 tools and scrolls on short screens; tidy in M7.
- Running many days at once from the console stacks "Autosaved." toasts.
- Bursts in the same water network each count all of that network's dry
  customers (attribution by network, decision 50), so two bursts in one
  network double-count in the inbox; city customer-minutes count each customer
  once.
- Road defects and closures have no effect yet beyond the incident: traffic and
  permits use them in M5. Crews ignore closures.
- No condition overlay yet (M7 overlays); condition shows in the inspector.
- Repairs are paid even when cash is negative; there is no income until M6.
- `rebuildNetwork` takes about 2 ms on a dense power grid and runs on every
  cable fault and repair; make it incremental in M8 if it shows in profiles.
- Crew numbers are fixed per depot (2); department budgets set them in M6.
- Crew labels use global crew ids ("Water crew 3").
- `npm audit` reports 4 moderate advisories in build-time dependencies
  (minimatch via vite-plugin-pwa/workbox-build). Nothing ships to the browser;
  recheck when upgrading.

## Exact next step

Start **milestone 5** (traffic, roadworks, permits):

1. Data: `src/data/traffic.json` with trip rates per zone and building
   (residents, jobs), morning/evening peak curves, BPR parameters (α 0.15,
   β 4), assignment interval, cosmetic car density; road capacities and speeds
   already live in `roads.json`.
2. Traffic model (`src/sim/traffic.ts`): trip generation per zone (aggregated
   per road tile or per zone cluster), congestion-aware shortest paths with the
   BPR volume/delay function, assignment recalculated periodically and sliced
   across ticks (cursor saved, like the water solve). Save per-tile volume or
   travel time as a layer so loads stay deterministic; write traffic load into
   `world.peakLoad.road` so road wear starts to depend on traffic.
3. Closures: `cache.faults.tile` already has `FAULT.ROAD_CLOSED` for
   excavations and resurfacing; closed tiles lose capacity (lane closure) or
   all of it and traffic re-routes. Crews should use congested travel times in
   `routing.ts` (`legMinutes`).
4. Roadworks: planned resurfacing exists (maintenance orders); add night works
   (less disruption, more cost and time), lane vs full closure, and permits:
   every work order needs a booked slot on its segment; clashes flagged;
   combining works on the same segment (e.g. a main renewal and resurfacing)
   avoids digging twice and is rewarded. Roadworks/permit calendar in the inbox.
5. Render/UI: cosmetic cars sampled from flows (InstancedMesh), traffic overlay
   (colour-blind-safe ramp), congestion index chip, closures and diversions.
6. Tests: BPR delay, assignment determinism, a roadworks closure re-routing
   traffic, permits clash/combine, crews slowed by congestion, save round-trip
   mid-assignment; update ARCHITECTURE.md (tick order: traffic before assets),
   CLAUDE.md and this file.
