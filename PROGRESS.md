# Progress

Spec: `docs/BUILD_PROMPT.md`. Architecture: `ARCHITECTURE.md`. Conventions: `CLAUDE.md`.

## Milestones

| #   | Milestone                                                              | Status   |
| --- | ---------------------------------------------------------------------- | -------- |
| 1   | Scaffold, PWA, CI + Pages, grid, camera, roads, zoning, save/load      | **Done** |
| 2   | Sim core: time, seasons, weather, growth (incl. farms), power          | **Done** |
| 3   | Water, wastewater, pressure zones, irrigation                          | **Done** |
| 4   | Asset condition, incidents, crews, work orders                         | **Done** |
| 5   | Traffic, roadworks, permits                                            | **Done** |
| 6   | Services, landmarks, events, pollution, economy, happiness, complaints | **Done** |
| 7   | Overlays, dashboard, menus and settings, scenarios, UI polish          | **Done** |
| 8   | Performance pass and final docs review                                 | **Done** |

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

## Milestone 5: what exists

- Data (`src/data/traffic.json`): 8×8-tile traffic cells, assignment interval
  (15 min) and per-tick search budget (8,000 road tiles), blend, BPR (α 0.15,
  β 4, v/c capped at 3), gravity deterrence (12 min), trip rates (outbound per
  resident, visitors per shop job, freight per industrial/commercial job, farm
  trips), PCU factors (lorry 2.5, tractor 3), hourly curves for four purposes
  (outbound peak 08:00, return peak 17:00, freight, farm), commute growth factor,
  crew congestion cap, roadworks factors, car density and overlay ramp.
  `roads.json` gains `laneClosureCapacity` and `repairClosure` per class.
- Traffic model (`src/sim/traffic.ts`, system `traffic`, before assets): trip
  table per round (saved), one shortest-path tree per origin by BPR travel time,
  flows accumulated in a saved buffer and blended into `world.traffic` (PCU/h)
  when the round ends; congestion index, mean trip time, unserved trips, per-cell
  commute times. Road wear now follows `flow / capacity` (`peakLoad.road`).
  Growth's spawn chance falls with long commutes.
- Closures: on-site work closes the road fully (`FAULT.ROAD_CLOSED`, impassable)
  or one lane (`FAULT.LANE_CLOSED`, reduced capacity); traffic re-routes. Emergency
  repairs close one lane on avenues and highways. Crews route by congested time
  (capped at 4×) and pass closures.
- Roadworks and permits (`src/sim/roadworks.ts`): every job on a road tile (or a
  main under one) runs under a street works permit on its road segment
  (segments split at junctions). Emergency permits start at once; planned works
  are booked now or as night works (from 20:00, ×1.5 cost, ×1.3 time), with a full
  or lane closure. Crews wait for the slot. Clashes (same segment, overlapping
  slots) are flagged and counted; works on the same street combine (one permit,
  25% off, resurfacing waits for the dig and takes half the time over it); the
  `combinePermits` command merges clashing permits. Overruns are flagged.
  Roadworks KPIs: permits, clashes, combined works and savings, overruns, night
  jobs.
- Render/UI: cosmetic cars (InstancedMesh, sampled from flows, moving at congested
  speed, stopped when paused), traffic overlay (YlOrRd ramp by v/c, closures dark
  grey, lane closures lilac, legend), O cycles overlays (water → traffic → off),
  🚗 chip with the delay and a tooltip (trips, mean trip time, closures, permits,
  roadworks KPIs), roadworks and permit calendar in the inbox (slots, flags,
  clash and combine buttons), inspector rows for capacity, flow, speed now,
  closures and permits, Night works / Lane closure / Combine toggles for the Plan
  maintenance tool with cost and permit notes in the status line, toasts for
  clashes, overruns and booking notes, help text and controls. The inspector now
  scrolls instead of running off the top of the screen.
- Saves: version 5 with a v4 → v5 migration (tested).
- Tests (150, 17 new): BPR curve and travel times, trip generation by hour,
  assignment loading the roads between homes and jobs, congestion building up
  with density, a full closure re-routing traffic, a lane closure keeping traffic
  moving at reduced capacity, determinism and a save made mid-round continuing
  identically, slicing within the search budget, crews slowed and re-routed by
  congestion, road segments, permits on planned works (none off-road), emergency
  permits, clash flagging and `combinePermits` refunds, automatic combining with
  the dig-then-resurface order and shorter resurfacing, night works timing and
  cost, overruns, save round-trip with permits, v4 migration.
