import { describe, expect, it } from 'vitest';

import {
  initialTheme,
  otherTheme,
  readStoredTheme,
  storeTheme,
  themeToggleLabel,
  THEME_KEY,
  type StorageLike,
} from './theme';

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const denied: StorageLike = {
  getItem: () => {
    throw new Error('storage denied');
  },
  setItem: () => {
    throw new Error('storage denied');
  },
};

describe('theme persistence', () => {
  it('uses the same key as the web app and the design mock', () => {
    expect(THEME_KEY).toBe('everline-theme');
  });

  it('defaults to dark when nothing is stored', () => {
    expect(initialTheme(fakeStorage())).toBe('dark');
    expect(readStoredTheme(fakeStorage())).toBeNull();
  });

  it('round-trips the choice through storage, so it survives a restart', () => {
    const storage = fakeStorage();
    expect(storeTheme('light', storage)).toBe(true);
    expect(storage.data.get(THEME_KEY)).toBe('light');
    expect(initialTheme(storage)).toBe('light');
    storeTheme('dark', storage);
    expect(initialTheme(storage)).toBe('dark');
  });

  it('ignores a stored value that is not a theme', () => {
    expect(initialTheme(fakeStorage({ [THEME_KEY]: 'sepia' }))).toBe('dark');
  });

  it('still works when storage throws or is missing (the WebView can deny it)', () => {
    expect(initialTheme(denied)).toBe('dark');
    expect(storeTheme('light', denied)).toBe(false);
    expect(initialTheme(null)).toBe('dark');
    expect(storeTheme('light', null)).toBe(false);
  });

  it('toggles and labels the switch for the mode it would switch to', () => {
    expect(otherTheme('dark')).toBe('light');
    expect(otherTheme('light')).toBe('dark');
    expect(themeToggleLabel('dark')).toBe('Switch to light mode');
    expect(themeToggleLabel('light')).toBe('Switch to dark mode');
  });
});
