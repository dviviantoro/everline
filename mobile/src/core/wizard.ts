/**
 * The connection wizard as a pure reducer (`mobile-app.md` "Connection wizard", amended by
 * ADR-006): HOTSPOT_CHECK, HOTSPOT_GUIDE, CANTOL_DISCOVER, CANTOL_PING, LOCATION, STREAMING,
 * READY. The old PERMS state is folded into LOCATION.
 *
 * The state holds facts (is the hotspot on, is Cantol linked, is there a good fix); the step is
 * always derived from them as the first unmet requirement, so every check is idempotent: a fact
 * can be reported twice, or re-checked on app resume, and the step does not change unless the
 * fact did. Time enters only as timestamps carried by events, so the reducer stays pure.
 *
 * Losing something that was working does not send the operator back at once: the hotspot, the
 * Cantol link and the GPS fix each recover silently for 30 seconds (`LINK_GRACE_MS`) first.
 */
import type { LocationPermission } from './links';

export type WizardStep =
  | 'HOTSPOT_CHECK'
  | 'HOTSPOT_GUIDE'
  | 'CANTOL_DISCOVER'
  | 'CANTOL_PING'
  | 'LOCATION'
  | 'STREAMING'
  | 'READY';

/** How long a lost hotspot, link or fix recovers silently before the wizard reopens. */
export const LINK_GRACE_MS = 30_000;
/** After this long without a candidate the Cantol screen shows the help card. */
export const CANTOL_HELP_AFTER_MS = 60_000;
/** Assumption: the product has not set a minimum accuracy for a survey (`mobile-ui-spec.md` section 3.4). */
export const MIN_GPS_ACCURACY_M = 25;

export type HotspotFact = 'unknown' | 'on' | 'off';
export type CantolFact = 'unknown' | 'searching' | 'found' | 'linked' | 'lost';

export interface WizardState {
  hotspot: HotspotFact;
  /** The operator chose "Continue anyway" although the hotspot was not detected. */
  hotspotAcknowledged: boolean;
  /** When the hotspot, once on, was last seen off (null while it is on or was never on). */
  hotspotLostAt: number | null;

  cantol: CantolFact;
  cantolAddress: string | null;
  /** The id Cantol reported when found (for the Live header). */
  cantolDeviceId: string | null;
  rttMs: number | null;
  /** When the current search began (for the 60 s help card). */
  searchStartedAt: number | null;
  cantolLostAt: number | null;

  /** True once the first permission query has answered ("unknown" is then a real answer: not asked yet). */
  gpsChecked: boolean;
  gpsPermission: LocationPermission;
  gpsServices: 'unknown' | 'on' | 'off';
  accuracyM: number | null;
  gpsLostAt: number | null;

  streaming: boolean;
  /** The latest timestamp the reducer was told about. */
  nowMs: number;
  /** Bumped by RESUME so the drivers run every check again. */
  checkRound: number;
}

export const initialWizardState: WizardState = {
  hotspot: 'unknown',
  hotspotAcknowledged: false,
  hotspotLostAt: null,
  cantol: 'unknown',
  cantolAddress: null,
  cantolDeviceId: null,
  rttMs: null,
  searchStartedAt: null,
  cantolLostAt: null,
  gpsChecked: false,
  gpsPermission: 'unknown',
  gpsServices: 'unknown',
  accuracyM: null,
  gpsLostAt: null,
  streaming: false,
  nowMs: 0,
  checkRound: 0,
};

export type WizardEvent =
  | { type: 'HOTSPOT_STATUS'; on: boolean; at: number }
  | { type: 'HOTSPOT_CONTINUE_ANYWAY' }
  | { type: 'CANTOL_SEARCH_STARTED'; at: number }
  | { type: 'CANTOL_FOUND'; address: string; deviceId: string }
  | { type: 'CANTOL_LINKED'; rttMs: number }
  | { type: 'LINK_LOST'; at: number }
  | { type: 'LINK_RESTORED' }
  | { type: 'GPS_PERMISSION'; permission: LocationPermission }
  | { type: 'GPS_SERVICES'; enabled: boolean }
  | { type: 'GPS_FIX'; accuracyM: number }
  | { type: 'GPS_LOST'; at: number }
  | { type: 'STREAM_STARTED' }
  | { type: 'STREAM_STOPPED' }
  | { type: 'TICK'; at: number }
  | { type: 'RESUME' }
  | { type: 'RESET' };

function withinGrace(lostAt: number | null, now: number): boolean {
  return lostAt !== null && now - lostAt <= LINK_GRACE_MS;
}

export function hotspotMet(s: WizardState): boolean {
  return s.hotspot === 'on' || s.hotspotAcknowledged || (s.hotspot === 'off' && withinGrace(s.hotspotLostAt, s.nowMs));
}

export function cantolMet(s: WizardState): boolean {
  return s.cantol === 'linked' || (s.cantol === 'lost' && withinGrace(s.cantolLostAt, s.nowMs));
}

export function gpsMet(s: WizardState): boolean {
  if (s.gpsPermission !== 'granted' || s.gpsServices !== 'on') return false;
  if (s.accuracyM !== null) return s.accuracyM <= MIN_GPS_ACCURACY_M;
  return withinGrace(s.gpsLostAt, s.nowMs);
}

