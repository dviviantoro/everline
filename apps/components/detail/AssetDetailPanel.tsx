"use client";

import { useEffect, useState } from "react";
import type { AssetDetail, PdReading } from "@/lib/types";
import { worstSeverity } from "@/lib/severity";
import { SeverityBadge } from "./SeverityBadge";
import { NameplateSection } from "./NameplateSection";
import { TelemetryPanel } from "./TelemetryPanel";
import { LinePointsPanel } from "./LinePointsPanel";
import { CollapsibleSection } from "./CollapsibleSection";
import { apiFetch } from "@/lib/api";

export function AssetDetailPanel({
  assetId,
  onClose,
  onLatestPointsChange,
}: {
  assetId: string;
  onClose: () => void;
  onLatestPointsChange: (points: Omit<PdReading, "survey_id">[] | null) => void;
}) {
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // No setState before the first await, so effect-mount fetches (below) never
  // call setState synchronously from the effect body.
  async function fetchDetail() {
    const res = await apiFetch(`/api/assets/${assetId}`);
    const payload = await res.json();
    setDetail(res.ok ? payload.data : null);
    setLoading(false);

    if (res.ok && payload.data.type === "line") {
      onLatestPointsChange(payload.data.surveys[0]?.points ?? null);
    } else {
      onLatestPointsChange(null);
    }
  }

  useEffect(() => {
    // fetchDetail only sets state after its first await; the rule below can't see past that.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto border-l border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:w-96">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{detail?.name ?? detail?.code ?? "Loading…"}</h2>
          {detail && <p className="text-xs text-slate-500 dark:text-slate-400">{detail.code}</p>}
        </div>
        <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100">
          Close
        </button>
      </div>

      {loading && <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Loading…</p>}

      {/* Neither asset type has a manual entry path: transformer telemetry
          arrives from its meter and PD readings from the survey device, so this
          panel is read-only for both. */}
      {detail && (
        <>
          <div className="mt-4">
            {detail.type === "transformer" ? (
              <SeverityBadge value={detail.surveys[0]?.reading?.condition} />
            ) : (
              <SeverityBadge value={worstSeverity((detail.surveys[0]?.points ?? []).map((p) => p.severity))} />
            )}
          </div>

          {detail.type === "transformer" && (
            <>
              <CollapsibleSection title="Nameplate">
                <NameplateSection asset={detail} />
              </CollapsibleSection>
              <CollapsibleSection title="Live Telemetry">
                <TelemetryPanel assetId={detail.id} latitude={detail.latitude} longitude={detail.longitude} />
              </CollapsibleSection>
            </>
          )}

          {detail.type === "line" && (
            <CollapsibleSection title="Point Measurements">
              <LinePointsPanel assetId={detail.id} />
            </CollapsibleSection>
          )}
        </>
      )}
    </aside>
  );
}
