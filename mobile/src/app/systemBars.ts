/**
 * Makes the Android status and navigation bars follow the theme (`mobile-design-system.md`
 * section 3). On a phone running edge-to-edge the page background shows under both bars, so the
 * work is choosing light or dark icons; the status bar colour is also set for older Android.
 * Does nothing on the web.
 */
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

import { SYSTEM_BAR, type ThemeMode } from '../core/theme';

export async function applySystemBars(mode: ThemeMode): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const { background, lightIcons } = SYSTEM_BAR[mode];
  try {
    await SystemBars.setStyle({ style: lightIcons ? SystemBarsStyle.Dark : SystemBarsStyle.Light });
  } catch {
    // Older WebView or plugin mismatch: the bars keep their previous look.
  }
  try {
    await StatusBar.setStyle({ style: lightIcons ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: background });
  } catch {
    // setBackgroundColor is ignored while the WebView overlays the status bar; that is fine.
  }
}
