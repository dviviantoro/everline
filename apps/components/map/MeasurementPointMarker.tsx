"use client";

import L from "leaflet";
import { Marker, Popup } from "react-leaflet";
import type { MeasurementPointListItem } from "@/lib/types";
import { SeverityBadge, SEVERITY_DOT } from "@/components/detail/SeverityBadge";

// Square, not diamond — visually distinct from pole markers, since a
// measurement point is a different kind of thing (a PD reading location,
// not a support structure).
function squareIcon(color: string, selected: boolean) {
  const size = selected ? 12 : 9;
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;
      background:${color};
      border:1.5px solid #1e293b;
      box-shadow:0 0 0 1px rgba(255,255,255,0.6);
    "></div>`,
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
      icon={squareIcon(color, selected)}
      eventHandlers={{ click: () => onSelect(point.id) }}
    >
      <Popup>
        <div className="space-y-1">
          <p className="font-semibold">{point.label ?? "PD Measurement"}</p>
          <SeverityBadge value={point.latest_severity} />
        </div>
      </Popup>
    </Marker>
  );
}
