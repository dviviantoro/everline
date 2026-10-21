/**
 * Simulated GPS. A fix arrives about a second and a half after the first watcher starts, with an
 * accuracy of about 4 m, placed where the shared `DemoWorld` says the phone is (next to the
 * chosen line, or following the walker during tracking), with a metre or two of jitter.
 * Permission and the location-services switch come from the demo controls.
 */
import type { Gnss, LocationPermission } from '../core/links';
import { offsetLatLng } from '../core/geo';
import type { GpsFix } from '../core/types';
import type { ControlsStore } from './controls';
import { createRng, type Rng } from './prng';
import type { DemoWorld } from './world';

export const FIRST_FIX_MS = 1500;
export const FIX_EVERY_MS = 1000;
export const DEMO_ACCURACY_M = 4;
/** What the operator is imagined to do in the app settings after "Open app settings". */
export const APP_SETTINGS_MS = 2500;

export class SimulatedGnss implements Gnss {
  private requested = false;
  private readonly rng: Rng;

  constructor(
    private readonly world: DemoWorld,
    private readonly controls: ControlsStore,
    private readonly now: () => number = () => Date.now(),
    seed = 3,
  ) {
    this.rng = createRng(seed);
  }

  permission(): Promise<LocationPermission> {
    if (!this.requested) return Promise.resolve('unknown');
    return Promise.resolve(this.controls.get().gpsPermission);
  }

  requestPermission(): Promise<LocationPermission> {
    this.requested = true;
    return Promise.resolve(this.controls.get().gpsPermission);
  }

  servicesEnabled(): Promise<boolean> {
    return Promise.resolve(this.controls.get().gpsServices === 'on');
  }

  ensureServicesOn(): Promise<boolean> {
    return Promise.resolve(this.controls.get().gpsServices === 'on');
  }

  openAppSettings(): Promise<void> {
    window.setTimeout(() => {
      this.controls.set({ gpsPermission: 'granted' });
    }, APP_SETTINGS_MS);
    return Promise.resolve();
  }

  /** A fix at the world position with a metre or two of error. */
  private makeFix(): GpsFix {
    // The reported accuracy is 4 m, but a fix is steadier than that from one second to the next.
    const east = this.rng.normal() * 0.8;
    const north = this.rng.normal() * 0.8;
    const at = offsetLatLng(this.world.position, east, north);
    return {
      latitude: at.latitude,
      longitude: at.longitude,
      accuracyM: DEMO_ACCURACY_M + this.rng.range(-0.5, 0.5),
      at: this.now(),
    };
  }

  watch(onFix: (fix: GpsFix) => void): () => void {
    // Negative at the start so the first fix lands FIRST_FIX_MS after the watcher can deliver.
    const initial = FIX_EVERY_MS - FIRST_FIX_MS;
    let sinceFixMs = initial;
    return this.world.onTick((dtMs) => {
      const { gpsPermission, gpsServices } = this.controls.get();
      if (!this.requested || gpsPermission !== 'granted' || gpsServices !== 'on') {
        sinceFixMs = initial;
        return;
      }
      sinceFixMs += dtMs;
      if (sinceFixMs >= FIX_EVERY_MS) {
        sinceFixMs = 0;
        onFix(this.makeFix());
      }
    });
  }
}
