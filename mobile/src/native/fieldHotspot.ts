/**
 * The real `HotspotAssistant` (ADR-003 strategies S0 and S3). The phone cannot be told to switch
 * its hotspot on or to change its name and password: Android has no public API for it. So this
 * shows the operator the values to set once (the ones they typed from the Cantol's label), opens
 * the system screen where they do it, and reports when the hotspot is on.
 */
import type { CantolSetupSource } from '../core/cantolSetup';
import type { HotspotAssistant } from '../core/links';
import type { HotspotAssistantNative } from './plugins';

export function createFieldHotspot(native: HotspotAssistantNative, band: string, setup: CantolSetupSource): HotspotAssistant {
  return {
    // Read each time: the operator can correct the label values, and the next screen shows them.
    profile: () => {
      const values = setup.current();
      return { ssid: values?.ssid ?? '', password: values?.password ?? '', band };
    },
    isOn: async () => (await native.isOn()).on,
    openSettings: async () => {
      await native.openSettings();
    },
  };
}
