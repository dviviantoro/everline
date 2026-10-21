/**
 * Runs the connection wizard: feeds the pure reducer (`core/wizard.ts`) with what the services
 * report, and exposes the actions the setup screens need. Every check is re-run on app resume,
 * so the wizard always lands on the first unmet step.
 */
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router';

import type { GpsFix } from '../core/types';
import {
  hotspotMet,
  helpCardVisible,
  initialWizardState,
  MIN_GPS_ACCURACY_M,
  needsClock,
  wizardInitialised,
  wizardReducer,
  wizardStep,
  type WizardState,
  type WizardStep,
} from '../core/wizard';
import { useServices } from './services';
import { useSession } from './session';

const HOTSPOT_POLL_MS = 1500;
const GPS_POLL_MS = 2000;
const NO_FIX_AFTER_MS = 5000;
const RETRY_DISCOVERY_MS = 2000;
const VERIFY_TIMEOUT_MS = 5000;
const RESTORE_POLL_MS = 3000;
/** Routes that need the Cantol stream running; leaving them stops it. */
const STREAMING_ROUTES = ['/live', '/track', '/track/setup'];

// ---------------------------------------------------------------------------------------------
// The latest GPS fix, outside React state so a new fix every second does not re-render the app.

interface FixStore {
  get: () => GpsFix | null;
  set: (fix: GpsFix | null) => void;
  subscribe: (listener: () => void) => () => void;
}

