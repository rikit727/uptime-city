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
  { keys: 'Left-drag', action: 'Use the current tool (roads, zones, lines, mains, bulldoze)' },
  { keys: 'Click', action: 'Place a power or water facility' },
  { keys: 'I', action: 'Inspect tool' },
  { keys: '1 / 2 / 3', action: 'Local road / avenue / highway' },
  { keys: '4 – 8', action: 'Residential, commercial, office, industrial, agricultural zones' },
  { keys: '[ / ]', action: 'Lower / raise zone density (or the maintenance threshold)' },
  { keys: 'P / T', action: 'Distribution / transmission power line' },
  { keys: 'U', action: 'Substation' },
  { keys: 'N / L / V / M', action: 'Gas power station, solar farm, wind turbine, battery' },
  { keys: 'J / K', action: 'Feeder (300 mm) / trunk (600 mm) water main' },
  { keys: '9 / 0', action: 'River intake / water treatment works' },
  { keys: '- / =', action: 'Service reservoir / water tower' },
  { keys: 'C / Y', action: 'Booster pumping station / sewage treatment works' },
  {
    keys: 'O / Shift+O',
    action:
      'Next / previous overlay: power, water pressure, wastewater, traffic, roadworks, condition, service cover, pollution, land value',
  },
  {
    keys: ';',
    action:
      'Plan maintenance (drag an area; [ / ] sets the condition threshold; night works, lane closure and combining below the toolbar)',
  },
  { keys: 'Shift+1 / 2 / 3', action: 'Highways / water / electricity depot' },
  { keys: '`', action: 'Incident inbox: incidents, work orders, roadworks permits and crews' },
  {
    keys: 'Shift+4 – 0',
    action:
      'Fire station, police station, health centre, school, waste depot, recycling centre, landfill',
  },
  {
    keys: 'Shift+S / C / H / U / E',
    action: 'Stadium, shopping centre, hospital, university, conference and events centre',
  },
  { keys: 'Shift+B', action: 'Budget: accounts, department budgets, taxes and loans' },
  { keys: 'Shift+N', action: 'City panel: happiness, events calendar and complaints' },
  { keys: 'Shift+D', action: 'Dashboard: service KPIs over the last days' },
  { keys: 'Shift+G', action: 'Scenario objectives (in a scenario)' },
  { keys: 'B', action: 'Bulldoze' },
  { keys: 'Esc', action: 'Cancel drag, close a dialog, or back to Inspect' },
  { keys: 'F10', action: 'Main menu' },
  { keys: 'Space', action: 'Pause / resume' },
  { keys: ', / .', action: 'Slower / faster' },
  { keys: 'Ctrl+S', action: 'Save and load' },
  { keys: 'G', action: 'Toggle the tile grid' },
  { keys: 'H', action: 'Help and controls' },
];
