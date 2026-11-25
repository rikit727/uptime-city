/**
 * Commands are the only way to change the simulation from outside. The UI
 * builds them, the sim validates and applies them, and they are logged with
 * their tick so a game can be replayed exactly.
 */
import type {
  CrewType,
  Department,
  DensityId,
  EventMeasure,
  FacilityId,
  LineTypeId,
  MainTypeId,
  RoadClassId,
  TileCoord,
  ZoneId,
} from '../types';

export interface BuildRoadCommand {
  type: 'buildRoad';
  roadClass: RoadClassId;
  from: TileCoord;
  to: TileCoord;
}

export interface ZoneCommand {
  type: 'zone';
  zone: ZoneId;
  /** Ignored for zone types without density (agricultural). */
  density: DensityId;
  from: TileCoord;
  to: TileCoord;
}

export interface BulldozeCommand {
  type: 'bulldoze';
  from: TileCoord;
  to: TileCoord;
}

/** Place a power or water facility with its footprint's top-left corner at `at`. */
export interface PlaceFacilityCommand {
  type: 'placeFacility';
  facility: FacilityId;
  at: TileCoord;
}

export interface BuildLineCommand {
  type: 'buildLine';
  line: LineTypeId;
  from: TileCoord;
  to: TileCoord;
}

/** Lay (or upgrade to) a water main along an L-shaped path. */
export interface BuildMainCommand {
  type: 'buildMain';
  main: MainTypeId;
  from: TileCoord;
  to: TileCoord;
}

/**
 * Raise planned maintenance for every asset in a rectangle whose condition is
 * below `below` (0..101; 101 = everything), optionally only one crew type's.
 * Each asset gets one work order; assets that already have one are skipped.
 */
export interface RaiseMaintenanceCommand {
  type: 'raiseMaintenance';
  from: TileCoord;
  to: TileCoord;
  below: number;
  crew?: CrewType;
  /** Limit to a single asset on the tile (road, main, line or the facility there). */
  only?: 'road' | 'main' | 'line' | 'facility';
  /** Works on roads (resurfacing, mains under roads): book the permit for tonight (night works). */
  night?: boolean;
  /** Close one lane instead of the whole road (slower work, traffic keeps moving). Default full. */
  closure?: 'full' | 'lane';
  /** Join works already booked on the same street instead of booking a second slot. Default true. */
  combine?: boolean;
}

/** Move the works of one permit into another on the same street (dig once; planned works are discounted). */
export interface CombinePermitsCommand {
  type: 'combinePermits';
  from: number;
  into: number;
}

/** Change a work order's priority (1 emergency .. 4 routine). */
export interface SetOrderPriorityCommand {
  type: 'setOrderPriority';
  order: number;
  priority: number;
}

/** Send a particular crew to a work order (diverting it if it is on its way elsewhere). */
export interface AssignCrewCommand {
  type: 'assignCrew';
  crew: number;
  order: number;
}

/** Cancel planned maintenance (refunded). Repairs cannot be cancelled. */
export interface CancelOrderCommand {
  type: 'cancelOrder';
  order: number;
}

/** Send bottled water to priority customers cut off by a water incident. */
export interface SendBottledWaterCommand {
  type: 'sendBottledWater';
  incident: number;
}

/** Set a department's budget level (economy.json `budgetLevels`, 0.5 to 1.5). */
export interface SetBudgetCommand {
  type: 'setBudget';
  department: Department;
  level: number;
}

/** Set a zone's tax rate multiplier (economy.json `taxes.rateLevels`). */
export interface SetTaxRateCommand {
  type: 'setTaxRate';
  zone: ZoneId;
  rate: number;
}

/** Borrow one of the amounts on offer (economy.json `loans`). */
export interface TakeLoanCommand {
  type: 'takeLoan';
  amount: number;
}

/** Pay off a loan early. */
export interface RepayLoanCommand {
  type: 'repayLoan';
  loan: number;
}

/** Book (and pay for) an arrangement for an upcoming event. */
export interface PrepareEventCommand {
  type: 'prepareEvent';
  event: number;
  measure: EventMeasure;
}

export type Command =
  | BuildRoadCommand
  | ZoneCommand
  | BulldozeCommand
  | PlaceFacilityCommand
  | BuildLineCommand
  | BuildMainCommand
  | RaiseMaintenanceCommand
  | SetOrderPriorityCommand
  | AssignCrewCommand
  | CancelOrderCommand
  | SendBottledWaterCommand
  | CombinePermitsCommand
  | SetBudgetCommand
  | SetTaxRateCommand
  | TakeLoanCommand
  | RepayLoanCommand
  | PrepareEventCommand;
export type CommandType = Command['type'];

/**
 * Which state layers changed, so renderers know what to rebuild. `building`:
 * buildings added or removed; `power`: lines or facilities; `supply`: which
 * buildings have power (lights at night); `water`: mains, water facilities or
 * pressures; `assets`: incidents, work orders, crews or asset condition; `traffic`: flows,
 * closures or permits.
 */
export type Layer =
  'terrain' | 'road' | 'zone' | 'building' | 'power' | 'supply' | 'water' | 'assets' | 'traffic';

/**
 * The outcome of planning a command against the current state, without changing it.
 * The UI uses plans for previews; `apply` executes exactly the same plan.
 */
export interface CommandPlan {
  ok: boolean;
  /** Player-facing reason when `ok` is false (British English). */
  reason?: string;
  /** Extra information for the player when `ok` is true (e.g. permit clashes, combined works). */
  note?: string;
  /** Total cost in pounds. */
  cost: number;
  /** Tile indices that will change. */
  affected: number[];
  /** Tile indices in the drag area that cannot be used (for red preview tiles). */
  blocked: number[];
  /** Ids of buildings the command will demolish. */
  demolish: number[];
  /** Footprint tiles of those buildings (for orange preview tiles). */
  removed: number[];
  /** Layers the command touches. */
  layers: Layer[];
}

export interface CommandResult {
  ok: boolean;
  reason?: string;
  note?: string;
  cost: number;
}
