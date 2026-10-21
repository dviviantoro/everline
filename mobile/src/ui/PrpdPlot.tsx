/**
 * Phase-resolved partial discharge plot (screen 6): mains phase 0 to 360 degrees across,
 * calibrated level in dBmV up. Each dot is one pulse; the dashed curve is the mains cycle for
 * reference. A pure drawing of what it is given; no rule lives here.
 */

export interface PlotPoint {
  /** 0..65535 maps to 0..360 degrees. */
  phase: number;
  ampDbmV: number;
}

const LEFT = 30;
const RIGHT = 320;
const TOP = 20;
const BOTTOM = 170;

/** The smallest of a few round scales that fits the peak, so the axis does not jump about. */
export function plotScaleMax(peakDbmV: number | null): number {
  const wanted = (peakDbmV ?? 0) + 2;
  return [30, 50, 70, 100].find((max) => max >= wanted) ?? 120;
}

export function PrpdPlot({
  points,
  yMax,
  noiseDbmV,
  label,
}: {
  points: readonly PlotPoint[];
  yMax: number;
  noiseDbmV: number;
  label: string;
}) {
  const x = (phase: number) => LEFT + (phase / 65536) * (RIGHT - LEFT);
  const y = (amp: number) => BOTTOM - Math.max(0, Math.min(1, amp / yMax)) * (BOTTOM - TOP);
  const quarter = (RIGHT - LEFT) / 4;
  return (
    <svg className="chart" viewBox="0 0 330 190" role="img" aria-label={label}>
      <g style={{ stroke: 'var(--grid)' }} strokeWidth="1">
        {[TOP, (TOP + BOTTOM) / 2, BOTTOM].map((gy) => (
          <line key={gy} x1={LEFT} y1={gy} x2={RIGHT} y2={gy} />
        ))}
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} x1={LEFT + i * quarter} y1={TOP} x2={LEFT + i * quarter} y2={BOTTOM} />
        ))}
      </g>
      <line x1={LEFT} y1={BOTTOM} x2={RIGHT} y2={BOTTOM} style={{ stroke: 'var(--border2)' }} strokeWidth="1" />
      <path
        d="M30 95 C 54 40 150 40 175 95 C 199 150 295 150 320 95"
        fill="none"
        style={{ stroke: 'var(--chart)' }}
        strokeWidth="1.5"
        strokeDasharray="4 4"
      />
      <g>
        {points.map((p, i) => {
          const weak = p.ampDbmV < noiseDbmV + 3;
          return (
            <circle
              key={i}
              cx={x(p.phase)}
              cy={y(p.ampDbmV)}
              r={weak ? 2.5 : 3}
              style={{ fill: weak ? 'var(--muted)' : 'var(--accent)' }}
              fillOpacity={weak ? 0.8 : 0.9}
            />
          );
        })}
      </g>
      <g fontSize="11" style={{ fill: 'var(--muted)' }}>
        {[0, 90, 180, 270, 360].map((deg, i) => (
          // The last label hangs to the left of its gridline so it is not cut off by the edge.
          <text key={deg} x={i === 4 ? RIGHT + 6 : LEFT + i * quarter} y="188" textAnchor={i === 4 ? 'end' : 'middle'}>
            {deg}&deg;
          </text>
        ))}
      </g>
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
