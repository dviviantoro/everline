/** Builds the demo's `Services` from the simulated sources. Nothing here talks to a network. */
import type { AppConfig, Services } from '../app/services';
import { PD_DEVICE } from '../app/services';
import type { Dsp } from '../core/dsp';
import type { AppStore } from '../core/store';
import { createControls, type ControlsStore } from './controls';
import { buildDemoLines, type DemoLine } from './fixtures';
import { SimulatedApi } from './simulatedApi';
import { SimulatedCantol } from './simulatedCantol';
import { SimulatedGnss } from './simulatedGnss';
import { SimulatedHotspot } from './simulatedHotspot';
import { DemoWorld } from './world';

export interface DemoRuntime {
  services: Services;
  world: DemoWorld;
  controls: ControlsStore;
  lines: readonly DemoLine[];
  hotspot: SimulatedHotspot;
  cantol: SimulatedCantol;
}

export const DEMO_BADGE = 'Demo data';
export const DEMO_OPERATOR = 'demo@example.invalid';

export function createDemoRuntime(deps: {
  store: AppStore;
  dsp: Dsp;
  now?: () => number;
  /** Extra pieces of the demo UI, supplied by `boot.tsx` so this file stays free of JSX. */
  extras?: Pick<AppConfig, 'footerLinks' | 'extraRoutes' | 'shellExtras'>;
}): DemoRuntime {
  const now = deps.now ?? (() => Date.now());
  const controls = createControls();
  const lines = buildDemoLines();
  const world = new DemoWorld(lines, controls);
  const hotspot = new SimulatedHotspot();
  const cantol = new SimulatedCantol(world, controls);
  const gnss = new SimulatedGnss(world, controls, now);
  const api = new SimulatedApi(lines, controls);

  const config: AppConfig = {
    badge: DEMO_BADGE,
    signIn: {
      note: 'Demo build: any email and password will do. Nothing is sent anywhere.',
      skipAs: DEMO_OPERATOR,
    },
    recordSeconds: () => (controls.get().fastRecording ? 10 : 60),
    footerLinks: deps.extras?.footerLinks ?? [],
    extraRoutes: deps.extras?.extraRoutes ?? [],
    pdDevice: PD_DEVICE,
    shellExtras: deps.extras?.shellExtras ?? null,
  };

  const services: Services = {
    config,
    dsp: deps.dsp,
    hotspot,
    link: cantol,
    gnss,
    api,
    store: deps.store,
    now,
  };
  return { services, world, controls, lines, hotspot, cantol };
}
