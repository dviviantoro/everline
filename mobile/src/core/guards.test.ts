import { describe, expect, it } from 'vitest';

import { decideBack, guardRedirect, parentRoute } from './guards';
import type { WizardStep } from './wizard';

const signedIn = (step: WizardStep) => ({ operator: 'field@example.com', step });
const signedOut = { operator: null, step: 'HOTSPOT_CHECK' as WizardStep };

describe('guard 1: no operator means /login', () => {
  it('sends every app route to /login, but leaves /login and /selftest alone', () => {
    for (const path of ['/', '/welcome', '/setup/hotspot', '/device', '/live', '/surveys', '/tag', '/track', '/demo']) {
      expect(guardRedirect(path, signedOut)).toBe('/login');
    }
    expect(guardRedirect('/login', signedOut)).toBeNull();
    expect(guardRedirect('/selftest', signedOut)).toBeNull();
  });

  it('keeps the self-test open for a signed-in operator too', () => {
    expect(guardRedirect('/selftest', signedIn('READY'))).toBeNull();
  });

  it('starts at the first unmet step when signed in, and leaves /login open', () => {
    expect(guardRedirect('/', signedIn('CANTOL_DISCOVER'))).toBe('/setup/cantol');
    expect(guardRedirect('/', signedIn('LOCATION'))).toBe('/setup/gps');
    expect(guardRedirect('/', signedIn('READY'))).toBe('/device');
    // Signing in sets the operator before the Login screen moves on to /welcome; redirecting
    // /login here would skip the welcome animation.
    expect(guardRedirect('/login', signedIn('HOTSPOT_CHECK'))).toBeNull();
  });
});

describe('guard 2: the wizard must be at READY', () => {
  it('keeps /device, /live, /track and /track/setup closed until READY', () => {
    for (const path of ['/device', '/live', '/track', '/track/setup']) {
      expect(guardRedirect(path, signedIn('HOTSPOT_GUIDE'))).toBe('/setup/hotspot');
      expect(guardRedirect(path, signedIn('CANTOL_PING'))).toBe('/setup/cantol');
      expect(guardRedirect(path, signedIn('LOCATION'))).toBe('/setup/gps');
      expect(guardRedirect(path, signedIn('READY'))).toBeNull();
      expect(guardRedirect(path, signedIn('STREAMING'))).toBeNull();
    }
  });

  it('does not let a later setup step be opened before the earlier ones are met', () => {
    expect(guardRedirect('/setup/cantol', signedIn('HOTSPOT_CHECK'))).toBe('/setup/hotspot');
    expect(guardRedirect('/setup/gps', signedIn('CANTOL_DISCOVER'))).toBe('/setup/cantol');
    expect(guardRedirect('/setup/gps', signedIn('HOTSPOT_GUIDE'))).toBe('/setup/hotspot');
  });

  it('lets an earlier or current setup step be viewed (the Back button on the Cantol screen)', () => {
    expect(guardRedirect('/setup/hotspot', signedIn('CANTOL_DISCOVER'))).toBeNull();
    expect(guardRedirect('/setup/cantol', signedIn('LOCATION'))).toBeNull();
    expect(guardRedirect('/setup/hotspot', signedIn('READY'))).toBeNull();
    expect(guardRedirect('/setup/cantol/address', signedIn('CANTOL_DISCOVER'))).toBeNull();
    expect(guardRedirect('/setup/cantol/diagnostics', signedIn('HOTSPOT_GUIDE'))).toBe('/setup/hotspot');
  });

  it('does not make /surveys, /tag or the demo screen wait for the wizard', () => {
    for (const path of ['/surveys', '/tag', '/demo']) {
      expect(guardRedirect(path, signedIn('HOTSPOT_CHECK'))).toBeNull();
    }
  });

  it('ignores a trailing slash', () => {
    expect(guardRedirect('/device/', signedIn('LOCATION'))).toBe('/setup/gps');
  });
});

describe('Android back button', () => {
  it('asks before leaving a tracking walk', () => {
    expect(decideBack('/track')).toBe('confirm');
  });

  it('exits the app on /device and on the screens with nothing behind them', () => {
    for (const path of ['/device', '/login', '/welcome', '/setup/hotspot']) expect(decideBack(path)).toBe('exit');
  });

  it('goes back one step everywhere else', () => {
    for (const path of ['/setup/cantol', '/setup/gps', '/live', '/track/setup', '/tag', '/surveys', '/demo']) {
      expect(decideBack(path)).toBe('back');
    }
  });
});

describe('where back leads', () => {
  it('goes to the parent screen in the flow, not through browser history', () => {
    expect(parentRoute('/setup/cantol')).toBe('/setup/hotspot');
    expect(parentRoute('/setup/gps')).toBe('/setup/cantol');
    expect(parentRoute('/setup/cantol/address')).toBe('/setup/cantol');
    expect(parentRoute('/setup/cantol/diagnostics')).toBe('/setup/cantol');
    expect(parentRoute('/live')).toBe('/device');
    expect(parentRoute('/surveys')).toBe('/device');
    expect(parentRoute('/track/setup')).toBe('/live');
    expect(parentRoute('/track')).toBe('/track/setup');
    expect(parentRoute('/tag')).toBe('/live');
    expect(parentRoute('/demo')).toBe('/device');
  });
});
