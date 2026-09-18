"use client";

import { useRef } from "react";
import L from "leaflet";
import { Marker, Popup } from "react-leaflet";
import type { AssetListItem } from "@/lib/types";
import { SeverityBadge, SEVERITY_DOT } from "@/components/detail/SeverityBadge";
import { MiniTrendChart } from "./MiniTrendChart";

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
  const markerRef = useRef<L.Marker | null>(null);
  const pinned = useRef(false);

  if (asset.latitude == null || asset.longitude == null) return null;
  const color = SEVERITY_DOT[asset.latest_condition ?? "none"];

  const series = (asset.history ?? [])
    .map((h) => Number(h.load_percent))
    .filter((v) => Number.isFinite(v));

  return (
    <Marker
      ref={markerRef}
      position={[asset.latitude, asset.longitude]}
      icon={rectangleIcon(color, selected)}
      eventHandlers={{
        mouseover: () => markerRef.current?.openPopup(),
        mouseout: () => {
          if (!pinned.current) markerRef.current?.closePopup();
        },
        click: () => {
          onSelect(asset.id);
          // Leaflet's own bindPopup click handler toggles the popup, which would
          // dismiss the one hover just opened. Pin and re-open once it settles.
          setTimeout(() => {
            pinned.current = true;
            markerRef.current?.openPopup();
          }, 0);
        },
        popupclose: () => {
          pinned.current = false;
        },
      }}
    >
      <Popup autoClose={false} closeOnClick={false} minWidth={248} maxWidth={248}>
        <div className="space-y-1 text-xs">
          <p className="text-sm font-semibold">{asset.name ?? asset.code}</p>
          <p className="text-slate-500">Transformer · {asset.code}</p>
          <SeverityBadge value={asset.latest_condition} />

          <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            <dt className="text-slate-500">Rated capacity</dt>
            <dd>{asset.rated_capacity_kva ?? "—"} kVA</dd>
            <dt className="text-slate-500">Load</dt>
            <dd>{asset.latest_load_percent ?? "—"} %</dd>
            <dt className="text-slate-500">Oil temp</dt>
            <dd>{asset.latest_oil_temp_c ?? "—"} °C</dd>
            <dt className="text-slate-500">Secondary</dt>
            <dd>{asset.latest_voltage_secondary_v ?? "—"} V</dd>
            <dt className="text-slate-500">Last survey</dt>
            <dd>
              {asset.last_surveyed_at
                ? new Date(asset.last_surveyed_at).toLocaleDateString("en-GB")
                : "—"}
            </dd>
          </dl>

          {series.length > 1 && (
            <div className="border-t border-slate-200 pt-1">
              <p className="font-semibold text-slate-600">Load trend (%)</p>
              <MiniTrendChart values={series} color="#2563eb" />
              <p className="text-slate-500">
                {series.length} surveys · min {Math.min(...series)} · max {Math.max(...series)}
              </p>
            </div>
          )}
        </div>
      </Popup>
    </Marker>
  );
}
