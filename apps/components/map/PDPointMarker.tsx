"use client";

import { CircleMarker, Popup } from "react-leaflet";
import type { PdReading } from "@/lib/types";
import { SEVERITY_DOT } from "@/components/detail/SeverityBadge";

export function PDPointMarker({ point }: { point: Omit<PdReading, "survey_id"> }) {
  const color = SEVERITY_DOT[point.severity ?? "none"];
  return (
    <CircleMarker
      center={[point.latitude, point.longitude]}
      radius={5}
      pathOptions={{ color: "#1e293b", weight: 1, fillColor: color, fillOpacity: 0.9 }}
    >
      <Popup>
        <div className="space-y-1 text-xs">
          <p className="font-semibold">{point.point_label ?? `Point ${point.sequence_no ?? ""}`}</p>
          {point.pd_magnitude != null && (
            <p>
              PD: {point.pd_magnitude} {point.pd_unit ?? ""}
            </p>
          )}
          {point.temperature_c != null && <p>Temp: {point.temperature_c} °C</p>}
        </div>
      </Popup>
    </CircleMarker>
  );
}
