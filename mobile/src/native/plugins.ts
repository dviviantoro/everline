/**
 * The three Android plugins as TypeScript sees them (`android/app/src/main/java/.../plugins`).
 * The adapters take these as arguments, so tests pass fakes and nothing here runs until
 * `registerNativePlugins()` is called at startup.
 */
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface HotspotAssistantNative {
  isOn(): Promise<{ on: boolean; iface?: string; address?: string; prefix?: number }>;
  /** `exact` is false when only a general network settings screen could be opened. */
  openSettings(): Promise<{ index: number; label: string; exact: boolean }>;
}

export interface LinkStateEvent {
  state: 'up' | 'lost';
  detail?: string;
}

/** One whole frame that arrived on the held link, as the bytes it was. Emitted only while someone listens for `frame`. */
export interface FrameEvent {
  dataB64: string;
}

/** The events the Cantol link plugin emits, by name. */
export interface LinkNativeEvents {
  linkState: LinkStateEvent;
  frame: FrameEvent;
}

/** The held link's health, as the plugin reports it. */
export interface LinkStatus {
  connected: boolean;
  host?: string;
  /** Milliseconds since a frame last arrived, or -1 if none has. */
  lastRxAgeMs?: number;
  rttMs?: number;
}

export interface CantolLinkNative {
  /** Hosts on the hotspot subnet that accept a TCP connection on `port`; `subnet` is absent when no hotspot was found. */
  scan(options: { port: number; connectTimeoutMs?: number }): Promise<{ subnet?: string; scanned: number; hosts: string[] }>;
  /** One UDP datagram, or `timedOut`. */
  listenBeacon(options: { port: number; timeoutMs?: number }): Promise<{ from?: string; dataB64?: string; timedOut?: boolean }>;
  /** Sends one frame and returns the first whole frame back. Rejects with code `timeout`, `refused` or `io`. */
  exchange(options: {
    host: string;
    port: number;
    dataB64: string;
    connectTimeoutMs?: number;
    readTimeoutMs?: number;
  }): Promise<{ replyB64: string; rttMs: number }>;
  connect(options: {
    host: string;
    port: number;
    heartbeatB64: string;
    intervalMs?: number;
    connectTimeoutMs?: number;
  }): Promise<{ rttMs: number }>;
  /** Writes one frame, built by the app (Start, Stop), on the held link. Rejects with code `not_connected` or `io`. */
  send(options: { dataB64: string }): Promise<void>;
  disconnect(): Promise<void>;
  linkStatus(): Promise<LinkStatus>;
  getLastKnown(): Promise<{ address?: string }>;
  setLastKnown(options: { address?: string }): Promise<void>;
  diagnostics(): Promise<{ rows: { label: string; value: string }[] }>;
  addListener<E extends keyof LinkNativeEvents>(eventName: E, listener: (event: LinkNativeEvents[E]) => void): Promise<PluginListenerHandle>;
}

export interface GnssHelperNative {
  servicesEnabled(): Promise<{ enabled: boolean }>;
  /** Whether each location permission is granted; unlike the geolocation plugin, this works with location off. */
  permissionState(): Promise<{ fine: boolean; coarse: boolean }>;
  openLocationSettings(): Promise<void>;
  openAppSettings(): Promise<void>;
}

export interface NativePlugins {
  hotspot: HotspotAssistantNative;
  link: CantolLinkNative;
  gnss: GnssHelperNative;
}

export function registerNativePlugins(): NativePlugins {
  return {
    hotspot: registerPlugin<HotspotAssistantNative>('HotspotAssistant'),
    link: registerPlugin<CantolLinkNative>('CantolLink'),
    gnss: registerPlugin<GnssHelperNative>('GnssHelper'),
  };
}
