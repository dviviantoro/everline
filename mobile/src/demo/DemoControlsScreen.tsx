/**
 * Demo controls (demo build only, reached from the Ready screen footer). Small and plain: change
 * the scenario, force the failures the real flow must survive, and reset everything.
 */
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';

import { useServices } from '../app/services';
import { useSession } from '../app/session';
import { useWizard } from '../app/wizard';
import { SEVERITY_LABEL, LINE_KIND_LABEL } from '../core/types';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { BackLink, Segmented, Switch, TopBar } from '../ui/primitives';
import { useControls, type DemoGpsPermission, type PeakStation } from './controls';
import type { DemoRuntime } from './runtime';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 18 }}>
      <h2 className="label-mono" style={{ margin: '0 0 8px' }}>
        {title}
      </h2>
      <div className="card card-flush" style={{ padding: '4px 16px' }}>
        {children}
      </div>
    </section>
  );
}

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="row" style={{ minHeight: 60 }}>
      <div className="row-title">
        {label}
        {hint ? (
          <div className="helper" style={{ marginTop: 2, fontWeight: 400 }}>
            {hint}
          </div>
        ) : null}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

const PEAK_OPTIONS: { value: PeakStation; label: string }[] = [
  { value: 'P1', label: 'P1' },
  { value: 'P2', label: 'P2' },
  { value: 'P3', label: 'P3' },
  { value: 'none', label: 'None' },
];

const GPS_OPTIONS: { value: DemoGpsPermission; label: string }[] = [
  { value: 'granted', label: 'Allowed' },
  { value: 'denied', label: 'Denied' },
  { value: 'denied_permanently', label: 'Blocked' },
];

export function DemoControlsScreen({ runtime }: { runtime: DemoRuntime }) {
  const { services } = runtime;
  const { dsp, store } = useServices();
  const wizard = useWizard();
  const { signOut } = useSession();
  const navigate = useNavigate();
  const c = useControls(runtime.controls);
  const [confirming, setConfirming] = useState(false);

  const reset = () => {
    setConfirming(false);
    void (async () => {
      await store.resetAll();
      await signOut();
      wizard.reset();
      runtime.hotspot.reset();
      runtime.controls.reset();
      runtime.world.placeAtSpot();
      void navigate('/login', { replace: true });
    })();
  };

  return (
    <div className="screen">
      <TopBar start={<BackLink to="/device" label="Device" />} />
      <h1 className="title title-md">
        Demo <span className="accent">controls</span>
      </h1>
      <p className="lead" style={{ marginTop: 10 }}>
        Everything in this build is simulated. These switches change the simulation, never a real device.
      </p>

      <Section title="Scenario">
        <div className="field" style={{ padding: '12px 0' }}>
          <span className="field-label" id="peak-label">
            Strongest reading is at
          </span>
          <Segmented
            label="Strongest reading is at"
            options={PEAK_OPTIONS}
            value={c.peakStation}
            onChange={(peakStation) => {
              runtime.controls.set({ peakStation });
            }}
          />
          <span className="helper">Tracking a span shows Rising, then Falling around this station.</span>
        </div>
        <div className="field" style={{ padding: '4px 0 14px' }}>
          <label htmlFor="spot-asset">Spot readings are taken next to</label>
          <select
            id="spot-asset"
            className="input"
            value={c.spotAssetCode}
            onChange={(event) => {
              runtime.controls.set({ spotAssetCode: event.target.value });
              runtime.world.placeAtSpot();
            }}
          >
            {runtime.lines.map((line) => {
              const severity = dsp.classify(line.spotDbmV);
              return (
                <option key={line.id} value={line.code}>
                  {line.code} ({LINE_KIND_LABEL[line.line_type]}, {severity ? SEVERITY_LABEL[severity].toLowerCase() : 'unclassified'})
                </option>
              );
            })}
          </select>
        </div>
      </Section>

      <Section title="Recording">
        <SwitchRow
          label="Fast recording"
          hint={`Record 10 s instead of 60 s. Now: ${String(services.config.recordSeconds())} s.`}
          checked={c.fastRecording}
          onChange={(fastRecording) => {
            runtime.controls.set({ fastRecording });
          }}
        />
      </Section>

      <Section title="Force a problem">
        <SwitchRow
          label="Link lost"
          hint="Drops the Cantol link and keeps it down."
          checked={c.linkLost}
          onChange={(linkLost) => {
            runtime.controls.set({ linkLost });
          }}
        />
        <SwitchRow
          label="Cantol not found"
          hint="Discovery never answers; the help card appears after 60 s."
          checked={c.cantolNotFound}
          onChange={(cantolNotFound) => {
            runtime.controls.set({ cantolNotFound });
          }}
        />
        <SwitchRow
          label="Next upload fails"
          hint="The next Upload or Retry comes back as a failure."
          checked={c.failNextUpload}
          onChange={(failNextUpload) => {
            runtime.controls.set({ failNextUpload });
          }}
        />
        <SwitchRow
          label="Mains reference locked"
          hint="Off hides the phase plot, as the real screen does."
          checked={!c.mainsUnlocked}
          onChange={(locked) => {
            runtime.controls.set({ mainsUnlocked: !locked });
          }}
        />
        <div className="field" style={{ padding: '12px 0' }}>
          <span className="field-label">Location permission</span>
          <Segmented
            label="Location permission"
            options={GPS_OPTIONS}
            value={c.gpsPermission}
            onChange={(gpsPermission) => {
              runtime.controls.set({ gpsPermission });
            }}
          />
        </div>
        <SwitchRow
          label="Location services on"
          checked={c.gpsServices === 'on'}
          onChange={(on) => {
            runtime.controls.set({ gpsServices: on ? 'on' : 'off' });
          }}
        />
      </Section>

      <Section title="Other">
        <div className="stack" style={{ gap: 10, padding: '12px 0' }}>
          <Link to="/selftest" className="btn btn-secondary btn-sm">
            Open self-test
          </Link>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Reset all demo data
          </button>
        </div>
      </Section>

      {confirming ? (
        <ConfirmDialog
          title="Reset all demo data?"
          confirmLabel="Reset"
          cancelLabel="Keep data"
          onConfirm={reset}
          onCancel={() => {
            setConfirming(false);
          }}
        >
          This signs you out and erases the surveys, drafts and settings saved on this phone. Nothing is sent anywhere.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
