"use client";

import L from "leaflet";
import { Marker, Popup, Tooltip } from "react-leaflet";
import type { AssetListItem } from "@/lib/types";
import { SeverityBadge, SEVERITY_DOT } from "@/components/detail/SeverityBadge";

// Rectangle — the shape that distinguishes a transformer from a pole (circle)
// and a PD measurement point (radio disc) at a glance.
function rectangleIcon(color: string, selected: boolean) {
  const width = selected ? 20 : 16;
  const height = selected ? 14 : 11;
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${width}px;height:${height}px;
      background:${color};
      border:${selected ? 3 : 1.5}px solid #1e293b;
      box-shadow:0 0 0 1px rgba(255,255,255,0.6);
    "></div>`,
    iconSize: [width, height],
    iconAnchor: [width / 2, height / 2],
  });
}

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
    <Marker
      position={[asset.latitude, asset.longitude]}
      icon={rectangleIcon(color, selected)}
      eventHandlers={{ click: () => onSelect(asset.id) }}
    >
      <Tooltip direction="top" offset={[0, -8]} opacity={1}>
        <div className="space-y-0.5">
          <p className="font-semibold">{asset.name ?? asset.code}</p>
          <p className="text-slate-500">Transformer · {asset.code}</p>
          {asset.rated_capacity_kva != null && <p>{asset.rated_capacity_kva} kVA</p>}
          <p>Condition: {asset.latest_condition ?? "no data yet"}</p>
          {asset.latest_load_percent != null && <p>Load: {asset.latest_load_percent} %</p>}
          {asset.latest_oil_temp_c != null && <p>Oil temp: {asset.latest_oil_temp_c} °C</p>}
          {asset.latest_voltage_secondary_v != null && (
            <p>Secondary: {asset.latest_voltage_secondary_v} V</p>
          )}
          {asset.last_surveyed_at && (
            <p>Last survey: {new Date(asset.last_surveyed_at).toLocaleDateString("en-GB")}</p>
          )}
        </div>
      </Tooltip>

      <Popup>
        <div className="space-y-1">
          <p className="font-semibold">{asset.name ?? asset.code}</p>
          <p className="text-xs text-slate-500">{asset.code}</p>
          <SeverityBadge value={asset.latest_condition} />
        </div>
      </Popup>
    </Marker>
  );
}
