/**
 * Light and dark theme persistence (`mobile-design-system.md` section 3).
 *
 * Class-based, like `apps/lib/useTheme.ts`. The choice lives in `localStorage` under the same key
 * the web app and the design mock use. The WebView can deny storage, so every access is wrapped
 * and the app renders correctly with no stored value (dark).
 */

export type ThemeMode = 'dark' | 'light';

export const THEME_KEY = 'everline-theme';

/** The slice of `Storage` the theme code needs, so tests can pass a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'dark' || value === 'light';
}

/** The stored theme, or null when nothing valid is stored or storage is unavailable. */
export function readStoredTheme(storage: StorageLike | null = defaultStorage()): ThemeMode | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(THEME_KEY);
    return isThemeMode(value) ? value : null;
  } catch {
    return null;
  }
}

/** The first-run default is dark, as in the web app's landing and login. */
export function initialTheme(storage: StorageLike | null = defaultStorage()): ThemeMode {
  return readStoredTheme(storage) ?? 'dark';
}

/** Persist the choice. Returns false when storage refused it (the toggle still works in memory). */
export function storeTheme(mode: ThemeMode, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(THEME_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

export function otherTheme(mode: ThemeMode): ThemeMode {
  return mode === 'dark' ? 'light' : 'dark';
}

export function themeToggleLabel(mode: ThemeMode): string {
  return mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}

/** System bar colours per theme: the page background, and which way the icons should lean. */
export const SYSTEM_BAR: Readonly<Record<ThemeMode, { background: string; lightIcons: boolean }>> = {
  dark: { background: '#0A0D10', lightIcons: true },
  light: { background: '#F2F4F6', lightIcons: false },
};
