"use client";

import { useState } from "react";

export function GpsCaptureButton({
  onCapture,
}: {
  onCapture: (lat: number, lng: number) => void;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  function capture() {
    if (!navigator.geolocation) {
      setStatus("error");
      return;
    }
    setStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onCapture(pos.coords.latitude, pos.coords.longitude);
        setStatus("idle");
      },
      () => setStatus("error"),
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  }

  return (
    <button
      type="button"
      onClick={capture}
      className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
    >
      {status === "loading" ? "Locating…" : status === "error" ? "GPS failed — retry" : "Use my location"}
    </button>
  );
}
