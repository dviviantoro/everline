/**
 * Screen 5: ready to measure (`mobile-ui-spec.md` section 3.5). Each row reflects live state and
 * turns into an actionable warning if something is lost; a loss recovers silently for 30 s
 * before the wizard reopens, so the warning is what the operator sees in between.
 */
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';

import { useServices } from '../app/services';
import { useWizard } from '../app/wizard';
import { DeviceIcon, PinIcon, WifiIcon } from '../ui/icons';
import { BottomNav } from '../ui/BottomNav';
import { Pill, TopBar } from '../ui/primitives';

function DeviceRow({
  icon,
  title,
  detail,
  ok,
  okLabel,
  warnLabel,
  fixTo,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  ok: boolean;
  okLabel: string;
  warnLabel: string;
  fixTo: string;
}) {
  return (
    <div className="row row-lg">
      <span className="row-icon">{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.9375rem', fontWeight: 500 }}>{title}</div>
        <div className="mono" style={{ marginTop: 2, fontSize: '0.75rem', color: 'var(--muted)', overflowWrap: 'anywhere' }}>
          {detail}
        </div>
      </div>
      {ok ? (
        <Pill tone="ok">{okLabel}</Pill>
      ) : (
        <Link to={fixTo} aria-label={`${title}: ${warnLabel}. Open setup`} style={{ textDecoration: 'none' }}>
          <Pill tone="warn">{warnLabel}</Pill>
        </Link>
      )}
    </div>
  );
}

export function DeviceScreen() {
  const { hotspot, config } = useServices();
  const wizard = useWizard();
  const navigate = useNavigate();
  const { state } = wizard;
  const profile = hotspot.profile();

  const hotspotOk = state.hotspot === 'on' || state.hotspotAcknowledged;
  const cantolOk = state.cantol === 'linked';
  const gpsOk = state.accuracyM !== null;
  const allOk = hotspotOk && cantolOk && gpsOk;

  const start = () => {
    void wizard.startMeasurement().then(() => navigate('/live'));
  };

  return (
    <div className="screen screen-tabbed">
      <TopBar />

      <div className="screen-body" style={{ paddingTop: 28 }}>
        <div className="eyebrow">Device status</div>
        <h1 className="title" style={{ marginTop: 12 }}>
          Ready to <span className="accent">measure.</span>
        </h1>
        <p className="lead">Your hotspot, the Cantol device and GPS are all connected.</p>

        <section className="card card-flush" style={{ marginTop: 24, padding: '0 16px' }} aria-label="Connections">
          <DeviceRow
            icon={<WifiIcon size={22} />}
            title="Hotspot"
            detail={`${profile.ssid} · ${profile.band}`}
            ok={hotspotOk}
            okLabel="On"
            warnLabel="Off, recovering"
            fixTo="/setup/hotspot"
          />
          <DeviceRow
            icon={<DeviceIcon size={22} />}
            title="Cantol"
            detail={`${state.cantolAddress ?? 'no address'} · ${String(state.rttMs ?? 0)} ms`}
            ok={cantolOk}
            okLabel="Connected"
            warnLabel="Reconnecting"
            fixTo="/setup/cantol"
          />
          <DeviceRow
            icon={<PinIcon size={22} />}
            title="Location"
            detail={state.accuracyM === null ? 'GPS · no fix' : `GPS · ±${String(Math.round(state.accuracyM))} m`}
            ok={gpsOk}
            okLabel="On"
            warnLabel="No fix"
            fixTo="/setup/gps"
          />
        </section>

        <div className="pinned" style={{ paddingBottom: 16 }}>
          <button type="button" className="btn btn-primary" disabled={!allOk} onClick={start}>
            Start measurement
          </button>
          {allOk ? null : (
            <div className="helper" style={{ textAlign: 'center' }} role="status">
              Something dropped out. It usually comes back by itself within 30 seconds.
            </div>
          )}
          {config.footerLinks.map((link) => (
            <Link key={link.to} to={link.to} className="text-link" style={{ alignSelf: 'center' }}>
              {link.label}
            </Link>
          ))}
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