- Measured on a fully built 128×128 grid (7,400 buildings, 4,600 road tiles):
  traffic averages 1.0 ms per tick while a round runs, worst 2.7 ms on the tick
  that builds the trip table; a full-map round takes about 128 ticks (2 game
  hours). Smaller towns finish a round in one or a few ticks.

## Milestone 6: what exists

- Data: `services.json` (7 services and 5 landmarks, codes 500–514; coverage
  times; waste; fire; 5 event types; event preparations), `economy.json` (taxes,
  tariffs, fuel, wages, upkeep, budget and tax levels, auto maintenance, loans,
  fines), `city.json` (pollution, land value, happiness, complaints, street
  names). Industrial types, livestock farms and some shops emit `pollution`.
- Services (`services.ts`): fire stations, police stations, health centres and the
  hospital, schools, waste depots, recycling centres and landfill. Coverage by
  free-flow road travel time from each facility (multi-source search, derived),
  quality falling from `goodMinutes` to `maxMinutes`; capacity per facility over
  its catchment (ratios saved hourly, scaled by the services budget); half service
  without power or water. Daily waste collection, recycling, landfill filling,
  missed bins.
- Fire (`fire.ts`): hourly ignition roll (zone risk × footprint; `rules.fires`),
  intensity growth by size, fire engines (crews at fire stations, 2-minute
  mobilisation) dispatched through traffic on `firefighting` orders (one per
  appliance; big buildings get 2–3), the access road closed while they work,
  hydrant draw from the nearest main lowering neighbours' pressure, suppression
  by hydrant pressure (tank only without water), burnt-down buildings, damage,
  response-time KPIs, smoke.
- Landmarks and events (`cityEvents.ts`): stadium, shopping centre, hospital,
  university, conference and events centre. Match days, concerts, conferences,
  shopping weekends and graduations booked automatically; crowd trips in the
  traffic round (`eventIn`/`eventOut` purposes), venue power and water spikes,
  crowd noise; preparations (extra police, stewards and park and ride, road
  closures beside the venue, street cleaning); outcomes (crowd trouble, litter
  into the next bin round, congestion) and a levy.
- Pollution and land value (`pollution.ts`): hourly air and noise grids (4×4-tile
  cells, exponential spread) from industry, gas stations, sewage works, landfill,
  traffic, highways, fires and events; land value from services, landmarks, the
  river and pollution. Growth of homes, shops and offices scales with land value.
- Economy (`economy.ts`, `ledger.ts`): council tax, business rates and farm
  exports (by land value and tax rate), electricity and water tariffs (metered),
  gas, upkeep, crew wages, fines (licence breaches, spills, permit clashes and
  overruns), every line in the month's accounts; department budgets setting crews
  on duty, service capacity, an automatic maintenance allowance and decay speed;
  tax rates damping demand; 30-day monthly accounts with history; loans.
- Happiness and complaints (`happiness.ts`, `complaints.ts`): residents round
  (taxes and happiness, sliced 300 buildings a tick, partial sums saved), seven
  factors, complaint penalty; residential demand follows happiness. Complaints
  from real events with street names ("No water on Mill Road for 3 hours"),
  cooldowns, newest 40 kept.
- UI: Services (Shift+4–0) and Landmarks (Shift+S/C/H/U/E) tools; budget panel
  (Shift+B or click the cash: accounts, past months, budgets, backlog, tax rates,
  loans); city panel (Shift+N or the happiness chip: factor bars, events calendar
  with preparation buttons, complaints feed that jumps to the street, fire and
  waste figures); inspector rows for street, fire, land value, pollution, service
  times and levels, bins, happiness and taxes, and per-service facility figures;
  flames over burning buildings, red fire engines; toasts for fires, events and
  month ends; help text and controls.
