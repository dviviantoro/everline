import type { Condition, Severity } from "@/lib/types";

const STYLES: Record<string, string> = {
  good: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30",
  normal: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30",
  warning: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30",
  critical: "bg-red-100 text-red-800 border-red-300 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30",
  none: "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
};

// Dot colors used by map markers — kept alongside the badge so both stay in sync.
export const SEVERITY_DOT: Record<string, string> = {
  good: "#059669",
  normal: "#059669",
  warning: "#d97706",
  critical: "#dc2626",
  none: "#94a3b8",
};

export function SeverityBadge({ value }: { value: Condition | Severity | null | undefined }) {
  const key = value ?? "none";
  const label = value ? value[0].toUpperCase() + value.slice(1) : "No data yet";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[key]}`}
    >
      {label}
    </span>
  );
}
