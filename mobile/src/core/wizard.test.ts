import { describe, expect, it } from 'vitest';

import {
  CANTOL_HELP_AFTER_MS,
  helpCardVisible,
  initialWizardState,
  LINK_GRACE_MS,
  MIN_GPS_ACCURACY_M,
  needsClock,
  routeForStep,
  setupStepNumber,
  wizardInitialised,
  wizardReducer,
  wizardStep,
  type WizardEvent,
  type WizardState,
  type WizardStep,
} from './wizard';

function run(events: WizardEvent[], from: WizardState = initialWizardState): WizardState {
  return events.reduce(wizardReducer, from);
}

const T0 = 1_000_000;

const hotspotOn: WizardEvent = { type: 'HOTSPOT_STATUS', on: true, at: T0 };
const cantolLinked: WizardEvent[] = [
  { type: 'CANTOL_SEARCH_STARTED', at: T0 },
  { type: 'CANTOL_FOUND', address: '192.0.2.10' },
  { type: 'CANTOL_LINKED', rttMs: 4 },
];
const gpsGood: WizardEvent[] = [
  { type: 'GPS_PERMISSION', permission: 'granted' },
  { type: 'GPS_SERVICES', enabled: true },
  { type: 'GPS_FIX', accuracyM: 4 },
];
const ready = (): WizardState => run([hotspotOn, ...cantolLinked, ...gpsGood]);

describe('wizard steps follow the first unmet requirement', () => {
  it('starts unknown and not initialised', () => {
    expect(wizardStep(initialWizardState)).toBe('HOTSPOT_CHECK');
    expect(wizardInitialised(initialWizardState)).toBe(false);
  });

  it('walks hotspot, Cantol, GPS, ready in the order ADR-006 sets', () => {
    const seen: WizardStep[] = [];
    let s = initialWizardState;
    const feed = (e: WizardEvent) => {
      s = wizardReducer(s, e);
      seen.push(wizardStep(s));
    };
    feed({ type: 'HOTSPOT_STATUS', on: false, at: T0 });
    feed(hotspotOn);
    feed({ type: 'CANTOL_SEARCH_STARTED', at: T0 });
    feed({ type: 'CANTOL_FOUND', address: '192.0.2.10' });
    feed({ type: 'CANTOL_LINKED', rttMs: 4 });
    feed({ type: 'GPS_PERMISSION', permission: 'granted' });
    feed({ type: 'GPS_SERVICES', enabled: true });
    feed({ type: 'GPS_FIX', accuracyM: 4 });
    feed({ type: 'STREAM_STARTED' });
    feed({ type: 'STREAM_STOPPED' });
    expect(seen).toEqual([
      'HOTSPOT_GUIDE',
      'CANTOL_DISCOVER',
      'CANTOL_DISCOVER',
      'CANTOL_PING',
      'LOCATION',
      'LOCATION',
      'LOCATION',
      'READY',
      'STREAMING',
      'READY',
    ]);
  });

  it('is initialised once hotspot and GPS have answered, whatever the answers are', () => {
    const s = run([
      { type: 'HOTSPOT_STATUS', on: false, at: T0 },
      { type: 'GPS_PERMISSION', permission: 'unknown' },
      { type: 'GPS_SERVICES', enabled: false },
    ]);
    expect(wizardInitialised(s)).toBe(true);
    expect(wizardStep(s)).toBe('HOTSPOT_GUIDE');
  });

  it('puts the GPS step after Cantol, so a missing link wins over a missing fix', () => {
    const s = run([hotspotOn]);
    expect(wizardStep(s)).toBe('CANTOL_DISCOVER');
  });

  it('lets the operator go on without a detected hotspot ("Continue anyway")', () => {
    const s = run([{ type: 'HOTSPOT_STATUS', on: false, at: T0 }, { type: 'HOTSPOT_CONTINUE_ANYWAY' }]);
    expect(wizardStep(s)).toBe('CANTOL_DISCOVER');
  });
});

describe('GPS accuracy', () => {
  it('needs a fix of 25 m or better (an assumption), exactly 25 passing', () => {
    expect(MIN_GPS_ACCURACY_M).toBe(25);
    const base = run([hotspotOn, ...cantolLinked, ...gpsGood.slice(0, 2)]);
    expect(wizardStep(wizardReducer(base, { type: 'GPS_FIX', accuracyM: 25 }))).toBe('READY');
    expect(wizardStep(wizardReducer(base, { type: 'GPS_FIX', accuracyM: 25.01 }))).toBe('LOCATION');
    expect(wizardStep(base)).toBe('LOCATION');
  });

  it('goes back to LOCATION at once when permission is taken away or services go off', () => {
    expect(wizardStep(wizardReducer(ready(), { type: 'GPS_PERMISSION', permission: 'denied' }))).toBe('LOCATION');
    expect(wizardStep(wizardReducer(ready(), { type: 'GPS_SERVICES', enabled: false }))).toBe('LOCATION');
  });
});

