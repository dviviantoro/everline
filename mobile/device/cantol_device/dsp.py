"""Signal processing: pulses on the sensor channels, and the phase of each pulse on the mains cycle.

All of it works on one capture at a time (a buffer of samples of every channel taken together), so
it can be tested with synthetic captures and run unchanged on the board.

Phase convention: 0 degrees is the positive-going zero crossing of the reference (channel 1),
90 degrees its positive peak, 180 degrees the negative-going zero crossing: the convention of a
phase-resolved partial discharge (PRPD) plot.
"""
import collections
import math

import numpy as np

from .protocol import PROTOCOL_MV_PER_COUNT

ADC_BITS_FULL_SCALE = 8192  # 14-bit signed samples: -8192 .. 8191
FULL_SCALE_VOLTS = {"lv": 1.0, "hv": 20.0}  # the jumper on the Red Pitaya's input
CLIP_COUNTS = 8190  # a sample at or beyond this is at the ADC's limit

# A pulse is a run of samples further than K_DETECT noise deviations from the baseline. The floor keeps
# a very quiet capture from calling its own noise a pulse.
K_DETECT = 6.0
MIN_THRESHOLD_COUNTS = 8.0
# A real pulse rings for a microsecond or more, hundreds of samples at full rate; a lone sample past
# the threshold is noise. Together with the threshold this gives well under one false pulse a minute.
MIN_SAMPLES = 3
# Samples of one pulse closer than this belong to the same pulse (a sensor rings for a microsecond or so).
MERGE_SECONDS = 1.5e-6
# A pulse touching the edge of the buffer is cut short and its amplitude would be wrong: skipped.
EDGE_SAMPLES = 64

RawPulse = collections.namedtuple("RawPulse", "sensor t amp_adc width_s")
Event = collections.namedtuple("Event", "t sensor amp_counts phase16 width_ns polarity")


class Capture(object):
    """Samples of all channels taken at the same instants.

    t        monotonic time (seconds) of the sample at trigger_index
    dt       seconds per sample
    ref      channel 1 (the mains reference), raw ADC counts
    pd       one array per sensor, raw ADC counts (empty for a reference-only capture)
    """

    def __init__(self, t, dt, trigger_index, ref, pd):
        self.t = t
        self.dt = dt
        self.trigger_index = trigger_index
        self.ref = ref
        self.pd = pd


class Calibration(object):
    """From what the ADC reads to the protocol's counts (0.1 mV each; mobile/rust/cantol-dsp).

    mv_per_adc_count is the ADC step at the input jumper (1 V full scale on LV: 0.122 mV; 20 V on
    HV: 2.44 mV). gain_db is what stands between the sensor and the input: an attenuator of 20 dB
    in front of the input is +20, so that the level reported is the one at the sensor's output.
    """

    def __init__(self, n_sensors, adc_range="lv", gain_db=None):
        step = 1000.0 * FULL_SCALE_VOLTS[adc_range] / ADC_BITS_FULL_SCALE
        gains = list(gain_db) if gain_db else []
        gains = (gains + [0.0] * n_sensors)[:n_sensors]
        self.volts_per_adc_count = step / 1000.0
        self.factor = [step / PROTOCOL_MV_PER_COUNT * (10.0 ** (g / 20.0)) for g in gains]

    def to_counts(self, sensor, adc_counts):
        """Protocol counts (signed, clipped to what the message can hold) of a signed ADC amplitude."""
        return int(max(-32767, min(32767, round(adc_counts * self.factor[sensor]))))


def robust_sigma(y):
    """Noise deviation of samples that may contain pulses: from the median absolute deviation."""
    return 1.4826 * float(np.median(np.abs(y)))


class Detector(object):
    """Finds the pulses on the sensor channels of one capture."""

    def __init__(self, k_detect=K_DETECT, min_threshold=MIN_THRESHOLD_COUNTS, merge_s=MERGE_SECONDS, edge=EDGE_SAMPLES, min_samples=MIN_SAMPLES):
        self.min_samples = min_samples
        self.k_detect = k_detect
        self.min_threshold = min_threshold
        self.merge_s = merge_s
        self.edge = edge

    def process(self, cap):
        """-> (pulses, sigmas, clip_fraction): the pulses found, each sensor's noise deviation in
        ADC counts, and the fraction of sensor samples at the ADC's limit."""
        pulses = []
        sigmas = []
        clipped = 0
        total = 0
        merge = max(1, int(round(self.merge_s / cap.dt)))
        for sensor, raw in enumerate(cap.pd):
            x = raw.astype(np.float32)
            n = x.size
            y = x - np.median(x)
            sigma = max(robust_sigma(y), 0.5)
            sigmas.append(sigma)
            clipped += int(np.count_nonzero(np.abs(x) >= CLIP_COUNTS))
            total += n
            threshold = max(self.k_detect * sigma, self.min_threshold)
            idx = np.flatnonzero(np.abs(y) > threshold)
            if idx.size == 0:
                continue
            breaks = np.flatnonzero(np.diff(idx) > merge)
            starts = np.concatenate(([idx[0]], idx[breaks + 1]))
            ends = np.concatenate((idx[breaks], [idx[-1]]))
            for s, e in zip(starts, ends):
                if s < self.edge or e > n - 1 - self.edge or np.count_nonzero(np.abs(y[s : e + 1]) > threshold) < self.min_samples:
                    continue
                segment = y[s : e + 1]
                k = int(np.argmax(np.abs(segment)))
                peak = int(s) + k
                pulses.append(
                    RawPulse(
                        sensor=sensor,
                        t=cap.t + (peak - cap.trigger_index) * cap.dt,
                        amp_adc=float(y[peak]),
                        width_s=(int(e) - int(s) + 1) * cap.dt,
                    )
                )
        return pulses, sigmas, (clipped / total if total else 0.0)


