"use client";

import { CircleMarker, Popup } from "react-leaflet";
import type { AssetListItem } from "@/lib/types";
import { SeverityBadge, SEVERITY_DOT } from "@/components/detail/SeverityBadge";

export function AssetMarker({
  asset,
  selected,
  onSelect,
}: {
  asset: AssetListItem;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  if (asset.latitude == null || asset.longitude == null) return null;
  const color = SEVERITY_DOT[asset.latest_condition ?? "none"];

  return (
    <CircleMarker
      center={[asset.latitude, asset.longitude]}
      radius={selected ? 10 : 8}
      pathOptions={{ color: "#1e293b", weight: selected ? 3 : 1.5, fillColor: color, fillOpacity: 0.9 }}
      eventHandlers={{ click: () => onSelect(asset.id) }}
    >
      <Popup>
        <div className="space-y-1">
          <p className="font-semibold">{asset.name ?? asset.code}</p>
          <p className="text-xs text-slate-500">{asset.code}</p>
          <SeverityBadge value={asset.latest_condition} />
        </div>
      </Popup>
    </CircleMarker>
  );
}
