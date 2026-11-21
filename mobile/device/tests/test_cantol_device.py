"""Tests of the Cantol measurement software against the simulator's ground truth.

Run:  cd mobile/device && python3 -m unittest discover -s tests -v

The simulator knows what it fired: when, how hard and on which sensor. These tests ask the
detector and the phase estimator what they found and compare it with that, rather than with what
the code happens to produce.
"""
import math
import os
import sys
import time
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from cantol_device import protocol as P  # noqa: E402
from cantol_device.dsp import Calibration, Capture, Detector, ReferenceTracker, to_events  # noqa: E402
from cantol_device.engine import Engine, Feed  # noqa: E402
from cantol_device.frontend import SimulatedFrontEnd  # noqa: E402

STEP_MV = 1000.0 / 8192  # the LV input: one ADC count in millivolts


def circular_degrees(a, b):
    return abs((a - b + 180.0) % 360.0 - 180.0)


def locked_tracker(sim, **kw):
    # These tests are about detection and phase, so the lock must not lapse while they run: on the board's
    # slow CPU 150 captures take longer than the default 12 s, and the engine renews the lock every 4 s
    # where these tests do not. Lock expiry has its own test (test_the_lock_expires_when_it_is_not_renewed).
    kw.setdefault("valid_s", 3600.0)
    tracker = ReferenceTracker(**kw)
    assert tracker.update(sim.capture_reference(), time.monotonic()), "the simulated reference should lock"
    return tracker


def truths(sim, cap, min_counts, margin=100):
    """The discharges this capture really contains: (sensor, discharge) with at least `min_counts` ADC counts.

    `margin` samples at each end of the buffer are left out. The detector skips only a pulse touching the outer 64
    samples, so a found pulse must be matched against everything fired (margin 0): with the larger margin a real pulse
    between samples 64 and 100 looked spurious (about one run in eight). The count of missed pulses keeps the margin,
    because only a pulse well inside the buffer is certain to be found."""
    t0 = cap.t - cap.trigger_index * cap.dt
    t1 = t0 + cap.ref.size * cap.dt
    edge = margin * cap.dt
    out = []
    for d in sim.pending:
        if t0 + edge < d.t < t1 - edge:
            for sensor, amp in enumerate(d.amps):
                if amp >= min_counts:
                    out.append((sensor, d))
    return out


