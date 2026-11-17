# Build prompt: Uptime City (v1)

> Commit this file to the repo as `docs/BUILD_PROMPT.md`, then start Claude Code (Fable) with: "Read docs/BUILD_PROMPT.md and follow it." Do not edit or delete this file during the build.

---

## Goal

Build v1 of an original, installable 3D city builder for laptop and browser. The game is about **running a modern city day to day**: utilities, roads, maintenance, incidents and budgets. Drawing the skyline is secondary. Realism is "operational": systems behave plausibly and interact, but nothing needs to be an engineering-grade solver.

The game is called **Uptime City**. Keep the name in a single config constant. Use only original names, art and text. Do not reference or copy existing games, trademarks or assets.

UI text is in British English, money is in £, and units are metric.

## Working method

1. **Plan before coding.** Write `ARCHITECTURE.md` and a milestone plan, then build in the milestone order below.
2. At the end of every milestone the game must run, the tests must pass, and the work is committed with a clear message.
3. If the budget gets tight, finish fewer systems properly rather than leave many half-built. Never leave the build broken. Record anything cut in `ROADMAP.md`.
   - Milestones 1–5 are essential.
   - If something has to go, cut in this order: events calendar, then landmarks other than the stadium and shopping centre, then noise pollution, then glasshouses, then the 4th scenario.
4. A different model will continue this codebase later. Optimise for readability, clear module boundaries and documentation.
5. Work autonomously. Don't stop to ask questions: make a sensible call and record it in a decision log section of `ARCHITECTURE.md`.

## Tech stack (fixed)

- Node 22 LTS with npm. TypeScript (strict), Vite, Three.js, Vitest, ESLint and Prettier.
- GitHub Actions:
  - CI runs lint, tests and the build on every push.
  - A deploy workflow publishes the built site to GitHub Pages.
  - Vite's `base` path comes from an environment variable so the site works on a Pages subpath.
- PWA via `vite-plugin-pwa`: installable from the browser, works offline. No backend.
- Saves: IndexedDB with 3 slots, plus autosave once per in-game day. Export and import saves as JSON. Saves carry a `version` field and a migration hook.
- No external art, audio, fonts or CDNs at runtime. All geometry is made in code.

## Visual direction: simple 3D

- Low-poly with flat colours. No textures, no post-processing and no custom shaders.
- Buildings are boxes or simple primitives with roof and colour variants by zone and density. Use `InstancedMesh` for buildings, trees, cars and lamps.
- Camera: orbit, pan and zoom, with pitch clamped between roughly 30° and 70°. Edge scroll is optional and WASD is required.
- Lighting: one hemisphere light and one directional light. Day and night follow game time; at night window bands and street lamps use emissive materials. Shadows are a settings toggle, default off.
- Overlays (power, water pressure, wastewater, traffic, condition, coverage, pollution, roadworks) are coloured tiles or lines drawn over the map, and the buildings dim while one is active. Overlay colour ramps must be colour-blind safe.
- Farmland: flat crop-coloured field tiles that change with the season, plus barns and polytunnels as simple primitives.
- The UI is HTML/CSS layered over the canvas, not rendered in Three.js.

## World

- A 128×128 tile grid on flat terrain, with one river or lake that acts as the raw water source.
- Time: 1 sim tick = 1 game minute. One game day takes about 12 real minutes at 1x. Speeds are pause, 1x, 2x and 4x.
- **Seasons and weather:** a game year has four seasons. A weather model drives temperature, rainfall, wind and sunshine. Weather affects power demand, renewable output, water demand, burst rates in cold spells, sewer overflows in storms, and farm irrigation. Heatwaves, cold snaps and storms are weather events.
- The simulation is deterministic: seeded RNG, so the same seed and the same commands produce the same city.

## Simulation systems (operational realism)

**Zoning and growth.**
- Zone types: residential, commercial, office, industrial and agricultural. All except agricultural come at low, medium or high density.
- **Commercial** covers high-street shops and retail parks. **Office** zones cover office blocks and business parks.
- **Industrial** covers light industry, heavy industry and warehousing/logistics. Adjacent industrial plots form named **industrial estates**, which are tracked as one unit for HGV traffic, power load and pollution.
- **Agricultural:** large plots placed only towards the map edges. The types are arable, livestock and glasshouses. They employ few people and pay low rates, but bring in export income.
  - Farms need water for irrigation and livestock. That demand peaks in summer and during heatwaves. Irrigation can come from the mains or from a river abstraction with a capped daily licence.
  - Farms add slow farm traffic on rural roads.
  - Building the city out over farmland removes the farm and its income.
