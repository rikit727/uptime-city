/** Player settings persisted in localStorage. Missing keys fall back to defaults. */
import { STORAGE_PREFIX } from '../config';

export interface Settings {
  shadows: boolean;
  autosave: boolean;
  edgeScroll: boolean;
  showGrid: boolean;
  seenHelp: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  shadows: false,
  autosave: true,
  edgeScroll: false,
  showGrid: true,
  seenHelp: false,
};

const KEY = `${STORAGE_PREFIX}-settings`;

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private mode); settings then last for the session only.
  }
}
