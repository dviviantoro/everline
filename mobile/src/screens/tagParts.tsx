/** Pieces the two Tag variants share. */
import type { ReactNode } from 'react';

import { SEVERITY_LABEL, type Severity } from '../core/types';

const SEVERITIES: readonly Severity[] = ['normal', 'warning', 'critical'];
const DOT: Readonly<Record<Severity, string>> = { normal: 'var(--ok)', warning: 'var(--accent)', critical: 'var(--crit)' };

export function SeverityButtons({ value, onChange }: { value: Severity; onChange: (next: Severity) => void }) {
  return (
    <div className="opt-grid" role="group" aria-label="Condition">
      {SEVERITIES.map((severity) => (
        <button
          key={severity}
          type="button"
          className="opt"
          aria-pressed={severity === value}
          onClick={() => {
            onChange(severity);
          }}
        >
          <span className="dot" style={{ background: DOT[severity] }} aria-hidden="true" />
          {SEVERITY_LABEL[severity]}
        </button>
      ))}
    </div>
  );
}

/** "Recorded 10 s / Peak 26.7 dBmV / Rate 248 /s", as the mock's summary card. */
export function SummaryCard({ items }: { items: readonly { label: string; value: string; unit?: string }[] }) {
  return (
    <section
      className="card"
      style={{ display: 'grid', gridTemplateColumns: `repeat(${String(items.length)}, minmax(0, 1fr))`, gap: 10, padding: '14px 16px' }}
    >
      {items.map((item) => (
        <div key={item.label}>
          <div className="label-mono">{item.label}</div>
          <div className="display-num" style={{ marginTop: 2, fontSize: '1.625rem', lineHeight: 1.05, overflowWrap: 'anywhere' }}>
            {item.value}
            {item.unit ? <span className="unit" style={{ fontSize: '0.75rem' }}> {item.unit}</span> : null}
          </div>
        </div>
      ))}
    </section>
  );
}

export function ConditionSection({
  value,
  suggested,
  edited,
  onChange,
  hint,
}: {
  value: Severity;
  suggested: Severity | null;
  edited: boolean;
  onChange: (next: Severity) => void;
  hint?: ReactNode;
}) {
  const text =
    edited && suggested !== null && value !== suggested
      ? `You changed it. The reading suggests ${SEVERITY_LABEL[suggested].toLowerCase()}.`
      : suggested === null
        ? 'The reading could not be classified. Choose the condition.'
        : `Suggested from the reading: ${SEVERITY_LABEL[suggested].toLowerCase()}.`;
  return (
    <section className="stack" style={{ gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600 }}>Condition</h2>
      <SeverityButtons value={value} onChange={onChange} />
      <p className="helper" style={{ margin: 0 }}>
        {text} {hint}
      </p>
    </section>
  );
}
