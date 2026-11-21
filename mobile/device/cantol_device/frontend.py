"""Where the samples come from.

A front end hands the engine captures: sixteen thousand samples of all four channels taken together.
`SimulatedFrontEnd` makes them up (a mains sine on channel 1, ringing pulses on the sensors, noise),
and behaves like the real scope in the ways that matter to the engine: it waits for a trigger, it
misses pulses that arrive while it is busy, and a long capture takes as long as it would on the board.
`scpi.RedPitayaFrontEnd` takes them from the Red Pitaya's ADC.
"""
import math
import time

import numpy as np

from .dsp import ADC_BITS_FULL_SCALE, FULL_SCALE_VOLTS, Capture

SAMPLE_RATE = 125e6
BUFFER_SIZE = 16384
REF_DECIMATION = 1024  # 16384 samples at 8.2 microseconds: 134 ms, four to eight mains cycles


class FrontEnd(object):
    """What the engine needs from the hardware."""

    n_sensors = 3
    sample_dt = 1.0 / SAMPLE_RATE
    buffer_size = BUFFER_SIZE
    # Whether what it sends is generated (the status then says so on every frame).
    synthetic = False

    def open(self):
        pass

    def close(self):
        pass

    def capture_triggered(self, sensor, edge, level, timeout):
        """Arm on `sensor` (0-based) crossing `level` ADC counts on the rising ('pos') or falling
        ('neg') edge, wait up to `timeout` seconds. A Capture with the trigger at the middle of the
        buffer, or None if nothing triggered."""
        raise NotImplementedError

    def capture_free(self):
        """A capture of all channels starting now, without waiting for anything."""
        raise NotImplementedError

    def capture_reference(self):
        """A long, slow capture of channel 1 only (the sensors' arrays are empty)."""
        raise NotImplementedError

    def temperature(self):
        """Degrees Celsius of the board, or None."""
        return None


class _Discharge(object):
    __slots__ = ("t", "sign", "amps")

    def __init__(self, t, sign, amps):
        self.t = t  # when the biggest sample of the pulse falls
        self.sign = sign  # +1: the first lobe is positive
        self.amps = amps  # ADC counts at each sensor (0: not seen there)


def _template(dt, f0=8e6, tau=250e-9):
    """A sensor's ring: a damped sine, scaled so its biggest sample is 1, and where that sample is."""
    n = int(8 * tau / dt)
    t = np.arange(n) * dt
    w = np.exp(-t / tau) * np.sin(2 * math.pi * f0 * t)
    peak = int(np.argmax(np.abs(w)))
    return w / abs(w[peak]), peak


