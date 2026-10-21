/** Simulated hotspot: off until a moment after the operator taps "Open hotspot settings". */
import type { HotspotAssistant, HotspotProfile } from '../core/links';

/** Placeholder values. The real ones come from the gitignored device profile and are never committed. */
export const DEMO_HOTSPOT_PROFILE: HotspotProfile = {
  ssid: 'DEMO-hotspot',
  band: '2.4 GHz',
  password: 'demo-placeholder',
};

/** How long the operator is imagined to take in the system settings. */
export const HOTSPOT_SETTLE_MS = 2500;

export class SimulatedHotspot implements HotspotAssistant {
  private on = false;
  private timer: number | null = null;

  profile(): HotspotProfile {
    return DEMO_HOTSPOT_PROFILE;
  }

  isOn(): Promise<boolean> {
    return Promise.resolve(this.on);
  }

  openSettings(): Promise<void> {
    if (!this.on && this.timer === null) {
      this.timer = window.setTimeout(() => {
        this.on = true;
        this.timer = null;
      }, HOTSPOT_SETTLE_MS);
    }
    return Promise.resolve();
  }

  /** Back to off, as at a fresh launch (demo "reset all data"). */
  reset(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.on = false;
  }
}
