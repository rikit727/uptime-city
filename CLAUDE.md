# CLAUDE.md

Guidance for anyone (human or AI) continuing Uptime City.

## Start of every session

1. Read `PROGRESS.md` (status and the exact next step), this file, and
   `docs/BUILD_PROMPT.md` (the master spec; never edit it).
2. Skim `ARCHITECTURE.md` for module boundaries, tick order and save format.
3. Continue from the next unfinished milestone. One milestone per session.
4. At the end: tests, lint and build pass; update `PROGRESS.md`,
   `ARCHITECTURE.md` (tick order, decision log) and `ROADMAP.md` if anything
   was cut; commit with a clear message.

## Commands

```bash
npm install          # first time
npm run dev          # dev server at http://localhost:5173
npm test             # Vitest, all tests once
npm run test:watch   # Vitest watch mode
npm run lint         # ESLint + Prettier check
npm run format       # Prettier write
npm run typecheck    # tsc (app) + tsc (sim, no DOM lib)
npm run build        # typecheck + production build to dist/
npm run preview      # serve dist/ at http://localhost:4173
BASE_PATH=/repo-name/ npm run build   # build for a GitHub Pages subpath
npm run icons        # regenerate PWA icons in public/icons
```

Before committing: `npm run lint && npm test && npm run build`.

## Conventions

- **Language:** UI text in British English ("colour", "metres", "licence"),
  money in £ (whole pounds, `formatMoney`), metric units.
- **Name:** the game name lives only in `src/config.ts` (`GAME_NAME`).
  `index.html` uses `%GAME_NAME%`, replaced at build time.
- **Layers:** `sim` is pure (no DOM, no Three.js, no `Math.random`, no
  `Date`); `render` reads snapshots; `ui` sends commands via `UiActions`;
  `app` wires them; `platform` holds browser services. ESLint and
  `tsconfig.sim.json` enforce the sim rules.
- **Data-driven:** tunable numbers and content go in `src/data/*.json` and are
  read through `src/sim/data.ts`. Numeric `code`s in data files are saved in
  save files: never renumber or reuse them.
- **Determinism:** randomness only from `state.rng` (or a seeded stream via
  `seedState(seed, stream)`). Iterate in index order.
- **Mutations:** only command `apply` functions and systems mutate `SimState`.
  If a change affects rendering, bump the matching `revisions` layer (commands
  do this via `plan.layers`; systems call `ctx.touch(layer)`).
- **Derived cache:** `SimState.cache` (tile → building, power network, last
  dispatch figures, estates per tile) is never saved and is rebuilt on load
  by `rebuildCache()`. It must be a pure function of saved state. Commands
  that change zoning, lines or facilities call `rebuildEstates()` /
  `rebuildNetwork()`; commands that change roads, mains or water facilities
  call `rebuildWater()`; commands that change roads also call `rebuildTraffic()`
  (segments, travel times, clashes); anything that opens, closes or moves incidents
  and work orders on site calls `rebuildFaults()` (which refreshes travel times);
  use `addBuilding()` / `removeBuildings()` so the tile index stays in step.
