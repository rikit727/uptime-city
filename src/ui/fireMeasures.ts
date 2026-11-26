/**
 * Buttons for the emergency measures at a fire (isolate power, cordon,
 * evacuate), shared by the incident inbox and the inspector. Done measures
 * show as ticked labels.
 */
import { FIRE_MEASURES, SERVICES, hasMeasure } from '../sim';
import type { Command, Fire, FireMeasure, SimSnapshot } from '../sim';
import { h } from './dom';
import { formatMoney } from './format';

const HELP: Record<FireMeasure, string> = {
  isolatePower:
    'Switch the building off at the substation: firefighters work at full rate and live electrics stop feeding the fire',
  cordon:
    'Close the roads round the fire: traffic diverts, onlookers stay away from the smoke and the crews',
  evacuate:
    'Empty the buildings nearby: nobody breathes the smoke, but they close and pay no taxes until the fire is out',
};

export function fireMeasureButtons(
  snap: SimSnapshot,
  f: Fire,
  dispatch: (cmd: Command) => void,
): HTMLElement {
  const box = h('div', { class: 'fire-measures' });
  for (const m of FIRE_MEASURES) {
    const name = SERVICES.fire.measures[m].name;
    if (hasMeasure(f, m)) {
      box.append(h('span', { class: 'done', title: HELP[m] }, `✔ ${name}`));
      continue;
    }
    const cost = snap.city.fireMeasureCost(f, m);
    const b = h(
      'button',
      { class: 'small primary', title: HELP[m] },
      `${name} (${formatMoney(cost)})`,
    );
    b.addEventListener('click', () => dispatch({ type: 'fireMeasure', fire: f.id, measure: m }));
    box.append(b);
  }
  return box;
}
