/**
 * The values printed on the Cantol device's label (ADR-009): the hotspot name and password it joins,
 * and its MAC address. Asked the first time the app opens, and again whenever the operator taps
 * "Change" on the hotspot screen. The app cannot change the Cantol's network, so the phone's
 * hotspot has to match what is typed here; the MAC address is how the link tells this Cantol from
 * any other device that answers on the same hotspot.
 */
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useCallback, useState, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router';

import { useBackInterceptor } from '../app/back';
import { useServices } from '../app/services';
import { useWizard } from '../app/wizard';
import { normaliseMac, validateSetup, type SetupErrors } from '../core/cantolSetup';
import { BackLink, TopBar } from '../ui/primitives';

function FieldError({ id, text }: { id: string; text: string | undefined }) {
  if (text === undefined) return null;
  return (
    <p id={id} role="alert" style={{ margin: '6px 0 0', fontSize: '0.875rem', color: 'var(--crit-text)' }}>
      {text}
    </p>
  );
}

export function CantolSetupScreen() {
  const { setup } = useServices();
  const wizard = useWizard();
  const navigate = useNavigate();
  const saved = setup?.current() ?? null;
  // Before anything is saved this is the first run: there is nowhere to go back to.
  const editing = saved !== null;

  const [ssid, setSsid] = useState(saved?.ssid ?? '');
  const [password, setPassword] = useState(saved?.password ?? '');
  const [mac, setMac] = useState(saved?.mac ?? '');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<SetupErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Back on the first run leaves the app, as on the other first screens; later it returns to the hotspot screen.
  useBackInterceptor(
    useCallback(() => {
      if (editing) return false;
      if (Capacitor.isNativePlatform()) void CapacitorApp.exitApp();
      return true;
    }, [editing]),
  );

  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    const check = validateSetup({ ssid, password, mac });
    if (!check.ok) {
      setErrors(check.errors);
      setSaveError(null);
      return;
    }
    setErrors({});
    setSaveError(null);
    setSaving(true);
    void wizard
      .saveSetup(check.setup)
      .then(() => navigate('/', { replace: true }))
      .catch((error: unknown) => {
        setSaveError(`These values could not be saved on this phone: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        setSaving(false);
      });
  };

  // Tidy the MAC address when the field is left, so what is saved is what the operator sees.
  const tidyMac = () => {
    const tidy = normaliseMac(mac);
    if (tidy !== null) setMac(tidy);
  };

  return (
    <div className="screen">
      <TopBar start={editing ? <BackLink to="/setup/hotspot" label="Hotspot" /> : undefined} />

      <h1 className="title">
        Enter the <span className="accent">Cantol label.</span>
      </h1>
      <p className="lead">
        Type the three values printed on the Cantol device. You only do this once; you can change them later.
      </p>

      <form className="card stack" style={{ marginTop: 22, gap: 16 }} onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="cantol-ssid">Network name (SSID)</label>
          <input
            id="cantol-ssid"
            className="input input-mono"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={64}
            placeholder="CANTOL-1234"
            aria-invalid={errors.ssid !== undefined}
            aria-describedby="cantol-ssid-error"
            value={ssid}
            onChange={(event) => {
              setSsid(event.target.value);
            }}
          />
          <FieldError id="cantol-ssid-error" text={errors.ssid} />
        </div>

        <div className="field">
          <label htmlFor="cantol-password">Hotspot password</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="cantol-password"
              className="input input-mono"
              style={{ flex: 1, minWidth: 0 }}
              type={showPassword ? 'text' : 'password'}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={80}
              aria-invalid={errors.password !== undefined}
              aria-describedby="cantol-password-error"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              aria-pressed={showPassword}
              onClick={() => {
                setShowPassword((shown) => !shown);
              }}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <FieldError id="cantol-password-error" text={errors.password} />
        </div>

        <div className="field">
          <label htmlFor="cantol-mac">Cantol MAC address</label>
          <input
            id="cantol-mac"
            className="input input-mono"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={40}
            placeholder="00:26:32:F0:1A:BC"
            aria-invalid={errors.mac !== undefined}
            aria-describedby="cantol-mac-help cantol-mac-error"
            value={mac}
            onChange={(event) => {
              setMac(event.target.value);
            }}
            onBlur={tidyMac}
          />
          <p id="cantol-mac-help" className="helper" style={{ margin: '6px 0 0', fontSize: '0.8125rem' }}>
            Twelve digits or letters A to F. The app only connects to the Cantol that reports this address.
          </p>
          <FieldError id="cantol-mac-error" text={errors.mac} />
        </div>

        {saveError === null ? null : (
          <p role="alert" style={{ margin: 0, fontSize: '0.875rem', color: 'var(--crit-text)' }}>
            {saveError}
          </p>
        )}

        <button type="submit" className="btn btn-primary" disabled={saving}>
          {editing ? 'Save' : 'Save and continue'}
        </button>
        <p className="helper" style={{ margin: 0, fontSize: '0.8125rem' }}>
          Kept on this phone only. The same name and password go into your phone&apos;s hotspot in the next step.
        </p>
      </form>
    </div>
  );
}
