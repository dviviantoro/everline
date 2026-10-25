/**
 * The real `HotspotAssistant` (ADR-003 strategies S0 and S3). The phone cannot be told to switch
 * its hotspot on or to change its name and password: Android has no public API for it. So this
 * shows the operator the values to set once (from the device profile), opens the system screen
 * where they do it, and reports when the hotspot is on.
 */
import type { HotspotAssistant, HotspotProfile } from '../core/links';
import type { HotspotAssistantNative } from './plugins';

export function createFieldHotspot(native: HotspotAssistantNative, profile: HotspotProfile): HotspotAssistant {
  return {
    profile: () => profile,
    isOn: async () => (await native.isOn()).on,
    openSettings: async () => {
      await native.openSettings();
    },
  };
}
