/** The build toolbar's tools. Pure data: the app binds behaviour, the UI draws buttons. */
import type { RoadClassId, ZoneId } from '../sim';

export type ToolId =
  | { kind: 'inspect' }
  | { kind: 'road'; roadClass: RoadClassId }
  | { kind: 'zone'; zone: ZoneId }
  | { kind: 'bulldoze' };

export interface ToolDef {
  key: string;
  label: string;
  /** Keyboard shortcut (KeyboardEvent.code) and its display label. */
  code: string;
  keyLabel: string;
  group: 'select' | 'roads' | 'zones' | 'demolish';
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
    key: 'bulldoze',
    label: 'Bulldoze',
    code: 'KeyB',
    keyLabel: 'B',
    group: 'demolish',
    tool: { kind: 'bulldoze' },
  },
];

export const toolKey = (t: ToolId): string =>
  t.kind === 'road' ? `road:${t.roadClass}` : t.kind === 'zone' ? `zone:${t.zone}` : t.kind;