- Saves: version 6 with a v5 → v6 migration (tested).
- Tests (185, 35 new): coverage by travel time (and a short cut), unpowered
  stations, capacity sharing and budgets, waste with and without depot and tip,
  recycling, street names, firefighting lowering pressure, a fire put out, a fire
  burning down, no water → burns down, appliances by size, fires deterministic and
  across a save, taxes, business rates, tax demand effect, tariffs/fuel/upkeep/
  wages, meters, command costs booked, budgets scaling upkeep and decay, overrun
  fines, crews on duty by budget, automatic maintenance, loans and month close,
  events booked, crowds in the trip table and venue loads, outcomes, preparations
  and road closures, pollution spread, traffic noise, land value, happiness,
  sliced round across a save, complaints, a whole city deterministic across a save,
  v5 migration.
- Measured on a dense map (4,800 buildings): coverage rebuild 4 ms (on road or
  service changes only), ratios 2.4 ms (:07), pollution 2.7 ms (:03), complaints
  2 ms (:44), waste 2.9 ms (07:17), residents round 0.6 ms a tick for ~17 ticks,
  settlement 0.6 ms; none share a tick with each other or the power dispatch.

## Milestone 7: what exists

- Overlays (`overlays.ts`, `overlays.json`, `render/layers/overlay.ts`): power (powered,
  no power, in reach of a substation, plant, lines, out of service), water pressure,
  wastewater (sewer load against works capacity, overflowing, no works), traffic,
  roadworks and permits (booked, under way, lane closed, road closed, clashes), asset
  condition (worst asset per tile, facilities, failures), cover for fire, police,
  health, schools and bins (out of reach marked), air, noise and land value. Ramps are
  ColorBrewer/viridis families, categories Okabe-Ito; buildings dim; the overlay draws
  on top. Overlay menu in the top bar (🗺), O / Shift+O cycle, a legend from the data.
