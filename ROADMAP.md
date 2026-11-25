# Roadmap

## Cut from v1

Nothing has been cut so far. If cuts are needed, the spec's order is: events
calendar, then landmarks other than the stadium and shopping centre, then
noise pollution, then glasshouses, then the 4th scenario. Record each cut here
with the milestone and reason.

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
- Moving the simulation into a Web Worker if profiling shows the need.
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
  purpose with a fixed deterrence); mode choice once public transport exists; a
  faster full-map assignment (a junction-level graph instead of road tiles) so
  rounds on a fully built map take less than the current ~2 game hours.
- Roadworks: crew shift patterns for night works (v1 only starts night works at
  20:00), closures for the whole permit slot with signed diversions, fines for
  permit overruns and clashes (with the M6 economy), and coordinating utilities'
  forward works programmes.
