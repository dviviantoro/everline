/**
 * Android back button (`mobile-ui-spec.md` section 2): ask before leaving /track, exit the app
 * on /device, otherwise go to the parent screen. A screen that wants to handle Back itself (the
 * tracking screen asks first) registers an interceptor.
 *
 * In a browser there is no hardware button, so the same handler also answers a `cantol-back`
 * window event; the browser checks use it, and it does nothing else.
 */
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { decideBack, parentRoute } from '../core/guards';

type Interceptor = () => boolean;

interface BackValue {
  /** Sets (or clears, with null) a function that runs first on Back and returns true when it handled it. */
  setInterceptor: (interceptor: Interceptor | null) => void;
  /** What a "back" link on screen should do right now: the same as the hardware button. */
  goBack: () => void;
}

const BackContext = createContext<BackValue | null>(null);

export function BackProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const interceptorRef = useRef<Interceptor | null>(null);
  const pathRef = useRef(location.pathname);

  useEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);

  const goBack = useCallback(() => {
    if (interceptorRef.current?.()) return;
    const path = pathRef.current;
    if (decideBack(path) === 'exit') {
      if (Capacitor.isNativePlatform()) void CapacitorApp.exitApp();
      return;
    }
    void navigate(parentRoute(path), { replace: true });
  }, [navigate]);

  useEffect(() => {
    const onWindowBack = () => {
      goBack();
    };
    window.addEventListener('cantol-back', onWindowBack);
    let handle: { remove: () => Promise<void> } | null = null;
    let removed = false;
    if (Capacitor.isNativePlatform()) {
      void CapacitorApp.addListener('backButton', () => {
        goBack();
      }).then((h) => {
        if (removed) void h.remove();
        else handle = h;
      });
    }
    return () => {
      removed = true;
      window.removeEventListener('cantol-back', onWindowBack);
      if (handle) void handle.remove();
    };
  }, [goBack]);

  const value = useMemo<BackValue>(
    () => ({
      setInterceptor: (interceptor) => {
        interceptorRef.current = interceptor;
      },
      goBack,
    }),
    [goBack],
  );
  return <BackContext.Provider value={value}>{children}</BackContext.Provider>;
}

export function useBack(): BackValue {
  const value = useContext(BackContext);
  if (!value) throw new Error('useBack must be used inside BackProvider');
  return value;
}

/** Registers `handler` as the Back interceptor while the screen is mounted. */
export function useBackInterceptor(handler: Interceptor): void {
  const { setInterceptor } = useBack();
  useEffect(() => {
    setInterceptor(handler);
    return () => {
      setInterceptor(null);
    };
  }, [setInterceptor, handler]);
}
