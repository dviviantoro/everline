"use client";

import L from "leaflet";
import { Marker, Popup } from "react-leaflet";
import type { Pole } from "@/lib/types";

const POLE_COLOR = "#94a3b8"; // slate-400 — poles carry no measurement, so no severity color

function diamondIcon(selected: boolean) {
  const size = selected ? 14 : 11;
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;
      background:${POLE_COLOR};
      border:1.5px solid #1e293b;
      transform:rotate(45deg);
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
      icon={diamondIcon(selected)}
      eventHandlers={{ click: () => onSelect(pole.id) }}
    >
      <Popup>
        <div className="space-y-1">
          <p className="font-semibold">{pole.label ?? "Pole"}</p>
          <p className="text-xs text-slate-500">Pole/tiang — no measurement recorded here</p>
        </div>
      </Popup>
    </Marker>
  );
}
