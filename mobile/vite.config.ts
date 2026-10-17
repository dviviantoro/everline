import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // PROPOSED WebView floor (decided in Phase 0 from real phones): Tailwind 4 targets Chrome 111+,
    // and the WASM module from current rustc needs roughly Chrome 96+.
    target: 'chrome111',
  },
  worker: { format: 'es' },
  server: {
    // The golden vectors live outside the app root, in rust/vectors.
    fs: { allow: ['.', 'rust/vectors'] },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
