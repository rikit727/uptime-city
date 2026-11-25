# Architecture

Uptime City is a single-page TypeScript app: a pure simulation, a Three.js
renderer that reads sim snapshots, and an HTML/CSS UI that sends commands.
There is no backend. The spec is `docs/BUILD_PROMPT.md`.

## Modules

```
src/
  config.ts        Game name and storage prefix (the ONLY place the name is written)
  main.ts          Entry point: creates Game, registers the service worker
  sim/             Pure TypeScript simulation. No DOM, no Three.js. Worker-safe.
    index.ts         Public surface: import from 'src/sim', not deep paths
    simulation.ts    Simulation class: dispatch(), preview(), step(), snapshot(), replay()
    state.ts         SimState shape and createInitialState()
    world.ts         Tile grid (typed arrays) and tile helpers
    mapgen.ts        Seeded terrain generation (one river)
    rng.ts           Seeded RNG (mulberry32) with saveable state
    data.ts          Typed access to src/data JSON + lookups by id / code
    geometry.ts      roadPath() / rectTiles() shared by sim and UI previews
    time.ts          Minutes, days, calendar (seasons, years), clock formatting
    weather.ts       Weather model: seasonal curves, daily/hourly rolls, events, sun
    buildings.ts     Building bookkeeping: footprints, add/remove, tile index, residents/jobs
    estates.ts       Industrial estates (flood fill, persistent names, aggregates)
    growth.ts        Zone demand, sliced building growth, occupancy
    power.ts         Power network (islands, widest-path feed, coverage) and dispatch
    water.ts         Water layout (networks, pressure zones, sewers), demand, irrigation,
                     friction-loss pressure solve per network, wastewater and storm overflows
    assets.ts        Asset model: classes, condition (×100 in tile layers), age, failure curve,
                     fault bits, customers per building
    decay.ts         Daily sweep: condition decay (base + load) and failure rolls per asset
    incidents.ts     Incidents (severity, customers, SLA), work orders, fault cache, crew
                     dispatch, repairs, MTTR and customer-minutes
    crews.ts         Crews and depots: creation, sending, returning, position along a route
    routing.ts       Fastest road route (Dijkstra by road speed × congestion) with off-road end legs
    traffic.ts       Trip generation per traffic cell, sliced congestion-aware assignment (BPR),
                     road segments, derived travel times, commute times, road wear from flows
    roadworks.ts     Street works permits: booking (now / night, lane or full closure), clashes,
                     combining works, dispatch gating, overruns
    services.ts      Public services: coverage by road travel time, capacity ratios, service
                     levels, waste collection, recycling and landfill, crews housed per building
    fire.ts          Building fires: ignition, growth, fire engines, hydrant draw, damage
    cityEvents.ts    Events calendar at landmarks: booking, crowd windows, event trips, loads,
                     road closures, preparations, outcomes
    pollution.ts     Air and noise grids (hourly, spread), land value
    economy.ts       Taxes, tariffs, running costs, budgets (crews on duty, auto maintenance),
                     monthly accounts, loans
    ledger.ts        Cash in and out on lines of the month's accounts; budget decay factor
    happiness.ts     The residents round (taxes and happiness, sliced), hourly complaint checks
    complaints.ts    Street names and the complaints feed
    cityView.ts      Read-only city questions for the UI (service levels, land value, ...)
    cache.ts         rebuildCache(): derived indexes recomputed from saved state
    events.ts        SimEvent union (notifications out of the sim)
    serialize.ts     SimState <-> JSON body (RLE tile layers)
    hash.ts          FNV-1a state hash for determinism checks
    commands/        One file per command family: plan (pure) + apply (mutate)
                     (roads, zoning, bulldoze, facilities: power, water and depots, power lines,
                     water mains, assets: maintenance with permits, work order priority, crews,
                     bottled water, combining permits, budgets, tax rates, loans, event
                     preparations)
    systems/         Per-tick systems and the tick order (systems/index.ts)
  render/          Three.js only. Reads SimSnapshot; never mutates the sim.
    renderer.ts      GameRenderer: scene, layers, picking, invalidate()
    cameraRig.ts     Orbit/pan/zoom camera maths, pitch clamped 30°–70°
    lighting.ts      Hemisphere + directional sun, day/night from game time
    layers/          terrain (ground, water, grid), roads, zones, buildings (incl.
                     facilities, farm fields, rotors), power (pylons, cables, street
                     lamps), water (pressure overlay), crews (vans, incident markers, work
                     sites), traffic (cosmetic cars, traffic overlay), preview/cursor; instanceBatch.ts (growable
                     InstancedMesh), shapes.ts (unit part geometries)
  ui/              HTML/CSS HUD. Talks to the game only through UiActions.
    hud.ts           Top bar, toolbar, status line, modals (saves, help, new game)
    inspector.ts     Tile inspector (incl. asset condition and maintenance buttons)
    inbox.ts         Incident inbox: incidents, work orders, roadworks/permit calendar, crews, KPIs
    budget.ts        Budget panel: accounts, department budgets, tax rates, loans, backlog
    cityPanel.ts     City panel: happiness factors, events calendar and preparations, complaints
    tools.ts         Toolbar tool definitions and shortcuts (data)
    shortcuts.ts     Controls list for the help panel
    toasts.ts, modal.ts, dom.ts, format.ts, styles.css
  app/             Glue. The only layer that knows sim, render, ui and platform.
    game.ts          Owns the Simulation, frame loop, autosave, keyboard, UiActions
    tickScheduler.ts Real time -> sim ticks per speed (pure, tested)
    toolController.ts Pointer -> tool previews and commands
    cameraInput.ts   Keyboard/mouse camera controls
  platform/        Browser services
    saveFormat.ts    Save envelope, version, migrations, parse/validate
    saves.ts         IndexedDB slots (slot1..3 + autosave)
    fileTransfer.ts  JSON export (download) and import (file picker)
    settings.ts      localStorage settings
    pwa.ts           Service worker registration
  data/            JSON content: game.json, roads.json, zones.json, weather.json,
                   buildings.json, power.json, water.json, growth.json, assets.json, traffic.json,
                   services.json (services, landmarks, events, fire), economy.json, city.json
                   (pollution, land value, happiness, complaints, street names)
tests/             Vitest, mirroring src/ (sim/, platform/, app/)
scripts/gen-icons.mjs  Generates PWA icons from code
```

### Dependency rules (enforced)

- `src/sim` imports only itself and `src/data`. ESLint forbids `three`,
  `render/`, `ui/`, `platform/` and `app/` imports there, and
  `tsconfig.sim.json` type-checks it **without the DOM library**.
- `src/render` may import `sim` (types, data, helpers). Never `ui`.
- `src/ui` may import `sim` (types, data, pure helpers) and platform _types_.
  ESLint forbids `three` there. It never mutates state; it calls `UiActions`.
- `src/app` wires everything together.

## Data flow

