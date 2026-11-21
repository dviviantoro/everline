#!/bin/sh
# cantol-pingpong.sh -- bring-up tool for the Cantol device (a Red Pitaya). Run it ON the device.
#
# It does three things:
#
#   1. Searches the network: finds the Wi-Fi link to the phone's hotspot, the phone itself (the
#      hotspot's gateway), and every other host that answers; pings the phone.
#   2. Plays ping-pong with the Cantol mobile app, using the app's own protocol: it answers the
#      app's HELLO with a PONG that carries this device's MAC address, answers each keep-alive PING
#      with a STATUS frame, and broadcasts the discovery beacon so the app can find it.
#   3. Streams MADE-UP pulses to the app once the app sends Start, so the app's Live screen can be
#      tried before the real measurement software exists. Every STATUS it sends carries the
#      "synthetic" flag, and the app shows "Test data" while it is set.
#
# It is NOT the measurement software: nothing it sends is measured. It proves that the phone and
# the device can reach each other, that the app accepts this device (its MAC address is what the
# operator typed from the label), and that pulses make it onto the Live screen.
#
#   sh cantol-pingpong.sh                run: search, then answer the app until Ctrl-C
#   sh cantol-pingpong.sh scan           search the network once and print what was found
#   sh cantol-pingpong.sh info           print this device's Wi-Fi link and the value for the app
#   sh cantol-pingpong.sh help           this text and the options
#
# Needs: a POSIX sh, iproute2 (ip), ping, awk, sed; python3 for the ping-pong part (Red Pitaya OS
# has it). It changes nothing on the device: it joins no network, writes no configuration and only
# opens TCP port 47000 and sends UDP datagrams to port 47001 (both can be changed).
#
# The protocol is the placeholder one in mobile/rust/cantol-proto (ADR-005 is not written yet).
# The frame layout is repeated in the python part below; mobile/rust/cantol-mock/tests/device_script.rs
# runs this script against the app's own Rust codec, so a change on either side fails there.

set -u

VERSION="0.2.0"
PROG="cantol-pingpong"

CMD="run"
IFACE_OPT=""
MAC_OPT=""
DEVICE_ID_OPT=""
PORT=47000
BEACON_PORT=47001
BIND="0.0.0.0"
BEACON_TARGET=""
SSID_EXPECTED=""
DURATION=0
SEARCH=1
QUIET=0
LEVEL=38
SEED=1
NO_STREAM=0
NO_MAINS_LOCK=0

say() { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }
die() { warn "$PROG: $*"; exit 2; }

usage() {
  cat <<'EOF'
usage: sh cantol-pingpong.sh [run|scan|info|help] [options]

  run     (default) search the network, then answer the app until Ctrl-C
  scan    search the network once and print what was found
  info    print the Wi-Fi link and the MAC address to type into the app
  help    this text

options:
  --iface NAME          network interface to use          (default: the Wi-Fi one that has an address)
  --mac AA:BB:CC:DD:EE:FF
                        MAC address to report             (default: the interface's own address)
  --device-id TEXT      id to report, up to 8 characters  (default: RP- and the last two MAC bytes)
  --ssid NAME           the hotspot name on the label; only used to tell you if it differs
  --port N              TCP port to answer on             (default 47000; 0 picks a free one)
  --beacon-port N       UDP port the app listens on       (default 47001)
  --bind ADDR           address to listen on              (default 0.0.0.0)
  --beacon-target ADDR  send the beacon only to this address (default: the subnet and the phone)
  --duration SECONDS    stop after this long              (default: until Ctrl-C)
  --no-search           skip the sweep of the network (the beacon and the answers still run)
  --quiet               log only connections, HELLO, START and STOP, not every keep-alive
  --level DBMV          level of the made-up pulses, 0 to 90  (default 38; it drifts a few dB each minute)
  --seed N              seed of the made-up signal            (default 1: the same signal every run)
  --no-stream           answer the handshake and keep-alives only; ignore Start
  --no-mains-lock       report that the mains reference is not locked (the app then hides the phase plot)
  -h, --help            this text

In the app: enter the hotspot name, password and the MAC address printed by this tool (or the one
on the label), turn the phone's hotspot on, and watch this window for HELLO and PING lines. When the
app's Live screen opens it sends Start and this window shows START; stepping out of the Live screen
sends STOP. The pulses are made up and are labelled so in the app.
EOF
}

need_value() {
  [ "$#" -ge 2 ] || die "$1 needs a value"
}

is_number() {
  case "$1" in
    '' | *[!0-9]*) return 1 ;;
  esac
  return 0
}

