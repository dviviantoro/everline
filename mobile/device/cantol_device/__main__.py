"""python3 -m cantol_device run | selftest   (see --help)"""
import argparse
import os
import signal
import socket
import sys
import threading
import time

import numpy as np

from . import VERSION
from . import server as S
from .dsp import Calibration, Detector, ReferenceTracker
from .engine import Engine, K_TRIGGER, MIN_TRIGGER_COUNTS

DEFAULT_PORT = 47000
DEFAULT_BEACON_PORT = 47001


def parser():
    p = argparse.ArgumentParser(
        prog="python3 -m cantol_device",
        description="Cantol measurement software: finds partial discharge pulses on three sensors "
        "(channels 2 to 4), gives each its phase of the mains cycle (channel 1) and streams them to the app.",
    )
    p.add_argument("command", choices=["run", "selftest"])
    p.add_argument("--source", choices=["redpitaya", "simulated", "pdsim"], default="redpitaya", help="where the samples come from: the board's inputs, made-up pulses, or a replay of pd-simulator (default redpitaya)")
    p.add_argument("--sensors", type=int, default=3, help="how many sensors, channels 2 and up (default 3)")
    p.add_argument("--adc-range", choices=["lv", "hv"], default="lv", help="the input jumper: lv is +-1 V, hv is +-20 V (default lv)")
    p.add_argument("--sensor-gain-db", default="", help="gain between each sensor and its input, dB, comma-separated (an attenuator of 20 dB is +20)")
    p.add_argument("--ref-invert", action="store_true", help="the reference is wired upside down: add 180 degrees")
    p.add_argument("--phase-offset", type=float, default=0.0, help="degrees added to every phase (a fixed shift in the reference path)")
    p.add_argument("--ref-min-counts", type=float, default=300.0, help="smallest reference amplitude, ADC counts, that counts as a mains reference (default 300)")
    g = p.add_argument_group("link")
    g.add_argument("--port", type=int, default=DEFAULT_PORT, help="TCP port (0: any free one; default 47000)")
    g.add_argument("--beacon-port", type=int, default=DEFAULT_BEACON_PORT, help="UDP port the app listens on (default 47001)")
    g.add_argument("--bind", default="0.0.0.0")
    g.add_argument("--mac", default="", help="MAC address to report (default: the Ethernet one, the label's)")
    g.add_argument("--device-id", default="", help="id to report, up to 8 characters (default RP- and the last two MAC bytes)")
    g.add_argument("--iface", default="", help="network interface for the beacon (default: all attached subnets)")
    g.add_argument("--beacon-target", default="", help="send the beacon only here")
    g.add_argument("--duration", type=int, default=0, help="stop after this many seconds (default: until Ctrl-C)")
    g.add_argument("--quiet", action="store_true", help="do not log every keep-alive or the 10-second summary")
    s = p.add_argument_group("red pitaya")
    s.add_argument("--scpi-host", default="127.0.0.1")
    s.add_argument("--scpi-port", type=int, default=5000)
    m = p.add_argument_group("simulated source")
    m.add_argument("--level", type=float, default=38.0, help="level of the made-up pulses, dBmV (default 38)")
    m.add_argument("--seed", type=int, default=1)
    m.add_argument("--no-ref", action="store_true", help="the made-up reference is missing, as if channel 1 were not wired")
    m.add_argument("--mains-hz", type=float, default=50.0)
    d = p.add_argument_group("pd-simulator replay (--source pdsim)")
    d.add_argument("--pdsim-dir", default="", help="the folder holding pd-simulator's signals.py (default: ../pd-simulator in the repository, else /cantol/pd-simulator)")
    d.add_argument("--pdsim-config", default="", help="a JSON file of pd-simulator settings (its GeneratorConfig names); read again when it changes")
    d.add_argument("--pdsim-coupling-db", default="0,-6,-12", help="how much of W2 reaches each sensor input, dB, comma-separated (default 0,-6,-12)")
    return p


def find_pdsim_dir(given):
    here = os.path.dirname(os.path.abspath(__file__))
    for candidate in ([given] if given else [os.path.join(here, "..", "..", "..", "pd-simulator"), "/cantol/pd-simulator"]):
        if os.path.isfile(os.path.join(candidate, "signals.py")):
            return os.path.abspath(candidate)
    return None


