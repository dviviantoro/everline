import { apiFetch } from "@/lib/api";
import type { AssetListItem, Pole } from "@/lib/types";
import { StubPageShell } from "@/components/StubPageShell";

export const dynamic = "force-dynamic";

export default async function RegistryPage() {
  const [assetsRes, polesRes] = await Promise.all([
    apiFetch("/api/assets", { cache: "no-store" }),
    apiFetch("/api/poles", { cache: "no-store" }),
  ]);
  const [assets, poles]: [AssetListItem[], Pole[]] = await Promise.all([
    assetsRes.json().then((p) => p.data),
    polesRes.json().then((p) => p.data),
  ]);

  return (
    <StubPageShell title="Asset Registry">
      <div className="space-y-8">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
            Transformers &amp; Power Lines ({assets.length})
          </h2>
          <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {assets.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2 font-mono text-xs">{a.code}</td>
                    <td className="px-3 py-2">{a.name ?? "—"}</td>
                    <td className="px-3 py-2 capitalize">{a.type}</td>
                    <td className="px-3 py-2 capitalize">{a.latest_condition ?? a.latest_severity ?? "no data yet"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">Poles / Tiang ({poles.length})</h2>
          <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2">Label</th>
                  <th className="px-3 py-2">Latitude</th>
                  <th className="px-3 py-2">Longitude</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {poles.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2">{p.label ?? "—"}</td>
                    <td className="px-3 py-2">{p.latitude.toFixed(5)}</td>
                    <td className="px-3 py-2">{p.longitude.toFixed(5)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </StubPageShell>
  );
}