normalise_mac() {
  printf '%s' "$1" | grep -Eq '^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$' || return 1
  printf '%s' "$1" | tr 'abcdef-' 'ABCDEF:'
}

# ---------------------------------------------------------------------------------------------
# Arguments

case "${1:-}" in
  run | scan | info | help)
    CMD=$1
    shift
    ;;
  -h | --help)
    CMD=help
    shift
    ;;
esac

while [ "$#" -gt 0 ]; do
  case "$1" in
    --iface) need_value "$@"; IFACE_OPT=$2; shift 2 ;;
    --mac) need_value "$@"; MAC_OPT=$2; shift 2 ;;
    --device-id) need_value "$@"; DEVICE_ID_OPT=$2; shift 2 ;;
    --ssid) need_value "$@"; SSID_EXPECTED=$2; shift 2 ;;
    --port) need_value "$@"; PORT=$2; shift 2 ;;
    --beacon-port) need_value "$@"; BEACON_PORT=$2; shift 2 ;;
    --bind) need_value "$@"; BIND=$2; shift 2 ;;
    --beacon-target) need_value "$@"; BEACON_TARGET=$2; shift 2 ;;
    --duration) need_value "$@"; DURATION=$2; shift 2 ;;
    --no-search) SEARCH=0; shift ;;
    --quiet) QUIET=1; shift ;;
    --level) need_value "$@"; LEVEL=$2; shift 2 ;;
    --seed) need_value "$@"; SEED=$2; shift 2 ;;
    --no-stream) NO_STREAM=1; shift ;;
    --no-mains-lock) NO_MAINS_LOCK=1; shift ;;
    -h | --help) CMD=help; shift ;;
    *) die "unknown option $1 (try: sh $0 help)" ;;
  esac
done

if [ "$CMD" = "help" ]; then
  usage
  exit 0
fi

is_number "$PORT" && [ "$PORT" -le 65535 ] || die "--port must be a number from 0 to 65535"
is_number "$BEACON_PORT" && [ "$BEACON_PORT" -ge 1 ] && [ "$BEACON_PORT" -le 65535 ] || die "--beacon-port must be a number from 1 to 65535"
is_number "$DURATION" || die "--duration must be a number of seconds"
is_number "$SEED" || die "--seed must be a whole number"
# --level: digits with an optional decimal part, no more than 90.
printf '%s' "$LEVEL" | grep -Eq '^[0-9]{1,2}(\.[0-9]+)?$' && [ "${LEVEL%%.*}" -le 90 ] || die "--level must be a number of dBmV from 0 to 90"
if [ -n "$MAC_OPT" ]; then
  MAC_OPT=$(normalise_mac "$MAC_OPT") || die "--mac must look like 00:26:32:F0:1A:BC"
  [ "$MAC_OPT" != "00:00:00:00:00:00" ] || die "--mac 00:00:00:00:00:00 means \"no MAC\" and cannot be used"
fi
if [ -n "$DEVICE_ID_OPT" ]; then
  printf '%s' "$DEVICE_ID_OPT" | grep -Eq '^[A-Za-z0-9._-]{1,8}$' || die "--device-id must be 1 to 8 letters, digits, '.', '_' or '-'"
fi

# ---------------------------------------------------------------------------------------------
# Searching the network

# The interfaces the kernel says are Wi-Fi.
wireless_ifaces() {
  for dir in /sys/class/net/*; do
    name=${dir##*/}
    if [ -d "$dir/wireless" ] || [ -d "$dir/phy80211" ]; then
      printf '%s\n' "$name"
    fi
  done
}

# "192.168.43.20/24" for an interface, or nothing.
ipv4_of() {
  ip -4 -o addr show dev "$1" 2>/dev/null | awk '{ print $4; exit }'
}

# The hotspot name this interface is joined to, from whichever tool the device has.
current_ssid() {
  found=""
  if command -v iwgetid >/dev/null 2>&1; then
    found=$(iwgetid -r "$1" 2>/dev/null)
  fi
  if [ -z "$found" ] && command -v iw >/dev/null 2>&1; then
    found=$(iw dev "$1" link 2>/dev/null | sed -n 's/^[[:space:]]*SSID: //p')
  fi
  if [ -z "$found" ] && command -v wpa_cli >/dev/null 2>&1; then
    found=$(wpa_cli -i "$1" status 2>/dev/null | sed -n 's/^ssid=//p')
  fi
  printf '%s' "$found"
}

