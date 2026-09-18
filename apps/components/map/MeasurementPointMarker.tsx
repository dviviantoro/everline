"use client";

import { useRef } from "react";
import L from "leaflet";
import { Marker, Popup } from "react-leaflet";
import type { MeasurementPointListItem } from "@/lib/types";
import { SeverityBadge, SEVERITY_DOT } from "@/components/detail/SeverityBadge";
import { radioSvg } from "./radioIcon";
import { MiniTrendChart } from "./MiniTrendChart";

function radioIcon(color: string, selected: boolean) {
  const size = selected ? 22 : 17;
  return L.divIcon({
    className: "",
    html: radioSvg(color, size),
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export function MeasurementPointMarker({
  point,
  selected,
  onSelect,
}: {
  point: MeasurementPointListItem;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const color = SEVERITY_DOT[point.latest_severity ?? "none"];
  const markerRef = useRef<L.Marker | null>(null);
  const pinned = useRef(false);

  const series = (point.history ?? [])
    .map((h) => Number(h.pd_magnitude))
    .filter((v) => Number.isFinite(v));

  return (
    <Marker
      ref={markerRef}
      position={[point.latitude, point.longitude]}
      icon={radioIcon(color, selected)}
      eventHandlers={{
        mouseover: () => markerRef.current?.openPopup(),
        mouseout: () => {
          if (!pinned.current) markerRef.current?.closePopup();
        },
        click: () => {
          onSelect(point.id);
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
          <p className="text-sm font-semibold">{point.label ?? `Point ${point.sequence_no ?? ""}`}</p>
          <SeverityBadge value={point.latest_severity} />

          <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            <dt className="text-slate-500">Last value of PD magnitude</dt>
            <dd>
              {point.latest_pd_magnitude ?? "—"} {point.latest_pd_unit ?? ""}
            </dd>
            <dt className="text-slate-500">Last value of temperature</dt>
            <dd>{point.latest_temperature_c ?? "—"} °C</dd>
            <dt className="text-slate-500">Last device</dt>
            <dd>{point.latest_pd_device ?? "—"}</dd>
            <dt className="text-slate-500">Last surveyed operator</dt>
            <dd>{point.latest_surveyor ?? "—"}</dd>
            <dt className="text-slate-500">Measured</dt>
            <dd>
              {point.latest_surveyed_at
                ? new Date(point.latest_surveyed_at).toLocaleDateString("en-GB")
                : "—"}
            </dd>
            <dt className="text-slate-500">Position</dt>
            <dd>
              {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}
            </dd>
          </dl>

          {series.length > 1 && (
            <div className="border-t border-slate-200 pt-1">
              <p className="font-semibold text-slate-600">
                PD magnitude trend{point.latest_pd_unit ? ` (${point.latest_pd_unit})` : ""}
              </p>
              <MiniTrendChart values={series} color="#dc2626" />
              <p className="text-slate-500">
                {series.length} readings · min {Math.min(...series)} · max {Math.max(...series)}
              </p>
            </div>
          )}
        </div>
      </Popup>
    </Marker>
  );
}