def check(args, p):
    if not 1 <= args.sensors <= 3 and args.source == "redpitaya":
        p.error("--sensors must be 1 to 3 on a four-input Red Pitaya (channel 1 is the reference)")
    if not 1 <= args.sensors <= 8:
        p.error("--sensors must be 1 to 8")
    for name in ("port", "beacon_port", "scpi_port"):
        if not 0 <= getattr(args, name) <= 65535:
            p.error("--%s must be 0 to 65535" % name.replace("_", "-"))
    if args.beacon_port == 0 or args.scpi_port == 0:
        p.error("--beacon-port and --scpi-port must be 1 to 65535")
    if not 0.0 <= args.level <= 90.0:
        p.error("--level must be 0 to 90 dBmV")
    if args.mac:
        parts = args.mac.replace("-", ":").split(":")
        try:
            ok = len(parts) == 6 and all(len(x) == 2 for x in parts) and any(int(x, 16) for x in parts)
        except ValueError:
            ok = False
        if not ok:
            p.error("--mac must look like 00:26:32:AB:CD:EF (and not be all zeros)")
        args.mac = ":".join(parts).upper()
    if args.device_id and not (1 <= len(args.device_id) <= 8 and args.device_id.replace("-", "").replace("_", "").replace(".", "").isalnum()):
        p.error("--device-id must be 1 to 8 letters, digits, '.', '_' or '-'")
    try:
        args.gains = [float(x) for x in args.sensor_gain_db.split(",")] if args.sensor_gain_db else []
    except ValueError:
        p.error("--sensor-gain-db must be numbers separated by commas")
    if args.source == "pdsim":
        args.pdsim_path = find_pdsim_dir(args.pdsim_dir)
        if args.pdsim_path is None:
            p.error("pd-simulator's signals.py was not found; give the folder with --pdsim-dir")
        try:
            args.coupling = [float(x) for x in args.pdsim_coupling_db.split(",")]
        except ValueError:
            p.error("--pdsim-coupling-db must be numbers separated by commas")


def build(args):
    if args.source == "simulated":
        from .frontend import SimulatedFrontEnd

        front = SimulatedFrontEnd(
            n_sensors=args.sensors, level_dbmv=args.level, seed=args.seed, mains_hz=args.mains_hz,
            with_ref=not args.no_ref, adc_range=args.adc_range,
        )
    elif args.source == "pdsim":
        from .pdsim import PdSimFrontEnd

        front = PdSimFrontEnd(
            args.pdsim_path, args.pdsim_config, n_sensors=args.sensors, adc_range=args.adc_range,
            coupling_db=args.coupling, seed=args.seed, log=lambda text: print(time.strftime("%H:%M:%S ") + text, flush=True),
        )
    else:
        from .scpi import RedPitayaFrontEnd

        front = RedPitayaFrontEnd(args.scpi_host, args.scpi_port, args.sensors, args.adc_range)
    tracker = ReferenceTracker(min_amplitude=args.ref_min_counts, invert=args.ref_invert, phase_offset_deg=args.phase_offset)
    calibration = Calibration(args.sensors, args.adc_range, args.gains)
    return front, Detector(), tracker, calibration


def run(args):
    front, detector, tracker, calibration = build(args)

    def log(text):
        sys.stdout.write(text + "\n")
        sys.stdout.flush()

    mac = args.mac or S.default_mac(args.iface)
    if not mac:
        sys.stderr.write("cantol_device: no MAC address found: pass one with --mac 00:26:32:AB:CD:EF\n")
        return 2
    device_id = args.device_id or "RP-" + mac.replace(":", "")[-4:]
    engine = Engine(front, detector, tracker, calibration, log=lambda t: log(time.strftime("%H:%M:%S") + " " + t))
    ctx = S.Context(
        engine, args.source, bytes(int(x, 16) for x in mac.split(":")), device_id.encode("ascii").ljust(8, b"\x00"),
        args.iface, args.beacon_port, args.beacon_target, args.quiet, log,
    )
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        server.bind((args.bind, args.port))
    except OSError as error:
        sys.stderr.write("cantol_device: cannot listen on %s:%d: %s\n" % (args.bind, args.port, error))
        return 1
    server.listen(8)
    tcp_port = server.getsockname()[1]
    ctx.log("Cantol measurement %s, source %s%s" % (VERSION, args.source, " (MADE-UP data)" if front.synthetic else ""))
    ctx.log("listening on TCP %s:%d, device id %s, MAC %s" % (args.bind, tcp_port, device_id, mac))

    def on_signal(_n, _f):
        ctx.stop.set()

    signal.signal(signal.SIGINT, on_signal)
    signal.signal(signal.SIGTERM, on_signal)
    engine.start()
    threading.Thread(target=S.beacon_loop, args=(ctx, tcp_port), daemon=True).start()
    threading.Thread(target=S.accept_loop, args=(server, ctx), daemon=True).start()
    started = time.time()
    while not ctx.stop.wait(0.5):
        if args.duration and time.time() - started >= args.duration:
            break
    ctx.stop.set()
    server.close()
    engine.stop()
    engine.join(2.0)
    st = ctx.stats
    ctx.log(
        "stopped: %d connections, %d HELLO, %d PING, %d START and %d STOP, %d pulses sent; phones seen: %s"
        % (st["connections"], st["hello"], st["ping"], st["start"], st["stop"], st["pulses"], ", ".join(sorted(ctx.peers)) or "none")
    )
    return 0