# Fills IFACE, CIDR, IP, PREFIX, GATEWAY, BROADCAST, MAC, SSID_NOW from the system as it is now.
# IFACE is empty while no suitable interface has an address.
net_refresh() {
  IFACE=""; CIDR=""; IP=""; PREFIX=""; GATEWAY=""; BROADCAST=""; MAC=""; SSID_NOW=""
  if [ -n "$IFACE_OPT" ]; then
    candidates=$IFACE_OPT
  else
    candidates=$(wireless_ifaces)
  fi
  for name in $candidates; do
    cidr=$(ipv4_of "$name")
    if [ -n "$cidr" ]; then
      IFACE=$name
      CIDR=$cidr
      break
    fi
  done
  [ -n "$IFACE" ] || return 1
  IP=${CIDR%/*}
  PREFIX=${CIDR#*/}
  GATEWAY=$(ip -4 route show default dev "$IFACE" 2>/dev/null | awk '/^default/ { for (i = 1; i < NF; i++) if ($i == "via") { print $(i + 1); exit } }')
  BROADCAST=$(ip -4 -o addr show dev "$IFACE" 2>/dev/null | awk '{ for (i = 1; i < NF; i++) if ($i == "brd") { print $(i + 1); exit } }')
  if [ -r "/sys/class/net/$IFACE/address" ]; then
    MAC=$(tr 'a-f' 'A-F' <"/sys/class/net/$IFACE/address")
  fi
  SSID_NOW=$(current_ssid "$IFACE")
  return 0
}

# Where the beacon goes: the subnet broadcast (reaches every phone-side listener), the phone itself
# (the hotspot's gateway; a unicast arrives even where a broadcast is filtered) and the limited
# broadcast address. An explicit --beacon-target replaces all three.
beacon_targets() {
  if [ -n "$BEACON_TARGET" ]; then
    printf '%s\n' "$BEACON_TARGET"
    return
  fi
  [ -n "$BROADCAST" ] && printf '%s\n' "$BROADCAST"
  [ -n "$GATEWAY" ] && printf '%s\n' "$GATEWAY"
  printf '%s\n' "255.255.255.255"
}

# The last-octet range worth sweeping on this subnet, as "first last" (same first three octets).
sweep_range() {
  prefix=$1
  last_octet=${IP##*.}
  if [ "$prefix" -lt 24 ]; then
    prefix=24
  fi
  size=1
  steps=$((32 - prefix))
  while [ "$steps" -gt 0 ]; do
    size=$((size * 2))
    steps=$((steps - 1))
  done
  first=$(((last_octet / size) * size + 1))
  last=$((first + size - 3))
  [ "$last" -le 254 ] || last=254
  printf '%s %s\n' "$first" "$last"
}

# True for the address ranges a phone hotspot (or any home or lab network) uses. The sweep stays
# inside them: it is not meant to probe someone else's network.
is_private_ip() {
  case "$1" in
    10.* | 192.168.* | 169.254.* | 127.*) return 0 ;;
    172.1[6-9].* | 172.2[0-9].* | 172.3[01].*) return 0 ;;
  esac
  return 1
}

# Pings every address in the subnet once, in parallel batches, so the system learns who is there.
sweep() {
  set -- $(sweep_range "$PREFIX")
  first=$1
  last=$2
  stem=${IP%.*}
  (
    n=$first
    batch=0
    while [ "$n" -le "$last" ]; do
      if [ "$stem.$n" != "$IP" ]; then
        ping -c 1 -W 1 "$stem.$n" >/dev/null 2>&1 &
        batch=$((batch + 1))
        if [ "$batch" -ge 48 ]; then
          wait
          batch=0
        fi
      fi
      n=$((n + 1))
    done
    wait
  )
}

# Hosts the system has heard from on this interface: "ip mac state".
neighbours() {
  ip -4 neigh show dev "$IFACE" 2>/dev/null | awk '
    { mac = ""; state = $NF
      for (i = 1; i < NF; i++) if ($i == "lladdr") mac = $(i + 1)
      if (mac != "" && state != "FAILED" && state != "INCOMPLETE") print $1, mac, state }' |
    sort -t . -k 1,1n -k 2,2n -k 3,3n -k 4,4n
}

# "3 of 3 answered, average 4.2 ms" for a few pings to one host.
ping_summary() {
  out=$(ping -c 3 -W 1 "$1" 2>&1)
  got=$(printf '%s\n' "$out" | sed -n 's/.*, \([0-9][0-9]*\)\( packets\)\{0,1\} received.*/\1/p' | head -n 1)
  avg=$(printf '%s\n' "$out" | sed -n 's/.*= *[0-9.]*\/\([0-9.]*\)\/.*/\1/p' | head -n 1)
  got=${got:-0}
  if [ "$got" -gt 0 ] && [ -n "$avg" ]; then
    printf '%s of 3 answered, average %s ms' "$got" "$avg"
  else
    printf '%s of 3 answered' "$got"
  fi
}

