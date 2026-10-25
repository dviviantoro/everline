import { describe, expect, it } from 'vitest';

import { nodeCodec, nodeDsp } from '../test/dspNode';
import { createFieldServices, FIELD_MEASUREMENT_NOTE } from './runtime';
import type { AppStore } from '../core/store';
import type { NativePlugins } from '../native/plugins';

const opened = { settings: 0 };
const plugins: NativePlugins = {
  hotspot: {
    isOn: () => Promise.resolve({ on: true }),
    openSettings: () => {
      opened.settings += 1;
      return Promise.resolve({ index: 0, label: 'x', exact: true });
    },
  },
  link: {} as NativePlugins['link'],
  gnss: {} as NativePlugins['gnss'],
};

const services = () =>
  createFieldServices({
    dsp: nodeDsp(),
    codec: nodeCodec(),
    store: {} as AppStore,
    profile: { profile: { ssid: 'CANTOL-X', password: 'password-123', band: '2.4 GHz', tcpPort: 47000, beaconPort: 47001 }, isExample: false },
    plugins,
    geolocation: {} as never,
    now: () => 42,
  });

describe('field services', () => {
  it('says it is not a demo and cannot measure yet', () => {
    const { config, now } = services();
    expect(config.badge).toBeNull();
    expect(config.signIn).toEqual({ note: null, skipAs: null });
    expect(config.measurementNote).toBe(FIELD_MEASUREMENT_NOTE);
    expect(config.footerLinks).toHaveLength(0);
    expect(config.extraRoutes).toHaveLength(0);
    expect(now()).toBe(42);
  });

  it('shows the profile on the hotspot screen and asks the real plugin whether the hotspot is on', async () => {
    const { hotspot } = services();
    expect(hotspot.profile()).toEqual({ ssid: 'CANTOL-X', password: 'password-123', band: '2.4 GHz', tcpPort: 47000, beaconPort: 47001 });
    expect(await hotspot.isOn()).toBe(true);
    await hotspot.openSettings();
    expect(opened.settings).toBe(1);
  });

  it('has no survey API: anything that reaches for one fails loudly', async () => {
    const { api } = services();
    await expect(api.listLineAssets()).rejects.toThrow(/cannot be loaded or uploaded/);
    await expect(api.listMeasurementPoints('x')).rejects.toThrow();
    await expect(api.uploadSurvey('x', {} as never)).rejects.toThrow();
  });

  it('does not stream', async () => {
    await expect(services().link.startStream()).rejects.toThrow(/not part of this release/);
  });
});
