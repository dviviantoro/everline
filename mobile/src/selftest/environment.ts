export type EnvironmentReport = Record<string, string | number | boolean>;

/**
 * Facts about the JavaScript environment that decide whether the app can run on a device.
 * Recorded in the self-test so a phone that fails tells us why (WebView too old, CSS missing).
 */
export function describeEnvironment(scope: 'main' | 'worker'): EnvironmentReport {
  const ua = navigator.userAgent;
  const report: EnvironmentReport = {
    scope,
    userAgent: ua,
    chromeMajor: Number(/Chrome\/(\d+)/.exec(ua)?.[1] ?? 0),
    androidVersion: /Android (\d+(?:\.\d+)?)/.exec(ua)?.[1] ?? 'n/a',
    origin: location.origin,
    webAssembly: typeof WebAssembly === 'object',
    sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
    crossOriginIsolated: self.crossOriginIsolated,
    cores: navigator.hardwareConcurrency,
  };
  if (scope === 'main') {
    // Tailwind 4 relies on these; a WebView without them renders the UI unstyled or broken.
    report['secureContext'] = window.isSecureContext;
    report['cssColorMix'] = CSS.supports('color', 'color-mix(in oklab, red, blue)');
    report['cssAtProperty'] = 'registerProperty' in CSS;
    report['cssCascadeLayers'] = 'CSSLayerBlockRule' in window;
    report['screen'] = `${String(screen.width)}x${String(screen.height)} @${String(devicePixelRatio)}x`;
  }
  return report;
}
