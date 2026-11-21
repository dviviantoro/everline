/**
 * What is printed on the Cantol device's label, as the operator types it on first use: the name
 * and password of the hotspot the device joins, and the device's own MAC address.
 *
 * The device cannot be asked to join a different network, so the phone's hotspot has to match
 * these values; and the MAC address is how the app tells the Cantol it was meant to reach from any
 * other device that happens to answer on the same hotspot (the device reports its MAC in its PONG
 * and in its beacon; see `linkCodec.ts`). The MAC check guards against the wrong unit, not against
 * a hostile one: anyone on the hotspot can announce any address, and the hotspot password is the
 * real gate.
 *
 * Everything here is pure. Validation messages never repeat a value (one of them is a password).
 */
import type { AppStore } from './store';

export interface CantolSetup {
  /** The hotspot name the device joins. */
  ssid: string;
  /** The hotspot password, exactly as typed. */
  password: string;
  /** The device's MAC address, upper case with colons: `00:26:32:F0:1A:BC`. */
  mac: string;
}

/** What the form holds while it is being typed: nothing has been checked yet. */
export interface SetupDraft {
  ssid: string;
  password: string;
  mac: string;
}

export type SetupField = keyof CantolSetup;
export type SetupErrors = Partial<Record<SetupField, string>>;

export type SetupCheck = { ok: true; setup: CantolSetup } | { ok: false; errors: SetupErrors };

/** A hotspot name is at most 32 bytes; a WPA2 passphrase is 8 to 63 printable ASCII characters. */
export const SSID_MAX_BYTES = 32;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 63;

const MAC_DIGITS = /^[0-9A-F]{12}$/;

/**
 * `00:26:32:F0:1A:BC` from what a person types or reads off a label: colons, dashes, dots (Cisco
 * style `0026.32f0.1abc`), spaces or nothing between the digits, in either case. `null` when it is
 * not exactly twelve hex digits, or is the all-zero address, which means "no MAC" to the protocol.
 */
export function normaliseMac(text: string): string | null {
  const digits = text.replace(/[\s:.-]/g, '').toUpperCase();
  if (!MAC_DIGITS.test(digits) || /^0+$/.test(digits)) return null;
  return digits.match(/.{2}/g)?.join(':') ?? null;
}

/** True when both texts are the same MAC address, however each is written. */
export function sameMac(a: string, b: string): boolean {
  const left = normaliseMac(a);
  return left !== null && left === normaliseMac(b);
}

function isPrintableAscii(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

/** Checks the three fields; the name and the MAC are tidied (surrounding spaces, notation), the password is kept as typed. */
export function validateSetup(draft: SetupDraft): SetupCheck {
  const errors: SetupErrors = {};

  const ssid = draft.ssid.trim();
  if (ssid === '') errors.ssid = 'Enter the network name from the Cantol label.';
  else if (new TextEncoder().encode(ssid).length > SSID_MAX_BYTES) {
    errors.ssid = `A network name is at most ${String(SSID_MAX_BYTES)} characters.`;
  }

  const { password } = draft;
  if (password === '') errors.password = 'Enter the password from the Cantol label.';
  else if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    errors.password = `A hotspot password is ${String(PASSWORD_MIN)} to ${String(PASSWORD_MAX)} characters.`;
  } else if (!isPrintableAscii(password)) {
    errors.password = 'A hotspot password uses only letters, digits and symbols found on a plain keyboard.';
  }

  const mac = normaliseMac(draft.mac);
  if (draft.mac.trim() === '') errors.mac = 'Enter the MAC address from the Cantol label.';
  else if (mac === null) errors.mac = 'A MAC address is twelve digits or letters A to F, like 00:26:32:F0:1A:BC.';

  if (Object.keys(errors).length > 0 || mac === null) return { ok: false, errors };
  return { ok: true, setup: { ssid, password, mac } };
}

/**
 * Where the values live while the app runs. `current()` is read at the moment of use (the link
 * checks every answer against it), so a change takes effect without restarting anything.
 */
export interface CantolSetupSource {
  /** Reads what was saved on this phone. Resolves null when nothing was. Call once at start. */
  load(): Promise<CantolSetup | null>;
  /** The values in use now: null until they were loaded and found, or saved. */
  current(): CantolSetup | null;
  save(setup: CantolSetup): Promise<void>;
}

/** The values kept in the app's own store, which survives the app being closed. */
export function createSetupSource(store: AppStore): CantolSetupSource {
  let current: CantolSetup | null = null;
  return {
    load: async () => {
      const saved = await store.getCantolSetup();
      // A stored value that no longer passes the checks (an older version, a damaged record) is as good as none.
      const check = saved === null ? null : validateSetup(saved);
      current = check?.ok === true ? check.setup : null;
      return current;
    },
    current: () => current,
    save: async (setup) => {
      await store.saveCantolSetup(setup);
      current = setup;
    },
  };
}
