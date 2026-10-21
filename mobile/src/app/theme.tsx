/** Applies the light or dark theme to the document and keeps it persisted. Logic is in `core/theme.ts`. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { initialTheme, otherTheme, storeTheme, type ThemeMode } from '../core/theme';
import { applySystemBars } from './systemBars';

interface ThemeValue {
  mode: ThemeMode;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(initialTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(mode);
    root.dataset['theme'] = mode;
    void applySystemBars(mode);
  }, [mode]);

  const toggle = useCallback(() => {
    const next = otherTheme(mode);
    storeTheme(next);
    setMode(next);
  }, [mode]);

  const value = useMemo(() => ({ mode, toggle }), [mode, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