class ReferenceTests(unittest.TestCase):
    def test_it_finds_the_frequency_amplitude_and_offset_of_the_mains(self):
        for hz in (50.0, 60.0, 49.6):
            sim = SimulatedFrontEnd(seed=3, mains_hz=hz)
            tracker = ReferenceTracker()
            self.assertTrue(tracker.update(sim.capture_reference(), time.monotonic()), hz)
            self.assertAlmostEqual(tracker.freq, hz, delta=0.02)
            self.assertAlmostEqual(tracker.amplitude, 6000.0, delta=30.0)
            self.assertAlmostEqual(tracker.offset, 40.0, delta=3.0)

    def test_it_says_there_is_no_reference_when_there_is_none(self):
        sim = SimulatedFrontEnd(seed=3, with_ref=False)
        tracker = ReferenceTracker()
        self.assertFalse(tracker.update(sim.capture_reference(), time.monotonic()))
        self.assertFalse(tracker.locked(time.monotonic()))
        self.assertIsNone(tracker.phase16s(sim.capture_free(), [100], time.monotonic()))

    def test_a_reference_that_is_too_weak_is_not_a_mains_reference(self):
        sim = SimulatedFrontEnd(seed=3, ref_amplitude=150.0)
        self.assertFalse(ReferenceTracker(min_amplitude=300.0).update(sim.capture_reference(), time.monotonic()))
        self.assertTrue(ReferenceTracker(min_amplitude=100.0).update(sim.capture_reference(), time.monotonic()))

    def test_a_reference_that_is_not_a_sine_is_not_taken_for_one(self):
        rng = np.random.default_rng(5)
        noise = Capture(t=0.0, dt=8.192e-6, trigger_index=0, ref=np.round(rng.normal(0, 2000, 16384)).astype(np.int16), pd=[])
        self.assertFalse(ReferenceTracker().update(noise, 0.0))
        t = np.arange(16384) * 8.192e-6
        square = Capture(t=0.0, dt=8.192e-6, trigger_index=0, ref=(5000 * np.sign(np.sin(2 * math.pi * 50 * t))).astype(np.int16), pd=[])
        self.assertFalse(ReferenceTracker().update(square, 0.0), "a square wave has the harmonics of a sine's residual")

    def test_the_lock_expires_when_it_is_not_renewed(self):
        sim = SimulatedFrontEnd(seed=3)
        tracker = ReferenceTracker(valid_s=12.0)
        tracker.update(sim.capture_reference(), 100.0)
        self.assertTrue(tracker.locked(111.0))
        self.assertFalse(tracker.locked(113.0))

    def test_phase_follows_the_convention_zero_is_the_rising_zero_crossing(self):
        # A noiseless 50 Hz sine whose rising zero crossing is at t = 0.
        dt = 8e-9
        n = 16384
        slow = 8.192e-6
        tracker = ReferenceTracker()
        t_slow = np.arange(16384) * slow
        tracker.update(Capture(0.0, slow, 0, np.round(5000 * np.sin(2 * math.pi * 50 * t_slow)).astype(np.int16), []), 0.0)
        for degrees in (0.0, 30.0, 90.0, 135.0, 180.0, 225.0, 270.0, 359.0):
            t0 = degrees / 360.0 / 50.0 - (n // 2) * dt  # the buffer's middle sample falls at this phase
            t = t0 + np.arange(n) * dt
            cap = Capture(t0 + (n // 2) * dt, dt, n // 2, np.round(5000 * np.sin(2 * math.pi * 50 * t)).astype(np.int16), [])
            got = tracker.phase16s(cap, [n // 2], 0.0)[0] / 65536.0 * 360.0
            self.assertLess(circular_degrees(got, degrees), 0.3, "%s degrees read as %s" % (degrees, got))

    def test_an_upside_down_reference_and_a_fixed_shift_are_corrected(self):
        sim = SimulatedFrontEnd(seed=4)
        cap_ref = sim.capture_reference()
        plain = ReferenceTracker()
        flipped = ReferenceTracker(invert=True)
        shifted = ReferenceTracker(phase_offset_deg=30.0)
        for tracker in (plain, flipped, shifted):
            tracker.update(cap_ref, time.monotonic())
        cap = sim.capture_free()
        base = plain.phase16s(cap, [8000], time.monotonic())[0] / 65536.0 * 360.0
        self.assertLess(circular_degrees(flipped.phase16s(cap, [8000], time.monotonic())[0] / 65536.0 * 360.0, base + 180.0), 0.1)
        self.assertLess(circular_degrees(shifted.phase16s(cap, [8000], time.monotonic())[0] / 65536.0 * 360.0, base + 30.0), 0.1)


class DetectionTests(unittest.TestCase):
    def run_captures(self, sim, tracker, count=150, **kw):
        detector = Detector()
        calibration = Calibration(sim.n_sensors, "lv")
        plan = [(s, e) for s in range(sim.n_sensors) for e in ("pos", "neg")]
        found, expected = [], []
        for k in range(count):
            sensor, edge = plan[k % len(plan)]
            cap = sim.capture_triggered(sensor, edge, 120.0, 0.02)
            if cap is None:
                continue
            pulses, _sigmas, _clip = detector.process(cap)
            events = to_events(cap, pulses, tracker, calibration, time.monotonic())
            found.append((cap, pulses, events))
            expected.append(truths(sim, cap, 50.0, margin=0))
        return found, expected

    def test_pulses_are_found_where_and_as_strong_as_they_were_fired_and_with_the_right_phase(self):
        sim = SimulatedFrontEnd(seed=11, level_dbmv=40.0)
        tracker = locked_tracker(sim)
        found, expected = self.run_captures(sim, tracker)
        self.assertGreater(len(found), 100)
        matched = missed = spurious = 0
        phase_errors = []
        relative = []
        for (cap, pulses, events), truth in zip(found, expected):
            hit = set()
            for pulse, event in zip(pulses, events):
                best = None
                for k, (sensor, d) in enumerate(truth):
                    if sensor == pulse.sensor and abs(d.t - pulse.t) < 2e-7 and (best is None or abs(d.t - pulse.t) < abs(truth[best][1].t - pulse.t)):
                        best = k
                if best is None:
                    spurious += 1
                    continue
                matched += 1
                hit.add(best)
                sensor, d = truth[best]
                true_phase = (d.t * sim.mains_hz % 1.0) * 360.0
                phase_errors.append(circular_degrees(event.phase16 / 65536.0 * 360.0, true_phase))
                self.assertEqual(event.sensor, sensor)
                self.assertEqual(event.polarity, 0 if true_phase < 180.0 else 1)
                if d.amps[sensor] >= 400.0:
                    # Near the threshold the second lobe of the ring can be the bigger one by noise alone;
                    # from four times the noise up the sign is the pulse's own.
                    self.assertEqual(event.amp_counts > 0, d.sign > 0, "the sign of the amplitude is the pulse's own")
                overlapped = any(o is not d and abs(o.t - d.t) < 6e-6 and o.amps[sensor] > 0 for o in sim.pending)
                if d.amps[sensor] >= 400.0 and not overlapped:  # two pulses within a few microseconds are read as one
                    relative.append(abs(abs(event.amp_counts) - d.amps[sensor] * (STEP_MV / 0.1)) / (d.amps[sensor] * (STEP_MV / 0.1)))
            inside_from = cap.t - cap.trigger_index * cap.dt + 100 * cap.dt  # a pulse near either end may be skipped
            inside_to = inside_from + (cap.ref.size - 200) * cap.dt
            for k, (sensor, d) in enumerate(truth):
                isolated = all(abs(o.t - d.t) > 3e-6 for s2, o in truth if s2 == sensor and o is not d)
                if d.amps[sensor] >= 200.0 and isolated and inside_from < d.t < inside_to and k not in hit:
                    missed += 1
        self.assertGreater(matched, 200)
        self.assertEqual(spurious, 0, "everything found was fired")
        self.assertLessEqual(missed, 0.02 * matched, "%d missed of %d" % (missed, matched))
        # Limited by the noise of the reference over the 131 microseconds of one capture (about 0.03 degrees
        # typical, a few tenths at the far end of the buffer): 1 degree is 55 microseconds of mains.
        self.assertLess(float(np.percentile(phase_errors, 99)), 0.25, "99%% of phases are within %.2f degrees" % np.percentile(phase_errors, 99))
        self.assertLess(max(phase_errors), 0.8, "the worst phase error is %.2f degrees" % max(phase_errors))
        self.assertLess(float(np.mean(phase_errors)), 0.06)
        self.assertLess(float(np.mean(relative)), 0.03, "mean amplitude error %.1f%%" % (100 * np.mean(relative)))
        self.assertLess(max(relative), 0.15)

    def test_pulses_cluster_at_the_phases_where_the_discharges_were_fired(self):
        sim = SimulatedFrontEnd(seed=12, level_dbmv=40.0)
        tracker = locked_tracker(sim)
        found, _ = self.run_captures(sim, tracker, count=200)
        deg = np.array([e.phase16 / 65536.0 * 360.0 for _c, _p, events in found for e in events])
        self.assertGreater(deg.size, 300)
        in_lobes = np.mean(((deg > 70) & (deg < 110)) | ((deg > 250) & (deg < 290)))
        self.assertGreater(in_lobes, 0.9)  # 3 percent of discharges are strays at any phase

    def test_without_a_mains_reference_pulses_are_still_found_but_say_nothing_about_phase(self):
        sim = SimulatedFrontEnd(seed=13, with_ref=False)
        tracker = ReferenceTracker()
        tracker.update(sim.capture_reference(), time.monotonic())
        found, _ = self.run_captures(sim, tracker, count=60, )
        events = [e for _c, _p, ev in found for e in ev]
        self.assertGreater(len(events), 50)
        self.assertTrue(all(e.phase16 == 0 and e.polarity == 0 for e in events))

    def test_noise_alone_is_not_taken_for_pulses(self):
        rng = np.random.default_rng(2)
        detector = Detector()
        false = 0
        for _ in range(300):
            pd = [np.round(rng.normal(0, 16.3, 16384)).astype(np.int16) for _ in range(3)]
            cap = Capture(0.0, 8e-9, 8192, np.zeros(16384, dtype=np.int16), pd)
            pulses, sigmas, clip = detector.process(cap)
            false += len(pulses)
            self.assertAlmostEqual(sigmas[0], 16.3, delta=0.6, msg="the noise deviation is read from the samples")
            self.assertEqual(clip, 0.0)
        self.assertEqual(false, 0, "300 captures of three channels of noise (14 million samples)")

    def test_a_lone_spike_is_not_a_pulse_but_a_ring_is(self):
        rng = np.random.default_rng(3)
        x = np.round(rng.normal(0, 10, 16384)).astype(np.int16)
        x[5000] = 900
        cap = Capture(0.0, 8e-9, 8192, np.zeros(16384, dtype=np.int16), [x])
        self.assertEqual(Detector().process(cap)[0], [])
        t = np.arange(120) * 8e-9
        x[6000:6120] += np.round(900 * np.exp(-t / 250e-9) * np.sin(2 * math.pi * 8e6 * t)).astype(np.int16)
        pulses = Detector().process(cap)[0]
        self.assertEqual(len(pulses), 1)
        self.assertGreater(abs(pulses[0].amp_adc), 500)

    def test_a_pulse_cut_off_by_the_edge_of_the_buffer_is_skipped_and_two_apart_are_two(self):
        t = np.arange(120) * 8e-9
        ring = np.round(900 * np.exp(-t / 250e-9) * np.sin(2 * math.pi * 8e6 * t)).astype(np.int16)
        x = np.zeros(16384, dtype=np.int16)
        x[10:130] += ring
        x[8000:8120] += ring
        x[8500:8620] += ring  # 500 samples after the first: far beyond the merge gap
        x[9000:9120] -= ring  # and another, upside down
        x[9200:9320] += ring  # 80 samples after the end of the last: inside the merge gap, so one pulse with it
        cap = Capture(0.0, 8e-9, 8192, np.zeros(16384, dtype=np.int16), [x])
        pulses = Detector().process(cap)[0]
        self.assertEqual(len(pulses), 3, "the one at the edge is not reported, and the last two are one")
        self.assertEqual([p.amp_adc > 0 for p in pulses], [True, True, False])

    def test_the_clip_fraction_counts_samples_at_the_limit(self):
        x = np.zeros(16384, dtype=np.int16)
        x[1000:1164] = 8191
        cap = Capture(0.0, 8e-9, 8192, np.zeros(16384, dtype=np.int16), [x])
        self.assertAlmostEqual(Detector().process(cap)[2], 164 / 16384, places=6)


class CalibrationTests(unittest.TestCase):
    def test_counts_are_the_protocols_tenth_of_a_millivolt_at_the_input(self):
        lv = Calibration(3, "lv")
        self.assertEqual(lv.to_counts(0, 819.2), 1000)  # 100 mV = 40 dBmV at the input
        self.assertEqual(lv.to_counts(0, -819.2), -1000)
        hv = Calibration(3, "hv")
        self.assertEqual(hv.to_counts(0, 40.96), 1000)  # the same 100 mV, from 40.96 counts of the 20 V range

    def test_an_attenuator_in_front_of_a_sensor_is_added_back(self):
        c = Calibration(3, "lv", [0.0, 20.0, -6.0])
        self.assertEqual(c.to_counts(0, 100), 122)
        self.assertEqual(c.to_counts(1, 100), 1221)
        self.assertEqual(c.to_counts(2, 100), 61)

    def test_it_never_overflows_the_message(self):
        c = Calibration(1, "hv", [40.0])
        self.assertEqual(c.to_counts(0, 8000), 32767)
        self.assertEqual(c.to_counts(0, -8000), -32767)


class FeedAndEngineTests(unittest.TestCase):
    def test_each_reader_keeps_its_own_place_and_is_told_when_it_fell_behind(self):
        feed = Feed(size=10)
        feed.push(list(range(6)))
        a, ca, da = feed.read(0)
        self.assertEqual((a, ca, da), (list(range(6)), 6, False))
        feed.push(list(range(6, 12)))
        b, cb, db = feed.read(ca)
        self.assertEqual((b, cb, db), (list(range(6, 12)), 12, False))
        late, cl, dl = feed.read(0)
        self.assertEqual(late, list(range(2, 12)), "the oldest two are gone")
        self.assertTrue(dl)
        self.assertEqual(feed.backlog(0), 10)
        self.assertEqual(feed.backlog(12), 0)

    def test_the_engine_measures_while_someone_is_streaming_and_not_otherwise(self):
        sim = SimulatedFrontEnd(seed=21)
        engine = Engine(sim, Detector(), ReferenceTracker(), Calibration(3, "lv"))
        engine.start()
        try:
            time.sleep(0.6)
            self.assertEqual(engine.feed.next_seq, 0, "nobody asked: nothing is measured")
            engine.acquire()
            time.sleep(3.0)
            seen = engine.feed.next_seq
            # "Measuring" means a steady stream of events, not a particular speed: a PC sees about 100 in these
            # three seconds, the board's 667 MHz cores about 40 to 60 (the simulator is most of that cost).
            self.assertGreater(seen, 20)
            status = engine.status()
            self.assertTrue(status["locked"])
            self.assertTrue(status["synthetic"])
            self.assertEqual(len(status["sensors"]), 3)
            self.assertGreater(status["rate_hz"], 5)
            self.assertAlmostEqual(status["noise_counts"], 20.0, delta=3.0, msg="6 dBmV of noise is about 20 protocol counts")
            self.assertEqual(status["clip_pct"], 0.0)
            engine.release()
            time.sleep(0.5)
            settled = engine.feed.next_seq
            time.sleep(0.5)
            self.assertEqual(engine.feed.next_seq, settled, "when the last phone stops, so does the measuring")
        finally:
            engine.stop()
            engine.join(2.0)

    def test_a_front_end_that_fails_is_reported_and_retried(self):
        class Broken(SimulatedFrontEnd):
            calls = 0

            def capture_reference(self):
                Broken.calls += 1
                raise OSError("the board went away")

        messages = []
        engine = Engine(Broken(seed=22), Detector(), ReferenceTracker(), Calibration(3, "lv"), log=messages.append)
        engine.start()
        engine.acquire()
        try:
            time.sleep(2.4)
        finally:
            engine.stop()
            engine.join(3.0)
        self.assertEqual(messages, ["measurement problem: OSError: the board went away"], "said once, not every second")
        self.assertGreaterEqual(Broken.calls, 2, "and tried again")


class FakeScpiServer(object):
    """Answers the way a STEMlab 125-14 4-Input on Red Pitaya OS 3.00 did when it was probed (see scpi.py):
    lines end in CRLF, `ACQ:SOURn:DATA?` is a '#' + digit count + length block of big-endian int16 followed
    by CRLF, and commands without an answer give none. It records every command it is sent."""

    def __init__(self, waveforms, state="TD"):
        import socket
        import threading

        self.waveforms = waveforms  # channel number (1-4) -> int16 array
        self.state = state
        self.commands = []
        self.server = socket.socket()
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(1)
        self.port = self.server.getsockname()[1]
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()

    def _serve(self):
        try:
            conn, _ = self.server.accept()
        except OSError:
            return
        pending = b""
        while True:
            try:
                chunk = conn.recv(4096)
            except OSError:
                return
            if not chunk:
                return
            pending += chunk
            while b"\r\n" in pending:
                line, _, pending = pending.partition(b"\r\n")
                command = line.decode()
                self.commands.append(command)
                conn.sendall(self._answer(command))

    def _answer(self, command):
        if command == "*IDN?":
            return b"REDPITAYA,INSTR,2026-07-06,3.00-57-test\r\n"
        if command == "ACQ:TRig:STAT?":
            return self.state.encode() + b"\r\n"
        if command == "ACQ:TRig:FILL?":
            return b"1\r\n"
        if command.startswith("ACQ:SOUR") and command.endswith(":DATA?"):
            channel = int(command[len("ACQ:SOUR")])
            payload = self.waveforms[channel].astype(">i2").tobytes()
            return b"#5%05d" % len(payload) + payload + b"\r\n"
        return b""

    def close(self):
        self.server.close()


class ScpiFrontEndTests(unittest.TestCase):
    """The front end against the board's wire format. The board itself is not needed, but its format is."""

    def setUp(self):
        rng = np.random.default_rng(3)
        self.waves = {}
        for channel in (1, 2, 3, 4):
            wave = np.round(rng.normal(0.0, 4.4, 16384)).astype(np.int16)
            wave[0], wave[1], wave[2] = -1, 8, 0   # the first samples of a real capture: ff ff 00 08 00 00
            wave[100] = 2000 + channel              # a value that reads very differently byte-swapped
            self.waves[channel] = wave
        self.fake = FakeScpiServer(self.waves)

    def tearDown(self):
        self.fake.close()

    def front_end(self):
        from cantol_device.scpi import RedPitayaFrontEnd

        front = RedPitayaFrontEnd(port=self.fake.port, n_sensors=3, adc_range="lv")
        front.open()
        self.addCleanup(front.close)
        return front

    def test_it_reads_the_big_endian_samples_the_board_sends(self):
        cap = self.front_end().capture_free()
        self.assertEqual(cap.ref.size, 16384)
        self.assertEqual(len(cap.pd), 3)
        self.assertEqual(cap.ref[:3].tolist(), [-1, 8, 0])
        self.assertEqual(int(cap.ref[100]), 2001)
        for k in range(3):
            self.assertTrue(np.array_equal(cap.pd[k], self.waves[k + 2]), "sensor %d is channel %d" % (k + 1, k + 2))
        self.assertLess(float(np.median(np.abs(cap.pd[0]))), 10.0, "open inputs are quiet; byte-swapped they read hundreds of counts")

    def test_the_commands_are_the_ones_the_board_was_probed_with(self):
        self.front_end().capture_free()
        self.assertEqual(self.fake.commands[0], "*IDN?")
        for command in ("ACQ:RST", "ACQ:DATA:UNITS RAW", "ACQ:DATA:FORMAT BIN", "ACQ:AVG OFF", "ACQ:START", "ACQ:TRig NOW"):
            self.assertIn(command, self.fake.commands)
        self.assertEqual([c for c in self.fake.commands if c.endswith(":DATA?")], ["ACQ:SOUR%d:DATA?" % n for n in (1, 2, 3, 4)])

    def test_the_trigger_is_put_in_the_middle_of_the_buffer_the_way_the_board_counts_it(self):
        # On the board the data comes oldest first and the trigger sample is at index 8192 - ACQ:TRig:DLY, so
        # a delay of 0 is the middle. (The first version sent 8192, which puts the trigger on sample 0.)
        cap = self.front_end().capture_triggered(0, "pos", 40.0, 0.5)
        self.assertEqual(cap.trigger_index, 8192)
        self.assertIn("ACQ:TRig:DLY 0", self.fake.commands)
        self.assertNotIn("ACQ:TRig:DLY 8192", self.fake.commands)

    def test_a_falling_edge_watches_below_zero_and_the_hysteresis_is_below_the_level(self):
        front = self.front_end()
        front.capture_triggered(1, "neg", 40.0, 0.5)   # sensor 2 = channel 3, level 40 counts
        volts = 40.0 * 1.0 / 8192
        self.assertIn("ACQ:TRig CH3_NE", self.fake.commands)
        level = [float(c.split()[1]) for c in self.fake.commands if c.startswith("ACQ:TRig:LEV")][-1]
        hyst = [float(c.split()[1]) for c in self.fake.commands if c.startswith("ACQ:TRig:HYST")][-1]
        self.assertAlmostEqual(level, -volts, places=5, msg="a falling edge is armed below zero")
        self.assertAlmostEqual(hyst, volts / 2, places=5, msg="the board's default 5 mV would leave a 5 mV trigger disarmed")
        front.capture_triggered(0, "pos", 40.0, 0.5)
        self.assertIn("ACQ:TRig CH2_PE", self.fake.commands)
        self.assertAlmostEqual([float(c.split()[1]) for c in self.fake.commands if c.startswith("ACQ:TRig:LEV")][-1], volts, places=5)

    def test_no_trigger_gives_none_and_stops_the_acquisition(self):
        self.fake.state = "WAIT"
        front = self.front_end()
        self.assertIsNone(front.capture_triggered(0, "pos", 40.0, 0.05))
        deadline = time.monotonic() + 1.0
        while "ACQ:STOP" not in self.fake.commands and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertIn("ACQ:STOP", self.fake.commands)


def _find_pdsim():
    here = os.path.dirname(os.path.abspath(__file__))
    for path in (os.path.join(here, "..", "..", "..", "pd-simulator"), "/cantol/pd-simulator"):
        if os.path.isfile(os.path.join(path, "signals.py")):
            return os.path.abspath(path)
    return None


PDSIM_DIR = _find_pdsim()


@unittest.skipUnless(PDSIM_DIR, "pd-simulator's signals.py is not next to the repository or in /cantol/pd-simulator")
class PdSimReplayTests(unittest.TestCase):
    """The replay of pd-simulator through the real detector and phase code, judged by pd-simulator's own settings."""

    SMALL = {"ch1_amplitude_v": 0.8, "ch2_bg_amplitude_v": 0.0005, "pos_pd_max_amplitude_v": 0.1, "neg_pd_max_amplitude_v": 0.1}

    def setUp(self):
        import json
        import tempfile

        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "pdsim.json")
        self.json = json
        self.messages = []

    def tearDown(self):
        import shutil

        shutil.rmtree(self.dir, ignore_errors=True)

    def settings(self, **more):
        with open(self.path, "w") as handle:
            self.json.dump(dict(self.SMALL, **more), handle)

    def front(self, **more):
        from cantol_device.pdsim import PdSimFrontEnd

        self.settings(**more)
        return PdSimFrontEnd(PDSIM_DIR, self.path, n_sensors=1, adc_range="lv", log=self.messages.append)

    def events(self, front, tracker, count, edges=("pos", "neg"), level=60.0):
        detector = Detector()
        calibration = Calibration(1, "lv")
        out = []
        for k in range(count):
            cap = front.capture_triggered(0, edges[k % len(edges)], level, 0.05)
            if cap is None:
                continue
            pulses, _sigmas, _clip = detector.process(cap)
            out += to_events(cap, pulses, tracker, calibration, time.monotonic())
        return out

    def test_the_reference_is_the_ad2s_w1_and_locks(self):
        front = self.front()
        tracker = ReferenceTracker()
        self.assertTrue(tracker.update(front.capture_reference(), time.monotonic()))
        self.assertAlmostEqual(tracker.freq, 50.0, delta=0.05)
        self.assertAlmostEqual(tracker.amplitude, 0.8 / (1.0 / 8192), delta=80.0, msg="0.8 V on the LV input")

    def test_a_calibration_pulse_is_read_at_zero_degrees_and_its_height(self):
        # pd-simulator's calibration mode: 0.05 V every 20 ms at 50 Hz is one pulse a cycle at 0 degrees.
        front = self.front(ch2_mode="calibration", cal_amplitude_v=0.05, cal_interval_ms=20.0)
        tracker = locked_tracker(front)
        events = self.events(front, tracker, 8, edges=("pos",), level=40.0)
        self.assertGreaterEqual(len(events), 5)
        for event in events:
            self.assertLess(circular_degrees(event.phase16 / 65536.0 * 360.0, 0.0), 1.5, "the pulse sits at phase 0")
            self.assertAlmostEqual(event.amp_counts, 500, delta=40, msg="0.05 V is 500 counts of 0.1 mV")

    def test_pd_pulses_land_in_the_two_phase_windows_with_the_right_sign(self):
        front = self.front()  # pd-simulator's defaults: positive 30-60 degrees, negative 210-240
        tracker = locked_tracker(front)
        events = self.events(front, tracker, 80)
        self.assertGreater(len(events), 60)
        phases = np.array([e.phase16 / 65536.0 * 360.0 for e in events])
        positive = np.array([e.amp_counts > 0 for e in events])
        in_positive = (phases > 29) & (phases < 63)
        in_negative = (phases > 209) & (phases < 243)
        self.assertGreater(np.mean(in_positive | in_negative), 0.97, "pulses outside the windows: %s" % np.round(phases[~(in_positive | in_negative)], 1))
        self.assertGreater(np.mean(positive[in_positive]), 0.95, "a pulse in the positive window swings up")
        self.assertLess(np.mean(positive[in_negative]), 0.05, "a pulse in the negative window swings down")

    def test_changing_the_settings_changes_what_the_cantol_sees_without_a_restart(self):
        front = self.front(pos_pd_max_amplitude_v=0.05, neg_pd_max_amplitude_v=0.05)
        tracker = locked_tracker(front)
        # The 90th percentile, not the maximum: two pd-simulator pulses a few microseconds apart overlap on its
        # staircase and read as one pulse of their sum (seen on the board, 481 + 309 counts read 655). Pulses are
        # 40 to 100 percent of the peak, so the 90th percentile of a 0.05 V peak is about 470 counts.
        low = float(np.percentile([abs(e.amp_counts) for e in self.events(front, tracker, 40)], 90))
        time.sleep(0.05)
        self.settings(pos_pd_max_amplitude_v=0.2, neg_pd_max_amplitude_v=0.2)
        high = float(np.percentile([abs(e.amp_counts) for e in self.events(front, tracker, 40)], 90))
        self.assertLess(low, 540, "0.05 V peak is 500 counts of 0.1 mV")
        self.assertGreater(high, 1500, "0.2 V peak is 2000 counts: read after the file changed")
        self.assertTrue(any("applied" in m for m in self.messages))

    def test_a_refused_settings_file_keeps_the_old_settings_and_says_so(self):
        front = self.front()
        time.sleep(0.05)
        with open(self.path, "w") as handle:
            handle.write('{"frequency_hz": 99999}')
        front.capture_free()
        self.assertEqual(front.cfg.frequency_hz, 50.0)
        self.assertTrue(any("refused" in m for m in self.messages), self.messages)

    def test_with_w2_off_nothing_triggers(self):
        front = self.front(ch2_enabled=False)
        self.assertIsNone(front.capture_triggered(0, "pos", 40.0, 0.03))


class ProtocolTests(unittest.TestCase):
    def test_a_frame_round_trips_and_resyncs_after_damage(self):
        good = P.frame(P.K_STATUS, 7, b"abc", 99)
        frames, rest = P.extract_frames(b"\x00noise" + good[:-1] + b"\xff" + good)
        self.assertEqual(frames, [(P.K_STATUS, 7, b"abc")])
        self.assertEqual(rest, b"")

    def test_message_layouts(self):
        status = P.status_payload(41.2, 0.3, 20, 300, 4, P.STATUS_MAINS_LOCK | P.STATUS_SYNTHETIC, [(20, 200), (30, 100)])
        self.assertEqual(len(status), 11 + 1 + 2 * 4)
        self.assertEqual(status[:11].hex(), "9c01030014002c01040003")
        self.assertEqual(status[11], 2)
        events = P.pd_events_payload([(10, -300, 65535, 120, 1, 2), (20, 4000, 0, 90, 0, 0)])
        self.assertEqual(len(events), 2 + 2 * 12)
        self.assertEqual(events[:2], b"\x02\x00")
        self.assertEqual(events[2 + 11], 2, "the channel is the last byte of an event")


if __name__ == "__main__":
    unittest.main()
