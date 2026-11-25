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
  `rebuildNetwork()`; use `addBuilding()` / `removeBuildings()` so the tile
  index stays in step.
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
new unique `code`. Road class and zone type _ids_ are also TypeScript unions
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
  `priority` (load-shedding order, index into `power.json: priorityNames`),
  `heightJitter`. Farms also take `fields` (`arable` | `pasture` |
  `glasshouse`, coloured by season from `fieldColours`) and `exportPerDay`.
- `parts`: the model, in tile units relative to the footprint's top-left
  corner. Each part has `shape` (`box`, `gable`, `cylinder`, `tunnel`,
  `rotor`), centre `x`/`z`, optional base `y`, size `w`/`d`/`h`, `colour` (one
  or a list; the renderer picks per building) and optional `windows: true`
  (window bands lit at night when powered).

No code changes are needed. Growth places a type when its whole footprint is
empty zoned land of the same zone and density, with a road along one edge,
covered by an energised substation. A new primitive shape needs a unit
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

### An asset type (from milestone 4)

Not implemented yet. Planned: `src/data/assets.json` with decay rate, failure
curve, repair crew type and duration. Update this section in milestone 4.

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
