import type { PermissionStatus } from '@capacitor/geolocation';
import { describe, expect, it } from 'vitest';

import { NO_FIX_AFTER_MS } from '../core/wizard';
import {
  createFieldGnss,
  GPS_WATCH_INTERVAL_MS,
  isLocationDisabled,
  mapPermission,
  type GeoPosition,
  type GeolocationApi,
} from './fieldGnss';
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
  const state = {
    servicesEnabled: true,
    rationale: 'prompt-with-rationale' as PermissionStatus['location'],
    /** What the geolocation plugin rejects its permission calls with, or null while it answers. */
    pluginError: null as Error | null,
    granted: { fine: true, coarse: true },
  };
  const calls = { clearWatch: [] as string[], watchOptions: [] as Parameters<GeolocationApi['watchPosition']>[0][], openLocationSettings: 0, openAppSettings: 0 };
  const geolocation: GeolocationApi = {
    checkPermissions: () => (state.pluginError === null ? Promise.resolve(status('granted')) : Promise.reject(state.pluginError)),
    requestPermissions: () => (state.pluginError === null ? Promise.resolve(status(state.rationale)) : Promise.reject(state.pluginError)),
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
    permissionState: () => Promise.resolve(state.granted),
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

/** What the real geolocation plugin throws while location services are off (read from its source). */
const locationDisabled = (): Error => Object.assign(new Error('Location services are not enabled.'), { code: 'OS-PLUG-GLOC-0007' });

describe('location services off, the usual state of a phone before the operator turns them on', () => {
  it('recognises the plugin\'s "location disabled" error by its code or its text, and nothing else', () => {
    expect(isLocationDisabled(locationDisabled())).toBe(true);
    expect(isLocationDisabled(Object.assign(new Error('x'), { code: 'OS-PLUG-GLOC-0007' }))).toBe(true);
    expect(isLocationDisabled(new Error('Location services are not enabled.'))).toBe(true);
    for (const other of [new Error('boom'), Object.assign(new Error('x'), { code: 'OS-PLUG-GLOC-0003' }), null, 'text', undefined]) {
      expect(isLocationDisabled(other)).toBe(false);
    }
  });

  it('still reads the permission, through the native helper, instead of failing the wizard\'s first check', async () => {
    const f = fakes();
    f.state.pluginError = locationDisabled();
    f.state.servicesEnabled = false;
    const gnss = createFieldGnss(f.geolocation, f.helper, () => 1000);
    expect(await gnss.permission()).toBe('granted');
    f.state.granted = { fine: false, coarse: true };
    expect(await gnss.permission(), 'approximate location alone counts').toBe('granted');
    f.state.granted = { fine: false, coarse: false };
    expect(await gnss.permission()).toBe('unknown');
    expect(await gnss.servicesEnabled()).toBe(false);
  });

  it('asking for permission sends the operator to turn location on, once, and says what is known', async () => {
    const f = fakes();
    f.state.pluginError = locationDisabled();
    f.state.granted = { fine: false, coarse: false };
    let clock = 10_000;
    const gnss = createFieldGnss(f.geolocation, f.helper, () => clock);
    expect(await gnss.requestPermission()).toBe('unknown');
    expect(f.calls.openLocationSettings).toBe(1);
    // The wizard then also calls ensureServicesOn for a granted permission: the same tap, not a second screen.
    f.state.granted = { fine: true, coarse: true };
    expect(await gnss.requestPermission()).toBe('granted');
    await gnss.ensureServicesOn();
    expect(f.calls.openLocationSettings, 'within a moment: the same screen').toBe(1);
    clock += 5000;
    await gnss.ensureServicesOn();
    expect(f.calls.openLocationSettings, 'a later, separate tap opens it again').toBe(2);
    // Two seconds is a person tapping again, not the second half of one tap.
    clock += 2 * 1000;
    await gnss.ensureServicesOn();
    expect(f.calls.openLocationSettings, 'a tap two seconds later is a new request').toBe(3);
  });

  it('lets any other failure through, so it is shown and not hidden', async () => {
    const f = fakes();
    f.state.pluginError = new Error('the plugin crashed');
    const gnss = createFieldGnss(f.geolocation, f.helper, () => 1);
    await expect(gnss.permission()).rejects.toThrow('the plugin crashed');
    await expect(gnss.requestPermission()).rejects.toThrow('the plugin crashed');
    expect(f.calls.openLocationSettings).toBe(0);
  });
});

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
    expect(f.calls.watchOptions).toEqual([
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0, interval: 1000, minimumUpdateInterval: 1000 },
    ]);
  });

  it('asks for positions well inside the time after which the app says "no fix"', () => {
    // The plugin defaults (interval = timeout = 10 s, fastest rate 5 s) delivered a fix about every
    // 10 s while the app calls 5 s of silence "no fix": the status flickered on a phone with a good signal.
    const f = fakes();
    createFieldGnss(f.geolocation, f.helper, () => 1).watch(() => undefined);
    const [options] = f.calls.watchOptions;
    expect(options).toBeDefined();
    const slowest = Math.max(options?.interval ?? Infinity, options?.minimumUpdateInterval ?? Infinity);
    expect(slowest, 'a fix at least this often').toBe(GPS_WATCH_INTERVAL_MS);
    expect(slowest * 3, 'two missed fixes in a row must not yet count as "no fix"').toBeLessThanOrEqual(NO_FIX_AFTER_MS);
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