- Growth depends on demand, land value, utility service, services coverage and commute times.
- Population and jobs are tracked as aggregates per building, not as individual citizens.

**Landmarks and events.**
- Placeable large buildings: stadium, shopping centre, hospital, university and conference/events centre. Each has its own footprint, model, utility demand and job count.
- An **events calendar** (match days, concerts, shopping peaks) creates short, intense demand spikes: traffic around the venue, power and water load, and police and waste demand.
- The player can prepare for an event with temporary measures such as road closures, extra crews and diversions.

**Roads and traffic.**
- Three road classes (local, avenue and highway), each with a capacity and a speed.
- Trips are generated per zone using time-of-day curves (morning and evening peaks). They are assigned to the network with congestion-aware shortest paths, using a BPR-style volume/delay function, and the assignment is recalculated periodically rather than every tick.
- The visible cars are cosmetic: they are sampled from the flows and are not separate agents.

**Roadworks.** These are a core mechanic:
- **Planned:** road condition decays with traffic. The player schedules resurfacing, which closes lanes or the whole segment.
- **Reactive:** a burst main or cable fault under a road needs an excavation, which closes the road while it is repaired.
- A closure reduces capacity and traffic re-routes around it.
- Night works cause less disruption but cost more and take longer.
- **Permits:** every job needs a booked slot on its segment. Clashes are flagged, and works on the same segment can be combined to avoid digging twice; combining is rewarded.

**Power.** Plants (gas, solar, wind, battery), substations and lines, each with a capacity. Demand follows a curve by time of day and zone. On a shortfall, rolling outages follow a priority order (hospitals first). Weather affects renewable output.

**Water.**
- The network runs from intake to treatment works to service reservoirs and water towers to mains. Mains are laid along roads by default.
- Pressure zones are separated by pumping stations. Each main has a capacity (set by its diameter).
- **Pressure falls with distance and flow.** Each main loses pressure in proportion to its length and how close it is to its capacity, using a simplified friction-loss model rather than a full hydraulic solver. Properties far from the treatment works or reservoir, or at the end of busy mains, get lower pressure at peak times.
- Booster pumping stations raise pressure downstream at an energy cost. Below a minimum pressure, properties count as having low pressure; below a lower threshold they have no supply.
- A burst cuts pressure downstream, causes leakage and leaves customers without supply.
- Priority customers (hospitals, care homes) are flagged. When they lose supply, the incident severity goes up and a bottled-water response can be sent.
- **Wastewater:** sewers run along roads, and treatment works have a capacity. Storm events can exceed capacity and trigger an overflow incident.

**Asset condition.** Every pipe, road segment, line, substation, pump and plant has an age, a condition score from 0 to 100, and a decay rate that depends on load. The daily failure probability rises as condition falls. Maintenance restores condition.

**Incidents and work orders.**
- A failure creates an incident with a severity, the number of customers affected and an SLA timer.
- The work order queue has priorities. Crews come in types (roads, water, power), work from depots in limited numbers, travel on the real road network (so congestion slows them) and spend time on site.
- The player can also raise planned maintenance work orders.
- Track mean time to repair and customer-minutes lost.

**Services.**
- Fire, police, health and schools. Coverage is measured by travel time over the road network, not by a radius.
- **Waste:** depots, a recycling centre and landfill, each with a capacity. Collection coverage also uses road travel time, and missed collections generate complaints.
- **Fire:** hydrants sit on the water mains. Firefighting draws a large flow from the local mains, which lowers pressure for nearby properties. A fire's growth depends on building size, response time and the available water flow. Building fires also happen as random incidents in normal play.

**Economy.**
- Income from taxes per zone and utility tariffs.
- Costs: running costs (crews, energy, maintenance) and capital build costs.
- A department budget for each of roads, water, power and services; it sets crew numbers and the maintenance backlog.
- Monthly accounts and loans.

