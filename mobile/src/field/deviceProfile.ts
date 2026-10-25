/**
 * The hotspot and Cantol settings the operator needs (ADR-003 decision 4): the network name and
 * password to set on the phone's hotspot, the band, and the two ports. They come from
 * `config/device-profile.local.json`, which is gitignored; when it is absent the committed
 * `device-profile.example.json` is used, and the build script says so. Both are read at build
 * time, through this one function, never from source.
 *
 * The name and password must match what the Cantol device is set to join. The password is shown
 * to the operator and copied on request; it is never sent anywhere or logged, and it is inside
 * the APK, so an APK built with a real profile is not for sharing.
 */
import type { HotspotProfile } from '../core/links';

export interface DeviceProfile extends HotspotProfile {
  tcpPort: number;
  beaconPort: number;
}

export interface LoadedProfile {
  profile: DeviceProfile;
  /** True when the committed example was used because no local profile exists. */
  isExample: boolean;
}

/** The keys `import.meta.glob` gives below: the patterns as written, relative to this file. */
const LOCAL = '../../config/device-profile.local.json';
const EXAMPLE = '../../config/device-profile.example.json';

// Vite only accepts string literals here, so the two paths are repeated rather than shared with the
// constants above. `deviceProfile.test.ts` loads the real files, so a mismatch fails there.
const files = import.meta.glob<unknown>(['../../config/device-profile.local.json', '../../config/device-profile.example.json'], {
  eager: true,
  import: 'default',
});

function text(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw new Error(`device profile: "${field}" must be text of ${String(min)} to ${String(max)} characters`);
  }
  return value;
}

function port(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`device profile: "${field}" must be a port number from 1 to 65535`);
  }
  return value;
}

/** Checks the shape; an error names the field and never repeats a value (one of them is a password). */
export function parseProfile(raw: unknown): DeviceProfile {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('device profile: expected an object');
  const o = raw as Record<string, unknown>;
  const profile: DeviceProfile = {
    // A hotspot name is at most 32 bytes and a WPA2 passphrase 8 to 63 characters.
    ssid: text(o.ssid, 'ssid', 1, 32),
    password: text(o.password, 'password', 8, 63),
    band: text(o.band, 'band', 1, 20),
    tcpPort: port(o.tcpPort, 'tcpPort'),
    beaconPort: port(o.beaconPort, 'beaconPort'),
  };
  if (profile.tcpPort === profile.beaconPort) throw new Error('device profile: "tcpPort" and "beaconPort" must differ');
  return profile;
}

/** The local profile if there is one, else the example. Pure, so a test can hand it any files. */
export function pickProfile(available: Readonly<Record<string, unknown>>): LoadedProfile {
  if (LOCAL in available) return { profile: parseProfile(available[LOCAL]), isExample: false };
  if (EXAMPLE in available) return { profile: parseProfile(available[EXAMPLE]), isExample: true };
  throw new Error('device profile: neither device-profile.local.json nor device-profile.example.json was found in mobile/config');
}

export function loadDeviceProfile(): LoadedProfile {
  return pickProfile(files);
}
