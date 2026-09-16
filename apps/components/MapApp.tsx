"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import type { AssetListItem, PdReading, Pole, MeasurementPointListItem } from "@/lib/types";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { AssetDetailPanel } from "@/components/detail/AssetDetailPanel";
import { PoleDetailPanel } from "@/components/detail/PoleDetailPanel";
import { MeasurementPointDetailPanel } from "@/components/detail/MeasurementPointDetailPanel";
import { AddAssetForm } from "@/components/forms/AddAssetForm";
import { useTheme } from "@/lib/useTheme";
import { apiFetch } from "@/lib/api";

const MapView = dynamic(() => import("@/components/map/MapView").then((m) => m.MapView), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
      Loading map…
    </div>
  ),
});

export function MapApp({
  initialAssets,
  initialPoles,
  initialMeasurementPoints,
}: {
  initialAssets: AssetListItem[];
  initialPoles: Pole[];
  initialMeasurementPoints: MeasurementPointListItem[];
}) {
  const [assets, setAssets] = useState(initialAssets);
  const [poles, setPoles] = useState(initialPoles);
  const [measurementPoints, setMeasurementPoints] = useState(initialMeasurementPoints);
  const [layers, setLayers] = useState({
    showTransformers: true,
    showLines: true,
    showPoles: true,
    showMeasurementPoints: true,
  });
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [selectedPoleId, setSelectedPoleId] = useState<string | null>(null);
  const [selectedMeasurementPointId, setSelectedMeasurementPointId] = useState<string | null>(null);
  const [highlightedPoints, setHighlightedPoints] = useState<Omit<PdReading, "survey_id">[] | null>(null);
  const [addAssetOpen, setAddAssetOpen] = useState(false);
  const [theme, setTheme] = useTheme();

  const refreshAssets = useCallback(async () => {
    const [assetsRes, polesRes, pointsRes] = await Promise.all([
      apiFetch("/api/assets"),
      apiFetch("/api/poles"),
      apiFetch("/api/measurement-points"),
    ]);
    const assetsPayload = await assetsRes.json();
    const polesPayload = await polesRes.json();
    const pointsPayload = await pointsRes.json();
    if (assetsRes.ok) setAssets(assetsPayload.data);
    if (polesRes.ok) setPoles(polesPayload.data);
    if (pointsRes.ok) setMeasurementPoints(pointsPayload.data);
  }, []);

  function selectAsset(id: string) {
    setSelectedPoleId(null);
    setSelectedMeasurementPointId(null);
    setSelectedAssetId(id);
  }

  function selectPole(id: string) {
    setSelectedAssetId(null);
    setSelectedMeasurementPointId(null);
    setHighlightedPoints(null);
    setSelectedPoleId(id);
  }

  function selectMeasurementPoint(id: string) {
    setSelectedAssetId(null);
    setSelectedPoleId(null);
    setHighlightedPoints(null);
    setSelectedMeasurementPointId(id);
  }

  return (
    <div className={`${theme === "dark" ? "dark" : ""} flex h-screen overflow-hidden bg-slate-50 font-body text-slate-800 dark:bg-slate-950 dark:text-slate-100`}>
      <DashboardSidebar
        layers={layers}
        onLayersChange={setLayers}
        onAddAsset={() => setAddAssetOpen(true)}
        theme={theme}
        onThemeChange={setTheme}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
          <h1 className="font-display text-base font-bold tracking-tight text-slate-800 dark:text-slate-100">Network Map</h1>
        </header>

        <div className="relative flex flex-1 overflow-hidden">
          <div className="flex-1">
            <MapView
              assets={assets}
              poles={poles}
              measurementPoints={measurementPoints}
              showTransformers={layers.showTransformers}
              showLines={layers.showLines}
              showPoles={layers.showPoles}
              showMeasurementPoints={layers.showMeasurementPoints}
              selectedAssetId={selectedAssetId}
              selectedPoleId={selectedPoleId}
              selectedMeasurementPointId={selectedMeasurementPointId}
              highlightedPoints={highlightedPoints}
              onSelectAsset={selectAsset}
              onSelectPole={selectPole}
              onSelectMeasurementPoint={selectMeasurementPoint}
            />
          </div>

          {selectedAssetId && (
            <AssetDetailPanel
              key={selectedAssetId}
              assetId={selectedAssetId}
              onClose={() => {
                setSelectedAssetId(null);
                setHighlightedPoints(null);
              }}
              onSurveyAdded={refreshAssets}
              onLatestPointsChange={setHighlightedPoints}
            />
          )}

          {selectedPoleId && (
            <PoleDetailPanel key={selectedPoleId} poleId={selectedPoleId} onClose={() => setSelectedPoleId(null)} />
          )}

          {selectedMeasurementPointId && (
            <MeasurementPointDetailPanel
              key={selectedMeasurementPointId}
              pointId={selectedMeasurementPointId}
              onClose={() => setSelectedMeasurementPointId(null)}
            />
          )}

          {addAssetOpen && (
            // Leaflet's own controls (.leaflet-top/.leaflet-bottom) sit at z-index:1000
            // and, since the map container establishes no stacking context of its own,
            // that escapes into this shared context and paints over anything here with
            // the default z-index:auto — silently burying this overlay under the map
            // with no console error. z-[1100] clears it with margin.
            <div className="absolute inset-0 z-[1100] flex items-center justify-center bg-black/30 p-4">
              <div className="max-h-full w-full max-w-md overflow-y-auto rounded bg-white p-4 shadow-lg dark:bg-slate-900 dark:text-slate-100">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-base font-semibold">Add Asset</h2>
                </div>
                <AddAssetForm
                  onCancel={() => setAddAssetOpen(false)}
                  onSuccess={() => {
                    setAddAssetOpen(false);
                    refreshAssets();
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