- **Sliced work:** a system that spreads work across ticks must save everything a
  later slice reads (cursor, inputs fixed at the round's start, partial results),
  as `water.cursor` and `traffic.table` / `traffic.pending` do, so a save made
  mid-round continues identically.
- **Imports:** in `src/` outside the sim, import sim things from `src/sim` (the index),
  not deep paths (tests may import deep paths). Use `import type` for types (lint enforces).
- **Style:** Prettier (single quotes, 100 cols). Strict TS with
  `noUncheckedIndexedAccess`. Small modules with a header comment saying what
  they own.
- **Tests:** Vitest in `tests/`, mirroring `src/`. Every sim system gets unit
  tests. Use `tests/sim/helpers.ts#testSim()` for a predictable map (straight
  river in columns 60–62).
- **Performance:** sim budget is 4 ms per frame. Spread heavy work across
  ticks. Use `InstancedMesh` for repeated objects.

## How to add things

### A road class or zone type parameter

Edit `src/data/roads.json` or `src/data/zones.json`. Add a new entry with a
new unique `code`. Road classes need `capacityVehPerHour` (two-way PCU/h per tile),
`speedKmh`, `laneClosureCapacity` (share of capacity left with a lane closed) and
`repairClosure` (`full` or `lane` for emergency repairs), plus `tileClasses`
entries in `assets.json`. Road class and zone type _ids_ are also TypeScript unions
in `src/sim/types.ts` (`RoadClassId`, `ZoneId`); add the id there and a tool
entry in `src/ui/tools.ts`.

### A command

1. Add the command interface to the `Command` union in
   `src/sim/commands/types.ts`.
2. Create `src/sim/commands/<name>.ts` with `planX(state, cmd): CommandPlan`
   (pure; validates input, computes affected tiles and cost) and
   `applyX(state, cmd, plan)` (mutates using the plan).
3. Register both in `src/sim/commands/index.ts`. The `HandlerMap` type makes
   the compiler complain until you do.
4. Add tests in `tests/sim/`. Previews and the command log work automatically.

### A sim system

1. Create `src/sim/systems/<name>.ts` exporting a `SimSystem`
   (`{ id, tick(ctx) }`). Read and write `ctx.state`; use `ctx.state.rng` for
   randomness; `ctx.emit()` for notifications; `ctx.touch(layer)` when render
   output changes. Keep the model in its own module (`src/sim/<name>.ts`) and
   the system file thin (see `weather`, `power`, `growth`).
2. Add any new state to `SimState` (`src/sim/state.ts`), initialise it in
   `createInitialState`, serialise it in `src/sim/serialize.ts`, then bump
   `CURRENT_SAVE_VERSION` and add a migration in
   `src/platform/saveFormat.ts`.
3. Insert it in the right place in `SYSTEMS` (`src/sim/systems/index.ts`) and
   update the tick-order table in `ARCHITECTURE.md`.
4. If it is expensive, process a slice per tick (keep a cursor in state).
5. Write unit tests, including a determinism check.

### A building

Grown buildings are pure data in `src/data/buildings.json` (`types`). Add an
entry with:

- `id` (unique string) and `code` (new unique number below 200: never reuse),
  `name`, `category` (player-facing subtype, e.g. "Light industry").
- `zone` and `densities` (empty list for agricultural), `weight` (how often
  growth picks it among the types that fit), `footprint` `[w, d]` in tiles.
- `residents`, `jobs` (at full occupancy), `powerKw` (peak load),
  `waterLpd` (average water use per day at full occupancy, litres),
  `priority` (load-shedding order, index into `power.json: priorityNames`;
  0 also makes it a priority water customer), `heightJitter`. Farms also take
  `fields` (`arable` | `pasture` | `glasshouse`, coloured by season from
  `fieldColours`), `irrigationLpd` (irrigation or livestock water per day) and
  `exportPerDay`.
- `parts`: the model, in tile units relative to the footprint's top-left
  corner. Each part has `shape` (`box`, `gable`, `cylinder`, `tunnel`,
  `rotor`), centre `x`/`z`, optional base `y`, size `w`/`d`/`h`, `colour` (one
  or a list; the renderer picks per building) and optional `windows: true`
  (window bands lit at night when powered).

No code changes are needed. Growth places a type when its whole footprint is
empty zoned land of the same zone and density, with a road along one edge,
covered by an energised substation, with a water main at 15 m or more beside it
(farms may draw from a nearby river instead). A new primitive shape needs a unit
geometry in `src/render/layers/shapes.ts`, a batch in `layers/buildings.ts`
and the `PartShape` union in `src/sim/data.ts`.

### A power facility or line type

Facilities live in `src/data/power.json` (`facilities`), codes 200+. Fields:
`id`, `code`, `name`, `kind` (`gas`, `solar`, `wind`, `battery`,
`substation`), `footprint`, `capacityMW`, `cost`, `jobs`, `parts` (as for
buildings), plus `storageMWh`/`efficiency` (batteries), `serviceRadius`
(substations) or `wind` (`cutInMs`, `ratedMs`, `cutOutMs`). Add the id to
`FacilityId` in `src/sim/types.ts` and a tool in `src/ui/tools.ts`. A new
`kind` needs handling in `src/sim/power.ts` (`availableMW`, dispatch). Line
types (`lines`) need `id`, `code`, `capacityMW`, `costPerTile`, `colour`, the
id in `LineTypeId`, a pylon height in `render/layers/power.ts` and a tool.

### A water facility or main type

Facilities live in `src/data/water.json` (`facilities`), codes 300+. Fields:
`id`, `code`, `name`, `kind` (`intake`, `treatment`, `storage`, `booster`,
`sewage`), `footprint`, `cost`, `jobs`, `powerKw` (constant load; 0 = needs no
power), `priority`, `parts`, plus by kind: `capacityMlPerDay` (intake,
treatment, sewage), `licenceMlPerDay` (intake), `storageMl` and `headM`
(storage), `headM` (treatment outlet), `boostM` (booster). Add the id to
`WaterFacilityId` in `src/sim/types.ts` and a tool in `src/ui/tools.ts`. A new
`kind` needs handling in `src/sim/water.ts` (`solveNetwork`, `finishRound`) and
the inspector. Main types (`mains`) need `id`, `code`, `name`, `diameterMm`,
`capacityLps`, `baseLossPerKm`, `lossPerKmAtCapacity`, `costPerTile`, `colour`,
the id in `MainTypeId` and a tool. Pressure thresholds, demand curves,
irrigation, the farm licence, storm runoff and the overlay ramp are in the same
file.

### An asset type

Asset classes are pure data in `src/data/assets.json`:

- A road class, main size or line type gets a `tileClasses` entry: `id`,
  `layer` (`road` | `main` | `line`), `code` (the road/main/line code it
  covers), `name`, `crew` (`roads` | `water` | `power`), `failure` (incident
  kind: `roadDefect`, `burst`, `cableFault`), `decayPerDay`, `loadDecayPerDay`
  (added at full load, × load²), `failureScale` (× the shared `failureCurve`),
  optional `weather` multipliers by weather event id, `repair` and
  `maintenance` (`minutes`, `cost`; maintenance also has a `name`).
- A facility kind gets a `facilityClasses` entry keyed by `kind` (same fields
  without `id`/`layer`/`code`/`name`/`failure`; failures are `facilityFault`).
- Depots are `depots` entries (codes 400+): `crewType`, `crews`, `footprint`,
  `cost`, `jobs`, `parts`. Add the id to `DepotId` and a tool in `src/ui/tools.ts`.
- A new incident kind needs an `incidents` entry, the id in `IncidentKind`
  (`src/sim/types.ts`), its effect in `rebuildFaults` and its customer count in
  `updateImpacts` (`src/sim/incidents.ts`), and the serializer's kind list.

New tile assets must be laid with `layTileAsset()` and removed with
`retireAsset()` + `clearTileAsset()` in the commands that change roads, mains
or lines; facilities get condition 100 from `addBuilding()`. Commands that
change incidents or work orders call `rebuildFaults()` (and `rebuildNetwork()`
if a line or power facility is affected).

### Traffic and roadworks tuning

Everything is in `src/data/traffic.json`: cell size, assignment interval and
per-tick search budget (`nodesPerTick`), blend, BPR `alpha`/`beta`, gravity
deterrence, trip rates per purpose (outbound, return, freight, farm), PCU factors,
hourly curves (relative weights; normalised in `data.ts`), the commute growth
factor, the crew congestion cap, roadworks factors (night hours, cost and
duration; lane closure duration; combine discount and resurfacing factor; permit
allowance), cosmetic car density and the overlay ramp. A new trip purpose needs
the id in `TRIP_PURPOSES` (`data.ts`), a curve, and its production and attraction
in `buildCellTable` (`traffic.ts`).

### A scenario (from milestone 7)

Not implemented yet. Planned: one JSON file per scenario in
`src/data/scenarios/` with generator parameters (seed, size, age profile, zone
mix, network condition), constraints, objectives and timed events. Update this
section in milestone 7.

## Debugging

- In the browser console, `uptimeCity.debugSim` is the live `Simulation`
  (`.state`, `.hash()`, `.commandLog`, `.dispatch(cmd)`).
- Settings live in `localStorage['uptime-city-settings']`; saves in IndexedDB
  `uptime-city-saves`.
- Assets: `.state.incidents`, `.state.workOrders`, `.state.crews`,
  `.state.assets.kpi`, `.state.world.condition.main[tile]` (×100),
  `.state.cache.faults` (fault bits per tile, facilities offline). Press `
  for the incident inbox.
- Water: `uptimeCity.debugSim.state.cache.waterStats` (city figures),
  `.state.world.pressure` (per-tile head), `.state.cache.water` (networks,
  zones, sewers). Press O for the pressure overlay.
- Traffic: `.state.world.traffic[tile]` (PCU/h), `.state.traffic` (round cursor,
  trip table, figures, roadworks KPIs), `.state.permits`,
  `.state.cache.traffic` (travel times, capacities, segments, clashes). O cycles
  the water and traffic overlays.
- Tests on a fixed map: `tests/sim/helpers.ts` has `poweredTown()` (which adds
  `waterSupply()` unless told not to) and `riverWater()`; on generated maps use
  `waterSupplyCommands()`. To test a failure, call `openIncident()` directly
  rather than relying on the failure roll; `visitTile()` runs one day's decay.