**Pollution.** Air and noise pollution come from industry, power plants, highways and traffic. It spreads with distance and lowers land value and happiness.

**Citizens.**
- Happiness comes from service levels, outages, commute times and pollution.
- A complaints feed is generated from real sim events, for example "No water on Mill Road for 3 hours".

## Modes

- **Sandbox:** settings for starting cash, difficulty and weather events on or off.
- **Scenarios:** defined in data files (JSON), each with a starting map, constraints, objectives and timed events.
  - Starting maps are not drawn by hand. A seeded city generator builds them, with parameters for size, age profile, zone mix and network condition, so new scenarios are cheap to add.
  - Ship 4:
    - **Heatwave:** household and farm irrigation demand both spike. Keep supply above 99% without breaching the abstraction licence.
    - **Cold snap:** the burst rate rises. Keep mean time to repair under a target.
    - **Ageing network:** inherit a run-down city and clear the backlog within budget.
    - **Commercial fire:** a major fire breaks out in a shopping centre during trading hours. Dispatch fire crews through traffic, and keep hydrant flow up without cutting off supply to surrounding homes. Isolate power to the building, set up a cordon with road closures and diversions, and handle the knock-on effects: smoke and evacuation, closed businesses, lost tax revenue and complaints. You are scored on containment time, customer-minutes lost and the final cost.

## UI

- Build toolbar, inspector panel for anything clicked, and time controls.
- Overlay switcher.
- Incident inbox with the work order queue, crew assignment and a roadworks/permit calendar.
- Budget panel and KPI dashboard: supply interruptions, customer-minutes lost, mean time to repair, congestion index, cash flow and happiness.
- Notification toasts and keyboard shortcuts for all main actions.
- A main menu (new game, load, scenarios, settings) and a settings panel for graphics, shadows, autosave and a list of controls.
- A short first-run help panel explaining the controls and the core loop.

## Architecture rules

- `src/sim`: pure TypeScript with no DOM or Three.js imports. It holds the world state, systems, scheduler and RNG. It must be able to move into a Web Worker later; run it on the main thread in v1 unless profiling says otherwise.
- `src/render`: Three.js, which reads sim snapshots only.
- `src/ui`: HTML/CSS. It changes the game only by sending commands to the sim, never by mutating state directly.
- `src/data`: JSON definitions for buildings, assets, costs, curves and scenarios. Adding content should not need code changes.
- `src/platform`: saves and PWA.
- Heavy work (traffic assignment, network recalculation) is split across ticks. The sim's budget is under 4 ms per frame.

## Performance target

60fps on a mid-range laptop with a fully built 128×128 map.

## Tests

Vitest unit tests for every sim system, covering at least:
- network connectivity
- outage on capacity shortfall
- water pressure falling with distance and flow, and recovering when a booster pump is added
- firefighting flow lowering local pressure
- irrigation demand rising with temperature and stopping at the abstraction licence cap
- burst → incident → work order → repair
- a roadworks closure re-routing traffic
- budget calculations
- save and load round-trip
- determinism: the same seed and commands give the same state hash

## Milestones (in order)

1. Scaffold, PWA, CI and Pages workflows, grid, camera, roads and zoning tools, save and load
2. Sim core: time, seasons and weather, growth (including farms), power
3. Water, wastewater, pressure zones, irrigation
4. Asset condition, incidents, crews, work orders
5. Traffic, roadworks, permits
6. Services (including fire and hydrants, and waste), landmarks, events calendar, pollution, economy, happiness, complaints feed
7. Overlays, dashboard, menus and settings, scenarios, UI polish
8. Performance pass and handover docs

## Handover deliverables

- `README.md`: how to run, build, deploy as a static site and install the PWA.
- `ARCHITECTURE.md`: modules, data flow, sim tick order, save format.
- `CLAUDE.md`: conventions, plus step-by-step guides for adding a building, an asset type, a sim system and a scenario. Include the test and lint commands.
- `ROADMAP.md`: anything cut, plus planned items: public transport, terrain and elevation, a deeper hydraulic model, leak detection from night flows, natural disasters such as flooding, and audio.

## Out of scope for v1

Terrain editing, public transport, natural disasters, multiplayer, mods, audio, and individual-citizen simulation.
