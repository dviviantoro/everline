/**
 * Simulated Cantol. It exposes the fields the real protocol will (`cantol-proto/src/msg.rs`):
 * a HELLO/PONG answer (protocol, device id, RTT), `Status` (noise floor, trigger rate, mains
 * lock, temperature, clipping, queue) and `PdEvent` batches (time, amplitude, phase 0..65535,
 * width, polarity).
 *
 * Behaviour: noise floor about 6 dBmV; pulse rate scales with how far the level is above the
 * noise; phase clustered in two lobes (about 70 to 110 and 250 to 290 degrees) with a few
 * stray low pulses; amplitude spread about 3 dB below the level; a slow drift. The level comes
 * from the shared `DemoWorld`. Events do not go through the WASM decoder: `Session` only counts
 * frames today, and the demo must not widen the WASM API.
 */
import type {
  CantolCandidate,
  CantolHandlers,
  CantolLink,
  CantolStatus,
  DiagnosticRow,
  LinkState,
  PdEventSample,
  PingResult,
} from '../core/links';
import type { ControlsStore } from './controls';
import { createRng, type Rng } from './prng';
import type { DemoWorld } from './world';

/** A documentation address (RFC 5737): clearly a placeholder, never a real host. */
export const DEMO_CANTOL_ADDRESS = '192.0.2.10';
export const DEMO_DEVICE_ID = 'DEMO-001';
export const DEMO_RTT_MS = 4;
/** How long discovery takes before Cantol is found. */
export const DISCOVER_MS = 4000;
const PING_MS = 500;
const STATUS_EVERY_MS = 1000;

