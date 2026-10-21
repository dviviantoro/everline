/** The knobs on the demo controls screen, as a tiny observable store (no persistence: each launch starts at the defaults). */
import { useSyncExternalStore } from 'react';

import { DEFAULT_SPOT_CODE } from './fixtures';

export type PeakStation = 'P1' | 'P2' | 'P3' | 'none';
export type DemoGpsPermission = 'granted' | 'denied' | 'denied_permanently';

export interface DemoControlsState {
  /** Where the simulated strongest reading sits on a span. */
  peakStation: PeakStation;
  /** Drop the Cantol link (and refuse to find it again) until switched off. */
  linkLost: boolean;
  /** Cantol never answers discovery, so the 60 s help card appears. */
  cantolNotFound: boolean;
  /** Record 10 s instead of 60 s. */
  fastRecording: boolean;
  /** The next upload comes back as a failure. */
  failNextUpload: boolean;
  gpsPermission: DemoGpsPermission;
  gpsServices: 'on' | 'off';
  /** The mains reference is not locked, so phase means nothing (the plot is hidden). */
  mainsUnlocked: boolean;
  /** Code of the line the simulated phone stands next to. */
  spotAssetCode: string;
}

export const DEFAULT_CONTROLS: DemoControlsState = {
  peakStation: 'P2',
  linkLost: false,
  cantolNotFound: false,
  fastRecording: true,
  failNextUpload: false,
  gpsPermission: 'granted',
  gpsServices: 'on',
  mainsUnlocked: false,
  spotAssetCode: DEFAULT_SPOT_CODE,
};

export interface ControlsStore {
  get: () => DemoControlsState;
  set: (patch: Partial<DemoControlsState>) => void;
  reset: () => void;
  subscribe: (listener: () => void) => () => void;
}

export function createControls(initial: DemoControlsState = DEFAULT_CONTROLS): ControlsStore {
  let state = { ...initial };
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    get: () => state,
    set: (patch) => {
      state = { ...state, ...patch };
      emit();
    },
    reset: () => {
      state = { ...initial };
      emit();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useControls(store: ControlsStore): DemoControlsState {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