describe('idempotent checks and resume', () => {
  it('reporting a fact twice changes nothing the second time', () => {
    const events: WizardEvent[] = [
      hotspotOn,
      { type: 'GPS_PERMISSION', permission: 'granted' },
      { type: 'GPS_SERVICES', enabled: true },
      { type: 'GPS_FIX', accuracyM: 4 },
      { type: 'CANTOL_LINKED', rttMs: 4 },
    ];
    for (const e of events) {
      const once = run([e]);
      expect(run([e, e])).toEqual(once);
    }
  });

  it('does not restart a search that is already running or linked', () => {
    const searching = run([{ type: 'CANTOL_SEARCH_STARTED', at: T0 }]);
    expect(wizardReducer(searching, { type: 'CANTOL_SEARCH_STARTED', at: T0 + 5000 })).toBe(searching);
    expect(wizardReducer(ready(), { type: 'CANTOL_SEARCH_STARTED', at: T0 + 5000 })).toEqual(ready());
  });

  it('RESUME only asks the drivers to re-check; the step does not move', () => {
    const before = ready();
    const after = wizardReducer(before, { type: 'RESUME' });
    expect(wizardStep(after)).toBe(wizardStep(before));
    expect(after.checkRound).toBe(before.checkRound + 1);
    expect({ ...after, checkRound: 0 }).toEqual({ ...before, checkRound: 0 });
  });

  it('re-checking after a resume can move the wizard back to the first unmet step', () => {
    const resumed = wizardReducer(ready(), { type: 'RESUME' });
    const recheck = wizardReducer(resumed, { type: 'HOTSPOT_STATUS', on: false, at: T0 + 100 });
    // The hotspot was on, so it recovers silently for the grace period.
    expect(wizardStep(recheck)).toBe('READY');
    const later = wizardReducer(recheck, { type: 'TICK', at: T0 + 100 + LINK_GRACE_MS + 1 });
    expect(wizardStep(later)).toBe('HOTSPOT_GUIDE');
  });

  it('RESET returns to the start', () => {
    expect(run([{ type: 'RESET' }], ready())).toEqual(initialWizardState);
  });
});

describe('a lost link recovers silently for 30 s', () => {
  it('stays ready through exactly 30 s, then needs Cantol found again', () => {
    expect(LINK_GRACE_MS).toBe(30_000);
    const lost = wizardReducer(ready(), { type: 'LINK_LOST', at: T0 + 10_000 });
    expect(wizardStep(lost)).toBe('READY');
    expect(wizardStep(wizardReducer(lost, { type: 'TICK', at: T0 + 10_000 + 30_000 }))).toBe('READY');
    const gone = wizardReducer(lost, { type: 'TICK', at: T0 + 10_000 + 30_001 });
    expect(wizardStep(gone)).toBe('CANTOL_DISCOVER');
    expect(gone.streaming).toBe(false);
    expect(gone.cantolAddress).toBeNull();
  });

  it('comes back without leaving the screen if the link returns in time', () => {
    const lost = wizardReducer(ready(), { type: 'LINK_LOST', at: T0 + 10_000 });
    const back = wizardReducer(lost, { type: 'LINK_RESTORED' });
    expect(back.cantol).toBe('linked');
    expect(wizardStep(wizardReducer(back, { type: 'TICK', at: T0 + 200_000 }))).toBe('READY');
  });

  it('keeps the first loss time if the link drops again', () => {
    const lost = wizardReducer(ready(), { type: 'LINK_LOST', at: T0 + 10_000 });
    expect(wizardReducer(lost, { type: 'LINK_LOST', at: T0 + 20_000 }).cantolLostAt).toBe(T0 + 10_000);
  });

  it('gives a lost GPS fix the same grace', () => {
    const lost = wizardReducer(ready(), { type: 'GPS_LOST', at: T0 + 1000 });
    expect(wizardStep(lost)).toBe('READY');
    expect(wizardStep(wizardReducer(lost, { type: 'TICK', at: T0 + 1000 + 30_001 }))).toBe('LOCATION');
    expect(wizardStep(wizardReducer(lost, { type: 'GPS_FIX', accuracyM: 6 }))).toBe('READY');
  });

  it('ticks only while something needs the clock', () => {
    expect(needsClock(ready())).toBe(false);
    expect(needsClock(wizardReducer(ready(), { type: 'LINK_LOST', at: T0 }))).toBe(true);
    expect(needsClock(run([{ type: 'CANTOL_SEARCH_STARTED', at: T0 }]))).toBe(true);
  });
});

describe('the 60 s help card', () => {
  it('appears after 60 s of searching and goes away when a candidate is found', () => {
    expect(CANTOL_HELP_AFTER_MS).toBe(60_000);
    const searching = run([hotspotOn, { type: 'CANTOL_SEARCH_STARTED', at: T0 }]);
    expect(helpCardVisible(wizardReducer(searching, { type: 'TICK', at: T0 + 59_999 }))).toBe(false);
    const waited = wizardReducer(searching, { type: 'TICK', at: T0 + 60_000 });
    expect(helpCardVisible(waited)).toBe(true);
    expect(helpCardVisible(wizardReducer(waited, { type: 'CANTOL_FOUND', address: '192.0.2.10' }))).toBe(false);
  });
});

describe('routes and the progress strip', () => {
  it('maps every step to one route', () => {
    expect(routeForStep('HOTSPOT_CHECK')).toBe('/setup/hotspot');
    expect(routeForStep('HOTSPOT_GUIDE')).toBe('/setup/hotspot');
    expect(routeForStep('CANTOL_DISCOVER')).toBe('/setup/cantol');
    expect(routeForStep('CANTOL_PING')).toBe('/setup/cantol');
    expect(routeForStep('LOCATION')).toBe('/setup/gps');
    expect(routeForStep('READY')).toBe('/device');
    expect(routeForStep('STREAMING')).toBe('/device');
  });

  it('numbers the three setup steps and none after them', () => {
    expect(setupStepNumber('HOTSPOT_GUIDE')).toBe(1);
    expect(setupStepNumber('CANTOL_PING')).toBe(2);
    expect(setupStepNumber('LOCATION')).toBe(3);
    expect(setupStepNumber('READY')).toBeNull();
  });
});
