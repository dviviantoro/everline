import type { PermissionStatus } from '@capacitor/geolocation';
import { describe, expect, it } from 'vitest';

import { createFieldGnss, mapPermission, type GeoPosition, type GeolocationApi } from './fieldGnss';
import type { GnssHelperNative } from './plugins';

const status = (location: PermissionStatus['location'], coarseLocation: PermissionStatus['coarseLocation'] = location): PermissionStatus => ({
  location,
  coarseLocation,
});

describe('mapPermission', () => {
  it.each([
    ['granted', 'granted', 'granted'],
    ['granted', 'denied', 'granted'],
    ['denied', 'granted', 'granted'], // only approximate location allowed: the 25 m rule decides if it is good enough
    ['prompt', 'prompt', 'unknown'],
    ['prompt-with-rationale', 'prompt-with-rationale', 'denied'], // refused once: asking again is still allowed
    ['prompt-with-rationale', 'denied', 'denied'],
    ['denied', 'denied', 'denied_permanently'], // the system will not ask any more
  ] as const)('fine %s and coarse %s is %s', (location, coarse, expected) => {
    expect(mapPermission(status(location, coarse))).toBe(expected);
  });
});

function fakes() {
  let callback: ((position: GeoPosition | null) => void) | null = null;
  let resolveWatch: (id: string) => void = () => undefined;
  const state = { servicesEnabled: true, rationale: 'prompt-with-rationale' as PermissionStatus['location'] };
  const calls = { clearWatch: [] as string[], watchOptions: [] as unknown[], openLocationSettings: 0, openAppSettings: 0 };
  const geolocation: GeolocationApi = {
    checkPermissions: () => Promise.resolve(status('granted')),
    requestPermissions: () => Promise.resolve(status(state.rationale)),
    watchPosition: (options, cb) => {
      calls.watchOptions.push(options);
      callback = cb;
      return new Promise<string>((resolve) => {
        resolveWatch = resolve;
      });
    },
    clearWatch: ({ id }) => {
      calls.clearWatch.push(id);
      return Promise.resolve();
    },
  };
  const helper: GnssHelperNative = {
    servicesEnabled: () => Promise.resolve({ enabled: state.servicesEnabled }),
    openLocationSettings: () => {
      calls.openLocationSettings += 1;
      return Promise.resolve();
    },
    openAppSettings: () => {
      calls.openAppSettings += 1;
      return Promise.resolve();
    },
  };
  return {
    geolocation,
    helper,
    state,
    calls,
    deliver: (position: GeoPosition | null) => callback?.(position),
    resolveWatch: (id: string) => {
      resolveWatch(id);
    },
  };
}

const position = (accuracy: number): GeoPosition => ({ timestamp: 1, coords: { latitude: -6.89, longitude: 109.67, accuracy } });

describe('the real Gnss', () => {
  it('reads and requests the permission through the geolocation plugin', async () => {
    const f = fakes();
    const gnss = createFieldGnss(f.geolocation, f.helper, () => 1000);
    expect(await gnss.permission()).toBe('granted');
    expect(await gnss.requestPermission()).toBe('denied');
  });

  it('asks the helper whether location services are on, and sends the operator to the screen that turns them on', async () => {
    const f = fakes();
    const gnss = createFieldGnss(f.geolocation, f.helper, () => 1000);
    expect(await gnss.servicesEnabled()).toBe(true);
    f.state.servicesEnabled = false;
    expect(await gnss.ensureServicesOn()).toBe(false);
    expect(f.calls.openLocationSettings).toBe(1);
    await gnss.openAppSettings();
    expect(f.calls.openAppSettings).toBe(1);
  });

  it('turns each position into a fix stamped with the phone clock', () => {
    const f = fakes();
    const fixes: unknown[] = [];
    createFieldGnss(f.geolocation, f.helper, () => 1234).watch((fix) => fixes.push(fix));
    f.deliver(position(6.2));
    f.deliver(null);
    expect(fixes).toEqual([{ latitude: -6.89, longitude: 109.67, accuracyM: 6.2, at: 1234 }]);
    expect(f.calls.watchOptions).toEqual([{ enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }]);
  });

  it('stops the watch when told to, whether or not the plugin had answered yet', async () => {
    const early = fakes();
    const stopEarly = createFieldGnss(early.geolocation, early.helper, () => 1).watch(() => undefined);
    stopEarly();
    early.resolveWatch('w1');
    await Promise.resolve();
    await Promise.resolve();
    expect(early.calls.clearWatch).toEqual(['w1']);

    const late = fakes();
    const fixes: unknown[] = [];
    const stopLate = createFieldGnss(late.geolocation, late.helper, () => 1).watch((fix) => fixes.push(fix));
    late.resolveWatch('w2');
    await Promise.resolve();
    await Promise.resolve();
    stopLate();
    expect(late.calls.clearWatch).toEqual(['w2']);
    late.deliver(position(5));
    expect(fixes, 'no fix after the watch was stopped').toHaveLength(0);
  });
});
