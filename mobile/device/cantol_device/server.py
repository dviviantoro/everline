"""The link to the phone: the handshake, the keep-alive, the stream, and the discovery beacon."""
import select
import socket
import struct
import subprocess
import threading
import time

from . import protocol as P

MAX_CONNECTIONS = 16
IDLE_SECONDS = 30
TICK_SECONDS = 0.05
SEND_TIMEOUT_SECONDS = 5.0
STATUS_SECONDS = 1.0


# ----- the network

def _run(*cmd):
    try:
        return subprocess.check_output(cmd, stderr=subprocess.DEVNULL).decode("ascii", "replace")
    except (OSError, subprocess.CalledProcessError):
        return ""


def default_interface():
    for line in _run("ip", "-4", "route", "show", "default").splitlines():
        parts = line.split()
        if "dev" in parts:
            return parts[parts.index("dev") + 1]
    return ""


def interface_mac(name):
    try:
        with open("/sys/class/net/%s/address" % name) as handle:
            text = handle.read().strip().upper()
    except OSError:
        return ""
    return text if text and text != "00:00:00:00:00:00" else ""


def default_mac(iface=""):
    """The unit's own MAC address: the Ethernet one (the board's label), else the link's."""
    for name in ("eth0", iface, default_interface()):
        if name and interface_mac(name):
            return interface_mac(name)
    return ""


def beacon_targets(iface=""):
    """Where to send the discovery beacon: the broadcast address of each attached subnet, the gateway
    (a phone's hotspot may not pass broadcasts), and the limited broadcast."""
    targets = []
    for line in _run("ip", "-4", "-o", "addr", "show", "scope", "global").splitlines():
        parts = line.split()
        if iface and parts[1] != iface:
            continue
        if "brd" in parts:
            targets.append(parts[parts.index("brd") + 1])
    via = _run("ip", "-4", "route", "show", "default").split()
    if "via" in via:
        targets.append(via[via.index("via") + 1])
    targets.append("255.255.255.255")
    seen = []
    for t in targets:
        if t not in seen:
            seen.append(t)
    return seen


def beacon_sockets(iface):
    plain = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    plain.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    pinned = None
    if iface and hasattr(socket, "SO_BINDTODEVICE"):
        pinned = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        pinned.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        try:
            pinned.setsockopt(socket.SOL_SOCKET, socket.SO_BINDTODEVICE, iface.encode())
        except OSError:
            pinned.close()
            pinned = None
    return plain, pinned


# ----- one phone

class Session(object):
    """One phone. Everything for it happens on its own thread, so frames never interleave."""

    def __init__(self, conn, who, ctx):
        self.conn = conn
        self.who = who
        self.ctx = ctx
        self.opened = time.monotonic()
        self.seq = 0
        self.streaming = False
        self.cursor = 0
        self.next_pd = 0.0
        self.next_status = 0.0
        self.next_report = 0.0
        self.pulses = 0
        self.reported = 0
        self.pings = 0

    def send(self, kind, payload, at=None, flags=0):
        t = time.monotonic() if at is None else at
        ts_us = max(0, int((t - self.opened) * 1e6))
        self.conn.sendall(P.frame(kind, self.seq, payload, ts_us, flags))
        self.seq = (self.seq + 1) & 0xFFFFFFFF

    def status_bytes(self):
        s = self.ctx.engine.status()
        flags = (P.STATUS_MAINS_LOCK if s["locked"] else 0) | (P.STATUS_SYNTHETIC if s["synthetic"] else 0)
        return P.status_payload(
            s["temp_c"], s["clip_pct"], s["noise_counts"], s["rate_hz"],
            self.ctx.engine.feed.backlog(self.cursor) if self.streaming else 0, flags, s["sensors"],
        )

    def stop_streaming(self):
        if self.streaming:
            self.streaming = False
            self.ctx.engine.release()

    def on_frame(self, kind, rx_seq, payload):
        ctx = self.ctx
        if kind == P.K_HELLO and len(payload) >= 14:
            pmin, pmax, nonce, phone_ms = struct.unpack_from("<BBIQ", payload)
            ctx.bump("hello")
            if pmin > P.VER or pmax < P.VER:
                self.send(P.K_ERROR, bytes([P.ERR_UNSUPPORTED_VERSION]))
                ctx.log("HELLO from %s wants protocol %d..%d; refused" % (self.who, pmin, pmax))
            else:
                self.send(P.K_PONG, P.pong_payload(nonce, ctx.mac, ctx.device_id, ctx.fw))
                ahead = phone_ms / 1000.0 - time.time()
                clock = (
                    "phone clock differs from this device's by over a day (this device's clock is probably not set)"
                    if abs(ahead) > 86400
                    else "phone clock %+.1f s from this device's" % ahead
                )
                ctx.log("HELLO from %s (nonce 0x%08x, %s) -> PONG sent" % (self.who, nonce, clock))
        elif kind == P.K_PING:
            self.pings += 1
            ctx.bump("ping")
            self.send(P.K_STATUS, self.status_bytes())
            if not ctx.quiet:
                ctx.log("PING #%d (seq %d) from %s -> STATUS sent" % (self.pings, rx_seq, self.who))
        elif kind == P.K_START:
            ctx.bump("start")
            if not self.streaming:
                self.streaming = True
                self.cursor = ctx.engine.feed.next_seq
                now = time.monotonic()
                self.next_pd = now
                self.next_status = now
                self.next_report = now + 10
                ctx.engine.acquire()
                ctx.log(
                    "START from %s -> measuring%s (%s, %d sensors)"
                    % (self.who, " MADE-UP data" if ctx.engine.frontend.synthetic else "", ctx.source, ctx.engine.frontend.n_sensors)
                )
        elif kind == P.K_STOP:
            ctx.bump("stop")
            if self.streaming:
                self.stop_streaming()
                ctx.log("STOP from %s -> stream stopped (%d pulses sent)" % (self.who, self.pulses))

    def tick(self, now):
        if not self.streaming:
            return
        if now >= self.next_pd:
            self.next_pd = now + TICK_SECONDS
            events, self.cursor, dropped = self.ctx.engine.feed.read(self.cursor)
            for start in range(0, len(events), P.MAX_EVENTS_PER_FRAME):
                chunk = events[start : start + P.MAX_EVENTS_PER_FRAME]
                t0 = min(e.t for e in chunk)
                payload = P.pd_events_payload(
                    [(max(0.0, e.t - t0) * 1e6, e.amp_counts, e.phase16, e.width_ns, e.polarity, e.sensor) for e in chunk]
                )
                more = P.FLAG_MORE if start + P.MAX_EVENTS_PER_FRAME < len(events) else 0
                lost = P.FLAG_DROPPED_BEFORE if dropped and start == 0 else 0
                self.send(P.K_PD_EVENT, payload, at=t0, flags=more | lost)
                self.pulses += len(chunk)
                self.ctx.bump("pulses", len(chunk))
        if now >= self.next_status:
            self.next_status = now + STATUS_SECONDS
            self.send(P.K_STATUS, self.status_bytes())
            self.ctx.bump("status")
        if now >= self.next_report:
            self.next_report = now + 10
            if not self.ctx.quiet:
                s = self.ctx.engine.status()
                self.ctx.log(
                    "streaming to %s: %d pulses in the last 10 s (%d a second now, mains %s)"
                    % (self.who, self.pulses - self.reported, round(s["rate_hz"]), "locked" if s["locked"] else "NOT locked")
                )
            self.reported = self.pulses


