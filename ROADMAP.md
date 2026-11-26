# Roadmap

## Cut from v1

Nothing was cut from v1: milestone 6 shipped the events calendar, all five
landmarks, noise pollution and glasshouses; milestone 7 shipped all four scenarios;
milestone 8 (performance and docs) completed the build. Had cuts been needed, the
spec's order was: events calendar, then landmarks other than the stadium and shopping
centre, then noise pollution, then glasshouses, then the 4th scenario.

## Planned after v1

- Public transport (buses, trams, rail) with ridership and its effect on
  congestion.
- Terrain and elevation: hills, gravity-fed water zones, pumping heads.
- A deeper hydraulic model (proper network solver instead of friction-loss
  approximation).
- Leak detection from night flows (minimum night flow analysis per district
  metered area).
- Natural disasters such as flooding.
- Audio (generated in code, no external assets).
- Moving the simulation into a Web Worker if profiling shows the need (milestone 8
  measured ~0.25 ms of sim per frame at 4× on a full map, so v1 stays on the main
  thread; decision 107).
- Performance follow-ups from milestone 8: split the water solve's two routing passes
  across ticks (needs the first pass's flows saved), service coverage on the
  junction-level graph (a road change costs ~7 ms on a full map), incremental
  building-layer updates instead of full rebuilds, and measuring frame times on real
  laptop GPUs (the profiler here only has a software GPU).
- A proper power-flow model (shared line limits, losses) instead of the
  per-substation widest-path limit used in v1.
- Buildings redeveloping in place to a higher density when demand and land
  value allow, instead of needing demolition and regrowth.
- Weekday/weekend demand patterns (the v1 calendar has no days of the week).
- Assets: pipe and cable materials with their own failure curves, age-driven
  decay acceleration, condition surveys (unknown condition until inspected),
  crew skills and overtime, mutual aid between depots.
- Water: booster pumps with a flow capacity and energy use that scales with
  the flow and head they lift (v1 boosters add a fixed head at a constant
  load); flows shared across looped mains (v1 routes each customer along one
  best path); a separate raw-water main network; sewer pipe capacities and
  storm tanks (v1 sewers are implicit and only the works has a capacity).
- Traffic: directional flows and turn delays at junctions (signals, roundabouts);
  per-purpose time-of-day destination choice (v1 uses one gravity model per
  purpose with a fixed deterrence); mode choice once public transport exists;
  shorter rounds on big maps (the junction-level graph of milestone 8 made searches
  ~4× cheaper, which leaves room to raise `nodesPerTick`).
- Roadworks: crew shift patterns for night works (v1 only starts night works at
  20:00), closures for the whole permit slot with signed diversions, fines for
  permit overruns and clashes (with the M6 economy), and coordinating utilities'
  forward works programmes.
- Services: coverage by congested travel time; patients, pupils and calls
  allocated across facilities by preference rather than nearest-only catchments;
  waste trucks on the roads (power isolation, cordons and evacuation shipped in
  M7).
- Economy: adjustable utility tariffs, bonds, credit rating, budget overspend
  rules; land value that remembers (property prices lagging changes).
- Events: player-scheduled events and diversions signed along chosen routes;
  public transport shuttles once public transport exists.
- Scenarios: more of them (a storm and sewer overflow, a stadium final, a power
  station outage), organic street patterns and highways in the generator, a
  scenario editor, best scores kept per scenario, difficulty levels per scenario.
- Overlays: smoke plumes, flood risk once terrain exists, a crews overlay.
- Fires: spreading to neighbours, smoke drifting with the wind, casualties.
- Water restrictions with partial compliance and a cost of enforcement; leakage
  reduction as a drought lever.
