/**
 * Level against distance walked along the span (`mobile-tracking-mode.md` section 4): the marks
 * joined by a line, the warning level as a dashed line, the strongest mark highlighted, and the
 * current position. In GPS distance mode the continuous trace is drawn too. A pure drawing.
 */
import { formatDbmV } from '../core/format';
import type { StationLabel } from '../core/model';
import type { TracePoint } from '../core/tracking';
import { plotScaleMax } from './PrpdPlot';

const LEFT = 34;
const RIGHT = 322;
const TOP = 22;
const BOTTOM = 160;

export interface ChartMark {
  walkedM: number;
  value: number;
  label: StationLabel;
}

export interface ChartStation {
  walkedM: number;
  label: StationLabel;
}

export function TrackChart({
  lengthM,
  stations,
  marks,
  trace,
  warning,
  peak,
  current,
  label,
}: {
  lengthM: number;
  /** The five stations in walk order, for the axis. */
  stations: readonly ChartStation[];
  marks: readonly ChartMark[];
  trace: readonly TracePoint[];
  warning: number;
  peak: ChartMark | null;
  current: { walkedM: number; level: number } | null;
  label: string;
}) {
  const highest = Math.max(warning, peak?.value ?? 0, current?.level ?? 0, ...trace.map((t) => t.level));
  const yMax = plotScaleMax(highest);
  const x = (walked: number) => LEFT + Math.max(0, Math.min(1, lengthM > 0 ? walked / lengthM : 0)) * (RIGHT - LEFT);
  const y = (value: number) => BOTTOM - Math.max(0, Math.min(1, value / yMax)) * (BOTTOM - TOP);
  const markLine = marks.map((m) => `${String(x(m.walkedM))} ${String(y(m.value))}`).join(' L');
  const traceLine = trace.map((t) => `${String(x(t.walkedM))} ${String(y(t.level))}`).join(' L');

  return (
    <svg className="chart" viewBox="0 0 330 206" role="img" aria-label={label}>
      <g style={{ stroke: 'var(--grid)' }} strokeWidth="1">
        <line x1={LEFT} y1={TOP} x2={RIGHT} y2={TOP} />
        <line x1={LEFT} y1={(TOP + BOTTOM) / 2} x2={RIGHT} y2={(TOP + BOTTOM) / 2} />
      </g>
      <line x1={LEFT} y1={BOTTOM} x2={RIGHT} y2={BOTTOM} style={{ stroke: 'var(--border2)' }} strokeWidth="1" />
      <g fontSize="11" textAnchor="end" style={{ fill: 'var(--muted)' }}>
        <text x="28" y={TOP + 4}>
          {String(yMax)}
        </text>
        <text x="28" y={(TOP + BOTTOM) / 2 + 4}>
          {String(yMax / 2)}
        </text>
        <text x="28" y={BOTTOM + 4}>
          0
        </text>
      </g>
      {warning <= yMax ? (
        <>
          <line
            x1={LEFT}
            y1={y(warning)}
            x2={RIGHT}
            y2={y(warning)}
            style={{ stroke: 'var(--accent)' }}
            strokeWidth="1.2"
            strokeDasharray="5 4"
            strokeOpacity="0.9"
          />
          <text x={LEFT + 6} y={y(warning) - 5} fontSize="11" style={{ fill: 'var(--accent-text)' }}>
            Warning {String(warning)} dBmV
          </text>
        </>
      ) : null}
      <g style={{ stroke: 'var(--border2)' }} strokeWidth="1">
        {stations.map((s) => (
          <line key={s.label} x1={x(s.walkedM)} y1={BOTTOM} x2={x(s.walkedM)} y2={BOTTOM + 5} />
        ))}
      </g>
      <g fontSize="11" textAnchor="middle" style={{ fill: 'var(--muted)' }}>
        {stations.map((s, i) => (
          <text key={s.label} x={Math.max(LEFT + 6, Math.min(RIGHT - 6, x(s.walkedM)))} y="184" textAnchor={i === 0 ? 'start' : i === stations.length - 1 ? 'end' : 'middle'}>
            {s.label}
          </text>
        ))}
        {stations.map((s, i) => (
          <text key={`${s.label}-m`} x={Math.max(LEFT + 6, Math.min(RIGHT - 6, x(s.walkedM)))} y="198" textAnchor={i === 0 ? 'start' : i === stations.length - 1 ? 'end' : 'middle'}>
            {String(Math.round(s.walkedM))} m
          </text>
        ))}
      </g>
      {traceLine ? <path d={`M${traceLine}`} fill="none" style={{ stroke: 'var(--chart)' }} strokeOpacity="0.45" strokeWidth="1.5" strokeLinejoin="round" /> : null}
      {markLine ? (
        <path d={`M${markLine}`} fill="none" style={{ stroke: 'var(--chart)' }} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      ) : null}
      <g style={{ fill: 'var(--chart)' }}>
        {marks.map((m) => (
          <circle key={m.label} cx={x(m.walkedM)} cy={y(m.value)} r="2.5" />
        ))}
      </g>
      {peak ? (
        <>
          <circle cx={x(peak.walkedM)} cy={y(peak.value)} r="6" style={{ fill: 'var(--accent)', stroke: 'var(--surface)' }} strokeWidth="2" />
          <text x={x(peak.walkedM)} y={y(peak.value) - 10} textAnchor="middle" fontSize="11" style={{ fill: 'var(--accent-text)' }}>
            {formatDbmV(peak.value)}
          </text>
        </>
      ) : null}
      {current ? (
        <>
          <circle cx={x(current.walkedM)} cy={y(current.level)} r="10" fill="none" style={{ stroke: 'var(--chart)' }} strokeWidth="1.5" strokeOpacity="0.5" />
          <circle cx={x(current.walkedM)} cy={y(current.level)} r="5.5" style={{ fill: 'var(--text)' }} />
          <text x={x(current.walkedM)} y={y(current.level) + 24} textAnchor="middle" fontSize="11" style={{ fill: 'var(--text)' }}>
            You
          </text>
        </>
      ) : null}
    </svg>
  );
}
