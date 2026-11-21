/**
 * The level at each station of a free walk: one point per mark, equally spaced (there is no line to
 * measure a distance along), joined by a line, with the warning level dashed, the strongest mark
 * ringed and the live level as a marker at the right edge. A pure drawing of what it is given.
 */
import { plotScaleMax } from './PrpdPlot';

export interface ChartPoint {
  label: string;
  value: number;
}

const LEFT = 30;
const RIGHT = 320;
const TOP = 20;
const BOTTOM = 170;
/** The chart always has room for this many marks, so one mark does not stretch across it. */
const MIN_SLOTS = 4;

export function MarkChart({
  marks,
  warning,
  peakIndex,
  live,
  label,
}: {
  marks: readonly ChartPoint[];
  warning: number;
  peakIndex: number | null;
  live: number | null;
  label: string;
}) {
  const strongest = Math.max(warning, live ?? 0, ...marks.map((m) => m.value));
  const yMax = plotScaleMax(strongest);
  const y = (value: number) => BOTTOM - Math.max(0, Math.min(1, value / yMax)) * (BOTTOM - TOP);
  const slots = Math.max(MIN_SLOTS, marks.length);
  const x = (i: number) => LEFT + ((i + 0.5) / slots) * (RIGHT - LEFT - 14);
  const line = marks.map((m, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(m.value).toFixed(1)}`).join(' ');
  return (
    <svg className="chart" viewBox="0 0 330 190" role="img" aria-label={label}>
      <g style={{ stroke: 'var(--grid)' }} strokeWidth="1">
        {[TOP, (TOP + BOTTOM) / 2, BOTTOM].map((gy) => (
          <line key={gy} x1={LEFT} y1={gy} x2={RIGHT} y2={gy} />
        ))}
      </g>
      <line x1={LEFT} y1={y(warning)} x2={RIGHT} y2={y(warning)} style={{ stroke: 'var(--warn-text)' }} strokeWidth="1" strokeDasharray="4 4" />
      <text x={RIGHT} y={y(warning) - 4} fontSize="10" textAnchor="end" style={{ fill: 'var(--warn-text)' }}>
        warning {String(warning)}
      </text>
      {marks.length > 1 ? <path d={line} fill="none" style={{ stroke: 'var(--chart)' }} strokeWidth="1.5" /> : null}
      {marks.map((m, i) => (
        <g key={m.label}>
          {i === peakIndex ? <circle cx={x(i)} cy={y(m.value)} r="8" fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="1.5" /> : null}
          <circle cx={x(i)} cy={y(m.value)} r="4" style={{ fill: 'var(--accent)' }} />
          <text x={x(i)} y="186" fontSize="11" textAnchor="middle" style={{ fill: 'var(--muted)' }}>
            {m.label}
          </text>
        </g>
      ))}
      {live === null ? null : (
        <g>
          <path d={`M${String(RIGHT)} ${y(live).toFixed(1)} l-8 -5 l0 10 z`} style={{ fill: 'var(--chart)' }} />
          <text x={RIGHT - 10} y={y(live) + 14} fontSize="10" textAnchor="end" style={{ fill: 'var(--muted)' }}>
            now
          </text>
        </g>
      )}
      <g fontSize="11" textAnchor="end" style={{ fill: 'var(--muted)' }}>
        <text x="26" y={TOP + 4}>
          {String(yMax)}
        </text>
        <text x="26" y={(TOP + BOTTOM) / 2 + 4}>
          {String(yMax / 2)}
        </text>
        <text x="26" y={BOTTOM + 4}>
          0
        </text>
      </g>
      <text x="2" y="12" fontSize="11" style={{ fill: 'var(--muted)' }}>
        dBmV
      </text>
    </svg>
  );
}