print_link() {
  say "  interface : $IFACE ($CIDR)"
  if [ -n "$SSID_NOW" ]; then
    if [ -n "$SSID_EXPECTED" ] && [ "$SSID_NOW" != "$SSID_EXPECTED" ]; then
      say "  hotspot   : joined \"$SSID_NOW\", but the label says \"$SSID_EXPECTED\" -- the phone's hotspot must use the label's name"
    elif [ -n "$SSID_EXPECTED" ]; then
      say "  hotspot   : joined \"$SSID_NOW\" (matches the label)"
    else
      say "  hotspot   : joined \"$SSID_NOW\""
    fi
  else
    say "  hotspot   : the hotspot name could not be read (not joined, or no iw/iwgetid/wpa_cli)"
  fi
  if [ -n "$GATEWAY" ]; then
    say "  phone     : $GATEWAY (the hotspot's gateway)"
  else
    say "  phone     : no gateway on $IFACE, so the phone's address is unknown yet"
  fi
  say "  MAC       : ${MAC_OPT:-$MAC}"
}

search_report() {
  if ! net_refresh; then
    say "No Wi-Fi interface has an IPv4 address yet."
    say "  The device has not joined the phone's hotspot. Check that the hotspot is on, that its name"
    say "  and password are the ones on the label, and that it uses the 2.4 GHz band."
    if [ -n "$SSID_EXPECTED" ]; then
      say "  Expected hotspot name: $SSID_EXPECTED"
    fi
    return 1
  fi
  say "Wi-Fi link:"
  print_link
  if [ "$SEARCH" -eq 1 ] && ! is_private_ip "$IP"; then
    say "  $IP is not a private address, so the sweep is skipped (it only searches private networks)."
  elif [ "$SEARCH" -eq 1 ]; then
    say "Searching $(printf '%s' "$IP" | sed 's/\.[0-9]*$//').x ..."
    sweep
    seen=$(neighbours)
    if [ -n "$seen" ]; then
      printf '%s\n' "$seen" | while read -r host hostmac state; do
        note=""
        if [ "$host" = "$GATEWAY" ]; then
          note="  <- gateway: the phone with the hotspot"
        fi
        printf '  %-16s %s  %s%s\n' "$host" "$hostmac" "$state" "$note"
      done
    else
      say "  nothing answered on $IFACE"
    fi
    if [ -n "$GATEWAY" ]; then
      say "Ping to the phone ($GATEWAY): $(ping_summary "$GATEWAY")"
    fi
  fi
  return 0
}

# ---------------------------------------------------------------------------------------------
# info and scan

case "$CMD" in
  info)
    if net_refresh; then
      say "Wi-Fi link:"
      print_link
      say ""
      say "Type this MAC address into the app when it asks for the Cantol label: ${MAC_OPT:-$MAC}"
      exit 0
    fi
    say "No Wi-Fi interface has an IPv4 address yet (the device has not joined the hotspot)."
    for name in $(wireless_ifaces); do
      if [ -r "/sys/class/net/$name/address" ]; then
        say "  $name has MAC address $(tr 'a-f' 'A-F' <"/sys/class/net/$name/address")"
      fi
    done
    exit 1
    ;;
  scan)
    search_report
    exit $?
    ;;
esac

# ---------------------------------------------------------------------------------------------
# run: the ping-pong responder (python3) and a loop that keeps its beacon targets current

command -v python3 >/dev/null 2>&1 || {
  warn "$PROG: python3 is needed for the ping-pong part (the network search above does not need it)."
  warn "  'sh $0 scan' still works."
  exit 3
}

WORK=$(mktemp -d 2>/dev/null) || die "cannot create a temporary directory"
RESPONDER_PID=""
cleanup() {
  if [ -n "$RESPONDER_PID" ]; then
    pid=$RESPONDER_PID
    RESPONDER_PID=""
    kill -INT "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
  fi
  rm -rf "$WORK"
}
trap 'cleanup; exit 0' INT TERM
trap cleanup EXIT

say "Cantol ping-pong $VERSION -- bring-up tool, not the measurement software"
say ""
if [ "$SEARCH" -eq 1 ]; then
  search_report || say "The responder starts anyway and picks the link up when it appears."
else
  net_refresh || true
fi

MAC_USE=${MAC_OPT:-$MAC}
if [ -z "$MAC_USE" ] || [ "$MAC_USE" = "00:00:00:00:00:00" ]; then
  die "no usable MAC address (no Wi-Fi interface was found, or it reports none): pass one with --mac 00:26:32:F0:1A:BC"
