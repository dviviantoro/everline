/**
 * The two screens behind the Cantol help card (`mobile-ui-spec.md` section 6, design backlog):
 * enter the address by hand, and read plain diagnostics. Both are deliberately simple.
 */
import { useEffect, useState, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router';

import { useServices } from '../app/services';
import { useWizard } from '../app/wizard';
import type { DiagnosticRow } from '../core/links';
import { isIpv4 } from '../core/net';
import { BackLink, TopBar } from '../ui/primitives';

export function EnterAddressScreen() {
  const wizard = useWizard();
  const navigate = useNavigate();
  const [address, setAddress] = useState(wizard.manualAddress ?? '');
  const [error, setError] = useState<string | null>(null);
  const linked = wizard.state.cantol === 'linked';

  // A manual address that works links Cantol; go back to the progress screen.
  useEffect(() => {
    if (linked) void navigate('/setup/cantol', { replace: true });
  }, [linked, navigate]);

  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!isIpv4(address)) {
      setError('Enter the address as four numbers separated by dots, for example 192.0.2.10.');
      return;
    }
    setError(null);
    wizard.enterAddress(address);
  };

  const failure = error ?? wizard.discoveryError;
  const trying = wizard.manualAddress !== null && wizard.state.cantol !== 'linked' && failure === null;

  return (
    <div className="screen">
      <TopBar start={<BackLink to="/setup/cantol" label="Cantol" />} />
      <h1 className="title title-md">
        Enter the <span className="accent">address</span>
      </h1>
      <p className="lead" style={{ marginTop: 10 }}>
        If Cantol shows its address, type it here. The address in this demo is a placeholder: 192.0.2.10.
      </p>
      <form className="card stack" style={{ marginTop: 18, gap: 14 }} onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="cantol-ip">Cantol IP address</label>
          <input
            id="cantol-ip"
            className="input input-mono"
            inputMode="decimal"
            autoComplete="off"
            placeholder="192.0.2.10"
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
            }}
          />
        </div>
        {failure ? (
          <p role="alert" style={{ margin: 0, fontSize: '0.875rem', color: 'var(--crit-text)' }}>
            {failure}
          </p>
        ) : null}
        {trying ? (
          <p role="status" className="helper" style={{ margin: 0 }}>
            Trying {wizard.manualAddress}&hellip;
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary">
          Connect
        </button>
      </form>
      <div style={{ marginTop: 6, display: 'flex', justifyContent: 'center' }}>
        <button type="button" className="text-link" onClick={wizard.retryDiscovery}>
          Search automatically again
        </button>
      </div>
    </div>
  );
}

export function DiagnosticsScreen() {
  const { link, hotspot } = useServices();
  const wizard = useWizard();
  const [rows, setRows] = useState<DiagnosticRow[]>([]);
  const { state } = wizard;

  useEffect(() => {
    let alive = true;
    const load = () => {
      void link
        .diagnostics()
        .then((next) => {
          if (alive) setRows(next);
        })
        .catch(() => undefined);
    };
    load();
    const id = window.setInterval(load, 2000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [link]);

  const facts: DiagnosticRow[] = [
    { label: 'Hotspot', value: state.hotspot === 'on' ? `on, ${hotspot.profile().ssid}` : state.hotspot },
    { label: 'Search', value: state.cantol },
    { label: 'Address', value: state.cantolAddress ?? 'none yet' },
  ];

  return (
    <div className="screen">
      <TopBar start={<BackLink to="/setup/cantol" label="Cantol" />} />
      <h1 className="title title-md">
        <span className="accent">Diagnostics</span>
      </h1>
      <p className="lead" style={{ marginTop: 10 }}>
        Plain facts about the link, for whoever is helping you.
      </p>
      <section className="card card-flush" style={{ marginTop: 18, padding: '4px 16px' }} aria-label="Diagnostics">
        {[...facts, ...rows].map((row) => (
          <div key={row.label} className="row">
            <span className="row-title">{row.label}</span>
            <span className="row-value">{row.value}</span>
          </div>
        ))}
      </section>
      <div className="pinned">
        <button type="button" className="btn btn-secondary btn-sm" onClick={wizard.retryDiscovery}>
          Search again
        </button>
      </div>
    </div>
  );
}
