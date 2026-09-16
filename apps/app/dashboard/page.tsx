import { apiFetch } from "@/lib/api";
import type { AssetListItem, MeasurementPointListItem, Pole } from "@/lib/types";
import { MapApp } from "@/components/MapApp";

// Asset data changes with every survey/registration — always fetch fresh
// from the backend rather than serving a build-time or cached snapshot.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [assetsRes, polesRes, pointsRes] = await Promise.all([
    apiFetch("/api/assets", { cache: "no-store" }),
    apiFetch("/api/poles", { cache: "no-store" }),
    apiFetch("/api/measurement-points", { cache: "no-store" }),
  ]);
  const [assets, poles, measurementPoints]: [AssetListItem[], Pole[], MeasurementPointListItem[]] = await Promise.all([
    assetsRes.json().then((p) => p.data),
    polesRes.json().then((p) => p.data),
    pointsRes.json().then((p) => p.data),
  ]);

  return <MapApp initialAssets={assets} initialPoles={poles} initialMeasurementPoints={measurementPoints} />;
}
