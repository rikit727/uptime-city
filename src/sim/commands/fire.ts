/**
 * Emergency measures: at a fire (fire.ts), and water use restrictions in a drought.
 *
 * Emergency measures at a fire (fire.ts): isolate the building's power, cordon
 * the roads round it (traffic diverts), evacuate the buildings nearby.
 */
import { fireMeasureCost, hasMeasure, orderFireMeasure } from '../fire';
import type { SimState } from '../state';
import { FIRE_MEASURES } from '../types';
import { rejected } from './common';
import type { CommandPlan, FireMeasureCommand, SetWaterRestrictionCommand } from './types';
import { addComplaint } from '../complaints';

export function planFireMeasure(state: SimState, cmd: FireMeasureCommand): CommandPlan {
  const f = state.fires.find((x) => x.id === cmd.fire);
  if (!f) return rejected('That fire is out.');
  if (!FIRE_MEASURES.includes(cmd.measure)) return rejected('Unknown measure.');
  if (hasMeasure(f, cmd.measure)) return rejected('That has already been done.');
  const cost = fireMeasureCost(state, f, cmd.measure);
  if (cost > state.cash) return rejected('Not enough money.');
  return {
    ok: true,
    cost,
    affected: [],
    blocked: [],
    demolish: [],
    removed: [],
    layers: cmd.measure === 'cordon' ? ['assets', 'traffic'] : ['assets', 'supply'],
  };
}

export function applyFireMeasure(state: SimState, cmd: FireMeasureCommand): void {
  const f = state.fires.find((x) => x.id === cmd.fire);
  if (f) orderFireMeasure(state, f, cmd.measure);
}

export function planSetWaterRestriction(
  state: SimState,
  cmd: SetWaterRestrictionCommand,
): CommandPlan {
  if (![0, 1, 2].includes(cmd.level)) return rejected('Unknown restriction.');
  if (cmd.level === state.water.restriction) return rejected('That is already in force.');
  return {
    ok: true,
    cost: 0,
    affected: [],
    blocked: [],
    demolish: [],
    removed: [],
    layers: ['water'],
  };
}

export function applySetWaterRestriction(state: SimState, cmd: SetWaterRestrictionCommand): void {
  const was = state.water.restriction;
  state.water.restriction = cmd.level;
  if (cmd.level > was) {
    const text =
      cmd.level === 1
        ? 'A hosepipe ban? Our gardens will die in this heat.'
        : 'No irrigation from the mains: the crops will fail. Farmers are furious.';
    addComplaint(state, 'water', `ban:${cmd.level}:${state.minute}`, text, -1);
  }
}