fi
if [ -n "$DEVICE_ID_OPT" ]; then
  DEVICE_ID=$DEVICE_ID_OPT
else
  DEVICE_ID="RP-$(printf '%s' "$MAC_USE" | awk -F: '{ print $5 $6 }')"
fi

TARGETS="$WORK/targets"
beacon_targets >"$TARGETS"

# The python part, written out so that `python3 file` runs it (no quoting tricks, nothing on stdin).
cat >"$WORK/responder.py" <<'PYEOF'
# Answers the Cantol mobile app's handshake and keep-alive, streams MADE-UP pulses once the app sends
# Start, and broadcasts the discovery beacon. Compatible with Python 3.5 and later.
# Frame layout (little-endian), as in cantol-proto/frame.rs:
#   magic u16 0xCA57 | ver u8 | kind u8 | flags u8 | seq u32 | ts_us u64 | len u32 | payload | crc32 u32
import argparse
import math
import os
import random
import select
import signal
import socket
import struct
import sys
import threading
import time
import zlib

MAGIC_BYTES = b"\x57\xca"
VER = 1
HEADER = struct.Struct("<HBBBIQI")
K_HELLO, K_PONG, K_STATUS, K_PD_EVENT = 0x01, 0x02, 0x03, 0x10
K_START, K_STOP, K_PING, K_ERROR = 0x20, 0x21, 0x30, 0x7F
ERR_UNSUPPORTED_VERSION = 1
MAX_PAYLOAD = 64 * 1024
MAX_CONNECTIONS = 16
IDLE_SECONDS = 30
TICK_SECONDS = 0.05
SEND_TIMEOUT_SECONDS = 5.0
FW = (0, 0, 2)
CAPS = 0
# Status.flags (cantol-proto/msg.rs): the second bit says "this data is generated, not measured".
STATUS_MAINS_LOCK = 0b01
STATUS_SYNTHETIC = 0b10

# The made-up signal. The factor is the placeholder calibration in cantol-dsp/src/calibration.rs
# (millivolts per ADC count); cantol-mock/tests/device_script.rs reads the pulses back through the
# app's own calibration, so a change on either side fails there.
MV_PER_COUNT = 0.1
NOISE_DBMV = 6.0
DRIFT_DB = 4.0
DRIFT_SECONDS = 60.0
MAX_RATE_HZ = 600

stats_lock = threading.Lock()
stats = {
    "connections": 0, "hello": 0, "pong": 0, "ping": 0, "status": 0, "refused": 0,
    "start": 0, "stop": 0, "pulses": 0,
}
peers = set()
stop = threading.Event()


def stamp():
    return time.strftime("%H:%M:%S")


def log(text):
    sys.stdout.write("{} {}\n".format(stamp(), text))
    sys.stdout.flush()


def bump(key, amount=1):
    with stats_lock:
        stats[key] += amount


def frame(kind, seq, payload, ts_us=0):
    body = HEADER.pack(0xCA57, VER, kind, 0, seq & 0xFFFFFFFF, ts_us, len(payload)) + payload
    return body + struct.pack("<I", zlib.crc32(body) & 0xFFFFFFFF)


def extract_frames(buf):
    """Whole valid frames at the start of buf as (kind, seq, payload), and the bytes left over."""
    frames = []
    while True:
        at = buf.find(MAGIC_BYTES)
        if at < 0:
            return frames, (buf[-1:] if buf[-1:] == MAGIC_BYTES[:1] else b"")
        if at > 0:
            buf = buf[at:]
        if len(buf) < HEADER.size:
            return frames, buf
        _magic, ver, kind, _flags, seq, _ts, length = HEADER.unpack_from(buf)
        if length > MAX_PAYLOAD:
            buf = buf[1:]
            continue
        total = HEADER.size + length + 4
        if len(buf) < total:
            return frames, buf
        body = buf[: HEADER.size + length]
        (crc,) = struct.unpack_from("<I", buf, HEADER.size + length)
        if zlib.crc32(body) & 0xFFFFFFFF != crc:
            buf = buf[1:]
            continue
        if ver == VER:
            frames.append((kind, seq, buf[HEADER.size : HEADER.size + length]))
        buf = buf[total:]


def pong_payload(nonce, mac, device_id):
    return struct.pack(
        "<BH3s8sQI6s", VER, CAPS, bytes(FW), device_id, int(time.time() * 1000), nonce, mac
    )


def counts_for(dbmv):
    """ADC counts (at least 1, at most what an i16 holds) of a pulse of this many dBmV."""
    return max(1, min(32767, int(round(10 ** (dbmv / 20.0) / MV_PER_COUNT))))


