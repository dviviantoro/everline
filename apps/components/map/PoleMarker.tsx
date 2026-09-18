"use client";

import L from "leaflet";
import { Marker, Popup, Tooltip } from "react-leaflet";
import type { Pole } from "@/lib/types";

const POLE_COLOR = "#94a3b8"; // slate-400 — poles carry no measurement, so no severity color

function circleIcon(selected: boolean) {
  const size = selected ? 14 : 11;
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;
      background:${POLE_COLOR};
      border:${selected ? 3 : 1.5}px solid #1e293b;
      border-radius:50%;
      box-shadow:0 0 0 1px rgba(255,255,255,0.6);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export function PoleMarker({
  pole,
  selected,
  onSelect,
}: {
  pole: Pole;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <Marker
      position={[pole.latitude, pole.longitude]}
      icon={circleIcon(selected)}
      eventHandlers={{ click: () => onSelect(pole.id) }}
    >
      <Tooltip direction="top" offset={[0, -8]} opacity={1}>
        <div className="space-y-0.5">
          <p className="font-semibold">{pole.label ?? "Pole"}</p>
          <p className="text-slate-500">Pole / tiang — no measurement recorded here</p>
          <p>
            {pole.latitude.toFixed(5)}, {pole.longitude.toFixed(5)}
          </p>
        </div>
      </Tooltip>

      <Popup>
        <div className="space-y-1">
          <p className="font-semibold">{pole.label ?? "Pole"}</p>
          <p className="text-xs text-slate-500">Pole/tiang — no measurement recorded here</p>
        </div>
      </Popup>
    </Marker>
  );
}
