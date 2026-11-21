import { describe, expect, it } from 'vitest';

import { createSetupSource, normaliseMac, sameMac, validateSetup } from './cantolSetup';
import { createMemoryStore } from './store';

const GOOD = { ssid: 'CANTOL-1234', password: 'hotspot-pass-1', mac: '00:26:32:F0:1A:BC' };

describe('MAC addresses', () => {
  it.each([
    ['00:26:32:F0:1A:BC', '00:26:32:F0:1A:BC'],
    ['00:26:32:f0:1a:bc', '00:26:32:F0:1A:BC'],
    ['00-26-32-F0-1A-BC', '00:26:32:F0:1A:BC'],
    ['0026.32f0.1abc', '00:26:32:F0:1A:BC'],
    ['002632F01ABC', '00:26:32:F0:1A:BC'],
    ['  00 26 32 F0 1A BC  ', '00:26:32:F0:1A:BC'],
  ])('reads %j as %s', (typed, normal) => {
    expect(normaliseMac(typed)).toBe(normal);
  });

  it.each([
    ['nothing', ''],
    ['five bytes', '00:26:32:F0:1A'],
    ['seven bytes', '00:26:32:F0:1A:BC:DE'],
    ['a letter beyond F', '00:26:32:F0:1A:BG'],
    ['one digit in a group', '0:26:32:F0:1A:BC'],
    ['the all-zero address, which the protocol reads as "none"', '00:00:00:00:00:00'],
    ['a word', 'cantol'],
  ])('rejects %s', (_name, typed) => {
    expect(normaliseMac(typed)).toBeNull();
  });

  it('compares addresses however they are written, and never equates two invalid ones', () => {
    expect(sameMac('00:26:32:F0:1A:BC', '0026.32f0.1abc')).toBe(true);
    expect(sameMac('00:26:32:F0:1A:BC', '00:26:32:F0:1A:BD')).toBe(false);
    expect(sameMac('nope', 'nope')).toBe(false);
    expect(sameMac('', '')).toBe(false);
  });
});

describe('validating the label values', () => {
  it('accepts good values and returns them tidy', () => {
    const check = validateSetup({ ssid: '  CANTOL-1234 ', password: 'hotspot-pass-1', mac: '00-26-32-f0-1a-bc' });
    expect(check).toEqual({ ok: true, setup: GOOD });
  });

  it('keeps the password exactly as typed, including inner and outer spaces', () => {
    const check = validateSetup({ ...GOOD, password: ' two words pass ' });
    expect(check).toMatchObject({ ok: true, setup: { password: ' two words pass ' } });
  });

  it('says what is missing, per field', () => {
    const check = validateSetup({ ssid: '', password: '', mac: '' });
    expect(check).toEqual({
      ok: false,
      errors: {
        ssid: 'Enter the network name from the Cantol label.',
        password: 'Enter the password from the Cantol label.',
        mac: 'Enter the MAC address from the Cantol label.',
      },
    });
  });

  it('holds a network name to 32 bytes, counting multi-byte characters', () => {
    expect(validateSetup({ ...GOOD, ssid: 'x'.repeat(32) }).ok).toBe(true);
    expect(validateSetup({ ...GOOD, ssid: 'x'.repeat(33) })).toMatchObject({ ok: false, errors: { ssid: expect.stringContaining('32') as string } });
    // 11 characters, 33 bytes.
    expect(validateSetup({ ...GOOD, ssid: '€'.repeat(11) }).ok).toBe(false);
    expect(validateSetup({ ...GOOD, ssid: '€'.repeat(10) }).ok).toBe(true);
  });

  it('holds a password to 8 to 63 characters of plain keyboard text', () => {
    expect(validateSetup({ ...GOOD, password: 'x'.repeat(7) }).ok).toBe(false);
    expect(validateSetup({ ...GOOD, password: 'x'.repeat(8) }).ok).toBe(true);
    expect(validateSetup({ ...GOOD, password: 'x'.repeat(63) }).ok).toBe(true);
    expect(validateSetup({ ...GOOD, password: 'x'.repeat(64) }).ok).toBe(false);
    expect(validateSetup({ ...GOOD, password: 'pässword-1' })).toMatchObject({ ok: false, errors: { password: expect.stringContaining('plain keyboard') as string } });
    expect(validateSetup({ ...GOOD, password: 'tab\tpass-1' }).ok).toBe(false);
  });

  it('rejects a MAC address that is not twelve hex digits', () => {
    expect(validateSetup({ ...GOOD, mac: '00:26:32:F0:1A' })).toMatchObject({ ok: false, errors: { mac: expect.stringContaining('twelve') as string } });
  });

  it('never repeats the password or the network name in a message', () => {
    const check = validateSetup({ ssid: 'S'.repeat(40), password: 'tiny', mac: 'zz' });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    for (const message of Object.values(check.errors)) {
      expect(message).not.toContain('tiny');
      expect(message).not.toContain('SSSS');
    }
  });
});

describe('the setup source', () => {
  it('has nothing until loaded, then holds what the store had', async () => {
    const store = createMemoryStore();
    await store.saveCantolSetup(GOOD);
    const source = createSetupSource(store);
    expect(source.current()).toBeNull();
    expect(await source.load()).toEqual(GOOD);
    expect(source.current()).toEqual(GOOD);
  });

  it('saves to the store and uses the new values at once', async () => {
    const store = createMemoryStore();
    const source = createSetupSource(store);
    expect(await source.load()).toBeNull();
    await source.save(GOOD);
    expect(source.current()).toEqual(GOOD);
    expect(await store.getCantolSetup()).toEqual(GOOD);
    await source.save({ ...GOOD, mac: '00:26:32:F0:1A:BD' });
    expect(source.current()?.mac).toBe('00:26:32:F0:1A:BD');
  });

  it('treats a stored record that no longer passes the checks as nothing saved', async () => {
    const store = createMemoryStore();
    await store.saveCantolSetup({ ssid: 'CANTOL', password: 'x', mac: 'not a mac' });
    const source = createSetupSource(store);
    expect(await source.load()).toBeNull();
    expect(source.current()).toBeNull();
  });

  it('does not change what is in use if the store refuses the save', async () => {
    const store = createMemoryStore();
    const source = createSetupSource({ ...store, saveCantolSetup: () => Promise.reject(new Error('disk full')) });
    await source.save(GOOD).catch(() => undefined);
    expect(source.current()).toBeNull();
  });
});