```
 input (DOM)          ┌──────────── app/Game ────────────┐
   │                  │                                   │
   ▼                  │  UiActions / ToolController       │
 ui/Hud ──actions──►  │        │ Command                  │
                      │        ▼                          │
                      │  sim.dispatch(cmd) ──► SimState   │
                      │  sim.step() x N (frame budget)    │
                      │        │ snapshot()   │ events    │
                      │        ▼              ▼           │
                      │  render/GameRenderer  autosave,   │
                      │  ui/Hud.update        toasts      │
                      └───────────────────────────────────┘
```

- **Commands** are the only way in. `dispatch()` plans then applies, charges
  the cost, bumps layer revisions and logs `{tick, command}`. `preview()` runs
  the same plan without applying it, so previews always match the result.
- **Snapshots** are read-only views (`SimSnapshot`). In v1 they share the
  state's typed arrays (no copy). If the sim moves to a worker, `snapshot()`
  becomes a message with copied/transferred arrays; consumers do not change.
- **Revisions** (`terrain`, `road`, `zone`, `building`, `power`, `supply`, `water`, `assets`,
  `traffic`) let
  render layers rebuild only when their layer changed. Commands bump them via
  `plan.layers`; systems call `ctx.touch(layer)` (growth bumps `building`, the
  power dispatch bumps `supply` when any building gains or loses power; the water
  system bumps `water` after every solve step; the incidents system bumps `assets`
  while crews move or work changes; the traffic system bumps `traffic` when a round
  finishes). After
  replacing the Simulation call `renderer.invalidate()`.
- **Events** (`SimEvent`) are notifications drained once per frame
  (`drainEvents()`), e.g. `dayStarted` triggers autosave.

## Frame loop and timing

- 1 sim tick = 1 game minute. At 1x the sim runs 2 ticks per real second
  (`game.json: ticksPerRealSecondAt1x`), so a day is 12 real minutes. Speeds
  are pause, 1x, 2x, 4x (`game.json: speeds`).
- `TickScheduler` turns frame time into due ticks; `Game.stepSim` runs them
  inside a **4 ms budget** and refunds the rest. Backlog is capped at 1 s.
- Heavy work in later milestones (traffic assignment, network recalculation)
  must be sliced across ticks inside its system.

## Sim tick order

Defined in `src/sim/systems/index.ts`. Commands dispatched between frames are
applied immediately and logged at the current tick, i.e. before the next tick.

| #   | System    | Milestone | Notes                                                                                                         |
| --- | --------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | clock     | 1         | tick++, minute++, emits `dayStarted` at midnight                                                              |
| 2   | weather   | 2         | Midnight: events end/start, day roll. Each hour: showers, wind/cloud targets. Every tick: temperature, sun    |
| 3   | demand    | 2         | Hourly: zone demand (-1..1) from city totals                                                                  |
| 4   | power     | 2         | Every `dispatchIntervalMinutes` (5): loads, renewables → gas → batteries, priority/rota shedding, `unpowered` |
| 5   | water     | 3         | Midnight: reset daily abstraction. Round every 5 min (tick % 5 = 2): one network per tick, then finish step   |
| 6   | traffic   | 5         | Tick % 15 = 1 starts a round (trip table fixed); origin cells within `nodesPerTick` per tick; finish: blend   |
| 7   | assets    | 4         | Every tick: decay sweep of `ceil(tiles / 1440)` tiles (cursor saved): condition loss, failure rolls           |
| 8   | incidents | 4         | Every tick: crew arrivals, finished work, dispatch (permit slots), overflow, overruns. Tick % 5 = 4: impacts  |
| 9   | fire      | 6         | :33 each hour: ignition roll. Every tick while fires burn: engines on site, growth/suppression, end of fires  |
| 10  | events    | 6         | Midnight: book events at landmarks. Every tick: crowd windows open/close (road closures), outcomes            |
| 11  | services  | 6         | :07 each hour: capacity ratios (and land value services). 07:17: waste collection, recycling, landfill, bins  |
| 12  | growth    | 2         | Every tick: scan `scanTilesPerTick` tiles and maybe add buildings (commute, land value). Hourly: occupancy    |
| 13  | pollution | 6         | :03 each hour: air and noise grids                                                                            |
| 14  | economy   | 6         | Month start: loans, file accounts. :51: tariffs, fuel, upkeep, wages, crews on duty. 01:30: auto maintenance  |
| 15  | happiness | 6         | From :10 each hour: residents round (300 buildings per tick: taxes, happiness). :44: complaint checks         |

The hourly M6 steps sit on different minutes, clear of the power dispatch ticks
(minute % 5 = 0), so no single tick carries two of them. Fire runs after
incidents so an engine that arrives this tick fights the fire this tick. Events
run before services so the morning collection sees yesterday's event litter.
Pollution reads only saved state (gas stations by rating, not dispatch output,
which is not saved).

Weather runs straight after the clock so every later system sees this
minute's weather. Power runs before water (pumps and works need power; water
reads `unpoweredMinutes` from the latest dispatch) and both run before growth,
so new growth sees current supply. The water round starts at tick % 5 = 2, so a
network solve never shares a tick with the power dispatch (tick % 5 = 0).
Traffic runs after water and before assets so a finished round's road loading
(`peakLoad.road`) is in place for the decay sweep; travel times only change when a
round finishes or closures change, so crews dispatched later in the same tick use
them. Assets run after water so the decay sweep sees the latest peak loads; incidents
run after assets so a new failure is dispatched in the same tick, and the impact
count (tick % 5 = 4) reads the supply state the dispatch and the solve just set.

## Coordinates and units

- Tile `(x, y)` covers world `x..x+1`, `z = y..y+1`; tile centre is
  `(x + 0.5, 0, y + 0.5)`. World Y is up. Tile index = `y * width + x`.
- 1 tile = 25 m (`game.json: metresPerTile`). Map is 128×128 tiles (3.2 km).
- Money is whole pounds (£). Text is British English.

## World representation

`WorldState` holds flat `Uint8Array` layers:

| Layer    | Values                                                            |
| -------- | ----------------------------------------------------------------- |
| terrain  | 0 land, 1 water                                                   |
| road     | 0 none, else road class `code` from `roads.json`                  |
| zone     | 0 none, else zone type `code` from `zones.json`                   |
| density  | 0 n/a, 1 low, 2 medium, 3 high                                    |
| power    | 0 none, else line type `code` from `power.json`                   |
| water    | 0 none, else main type `code` from `water.json`                   |
| pressure | whole metres of head at a main from the last solve (0 = no water) |
| traffic  | Uint16: PCU per hour on a road tile from the last assignment      |

Tile assets (one each for `road`, `main`, `line`; `world.condition.road` etc.):

| Layer     | Type   | Values                                                                                                                 |
| --------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| condition | Uint16 | condition × 100 (0..10000; 0 where there is no asset)                                                                  |
| laid      | Uint16 | game day (1-based) the asset was laid or replaced (0 = none)                                                           |
| peakLoad  | Uint8  | peak load % since the last daily decay (mains: flow / capacity; lines: island loading; roads: traffic flow / capacity) |