class AbortedError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortError';
  }
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AbortedError());
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new AbortedError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Resolves when `ready()` turns true (checked every 250 ms), or rejects on abort. */
function waitUntil(ready: () => boolean, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AbortedError());
      return;
    }
    const check = window.setInterval(() => {
      if (ready()) {
        window.clearInterval(check);
        signal.removeEventListener('abort', onAbort);
        resolve();
      }
    }, 250);
    const onAbort = () => {
      window.clearInterval(check);
      reject(new AbortedError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Pulse rate per second for a level: 40 plus 10 per dB above the noise floor, at most 600. */
export function pulseRateHz(levelDbmV: number, noiseDbmV: number): number {
  return Math.min(600, Math.round(40 + 10 * Math.max(0, levelDbmV - noiseDbmV)));
}

/** Degrees to the 16-bit phase of `PdEvent.phase`. */
export function degreesToPhase16(degrees: number): number {
  return Math.round((((degrees % 360) + 360) % 360) / 360 * 65536) % 65536;
}

function lobeDegrees(rng: Rng): { degrees: number; polarity: 0 | 1 } {
  const positive = rng.next() < 0.5;
  const centre = positive ? 90 : 270;
  // Kept just inside 70 to 110 and 250 to 290 degrees, so rounding to 16 bits cannot cross the band.
  const offset = Math.max(-19.5, Math.min(19.5, rng.normal() * 10));
  return { degrees: centre + offset, polarity: positive ? 0 : 1 };
}

export class SimulatedCantol implements CantolLink {
  private readonly handlers = new Set<CantolHandlers>();
  private readonly rng: Rng;
  private state: LinkState = 'down';
  private streaming = false;
  private carry = 0;
  private sinceStatusMs = 0;
  private lastLevel = 0;
  private discoverAttempts = 0;
  private lastAddress: string | null = null;
  private lastRtt: number | null = null;
  private readonly offTick: () => void;
  private readonly offControls: () => void;

  constructor(
    private readonly world: DemoWorld,
    private readonly controls: ControlsStore,
    seed = 2,
  ) {
    this.rng = createRng(seed);
    this.offTick = world.onTick((dtMs) => {
      this.onTick(dtMs);
    });
    this.offControls = controls.subscribe(() => {
      this.onControlsChanged();
    });
  }

  /** Stops listening to the world (tests and teardown). */
  dispose(): void {
    this.offTick();
    this.offControls();
  }

  private get reachable(): boolean {
    const { linkLost, cantolNotFound } = this.controls.get();
    return !linkLost && !cantolNotFound;
  }

  private setState(next: LinkState): void {
    if (next === this.state) return;
    this.state = next;
    for (const h of this.handlers) h.onLinkState(next);
  }

  private onControlsChanged(): void {
    if (this.state === 'up' && this.controls.get().linkLost) this.setState('lost');
    else if (this.state === 'lost' && this.reachable) this.setState('up');
  }

  async discover(options: { manualAddress?: string; signal: AbortSignal }): Promise<CantolCandidate> {
    this.discoverAttempts += 1;
    const { manualAddress, signal } = options;
    if (manualAddress !== undefined) {
      await waitFor(1200, signal);
      if (manualAddress.trim() !== DEMO_CANTOL_ADDRESS || !this.reachable) {
        throw new Error(`No Cantol answered at ${manualAddress.trim()}.`);
      }
    } else {
      await waitFor(DISCOVER_MS, signal);
      await waitUntil(() => this.reachable, signal);
    }
    this.lastAddress = DEMO_CANTOL_ADDRESS;
    return { address: DEMO_CANTOL_ADDRESS, deviceId: DEMO_DEVICE_ID };
  }

  async ping(candidate: CantolCandidate, signal: AbortSignal): Promise<PingResult> {
    await waitFor(PING_MS, signal);
    await waitUntil(() => this.reachable, signal);
    this.lastRtt = DEMO_RTT_MS;
    return { rttMs: DEMO_RTT_MS, deviceId: candidate.deviceId, protocol: 1 };
  }

  connect(): Promise<void> {
    this.setState(this.reachable ? 'up' : 'lost');
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.streaming = false;
    this.setState('down');
    return Promise.resolve();
  }

  startStream(): Promise<void> {
    this.streaming = true;
    this.carry = 0;
    this.sinceStatusMs = STATUS_EVERY_MS;
    return Promise.resolve();
  }

  stopStream(): Promise<void> {
    this.streaming = false;
    return Promise.resolve();
  }

  subscribe(handlers: CantolHandlers): () => void {
    this.handlers.add(handlers);
    return () => {
      this.handlers.delete(handlers);
    };
  }

  diagnostics(): Promise<DiagnosticRow[]> {
    return Promise.resolve([
      { label: 'Source', value: 'Simulated (demo build)' },
      { label: 'Link', value: this.state },
      { label: 'Discovery attempts', value: String(this.discoverAttempts) },
      { label: 'Last address', value: this.lastAddress ?? 'none yet' },
      { label: 'Last round trip', value: this.lastRtt === null ? 'none yet' : `${String(this.lastRtt)} ms` },
      { label: 'Protocol', value: 'v1 (placeholder)' },
      { label: 'Forced not found', value: this.controls.get().cantolNotFound ? 'yes' : 'no' },
    ]);
  }

  /** The current simulated status, as the real `Status` frame will carry it. */
  currentStatus(): CantolStatus {
    const noise = this.world.noiseFloor();
    return {
      tempC: 41 + 0.4 * Math.sin(this.world.timeMs / 20_000),
      adcClipPct: 0.3,
      noiseFloorDbmV: noise,
      triggerRateHz: pulseRateHz(this.lastLevel, noise),
      queue: 0,
      mainsLock: !this.controls.get().mainsUnlocked,
    };
  }

  private onTick(dtMs: number): void {
    if (!this.streaming || this.state !== 'up') return;
    const level = this.world.levelAt();
    this.lastLevel = level;
    const noise = this.world.noiseFloor();
    const rate = pulseRateHz(level, noise);

    this.carry += (rate * dtMs) / 1000;
    const count = Math.floor(this.carry);
    this.carry -= count;
    if (count > 0) {
      const events: PdEventSample[] = [];
      for (let i = 0; i < count; i++) {
        const stray = this.rng.next() < 0.03;
        const lobe = lobeDegrees(this.rng);
        const degrees = stray ? this.rng.range(0, 360) : lobe.degrees;
        events.push({
          tUs: Math.round(((i + 0.5) * dtMs * 1000) / count),
          ampDbmV: stray
            ? noise + Math.abs(this.rng.normal()) * 0.6
            : level - Math.min(3, Math.abs(this.rng.normal())),
          phase: degreesToPhase16(degrees),
          widthNs: this.rng.int(40, 600),
          polarity: stray ? (degrees < 180 ? 0 : 1) : lobe.polarity,
        });
      }
      for (const h of this.handlers) h.onEvents(events);
    }

    this.sinceStatusMs += dtMs;
    if (this.sinceStatusMs >= STATUS_EVERY_MS) {
      this.sinceStatusMs = 0;
      const status = this.currentStatus();
      for (const h of this.handlers) h.onStatus(status);
    }
  }
}