class SimulatedFrontEnd(FrontEnd):
    """The shape the app's demo build simulates: a level drifting by 4 dB over a minute, pulses at
    the phases where a void or a surface discharge fires (two lobes, around 90 and 270 degrees, and a
    few strays), seen mainly on one sensor and weaker on the others."""

    synthetic = True
    SENSITIVITY_DB = (0.0, -3.0, -6.0)  # sensor 1 is the most sensitive
    PRIMARY_WEIGHTS = (0.5, 0.3, 0.2)

    def __init__(
        self,
        n_sensors=3,
        level_dbmv=38.0,
        seed=1,
        mains_hz=50.0,
        with_ref=True,
        ref_amplitude=6000.0,
        ref_offset=40.0,
        noise_dbmv=6.0,
        adc_range="lv",
        drift_db=4.0,
        drift_seconds=60.0,
        clock=time.monotonic,
    ):
        self.n_sensors = n_sensors
        self.level = level_dbmv
        self.mains_hz = mains_hz
        self.with_ref = with_ref
        self.ref_amplitude = ref_amplitude
        self.ref_offset = ref_offset
        self.drift_db = drift_db
        self.drift_seconds = drift_seconds
        self.clock = clock
        self.rng = np.random.default_rng(seed)
        step_mv = 1000.0 * FULL_SCALE_VOLTS[adc_range] / ADC_BITS_FULL_SCALE
        self.step_mv = step_mv
        self.noise_sigma = (10.0 ** (noise_dbmv / 20.0)) / step_mv
        self.template, self.template_peak = _template(self.sample_dt)
        self.started = clock()
        self.cycle = int(self.started * mains_hz)  # the next mains cycle to fill with discharges
        self.pending = []
        self.temp = 41.0

    # ----- the made-up process

    def level_at(self, t):
        return self.level + self.drift_db * math.sin(2 * math.pi * (t - self.started) / self.drift_seconds)

    def rate_at(self, t):
        return min(600.0, 40.0 + 10.0 * max(0.0, self.level_at(t) - 6.0))

    def _fill_until(self, t_end):
        rng = self.rng
        while self.cycle / self.mains_hz < t_end:
            start = self.cycle / self.mains_hz
            self.cycle += 1
            for _ in range(int(rng.poisson(self.rate_at(start) / self.mains_hz))):
                if rng.random() < 0.03:
                    degrees = rng.uniform(0.0, 360.0)
                else:
                    centre = 90.0 if rng.random() < 0.5 else 270.0
                    offset = rng.normal(0.0, 10.0)
                    while abs(offset) > 19.5:  # resample rather than clamp: a clamp would stack discharges on one instant
                        offset = rng.normal(0.0, 10.0)
                    degrees = centre + offset
                t = start + degrees / 360.0 / self.mains_hz
                primary = int(rng.choice(self.n_sensors, p=self._weights()))
                dbmv = self.level_at(t) - min(3.0, abs(rng.normal())) + self._sensitivity(primary)
                amps = [0.0] * self.n_sensors
                amps[primary] = self._counts(dbmv)
                for j in range(self.n_sensors):
                    if j != primary and rng.random() < 0.6:
                        amps[j] = self._counts(dbmv - 8.0 + self._sensitivity(j) - self._sensitivity(primary))
                self.pending.append(_Discharge(t, 1 if rng.random() < 0.5 else -1, amps))
        self.pending.sort(key=lambda d: d.t)

    def _weights(self):
        w = np.array(self.PRIMARY_WEIGHTS[: self.n_sensors], dtype=float)
        if w.size < self.n_sensors:
            w = np.concatenate((w, np.full(self.n_sensors - w.size, 0.1)))
        return w / w.sum()

    def _sensitivity(self, sensor):
        return self.SENSITIVITY_DB[sensor] if sensor < len(self.SENSITIVITY_DB) else -6.0

    def _counts(self, dbmv):
        return (10.0 ** (dbmv / 20.0)) / self.step_mv

    # ----- turning it into samples

    def _noise(self, n):
        return self.rng.normal(0.0, self.noise_sigma, n)

    def _render(self, t_start, n, dt, trigger_index, with_pd=True):
        """A capture whose first sample is taken at t_start."""
        index = np.arange(n)
        if self.with_ref:
            ref = self.ref_offset + self.ref_amplitude * np.sin(2 * math.pi * self.mains_hz * (t_start + index * dt))
            ref = ref + self.rng.normal(0.0, 2.0, n)
        else:
            ref = self.rng.normal(0.0, 2.0, n)
        pd = []
        if with_pd:
            t_end = t_start + n * dt
            for sensor in range(self.n_sensors):
                x = self._noise(n) + 3.0
                for d in self.pending:
                    if d.amps[sensor] <= 0.0 or not (t_start <= d.t < t_end):
                        continue
                    at = int(round((d.t - t_start) / dt)) - self.template_peak
                    lo, hi = max(0, at), min(n, at + self.template.size)
                    if hi > lo:
                        x[lo:hi] += d.sign * d.amps[sensor] * self.template[lo - at : hi - at]
                pd.append(np.clip(np.round(x), -ADC_BITS_FULL_SCALE, ADC_BITS_FULL_SCALE - 1).astype(np.int16))
        ref = np.clip(np.round(ref), -ADC_BITS_FULL_SCALE, ADC_BITS_FULL_SCALE - 1).astype(np.int16)
        return Capture(t=t_start + trigger_index * dt, dt=dt, trigger_index=trigger_index, ref=ref, pd=pd)

    def _triggers(self, d, sensor, edge, level):
        a = d.amps[sensor]
        if a <= 0.0:
            return False
        positive = a if d.sign > 0 else 0.6 * a  # the second lobe of the ring is a little weaker
        negative = a if d.sign < 0 else 0.6 * a
        return (positive if edge == "pos" else negative) >= level

    def _sleep_until(self, t):
        pause = t - self.clock()
        if pause > 0:
            time.sleep(pause)

    # ----- the front end interface

    def capture_triggered(self, sensor, edge, level, timeout):
        now = self.clock()
        deadline = now + timeout
        self._fill_until(deadline + 0.01)
        # Discharges that fell while the scope was busy are gone, as they are on the board.
        self.pending = [d for d in self.pending if d.t >= now - 0.5]
        for d in self.pending:
            if d.t < now:
                continue
            if d.t > deadline:
                break
            if self._triggers(d, sensor, edge, level):
                self._sleep_until(d.t)
                half = self.buffer_size // 2
                return self._render(d.t - half * self.sample_dt, self.buffer_size, self.sample_dt, half)
        self._sleep_until(deadline)
        return None

    def capture_free(self):
        now = self.clock()
        self._fill_until(now + 0.01)
        return self._render(now, self.buffer_size, self.sample_dt, 0)

    def capture_reference(self):
        dt = REF_DECIMATION / SAMPLE_RATE
        now = self.clock()
        self._sleep_until(now + self.buffer_size * dt)
        return self._render(now, self.buffer_size, dt, 0, with_pd=False)

    def temperature(self):
        return self.temp
