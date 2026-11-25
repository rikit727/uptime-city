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
    cache.ts         rebuildCache(): derived indexes recomputed from saved state
    events.ts        SimEvent union (notifications out of the sim)
    serialize.ts     SimState <-> JSON body (RLE tile layers)
    hash.ts          FNV-1a state hash for determinism checks
    commands/        One file per command family: plan (pure) + apply (mutate)
    systems/         Per-tick systems and the tick order (systems/index.ts)
  render/          Three.js only. Reads SimSnapshot; never mutates the sim.
    renderer.ts      GameRenderer: scene, layers, picking, invalidate()
    cameraRig.ts     Orbit/pan/zoom camera maths, pitch clamped 30°–70°
    lighting.ts      Hemisphere + directional sun, day/night from game time
    layers/          terrain (ground, water, grid), roads, zones, buildings (incl.
                     facilities, farm fields, rotors), power (pylons, cables, street
                     lamps), preview/cursor; instanceBatch.ts (growable
                     InstancedMesh), shapes.ts (unit part geometries)
  ui/              HTML/CSS HUD. Talks to the game only through UiActions.
    hud.ts           Top bar, toolbar, status line, modals (saves, help, new game)
    inspector.ts     Tile inspector
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
                   buildings.json, power.json, growth.json
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
- **Revisions** (`terrain`, `road`, `zone`, `building`, `power`, `supply`) let
  render layers rebuild only when their layer changed. Commands bump them via
  `plan.layers`; systems call `ctx.touch(layer)` (growth bumps `building`, the
  power dispatch bumps `supply` when any building gains or loses power). After
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

| #   | System  | Milestone | Notes                                                                                                         |
| --- | ------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | clock   | 1         | tick++, minute++, emits `dayStarted` at midnight                                                              |
| 2   | weather | 2         | Midnight: events end/start, day roll. Each hour: showers, wind/cloud targets. Every tick: temperature, sun    |
| 3   | demand  | 2         | Hourly: zone demand (-1..1) from city totals                                                                  |
| 4   | power   | 2         | Every `dispatchIntervalMinutes` (5): loads, renewables → gas → batteries, priority/rota shedding, `unpowered` |
| 5   | growth  | 2         | Every tick: scan `scanTilesPerTick` tiles and maybe add buildings. Hourly: occupancy                          |

Planned order (add rows as systems land): water/pressure → wastewater →
traffic (sliced) → asset decay → failures → incidents/work orders/crews →
services → (growth) → pollution → economy (daily/monthly) →
happiness/complaints. Water and wastewater go after power (pumps need power)
and before growth (growth will check water service).

Weather runs straight after the clock so every later system sees this
minute's weather. Power runs before growth so new growth sees current supply.

## Coordinates and units

- Tile `(x, y)` covers world `x..x+1`, `z = y..y+1`; tile centre is
  `(x + 0.5, 0, y + 0.5)`. World Y is up. Tile index = `y * width + x`.
- 1 tile = 25 m (`game.json: metresPerTile`). Map is 128×128 tiles (3.2 km).
- Money is whole pounds (£). Text is British English.

## World representation

`WorldState` holds flat `Uint8Array` layers:

| Layer   | Values                                           |
| ------- | ------------------------------------------------ |
| terrain | 0 land, 1 water                                  |
| road    | 0 none, else road class `code` from `roads.json` |
| zone    | 0 none, else zone type `code` from `zones.json`  |
| density | 0 n/a, 1 low, 2 medium, 3 high                   |
| power   | 0 none, else line type `code` from `power.json`  |

Numeric codes are defined in the data files and must never be reused or
renumbered, because saves store codes.

### Buildings

`SimState.buildings` is a list (ascending `id`) of `{ id, code, x, y,
occupancy, unpoweredMinutes, storedMWh }`. `code` refers to a grown building
type (`buildings.json`, codes 1–199) or a power facility (`power.json`, codes
200+); `data.ts#buildingDef(code)` looks up either. `(x, y)` is the
footprint's top-left tile. Residents and jobs are aggregates
(`def.residents × occupancy`); there are no individual citizens. A building is
powered when `unpoweredMinutes === 0`.

### Derived cache

