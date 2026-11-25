/**
 * The Simulation owns the state and is the only thing that mutates it.
 * Outside code (app, UI) talks to it through `dispatch(command)` and reads it
 * through `snapshot()`. Everything here is pure TypeScript so it can move into
 * a Web Worker later.
 */
import { executeCommand, planCommand } from './commands';
import type { Command, CommandPlan, CommandResult, Layer } from './commands';
import type { SimEvent } from './events';
import { hashState } from './hash';
import { createInitialState } from './state';
import type { NewGameOptions, SimState } from './state';
import { SYSTEMS } from './systems';
import type { TickContext } from './systems';
import type {
  Building,
  Estate,
  GameRules,
  PowerNetwork,
  PowerStats,
  WaterLayout,
  WaterState,
  WaterStats,
  WeatherState,
} from './state';
import type { ZoneId } from './types';
import type { WorldState } from './world';

/** Bumped whenever a layer changes, so renderers rebuild only what changed. */
export type Revisions = Record<Layer, number>;

export interface LoggedCommand {
  /** The tick count when the command was applied (before the next tick runs). */
  tick: number;
  command: Command;
}

/** Read-only view of the state for render and UI. Do not mutate through it. */
export interface SimSnapshot {
  readonly tick: number;
  readonly minute: number;
  readonly cash: number;
  readonly seed: number;
  readonly rules: Readonly<GameRules>;
  readonly world: Readonly<WorldState>;
  readonly revisions: Readonly<Revisions>;
  readonly buildings: readonly Building[];
  /** Tile -> building id (0 = none). */
  readonly buildingAt: Int32Array;
  readonly buildingById: ReadonlyMap<number, Building>;
  readonly estates: readonly Estate[];
  /** Tile -> estate id (0 = none). */
  readonly estateAt: Int32Array;
  readonly weather: Readonly<WeatherState>;
  readonly demand: Readonly<Record<ZoneId, number>>;
  readonly power: Readonly<PowerStats>;
  readonly network: Readonly<PowerNetwork>;
  /** Building id -> load (kW) and facility id -> output (MW) at the last dispatch. */
  readonly loadKw: ReadonlyMap<number, number>;
  readonly outputMW: ReadonlyMap<number, number>;
  /** Saved water counters and the derived figures, layout and per-building flows. */
  readonly water: Readonly<WaterState>;
  readonly waterStats: Readonly<WaterStats>;
  readonly waterLayout: Readonly<WaterLayout>;
  readonly waterFlowLps: ReadonlyMap<number, number>;
  readonly waterUseLps: ReadonlyMap<number, number>;
}

export class Simulation {
  readonly revisions: Revisions = {
    terrain: 0,
    road: 0,
    zone: 0,
    building: 0,
    power: 0,
    supply: 0,
    water: 0,
  };
  readonly commandLog: LoggedCommand[] = [];
  private events: SimEvent[] = [];
  private readonly ctx: TickContext;

  constructor(readonly state: SimState) {
    this.ctx = {
      state,
      emit: (e) => this.events.push(e),
      touch: (layer) => this.revisions[layer]++,
    };
  }

  static newGame(opts: NewGameOptions): Simulation {
    return new Simulation(createInitialState(opts));
  }

  /** Validate and apply a command immediately. It is logged at the current tick. */
  dispatch(command: Command): CommandResult {
    const plan = executeCommand(this.state, command);
    if (plan.ok) {
      this.commandLog.push({
        tick: this.state.tick,
        command: JSON.parse(JSON.stringify(command)) as Command,
      });
      for (const layer of plan.layers) this.revisions[layer]++;
      this.events.push({ type: 'commandApplied', command: command.type, cost: plan.cost });
    }
    return plan.reason === undefined
      ? { ok: plan.ok, cost: plan.cost }
      : { ok: plan.ok, cost: plan.cost, reason: plan.reason };
  }

  /** What a command would do, without doing it. */
  preview(command: Command): CommandPlan {
    return planCommand(this.state, command);
  }

  /** Run `ticks` simulation ticks. */
  step(ticks = 1): void {
    for (let t = 0; t < ticks; t++) {
      for (const system of SYSTEMS) system.tick(this.ctx);
    }
  }

  /** Take and clear pending events. */
  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  snapshot(): SimSnapshot {
    const s = this.state;
    return {
      tick: s.tick,
      minute: s.minute,
      cash: s.cash,
      seed: s.seed,
      rules: s.rules,
      world: s.world,
      revisions: this.revisions,
      buildings: s.buildings,
      buildingAt: s.cache.buildingAt,
      buildingById: s.cache.byId,
      estates: s.estates,
      estateAt: s.cache.estateAt,
      weather: s.weather,
      demand: s.demand,
      power: s.cache.power,
      network: s.cache.network,
      loadKw: s.cache.loadKw,
      outputMW: s.cache.outputMW,
      water: s.water,
      waterStats: s.cache.waterStats,
      waterLayout: s.cache.water,
      waterFlowLps: s.cache.waterFlowLps,
      waterUseLps: s.cache.waterUseLps,
    };
  }

  hash(): string {
    return hashState(this.state);
  }
}

/**
 * Replay a command log from a fresh game: commands logged at tick T are applied
 * before tick T+1 runs, exactly as they were live. Returns the resulting sim.
 */
export function replay(opts: NewGameOptions, log: readonly LoggedCommand[], ticks: number) {
  const sim = Simulation.newGame(opts);
  let k = 0;
  for (let t = 0; t <= ticks; t++) {
    while (k < log.length && log[k]!.tick === sim.state.tick) sim.dispatch(log[k++]!.command);
    if (t < ticks) sim.step();
  }
  return sim;
}