def selftest(args):
    """What the board and the software make of each other; prints facts, never guesses."""
    front, detector, tracker, calibration = build(args)
    print("Cantol measurement %s selftest, source %s" % (VERSION, args.source))
    print("  python %s, numpy %s" % (sys.version.split()[0], np.__version__))
    try:
        front.open()
    except Exception as error:
        print("  FAILED to open the front end: %s" % error)
        return 1
    if getattr(front, "idn", ""):
        print("  board: %s" % front.idn)
    ok = True
    now = time.monotonic()
    cap = front.capture_free()
    print("  free capture: %d samples at %.1f ns" % (cap.ref.size, cap.dt * 1e9))
    channels = [("ref (channel 1)", cap.ref)] + [("sensor %d (channel %d)" % (k + 1, k + 2), x) for k, x in enumerate(cap.pd)]
    for name, x in channels:
        print("    %-22s min %6d  max %6d  mean %8.1f  sigma %6.1f counts" % (name, x.min(), x.max(), x.mean(), 1.4826 * np.median(np.abs(x - np.median(x)))))
    ref = front.capture_reference()
    good = tracker.update(ref, time.monotonic())
    if tracker.freq is not None:
        print("  reference: %.3f Hz, amplitude %.0f counts, offset %.0f, fit residual %.1f counts -> %s" % (tracker.freq, tracker.amplitude, tracker.offset, tracker.residual, "LOCKED" if good else "not a mains reference"))
    if not good:
        print("  (phase pattern needs a mains reference of at least %.0f counts on channel 1; activity readings do not)" % tracker.min_amplitude)
        ok = ok and args.no_ref
    n = 0
    t_end = time.monotonic() + 2.0
    while time.monotonic() < t_end:
        front.capture_free()
        n += 1
    print("  free captures: %.0f a second" % (n / 2.0))
    # Take turns on every sensor and edge for six seconds, as the engine does.
    plan = [(s, e) for s in range(args.sensors) for e in ("pos", "neg")]
    sigma = [max(1.5, detector.process(cap)[1][k]) for k in range(args.sensors)]
    hits = [0] * args.sensors
    tries = 0
    seen = [0] * args.sensors
    phases = []
    t_end = time.monotonic() + 6.0
    while time.monotonic() < t_end:
        sensor, edge = plan[tries % len(plan)]
        tries += 1
        c = front.capture_triggered(sensor, edge, max(K_TRIGGER * sigma[sensor], MIN_TRIGGER_COUNTS), 0.010)
        if c is None:
            continue
        hits[sensor] += 1
        pulses, _s, _c = detector.process(c)
        for p in pulses:
            seen[p.sensor] += 1
        from .dsp import to_events

        phases += [e.phase16 for e in to_events(c, pulses, tracker, calibration, time.monotonic())]
    print("  triggers in 6 s: %s (of %d tries)" % (", ".join("sensor %d: %d" % (k + 1, h) for k, h in enumerate(hits)), tries))
    print("  pulses found:    %s" % ", ".join("sensor %d: %d" % (k + 1, h) for k, h in enumerate(seen)))
    if phases and tracker.locked(time.monotonic()):
        deg = np.array(phases) / 65536.0 * 360.0
        lobes = np.mean(((deg > 60) & (deg < 120)) | ((deg > 240) & (deg < 300)))
        print("  phase of those pulses: %.0f%% fall near 90 or 270 degrees" % (100 * lobes))
    front.close()
    print("  done")
    return 0 if ok else 1


def main(argv=None):
    p = parser()
    args = p.parse_args(argv)
    check(args, p)
    return run(args) if args.command == "run" else selftest(args)


if __name__ == "__main__":
    sys.exit(main())
