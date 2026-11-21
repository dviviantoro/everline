/**
 * The real `Gnss`: fixes and the permission come from `@capacitor/geolocation`; whether location
 * services are on, and the screens that fix a "no", come from the app's own `GnssHelper` plugin.
 */
import type { PermissionStatus } from '@capacitor/geolocation';

import type { Gnss, LocationPermission } from '../core/links';
import type { GpsFix } from '../core/types';
import type { GnssHelperNative } from './plugins';

/** The slice of `@capacitor/geolocation` this adapter uses. */
export interface GeolocationApi {
  checkPermissions(): Promise<PermissionStatus>;
  requestPermissions(): Promise<PermissionStatus>;
  watchPosition(
    options: {
      enableHighAccuracy: boolean;
      timeout: number;
      maximumAge: number;
      /** How often the plugin asks the system for a position. It defaults to `timeout`, which is far too slow. */
      interval: number;
      /** The fastest the plugin passes positions on. It defaults to 5 s, which would cap `interval`. */
      minimumUpdateInterval: number;
    },
    callback: (position: GeoPosition | null, error?: unknown) => void,
  ): Promise<string>;
  clearWatch(options: { id: string }): Promise<void>;
}

export interface GeoPosition {
  timestamp: number;
  coords: { latitude: number; longitude: number; accuracy: number };
}

/**
 * Android reports "prompt" before the first question, "prompt-with-rationale" after one refusal
 * (asking again is still allowed) and "denied" once the system will not ask any more. Coarse
 * location alone counts as granted: the 25 m accuracy rule then decides if it is good enough.
 */
export function mapPermission(status: PermissionStatus): LocationPermission {
  if (status.location === 'granted' || status.coarseLocation === 'granted') return 'granted';
  if (status.location === 'denied' && status.coarseLocation === 'denied') return 'denied_permanently';
  if (status.location === 'prompt-with-rationale' || status.coarseLocation === 'prompt-with-rationale') return 'denied';
  return 'unknown';
}

/** What `@capacitor/geolocation` rejects `checkPermissions()` and `requestPermissions()` with while location services are off. */
const LOCATION_DISABLED_CODE = 'OS-PLUG-GLOC-0007';

export function isLocationDisabled(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === LOCATION_DISABLED_CODE || (error instanceof Error && /location services are not enabled/i.test(error.message));
}

/**
 * How often a position is asked for while watching. Left alone, `@capacitor/geolocation` uses the
 * `timeout` (10 s) as the interval and 5 s as the fastest rate, so a fix arrived about every 10 s
 * while the app declares "no fix" after 5 s of silence (`NO_FIX_AFTER_MS`): the status flickered
 * between "on" and "no fix" on a phone with a good signal. One second keeps it well inside.
 */
export const GPS_WATCH_INTERVAL_MS = 1000;

/**
 * A second request for the settings screen within this long is the same request: one tap on "Enable
 * GPS" asks for the permission and then for location services, a native round trip apart. Kept short,
 * because a person who comes back and taps again a moment later must get the screen again.
 */
export const SETTINGS_DEBOUNCE_MS = 1000;

export function createFieldGnss(geolocation: GeolocationApi, helper: GnssHelperNative, now: () => number): Gnss {
  let settingsOpenedAt = -Infinity;
  const openLocationSettings = async (): Promise<void> => {
    if (now() - settingsOpenedAt < SETTINGS_DEBOUNCE_MS) return;
    settingsOpenedAt = now();
    await helper.openLocationSettings();
  };
  /** The permission as far as it can be told without the geolocation plugin: granted, or not (yet) known. */
  const permissionWithoutPlugin = async (): Promise<LocationPermission> => {
    const state = await helper.permissionState();
    return state.fine || state.coarse ? 'granted' : 'unknown';
  };
  return {
    // The geolocation plugin refuses both calls while location is off, which is the usual state of a
    // phone before the operator turns it on. That must not leave the wizard unable to start.
    permission: async () => {
      try {
        return mapPermission(await geolocation.checkPermissions());
      } catch (error) {
        if (!isLocationDisabled(error)) throw error;
        return permissionWithoutPlugin();
      }
    },
    requestPermission: async () => {
      try {
        return mapPermission(await geolocation.requestPermissions());
      } catch (error) {
        if (!isLocationDisabled(error)) throw error;
        // Android's permission dialog cannot be asked for through the plugin while location is off, so
        // send the operator to turn it on first; the next tap on "Enable GPS" then asks for permission.
        await openLocationSettings();
        return permissionWithoutPlugin();
      }
    },
    servicesEnabled: async () => (await helper.servicesEnabled()).enabled,
    ensureServicesOn: async () => {
      // The system screen is where the operator turns location on; the wizard re-checks every 2 s.
      await openLocationSettings();
      return (await helper.servicesEnabled()).enabled;
    },
    openAppSettings: () => helper.openAppSettings(),
    watch: (onFix) => {
      let id: string | null = null;
      let stopped = false;
      void geolocation
        .watchPosition(
          {
            enableHighAccuracy: true,
            timeout: 10_000,
            maximumAge: 0,
            interval: GPS_WATCH_INTERVAL_MS,
            minimumUpdateInterval: GPS_WATCH_INTERVAL_MS,
          },
          (position) => {
            if (stopped || position === null) return;
            const fix: GpsFix = {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracyM: position.coords.accuracy,
              at: now(),
            };
            onFix(fix);
          },
        )
        .then((watchId) => {
          if (stopped) void geolocation.clearWatch({ id: watchId });
          else id = watchId;
        })
        .catch(() => undefined);
      return () => {
        stopped = true;
        if (id !== null) void geolocation.clearWatch({ id });
      };
    },
  };
}
