import { SelfTestScreen } from './selftest/SelfTestScreen';

// Phase 0: the only screen is the self-test. The connection wizard replaces it in Phase 2.
export function App() {
  return <SelfTestScreen />;
}
