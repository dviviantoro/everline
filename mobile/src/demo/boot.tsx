/**
 * Entry point of the demo build. `main.tsx` imports this only when `VITE_DEMO` is "1", so a
 * normal build never contains the simulated sources, the fixtures or this file.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AppRoot } from '../app/AppRoot';
import { createDexieStore } from '../core/dexieStore';
import { loadDsp } from '../core/dspLoader';
import '../styles/app.css';
import { createDemoRuntime } from './runtime';

export async function bootDemo(container: HTMLElement): Promise<void> {
  const dsp = await loadDsp().catch((error: unknown) => {
    // Without the WASM module the app cannot classify; show the cause instead of a blank screen.
    container.textContent = `The demo could not start: ${error instanceof Error ? error.message : String(error)}`;
    throw error;
  });
  const runtime = createDemoRuntime({ store: createDexieStore(), dsp });
  runtime.world.run();
  createRoot(container).render(
    <StrictMode>
      <AppRoot services={runtime.services} />
    </StrictMode>,
  );
}