Numeric codes are defined in the data files and must never be reused or
renumbered, because saves store codes.

### Buildings

`SimState.buildings` is a list (ascending `id`) of `{ id, code, x, y,
occupancy, unpoweredMinutes, storedMWh, storedMl, dryMinutes, condition,
builtDay, peakLoad }`. `code` refers
to a grown building type (`buildings.json`, codes 1–199), a power facility
(`power.json`, codes 200–299), a water facility (`water.json`, codes 300–399) or
a depot (`assets.json`, codes 400+);
`data.ts#buildingDef(code)` looks up any of them. Facility defs carry
`utility: 'power' | 'water' | 'depot'`. `(x, y)` is the
footprint's top-left tile. Residents and jobs are aggregates
(`def.residents × occupancy`); there are no individual citizens. A building is
powered when `unpoweredMinutes === 0` and has water when `dryMinutes === 0`.

### Derived cache

`SimState.cache` holds data derived from the saved fields and is never saved:
tile → building id, id → building, tile → estate id, the power network
(islands, substation feed limits, tile coverage), the last dispatch figures
(per-building load, per-facility output, city totals), the water layout
(`rebuildWater()`: tile → network, pressure zone and sewer network) and the
last water figures (UI only: flows, uses, city stats), and the fault cache
(`rebuildFaults()`: per-tile fault bits, facilities out of service, asset →
incident / work order indexes) derived from open incidents and on-site work, and
the traffic cache (`rebuildTraffic()`: road segments, travel times and capacities
from the saved flows and closures, crew slow-down factors, permit clashes, building
access tiles), and the services cache (`rebuildServices()`: coverage minutes and nearest
facility per road tile, served shares, landmarks, land value parts). `rebuildFaults()` refreshes the travel times, so closures take effect
at once. `rebuildCache()` runs
on new game and on load; commands call `rebuildEstates()` / `rebuildNetwork()`
when they change zoning, lines or facilities. Everything in it must be a pure
function of saved state, or a loaded game would diverge.

### Power model

- Nodes are line tiles and facility footprints; 4-adjacent nodes connect, and
  each connected group is an island with its own generation.
- A substation can draw `min(its capacity, the weakest line on its best route
from a generator)`, found by flooding from generators once per line rating
  (widest path). Several substations sharing one line are not limited jointly.
- Each tile is served by the nearest substation within `serviceRadius`; a
  building is served via its footprint centre tile. Growth needs an energised
  substation in range.
- Load per building: `powerKw × zone curve(hour) × temperature factor ×
(vacant share + rest × occupancy)`.
- Dispatch: renewables (solar × sunshine, wind power curve with cut-out), then
  gas, then batteries. Spare capacity charges batteries. When an island or a
  substation is short, buildings are served in order of `priority` (0 first:
  hospitals in M6) then rota block (`id % blocks`, rotating every
  `rota.minutes`), so outages roll.

### Water model

Data lives in `water.json` (units: l/s, Ml, metres of head).

- **Layout** (`rebuildWater`, on layout changes): main tiles and water-facility
  footprints that touch form a network; boosters split a network into pressure
  zones. Sewers are implicit under every road: road tiles plus sewage works
  footprints form sewer networks. Every road is laid with a 150 mm
  distribution main; the main tool lays feeder (300 mm) or trunk (600 mm) mains,
  on or off road, and never downgrades.
- **Customers** connect to the first main in the ring around their footprint
  (`connectionRange` 1) and drain to the first road in that ring. Demand =
  `waterLpd` × zone hourly curve (normalised to mean 1) × temperature factor ×
  occupancy; farms add irrigation/livestock (`irrigationLpd` × season × heat ×
  heatwave, nothing on rainy hours for arable).
- **Supply** per network: output `P = min(powered intakes, powered works)`.
  If `P ≥ demand`, spare output refills reservoirs and towers; otherwise
  storage covers the gap and any remainder is a deficit. Abstraction counts
  against the day's licence (sum of intake licences; breaches are reported, not
  enforced).
- **Pressure** (friction-loss, not a solver): sources (powered works with
  output, storage holding water) give their footprint a head; a max-head
  label-correcting search spreads head along the mains, each main tile losing
  `0.025 km × (baseLoss + lossAtCapacity × (flow/capacity)²)`. Flows come from
  sending each connection's demand back up the route tree. Route with no flow,
  load, re-route with those losses, load again, then recompute heads along the
  final tree. A booster adds `boostM` to everything it feeds and never feeds back
  into its inlet zone. A deficit scales source heads by `(1 - unmet share)²`.
  Heads are rounded into `world.pressure`. A connection below `noSupplyM` (5 m)
  is dry, below `lowM` (15 m) low pressure.
- **Round**: one solvable network (with a works or storage) per tick, then a
  finish step: clear pressure where nothing can reach, mark customers off the
  mains dry (farms by the river use it), farm irrigation from the river against
  its own daily licence (stops at the cap and falls back to the mains), sewage
  (dry-weather flow + `rain × (road + roof tiles) × runoff`) against powered
  works capacity, spills and events. Each step reads only saved state, so a
  save made mid-round continues identically.
- **Growth** needs a main with at least `lowM` beside the footprint (farms may
  use the river instead). Occupancy falls after `outageGraceMinutes` dry.
- **Power**: water facilities are power consumers with a constant `powerKw` at
  priority 1 and stop when unpowered (towers draw nothing).

### Assets, incidents and crews

Data lives in `assets.json`.