- Dashboard (Shift+D or 📊): stat tiles for supply interruptions, customer-minutes,
  MTTR, congestion index, cash flow, happiness and fire response, each with a sparkline
  of the daily history (hover or keyboard focus for a day's value), monthly accounts
  and a table view. Daily KPIs are a new system (`kpis.ts`, 60 days kept).
- Main menu at start and on F10 / Menu: Continue (autosave), New sandbox city (seed,
  starting cash, difficulty, weather events, random fires), Scenarios (list, briefing,
  start), Load, Settings, Help. Settings: resolution, shadows, cosmetic cars, grid,
  autosave, pause in menus (default on), edge scroll, controls list. Difficulty
  (`game.json`): failure, decay and income multipliers in `rules.difficulty`.
- Scenarios (`scenario.ts`, `cityGen.ts`, `src/data/scenarios/`): a seeded city
  generator (block grid on the wider bank, zone mix, farms, substations and lines,
  waterworks by the river, sewage works, services, depots, landmarks, grown buildings,
  age profile and condition), constraints (no loans, capital allowance, budget cap,
  banned facilities), objectives with points and a score, timed events (messages,
  weather, a fire, failures of the worst assets or a facility), an end (time or fire
  out) and a results screen. Four scenarios:
  - Heatwave: five hot days under a drought order (3 Ml/day, no new intakes) and a
    treatment works trip on day 3. Hands-off loses (licence breached, supply drops);
    a hosepipe ban alone still breaches; full restrictions (or more storage) win.
  - Cold snap: seven bursts on an old network in four days; MTTR under 4 h 30 min.
    Hands-off: about 6 h (score ~665); a 150% water budget alone got 4 h 45 min in an
    earlier run, so it needs that and more crews or better priorities.
  - Ageing network: 734 assets below 45% at the start; get to 250 within 30 days and
    £1.8 m of works. Booking maintenance over half the map reaches ~300 for £1.6 m.
  - Commercial fire: the shopping centre burns at 10:15; fire station on the outskirts.
    Hands-off: out in 1 h 41 min, smoke costs ~£59k, score ~650; with isolation, a
    cordon and evacuation: out in 33 min, score 1000.
- Fire measures (`fireMeasure` command; inbox and inspector buttons): isolate power,
  cordon (road closures, traffic diverts), evacuate (no smoke, no taxes while closed);
  smoke exposure counted every 5 minutes; complaints.
- Water restrictions (`setWaterRestriction`; budget panel): hosepipe ban (homes −15%),
  irrigation ban (no mains irrigation, farm exports halve); each costs happiness.
- UI polish: the toolbar is grouped with one group open at a time; side panels push the
  toasts left and keep the inspector below them; scenario box bottom left (Shift+G
  folds it); the clock stops while a dialog is open; firefighting orders no longer show
  "done in 6944 days".
- Saves: version 7 with a v6 → v7 migration (tested).
- Tests (211, 26 new): city generator (works on both banks and several seeds, power and
  water reach every building, deterministic, age profile), each scenario starts, timed
  events, constraints, spending tracked, the commercial fire end to end with and
  without measures, cordon closures, isolation and evacuation, a save mid-scenario
  continuing identically, overlays (all paint, power, condition, cover out of reach,
  roadworks), daily KPIs and their cap, difficulty, water restrictions, v6 migration.
- Measured: generating a scenario takes 0.1–0.4 s; a 30-day scenario runs headless in
  ~20 s (~0.5 ms a tick on a ~500-building city).

## Milestone 8: what exists

- Profiling tools: `npm run profile` (`tests/perf/`: a fully built 128×128 map from the
  city generator, ~4,000 buildings and 3,540 road tiles, two game days timed per system
  and per tick, cache rebuilds, overlays, saves, and the four scenario cities);
  `PROFILE_SAVE=path` writes that map as a save; `scripts/profile-render.mjs` loads it into
  the production build in headless Chromium and times the sim step, each render layer and
  the HUD per frame, with draw calls and triangles.
- Traffic: assignment searches a junction-level graph (`src/sim/trafficGraph.ts`; nodes
  are junctions, dead ends, load tiles and one tile per junction-free loop, edges are the
  runs between them). Same costs as the tile search; traffic went from 1.6 to 0.35 ms a
  tick. Derived only (built from the layout and the round's table, re-weighted on
  `timesVersion`), so saves are unchanged.
- Water: cached building connections (`cache.water.links`, cleared by `rebuildWater`),
  reusable solve buffers, a typed-array heap, demand curves once per solve. Used by the
  solve, the finish step, the impact count and happiness.
- `rebuildNetwork` 2.7 → 0.5 ms (line capacity table, no per-tile arrays, squared
  distances); one typed-array `MinHeap` for every search; `buildingDef` is a dense array.
- Scheduling: service ratios at :06 and the waste round at 07:21 (off the water solve
  ticks); automatic maintenance one department a minute, 01:30–01:32.
- Render: a supply change (outages) rebuilds only the window bands; cars write only their
  positions each frame. Three.js is its own build chunk (544 kB; the game is 342 kB).
- Results on the profiling map: average tick 3.2 → 1.6 ms, p99 8.1 → ~5.5 ms, ticks over
  4 ms 26% → ~5%; render JS 0.5–2 ms a frame; ~20 draw calls, 0.4–0.6 M triangles.
  Scenario cities: 0.25–0.45 ms a tick. Details in ARCHITECTURE.md, "Performance".
- Docs reviewed against the code: README (status, commands, controls), ARCHITECTURE
  (modules, tick order, cache, traffic and water models, rendering, performance,
  decisions 100–108), CLAUDE (commands, cache rules, performance conventions, tests),
  ROADMAP (no cuts; performance follow-ups). Every BUILD_PROMPT test item and handover
  deliverable is covered. No save format change (still version 7).
- Tests (216, 5 new): the junction graph covers every road tile once, matches a
  tile-by-tile search (congestion, a closed run, a closed junction, a junction-free loop)
  and is rebuilt or re-weighted when it should be; cached water connections match the ring
  searches and clear on road changes; automatic maintenance books one department a minute.

## In progress

Nothing.

## Known issues / notes

- GitHub Pages must be enabled once in the repository settings
  (Settings → Pages → Source: GitHub Actions) before `deploy.yml` can publish.
- Frame rates are unmeasured on real hardware: the browser profiler only has a software
  GPU. The JS cost per frame and the draw-call and triangle counts suggest a mid-range
  laptop holds 60 fps on a full map, but check it.
- On the profiling map about 5% of ticks take over 4 ms (p99 ~5.5 ms), mostly the water
  solve tick (~2.3 ms) plus whatever shares it; a tick lands at most every ~7 frames at 4×.
- On a full map a road command costs ~7 ms (`rebuildServices`) and a buildings-layer
  rebuild ~8 ms (at most every 300 ms while buildings change): one slow frame each.
- Behind the main menu at start the game builds a throwaway random city (cheap, but
  it is replaced as soon as the player picks something).
- Scenario tuning was checked headlessly with simple strategies, not by full playtests;
  the heatwave is won by one decision (full restrictions) and the ageing network may be
  hard. Revisit with playtesting.
- Generated cities are a regular grid; there is no organic street pattern or highway.
- The scenario briefing opens after the city is built; there is no loading indicator
  (generation takes well under half a second).
- Overlays rebuild up to every 500 ms while layers change; on a full map a rebuild
  costs 1.5–4 ms (land value is the dearest).
- Buildings never redevelop to a higher density in place; re-zoning demolishes
  them.
- Economy balance is a first pass: a small town with a stadium runs a deficit,
  events pay for their preparations, gas power is profitable. Generated scenario
  cities of ~9,000 residents earn about £50–65k a day, so cash is rarely the limit.
- Service facilities need power and water like businesses; placing them before
  the water supply raises "no water" toasts at once (the hospital is a priority
  customer).
- Coverage uses free-flow times (decision 69), so congestion slows fire engines
  but not the coverage figures.
- Land value and happiness use the services' served share, which updates hourly.
- Random fires only start in grown buildings (decision 73). Fires do not spread
  to neighbours. Fire measures act per fire; smoke does not drift with the wind.
- Event road closures close every road tile beside the venue; trips that load
  there go unserved while it is closed.
- The happiness chip reads "–" until the first residents round after people move
  in.
- Several substations on one line are not limited jointly (decision 22).
- The power dispatch takes ~1.1 ms on a full map every 5th tick; the water solve
  ~2.3 ms for a map-wide network (not split across ticks, decision 106).
- Cities from v2 saves lose water (and slowly occupancy) until the player
  builds an intake and treatment works; the migration only lays mains.
- A sewage works without power counts all its inflow as spill.
- Running many days at once from the console stacks "Autosaved." toasts.
- Bursts in the same water network each count all of that network's dry
  customers (attribution by network, decision 50), so two bursts in one
  network double-count in the inbox; city customer-minutes count each customer
  once.
- Crews pass closures (decision 54/67) but are slowed by congestion.
- On the profiling map a traffic round takes ~56 game minutes, so flows lag the peaks
  a little; `nodesPerTick` could now be raised (searches are ~4× cheaper).
- Traffic flows are two-way per tile; there are no junction delays or signals.
- Road closures only apply while a crew is on site, not for the whole permit
  slot (decision 62). Night works only start at 20:00; crews do not stop at 06:00.
- Clashes and overruns are fined once each when flagged.
- The congestion index compares trip times with free-flow times on the routes
  chosen, so it reads 1.00 for the first round after loading an M4 save.
- Building a local road across an avenue replaces the avenue tile at the crossing
  (M1 road tool behaviour).
- Repairs are paid even when cash is negative; loans are the remedy.
- Crews on duty follow department budgets (1–3 per depot or fire station).
- Crew labels use global crew ids ("Water crew 3").
- `npm audit` reports 4 moderate advisories in build-time dependencies
  (minimatch via vite-plugin-pwa/workbox-build); rechecked in M8, unchanged, and
  `npm audit --omit=dev` is clean. Nothing ships to the browser; recheck when upgrading.

## Exact next step

All eight milestones are done: v1 is complete. Suggested next steps, in order:

1. Enable GitHub Pages once (Settings → Pages → Source: GitHub Actions) and merge to
   `main` to publish.
2. Playtest on a real mid-range laptop: confirm 60 fps on a fully built map (load the
   profiling save: `PROFILE_SAVE=big.json npm run profile`, then Save / load → Import),
   with and without shadows and overlays.
3. Playtest the four scenarios for balance (see the notes above: the heatwave is won by
   one decision; the ageing network may be hard).
4. Then pick from `ROADMAP.md` (performance follow-ups, public transport, terrain, ...).