`SimState.cache` holds data derived from the saved fields and is never saved:
tile → building id, id → building, tile → estate id, the power network
(islands, substation feed limits, tile coverage) and the last dispatch figures
(per-building load, per-facility output, city totals). `rebuildCache()` runs
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
  "version": 2,
  "meta": { "gameName", "label", "savedAt", "day", "minute", "cash", "seed" },
  "state": {
    "seed": 123, "tick": 0, "minute": 360, "rngState": 987654, "cash": 250000,
    "rules": { "weatherEvents": true },
    "world": {
      "width": 128, "height": 128,
      "terrain": [v, run, v, run, ...],   // run-length encoded
      "road": [...], "zone": [...], "density": [...], "power": [...]
    },
    "buildings": [[id, code, x, y, occupancy, unpoweredMinutes, storedMWh], ...],
    "nextBuildingId": 42,
    "estates": [{ "id": 1, "name": "Riverside Trading Estate", "anchor": 8457 }],
    "nextEstateId": 2,
    "weather": { "temperatureC": 11.2, "windMs": 4.1, "event": null, ... },
    "demand": { "residential": 0.4, ... },
    "growthCursor": 9120
  }
}
```

Version history: 1 = milestone 1 (terrain, roads, zones); 2 = milestone 2
(power layer, buildings, estates, weather, demand, rules). The v1 → v2
migration adds empty buildings and lines and default weather.

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
   ticks, cosmetic cars, closures, planned/reactive roadworks, permits.
6. **Services and economy** — fire/hydrants, police, health, schools, waste,
   landmarks, events calendar, pollution, budgets, loans, happiness, complaints.
7. **UI** — overlays, KPI dashboard, menus and settings, scenarios, polish.
8. **Performance and docs** — profiling pass, final documentation review.

## Decision log

| #   | Milestone | Decision                                                                                                         | Why                                                                                                 |
| --- | --------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | M1        | TypeScript pinned to ~6.0                                                                                        | typescript-eslint does not yet support TS 7.                                                        |
| 2   | M1        | Roads, zones and density are per-tile `Uint8Array` layers with numeric codes from JSON                           | Compact, fast to scan, trivially serialisable; codes stay stable for saves.                         |
| 3   | M1        | Road drag lays an L-shaped path (longer axis first)                                                              | Simple, predictable grid tool; straight drags give straight roads.                                  |
| 4   | M1        | Roads may cross water as bridges at 5× cost (`roads.json: bridgeCostMultiplier`)                                 | The river splits the map; without bridges half the map is unreachable.                              |
| 5   | M1        | Building a road over zoning removes the zoning; zoning skips roads and water                                     | Avoids ambiguous tiles. Later, buildings will block roads instead.                                  |
| 6   | M1        | Agricultural zoning only within 20 tiles of the map edge (`game.json: agriculturalEdgeBand`)                     | Spec: farms "towards the map edges". River is kept 24+ tiles from the edges.                        |
| 7   | M1        | Commands apply immediately and are logged at the current tick                                                    | Lets the player build while paused; replay applies them before the next tick, so determinism holds. |
| 8   | M1        | Command handlers are split into `plan` (pure) and `apply`                                                        | One code path for previews and execution, so previews cannot drift.                                 |
| 9   | M1        | Save tile layers run-length encoded in JSON                                                                      | Readable, exportable JSON that stays small (a few KB).                                              |
| 10  | M1        | 1 tile = 25 m                                                                                                    | Gives a 3.2 km map; plausible for a town with farmland at the edges.                                |
| 11  | M1        | Sim runs on the main thread with a 4 ms/frame budget; snapshots share arrays                                     | Spec allows it for v1; `SimSnapshot` keeps the worker move open.                                    |
| 12  | M1        | No main menu yet: the game boots straight into a new random-seed city; New game / Save / Load are in the top bar | Main menu and settings panel are M7.                                                                |
| 13  | M1        | Hand-written IndexedDB wrapper; `fake-indexeddb` for tests                                                       | No runtime dependency needed for four keys.                                                         |
| 14  | M1        | PWA icons generated by `scripts/gen-icons.mjs` and committed                                                     | No external art; reproducible.                                                                      |
| 15  | M1        | The game keeps running while modals are open                                                                     | Matches the time controls; the player can pause with Space. Revisit in M7.                          |
| 16  | M2        | Calendar: 4 seasons × 30 days = 120-day year, starting in spring                                                 | Seasons long enough to feel (a season is 6 real hours at 1×) without years taking weeks.            |
| 17  | M2        | Buildings are a list of records plus a derived tile index (`cache`), not a per-tile layer                        | Multi-tile footprints, per-building aggregates and stable ids for later incidents and inspection.   |
| 18  | M2        | Derived data lives in `SimState.cache`, rebuilt on load; it must be a pure function of saved state               | Keeps saves small and avoids saving indexes that can drift; determinism holds after load.           |
| 19  | M2        | Growth needs zoning, positive demand, a road beside the footprint and an energised substation in range           | Spec ties growth to utility service. Land value (M6), services (M6) and commutes (M5) join later.   |
| 20  | M2        | Roads and re-zoning over grown buildings demolish them (preview shows them orange); facilities block roads/zones | Spec: building over farmland removes the farm. Facilities are deliberate investments.               |
| 21  | M2        | Power lines may share tiles with roads; they clear zoning and are blocked by grown buildings                     | Lines along streets are normal; blocking avoids silent demolition by a cheap line drag.             |
| 22  | M2        | Substation feed = min(capacity, weakest line on the best route); no shared line limits                           | Gives line ratings meaning with a cheap widest-path search instead of a power-flow solver.          |
| 23  | M2        | Substation coverage is straight-line distance (radius), not along roads                                          | Low-voltage distribution is implicit; road-based coverage is reserved for services (M6).            |
| 24  | M2        | Load shedding by priority then a rotating rota block (`id % 4`, rotates hourly)                                  | Simple, deterministic rolling outages; hospitals get priority 0 when they arrive in M6.             |
| 25  | M2        | Batteries charge from any spare capacity, renewables first, and discharge after gas                              | Batteries cover peaks beyond gas capacity; no price model until the economy (M6).                   |
| 26  | M2        | Industrial estates connect across one road or line tile; names persist via an anchor tile                        | Estates have internal roads; anchors keep names stable when estates grow, merge or split.           |
| 27  | M2        | Facility jobs count towards total jobs (residential demand) but not to any zone                                  | Power stations employ people without distorting zone demand.                                        |
| 28  | M2        | Farm export income is defined (`exportPerDay`) but not paid yet                                                  | Income and costs arrive with the economy in M6.                                                     |
| 29  | M2        | `rules.weatherEvents` (default on) is saved now; its sandbox toggle arrives with the menus in M7                 | Spec lists weather events on/off as a sandbox setting; cheap to carry from the start.               |