- **Assets**: every road, main and line tile (class by layer and code) and every
  power or water facility (class by `kind`) has a condition 0–100 and an age.
  Depots do not decay. The daily sweep (one visit per tile per day) takes off
  `decayPerDay + loadDecayPerDay × load²`, where load is the peak share since the
  last visit (water solve: main flow / capacity, works and intakes output /
  capacity; power dispatch: plant output / capacity, substation load / capacity,
  and for line tiles the island's worst substation load / feed). Then it rolls
  for failure: `failureCurve(condition) × failureScale × weather multiplier`
  (cold snap ×4 for mains, storm ×3 for lines). Assets with an open incident or
  a crew on site do not roll.
- **Incidents**: a failure opens an incident (burst, cable fault, road defect,
  facility fault) with a base severity and SLA, plus a repair work order for the
  class's crew type. Storm overflows open an `overflow` incident (no crew) that
  clears itself. Every 5 minutes customers without supply are counted
  (households = residents / 2.4, one per other building): a water incident counts
  dry customers in its water network, a power incident the customers without
  power in the islands next to the fault. Severity = base + one per customer
  step (50, 250) + one if priority customers are cut off (dropped again once
  bottled water is sent), 1–4. City customer-minutes count each customer once.
- **Effects** (fault bits, derived): a burst main takes water in, leaks
  `burstLeakFraction × capacity` and passes none on (pressure downstream falls);
  once a crew is on site it is isolated (no leak, no flow) and the road over it
  is closed. A cable fault or line work removes the tile from the power
  network. A facility fault or overhaul takes the facility out of service.
  Resurfacing closes the road (fully or one lane; see Roadworks and permits), and
  traffic re-routes round closures.
- **Work orders**: repairs (priority from severity unless the player set one,
  paid on completion, restore condition to at least 60) and planned maintenance
  (raised by the player, paid up front, refunded if cancelled, restore to 100).
  Queued orders go to the nearest free crew of the right type (idle or heading
  home), most urgent first. Repairing a main under a road wears the road a
  little (patching).
- **Crews**: each depot houses `crews` crews. A crew at its depot mobilises
  (30 min), then drives the fastest road route (road speeds × congestion)
  with short off-road legs to and from the road, or straight across country at
  8 km/h if no road connects. Route, depart and arrive minutes are saved, so
  positions are interpolated for rendering and diverting.
- **KPIs** (`assets.kpi`): incidents, repairs and total repair minutes (MTTR),
  SLA met/missed, customer-minutes all time, today and yesterday.

### Traffic model

Data lives in `traffic.json` (curves, trip rates, BPR, budgets, roadworks factors,
cars, overlay); road capacity, speed, lane-closure capacity and the repair closure
per class are in `roads.json`.

- **Cells.** The map is cut into 8×8-tile traffic cells (16×16 on a 128 map).
  Each building loads onto the first road tile beside its footprint; a cell's trips
  start and end at its busiest access tile.
- **Trips** (PCU per hour, for the current hour): outbound from homes (1 per
  resident a day × outbound curve, peak 08:00) towards jobs and shops (shops
  attract 1.5× their jobs as visitors); return trips produced by jobs and shops in
  proportion to their attraction, balanced to the city's outbound total (peak
  17:00), back to homes; freight from industrial and commercial jobs at 2.5 PCU per
  lorry; farm traffic at 3 PCU per tractor. Destinations follow a gravity model
  `attraction × exp(-minutes / 12)` over congested travel time from the origin.
- **Assignment.** A round starts every 15 minutes (when idle) and fixes its trip
  table (`traffic.table`, saved, rounded to 0.01). Each tick runs origin cells in
  index order until `nodesPerTick` (8,000) road tiles have been settled: one
  shortest-path tree by current travel time per origin, trips pushed back up the
  tree, flows added to `traffic.pending` (saved, 1/16 PCU). The finish step blends
  the new flows into `world.traffic` (`flow += 0.5 × (new − flow)`, which damps
  oscillation between routes), records `flow / capacity` into `peakLoad.road`,
  stores trips per hour, mean trip time and the congestion index (congested ÷
  free-flow trip minutes), and refreshes the travel times. Each origin's mean
  outbound trip time is saved per cell (`traffic.commute`): growth's spawn chance is
  scaled down from 15 to 40 minutes (to 25%).
- **Travel time** per road tile = free-flow time × BPR `1 + 0.15 (v/c)^4`
  (`v/c` capped at 3). A full closure makes a tile impassable; a lane closure
  multiplies capacity by `laneClosureCapacity` (35% local, 50% avenue, 67% highway).
  Trips that cannot reach any destination are counted as unserved.
- **Crews** route by free-flow time × the tile's BPR factor (capped at 4×), so they
  avoid and are slowed by jams; they still pass closures (decision 54). Positions
  along a route are interpolated in proportion to free-flow leg times.
- **Cars** are cosmetic (render only): each road tile shows up to 4 cars, one per
  120 PCU/h (rounded by a per-tile hash), looping along the road at the congested
  speed, hidden on closed tiles.

### Roadworks and permits

- **Closures.** Every work order has a `closure`: `full` or `lane` for work on a
  road tile or a main under one, `none` otherwise. While the crew is on site the
  tile gets `FAULT.ROAD_CLOSED` or `FAULT.LANE_CLOSED`. Emergency repairs use the
  road class's `repairClosure` (full on local roads, one lane on avenues and
  highways); planned works use the tool's choice (full by default; a lane closure
  takes 1.25× as long).
- **Permits** (`state.permits`): a booked slot `[start, end)` on one or more road
  tiles, for a set of orders. Emergency repairs get one at once; planned works are
  booked now or for tonight (next 20:00; night works cost 1.5× and take 1.3× as
  long). `end = start + 60 min + Σ per crew type ceil(orders / crews) × longest
job`. A crew is not sent before `start`. The permit ends when its last order is
  done or cancelled; works still going after `end` are flagged as overrunning
  (counted once).
- **Segments** are runs of road between junctions (tiles with 3+ road neighbours,
  which are segments of their own), derived in `cache.traffic.segmentAt`.
- **Clashes.** Two permits clash when they share a segment and their slots
  overlap (derived; counted once, with an event, when a new permit clashes).
- **Combining.** Booking planned works on a segment that already has a permit
  (combine on, the default) joins that permit: one closure, 25% off the joining
  works, and the permit's end is extended. Resurfacing booked with main works on the
  same tile is discounted the same way. Resurfacing waits for main works on its tile
  under the same permit, and takes half the time once that dig is done (`permit.dug`).
  The `combinePermits` command merges a clashing permit into another on the same
  street (planned works refunded 25%).

### Services (milestone 6)

Data lives in `services.json`. Fire stations, police stations, health centres,
schools, waste depots, recycling centres and landfill sites are facilities
(codes 500+, `utility: 'service'`); landmarks are too (stadium, shopping centre,
hospital, university, conference and events centre, codes 510+). They draw power
and water as customers (their `zone` picks the demand curve; the hospital is a
priority customer), pay no zone taxes, and have upkeep and jobs.

- **Coverage** (`cache.services`, derived): one multi-source search per service
  kind over the road network by free-flow time from the roads around every
  facility of that kind, bounded at `maxMinutes`, gives each road tile the
  minutes to the nearest facility and its id. A building uses its traffic access
  tile. Quality falls from 1 within `goodMinutes` to 0 at `maxMinutes`. Rebuilt
  when roads or service facilities change.
- **Capacity** (saved hourly in `services.ratios`): each police station, health
  centre or hospital, school and waste depot serves the buildings whose nearest
  facility it is (residents, pupils, tonnes); ratio = capacity × services budget ÷
  load, capped at 1. Service level = quality × ratio × (½ while the facility has
  no power or water).
- **Waste** (daily 07:17): tonnes produced by residents and jobs (plus event
  litter) are collected by depots up to their capacity, recycling centres take the
  recyclable share, the rest goes to landfill until it is full (`services.landfill`
  tonnes per site). `services.tipping` is the share that could be tipped. A
  building's bins are missed when out of reach or beyond its depot's ratio ×
  tipping (by a fixed hash of its id, so it is a pure function).
- **Fire** (`fire.ts`): see the module header. Fire engines are crews of type
  `fire` at fire stations (mobilise in 2 minutes); each fire gets one
  `firefighting` work order per appliance needed. Engines park on the access road
  (closed while they work) and draw `hydrantLps` each from the nearest main
  (water.ts adds it to that network's demand, so neighbours' pressure falls).
  Suppression scales with the hydrant pressure (or tank water only).

