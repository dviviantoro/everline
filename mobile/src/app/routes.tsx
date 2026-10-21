/** Routes and guards (`mobile-ui-spec.md` section 2). */
import { Link, Navigate, Route, Routes } from 'react-router';

import { LoginScreen } from '../screens/LoginScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { SelfTestScreen } from '../selftest/SelfTestScreen';
import { TopBar } from '../ui/primitives';
import { useSession } from './session';

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

/** Replaced by the connection wizard in the next milestone. */
function WizardPlaceholder() {
  return (
    <div className="screen">
      <TopBar />
      <p className="lead">The connection wizard is built in the next milestone.</p>
    </div>
  );
}

export function AppRoutes() {
  const session = useSession();
  if (session.status === 'loading') return <div className="screen" aria-busy="true" />;
  const signedIn = session.operator !== null;
  return (
    <Routes>
      <Route path="/login" element={signedIn ? <Navigate to="/welcome" replace /> : <LoginScreen />} />
      <Route
        path="/welcome"
        element={signedIn ? <WelcomeScreen destination="/setup/hotspot" /> : <Navigate to="/login" replace />}
      />
      <Route path="/setup/hotspot" element={signedIn ? <WizardPlaceholder /> : <Navigate to="/login" replace />} />
      <Route path="/selftest" element={<SelfTestHost />} />
      <Route path="*" element={<Navigate to={signedIn ? '/setup/hotspot' : '/login'} replace />} />
    </Routes>
  );
}
