/**
 * Demo only: starts the simulated walker when the tracking screen opens and stops it when it
 * closes. It reads the same URL the tracking screen reads (`/track?asset=...&dir=AB`), so the
 * screen itself carries no demo code.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router';

import type { DemoWorld } from './world';

export function DemoRouteObserver({ world }: { world: DemoWorld }) {
  const { pathname, search } = useLocation();
  useEffect(() => {
    if (pathname !== '/track') return undefined;
    const params = new URLSearchParams(search);
    const asset = params.get('asset');
    if (asset) world.startWalk(asset, params.get('dir') === 'BA' ? 'BA' : 'AB');
    return () => {
      world.stopWalk();
    };
  }, [pathname, search, world]);
  return null;
}