### Events calendar

See `cityEvents.ts`. Each landmark lists the event types it hosts. Events are
booked at midnight (`state.events`), live during their crowd window, add
`eventIn` / `eventOut` trips to the traffic round (homes → venue before, venue →
homes after), multiply the venue's power and water load while on, add crowd
noise, and are judged at the end: crowd trouble if `crowdRisk × (1 − police)`
exceeds 0.3 (police = the local station's level, or 1 with extra policing; road
closures halve the risk), litter unless street cleaning was booked, and a levy
per attendee. Preparations (`prepareEvent`) are booked and paid while the event
is booked; road closures are fault bits derived from live events in
`rebuildFaults`.

### Pollution and land value

Hourly (`pollution.ts`): sources summed per 4×4-tile cell (buildings with
`pollution` emissions × occupancy, gas stations in service by rating, sewage
works, landfill and recycling, traffic flows and highways, fires, live events),
spread with a separable exponential falloff, saved ×10 as Uint16 grids (32×32 on
a 128 map). Tiles sample bilinearly. Land value = base + services score of the
road it is served from (cached per road tile) + river and landmark lift (cached
per tile from the layout) − air and noise penalties.

### Economy

See `economy.ts`. All cash changes outside command costs go through `ledger.ts`
(`spend`, `earn`) onto the month's ledger lines; `executeCommand` books command
costs by command type (capital, maintenance, services). Taxes are collected
hourly in the residents round; tariffs (electricity MWh served, water Ml supplied,
metered by the dispatch and the solve), gas, upkeep and crew wages are settled at
:51. Department budgets (50–150%) scale upkeep and service capacity, set crews on
duty (`round(crews × level)`, at least 1; extra crews stand down when idle), fund
a daily automatic maintenance allowance (night works on the worst assets below
45%), and below 100% multiply asset decay. Fines: licence breach, spills per Ml,
permit clashes and overruns. Loans are annuities, paid monthly with interest.

### Happiness and complaints

Each hour the residents round (`happiness.ts`) visits every building in id order,
300 per tick, collecting an hour of its taxes and adding each home's weighted
factors (services, utilities, bins, commute, pollution, council tax, land value)
to saved partial sums; the city figure is published at the end, less a point per
complaint in the last day. It scales residential demand. Complaints are made from
real events: long outages per incident (at 3/6/12/24 hours for water, 2/4/8/16
for power), low pressure, power cuts, fumes, noise, missing school places, jams,
missed bins, fires, roadworks clashes and events, with the street named. Each
has a key and a cooldown, and the feed keeps the newest 40.

### Weather model

Seasonal means in `weather.json` are interpolated with cosine easing between
mid-season days. Each midnight rolls: weather events (heatwave in summer, cold
snap in winter, storm in autumn/winter; off when `rules.weatherEvents` is
false), a temperature anomaly with persistence, wet/dry, cloud and wind
levels. Each hour rolls showers and the next hour's wind and cloud targets;
each tick interpolates them and computes temperature (daily cycle peaking at
15:00) and solar irradiance (seasonal day length, cloud loss).

## Save format

Saves are JSON (`platform/saveFormat.ts`), stored in IndexedDB database
`uptime-city-saves`, object store `saves`, keys `slot1`, `slot2`, `slot3`,
`autosave`. Export/import uses the same JSON.

```jsonc
{
  "format": "uptime-city-save",
  "version": 6,
  "meta": { "gameName", "label", "savedAt", "day", "minute", "cash", "seed" },
  "state": {
    "seed": 123, "tick": 0, "minute": 360, "rngState": 987654, "cash": 250000,
    "rules": { "weatherEvents": true },
    "world": {
      "width": 128, "height": 128,
      "terrain": [v, run, v, run, ...],   // run-length encoded
      "road": [...], "zone": [...], "density": [...], "power": [...],
      "water": [...], "pressure": [...], "traffic": [...],
      "condition": { "road": [...], "main": [...], "line": [...] },   // RLE, Uint16
      "laid": { "road": [...], "main": [...], "line": [...] },        // RLE, Uint16
      "peakLoad": { "road": [...], "main": [...], "line": [...] }     // RLE, Uint8
    },
    "buildings": [[id, code, x, y, occupancy, unpoweredMinutes, storedMWh, storedMl, dryMinutes,
                   condition, builtDay, peakLoad], ...],
    "nextBuildingId": 42,
    "estates": [{ "id": 1, "name": "Riverside Trading Estate", "anchor": 8457 }],
    "nextEstateId": 2,
    "weather": { "temperatureC": 11.2, "windMs": 4.1, "event": null, ... },
    "demand": { "residential": 0.4, ... },
    "growthCursor": 9120,
    "water": { "cursor": -1, "abstractedTodayMl": 3.2, "farmAbstractedTodayMl": 0.4,
               "irrigationCapped": false, "licenceBreached": false, "overflowing": false,
               "spillMl": 0, "supplyAlert": false, "priorityAlert": false },
    "assets": { "cursor": 812, "nextIncidentId": 4, "nextOrderId": 6, "nextCrewId": 3,
                "kpi": { "incidents": 3, "repairs": 2, "repairMinutes": 610, ... } },
    "incidents": [{ "id": 3, "kind": "burst", "title": "...", "asset": { "layer": "main", "id": 2601 }, ... }],
    "workOrders": [{ "id": 5, "type": "repair", "crew": "water", "status": "enRoute", ... }],
    "crews": [{ "id": 1, "type": "water", "depot": 12, "status": "enRoute", "path": [...], ... }],
    "traffic": { "cursor": -1, "table": { "load": [...], "prod": {...}, "attr": {...} },  // RLE
                 "pending": [...], "commute": [...],                                   // RLE
                 "tripsPerHour": 1234, "avgTripMinutes": 4.2, "congestion": 1.08, ...,
                 "nextPermitId": 7, "kpi": { "permits": 6, "clashes": 1, "combined": 2, ... } },
    "permits": [{ "id": 6, "kind": "planned", "tiles": [...], "start": 9840, "end": 10500,
                  "night": true, "closure": "full", "orders": [12, 13], "overrun": false,
                  "combined": true, "dug": [] }],
    "economy": { "budgets": { "roads": 1, ... }, "taxRates": { "residential": 1, ... },
                 "month": { "income": {...}, "expenses": {...}, "borrowed": 0, "repaid": 0 },
                 "lastMonth": null, "history": [...], "meter": {...}, "loans": [...], "nextLoanId": 1 },
    "services": { "ratios": [[7, 1]], "tipping": 1, "landfill": [[11, 17.1]], "waste": {...},
                  "fireKpi": {...}, "nextFireId": 1, "nextEventId": 3, "nextComplaintId": 5 },
    "fires": [{ "id": 1, "building": 40, "tile": 2580, "hydrant": 2452, "intensity": 31.5, ... }],
    "events": [{ "id": 2, "type": "match", "venue": 12, "start": 3780, "end": 3900,
                 "attendance": 16095, "measures": ["policing"], "status": "booked", ... }],
    "complaints": [{ "id": 4, "minute": 2650, "kind": "water", "text": "No water on ...",
                     "tile": 2580, "key": "out:3:3" }],
    "happiness": { "city": 72.5, "factors": {...}, "complaintPenalty": 1, "cursor": -1,
                   "sumWeight": 0, "sumScore": 0, "sumFactors": {...} },
    "pollution": { "air": [...], "noise": [...] }                          // RLE, Uint16 ×10
  }
}
```

