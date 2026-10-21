import { useEffect, useState } from 'react';

import type { LineAssetWithPoles } from '../core/types';
import { useServices } from './services';

export type Loaded<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; value: T };

/** Loads the line assets (`GET /api/assets?type=line`), with loading and error states and a reload. */
export function useLineAssets(): { assets: Loaded<LineAssetWithPoles[]>; reload: () => void } {
  const { api } = useServices();
  const [assets, setAssets] = useState<Loaded<LineAssetWithPoles[]>>({ status: 'loading' });
  const [round, setRound] = useState(0);

  useEffect(() => {
    let alive = true;
    void api
      .listLineAssets()
      .then((value) => {
        if (alive) setAssets({ status: 'ready', value });
      })
      .catch(() => {
        if (alive) setAssets({ status: 'error', message: 'The list of lines could not be loaded.' });
      });
    return () => {
      alive = false;
    };
  }, [api, round]);

  return {
    assets,
    reload: () => {
      setAssets({ status: 'loading' });
      setRound((n) => n + 1);
    },
  };
}
