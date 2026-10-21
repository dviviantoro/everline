/**
 * Screen 2: turn on the hotspot (`mobile-ui-spec.md` section 3.2, ADR-003 strategy S3).
 * Android has no public API to switch the hotspot on, so the app shows what to set, opens the
 * system settings, and polls until it sees the hotspot (best effort). "Continue anyway" exists
 * because the final proof is Cantol reachability on the next screen.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { useServices } from '../app/services';
import { useWizard } from '../app/wizard';
import { CopyIcon } from '../ui/icons';
import { Pill, StepStrip, TopBar } from '../ui/primitives';

export function HotspotScreen() {
  const { hotspot } = useServices();
  const wizard = useWizard();
  const navigate = useNavigate();
  const profile = hotspot.profile();
  const status = wizard.state.hotspot;
  const [copied, setCopied] = useState(false);

  // Continue by itself when the hotspot turns on while this screen is open (not when it was already on).
  const previous = useRef(status);
  useEffect(() => {
    if (previous.current !== 'on' && status === 'on') void navigate('/setup/cantol', { replace: true });
    previous.current = status;
  }, [status, navigate]);

  const copyPassword = () => {
    void navigator.clipboard
      .writeText(profile.password)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => {
          setCopied(false);
        }, 2000);
      })
      .catch(() => undefined);
  };

  return (
    <div className="screen">
      <TopBar />
      <StepStrip current={1} />

      <h1 className="title">
        Turn on your <span className="accent">hotspot.</span>
      </h1>
      <p className="lead">The Cantol device connects to your phone through its hotspot. No site Wi-Fi needed.</p>

      <section className="card stack" style={{ marginTop: 22, gap: 14 }} aria-label="Hotspot settings to use">
        <div className="label-mono" style={{ letterSpacing: '0.14em' }}>
          Set your hotspot to
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          <div>
            <div className="helper" style={{ fontSize: '0.75rem' }}>
              Network name
            </div>
            <div className="mono" style={{ marginTop: 2, fontSize: '1rem', fontWeight: 500, overflowWrap: 'anywhere' }}>
              {profile.ssid}
            </div>
          </div>
          <div>
            <div className="helper" style={{ fontSize: '0.75rem' }}>
              Band
            </div>
            <div className="mono" style={{ marginTop: 2, fontSize: '1rem', fontWeight: 500 }}>
              {profile.band}
            </div>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            borderRadius: 6,
            background: 'var(--surface2)',
            padding: '8px 8px 8px 12px',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div className="helper" style={{ fontSize: '0.75rem' }}>
              Password
            </div>
            <div className="mono" style={{ marginTop: 2, fontSize: '1rem', fontWeight: 500, letterSpacing: '0.08em' }}>
              {'•'.repeat(Math.min(12, profile.password.length))}
            </div>
          </div>
          <button type="button" className="btn-copy" onClick={copyPassword} aria-label="Copy password">
            <CopyIcon size={16} />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <ul className="helper bullets">
          <li>Use the 2.4 GHz band.</li>
          <li>Switch off the hotspot&apos;s automatic turn-off.</li>
          <li>Switch the phone&apos;s own Wi-Fi off.</li>
        </ul>
      </section>

      <section
        className="card"
        style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px' }}
      >
        <span style={{ fontSize: '0.9375rem', fontWeight: 500 }}>Hotspot</span>
        {status === 'on' ? (
          <Pill tone="ok">On</Pill>
        ) : status === 'off' ? (
          <Pill tone="warn">Off</Pill>
        ) : (
          <Pill tone="warn">Checking</Pill>
        )}
      </section>

      <div className="pinned">
        {status === 'on' ? (
          <>
            <Link to="/setup/cantol" className="btn btn-primary">
              Continue
            </Link>
            <div className="helper" style={{ textAlign: 'center' }}>
              Hotspot detected. Next: connect the Cantol device.
            </div>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-primary" onClick={wizard.openHotspotSettings}>
              Open hotspot settings
            </button>
            <div className="helper" style={{ textAlign: 'center' }}>
              We continue automatically once the hotspot is on.
            </div>
            <button
              type="button"
              className="text-link"
              style={{ alignSelf: 'center' }}
              onClick={() => {
                wizard.continueAnyway();
                void navigate('/setup/cantol', { replace: true });
              }}
            >
              Continue anyway
            </button>
          </>
        )}
      </div>
    </div>
  );
}
