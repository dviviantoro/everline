"use client";

import { useEffect, useState } from "react";
import type { AssetDetail, PdReading } from "@/lib/types";
import { worstSeverity } from "@/lib/severity";
import { SeverityBadge } from "./SeverityBadge";
import { SurveyHistoryTimeline } from "./SurveyHistoryTimeline";
import { NameplateSection } from "./NameplateSection";
import { TelemetryPanel } from "./TelemetryPanel";
import { LinePointsPanel } from "./LinePointsPanel";
import { CollapsibleSection } from "./CollapsibleSection";
import { TransformerSurveyForm } from "@/components/forms/TransformerSurveyForm";
import { LinePdSurveyForm } from "@/components/forms/LinePdSurveyForm";
import { apiFetch } from "@/lib/api";

export function AssetDetailPanel({
  assetId,
  onClose,
  onSurveyAdded,
  onLatestPointsChange,
}: {
  assetId: string;
  onClose: () => void;
  onSurveyAdded: () => void;
  onLatestPointsChange: (points: Omit<PdReading, "survey_id">[] | null) => void;
}) {
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

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

  // Used by the "Add Survey" success handlers to explicitly show a loading
  // state while refetching after a mutation (not called from the effect).
  function reload() {
    setLoading(true);
    fetchDetail();
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

          <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            <button
              onClick={() => setFormOpen((v) => !v)}
              className="w-full rounded bg-slate-800 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
            >
              {formOpen ? "Cancel" : "Add Survey"}
            </button>
          </div>

          {formOpen && (
            <div className="mt-3 rounded border border-slate-200 p-3 dark:border-slate-800">
              {detail.type === "transformer" ? (
                <TransformerSurveyForm
                  assetId={detail.id}
                  onCancel={() => setFormOpen(false)}
                  onSuccess={() => {
                    setFormOpen(false);
                    reload();
                    onSurveyAdded();
                  }}
                />
              ) : (
                <LinePdSurveyForm
                  assetId={detail.id}
                  onCancel={() => setFormOpen(false)}
                  onSuccess={() => {
                    setFormOpen(false);
                    reload();
                    onSurveyAdded();
                  }}
                />
              )}
            </div>
          )}

          {detail.type === "line" && (
            <CollapsibleSection title="Point Measurements">
              <LinePointsPanel assetId={detail.id} />
            </CollapsibleSection>
          )}

          <CollapsibleSection title="Survey History">
            <SurveyHistoryTimeline
              surveys={detail.surveys}
              type={detail.type}
              assetPosition={{ latitude: detail.latitude, longitude: detail.longitude }}
            />
          </CollapsibleSection>
        </>
      )}
    </aside>
  );
}