/** The first unmet requirement, or READY / STREAMING when all three are met. */
export function wizardStep(s: WizardState): WizardStep {
  if (!hotspotMet(s)) return s.hotspot === 'off' ? 'HOTSPOT_GUIDE' : 'HOTSPOT_CHECK';
  if (!cantolMet(s)) return s.cantol === 'found' ? 'CANTOL_PING' : 'CANTOL_DISCOVER';
  if (!gpsMet(s)) return 'LOCATION';
  return s.streaming ? 'STREAMING' : 'READY';
}

/** True once the quick checks (hotspot, GPS) have answered, so the first screen is not a guess. */
export function wizardInitialised(s: WizardState): boolean {
  return s.hotspot !== 'unknown' && s.gpsChecked && s.gpsServices !== 'unknown';
}

/** The 60 s help card (is Cantol powered, is its Wi-Fi set to the hotspot). */
export function helpCardVisible(s: WizardState): boolean {
  return s.cantol === 'searching' && s.searchStartedAt !== null && s.nowMs - s.searchStartedAt >= CANTOL_HELP_AFTER_MS;
}

/** True while the reducer needs clock ticks (a search, or something in its grace period). */
export function needsClock(s: WizardState): boolean {
  return s.cantol === 'searching' || s.cantol === 'lost' || s.hotspotLostAt !== null || s.gpsLostAt !== null;
}

export function wizardReducer(s: WizardState, event: WizardEvent): WizardState {
  switch (event.type) {
    case 'HOTSPOT_STATUS': {
      const now = Math.max(s.nowMs, event.at);
      if (event.on) return { ...s, hotspot: 'on', hotspotLostAt: null, nowMs: now };
      const wasOn = s.hotspot === 'on';
      return { ...s, hotspot: 'off', hotspotLostAt: wasOn ? event.at : s.hotspotLostAt, nowMs: now };
    }
    case 'HOTSPOT_CONTINUE_ANYWAY':
      return { ...s, hotspotAcknowledged: true };
    case 'CANTOL_SEARCH_STARTED':
      if (s.cantol === 'searching' || s.cantol === 'found' || s.cantol === 'linked') return s;
      return { ...s, cantol: 'searching', searchStartedAt: event.at, nowMs: Math.max(s.nowMs, event.at) };
    case 'CANTOL_FOUND':
      return { ...s, cantol: 'found', cantolAddress: event.address, cantolDeviceId: event.deviceId };
    case 'CANTOL_LINKED':
      return { ...s, cantol: 'linked', rttMs: event.rttMs, cantolLostAt: null, searchStartedAt: null };
    case 'LINK_LOST':
      if (s.cantol !== 'linked') return s;
      return { ...s, cantol: 'lost', cantolLostAt: event.at, nowMs: Math.max(s.nowMs, event.at) };
    case 'LINK_RESTORED':
      if (s.cantol !== 'lost') return s;
      return { ...s, cantol: 'linked', cantolLostAt: null };
    case 'GPS_PERMISSION':
      return { ...s, gpsChecked: true, gpsPermission: event.permission };
    case 'GPS_SERVICES':
      return { ...s, gpsServices: event.enabled ? 'on' : 'off' };
    case 'GPS_FIX':
      return { ...s, accuracyM: event.accuracyM, gpsLostAt: null };
    case 'GPS_LOST':
      if (s.accuracyM === null) return s;
      return { ...s, accuracyM: null, gpsLostAt: event.at, nowMs: Math.max(s.nowMs, event.at) };
    case 'STREAM_STARTED':
      return { ...s, streaming: true };
    case 'STREAM_STOPPED':
      return { ...s, streaming: false };
    case 'TICK': {
      const now = Math.max(s.nowMs, event.at);
      let next: WizardState = { ...s, nowMs: now };
      // A link, hotspot or fix lost for longer than the grace period is gone: it must be found again.
      if (next.cantol === 'lost' && !withinGrace(next.cantolLostAt, now)) {
        next = {
          ...next,
          cantol: 'unknown',
          cantolLostAt: null,
          cantolAddress: null,
          cantolDeviceId: null,
          rttMs: null,
          streaming: false,
        };
      }
      if (next.hotspotLostAt !== null && !withinGrace(next.hotspotLostAt, now)) {
        next = { ...next, hotspotLostAt: null };
      }
      if (next.gpsLostAt !== null && !withinGrace(next.gpsLostAt, now)) {
        next = { ...next, gpsLostAt: null };
      }
      return next;
    }
    case 'RESUME':
      return { ...s, checkRound: s.checkRound + 1 };
    case 'RESET':
      return { ...initialWizardState };
  }
}

/** The route that shows a step. Hotspot, Cantol and GPS screens have one each; READY and STREAMING share /device. */
export function routeForStep(step: WizardStep): string {
  switch (step) {
    case 'HOTSPOT_CHECK':
    case 'HOTSPOT_GUIDE':
      return '/setup/hotspot';
    case 'CANTOL_DISCOVER':
    case 'CANTOL_PING':
      return '/setup/cantol';
    case 'LOCATION':
      return '/setup/gps';
    case 'STREAMING':
    case 'READY':
      return '/device';
  }
}

/** 1, 2 or 3 for the setup progress strip, or null once the wizard is complete. */
export function setupStepNumber(step: WizardStep): 1 | 2 | 3 | null {
  switch (step) {
    case 'HOTSPOT_CHECK':
    case 'HOTSPOT_GUIDE':
      return 1;
    case 'CANTOL_DISCOVER':
    case 'CANTOL_PING':
      return 2;
    case 'LOCATION':
      return 3;
    default:
      return null;
  }
}
