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
    options: { enableHighAccuracy: boolean; timeout: number; maximumAge: number },
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

export function createFieldGnss(geolocation: GeolocationApi, helper: GnssHelperNative, now: () => number): Gnss {
  return {
    permission: async () => mapPermission(await geolocation.checkPermissions()),
    requestPermission: async () => mapPermission(await geolocation.requestPermissions()),
    servicesEnabled: async () => (await helper.servicesEnabled()).enabled,
    ensureServicesOn: async () => {
      // The system screen is where the operator turns location on; the wizard re-checks every 2 s.
      await helper.openLocationSettings();
      return (await helper.servicesEnabled()).enabled;
    },
    openAppSettings: () => helper.openAppSettings(),
    watch: (onFix) => {
      let id: string | null = null;
      let stopped = false;
      void geolocation
        .watchPosition({ enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }, (position) => {
          if (stopped || position === null) return;
          const fix: GpsFix = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyM: position.coords.accuracy,
            at: now(),
          };
          onFix(fix);
        })
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
