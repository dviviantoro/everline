"""The Red Pitaya front end, over the board's own SCPI server (TCP port 5000, started with
`systemctl start redpitaya_scpi`).

Checked on a STEMlab 125-14 4-Input v1.3 (Red Pitaya OS 3.00-57), with nothing connected to the inputs:
  - the server, `*IDN?`, 125 MS/s, a 16384-sample buffer, RAW units, binary blocks;
  - binary blocks are BIG-endian int16, and 1 count is 0.122 mV on the LV input (0.5 mV of noise, 4.4 counts);
  - `ACQ:SOURn:DATA?` returns the buffer oldest sample first, and the trigger sample is at index 8192 - DLY
    (so DLY 0 is the middle); the pointers `ACQ:TPOS?` and `ACQ:WPOS?` agree (WPOS - TPOS = 8191 + DLY);
  - the six trigger names CH2_PE ... CH4_NE are accepted and fire (on noise, with the level inside it);
  - the trigger's hysteresis defaults to 5 mV, which is more than our level, so it is set here;
  - without TCP_QUICKACK every request took 50 ms whatever its size; with it 0.6 ms (see _quickack).
NOT checked: which physical input each trigger name watches (that needs a signal on one input only), the
trigger on a real pulse, the reference signal, the thermal path. `python3 -m cantol_device selftest
--source redpitaya` prints what the board answers so these can be confirmed.
"""
import glob
import socket
import time

import numpy as np

from .dsp import ADC_BITS_FULL_SCALE, FULL_SCALE_VOLTS, Capture
from .frontend import BUFFER_SIZE, REF_DECIMATION, SAMPLE_RATE, FrontEnd


class ScpiError(Exception):
    pass


class _Connection(object):
    """A line- and block-oriented reader over the SCPI socket."""

    def __init__(self, host, port, timeout=5.0):
        try:
            self.sock = socket.create_connection((host, port), timeout=timeout)
        except OSError as error:
            raise ScpiError(
                "cannot reach the SCPI server at %s:%d (%s). Start it with: systemctl start redpitaya_scpi"
                % (host, port, error)
            )
        self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self._quick = getattr(socket, "TCP_QUICKACK", None)  # Linux only
        self.timeout = timeout
        self.buf = b""

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass

    def send(self, *commands):
        """Commands that give no answer, sent in one go."""
        self.sock.sendall("".join(c + "\r\n" for c in commands).encode("ascii"))

    def _quickack(self):
        # Measured on the board (OS 3.00): without this every request/answer round trip took 50 ms, whatever
        # its size (a 2 KB block as much as a 32 KB one), because the server answers in pieces and the
        # kernel's delayed ACK holds the next piece back. With it a round trip is 0.6 ms and a full
        # 16384-sample channel read 6 ms, so a capture drops from about 300 ms to about 30. Linux resets the
        # flag by itself, so it is set again around every receive.
        if self._quick is not None:
            try:
                self.sock.setsockopt(socket.IPPROTO_TCP, self._quick, 1)
            except OSError:
                self._quick = None

    def _more(self):
        self._quickack()
        chunk = self.sock.recv(65536)
        self._quickack()
        if not chunk:
            raise ScpiError("the SCPI server closed the connection")
        self.buf += chunk

    def read_line(self):
        while b"\n" not in self.buf:
            self._more()
        line, _sep, self.buf = self.buf.partition(b"\n")
        return line.decode("ascii", "replace").strip()

    def query(self, command):
        self.send(command)
        return self.read_line()

    def read_block(self):
        """An IEEE 488.2 definite-length block: '#', one digit n, n digits of length, then the bytes."""
        while len(self.buf) < 2:
            self._more()
        if self.buf[:1] != b"#":
            raise ScpiError("expected a binary block, got %r" % self.buf[:40])
        digits = int(self.buf[1:2])
        while len(self.buf) < 2 + digits:
            self._more()
        length = int(self.buf[2 : 2 + digits])
        total = 2 + digits + length
        while len(self.buf) < total:
            self._more()
        payload = self.buf[2 + digits : total]
        self.buf = self.buf[total:]
        # The block is followed by a line end; if it has not arrived yet it is the next thing to.
        while len(self.buf) < 1:
            self.sock.settimeout(0.05)
            try:
                self._more()
            except socket.timeout:
                break
            finally:
                self.sock.settimeout(self.timeout)
        while self.buf[:1] in (b"\r", b"\n"):
            self.buf = self.buf[1:]
        return payload


