/**
 * Entry point of the field build. `main.tsx` imports this only when `VITE_FIELD` is "1", so the
 * normal and demo bundles never contain the real adapters or the device profile (band and ports).
 */
import { Geolocation } from '@capacitor/geolocation';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AppRoot } from '../app/AppRoot';
import { createDexieStore } from '../core/dexieStore';
import { loadWasm } from '../core/dspLoader';
import { registerNativePlugins } from '../native/plugins';
import '../styles/app.css';
import { loadDeviceProfile } from './deviceProfile';
import { createFieldServices } from './runtime';

export async function bootField(container: HTMLElement): Promise<void> {
  try {
    const { dsp, codec } = await loadWasm();
    const services = createFieldServices({
      dsp,
      codec,
      store: createDexieStore(),
      profile: loadDeviceProfile(),
      plugins: registerNativePlugins(),
      geolocation: Geolocation,
    });
    createRoot(container).render(
      <StrictMode>
        <AppRoot services={services} />
      </StrictMode>,
    );
  } catch (error) {
    // Without the WASM module or a valid device profile the app cannot work; say why, not a blank screen.
    container.textContent = `The app could not start: ${error instanceof Error ? error.message : String(error)}`;
    throw error;
  }
}
