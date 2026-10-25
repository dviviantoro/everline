/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" in the demo build (`npm run build:demo`); unset in a normal build. */
  readonly VITE_DEMO?: string;
  /** "1" in the field build (`npm run build:field`): real hotspot, Cantol link and GPS. */
  readonly VITE_FIELD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