Version history: 1 = milestone 1 (terrain, roads, zones); 2 = milestone 2
(power layer, buildings, estates, weather, demand, rules); 3 = milestone 3
(water and pressure layers, building `storedMl`/`dryMinutes`, water state); 4 =
milestone 4 (asset condition/laid/peak-load layers, building condition, built day
and peak load, asset state, incidents, work orders, crews); 5 = milestone 5 (traffic
layer, traffic state and trip table, permits, work order closure/night/permit/combined); 6 =
milestone 6 (economy, services, fires, events, complaints, happiness, pollution, `rules.fires`,
event trip purposes).
The v1 → v2 migration adds empty buildings and lines and default weather. The
v2 → v3 migration lays a distribution main under every existing road and adds
zeroed water fields. The v3 → v4 migration gives every existing asset
`assets.json: migrationCondition` (100), laid on the save's day, and empty
incidents, orders and crews. The v4 → v5 migration adds zero flows, an idle traffic
state and no permits; existing work orders on roads keep a full closure without a
permit. The v5 → v6 migration adds full budgets and standard tax rates, empty
accounts, services, fires, events and complaints, zero happiness and pollution,
random fires on, and empty event trips in the traffic round.

- To change the state shape: bump `CURRENT_SAVE_VERSION` and add
  `MIGRATIONS[oldVersion]` that returns the next version. Migrations run in
  sequence on load; the body is then validated by `deserializeState`.
- Saves from a newer version are rejected with a clear message.
- The command log is **not** saved (it is for replays/tests within a session).

## Determinism

- All randomness comes from `state.rng` (or a stream derived with
  `seedState(seed, stream)`, as map generation does). Never `Math.random()`
  or wall-clock time in `src/sim`.
- Iterate in index order; avoid iterating object keys whose order depends on
  insertion from non-deterministic sources.
- `hashState()` hashes the serialised state. Tests assert that the same seed
  and commands give the same hash, that `replay()` reproduces a game, and that
  a loaded save continues identically.

## Rendering

- Low-poly, flat colours, Lambert materials, no textures or post-processing.
- Per-tile things use `InstancedMesh` sized for the whole map
  (`layers/tileInstances.ts`) with per-instance colour.
- One hemisphere + one directional light; the sun and sky follow game time.
  Shadows are a setting (default off).
- Roads over water render as raised bridge decks.
- Buildings are drawn from the model `parts` in the data files (box, gable
  roof, cylinder, polytunnel, rotor), one growable `InstancedMesh` per shape
  (`layers/instanceBatch.ts`). Colour lists and height jitter vary by building
  id (render-side hash, not the sim RNG). The buildings layer rebuilds on
  `building`/`supply`/`power` revisions or a season change, at most every
  300 ms while the city grows.
- Night: window bands and street-lamp heads use emissive materials whose
  intensity follows `1 - daylight(minute)`. Unpowered buildings' windows go
  into an unlit batch, so outages are visible after dark; lamps are lit where
  an energised substation covers the road.
- Farm footprints are field tiles coloured by farm type and season
  (`buildings.json: fieldColours`).

## Milestone plan

1. **Scaffold** — Vite/TS/Three/Vitest/ESLint/Prettier, PWA, CI + Pages
   workflows, grid + river, camera, roads and zoning tools, bulldoze, save/load
   (3 slots + autosave, export/import, versioned with migrations), docs.
2. **Sim core** — calendar and seasons, weather model and events, demand
   curves, buildings and growth (incl. farms, industrial estates), power
   (plants, substations, lines, shortfall rolling outages), day/night window
   and lamp emissives.
3. **Water** — intake → treatment → reservoirs/towers → mains along roads,
   pressure zones, friction-loss pressure model, boosters, priority customers,
   wastewater and storm overflows, irrigation and abstraction licence.
4. **Assets and incidents** — condition/decay/failure, incidents with SLA,
   work orders, crews from depots travelling on roads, MTTR, customer-minutes.
5. **Traffic and roadworks** — trip generation, BPR assignment sliced across
   ticks, cosmetic cars, closures, planned/reactive roadworks, permits. **Done.**
6. **Services and economy** — fire/hydrants, police, health, schools, waste,
   landmarks, events calendar, pollution, budgets, loans, happiness, complaints. **Done.**
7. **UI** — overlays, KPI dashboard, menus and settings, scenarios, polish.
8. **Performance and docs** — profiling pass, final documentation review.

## Decision log

