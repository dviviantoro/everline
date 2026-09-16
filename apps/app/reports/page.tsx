import Link from "next/link";
import { apiFetch } from "@/lib/api";
import type { AssetListItem } from "@/lib/types";
import { StubPageShell } from "@/components/StubPageShell";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const assetsRes = await apiFetch("/api/assets", { cache: "no-store" });
  const assets: AssetListItem[] = await assetsRes.json().then((p) => p.data);
  const transformers = assets.filter((a) => a.type === "transformer");
  const lines = assets.filter((a) => a.type === "line");

  return (
    <StubPageShell title="Reports">
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
        CSV export lives on each asset&apos;s detail panel (telemetry for transformers, reading history for PD
        measurement points). Open an asset on the map to export its data.
      </p>

      <div className="grid gap-6 sm:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
            Transformers ({transformers.length})
          </h2>
          <ul className="divide-y divide-slate-100 rounded border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {transformers.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{a.name ?? a.code}</span>
                <Link href="/dashboard" className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100">
                  Open in map →
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">Power Lines ({lines.length})</h2>
          <ul className="divide-y divide-slate-100 rounded border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {lines.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{a.name ?? a.code}</span>
                <Link href="/dashboard" className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100">
                  Open in map →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </StubPageShell>
  );
}
