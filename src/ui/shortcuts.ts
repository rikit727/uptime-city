/** The controls list shown in the help panel. Keep in sync with app/input.ts. */
export interface ShortcutRow {
  keys: string;
  action: string;
}

export const CONTROL_ROWS: readonly ShortcutRow[] = [
  { keys: 'W A S D / arrow keys', action: 'Pan the camera' },
  { keys: 'Q / E', action: 'Rotate the camera' },
  { keys: 'R / F', action: 'Tilt the camera' },
  { keys: 'Mouse wheel, Z / X', action: 'Zoom in / out' },
  { keys: 'Right-drag', action: 'Rotate and tilt' },
  { keys: 'Middle-drag, or left-drag with Inspect', action: 'Pan' },
  { keys: 'Left-drag', action: 'Use the current tool (roads, zones, lines, bulldoze)' },
  { keys: 'Click', action: 'Place a power facility' },
  { keys: 'I', action: 'Inspect tool' },
  { keys: '1 / 2 / 3', action: 'Local road / avenue / highway' },
  { keys: '4 – 8', action: 'Residential, commercial, office, industrial, agricultural zones' },
  { keys: '[ / ]', action: 'Lower / raise zone density' },
  { keys: 'P / T', action: 'Distribution / transmission power line' },
  { keys: 'U', action: 'Substation' },
  { keys: 'N / L / V / M', action: 'Gas power station, solar farm, wind turbine, battery' },
  { keys: 'B', action: 'Bulldoze' },
  { keys: 'Esc', action: 'Cancel drag, close panel, or back to Inspect' },
  { keys: 'Space', action: 'Pause / resume' },
  { keys: ', / .', action: 'Slower / faster' },
  { keys: 'Ctrl+S', action: 'Save and load' },
  { keys: 'G', action: 'Toggle the tile grid' },
  { keys: 'H', action: 'Help and controls' },
];
