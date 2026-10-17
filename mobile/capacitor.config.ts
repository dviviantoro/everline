import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Placeholder identity. An application id is permanent once published: confirm it before any
  // Play Store upload.
  appId: 'id.cantol.mobile',
  appName: 'Cantol Mobile',
  webDir: 'dist',
  android: {
    // Phase 0 keeps Capacitor's default minimum WebView (Chrome 60) on purpose, so the app still
    // loads on an old WebView and the self-test can report what fails. The real floor is set
    // here from the Phase 0 results (proposed: 111).
    allowMixedContent: false,
  },
};

export default config;
