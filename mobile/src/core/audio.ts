/**
 * The optional sound cue of tracking mode (`mobile-tracking-mode.md` section 4): a tone whose
 * pitch rises with the level, and a short double beep for the warning alert. Web Audio needs no
 * Android permission, but the audio context must be created or resumed from a tap, so the setup
 * screen calls `unlockAudio()` from the Start button. Without it the cue is silently absent.
 */

let context: AudioContext | null = null;

/** Create or resume the shared audio context. Call it from a user gesture. Returns false if audio is unavailable. */
export function unlockAudio(): boolean {
  try {
    context ??= new AudioContext();
    void context.resume();
    return true;
  } catch {
    return false;
  }
}

/** Pitch in Hz for a level in dBmV: it doubles about every 30 dB, between 250 and 1400 Hz. */
export function pitchFor(levelDbmV: number): number {
  return Math.max(250, Math.min(1400, 300 * 2 ** (levelDbmV / 30)));
}

export interface SoundCue {
  setLevel: (levelDbmV: number) => void;
  beep: () => void;
  stop: () => void;
}

/** A cue on the shared context, or null when audio was never unlocked. */
export function createCue(): SoundCue | null {
  const ctx = context;
  if (!ctx) return null;
  const tone = ctx.createOscillator();
  const gain = ctx.createGain();
  tone.type = 'sine';
  tone.frequency.value = pitchFor(0);
  gain.gain.value = 0;
  tone.connect(gain).connect(ctx.destination);
  tone.start();

  return {
    setLevel: (level) => {
      tone.frequency.setTargetAtTime(pitchFor(level), ctx.currentTime, 0.05);
      gain.gain.setTargetAtTime(0.04, ctx.currentTime, 0.05);
    },
    beep: () => {
      const t = ctx.currentTime;
      for (const [offset, hz] of [[0, 880], [0.22, 1175]] as const) {
        const beep = ctx.createOscillator();
        const level = ctx.createGain();
        beep.frequency.value = hz;
        level.gain.setValueAtTime(0.08, t + offset);
        level.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.18);
        beep.connect(level).connect(ctx.destination);
        beep.start(t + offset);
        beep.stop(t + offset + 0.2);
      }
    },
    stop: () => {
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      tone.stop(ctx.currentTime + 0.1);
      tone.disconnect();
    },
  };
}
