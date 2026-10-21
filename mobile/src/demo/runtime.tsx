/** Builds the demo's `Services` from the simulated sources. Nothing here talks to a network. */
import type { AppConfig, ExtraRoute, Services } from '../app/services';
import { PD_DEVICE } from '../app/services';
import type { Dsp } from '../core/dsp';
import type { AppStore } from '../core/store';
import { createControls, type ControlsStore } from './controls';
import { DemoControlsScreen } from './DemoControlsScreen';
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

export function createDemoRuntime(deps: { store: AppStore; dsp: Dsp; now?: () => number }): DemoRuntime {
  const now = deps.now ?? (() => Date.now());
  const controls = createControls();
  const lines = buildDemoLines();
  const world = new DemoWorld(lines, controls);
  const hotspot = new SimulatedHotspot();
  const cantol = new SimulatedCantol(world, controls);
  const gnss = new SimulatedGnss(world, controls, now);
  const api = new SimulatedApi(lines, controls);

  // The controls screen needs the runtime, so its route is added once the runtime exists.
  const extraRoutes: ExtraRoute[] = [];
  const config: AppConfig = {
    badge: DEMO_BADGE,
    signIn: {
      note: 'Demo build: any email and password will do. Nothing is sent anywhere.',
      skipAs: DEMO_OPERATOR,
    },
    recordSeconds: () => (controls.get().fastRecording ? 10 : 60),
    uploadedLabel: 'Uploaded (demo)',
    footerLinks: [{ label: 'Demo controls', to: '/demo' }],
    extraRoutes,
    pdDevice: PD_DEVICE,
    shellExtras: null,
  };

  const services: Services = { config, dsp: deps.dsp, hotspot, link: cantol, gnss, api, store: deps.store, now };
  const runtime: DemoRuntime = { services, world, controls, lines, hotspot, cantol };
  extraRoutes.push({ path: '/demo', element: <DemoControlsScreen runtime={runtime} /> });
  return runtime;
}
