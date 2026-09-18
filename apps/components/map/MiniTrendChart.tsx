"use client";

// Deliberately not recharts: this renders inside a Leaflet popup, which sizes
// itself to its content, so a chart that measures its own container can come out
// zero-height. A fixed-size inline SVG always paints.
export function MiniTrendChart({
  values,
  width = 232,
  height = 64,
  color = "#dc2626",
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const padY = 6;
  const stepX = width / (values.length - 1);

  const coords = values.map((v, i) => {
    const x = i * stepX;
    const y = padY + (1 - (v - min) / span) * (height - padY * 2);
    return [x, y] as const;
  });

  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = coords[coords.length - 1];

  return (
    <svg width={width} height={height} className="block">
      <path d={`${line} L${width},${height} L0,${height} Z`} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
    </svg>
  );
}