class Signal(object):
    """The made-up measurement: a level that drifts a few dB up and down every minute, pulses
    clustered around 90 and 270 degrees of the mains cycle with a few strays, and a noise floor of
    about 6 dBmV. It is the same shape the app's demo build simulates. Nothing here is measured."""

    def __init__(self, level, seed, mains_lock):
        self.base = level
        self.rng = random.Random(seed)
        self.started = time.time()
        self.mains_lock = mains_lock
        self.carry = 0.0

    def level(self, now):
        return self.base + DRIFT_DB * math.sin(2 * math.pi * (now - self.started) / DRIFT_SECONDS)

    def rate(self, now):
        return min(MAX_RATE_HZ, int(round(40 + 10 * max(0.0, self.level(now) - NOISE_DBMV))))

    def status(self, now, queue=0):
        flags = STATUS_SYNTHETIC | (STATUS_MAINS_LOCK if self.mains_lock else 0)
        noise = counts_for(NOISE_DBMV) + self.rng.randint(-1, 1)
        temp_x10 = int(round(410 + 4 * math.sin((now - self.started) / 20.0)))
        # temp_c_x10, adc_clip_pct_x10, noise_floor_counts, trigger_rate_hz, queue, flags
        return struct.pack("<hHHHHB", temp_x10, 3, noise, self.rate(now), queue, flags)

    def pulses(self, now, span_s):
        """One batch for the last span_s seconds, as a PdEvent payload, and how many pulses it has."""
        self.carry += self.rate(now) * span_s
        count = int(self.carry)
        self.carry -= count
        if count == 0:
            return None, 0
        level = self.level(now)
        rng = self.rng
        out = [struct.pack("<H", count)]
        for i in range(count):
            if rng.random() < 0.03:
                degrees = rng.uniform(0, 360)
                polarity = 0 if degrees < 180 else 1
                amp = NOISE_DBMV + abs(rng.gauss(0, 1)) * 0.6
            else:
                polarity = 0 if rng.random() < 0.5 else 1
                centre = 90.0 if polarity == 0 else 270.0
                degrees = centre + max(-19.5, min(19.5, rng.gauss(0, 10)))
                amp = level - min(3.0, abs(rng.gauss(0, 1)))
            counts = counts_for(amp) * (1 if polarity == 0 else -1)
            phase = int(round(degrees / 360.0 * 65536)) % 65536
            t_us = int((i + 0.5) * span_s * 1e6 / count)
            out.append(struct.pack("<IhHHBB", t_us, counts, phase, rng.randint(40, 600), polarity, 0))
        return b"".join(out), count


class Session(object):
    """One phone connected to this device. Everything for it happens on its own thread, so the
    frames it sends never interleave: answers to the phone, and the stream once it has asked."""

    def __init__(self, conn, who, args, mac, device_id):
        self.conn = conn
        self.who = who
        self.args = args
        self.mac = mac
        self.device_id = device_id
        self.signal = Signal(args.level, args.seed, not args.no_mains_lock)
        self.opened = time.time()
        self.seq = 0
        self.streaming = False
        self.next_pd = 0.0
        self.next_status = 0.0
        self.next_report = 0.0
        self.last_pd = 0.0
        self.pulses = 0
        self.reported_pulses = 0
        self.pings = 0

    def send(self, kind, payload):
        # The header's clock is microseconds since this connection opened, read when the frame is
        # sent, so it never goes backwards.
        ts_us = max(0, int((time.time() - self.opened) * 1e6))
        self.conn.sendall(frame(kind, self.seq, payload, ts_us))
        self.seq = (self.seq + 1) & 0xFFFFFFFF

    def on_frame(self, kind, rx_seq, payload):
        who = self.who
        if kind == K_HELLO and len(payload) >= 14:
            pmin, pmax, nonce, phone_ms = struct.unpack_from("<BBIQ", payload)
            bump("hello")
            if pmin > VER or pmax < VER:
                self.send(K_ERROR, bytes([ERR_UNSUPPORTED_VERSION]))
                bump("refused")
                log("HELLO from {} wants protocol {}..{}; refused".format(who, pmin, pmax))
            else:
                self.send(K_PONG, pong_payload(nonce, self.mac, self.device_id))
                bump("pong")
                ahead = phone_ms / 1000.0 - time.time()
                if abs(ahead) > 86400:
                    clock = "phone clock differs from this device's by over a day (this device's clock is probably not set)"
                else:
                    clock = "phone clock {:+.1f} s from this device's".format(ahead)
                log("HELLO from {} (nonce 0x{:08x}, {}) -> PONG sent".format(who, nonce, clock))
        elif kind == K_PING:
            self.pings += 1
            bump("ping")
            self.send(K_STATUS, self.signal.status(time.time()))
            bump("status")
            if not self.args.quiet:
                log("PING #{} (seq {}) from {} -> STATUS sent".format(self.pings, rx_seq, who))
        elif kind == K_START:
            bump("start")
            if self.args.no_stream:
                log("START from {} ignored (--no-stream)".format(who))
            elif not self.streaming:
                now = time.time()
                self.streaming = True
                self.next_pd = now
                self.next_status = now
                self.next_report = now + 10
                self.last_pd = now
                log(
                    "START from {} -> streaming MADE-UP pulses (level about {:.0f} dBmV, about {}/s)".format(
                        who, self.signal.base, self.signal.rate(now)
                    )
                )
        elif kind == K_STOP:
            bump("stop")
            if self.streaming:
                self.streaming = False
                log("STOP from {} -> stream stopped ({} pulses sent)".format(who, self.pulses))

    def tick(self, now):
        """Sends what is due: a batch of pulses every 50 ms and a status every second."""
        if not self.streaming:
            return
        if now >= self.next_pd:
            # A stall of the whole device is not made up for with a huge batch: at most half a second.
            began = max(self.last_pd, now - 0.5)
            payload, count = self.signal.pulses(now, now - began)
            self.last_pd = now
            self.next_pd = now + TICK_SECONDS
            if count:
                self.send(K_PD_EVENT, payload)
                self.pulses += count
                bump("pulses", count)
        if now >= self.next_status:
            self.next_status = now + 1.0
            self.send(K_STATUS, self.signal.status(now))
            bump("status")
        if now >= self.next_report:
            self.next_report = now + 10
            if not self.args.quiet:
                log(
                    "streaming to {}: {} pulses in the last 10 s (level now {:.1f} dBmV)".format(
                        self.who, self.pulses - self.reported_pulses, self.signal.level(now)
                    )
                )
            self.reported_pulses = self.pulses