function createFixStore(): FixStore {
  let fix: GpsFix | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => fix,
    set: (next) => {
      fix = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------

interface WizardValue {
  state: WizardState;
  step: WizardStep;
  initialised: boolean;
  helpCard: boolean;
  /** Why the last manual connection attempt failed, in words an operator can act on. */
  discoveryError: string | null;
  manualAddress: string | null;
  openHotspotSettings: () => void;
  continueAnyway: () => void;
  /** Look for Cantol at this address instead of discovering it. */
  enterAddress: (address: string) => void;
  /** Go back to automatic discovery and search again. */
  retryDiscovery: () => void;
  enableGps: () => Promise<void>;
  openAppSettings: () => void;
  startMeasurement: () => Promise<void>;
  stopMeasurement: () => Promise<void>;
  /** Forget everything and start the wizard over (sign-out, demo reset). */
  reset: () => void;
  fixStore: FixStore;
}

const WizardContext = createContext<WizardValue | null>(null);

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export function WizardProvider({ children }: { children: ReactNode }) {
  const { hotspot, link, gnss, now } = useServices();
  const { operator } = useSession();
  const location = useLocation();
  const enabled = operator !== null;

  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);
  const [manualAddress, setManualAddress] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [fixStore] = useState(createFixStore);

  const hotspotOk = hotspotMet(state);
  const gpsActive = state.gpsPermission === 'granted' && state.gpsServices === 'on';
  const cantolWanted = state.cantol === 'unknown' || state.cantol === 'searching' || state.cantol === 'found';
  const clockNeeded = needsClock(state);
  const { checkRound } = state;

  // Clock ticks, only while a search or a grace period is running.
  useEffect(() => {
    if (!enabled || !clockNeeded) return undefined;
    const id = window.setInterval(() => {
      dispatch({ type: 'TICK', at: now() });
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [enabled, clockNeeded, now]);

  // Hotspot: asked now, on every resume, and every 1.5 s.
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const check = () => {
      void hotspot
        .isOn()
        .then((on) => {
          if (alive) dispatch({ type: 'HOTSPOT_STATUS', on, at: now() });
        })
        .catch(() => undefined);
    };
    check();
    const id = window.setInterval(check, HOTSPOT_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [enabled, hotspot, now, checkRound]);

  // Location permission and services: asked now, on every resume, and every 2 s.
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const check = () => {
      void Promise.all([gnss.permission(), gnss.servicesEnabled()])
        .then(([permission, services]) => {
          if (!alive) return;
          dispatch({ type: 'GPS_PERMISSION', permission });
          dispatch({ type: 'GPS_SERVICES', enabled: services });
        })
        .catch(() => undefined);
    };
    check();
    const id = window.setInterval(check, GPS_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [enabled, gnss, checkRound]);

  // Fixes, while permission is granted and location is on.
  useEffect(() => {
    if (!enabled || !gpsActive) return undefined;
    let lastKey = Number.NaN;
    let lastMeets: boolean | null = null;
    let lostTimer: number | undefined;
    const armLostTimer = () => {
      window.clearTimeout(lostTimer);
      lostTimer = window.setTimeout(() => {
        dispatch({ type: 'GPS_LOST', at: now() });
      }, NO_FIX_AFTER_MS);
    };
    armLostTimer();
    const stop = gnss.watch((fix) => {
      fixStore.set(fix);
      armLostTimer();
      // Dispatch only when the whole-metre accuracy or the 25 m verdict changes, not on every jitter.
      const key = Math.round(fix.accuracyM);
      const meets = fix.accuracyM <= MIN_GPS_ACCURACY_M;
      if (key !== lastKey || meets !== lastMeets) {
        lastKey = key;
        lastMeets = meets;
        dispatch({ type: 'GPS_FIX', accuracyM: fix.accuracyM });
      }
    });
    return () => {
      stop();
      window.clearTimeout(lostTimer);
    };
  }, [enabled, gpsActive, gnss, fixStore, now]);

  // Finding Cantol: discover, then ping (HELLO/PONG), then connect. Retries until it works or the step is left.
  useEffect(() => {
    if (!enabled || !hotspotOk || !cantolWanted) return undefined;
    const controller = new AbortController();
    const { signal } = controller;
    // Read through a function: TypeScript would otherwise assume `aborted` cannot change across an await.
    const aborted = () => signal.aborted;
    void (async () => {
      dispatch({ type: 'CANTOL_SEARCH_STARTED', at: now() });
      while (!aborted()) {
        try {
          const candidate = await link.discover(
            manualAddress === null ? { signal } : { manualAddress, signal },
          );
          dispatch({ type: 'CANTOL_FOUND', address: candidate.address, deviceId: candidate.deviceId });
          const ping = await link.ping(candidate, signal);
          await link.connect(candidate);
          if (aborted()) return;
          setDiscoveryError(null);
          dispatch({ type: 'CANTOL_LINKED', rttMs: ping.rttMs });
          return;
        } catch (error) {
          if (aborted() || isAbort(error)) return;
          setDiscoveryError(message(error));
          await sleep(RETRY_DISCOVERY_MS, signal);
        }
      }
    })();
    return () => {
      controller.abort();
    };
  }, [enabled, hotspotOk, cantolWanted, link, manualAddress, retryNonce, now]);

  // Link state from the plugin. While lost, keep trying to ping so a quick recovery is silent.
  useEffect(() => {
    if (!enabled) return undefined;
    return link.subscribe({
      onEvents: () => undefined,
      onStatus: () => undefined,
      onLinkState: (linkState) => {
        if (linkState === 'lost') dispatch({ type: 'LINK_LOST', at: now() });
        else if (linkState === 'up') dispatch({ type: 'LINK_RESTORED' });
      },
    });
  }, [enabled, link, now]);

  // On resume, confirm a linked Cantol still answers; if it does not, treat the link as lost.
  const linked = state.cantol === 'linked';
  const address = state.cantolAddress;
  useEffect(() => {
    if (!enabled || !linked || checkRound === 0 || address === null) return undefined;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
    }, VERIFY_TIMEOUT_MS);
    void link
      .ping({ address, deviceId: '' }, controller.signal)
      .then(() => undefined)
      .catch(() => {
        dispatch({ type: 'LINK_LOST', at: now() });
      })
      .finally(() => {
        window.clearTimeout(timeout);
      });
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
    // Only a new resume round should re-verify; `linked` and `address` are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkRound]);

  const lost = state.cantol === 'lost';
  useEffect(() => {
    if (!enabled || !lost || address === null) return undefined;
    let alive = true;
    const id = window.setInterval(() => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => {
        controller.abort();
      }, RESTORE_POLL_MS - 500);
      void link
        .ping({ address, deviceId: '' }, controller.signal)
        .then(() => {
          if (alive) dispatch({ type: 'LINK_RESTORED' });
        })
        .catch(() => undefined)
        .finally(() => {
          window.clearTimeout(timeout);
        });
    }, RESTORE_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [enabled, lost, address, link]);

  // App resume: re-run every check.
  useEffect(() => {
    if (!enabled) return undefined;
    const resume = () => {
      dispatch({ type: 'RESUME' });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') resume();
    };
    document.addEventListener('visibilitychange', onVisible);
    let handle: { remove: () => Promise<void> } | null = null;
    let removed = false;
    if (Capacitor.isNativePlatform()) {
      void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) resume();
      }).then((h) => {
        if (removed) void h.remove();
        else handle = h;
      });
    }
    return () => {
      removed = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (handle) void handle.remove();
    };
  }, [enabled]);

  const startMeasurement = useCallback(async () => {
    await link.startStream();
    dispatch({ type: 'STREAM_STARTED' });
  }, [link]);

  const stopMeasurement = useCallback(async () => {
    await link.stopStream();
    dispatch({ type: 'STREAM_STOPPED' });
  }, [link]);

  // Leaving the measurement screens stops the stream; the screens that need it start it.
  const streaming = state.streaming;
  const onStreamingRoute = STREAMING_ROUTES.includes(location.pathname);
  useEffect(() => {
    if (streaming && !onStreamingRoute) void stopMeasurement();
  }, [streaming, onStreamingRoute, stopMeasurement]);

  const value = useMemo<WizardValue>(
    () => ({
      state,
      step: wizardStep(state),
      initialised: wizardInitialised(state),
      helpCard: helpCardVisible(state),
      discoveryError,
      manualAddress,
      openHotspotSettings: () => {
        void hotspot.openSettings();
      },
      continueAnyway: () => {
        dispatch({ type: 'HOTSPOT_CONTINUE_ANYWAY' });
      },
      enterAddress: (next) => {
        setDiscoveryError(null);
        setManualAddress(next.trim());
        setRetryNonce((n) => n + 1);
      },
      retryDiscovery: () => {
        setDiscoveryError(null);
        setManualAddress(null);
        setRetryNonce((n) => n + 1);
      },
      enableGps: async () => {
        const permission = await gnss.requestPermission();
        dispatch({ type: 'GPS_PERMISSION', permission });
        if (permission === 'granted') {
          const on = await gnss.ensureServicesOn();
          dispatch({ type: 'GPS_SERVICES', enabled: on });
        }
      },
      openAppSettings: () => {
        void gnss.openAppSettings();
      },
      startMeasurement,
      stopMeasurement,
      reset: () => {
        void link.disconnect();
        fixStore.set(null);
        setManualAddress(null);
        setDiscoveryError(null);
        dispatch({ type: 'RESET' });
      },
      fixStore,
    }),
    [state, discoveryError, manualAddress, hotspot, gnss, link, startMeasurement, stopMeasurement, fixStore],
  );

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function useWizard(): WizardValue {
  const value = useContext(WizardContext);
  if (!value) throw new Error('useWizard must be used inside WizardProvider');
  return value;
}

/** The latest GPS fix (or null). Updates about once a second without re-rendering the wizard. */
export function useGpsFix(): GpsFix | null {
  const { fixStore } = useWizard();
  return useSyncExternalStore(fixStore.subscribe, fixStore.get, fixStore.get);
}