def serve_connection(conn, addr, ctx):
    who = "%s:%d" % (addr[0], addr[1])
    ctx.log("%s connected" % who)
    ctx.bump("connections")
    ctx.peers.add(addr[0])
    conn.settimeout(SEND_TIMEOUT_SECONDS)
    session = Session(conn, who, ctx)
    buf = b""
    last_rx = time.monotonic()
    try:
        while not ctx.stop.is_set():
            readable, _w, _x = select.select([conn], [], [], TICK_SECONDS)
            now = time.monotonic()
            if readable:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                last_rx = now
                frames, buf = P.extract_frames(buf + chunk)
                for kind, rx_seq, payload in frames:
                    session.on_frame(kind, rx_seq, payload)
            elif now - last_rx > IDLE_SECONDS:
                ctx.log("%s idle for %d s, closing" % (who, IDLE_SECONDS))
                break
            session.tick(time.monotonic())
    except (OSError, socket.error) as error:
        ctx.log("%s error: %s" % (who, error))
    finally:
        session.stop_streaming()
        try:
            conn.close()
        except OSError:
            pass
        ctx.log("%s closed (%d keep-alives answered, %d pulses sent)" % (who, session.pings, session.pulses))


def accept_loop(server, ctx):
    active = [0]
    lock = threading.Lock()

    def run(conn, addr):
        try:
            serve_connection(conn, addr, ctx)
        finally:
            with lock:
                active[0] -= 1

    server.settimeout(0.5)
    while not ctx.stop.is_set():
        try:
            conn, addr = server.accept()
        except socket.timeout:
            continue
        except OSError:
            break
        with lock:
            if active[0] >= MAX_CONNECTIONS:
                conn.close()
                continue
            active[0] += 1
        threading.Thread(target=run, args=(conn, addr), daemon=True).start()


def beacon_loop(ctx, tcp_port):
    plain, pinned = beacon_sockets(ctx.iface)
    datagram = P.beacon_datagram(tcp_port, ctx.mac, ctx.device_id, ctx.fw)
    shown = None
    failures = {}
    while not ctx.stop.is_set():
        targets = [ctx.beacon_target] if ctx.beacon_target else beacon_targets(ctx.iface)
        if targets != shown:
            ctx.log("beacon -> %s" % ", ".join(targets))
            shown = targets
        for target in targets:
            sock = pinned if (target == "255.255.255.255" and pinned is not None) else plain
            try:
                sock.sendto(datagram, (target, ctx.beacon_port))
                if failures.pop(target, None) is not None:
                    ctx.log("beacon to %s works again" % target)
            except OSError as error:
                if failures.get(target) != str(error):
                    failures[target] = str(error)
                    ctx.log("beacon to %s failed: %s" % (target, error))
        ctx.stop.wait(1.0)


class Context(object):
    """What every session shares."""

    def __init__(self, engine, source, mac, device_id, iface, beacon_port, beacon_target, quiet, log, fw=(0, 1, 0)):
        self.engine = engine
        self.source = source
        self.mac = mac
        self.device_id = device_id
        self.iface = iface
        self.beacon_port = beacon_port
        self.beacon_target = beacon_target
        self.quiet = quiet
        self.fw = fw
        self._log = log
        self.stop = threading.Event()
        self.peers = set()
        self.stats = {"connections": 0, "hello": 0, "ping": 0, "status": 0, "start": 0, "stop": 0, "pulses": 0}
        self._lock = threading.Lock()

    def log(self, text):
        self._log("%s %s" % (time.strftime("%H:%M:%S"), text))

    def bump(self, key, amount=1):
        with self._lock:
            self.stats[key] += amount
