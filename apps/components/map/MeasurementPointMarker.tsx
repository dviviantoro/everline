"use client";

import L from "leaflet";
import { Marker, Popup, Tooltip } from "react-leaflet";
import type { MeasurementPointListItem } from "@/lib/types";
import { SeverityBadge, SEVERITY_DOT } from "@/components/detail/SeverityBadge";
import { radioSvg } from "./radioIcon";

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

  return (
    <Marker
      position={[point.latitude, point.longitude]}
      icon={radioIcon(color, selected)}
      eventHandlers={{ click: () => onSelect(point.id) }}
    >
      <Tooltip direction="top" offset={[0, -10]} opacity={1}>
        <div className="space-y-0.5">
          <p className="font-semibold">{point.label ?? `Point ${point.sequence_no ?? ""}`}</p>
          <p className="text-slate-500">PD measurement point</p>
          <p>Severity: {point.latest_severity ?? "no reading yet"}</p>
          {point.latest_pd_magnitude != null && (
            <p>
              PD magnitude: {point.latest_pd_magnitude} {point.latest_pd_unit ?? ""}
            </p>
          )}
          {point.latest_temperature_c != null && <p>Temperature: {point.latest_temperature_c} °C</p>}
          {point.latest_pd_device && <p>Device: {point.latest_pd_device}</p>}
          {point.latest_surveyed_at && (
            <p>Measured: {new Date(point.latest_surveyed_at).toLocaleDateString("en-GB")}</p>
          )}
          <p>
            {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}
          </p>
        </div>
      </Tooltip>

      <Popup>
        <div className="space-y-1">
          <p className="font-semibold">{point.label ?? "PD Measurement"}</p>
          <SeverityBadge value={point.latest_severity} />
        </div>
      </Popup>
    </Marker>
  );
}
