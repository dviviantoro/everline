/**
 * The Cantol settings that belong to the build, not to one device: the Wi-Fi band the hotspot
 * should use and the two ports the link speaks (ADR-003 decision 4). They come from
 * `config/device-profile.local.json`, which is gitignored; when it is absent the committed
 * `device-profile.example.json` is used, and its values are the right ones for a stock unit. Both
 * are read at build time, through this one function, never from source.
 *
 * The hotspot name and password and the unit's MAC address are NOT here. They are printed on each
 * Cantol's label and the operator types them on the phone the first time (`core/cantolSetup.ts`),
 * so an APK carries no network secret and one build serves every unit. A `ssid` or `password` key
 * left in an older local profile is ignored.
 */
export interface DeviceProfile {
  /** Shown on the hotspot screen: the band to choose in the phone's hotspot settings. */
  band: string;
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

/** Checks the shape; an error names the field and never repeats a value. */
export function parseProfile(raw: unknown): DeviceProfile {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('device profile: expected an object');
  const o = raw as Record<string, unknown>;
  const profile: DeviceProfile = {
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