def serve_connection(conn, addr, args, mac, device_id):
    who = "{}:{}".format(addr[0], addr[1])
    log("{} connected".format(who))
    bump("connections")
    peers.add(addr[0])
    # Waiting for input uses select, so this timeout only bounds a send to a phone that stopped reading.
    conn.settimeout(SEND_TIMEOUT_SECONDS)
    session = Session(conn, who, args, mac, device_id)
    buf = b""
    last_rx = time.time()
    try:
        while not stop.is_set():
            readable, _, _ = select.select([conn], [], [], TICK_SECONDS)
            now = time.time()
            if readable:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                last_rx = now
                frames, buf = extract_frames(buf + chunk)
                for kind, rx_seq, payload in frames:
                    session.on_frame(kind, rx_seq, payload)
            elif now - last_rx > IDLE_SECONDS:
                log("{} idle for {} s, closing".format(who, IDLE_SECONDS))
                break
            session.tick(time.time())
    except (OSError, socket.error) as error:
        log("{} error: {}".format(who, error))
    finally:
        try:
            conn.close()
        except OSError:
            pass
        log("{} closed ({} keep-alives answered, {} pulses sent)".format(who, session.pings, session.pulses))


def accept_loop(server, args, mac, device_id):
    active = [0]
    lock = threading.Lock()

    def run(conn, addr):
        try:
            serve_connection(conn, addr, args, mac, device_id)
        finally:
            with lock:
                active[0] -= 1

    server.settimeout(0.5)
    while not stop.is_set():
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


def beacon_sockets(iface):
    """(plain, pinned): one socket for unicast and subnet broadcasts, and one tied to the Wi-Fi
    interface for the limited broadcast address 255.255.255.255, which the routing table would
    otherwise send out of whichever interface is the default (the Ethernet port, say)."""
    plain = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    plain.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    pinned = None
    if iface and hasattr(socket, "SO_BINDTODEVICE"):
        pinned = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        pinned.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        try:
            pinned.setsockopt(socket.SOL_SOCKET, socket.SO_BINDTODEVICE, iface.encode())
        except OSError:
            pinned.close()  # not allowed here: fall back to the routing table
            pinned = None
    return plain, pinned


