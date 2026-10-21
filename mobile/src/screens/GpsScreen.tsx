/**
 * Screen 4: enable location (`mobile-ui-spec.md` section 3.4). The location permission is
 * requested here (the old PERMS state is folded into LOCATION), then location services are
 * checked. Ready means a fix of 25 m or better; the accuracy shown is the real fix's, not a
 * constant. Permission denied, permanently denied, services off and a poor fix each get their
 * own plain explanation and action.
 */
import { Link } from 'react-router';

import { useWizard } from '../app/wizard';
import { gpsMet, MIN_GPS_ACCURACY_M } from '../core/wizard';
import { Pill, StepStrip, TopBar } from '../ui/primitives';

function Radar({ found, accuracyM }: { found: boolean; accuracyM: number | null }) {
  const label = found
    ? `Location radar with your position found, accuracy within ${String(Math.round(accuracyM ?? 0))} metres.`
    : 'Location radar with no position yet.';
  return (
    <svg className="chart" viewBox="0 0 326 150" role="img" aria-label={label}>
      {found ? (
        <>
          <g fill="none" style={{ stroke: 'var(--border2)' }} strokeWidth="1.5">
            <circle cx="163" cy="75" r="52" />
            <circle cx="163" cy="75" r="72" />
          </g>
          <circle cx="163" cy="75" r="30" style={{ fill: 'var(--cyan)', fillOpacity: 0.16, stroke: 'var(--cyan)' }} strokeWidth="1.5" />
          <circle className="pulse-ring" cx="163" cy="75" r="30" fill="none" style={{ stroke: 'var(--ok)' }} strokeWidth="2" />
          <path
            d="M163 54c-9 0-16 7-16 16 0 12 16 28 16 28s16-16 16-28c0-9-7-16-16-16z"
            style={{ fill: 'var(--accent)', stroke: 'var(--bg)' }}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <circle cx="163" cy="70" r="5" style={{ fill: 'var(--bg)' }} />
        </>
      ) : (
        <>
          <g fill="none" style={{ stroke: 'var(--border2)' }} strokeWidth="1.5" strokeDasharray="4 5">
            <circle cx="163" cy="75" r="30" />
            <circle cx="163" cy="75" r="52" />
            <circle cx="163" cy="75" r="72" />
          </g>
          <path
            d="M163 54c-9 0-16 7-16 16 0 12 16 28 16 28s16-16 16-28c0-9-7-16-16-16z"
            fill="none"
            style={{ stroke: 'var(--muted)' }}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <circle cx="163" cy="70" r="5" fill="none" style={{ stroke: 'var(--muted)' }} strokeWidth="2.2" />
        </>
      )}
    </svg>
  );
}

export function GpsScreen() {
  const wizard = useWizard();
  const { state } = wizard;
  const found = gpsMet(state);
  const { gpsPermission: permission, gpsServices: services, accuracyM } = state;
  const servicesOff = permission === 'granted' && services === 'off';
  const poorFix = permission === 'granted' && services === 'on' && accuracyM !== null && accuracyM > MIN_GPS_ACCURACY_M;
  const waitingForFix = permission === 'granted' && services === 'on' && accuracyM === null && !found;

  const access =
    permission === 'granted'
      ? 'Allowed'
      : permission === 'denied'
        ? 'Not allowed'
        : permission === 'denied_permanently'
          ? 'Blocked'
          : 'Not asked yet';

  let message = 'EverLine places every survey on the map. Turn on GPS and allow location access.';
  if (found) message = 'Your hotspot, the Cantol device and GPS are ready.';
  else if (permission === 'denied') message = 'Location access was not allowed. A survey needs a position. Tap Enable GPS to be asked again.';
  else if (permission === 'denied_permanently') message = 'Location access is blocked for this app. Open the app settings, allow location, then come back.';
  else if (servicesOff) message = 'Location is switched off on this phone. Turn it on to continue.';
  else if (poorFix) message = `Waiting for a better fix. Accuracy is about ${String(Math.round(accuracyM))} m; surveys need ${String(MIN_GPS_ACCURACY_M)} m or better.`;
  else if (waitingForFix) message = 'Looking for your position. This can take a few seconds outdoors.';

  return (
    <div className="screen">
      <TopBar />
      <StepStrip current={3} />

      {found ? (
        <h1 className="title">
          Location <span className="good">found.</span>
        </h1>
      ) : (
        <h1 className="title">
          Enable <span className="accent">location.</span>
        </h1>
      )}
      <p className="lead" role="status">
        {message}
      </p>

      <section className="card" style={{ marginTop: 22, padding: 12 }}>
        <Radar found={found} accuracyM={accuracyM} />
      </section>

      <section className="card card-flush" style={{ marginTop: 12, padding: '4px 16px' }} aria-label="Location status">
        <div className="row">
          <span className="row-title">GPS</span>
          {services === 'on' ? <Pill tone="ok">On</Pill> : <Pill tone="warn">Off</Pill>}
        </div>
        <div className="row">
          <span className="row-title">Location access</span>
          <span className="row-value" style={permission === 'granted' ? { color: 'var(--ok-text)' } : undefined}>
            {access}
          </span>
        </div>
        <div className="row">
          <span className="row-title">Accuracy</span>
          <span className="row-value" style={found ? { color: 'var(--text)' } : undefined}>
            {accuracyM === null ? '—' : `±${String(Math.round(accuracyM))} m`}
          </span>
        </div>
      </section>

      <div className="pinned">
        {found ? (
          <Link to="/device" className="btn btn-primary">
            Continue
          </Link>
        ) : permission === 'denied_permanently' ? (
          <>
            <button type="button" className="btn btn-primary" onClick={wizard.openAppSettings}>
              Open app settings
            </button>
            <div className="helper" style={{ textAlign: 'center' }}>
              Allow location for this app, then return here.
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-primary"
              disabled={waitingForFix || poorFix}
              onClick={() => {
                void wizard.enableGps();
              }}
            >
              {servicesOff ? 'Turn on location' : 'Enable GPS'}
            </button>
            <div className="helper" style={{ textAlign: 'center' }}>
              {waitingForFix || poorFix ? 'We continue as soon as the fix is good enough.' : 'Android will ask you to allow location access.'}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
