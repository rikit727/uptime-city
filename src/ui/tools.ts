/** The build toolbar's tools. Pure data: the app binds behaviour, the UI draws buttons. */
import type { FacilityId, LineTypeId, MainTypeId, RoadClassId, ZoneId } from '../sim';

export type ToolId =
  | { kind: 'inspect' }
  | { kind: 'road'; roadClass: RoadClassId }
  | { kind: 'zone'; zone: ZoneId }
  | { kind: 'line'; line: LineTypeId }
  | { kind: 'main'; main: MainTypeId }
  | { kind: 'facility'; facility: FacilityId }
  | { kind: 'maintain' }
  | { kind: 'bulldoze' };

export interface ToolDef {
  key: string;
  label: string;
  /** Keyboard shortcut (KeyboardEvent.code) and its display label. */
  code: string;
  /** The shortcut needs Shift held. */
  shift?: boolean;
  keyLabel: string;
  group:
    | 'select'
    | 'roads'
    | 'zones'
    | 'power'
    | 'water'
    | 'maintain'
    | 'services'
    | 'landmarks'
    | 'demolish';
  tool: ToolId;
  swatch?: string;
}

export const TOOLS: readonly ToolDef[] = [
  {
    key: 'inspect',
    label: 'Inspect',
    code: 'KeyI',
    keyLabel: 'I',
    group: 'select',
    tool: { kind: 'inspect' },
  },
  {
    key: 'road:local',
    label: 'Local road',
    code: 'Digit1',
    keyLabel: '1',
    group: 'roads',
    tool: { kind: 'road', roadClass: 'local' },
  },
  {
    key: 'road:avenue',
    label: 'Avenue',
    code: 'Digit2',
    keyLabel: '2',
    group: 'roads',
    tool: { kind: 'road', roadClass: 'avenue' },
  },
  {
    key: 'road:highway',
    label: 'Highway',
    code: 'Digit3',
    keyLabel: '3',
    group: 'roads',
    tool: { kind: 'road', roadClass: 'highway' },
  },
  {
    key: 'zone:residential',
    label: 'Residential',
    code: 'Digit4',
    keyLabel: '4',
    group: 'zones',
    tool: { kind: 'zone', zone: 'residential' },
  },
  {
    key: 'zone:commercial',
    label: 'Commercial',
    code: 'Digit5',
    keyLabel: '5',
    group: 'zones',
    tool: { kind: 'zone', zone: 'commercial' },
  },
  {
    key: 'zone:office',
    label: 'Office',
    code: 'Digit6',
    keyLabel: '6',
    group: 'zones',
    tool: { kind: 'zone', zone: 'office' },
  },
  {
    key: 'zone:industrial',
    label: 'Industrial',
    code: 'Digit7',
    keyLabel: '7',
    group: 'zones',
    tool: { kind: 'zone', zone: 'industrial' },
  },
  {
    key: 'zone:agricultural',
    label: 'Agricultural',
    code: 'Digit8',
    keyLabel: '8',
    group: 'zones',
    tool: { kind: 'zone', zone: 'agricultural' },
  },
  {
    key: 'line:distribution',
    label: 'Distribution line',
    code: 'KeyP',
    keyLabel: 'P',
    group: 'power',
    tool: { kind: 'line', line: 'distribution' },
  },
  {
    key: 'line:transmission',
    label: 'Transmission line',
    code: 'KeyT',
    keyLabel: 'T',
    group: 'power',
    tool: { kind: 'line', line: 'transmission' },
  },
  {
    key: 'facility:substation',
    label: 'Substation',
    code: 'KeyU',
    keyLabel: 'U',
    group: 'power',
    tool: { kind: 'facility', facility: 'substation' },
  },
  {
    key: 'facility:gasPlant',
    label: 'Gas power station',
    code: 'KeyN',
    keyLabel: 'N',
    group: 'power',
    tool: { kind: 'facility', facility: 'gasPlant' },
  },
  {
    key: 'facility:solarFarm',
    label: 'Solar farm',
    code: 'KeyL',
    keyLabel: 'L',
    group: 'power',
    tool: { kind: 'facility', facility: 'solarFarm' },
  },
  {
    key: 'facility:windTurbine',
    label: 'Wind turbine',
    code: 'KeyV',
    keyLabel: 'V',
    group: 'power',
    tool: { kind: 'facility', facility: 'windTurbine' },
  },
  {
    key: 'facility:battery',
    label: 'Battery storage',
    code: 'KeyM',
    keyLabel: 'M',
    group: 'power',
    tool: { kind: 'facility', facility: 'battery' },
  },
  {
    key: 'main:feeder',
    label: 'Feeder main',
    code: 'KeyJ',
    keyLabel: 'J',
    group: 'water',
    tool: { kind: 'main', main: 'feeder' },
  },
  {
    key: 'main:trunk',
    label: 'Trunk main',
    code: 'KeyK',
    keyLabel: 'K',
    group: 'water',
    tool: { kind: 'main', main: 'trunk' },
  },
  {
    key: 'facility:intake',
    label: 'River intake',
    code: 'Digit9',
    keyLabel: '9',
    group: 'water',
    tool: { kind: 'facility', facility: 'intake' },
  },
  {
    key: 'facility:treatmentWorks',
    label: 'Treatment works',
    code: 'Digit0',
    keyLabel: '0',
    group: 'water',
    tool: { kind: 'facility', facility: 'treatmentWorks' },
  },
  {
    key: 'facility:serviceReservoir',
    label: 'Service reservoir',
    code: 'Minus',
    keyLabel: '-',
    group: 'water',
    tool: { kind: 'facility', facility: 'serviceReservoir' },
  },
  {
    key: 'facility:waterTower',
    label: 'Water tower',
    code: 'Equal',
    keyLabel: '=',
    group: 'water',
    tool: { kind: 'facility', facility: 'waterTower' },
  },
  {
    key: 'facility:booster',
    label: 'Booster pump',
    code: 'KeyC',
    keyLabel: 'C',
    group: 'water',
    tool: { kind: 'facility', facility: 'booster' },
  },
  {
    key: 'facility:sewageWorks',
    label: 'Sewage works',
    code: 'KeyY',
    keyLabel: 'Y',
    group: 'water',
    tool: { kind: 'facility', facility: 'sewageWorks' },
  },
  {
    key: 'maintain',
    label: 'Plan maintenance',
    code: 'Semicolon',
    keyLabel: ';',
    group: 'maintain',
    tool: { kind: 'maintain' },
  },
  {
    key: 'facility:roadsDepot',
    label: 'Highways depot',
    code: 'Digit1',
    shift: true,
    keyLabel: '⇧1',
    group: 'maintain',
    tool: { kind: 'facility', facility: 'roadsDepot' },
  },
  {
    key: 'facility:waterDepot',
    label: 'Water depot',
    code: 'Digit2',
    shift: true,
    keyLabel: '⇧2',
    group: 'maintain',
    tool: { kind: 'facility', facility: 'waterDepot' },
  },
  {
    key: 'facility:powerDepot',
    label: 'Electricity depot',
    code: 'Digit3',
    shift: true,
    keyLabel: '⇧3',
    group: 'maintain',
    tool: { kind: 'facility', facility: 'powerDepot' },
  },
  {
    key: 'facility:fireStation',
    label: 'Fire station',
    code: 'Digit4',
    shift: true,
    keyLabel: '⇧4',
    group: 'services',
    tool: { kind: 'facility', facility: 'fireStation' },
  },
  {
    key: 'facility:policeStation',
    label: 'Police station',
    code: 'Digit5',
    shift: true,
    keyLabel: '⇧5',
    group: 'services',
    tool: { kind: 'facility', facility: 'policeStation' },
  },
  {
    key: 'facility:healthCentre',
    label: 'Health centre',
    code: 'Digit6',
    shift: true,
    keyLabel: '⇧6',
    group: 'services',
    tool: { kind: 'facility', facility: 'healthCentre' },
  },
  {
    key: 'facility:school',
    label: 'School',
    code: 'Digit7',
    shift: true,
    keyLabel: '⇧7',
    group: 'services',
    tool: { kind: 'facility', facility: 'school' },
  },
  {
    key: 'facility:wasteDepot',
    label: 'Waste depot',
    code: 'Digit8',
    shift: true,
    keyLabel: '⇧8',
    group: 'services',
    tool: { kind: 'facility', facility: 'wasteDepot' },
  },
  {
    key: 'facility:recyclingCentre',
    label: 'Recycling centre',
    code: 'Digit9',
    shift: true,
    keyLabel: '⇧9',
    group: 'services',
    tool: { kind: 'facility', facility: 'recyclingCentre' },
  },
  {
    key: 'facility:landfill',
    label: 'Landfill site',
    code: 'Digit0',
    shift: true,
    keyLabel: '⇧0',
    group: 'services',
    tool: { kind: 'facility', facility: 'landfill' },
  },
  {
    key: 'facility:stadium',
    label: 'Stadium',
    code: 'KeyS',
    shift: true,
    keyLabel: '⇧S',
    group: 'landmarks',
    tool: { kind: 'facility', facility: 'stadium' },
  },
  {
    key: 'facility:shoppingCentre',
    label: 'Shopping centre',
    code: 'KeyC',
    shift: true,
    keyLabel: '⇧C',
    group: 'landmarks',
    tool: { kind: 'facility', facility: 'shoppingCentre' },
  },
  {
    key: 'facility:hospital',
    label: 'Hospital',
    code: 'KeyH',
    shift: true,
    keyLabel: '⇧H',
    group: 'landmarks',
    tool: { kind: 'facility', facility: 'hospital' },
  },
  {
    key: 'facility:university',
    label: 'University',
    code: 'KeyU',
    shift: true,
    keyLabel: '⇧U',
    group: 'landmarks',
    tool: { kind: 'facility', facility: 'university' },
  },
  {
    key: 'facility:conferenceCentre',
    label: 'Events centre',
    code: 'KeyE',
    shift: true,
    keyLabel: '⇧E',
    group: 'landmarks',
    tool: { kind: 'facility', facility: 'conferenceCentre' },
  },
  {
    key: 'bulldoze',
    label: 'Bulldoze',
    code: 'KeyB',
    keyLabel: 'B',
    group: 'demolish',
    tool: { kind: 'bulldoze' },
  },
];

export function toolKey(t: ToolId): string {
  switch (t.kind) {
    case 'road':
      return `road:${t.roadClass}`;
    case 'zone':
      return `zone:${t.zone}`;
    case 'line':
      return `line:${t.line}`;
    case 'main':
      return `main:${t.main}`;
    case 'facility':
      return `facility:${t.facility}`;
    default:
      return t.kind;
  }
}
