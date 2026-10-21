/** Small formatters shared by the screens. Locale independent, so the demo reads the same on every phone. */
import type { Severity } from './types';

/** Magnitudes and levels: one decimal, as the mock shows readings ("33.4"). */
export function formatDbmV(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

/** A difference of two levels, with its sign: "+22.0" and "-8.5" (the minus is a real minus sign). */
export function formatDb(delta: number): string {
  const rounded = Math.round(delta * 10) / 10;
  if (rounded === 0) return '0.0';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(1)}`;
}

/** Metres under a kilometre, otherwise kilometres with one decimal; "<1 m" for next to the line. */
export function formatDistance(metres: number): string {
  if (metres < 1) return '<1 m';
  if (metres < 1000) return `${String(Math.round(metres))} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const pad = (n: number): string => String(n).padStart(2, '0');

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Today 20:12", "Yesterday 13:30", or "19 Oct 08:05", on the phone's own clock. */
export function formatWhen(ms: number, nowMs: number): string {
  const d = new Date(ms);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const days = Math.round((startOfDay(nowMs) - startOfDay(ms)) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return `${String(d.getDate())} ${MONTHS[d.getMonth()] ?? ''} ${time}`;
}

/** "mm:ss" for a countdown, from whole seconds. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { normal: 0, warning: 1, critical: 2 };
