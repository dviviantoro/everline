/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" in the demo build (`npm run build:demo`); unset in a normal build. */
  readonly VITE_DEMO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
