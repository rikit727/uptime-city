# Uptime City

Run a modern city day to day: utilities, roads, maintenance, incidents and
budgets. A low-poly 3D city builder for laptop and browser, installable as a
PWA and playable offline. No backend.

Status: early development (see `PROGRESS.md`). Roads, zoning, seasons and
weather, building growth (including farms and industrial estates), the power
network, water supply with pressure zones, wastewater and irrigation, asset
condition and failures, incidents, work orders and repair crews, traffic with
congestion and cosmetic cars, roadworks with street works permits, and save/load
work today.

## Run locally

Requires Node 22 LTS.

```bash
npm install
npm run dev        # http://localhost:5173
```

Other commands: `npm test`, `npm run lint`, `npm run build`,
`npm run preview` (serves the production build at http://localhost:4173).

## Build and deploy as a static site

```bash
npm run build                       # output in dist/, served from "/"
BASE_PATH=/my-subpath/ npm run build   # when hosted under a subpath
```

`dist/` is plain static files; host it anywhere. The service worker needs
HTTPS (or localhost).

### GitHub Pages

`.github/workflows/deploy.yml` builds with `BASE_PATH=/<repository-name>/` and
publishes on every push to `main`. Enable it once: repository **Settings →
Pages → Build and deployment → Source: GitHub Actions**. CI
(`.github/workflows/ci.yml`) runs lint, tests and the build on every push.

## Install the PWA

Open the site in Chrome or Edge and use the install icon in the address bar
(or the browser menu → _Install Uptime City_). On iOS Safari use Share → _Add
to Home Screen_. After the first visit the game works offline.

## Playing

The game opens on the main menu: start a sandbox city (seed, starting cash,
difficulty, weather events, random fires), pick one of four scenarios (heatwave,
cold snap, ageing network, commercial fire), load a save or change the settings
(resolution, shadows, cosmetic cars, autosave, pause in menus, controls list).
F10 or the _Menu_ button opens it again.

## Saves

Three save slots plus an autosave at the start of each game day, stored in
the browser (IndexedDB). Use _Save / load → Export_ to download a JSON save
and _Import_ to load one.

## Controls

Press **H** in game for the full list. Highlights: WASD to pan, Q/E rotate,
mouse wheel zoom, 1–3 roads, 4–8 zones, P/T power lines, U substation,
N/L/V/M power stations and storage, J/K water mains, 9/0 intake and treatment
works, -/= reservoir and water tower, C booster, Y sewage works, O / Shift+O
cycle the map overlays (power, water pressure, wastewater, traffic, roadworks,
condition, service cover, pollution, land value), ; plan maintenance,
Shift+1/2/3 depots, ` incident inbox, Shift+B budget, Shift+N city panel,
Shift+D dashboard, B bulldoze, Space pause, Ctrl+S saves, F10 main menu.

## Docs

- `ARCHITECTURE.md`: modules, data flow, tick order, save format, decisions
- `CLAUDE.md`: conventions and how-to guides
- `PROGRESS.md`: milestone status and next step
- `ROADMAP.md`: cuts and future plans
