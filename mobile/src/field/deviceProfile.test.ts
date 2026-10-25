import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { loadDeviceProfile, parseProfile, pickProfile } from './deviceProfile';

const VALID = { ssid: 'CANTOL-TEST', password: 'a-long-enough-secret', band: '2.4 GHz', tcpPort: 47000, beaconPort: 47001 };
const LOCAL = '../../config/device-profile.local.json';
const EXAMPLE = '../../config/device-profile.example.json';

describe('device profile', () => {
  it('accepts a complete profile', () => {
    expect(parseProfile(VALID)).toEqual(VALID);
  });

  it.each([
    ['not an object', 'text', /expected an object/],
    ['an array', [], /expected an object/],
    ['no ssid', { ...VALID, ssid: undefined }, /"ssid"/],
    ['an empty ssid', { ...VALID, ssid: '' }, /"ssid"/],
    ['an ssid over 32 characters', { ...VALID, ssid: 'x'.repeat(33) }, /"ssid"/],
    ['a password under 8 characters', { ...VALID, password: 'short' }, /"password"/],
    ['a password over 63 characters', { ...VALID, password: 'x'.repeat(64) }, /"password"/],
    ['a numeric band', { ...VALID, band: 5 }, /"band"/],
    ['a text port', { ...VALID, tcpPort: '47000' }, /"tcpPort"/],
    ['port 0', { ...VALID, tcpPort: 0 }, /"tcpPort"/],
    ['a port over 65535', { ...VALID, beaconPort: 70000 }, /"beaconPort"/],
    ['a fractional port', { ...VALID, beaconPort: 47001.5 }, /"beaconPort"/],
    ['the same port twice', { ...VALID, beaconPort: 47000 }, /must differ/],
  ])('rejects %s', (_name, raw, message) => {
    expect(() => parseProfile(raw)).toThrow(message);
  });

  it('never repeats the password or the network name in an error', () => {
    for (const bad of [{ ...VALID, tcpPort: 'x' }, { ...VALID, band: '' }, { ...VALID, beaconPort: 47000 }]) {
      try {
        parseProfile(bad);
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).not.toContain(VALID.password);
        expect((error as Error).message).not.toContain(VALID.ssid);
      }
    }
  });

  it('prefers the local profile and falls back to the example', () => {
    const local = { ...VALID, ssid: 'MY-PHONE' };
    expect(pickProfile({ [LOCAL]: local, [EXAMPLE]: VALID })).toEqual({ profile: local, isExample: false });
    expect(pickProfile({ [EXAMPLE]: VALID })).toEqual({ profile: VALID, isExample: true });
    expect(() => pickProfile({})).toThrow(/neither/);
  });

  it('a broken local profile is an error, not a silent fall back to the example', () => {
    expect(() => pickProfile({ [LOCAL]: { ...VALID, password: 'x' }, [EXAMPLE]: VALID })).toThrow(/"password"/);
  });

  it('loads what is really in mobile/config, as the bundler sees it', () => {
    const local = existsSync(new URL('../../config/device-profile.local.json', import.meta.url));
    const loaded = loadDeviceProfile();
    expect(loaded.isExample).toBe(!local);
    expect(loaded.profile.tcpPort).toBeGreaterThan(0);
  });

  it('the committed example is valid and holds no real secret', () => {
    const example = JSON.parse(readFileSync(new URL('../../config/device-profile.example.json', import.meta.url), 'utf8')) as unknown;
    const profile = parseProfile(example);
    expect(profile.ssid).toMatch(/EXAMPLE/i);
    expect(profile.password).toMatch(/change-me|example/i);
  });
});