class RedPitayaFrontEnd(FrontEnd):
    # ACQ:TRig:DLY adds samples AFTER the trigger to the half buffer the board writes by default, and the
    # data is read oldest first, so the trigger sample is at index 8192 - DLY. DLY 0 puts it in the middle
    # (measured; the first version of this file sent 8192 and the trigger landed on sample 0).
    TRIGGER_DELAY = 0
    TRIGGER_INDEX = BUFFER_SIZE // 2 - TRIGGER_DELAY

    def __init__(self, host="127.0.0.1", port=5000, n_sensors=3, adc_range="lv"):
        self.host = host
        self.port = port
        self.n_sensors = n_sensors
        self.volts_per_count = FULL_SCALE_VOLTS[adc_range] / ADC_BITS_FULL_SCALE
        self.conn = None
        self.idn = ""

    def open(self):
        self.close()
        self.conn = _Connection(self.host, self.port)
        self.idn = self.conn.query("*IDN?")
        self.conn.send("ACQ:RST", "ACQ:DATA:UNITS RAW", "ACQ:DATA:FORMAT BIN", "ACQ:AVG OFF")

    def close(self):
        if self.conn is not None:
            self.conn.close()
            self.conn = None

    # ----- one acquisition

    def _start(self, decimation, source, level_counts=None):
        commands = ["ACQ:DEC %d" % decimation, "ACQ:TRig:DLY %d" % self.TRIGGER_DELAY]
        if level_counts is not None:
            level_volts = level_counts * self.volts_per_count
            # The board's trigger has a hysteresis that defaults to 5 mV: a rising edge only fires after the
            # signal was below (level - hysteresis). Our level is about 7 noise deviations (a few mV), so
            # the default would leave the trigger disarmed on a quiet baseline. Half the level re-arms it
            # as soon as the signal is back in the noise.
            commands.append("ACQ:TRig:HYST %.6f" % (0.5 * abs(level_volts)))
            commands.append("ACQ:TRig:LEV %.6f" % level_volts)
        commands += ["ACQ:START", "ACQ:TRig %s" % source]
        self.conn.send(*commands)

    def _wait(self, query, wanted, timeout):
        end = time.monotonic() + timeout
        while True:
            if self.conn.query(query) == wanted:
                return True
            if time.monotonic() >= end:
                return False
            time.sleep(0.0002)

    def _read(self, channels):
        out = []
        for channel in channels:
            self.conn.send("ACQ:SOUR%d:DATA?" % channel)
            # Measured on a STEMlab 125-14 4-Input, OS 3.00: the block is big-endian (network order), as
            # the ASCII read of the same buffer showed (ff ff 00 08 is -1, 8). Read as little-endian it gave
            # sigma 760 counts of "noise" on open inputs that really sit at about 4.
            out.append(np.frombuffer(self.conn.read_block(), dtype=">i2").astype(np.int16))
        return out

    def _capture(self, decimation, source, level, timeout, channels, dt):
        self._start(decimation, source, level)
        started = time.monotonic()
        triggered = self._wait("ACQ:TRig:STAT?", "TD", timeout)
        if not triggered:
            self.conn.send("ACQ:STOP")
            return None
        t_trigger = time.monotonic()
        # The buffer is full once the samples after the trigger have been written.
        if not self._wait("ACQ:TRig:FILL?", "1", (BUFFER_SIZE - self.TRIGGER_INDEX) * dt + 0.1):
            self.conn.send("ACQ:STOP")
            return None
        data = self._read(channels)
        self.conn.send("ACQ:STOP")
        index = self.TRIGGER_INDEX
        return data, index, (t_trigger if source != "NOW" else started)

    # ----- the front end interface

    def capture_triggered(self, sensor, edge, level, timeout):
        source = "CH%d_%s" % (sensor + 2, "PE" if edge == "pos" else "NE")
        # `level` is a size; a falling-edge trigger watches for the signal crossing the same distance below zero.
        signed = level if edge == "pos" else -level
        got = self._capture(1, source, signed, timeout, [1] + [c + 2 for c in range(self.n_sensors)], self.sample_dt)
        if got is None:
            return None
        data, index, t = got
        return Capture(t=t, dt=self.sample_dt, trigger_index=index, ref=data[0], pd=data[1:])

    def capture_free(self):
        got = self._capture(1, "NOW", None, 1.0, [1] + [c + 2 for c in range(self.n_sensors)], self.sample_dt)
        if got is None:
            raise ScpiError("a capture started 'now' did not complete")
        data, index, t = got
        return Capture(t=t + index * self.sample_dt, dt=self.sample_dt, trigger_index=index, ref=data[0], pd=data[1:])

    def capture_reference(self):
        dt = REF_DECIMATION / SAMPLE_RATE
        got = self._capture(REF_DECIMATION, "NOW", None, 1.0, [1], dt)
        if got is None:
            raise ScpiError("the reference capture did not complete")
        data, index, t = got
        return Capture(t=t + index * dt, dt=dt, trigger_index=index, ref=data[0], pd=[])

    def temperature(self):
        """The Zynq's own temperature from the XADC, as Linux exposes it."""
        try:
            for path in glob.glob("/sys/bus/iio/devices/iio:device*"):
                with open(path + "/name") as handle:
                    if "xadc" not in handle.read():
                        continue
                values = []
                for name in ("raw", "offset", "scale"):
                    with open("%s/in_temp0_%s" % (path, name)) as handle:
                        values.append(float(handle.read()))
                return (values[0] + values[1]) * values[2] / 1000.0
        except (OSError, ValueError):
            pass
        return None