def beacon_loop(args, tcp_port, mac, device_id):
    plain, pinned = beacon_sockets(args.iface)
    datagram = b"CNTL" + bytes([VER]) + device_id + struct.pack("<H", tcp_port) + bytes(FW) + mac
    last_shown = None
    failures = {}
    while not stop.is_set():
        try:
            with open(args.targets) as handle:
                targets = [line.strip() for line in handle if line.strip()]
        except OSError:
            targets = []
        if targets != last_shown:
            log("beacon -> {}".format(", ".join(targets) if targets else "(no target yet)"))
            last_shown = targets
        for target in targets:
            sock = pinned if (target == "255.255.255.255" and pinned is not None) else plain
            try:
                sock.sendto(datagram, (target, args.beacon_port))
                if failures.pop(target, None) is not None:
                    log("beacon to {} works again".format(target))
            except OSError as error:
                # No route yet, or the network just went away: say so once per kind of failure.
                if failures.get(target) != str(error):
                    failures[target] = str(error)
                    log("beacon to {} failed: {}".format(target, error))
        stop.wait(1.0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=47000)
    parser.add_argument("--beacon-port", type=int, default=47001)
    parser.add_argument("--mac", required=True)
    parser.add_argument("--device-id", required=True)
    parser.add_argument("--iface", default="")
    parser.add_argument("--targets", required=True)
    parser.add_argument("--duration", type=int, default=0)
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--level", type=float, default=38.0)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--no-stream", action="store_true")
    parser.add_argument("--no-mains-lock", action="store_true")
    args = parser.parse_args()

    mac = bytes(int(part, 16) for part in args.mac.split(":"))
    device_id = args.device_id.encode("ascii")[:8].ljust(8, b"\x00")

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        server.bind((args.bind, args.port))
    except OSError as error:
        sys.stderr.write("cantol-pingpong: cannot listen on {}:{}: {}\n".format(args.bind, args.port, error))
        return 1
    server.listen(8)
    tcp_port = server.getsockname()[1]
    log(
        "listening on TCP {}:{}, device id {}, MAC {}".format(
            args.bind, tcp_port, args.device_id, args.mac
        )
    )

    def on_signal(_number, _frame):
        stop.set()

    signal.signal(signal.SIGINT, on_signal)
    signal.signal(signal.SIGTERM, on_signal)

    threading.Thread(target=beacon_loop, args=(args, tcp_port, mac, device_id), daemon=True).start()
    threading.Thread(target=accept_loop, args=(server, args, mac, device_id), daemon=True).start()

    started = time.time()
    while not stop.wait(0.5):
        if args.duration and time.time() - started >= args.duration:
            break
    stop.set()
    server.close()
    with stats_lock:
        log(
            "stopped: {connections} connections, {hello} HELLO ({pong} PONG sent, {refused} refused), "
            "{ping} PING ({status} STATUS sent), {start} START and {stop} STOP, "
            "{pulses} made-up pulses sent; phones seen: {phones}".format(
                phones=", ".join(sorted(peers)) or "none", **stats
            )
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
PYEOF

say ""
say "Device id ${DEVICE_ID}, MAC ${MAC_USE}"
say "Enter this MAC address in the app (with the hotspot name and password from the label)."
say "Answering the app on TCP ${PORT}, beacon on UDP ${BEACON_PORT}. Press Ctrl-C to stop."
if [ "$NO_STREAM" -eq 1 ]; then
  say "Streaming is off (--no-stream): the app's Start is ignored."
else
  say "When the app sends Start this streams MADE-UP pulses (level about ${LEVEL} dBmV, seed ${SEED}); the app labels them test data."
fi
say ""

set -- --bind "$BIND" --port "$PORT" --beacon-port "$BEACON_PORT" --mac "$MAC_USE" \
  --device-id "$DEVICE_ID" --iface "${IFACE:-${IFACE_OPT}}" --targets "$TARGETS" --duration "$DURATION"
[ "$QUIET" -eq 0 ] || set -- "$@" --quiet
set -- "$@" --level "$LEVEL" --seed "$SEED"
[ "$NO_STREAM" -eq 0 ] || set -- "$@" --no-stream
[ "$NO_MAINS_LOCK" -eq 0 ] || set -- "$@" --no-mains-lock
python3 -u "$WORK/responder.py" "$@" &
RESPONDER_PID=$!

# Keep the beacon targets and the link description current while the responder runs: a phone that
# restarts its hotspot may give the device another address.
last_link=""
while kill -0 "$RESPONDER_PID" 2>/dev/null; do
  if net_refresh; then
    link="$IFACE $CIDR via ${GATEWAY:-none}"
  else
    link="no link"
  fi
  if [ "$link" != "$last_link" ]; then
    if [ -n "$last_link" ]; then
      say "$(date +%H:%M:%S) network: $link"
    fi
    last_link=$link
    beacon_targets >"$TARGETS.new" && mv "$TARGETS.new" "$TARGETS"
  fi
  sleep 2
done
wait "$RESPONDER_PID" 2>/dev/null
status=$?
RESPONDER_PID=""
exit "$status"
