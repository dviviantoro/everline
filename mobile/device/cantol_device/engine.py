"""The measurement loop: arm, capture, find pulses, give them a phase, publish them.

The Red Pitaya's scope can hold one buffer of 16384 samples (131 microseconds at full rate) and has to
be re-armed after each, so a pulse that arrives while it is busy is not seen. The loop therefore
takes turns arming on each sensor and each edge (a trigger can watch only one channel at a time),
reads every channel of each capture it gets (a pulse on another sensor in the same 131 microseconds
is found too), once a second takes a free-running capture to learn each sensor's noise, and every few
seconds a slow, long capture of the reference to follow the mains. The pulses counted are therefore
a lower bound of what the sensors saw; `queue` and the dropped flag are for a consumer that falls behind.
"""
import collections
import threading
import time

from .dsp import to_events

K_TRIGGER = 7.0  # the trigger level, in noise deviations; above the detector's, so a trigger always confirms
MIN_TRIGGER_COUNTS = 12.0
WAIT_SECONDS = 0.010  # how long to wait on one trigger before trying the next
FREE_INTERVAL = 1.0
REF_INTERVAL = 4.0
REF_RETRY = 1.0
FEED_SIZE = 20000
RATE_WINDOW = 1.0


class Feed(object):
    """The pulses found, newest last, for any number of readers that each keep their own place."""

    def __init__(self, size=FEED_SIZE):
        self.events = collections.deque(maxlen=size)
        self.next_seq = 0  # sequence number of the next event pushed
        self.lock = threading.Lock()

    def push(self, events):
        with self.lock:
            for e in events:
                self.events.append(e)
            self.next_seq += len(events)

    def read(self, cursor, limit=100000):
        """(events since cursor, the new cursor, whether some were lost because the reader fell behind)."""
        with self.lock:
            first = self.next_seq - len(self.events)
            dropped = cursor < first
            start = max(cursor, first) - first
            out = list(self.events)[start : start + limit]
            return out, max(cursor, first) + len(out), dropped

    def backlog(self, cursor):
        with self.lock:
            return self.next_seq - max(cursor, self.next_seq - len(self.events))


class Engine(threading.Thread):
    def __init__(self, frontend, detector, tracker, calibration, log=None, clock=time.monotonic, wait_seconds=WAIT_SECONDS):
        threading.Thread.__init__(self, name="cantol-engine")
        self.daemon = True
        self.frontend = frontend
        self.detector = detector
        self.tracker = tracker
        self.calibration = calibration
        self.log = log or (lambda text: None)
        self.clock = clock
        self.wait_seconds = wait_seconds
        n = frontend.n_sensors
        self.feed = Feed()
        self.sigma = [None] * n  # noise deviation per sensor, ADC counts
        self.times = [collections.deque() for _ in range(n)]  # when each sensor's recent pulses were found
        self.clip = 0.0
        self.error = None
        self.captures = 0
        self.armed = 0  # triggered captures tried, including those that timed out
        self._active = 0
        self._cond = threading.Condition()
        self._stopping = False

    # ----- who wants the stream

    def acquire(self):
        with self._cond:
            self._active += 1
            self._cond.notify_all()

    def release(self):
        with self._cond:
            self._active = max(0, self._active - 1)

    def stop(self):
        with self._cond:
            self._stopping = True
            self._cond.notify_all()

    # ----- what the sessions read

    def status(self):
        """The figures of the status frame, in the protocol's counts."""
        now = self.clock()
        sensors = []
        for k in range(self.frontend.n_sensors):
            noise = 0.0 if self.sigma[k] is None else self.sigma[k] * self.calibration.factor[k]
            sensors.append((noise, self._rate(k, now)))
        temp = self.frontend.temperature()
        return {
            "temp_c": 0.0 if temp is None else temp,
            "clip_pct": 100.0 * self.clip,
            "noise_counts": max([n for n, _r in sensors] or [0.0]),
            "rate_hz": sum(r for _n, r in sensors),
            "locked": self.tracker.locked(now),
            "synthetic": self.frontend.synthetic,
            "sensors": sensors,
        }

    def _rate(self, sensor, now):
        times = self.times[sensor]
        while times and now - times[0] > RATE_WINDOW:
            times.popleft()
        return len(times) / RATE_WINDOW

    # ----- the loop

    def _handle(self, cap):
        pulses, sigmas, clip = self.detector.process(cap)
        for k, s in enumerate(sigmas):
            self.sigma[k] = s if self.sigma[k] is None else 0.7 * self.sigma[k] + 0.3 * s
        self.clip = 0.7 * self.clip + 0.3 * clip
        now = self.clock()
        events = to_events(cap, pulses, self.tracker, self.calibration, now)
        if events:
            self.feed.push(events)
            for e in events:
                self.times[e.sensor].append(now)
        self.captures += 1

    def run(self):
        n = self.frontend.n_sensors
        plan = [(s, edge) for s in range(n) for edge in ("pos", "neg")]
        turn = 0
        next_free = 0.0
        next_ref = 0.0
        opened = False
        last_error = None
        while True:
            with self._cond:
                if self._stopping:
                    break
                if self._active == 0:
                    self._cond.wait(0.2)
                    continue
            try:
                if not opened:
                    self.frontend.open()
                    opened = True
                now = self.clock()
                if now >= next_ref:
                    ok = self.tracker.update(self.frontend.capture_reference(), self.clock())
                    next_ref = self.clock() + (REF_INTERVAL if ok else REF_RETRY)
                    continue
                if now >= next_free:
                    self._handle(self.frontend.capture_free())
                    next_free = self.clock() + FREE_INTERVAL
                    continue
                sensor, edge = plan[turn % len(plan)]
                turn += 1
                sigma = self.sigma[sensor] or 0.0
                level = max(K_TRIGGER * sigma, MIN_TRIGGER_COUNTS)
                self.armed += 1
                cap = self.frontend.capture_triggered(sensor, edge, level, self.wait_seconds)
                if cap is not None:
                    self._handle(cap)
                self.error = None
                last_error = None
            except Exception as error:  # the board or its server went away: say so once, try again in a second
                self.error = "%s: %s" % (type(error).__name__, error)
                if self.error != last_error:
                    self.log("measurement problem: %s" % self.error)
                    last_error = self.error
                try:
                    self.frontend.close()
                except Exception:
                    pass
                opened = False
                time.sleep(1.0)
        try:
            self.frontend.close()
        except Exception:
            pass
