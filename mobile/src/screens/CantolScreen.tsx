/**
 * Screen 3: waiting for Cantol (`mobile-ui-spec.md` section 3.3). "Cantol joins hotspot" means a
 * candidate was found by discovery; "Data link" means the HELLO/PONG handshake succeeded. After
 * 60 s with no candidate a help card offers entering the address and the diagnostics. The mock's
 * 5-second timer was a prototype stand-in: this screen never invents a success.
 */
import { Link } from 'react-router';

import { useServices } from '../app/services';
import { useWizard } from '../app/wizard';
import { CheckIcon } from '../ui/icons';
import { StepStrip, TopBar } from '../ui/primitives';

function PhoneToCantol({ linked }: { linked: boolean }) {
  return (
    <svg
      className="chart"
      viewBox="0 0 326 124"
      role="img"
      aria-label={linked ? 'Your phone linked to the Cantol device.' : 'Your phone on the left, searching for the Cantol device on the right.'}
    >
      <rect x="40" y="28" width="34" height="64" rx="7" fill="none" style={{ stroke: 'var(--text)' }} strokeWidth="2" />
      <line x1="52" y1="36" x2="62" y2="36" style={{ stroke: 'var(--text)' }} strokeWidth="2" strokeLinecap="round" />
      {linked ? (
        <line x1="82" y1="60" x2="226" y2="60" style={{ stroke: 'var(--ok)' }} strokeWidth="2.5" strokeLinecap="round" />
      ) : (
        <>
          <line x1="82" y1="60" x2="226" y2="60" style={{ stroke: 'var(--muted)' }} strokeWidth="2" strokeDasharray="6 6" strokeLinecap="round" />
          <circle className="pulse-ring" cx="267" cy="60" r="34" fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="2" />
        </>
      )}
      <rect x="236" y="40" width="62" height="40" rx="6" fill="none" style={{ stroke: 'var(--text)' }} strokeWidth="2" />
      <g style={{ stroke: 'var(--text)' }} strokeWidth="2" strokeLinecap="round">
        <line x1="250" y1="52" x2="250" y2="68" />
        <line x1="262" y1="52" x2="262" y2="68" />
        <line x1="274" y1="52" x2="274" y2="68" />
      </g>
      {linked ? (
        <>
          <circle cx="298" cy="40" r="10" style={{ fill: 'var(--ok)' }} />
          <path d="M293 40l3.5 3.5L303 37" fill="none" style={{ stroke: 'var(--bg)' }} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : null}
      <text x="57" y="116" textAnchor="middle" fontSize="11" style={{ fill: 'var(--muted)' }}>
        Your phone
      </text>
      <text x="267" y="116" textAnchor="middle" fontSize="11" style={{ fill: 'var(--muted)' }}>
        Cantol
      </text>
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="spin" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" style={{ stroke: 'var(--border2)' }} strokeWidth="3" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function Step({
  state,
  label,
  value,
}: {
  state: 'done' | 'busy' | 'pending';
  label: string;
  value: string;
}) {
  return (
    <div className="row">
      {state === 'done' ? (
        <span style={{ color: 'var(--ok)', display: 'inline-flex' }}>
          <CheckIcon size={20} strokeWidth={2.6} />
        </span>
      ) : state === 'busy' ? (
        <Spinner />
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" fill="none" style={{ stroke: 'var(--border2)' }} strokeWidth="2" />
        </svg>
      )}
      <span className="row-title" style={state === 'pending' ? { color: 'var(--muted)' } : undefined}>
        {label}
      </span>
      <span className="row-value" style={state === 'busy' ? { color: 'var(--accent-text)' } : undefined}>
        {value}
      </span>
    </div>
  );
}

export function CantolScreen() {
  const { hotspot } = useServices();
  const { state, step, helpCard, manualAddress, discoveryError, retryDiscovery } = useWizard();
  const found = state.cantol === 'found' || state.cantol === 'linked' || state.cantol === 'lost';
  const linked = state.cantol === 'linked' || state.cantol === 'lost';
  const pinging = step === 'CANTOL_PING';

  return (
    <div className="screen">
      <TopBar />
      <StepStrip current={2} />

      {linked ? (
        <>
          <h1 className="title">
            Cantol <span className="good">connected.</span>
          </h1>
          <p className="lead">The data link is open. One more step: location.</p>
        </>
      ) : (
        <>
          <h1 className="title">
            Waiting for <span className="accent">Cantol.</span>
          </h1>
          <p className="lead">Power on the Cantol device. It joins your hotspot automatically.</p>
        </>
      )}

      <section className="card" style={{ marginTop: 22, padding: 12 }}>
        <PhoneToCantol linked={linked} />
      </section>

      <section className="card card-flush" style={{ marginTop: 12, padding: '4px 16px' }} aria-label="Connection progress">
        <Step state="done" label="Hotspot on" value={hotspot.profile().ssid} />
        <Step
          state={found ? 'done' : 'busy'}
          label={found ? 'Cantol joined' : 'Cantol joins hotspot'}
          value={found ? (state.cantolAddress ?? '') : 'Searching'}
        />
        <Step
          state={linked ? 'done' : pinging ? 'busy' : 'pending'}
          label={linked ? 'Data link open' : 'Open data link'}
          value={linked ? `${String(state.rttMs ?? 0)} ms` : pinging ? 'Opening' : 'Pending'}
        />
      </section>

      {manualAddress !== null && !linked ? (
        <section className="card stack" style={{ marginTop: 12, gap: 8 }} aria-label="Manual address">
          <p style={{ margin: 0, fontSize: '0.9375rem' }}>
            Looking only at <span className="mono">{manualAddress}</span>.
          </p>
          {discoveryError ? (
            <p role="alert" style={{ margin: 0, fontSize: '0.875rem', color: 'var(--crit-text)' }}>
              {discoveryError}
            </p>
          ) : null}
          <button type="button" className="btn btn-secondary btn-sm" onClick={retryDiscovery}>
            Search automatically instead
          </button>
        </section>
      ) : null}

      {helpCard && !found ? (
        <section className="card" style={{ marginTop: 12 }} aria-label="Cantol was not found">
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Cantol has not answered for a minute.</h2>
          <p className="helper" style={{ margin: '6px 0 12px', fontSize: '0.875rem', lineHeight: 1.5 }}>
            Check that the Cantol device is powered on, and that its Wi-Fi is set to this phone&apos;s hotspot.
          </p>
          <div className="stack" style={{ gap: 8 }}>
            <Link to="/setup/cantol/address" className="btn btn-secondary btn-sm">
              Enter IP manually
            </Link>
            <Link to="/setup/cantol/diagnostics" className="btn btn-secondary btn-sm">
              Diagnostics
            </Link>
          </div>
        </section>
      ) : null}

      <div className="pinned">
        {linked ? (
          <Link to="/setup/gps" className="btn btn-primary">
            Continue
          </Link>
        ) : (
          <>
            <div className="helper" style={{ textAlign: 'center' }}>
              Keep the Cantol device powered and within range.
            </div>
            <Link to="/setup/hotspot" className="btn btn-secondary">
              Back
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
