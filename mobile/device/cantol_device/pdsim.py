"""A front end that replays pd-simulator: what the Red Pitaya's inputs would see with a Digilent Analog
Discovery 2 running `pd-simulator` wired to them (W1 to channel 1, W2 to channel 2).

No Analog Discovery is needed: the waveforms come from pd-simulator's own `signals.py` (the same
`PdSource` and `sample_sine` its web app and its USB streamer use), evaluated at the instants the Red
Pitaya's ADC would sample them, 125 million times a second. Everything after that is the real
measurement software: the detector, the phase from the reference, the protocol and the app. It is
therefore the closest thing to the real wiring that can run without the hardware, and `--source
redpitaya` is the same program reading the real inputs.

What it keeps from the real thing: the AD2's W2 is a staircase (one value per 4.9 microseconds at 50 Hz),
its noise is uniform and as large as `ch2_bg_amplitude_v` says, W1 and W2 share one clock whose zero is the
rising zero crossing of W1, and settings take effect (and restart that clock) when they change, as when
Apply is pressed. What it makes up: the Red Pitaya's own input noise (4.4 counts, measured on the board with
open inputs), and the other sensors, which are W2 scaled down (`--pdsim-coupling-db`).

Settings: pd-simulator's `GeneratorConfig` field names in a JSON file (`--pdsim-config`), read again when the
file changes, so a script, or a person, can turn the "defect" up and down while the app is watching.
"""
import importlib.util
import json
import os
import time

import numpy as np

from .dsp import ADC_BITS_FULL_SCALE, FULL_SCALE_VOLTS, Capture
from .frontend import BUFFER_SIZE, REF_DECIMATION, SAMPLE_RATE, FrontEnd

ADC_NOISE_COUNTS = 4.4  # sigma of an open input, LV, measured on the board (OS 3.00)


def load_signals(pdsim_dir):
    """pd-simulator's signals.py, loaded by path under its own name (it has no package to import)."""
    path = os.path.join(pdsim_dir, "signals.py")
    if not os.path.isfile(path):
        raise FileNotFoundError("pd-simulator's signals.py is not in %s (use --pdsim-dir)" % pdsim_dir)
    spec = importlib.util.spec_from_file_location("pdsim_signals", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PdSimFrontEnd(FrontEnd):
    synthetic = True  # generated, and the status says so

    def __init__(self, pdsim_dir, config_path="", n_sensors=1, adc_range="lv", coupling_db=(0.0, -6.0, -12.0), seed=1, clock=time.monotonic, log=None):
        self.signals = load_signals(pdsim_dir)
        self.n_sensors = n_sensors
        self.volts_per_count = FULL_SCALE_VOLTS[adc_range] / ADC_BITS_FULL_SCALE
        self.coupling = [10.0 ** ((coupling_db[k] if k < len(coupling_db) else -12.0) / 20.0) for k in range(n_sensors)]
        self.rng = np.random.default_rng(seed)
        self.clock = clock
        self.log = log or (lambda text: None)
        self.config_path = config_path
        self._seen = None  # (mtime, size) of the config file as last read
        self.cfg = self.signals.GeneratorConfig.from_dict({})
        self._start(self.cfg)
        self.temp = 41.0
        self._refresh()

    # ----- pd-simulator's settings

    def _start(self, cfg):
        """New settings, as Apply does: a new source, and the AD2's clock starts again from zero."""
        self.cfg = cfg
        self.source = self.signals.PdSource(cfg)
        self.epoch = self.clock()

    def _refresh(self):
        if not self.config_path:
            return
        try:
            stat = os.stat(self.config_path)
        except OSError:
            return
        mark = (stat.st_mtime_ns, stat.st_size)
        if mark == self._seen:
            return
        self._seen = mark
        try:
            with open(self.config_path) as handle:
                cfg = self.signals.GeneratorConfig.from_dict(json.load(handle))
        except (OSError, ValueError) as error:
            self.log("pd-simulator settings in %s refused: %s (the old ones stay)" % (self.config_path, error))
            return
        self._start(cfg)
        self.log("pd-simulator settings applied: %s %.0f Hz, W1 %.3f V, W2 %s%s" % (
            cfg.ch2_mode, cfg.frequency_hz, cfg.ch1_amplitude_v, cfg.ch2_sensor,
            "" if cfg.ch2_mode != "pd" else ", peaks %.3f V / %.3f V" % (cfg.pos_pd_max_amplitude_v, cfg.neg_pd_max_amplitude_v)))

    # ----- what the ADC sees

    def _counts(self, volts):
        raw = volts / self.volts_per_count + self.rng.normal(0.0, ADC_NOISE_COUNTS, volts.size)
        return np.clip(np.round(raw), -ADC_BITS_FULL_SCALE, ADC_BITS_FULL_SCALE - 1).astype(np.int16)

    def _w1(self, t):
        return self.signals.sample_sine(self.cfg, t) if self.cfg.ch1_enabled else np.zeros(t.size)

    def _w2(self, t):
        return self.source.sample(t) if self.cfg.ch2_enabled else np.zeros(t.size)

    def _render(self, t_first, n, dt, trigger_index, with_pd=True):
        """A capture whose first sample is taken `t_first` seconds after the AD2's clock started."""
        t = t_first + np.arange(n) * dt
        ref = self._counts(self._w1(t))
        pd = []
        if with_pd:
            w2 = self._w2(t)
            pd = [self._counts(w2 * g) for g in self.coupling]
        return Capture(t=self.epoch + t_first + trigger_index * dt, dt=dt, trigger_index=trigger_index, ref=ref, pd=pd)

    def _sleep_until(self, t):
        pause = t - self.clock()
        if pause > 0:
            time.sleep(pause)

    # ----- the front end interface

    def capture_triggered(self, sensor, edge, level, timeout):
        self._refresh()
        now = self.clock()
        deadline = now + timeout
        # W2 changes only at its own sample instants; the step that first crosses the level is the trigger.
        period = self.source.dt
        first = int(np.floor((now - self.epoch) / period)) + 1
        last = int(np.floor((deadline - self.epoch) / period))
        if last >= first and self.cfg.ch2_enabled:
            index = np.arange(first - 1, last + 1)
            counts = self._w2((index + 0.5) * period) * self.coupling[sensor] / self.volts_per_count
            if edge == "pos":
                crossing = (counts[:-1] < level) & (counts[1:] >= level)
            else:
                crossing = (counts[:-1] > -level) & (counts[1:] <= -level)
            hits = np.flatnonzero(crossing)
            if hits.size:
                t_trigger = (first + int(hits[0])) * period
                self._sleep_until(self.epoch + t_trigger)
                half = self.buffer_size // 2
                return self._render(t_trigger - half * self.sample_dt, self.buffer_size, self.sample_dt, half)
        self._sleep_until(deadline)
        return None

    def capture_free(self):
        self._refresh()
        return self._render(self.clock() - self.epoch, self.buffer_size, self.sample_dt, 0)

    def capture_reference(self):
        self._refresh()
        dt = REF_DECIMATION / SAMPLE_RATE
        began = self.clock()
        self._sleep_until(began + self.buffer_size * dt)
        return self._render(began - self.epoch, self.buffer_size, dt, 0, with_pd=False)

    def temperature(self):
        return self.temp
