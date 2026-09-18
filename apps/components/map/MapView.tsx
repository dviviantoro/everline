"use client";

import { MapContainer, TileLayer, Polyline } from "react-leaflet";
import type { AssetListItem, PdReading, Pole, MeasurementPointListItem } from "@/lib/types";
import { AssetMarker } from "./AssetMarker";
import { PoleMarker } from "./PoleMarker";
import { MeasurementPointMarker } from "./MeasurementPointMarker";
import { PDPointMarker } from "./PDPointMarker";
import { SEVERITY_DOT } from "@/components/detail/SeverityBadge";
import { routeToLatLngs, DEFAULT_CENTER, DEFAULT_ZOOM, CENTRAL_JAVA_BOUNDS, MIN_ZOOM } from "@/lib/geo";

export function MapView({
  assets,
  poles,
  measurementPoints,
  showTransformers,
  showLines,
  showPoles,
  showMeasurementPoints,
  selectedAssetId,
  selectedPoleId,
  selectedMeasurementPointId,
  highlightedPoints,
  onSelectAsset,
  onSelectPole,
  onSelectMeasurementPoint,
}: {
  assets: AssetListItem[];
  poles: Pole[];
  measurementPoints: MeasurementPointListItem[];
  showTransformers: boolean;
  showLines: boolean;
  showPoles: boolean;
  showMeasurementPoints: boolean;
  selectedAssetId: string | null;
  selectedPoleId: string | null;
  selectedMeasurementPointId: string | null;
  highlightedPoints: Omit<PdReading, "survey_id">[] | null;
  onSelectAsset: (id: string) => void;
  onSelectPole: (id: string) => void;
  onSelectMeasurementPoint: (id: string) => void;
}) {
  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      minZoom={MIN_ZOOM}
      maxBounds={CENTRAL_JAVA_BOUNDS}
      maxBoundsViscosity={1}
      className="h-full w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {/* Lines are drawn before transformer markers so a marker sitting close to a
          route is always the one that receives the click — SVG layers added later
          sit on top and win hit-testing on overlap. Poles/measurement points use
          Leaflet's marker pane (always above the overlay pane lines/circles live
          in), so they're never shadowed by a line regardless of draw order. */}
      {showLines &&
        assets
          .filter((a) => a.type === "line")
          .map((asset) => (
            <Polyline
              key={asset.id}
              positions={routeToLatLngs(asset.route_geometry)}
              pathOptions={{
                color: SEVERITY_DOT[asset.latest_severity ?? "none"],
                weight: asset.id === selectedAssetId ? 5 : 3,
              }}
              eventHandlers={{ click: () => onSelectAsset(asset.id) }}
            />
          ))}

      {showPoles &&
        poles.map((pole) => (
          <PoleMarker key={pole.id} pole={pole} selected={pole.id === selectedPoleId} onSelect={onSelectPole} />
        ))}

      {showMeasurementPoints &&
        measurementPoints.map((point) => (
          <MeasurementPointMarker
            key={point.id}
            point={point}
            selected={point.id === selectedMeasurementPointId}
            onSelect={onSelectMeasurementPoint}
          />
        ))}

      {showTransformers &&
        assets
          .filter((a) => a.type === "transformer")
          .map((asset) => (
            <AssetMarker
              key={asset.id}
              asset={asset}
              selected={asset.id === selectedAssetId}
              onSelect={onSelectAsset}
            />
          ))}

      {highlightedPoints?.map((point, i) => (
        <PDPointMarker key={`${point.latitude}-${point.longitude}-${i}`} point={point} />
      ))}
    </MapContainer>
  );
}
