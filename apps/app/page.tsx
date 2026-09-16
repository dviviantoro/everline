import Link from "next/link";
import { apiFetch } from "@/lib/api";
import type { AssetListItem } from "@/lib/types";
import { BrandMark } from "@/components/BrandMark";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    title: "Live Network Map",
    body: "Every 20kV transformer and line in one view, color-coded by condition the moment a survey lands.",
  },
  {
    title: "Field Survey Capture",
    body: "Operators log electrical readings and partial-discharge patrols from a phone, GPS-assisted, in the field.",
  },
  {
    title: "Full History, Never Overwritten",
    body: "Every visit is a new record. Nothing is ever edited or deleted — the trend line is the whole point.",
  },
  {
    title: "Severity At A Glance",
    body: "Normal, warning, critical — rendered as color the instant you look at the map, not buried in a spreadsheet.",
  },
] as const;

const STEPS = [
  { n: "01", title: "Operator surveys", body: "Field visit logged from the asset's location — readings or a multi-point PD patrol." },
  { n: "02", title: "Data lands instantly", body: "The new survey appears on the map and in the asset's timeline immediately." },
  { n: "03", title: "Engineer reviews", body: "Trends, hotspots, and rising discharge activity are visible before they become outages." },
] as const;

export default async function LandingPage() {
  const assetsRes = await apiFetch("/api/assets", { cache: "no-store" });
  const assets: AssetListItem[] = await assetsRes.json().then((p) => p.data);
  const transformerCount = assets.filter((a) => a.type === "transformer").length;
  const lineCount = assets.filter((a) => a.type === "line").length;
  const attentionCount = assets.filter(
    (a) => a.latest_condition === "warning" || a.latest_condition === "critical" ||
           a.latest_severity === "warning" || a.latest_severity === "critical"
  ).length;

  return (
    <div className="min-h-screen overflow-x-hidden bg-ink text-paper">
      {/* Nav */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <BrandMark className="h-8 w-8" />
          <span className="font-display text-xl font-bold tracking-tight">EverLine</span>
        </div>
        <Link
          href="/login"
          className="rounded-full border border-line px-4 py-2 text-sm font-medium text-paper transition hover:border-amber hover:text-amber"
        >
          Sign In
        </Link>
      </header>

      {/* Hero */}
      <section className="relative isolate mx-auto max-w-6xl px-6 pb-28 pt-16 sm:pt-24">
        <div className="pointer-events-none absolute inset-0 -z-10 grid-backdrop [mask-image:radial-gradient(ellipse_60%_60%_at_50%_20%,black,transparent)]" />
        <GridLines />

        <p className="rise-in font-mono text-xs uppercase tracking-[0.3em] text-cyan">
          20kV Distribution &middot; Central Java
        </p>
        <h1 className="rise-in mt-5 max-w-3xl font-display text-6xl font-black uppercase leading-[0.95] tracking-tight sm:text-8xl" style={{ animationDelay: "80ms" }}>
          See the grid
          <br />
          <span className="text-amber">before it fails.</span>
        </h1>
        <p className="rise-in mt-7 max-w-xl text-lg text-fog" style={{ animationDelay: "160ms" }}>
          A living map of every transformer and line, built from field surveys instead of
          a filing cabinet — so degradation is visible long before it causes an outage.
        </p>

        <div className="rise-in mt-9 flex flex-wrap items-center gap-4" style={{ animationDelay: "240ms" }}>
          <Link
            href="/login"
            className="group relative overflow-hidden rounded-md bg-amber px-6 py-3 font-semibold text-ink transition hover:brightness-110"
          >
            Enter Dashboard
            <span className="ml-2 inline-block transition group-hover:translate-x-1">&rarr;</span>
          </Link>
          <Link
            href="/dashboard"
            className="rounded-md border border-line px-6 py-3 font-medium text-paper transition hover:border-cyan hover:text-cyan"
          >
            View live map
          </Link>
        </div>

        {/* Live stats — real counts from the self-hosted backend, not placeholders */}
        <dl className="rise-in mt-20 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4" style={{ animationDelay: "320ms" }}>
          <Stat label="Transformers" value={transformerCount} />
          <Stat label="Lines" value={lineCount} />
          <Stat label="Assets Tracked" value={assets.length} />
          <Stat label="Need Attention" value={attentionCount} accent={attentionCount > 0 ? "warning" : undefined} />
        </dl>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 pb-28">
        <h2 className="font-display text-3xl font-bold uppercase tracking-tight text-paper sm:text-4xl">
          Built for the field, <span className="text-cyan">not the filing cabinet.</span>
        </h2>
        <div className="mt-12 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-panel p-8 transition hover:bg-panel-raised">
              <h3 className="font-display text-xl font-bold text-paper">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fog">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-6 pb-28">
        <h2 className="font-display text-3xl font-bold uppercase tracking-tight sm:text-4xl">How it works</h2>
        <div className="mt-12 grid gap-8 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.n} className="relative">
              <span className="font-mono text-sm text-cyan">{s.n}</span>
              <h3 className="mt-2 font-display text-xl font-bold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fog">{s.body}</p>
              {i < STEPS.length - 1 && (
                <div className="absolute right-[-1rem] top-2 hidden h-px w-8 bg-line sm:block" />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-line px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-xs text-fog sm:flex-row">
          <p>EverLine — proof of concept. Dummy data only, not connected to any live PLN system.</p>
          <p className="font-mono">v0.1.0</p>
        </div>
      </footer>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "warning";
}) {
  return (
    <div className="bg-panel px-6 py-5">
      <dt className="font-mono text-xs uppercase tracking-wider text-fog">{label}</dt>
      <dd
        className={`mt-1 font-display text-4xl font-bold ${accent === "warning" && value > 0 ? "text-amber" : "text-paper"}`}
      >
        {value}
      </dd>
    </div>
  );
}

/** Decorative schematic transmission line with animated current + pulsing nodes. */
function GridLines() {
  return (
    <svg
      className="pointer-events-none absolute right-[-8%] top-6 -z-10 hidden w-[46rem] opacity-90 sm:block"
      viewBox="0 0 600 220"
      fill="none"
      aria-hidden="true"
    >
      <path d="M0 170 L120 170 L160 90 L260 90 L300 170 L420 170 L460 40 L600 40" stroke="var(--color-line)" strokeWidth="2.5" />
      <path
        d="M0 170 L120 170 L160 90 L260 90 L300 170 L420 170 L460 40 L600 40"
        stroke="var(--color-cyan)"
        strokeWidth="2.5"
        className="current-flow"
        opacity="0.9"
      />
      {[
        [120, 170],
        [260, 90],
        [420, 170],
        [600, 40],
      ].map(([cx, cy], i) => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r="6"
          fill={i === 1 ? "var(--color-amber)" : "var(--color-good)"}
          className="pulse-dot"
          style={{ animationDelay: `${i * 0.4}s` }}
        />
      ))}
    </svg>
  );
}
