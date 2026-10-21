/**
 * Route guards and Android back-button rules (`mobile-ui-spec.md` section 2), as pure functions
 * so they can be tested without a router.
 *
 * Guards, in order: no operator then /login (which stays open once signed in); wizard not at READY then the first unmet /setup/*
 * step (earlier setup steps stay viewable); a lost link for more than 30 s is already folded into
 * the wizard step by the reducer. /tag works from a recording already in the store, so it needs
 * the operator but not a live wizard. /surveys needs only the operator.
 */
import { routeForStep, type WizardStep } from './wizard';

export interface GuardContext {
  operator: string | null;
  step: WizardStep;
}

/** Routes that need the whole wizard met (READY or STREAMING). */
const NEEDS_READY = ['/device', '/live', '/track/setup', '/track'];

function setupIndex(path: string): number | null {
  if (path === '/setup/hotspot') return 1;
  if (path === '/setup/cantol' || path.startsWith('/setup/cantol/')) return 2;
  if (path === '/setup/gps') return 3;
  return null;
}

function stepIndex(step: WizardStep): number {
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
      return 4;
  }
}

/** Where to send the operator instead of `path`, or null when `path` is allowed. */
export function guardRedirect(path: string, ctx: GuardContext): string | null {
  const normalised = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (normalised === '/selftest') return null;

  if (ctx.operator === null) return normalised === '/login' ? null : '/login';

  // /login stays open when signed in: signing in sets the operator before the Login screen has
  // moved on to /welcome, so redirecting here would skip the welcome animation. It is also how an
  // operator is switched.
  if (normalised === '/login') return null;
  if (normalised === '/') return routeForStep(ctx.step);

  const setup = setupIndex(normalised);
  if (setup !== null) return setup <= stepIndex(ctx.step) ? null : routeForStep(ctx.step);

  if (NEEDS_READY.includes(normalised)) {
    return ctx.step === 'READY' || ctx.step === 'STREAMING' ? null : routeForStep(ctx.step);
  }
  return null;
}

/**
 * Where "back" leads from a screen: its parent in the flow. Using the parent instead of the
 * browser history keeps Back predictable, because the wizard replaces history entries as it
 * advances and the tabs (Device, Live, Surveys) would otherwise pile up.
 */
export function parentRoute(path: string): string {
  switch (path) {
    case '/setup/cantol':
      return '/setup/hotspot';
    case '/setup/cantol/address':
    case '/setup/cantol/diagnostics':
      return '/setup/cantol';
    case '/setup/gps':
      return '/setup/cantol';
    case '/track/setup':
    case '/tag':
      return '/live';
    case '/track':
      return '/track/setup';
    case '/live':
    case '/surveys':
    case '/demo':
    case '/selftest':
      return '/device';
    default:
      return '/';
  }
}

export type BackAction = 'exit' | 'confirm' | 'back';

/**
 * What the Android back button does: ask before leaving /track, exit the app on /device (and on
 * the first screens, where there is nothing behind), otherwise go back one step.
 */
export function decideBack(path: string): BackAction {
  if (path === '/track') return 'confirm';
  if (path === '/device' || path === '/login' || path === '/welcome' || path === '/setup/hotspot') return 'exit';
  return 'back';
}
