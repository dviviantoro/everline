/** Screen 1: sign in (`mobile-ui-spec.md` section 3.1). A UI-only gate: no auth backend, no token. */
import { useState, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router';

import { useServices } from '../app/services';
import { useSession } from '../app/session';
import { TopBar } from '../ui/primitives';

export function LoginScreen() {
  const { config } = useServices();
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const proceed = (operator: string) => {
    void signIn(operator).then(() => navigate('/welcome', { replace: true }));
  };

  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (trimmed === '') {
      setError('Enter your email to continue.');
      return;
    }
    if (password === '') {
      setError('Enter your password to continue.');
      return;
    }
    setError(null);
    proceed(trimmed);
  };

  return (
    <div className="screen">
      <TopBar showBadge={false} />

      <div className="eyebrow" style={{ marginTop: 36 }}>
        Field Survey Network
      </div>
      <h1 className="title title-xl" style={{ marginTop: 14 }}>
        Every reading, <span className="accent">on record.</span>
      </h1>
      <p className="lead" style={{ marginTop: 16 }}>
        Sign in to review network condition, or log a field survey the moment you finish a patrol.
      </p>

      <form className="card stack" style={{ marginTop: 24, padding: 20, gap: 14 }} onSubmit={onSubmit} noValidate>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Sign in</h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.875rem', color: 'var(--muted)' }}>
            Your email is stored on this phone and sent as the surveyor.
          </p>
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </div>
        {error ? (
          <p role="alert" style={{ margin: 0, fontSize: '0.875rem', color: 'var(--crit-text)' }}>
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary">
          Sign in
        </button>
        {config.signIn.note ? (
          <p style={{ margin: 0, fontSize: '0.8125rem', lineHeight: 1.5, color: 'var(--muted)' }}>{config.signIn.note}</p>
        ) : null}
      </form>

      {config.signIn.skipAs ? (
        <div style={{ marginTop: 6, display: 'flex', justifyContent: 'center' }}>
          <button
            type="button"
            className="text-link"
            onClick={() => {
              if (config.signIn.skipAs) proceed(config.signIn.skipAs);
            }}
          >
            Skip sign-in
          </button>
        </div>
      ) : null}
    </div>
  );
}
