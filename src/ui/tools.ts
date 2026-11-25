/** The build toolbar's tools. Pure data: the app binds behaviour, the UI draws buttons. */
import type { FacilityId, LineTypeId, RoadClassId, ZoneId } from '../sim';

export type ToolId =
  | { kind: 'inspect' }
  | { kind: 'road'; roadClass: RoadClassId }
  | { kind: 'zone'; zone: ZoneId }
  | { kind: 'line'; line: LineTypeId }
  | { kind: 'facility'; facility: FacilityId }
  | { kind: 'bulldoze' };

export interface ToolDef {
  key: string;
  label: string;
  /** Keyboard shortcut (KeyboardEvent.code) and its display label. */
  code: string;
  keyLabel: string;
  group: 'select' | 'roads' | 'zones' | 'power' | 'demolish';
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
    case 'facility':
      return `facility:${t.facility}`;
    default:
      return t.kind;
  }
}