class ReferenceTracker(object):
    """Follows the mains reference on channel 1: its frequency and offset, and whether it is there.

    `update` takes a long, slow capture of the reference (several cycles). `phase16s` then gives the
    phase of any instant inside a fast capture from that capture's own reference samples, so a
    pulse needs no clock: where the sine is, and which way it is going, at the pulse's sample is
    all there is to read.
    """

    def __init__(self, min_amplitude=300.0, valid_s=12.0, invert=False, phase_offset_deg=0.0, f_range=(40.0, 70.0)):
        self.min_amplitude = min_amplitude
        self.valid_s = valid_s
        self.invert = invert
        self.phase_offset_deg = phase_offset_deg
        self.f_range = f_range
        self.freq = None
        self.omega = None
        self.offset = 0.0
        self.amplitude = 0.0
        self.residual = None
        self.ok_at = None

    def locked(self, now):
        return self.ok_at is not None and now - self.ok_at <= self.valid_s

    @staticmethod
    def _fit(t, x, omega):
        design = np.column_stack((np.sin(omega * t), np.cos(omega * t), np.ones_like(t)))
        coef, _res, _rank, _sv = np.linalg.lstsq(design, x, rcond=None)
        residual = x - design @ coef
        return coef, float(np.sqrt(np.mean(residual * residual)))

    def update(self, cap, now):
        """Re-estimates from a reference capture. Returns True when the reference is there."""
        x = cap.ref.astype(np.float64)
        n = x.size
        t = np.arange(n) * cap.dt
        low, high = self.f_range
        # The peak of the spectrum, then a search around it for the frequency that fits best.
        spectrum = np.abs(np.fft.rfft((x - x.mean()) * np.hanning(n)))
        freqs = np.fft.rfftfreq(n, cap.dt)
        band = np.flatnonzero((freqs >= low) & (freqs <= high))
        if band.size == 0 or spectrum[band].max() <= 0.0:
            return False
        k = int(band[np.argmax(spectrum[band])])
        bin_hz = float(freqs[1])
        coarse = freqs[k]
        step = 4
        lo, hi = coarse - bin_hz, coarse + bin_hz
        for _ in range(24):  # golden-section search on the fit's residual (a fifth of the samples is plenty)
            a = lo + 0.382 * (hi - lo)
            b = lo + 0.618 * (hi - lo)
            ra = self._fit(t[::step], x[::step], 2 * math.pi * a)[1]
            rb = self._fit(t[::step], x[::step], 2 * math.pi * b)[1]
            if ra < rb:
                hi = b
            else:
                lo = a
        freq = 0.5 * (lo + hi)
        omega = 2 * math.pi * freq
        coef, rms = self._fit(t, x, omega)
        amplitude = float(math.hypot(coef[0], coef[1]))
        ok = low <= freq <= high and amplitude >= self.min_amplitude and rms <= 0.15 * amplitude
        self.freq, self.omega, self.offset = freq, omega, float(coef[2])
        self.amplitude, self.residual = amplitude, rms
        if ok:
            self.ok_at = now
        return ok

    def phase16s(self, cap, indices, now):
        """Phase of each sample index of a fast capture, as 0..65535 for 0..360 degrees, or None when not locked."""
        if not self.locked(now) or self.omega is None:
            return None
        ref = cap.ref.astype(np.float64)
        n = ref.size
        stride = max(1, n // 4096)
        half = 0.5 * n * cap.dt
        centre = 0.5 * n
        u = ((np.arange(0, n, stride) - centre) * cap.dt) / half  # -1 .. 1
        c2, c1, c0 = np.polyfit(u, ref[::stride], 2)
        out = []
        for i in indices:
            ui = ((i - centre) * cap.dt) / half
            value = c0 + c1 * ui + c2 * ui * ui
            slope = (c1 + 2.0 * c2 * ui) / half  # counts per second
            theta = math.atan2(value - self.offset, slope / self.omega)
            if self.invert:
                theta += math.pi
            degrees = (math.degrees(theta) + self.phase_offset_deg) % 360.0
            out.append(int(degrees / 360.0 * 65536.0) % 65536)
        return out


def to_events(cap, pulses, tracker, calibration, now):
    """Pulses of one capture as protocol events: calibrated amplitude, phase and half-cycle."""
    if not pulses:
        return []
    indices = [cap.trigger_index + (p.t - cap.t) / cap.dt for p in pulses]
    phases = tracker.phase16s(cap, indices, now)
    events = []
    for k, p in enumerate(pulses):
        phase = 0 if phases is None else phases[k]
        events.append(
            Event(
                t=p.t,
                sensor=p.sensor,
                amp_counts=calibration.to_counts(p.sensor, p.amp_adc),
                phase16=phase,
                width_ns=min(65535, int(round(p.width_s * 1e9))),
                polarity=0 if phase < 32768 else 1,
            )
        )
    return events