| #   | Milestone | Decision                                                                                                                     | Why                                                                                                                     |
| --- | --------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | M1        | TypeScript pinned to ~6.0                                                                                                    | typescript-eslint does not yet support TS 7.                                                                            |
| 2   | M1        | Roads, zones and density are per-tile `Uint8Array` layers with numeric codes from JSON                                       | Compact, fast to scan, trivially serialisable; codes stay stable for saves.                                             |
| 3   | M1        | Road drag lays an L-shaped path (longer axis first)                                                                          | Simple, predictable grid tool; straight drags give straight roads.                                                      |
| 4   | M1        | Roads may cross water as bridges at 5× cost (`roads.json: bridgeCostMultiplier`)                                             | The river splits the map; without bridges half the map is unreachable.                                                  |
| 5   | M1        | Building a road over zoning removes the zoning; zoning skips roads and water                                                 | Avoids ambiguous tiles. Later, buildings will block roads instead.                                                      |
| 6   | M1        | Agricultural zoning only within 20 tiles of the map edge (`game.json: agriculturalEdgeBand`)                                 | Spec: farms "towards the map edges". River is kept 24+ tiles from the edges.                                            |
| 7   | M1        | Commands apply immediately and are logged at the current tick                                                                | Lets the player build while paused; replay applies them before the next tick, so determinism holds.                     |
| 8   | M1        | Command handlers are split into `plan` (pure) and `apply`                                                                    | One code path for previews and execution, so previews cannot drift.                                                     |
| 9   | M1        | Save tile layers run-length encoded in JSON                                                                                  | Readable, exportable JSON that stays small (a few KB).                                                                  |
| 10  | M1        | 1 tile = 25 m                                                                                                                | Gives a 3.2 km map; plausible for a town with farmland at the edges.                                                    |
| 11  | M1        | Sim runs on the main thread with a 4 ms/frame budget; snapshots share arrays                                                 | Spec allows it for v1; `SimSnapshot` keeps the worker move open.                                                        |
| 12  | M1        | No main menu yet: the game boots straight into a new random-seed city; New game / Save / Load are in the top bar             | Main menu and settings panel are M7.                                                                                    |
| 13  | M1        | Hand-written IndexedDB wrapper; `fake-indexeddb` for tests                                                                   | No runtime dependency needed for four keys.                                                                             |
| 14  | M1        | PWA icons generated by `scripts/gen-icons.mjs` and committed                                                                 | No external art; reproducible.                                                                                          |
| 15  | M1        | The game keeps running while modals are open                                                                                 | Matches the time controls; the player can pause with Space. Revisit in M7.                                              |
| 16  | M2        | Calendar: 4 seasons × 30 days = 120-day year, starting in spring                                                             | Seasons long enough to feel (a season is 6 real hours at 1×) without years taking weeks.                                |
| 17  | M2        | Buildings are a list of records plus a derived tile index (`cache`), not a per-tile layer                                    | Multi-tile footprints, per-building aggregates and stable ids for later incidents and inspection.                       |
| 18  | M2        | Derived data lives in `SimState.cache`, rebuilt on load; it must be a pure function of saved state                           | Keeps saves small and avoids saving indexes that can drift; determinism holds after load.                               |
| 19  | M2        | Growth needs zoning, positive demand, a road beside the footprint and an energised substation in range                       | Spec ties growth to utility service. Land value (M6), services (M6) and commutes (M5) join later.                       |
| 20  | M2        | Roads and re-zoning over grown buildings demolish them (preview shows them orange); facilities block roads/zones             | Spec: building over farmland removes the farm. Facilities are deliberate investments.                                   |
| 21  | M2        | Power lines may share tiles with roads; they clear zoning and are blocked by grown buildings                                 | Lines along streets are normal; blocking avoids silent demolition by a cheap line drag.                                 |
| 22  | M2        | Substation feed = min(capacity, weakest line on the best route); no shared line limits                                       | Gives line ratings meaning with a cheap widest-path search instead of a power-flow solver.                              |
| 23  | M2        | Substation coverage is straight-line distance (radius), not along roads                                                      | Low-voltage distribution is implicit; road-based coverage is reserved for services (M6).                                |
| 24  | M2        | Load shedding by priority then a rotating rota block (`id % 4`, rotates hourly)                                              | Simple, deterministic rolling outages; hospitals get priority 0 when they arrive in M6.                                 |
| 25  | M2        | Batteries charge from any spare capacity, renewables first, and discharge after gas                                          | Batteries cover peaks beyond gas capacity; no price model until the economy (M6).                                       |
| 26  | M2        | Industrial estates connect across one road or line tile; names persist via an anchor tile                                    | Estates have internal roads; anchors keep names stable when estates grow, merge or split.                               |
| 27  | M2        | Facility jobs count towards total jobs (residential demand) but not to any zone                                              | Power stations employ people without distorting zone demand.                                                            |
| 28  | M2        | Farm export income is defined (`exportPerDay`) but not paid yet                                                              | Income and costs arrive with the economy in M6.                                                                         |
| 29  | M2        | `rules.weatherEvents` (default on) is saved now; its sandbox toggle arrives with the menus in M7                             | Spec lists weather events on/off as a sandbox setting; cheap to carry from the start.                                   |
| 30  | M3        | Every road gets a 150 mm main (in the road's cost); a tool lays 300/600 mm mains on or off road, never downgrading           | Spec: "mains are laid along roads by default". Players upgrade busy routes instead of piping every street.              |
| 31  | M3        | Sewers are implicit under every road; no sewer tool. Sewage service is not needed for growth (untreated flow is reported)    | Keeps wastewater about capacity and storms; untreated discharge feeds pollution in M6.                                  |
| 32  | M3        | Pressure: best-head route tree, routed twice, loss per tile = length × (base + k·(flow/capacity)²)                           | Spec's simplified friction-loss model; gives distance and load effects without a hydraulic solver.                      |
| 33  | M3        | Per-tile pressure is saved (Uint8, whole metres); the solve runs one network per tick with a saved cursor                    | Growth and supply read saved state between solves, so loads mid-round stay deterministic.                               |
| 34  | M3        | Raw and treated water share the mains: intakes supply works in the same network; output = min(intakes, works)                | One pipe layer is simpler to build and read; no separate raw-water network.                                             |
| 35  | M3        | Reservoirs and towers start empty, fill from spare output, cover shortfalls, and give head while not empty                   | Storage is earned, not free water; it buffers peaks and outages at the works.                                           |
| 36  | M3        | A shortfall scales all source heads by (1 − unmet share)²                                                                    | Far ends lose pressure first, as in a real network that cannot keep up.                                                 |
| 37  | M3        | Boosters: fixed head gain, no backflow into the inlet zone, head fixed by the first feed, constant power load                | Simple zone separation; flow-scaled pump energy would need saving per-pump figures (see roadmap).                       |
| 38  | M3        | Water facilities draw a constant load at priority 1 (essential) and stop without power                                       | Ties water to power as the spec's interactions require.                                                                 |
| 39  | M3        | Two licences: public supply (sum of intakes, breach reported not enforced); farm irrigation (city-wide, enforced)            | Heatwave scenario scores licence breaches; farms stopping at the cap is the spec's irrigation rule.                     |
| 40  | M3        | Growth needs a main at ≥ 15 m beside the plot (farms may use the river); occupancy falls after 4 h without water             | Spec: growth depends on utility service; mirrors the power rule.                                                        |
| 41  | M3        | Priority water customers are buildings with power priority 0 (a care home now, hospitals in M6)                              | One flag for "critical"; M4 incidents will raise severity and send bottled water.                                       |
| 42  | M3        | Storm inflow = rain × (road + roof tiles) × 0.1 effective runoff; works rated 30 Ml/day                                      | Most runoff goes to surface-water drains; showers are absorbed, storms overflow a big city's works.                     |
| 43  | M3        | Water overlay is a simple toggle (O, or click the water chip) with a viridis ramp and a legend                               | Spec overlays arrive in M7; pressure needs to be visible now.                                                           |
| 44  | M4        | Tile asset condition is a Uint16 layer per utility (×100); facilities keep it on the Building record                         | Small daily losses (0.1 points) need sub-point precision; layers keep per-tile assets cheap to sweep and save.          |
| 45  | M4        | One sweep visits every tile once a day (`ceil(tiles / 1440)` per tick); facilities decay when their origin tile is visited   | Even, sliced work; no per-asset timers to save.                                                                         |
| 46  | M4        | Load wear uses the saved peak load since the last visit (main flow, plant output, island line loading)                       | Peak (not instant) load avoids time-of-day bias from where the sweep happens to be; saved so loads stay deterministic.  |
| 47  | M4        | Line loading is approximated per island as the worst substation load / feed limit                                            | No per-line flows exist (decision 22); the feed limit is set by the weakest line, so it stands in for line loading.     |
| 48  | M4        | Fault flags are derived from open incidents and on-site work orders (`rebuildFaults`), never saved                           | One source of truth (the incident and order lists); loads rebuild them, so saves cannot disagree.                       |
| 49  | M4        | A burst main keeps its place in the layout: it receives water, leaks, and passes none on; a crew on site isolates it         | Looped networks keep supply round the burst, branches lose it downstream, with no layout rebuild per burst.             |
| 50  | M4        | Customers are households (residents / 2.4) or one per business; incident counts are per affected network or island           | Readable numbers for severity and customer-minutes; attribution by network is cheap and close enough.                   |
| 51  | M4        | Severity = base + customer steps + priority customers (cancelled by bottled water), recomputed every 5 minutes               | Escalates with impact, and gives bottled water a visible effect.                                                        |
| 52  | M4        | Repairs are paid on completion (cash may go negative); planned maintenance is paid when raised and refunded if cancelled     | Emergency work cannot be refused; planned work is a budget decision.                                                    |
| 53  | M4        | Automatic dispatch to the nearest free crew by priority; the player can re-prioritise, divert a crew or cancel planned work  | The spec asks for crew assignment in the inbox without forcing micromanagement.                                         |
| 54  | M4        | Crews drive on all roads (ignoring closures), mobilise for 30 min from the depot, and drive off-road at 8 km/h where needed  | Works crews pass their own closures; mobilisation dominates realistic response times; never deadlocks.                  |
| 55  | M4        | Incident titles are saved with the incident                                                                                  | The UI can name incidents whose asset has gone, and from the snapshot alone.                                            |
| 56  | M4        | Maintenance takes the asset out of service while the crew is on site                                                         | Makes planned work a trade-off (a planned interruption), as in real networks; permits and night works are M5.           |
| 57  | M5        | Trips are aggregated per 8×8-tile cell and loaded at the cell's busiest access tile; intra-cell trips are ignored            | 256 origins keep a full-map round affordable; cells are small (200 m) so short local trips matter little to congestion. |
| 58  | M5        | Static assignment per round (one shortest-path tree per origin by current times), new flows blended 50% into the saved flows | Cheap and stable; the blend damps route flip-flopping between rounds (a method-of-successive-averages flavour).         |
| 59  | M5        | A round's trip table and partial flows are saved (`traffic.table`, `traffic.pending`)                                        | Sliced work must continue identically after load; recomputing the table mid-round would read changed buildings.         |
| 60  | M5        | Flows are two-way PCU/h per tile against the class's two-way capacity                                                        | Tiles carry both directions; directional flows would double the state for little gameplay.                              |
| 61  | M5        | Return trips are produced by jobs and shops, balanced to the city's outbound total                                           | Gives a believable evening peak without tracking where each morning trip went.                                          |
| 62  | M5        | Road closures apply while a crew is on site, not for the whole permit slot                                                   | Matches the existing fault model; one closed tile already blocks its segment, so re-routing is the same.                |
| 63  | M5        | Emergency repairs close one lane on avenues and highways, the whole road on local roads (`roads.json: repairClosure`)        | Realistic traffic management; makes road class matter for disruption.                                                   |
| 64  | M5        | Night works = permit slot from 20:00 (no other time restriction); ×1.5 cost, ×1.3 duration                                   | Captures the trade-off (light traffic vs cost) without crew shift scheduling.                                           |
| 65  | M5        | Clashes are flagged and counted, not fined; combining is rewarded with 25% off and quicker resurfacing over a fresh dig      | The economy (and fines) arrive in M6; the reward makes the combine choice worth making now.                             |
| 66  | M5        | Overlays are exclusive (water or traffic); O cycles them                                                                     | Every letter key was taken; one cycling key scales to the M7 overlay switcher.                                          |
| 67  | M5        | Crews pay congestion (BPR factor capped at 4×) but not closures                                                              | Spec: congestion slows crews. Capping avoids absurd times on gridlocked tiles.                                          |
| 68  | M5        | Growth's spawn chance falls from 100% to 25% as a cell's mean commute rises from 15 to 40 minutes                            | Spec: growth depends on commute times; a soft factor avoids hard cut-offs.                                              |
| 69  | M6        | Service coverage uses free-flow road times (derived, rebuilt with roads and facilities), not congested times                 | Coverage must be a pure function of saved state; congested times change every round and would need saving per kind.     |
| 70  | M6        | Capacity is shared per facility by nearest-facility catchments; ratios saved hourly                                          | Overloaded stations matter locally without an allocation solver; saving the ratios keeps loads deterministic.           |
| 71  | M6        | Fire engines are crews (type `fire`) on `firefighting` work orders; fire.ts finishes them                                    | Reuses dispatch, routing through traffic, rendering and the inbox; one order per appliance.                             |
| 72  | M6        | Firefighting draws from the nearest main as extra network demand; suppression scales with that main's pressure               | The spec's hydrant mechanic falls out of the existing friction-loss solve; neighbours' pressure drops visibly.          |
| 73  | M6        | Random fires only start in grown buildings; landmarks can burn (scenarios) but are gutted, not removed                       | Removing facilities mid-sim needs crew and layout clean-up; scenarios in M7 start fires directly.                       |
| 74  | M6        | Event crowds are two trip purposes (eventIn, eventOut) in the normal traffic round                                           | A dedicated purpose sends every trip to the venue under the gravity model; no extra assignment machinery.               |
| 75  | M6        | Event outcomes are rule-based (police level, preparations), not random                                                       | Predictable cause and effect for the player; no extra RNG draws.                                                        |
| 76  | M6        | Pollution on a 4×4-tile grid, saved; exponential falloff along rows and columns                                              | Small saves (1,024 values per kind), O(n) spreading, smooth enough for 100 m cells.                                     |
| 77  | M6        | Land value is computed on demand from cached layout parts and saved grids                                                    | Pure function of saved state; O(1) per lookup for taxes, growth and happiness.                                          |
| 78  | M6        | Taxes and happiness are collected in one residents round sliced 300 buildings per tick, partial sums saved                   | A full map takes ~15 ms in one go; slicing keeps every tick under 1 ms.                                                 |
| 79  | M6        | Income settles hourly into cash; the month's ledger is filed every 30 days                                                   | Cash moves smoothly; 30-day months match the season length.                                                             |
| 80  | M6        | Department budgets set crews on duty, service capacity, an automatic maintenance allowance and decay speed                   | Gives the spec's "sets crew numbers and the maintenance backlog" concrete, visible effects.                             |
| 81  | M6        | Bins missed by a fixed hash of the building id against the depot's ratio × tipping share                                     | Deterministic partial collection without saving per-building flags.                                                     |
| 82  | M6        | Street names hash the straight run of road a tile is on                                                                      | Stable names along a street, through junctions, with no saved naming state.                                             |
| 83  | M6        | Services must have water and power like businesses; without them they serve at half strength                                 | Ties services to the utilities, the game's core.                                                                        |
