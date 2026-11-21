import { describe, expect, it } from 'vitest';

import { nodeCodec, nodeDsp } from '../test/dspNode';
import { createFieldServices, FIELD_SURVEYS_NOTE } from './runtime';
import { createMemoryStore, type AppStore } from '../core/store';
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

const services = (store: AppStore = createMemoryStore()) =>
  createFieldServices({
    dsp: nodeDsp(),
    codec: nodeCodec(),
    store,
    profile: { profile: { band: '2.4 GHz', tcpPort: 47000, beaconPort: 47001 }, isExample: false },
    plugins,
    geolocation: {} as never,
    now: () => 42,
  });

describe('field services', () => {
  it('says it is not a demo and has no survey server', () => {
    const { config, now } = services();
    expect(config.badge).toBeNull();
    expect(config.signIn).toEqual({ note: null, skipAs: null });
    expect(config.surveysNote).toBe(FIELD_SURVEYS_NOTE);
    expect(config.footerLinks).toHaveLength(0);
    expect(config.extraRoutes).toHaveLength(0);
    expect(now()).toBe(42);
  });

  it('shows what was typed from the label on the hotspot screen, and asks the real plugin whether the hotspot is on', async () => {
    const { hotspot, setup } = services();
    // Nothing typed yet: the band is the build's, the rest is empty.
    expect(hotspot.profile()).toEqual({ ssid: '', password: '', band: '2.4 GHz' });
    await setup?.save({ ssid: 'CANTOL-X', password: 'password-123', mac: '00:26:32:F0:1A:BC' });
    expect(hotspot.profile()).toEqual({ ssid: 'CANTOL-X', password: 'password-123', band: '2.4 GHz' });
    expect(await hotspot.isOn()).toBe(true);
    await hotspot.openSettings();
    expect(opened.settings).toBe(1);
  });

  it('asks the operator for the label values: it supplies a setup source that the store keeps', async () => {
    const store = createMemoryStore();
    const first = services(store);
    expect(first.setup).toBeDefined();
    expect(await first.setup?.load()).toBeNull();
    await first.setup?.save({ ssid: 'CANTOL-X', password: 'password-123', mac: '00:26:32:F0:1A:BC' });
    // A new start of the app (new services over the same store) finds them again.
    const second = services(store);
    expect(second.setup?.current()).toBeNull();
    expect(await second.setup?.load()).toEqual({ ssid: 'CANTOL-X', password: 'password-123', mac: '00:26:32:F0:1A:BC' });
    expect(second.setup?.current()?.mac).toBe('00:26:32:F0:1A:BC');
  });

  it('has no survey API: anything that reaches for one fails loudly', async () => {
    const { api } = services();
    await expect(api.listLineAssets()).rejects.toThrow(/cannot be loaded or uploaded/);
    await expect(api.listMeasurementPoints('x')).rejects.toThrow();
    await expect(api.uploadSurvey('x', {} as never)).rejects.toThrow();
  });

  it('streams through the real link: it needs the connection first, and says so', async () => {
    await expect(services().link.startStream()).rejects.toThrow(/not connected yet/);
  });
});
