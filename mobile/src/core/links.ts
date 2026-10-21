/**
 * The seams between the screens and everything outside the WebView.
 *
 * Screens depend only on these interfaces. The demo build supplies simulated implementations
 * (`src/demo`); TASK-005 to TASK-007 add the real ones (Kotlin plugins over raw sockets, the
 * hotspot intents, the location services, the HTTP API) behind the same shapes. Nothing here
 * knows which one it is talking to.
 */
import type { SurveyPayload } from './model';
import type { GpsFix, LineAssetWithPoles, MeasurementPoint } from './types';

export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------------------------
// Hotspot

/** What the setup card shows. The real values come from the gitignored device profile (ADR-003). */
export interface HotspotProfile {
  ssid: string;
  band: string;
  /** Shown to the operator and copied on request. Never sent anywhere or logged. */
  password: string;
}

export interface HotspotAssistant {
  profile(): HotspotProfile;
  /** Best effort: an up AP-style interface with a site-local IPv4 (ADR-003 strategy S0). */
  isOn(): Promise<boolean>;
  /** Walks the ordered intent table to the system hotspot settings (ADR-003 strategy S3). */
  openSettings(): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// Cantol

export interface CantolCandidate {
  address: string;
  deviceId: string;
}

export interface PingResult {
  rttMs: number;
  deviceId: string;
  protocol: number;
}

/** `down` before connect, `up` while data flows, `lost` after an unplanned drop. */
export type LinkState = 'down' | 'up' | 'lost';

/** One discharge pulse, with the fields of `PdEvent` in `cantol-proto/src/msg.rs` (amplitude calibrated to dBmV). */
export interface PdEventSample {
  /** Microseconds since the batch start. */
  tUs: number;
  ampDbmV: number;
  /** 0..65535 maps to 0..360 degrees of the mains cycle. */
  phase: number;
  widthNs: number;
  /** 0 positive half-cycle, 1 negative. */
  polarity: 0 | 1;
}

/** The fields of `Status` in `cantol-proto/src/msg.rs`, with the noise floor calibrated to dBmV. */
export interface CantolStatus {
  tempC: number;
  adcClipPct: number;
  noiseFloorDbmV: number;
  triggerRateHz: number;
  queue: number;
  /** `STATUS_MAINS_LOCK`: without it the phase of an event means nothing. */
  mainsLock: boolean;
}

export interface CantolHandlers {
  onEvents(events: readonly PdEventSample[]): void;
  onStatus(status: CantolStatus): void;
  onLinkState(state: LinkState): void;
}

export interface DiagnosticRow {
  label: string;
  value: string;
}

export interface CantolLink {
  /**
   * Resolves with the first candidate found (last known address, UDP beacon, /24 scan, or the
   * manual address). Rejects with an AbortError when `signal` aborts.
   */
  discover(options: { manualAddress?: string; signal: AbortSignal }): Promise<CantolCandidate>;
  /** TCP connect plus HELLO/PONG: protocol version, device id and the median RTT of three. */
  ping(candidate: CantolCandidate, signal: AbortSignal): Promise<PingResult>;
  connect(candidate: CantolCandidate): Promise<void>;
  disconnect(): Promise<void>;
  /** Sends the Start frame; events and status then arrive through `subscribe`. */
  startStream(): Promise<void>;
  stopStream(): Promise<void>;
  subscribe(handlers: CantolHandlers): Unsubscribe;
  /** Plain facts for the Diagnostics screen. */
  diagnostics(): Promise<DiagnosticRow[]>;
}

// ---------------------------------------------------------------------------------------------
// Location

export type LocationPermission = 'unknown' | 'granted' | 'denied' | 'denied_permanently';

export interface Gnss {
  permission(): Promise<LocationPermission>;
  requestPermission(): Promise<LocationPermission>;
  servicesEnabled(): Promise<boolean>;
  /** Asks the system to turn location services on (Play Services dialog, settings fallback). */
  ensureServicesOn(): Promise<boolean>;
  openAppSettings(): Promise<void>;
  watch(onFix: (fix: GpsFix) => void): Unsubscribe;
}

// ---------------------------------------------------------------------------------------------
// Survey API

export interface UploadResult {
  status: number;
  surveyId: string | null;
  message: string | null;
}

export interface SurveyApi {
  /** `GET /api/assets?type=line`, with each span's two poles. */
  listLineAssets(): Promise<LineAssetWithPoles[]>;
  /** `GET /api/assets/{id}/measurement-points`. */
  listMeasurementPoints(assetId: string): Promise<MeasurementPoint[]>;
  /** `POST /api/assets/{id}/pd-surveys`. Resolves with the HTTP status; rejects only when no response arrived. */
  uploadSurvey(assetId: string, body: SurveyPayload): Promise<UploadResult>;
}
