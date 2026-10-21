/**
 * The signed-in operator. Sign-in is a UI-only gate, like the web `/login` (no auth backend,
 * no token): any non-empty email continues, and the email is what every survey sends as
 * `surveyor`. The value lives in the local store, so it survives the app being restarted.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useServices } from './services';

export type SessionStatus = 'loading' | 'ready';

interface SessionValue {
  /** `loading` until the store has been opened and read. */
  status: SessionStatus;
  operator: string | null;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { store } = useServices();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [operator, setOperator] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void store
      .getOperator()
      .catch(() => null)
      .then((stored) => {
        if (cancelled) return;
        setOperator(stored);
        setStatus('ready');
      });
    return () => {
      cancelled = true;
    };
  }, [store]);

  const signIn = useCallback(
    async (email: string) => {
      await store.setOperator(email);
      setOperator(email);
    },
    [store],
  );

  const signOut = useCallback(async () => {
    await store.clearOperator();
    setOperator(null);
  }, [store]);

  const value = useMemo(() => ({ status, operator, signIn, signOut }), [status, operator, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
