"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "everline-dashboard-theme";
export type Theme = "light" | "dark";

/**
 * Manual light/dark toggle for the dashboard only (landing/login keep their
 * fixed dark look by design). Persisted per-viewer via localStorage, same
 * pattern as the sidebar's collapse state.
 */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    // Reads a browser-only API unavailable during SSR, so this can't be a
    // lazy useState initializer — same justified exception as the sidebar's
    // collapse state.
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored === "dark" || stored === "light") setTheme(stored);
    } catch {
      // localStorage unavailable — keep default (light)
    }
  }, []);

  function set(next: Theme) {
    setTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore — per-viewer convenience only
    }
  }

  return [theme, set];
}
