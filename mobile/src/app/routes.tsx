/** Routes and guards (`mobile-ui-spec.md` section 2). The rules themselves are in `core/guards.ts`. */
import { Link, Navigate, Route, Routes, useLocation } from 'react-router';

import { guardRedirect } from '../core/guards';
import { routeForStep } from '../core/wizard';
import { CantolScreen } from '../screens/CantolScreen';
import { DiagnosticsScreen, EnterAddressScreen } from '../screens/CantolHelpScreens';
import { DeviceScreen } from '../screens/DeviceScreen';
import { GpsScreen } from '../screens/GpsScreen';
import { HotspotScreen } from '../screens/HotspotScreen';
import { LiveScreen } from '../screens/LiveScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { SurveysScreen } from '../screens/SurveysScreen';
import { TagScreen } from '../screens/TagScreen';
import { TrackSetupScreen } from '../screens/TrackSetupScreen';
import { TrackingScreen } from '../screens/TrackingScreen';
import { SelfTestScreen } from '../selftest/SelfTestScreen';
import { useServices } from './services';
import { useSession } from './session';
import { useWizard } from './wizard';

/** The Phase 0 self-test, reachable at /selftest in every build, with the look it has always had. */
function SelfTestHost() {
  return (
    <div className="selftest-host">
      <SelfTestScreen />
      <div className="mx-auto max-w-xl px-4 pb-8 text-neutral-900 dark:text-neutral-100">
        <Link to="/" className="text-sm underline">
          Back to the app
        </Link>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="screen" role="status" aria-busy="true">
      <span className="sr-only">Loading</span>
    </div>
  );
}

/** Routes whose guard needs the wizard's first checks, so they wait for them on a cold start. */
function waitsForWizard(path: string): boolean {
  return path === '/' || path.startsWith('/setup/') || ['/device', '/live', '/track', '/track/setup'].includes(path);
}

export function AppRoutes() {
  const session = useSession();
  const wizard = useWizard();
  const { config } = useServices();
  const { pathname } = useLocation();

  if (session.status === 'loading') return <Loading />;
  if (session.operator !== null && waitsForWizard(pathname) && !wizard.initialised) return <Loading />;

  const redirect = guardRedirect(pathname, { operator: session.operator, step: wizard.step });
  if (redirect !== null && redirect !== pathname) return <Navigate to={redirect} replace />;

  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route
        path="/welcome"
        element={<WelcomeScreen destination={wizard.initialised ? routeForStep(wizard.step) : null} />}
      />
      <Route path="/setup/hotspot" element={<HotspotScreen />} />
      <Route path="/setup/cantol" element={<CantolScreen />} />
      <Route path="/setup/cantol/address" element={<EnterAddressScreen />} />
      <Route path="/setup/cantol/diagnostics" element={<DiagnosticsScreen />} />
      <Route path="/setup/gps" element={<GpsScreen />} />
      <Route path="/device" element={<DeviceScreen />} />
      <Route path="/live" element={<LiveScreen />} />
      <Route path="/track/setup" element={<TrackSetupScreen />} />
      <Route path="/track" element={<TrackingScreen />} />
      <Route path="/tag" element={<TagScreen />} />
      <Route path="/surveys" element={<SurveysScreen />} />
      {config.extraRoutes.map((route) => (
        <Route key={route.path} path={route.path} element={route.element} />
      ))}
      <Route path="/selftest" element={<SelfTestHost />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
