# Check the phone link from the Cantol: `cantol-pingpong.sh`

## What

`mobile/device/cantol-pingpong.sh` (version 0.2.0) is a script you run **on the Cantol device** (the Red Pitaya). It does three things:

1. **Searches the network.** It finds the Wi-Fi link to the phone's hotspot, the phone itself (the hotspot's gateway), and every other host that answers, and pings the phone.
2. **Plays ping-pong with the Cantol mobile app**, using the app's own protocol: it answers the app's HELLO with a PONG that carries the device's MAC address, answers each keep-alive PING with a STATUS frame, and broadcasts the discovery beacon so the app can find it.
3. **Streams made-up pulses** to the app once the app sends Start (it does, when the Live screen opens) and stops when the app sends Stop (when the operator leaves it), so the app's Live screen can be tried on real hardware before the real measurement software exists. **Nothing it sends is measured.** Every STATUS carries the "synthetic" flag, and the app shows a "Test data" banner while it is set (ADR-010).

It is a bring-up tool, not the measurement software. It proves that the phone and the device can reach each other over the hotspot, that the app accepts this device (its MAC address is the one typed from the label), and that pulses make it from the device onto the Live screen.

## Why

The app's connection wizard (field build, ADR-008 and ADR-009) waits for the Cantol to join the hotspot and checks it by a HELLO/PONG exchange and its MAC address. Until the real Cantol software speaks that protocol (ADR-005), this script lets the device side be tried on real hardware, and shows on the device's own terminal what the phone did. The streaming half (ADR-010) is for trying the live chain with a source whose numbers are known.

## What it needs

- A POSIX `sh` (dash or busybox ash are fine), `ip` (iproute2), `ping`, `awk`, `sed`.
- `python3` (3.5 or newer) for the ping-pong part. Red Pitaya OS has it. Without it, `scan` and `info` still work.
- Nothing else is installed or changed. The script joins no network, writes no configuration, and only listens on TCP port 47000 and sends UDP datagrams to port 47001 (both can be changed). Anything on the same network can connect to the listener; it answers only well-formed Cantol frames, and only with the placeholder values.

The device must already be on the phone's hotspot (that is set in its firmware or its Wi-Fi configuration, as the label says). The script does not join it.

## Step-by-step

1. Copy the script to the device: `scp mobile/device/cantol-pingpong.sh root@<red-pitaya>:/root/` (or any directory).
2. On the device, find out what to type into the app: `sh cantol-pingpong.sh info` prints the Wi-Fi interface, its address and the **MAC address**.
3. On the phone, open the field app, sign in, and enter the hotspot name, password and MAC address on the "Enter the Cantol label" screen. Turn the phone's hotspot on with that name and password.
4. On the device: `sh cantol-pingpong.sh`. It searches the network, then answers the app until you press Ctrl-C.
5. In the app the Cantol step should show "Cantol connected" with a round-trip time, and the device's terminal shows the exchange.
6. Finish the app's steps (location), tap "Start measurement". The Live screen opens, the app sends Start, the terminal shows `START from ... -> streaming MADE-UP pulses`, and the screen fills: a "Test data" banner, pulses on the phase plot in two lobes, Peak near the level, Rate a few hundred a second, Noise near 15 to 16 dBmV, "Ref locked". Leaving the Live screen (the Device tab) sends Stop and the terminal shows `STOP from ...`.

### Commands

| Command | What it does |
|---|---|
| `sh cantol-pingpong.sh` | Search, then answer the app until Ctrl-C (same as `run`). |
| `sh cantol-pingpong.sh scan` | Search once and print what was found, without answering the app. |
| `sh cantol-pingpong.sh info` | Print the Wi-Fi link and the MAC address to type into the app. |
| `sh cantol-pingpong.sh help` | The options. |

### Options

| Option | Default | Meaning |
|---|---|---|
| `--iface NAME` | the Wi-Fi interface that has an address | Interface to use. |
| `--mac AA:BB:CC:DD:EE:FF` | the interface's own address | The MAC address to report. Use it when the label shows another address than the Wi-Fi adapter's. |
| `--device-id TEXT` | `RP-` and the last two MAC bytes | Id to report, up to 8 characters. |
| `--ssid NAME` | none | The hotspot name on the label; only used to tell you if the device joined another one. |
| `--port N` | 47000 | TCP port to answer on (0 picks a free one). |
| `--beacon-port N` | 47001 | UDP port the app listens on. |
| `--bind ADDR` | 0.0.0.0 | Address to listen on. |
| `--beacon-target ADDR` | the subnet, the phone, 255.255.255.255 | Send the beacon only here. |
| `--duration SECONDS` | until Ctrl-C | Stop after this long. |
| `--no-search` | off | Skip the sweep of the network. |
| `--quiet` | off | Log connections, HELLO, START and STOP, not every keep-alive or the 10-second stream summary. |
| `--level DBMV` | 38 | Level of the made-up pulses, 0 to 90. It drifts by 4 dB up and down over a minute, so the Peak tile moves. |
| `--seed N` | 1 | Seed of the made-up signal; the same seed gives the same pulses (the drift follows the clock). |
| `--no-stream` | off | Answer the handshake and keep-alives only, and ignore Start. The earlier, ping-pong-only behaviour. |
| `--no-mains-lock` | off | Report that the mains reference is not locked, to see the app's "Ref not locked" screen (the phase plot is hidden). |

The ports must match the app's device profile (`mobile/config/device-profile.example.json`: 47000 and 47001).

## What it prints

```
Cantol ping-pong 0.1.0 -- bring-up tool, not the measurement software

Wi-Fi link:
  interface : wlan0 (192.168.43.20/24)
  hotspot   : joined "CANTOL-1234" (matches the label)
  phone     : 192.168.43.1 (the hotspot's gateway)
  MAC       : 00:26:32:F0:1A:BC
Searching 192.168.43.x ...
  192.168.43.1     aa:bb:cc:dd:ee:ff  REACHABLE  <- gateway: the phone with the hotspot
Ping to the phone (192.168.43.1): 3 of 3 answered, average 4.2 ms

Device id RP-1ABC, MAC 00:26:32:F0:1A:BC
...
12:00:01 listening on TCP 0.0.0.0:47000, device id RP-1ABC, MAC 00:26:32:F0:1A:BC
12:00:01 beacon -> 192.168.43.255, 192.168.43.1, 255.255.255.255
12:00:09 192.168.43.1:41122 connected
12:00:09 HELLO from 192.168.43.1:41122 (nonce 0x1a2b3c4d, phone clock +0.4 s from this device's) -> PONG sent
12:00:11 PING #1 (seq 1) from 192.168.43.1:41122 -> STATUS sent
12:00:20 START from 192.168.43.1:41122 -> streaming MADE-UP pulses (level about 38 dBmV, about 360/s)
12:00:30 streaming to 192.168.43.1:41122: 3611 pulses in the last 10 s (level now 41.3 dBmV)
12:00:41 STOP from 192.168.43.1:41122 -> stream stopped (7530 pulses sent)
```

On a hotspot the phone connects from its own address (the gateway), so the address in the HELLO line is the phone's.

## The made-up signal

Same shape as the demo build simulates, so the two can be compared: a level (`--level`, default 38 dBmV) drifting by ±4 dB over 60 seconds; a noise floor of 6 dBmV; `40 + 10 × (level − noise)` pulses a second, at most 600, in a batch every 50 ms; each pulse up to 3 dB below the level; phase in two lobes around 90° (polarity 0) and 270° (polarity 1), 3 percent strays at the noise floor with any phase; widths of 40 to 600 ns; a STATUS every second (temperature about 41 °C, clipping 0.3 percent, queue 0) with the mains lock set and the synthetic flag set. Amplitudes are sent as ADC counts: `counts = 10^(dBmV/20) / 0.1`, the inverse of the placeholder calibration in `mobile/rust/cantol-dsp/src/calibration.rs` (0.1 mV per count). That factor is not measured; it is chosen so the numbers land where the demo's do.

One connection streams at a time per phone, each on its own thread; a phone that stops reading is dropped after 5 seconds, a silent one after 30.

## Troubleshooting

| What you see | Cause and fix |
|---|---|
| "No Wi-Fi interface has an IPv4 address yet" | The device has not joined the hotspot. Check that the hotspot is on, that its name and password are the ones on the label, and that it uses the 2.4 GHz band. `--ssid` tells you which name the device did join. |
| `hotspot: joined "X", but the label says "Y"` | The device joined a different network. The phone's hotspot must use the name on the label. |
| `scan` shows hosts but not the phone's MAC, or nothing | Some phones do not answer ping from hotspot clients. The app does not need ping to work; watch for the HELLO line instead. |
| The app says "A device answered ... not the ... you entered" | The MAC typed in the app differs from the one this script reports. The message shows both. Correct the app (the label) or pass `--mac` so the script reports what the label says. |
| The app never finds the device, no HELLO line | The phone's hotspot may not be the one the device joined, or the phone filters the beacon. The app's subnet scan finds the device without the beacon; the app's Diagnostics screen shows the last attempt. Try "Enter IP manually" with the address `info` prints. |
| `beacon to ... failed: Network is unreachable` | No route on that address yet; it is logged once and retried every second. |
| `cannot listen on 0.0.0.0:47000` | Another program (or another copy of this script) holds the port. Stop it or use `--port`. |
| `python3 is needed for the ping-pong part` | Install python3, or use `scan` and `info` only. |
| The app's Live screen says "The Cantol did not start sending" | The Start frame could not be sent: the link was down at that moment. It reconnects by itself; tap "Try again". |
| The app's Live screen says "Waiting for data from the Cantol" | The link is up but nothing has arrived for 5 seconds. Check that the terminal shows `START from ...`; if it does not, the script is old (version 0.1.0 ignores Start; `sh cantol-pingpong.sh help` does not list `--level`) or was started with `--no-stream`. |
| The Live screen shows no "Test data" banner | The device's STATUS does not carry the synthetic flag, so the app takes the numbers for readings. This script always sets it. |

## Verification

- `cd mobile/rust && cargo test -p cantol-mock --test device_script` starts the real script and talks to it with the app's own protocol functions (`cantol_proto::handshake`, the code the app runs as WASM): HELLO answered by a PONG with the nonce, device id and MAC; keep-alives answered; a future protocol version refused; noise and a corrupted frame survived; the beacon decoded; the log lines present; bad options rejected with exit code 2; the script's syntax checked by the system `sh`. For the stream: no pulses before Start; after Start about a batch every 50 ms, every frame whole and in sequence with a device clock that never goes back, the rate in the range the level gives, the pulses read back **through the app's own calibration** (`cantol_dsp::counts_to_dbmv`) landing near the chosen level with 90 percent of them in the two phase lobes, polarity following the lobe, the status carrying the synthetic and mains-lock bits and a noise floor near 6 dBmV; no pulses after Stop and a second Start streaming again; a new connection getting nothing until it asks; `--level` moving the pulses, `--no-stream` ignoring Start and `--no-mains-lock` clearing the lock bit. The test passes without running anything if `python3` is missing.
- Changing the script's PONG layout, CRC or calibration factor makes that test fail (checked by changing each in turn).
- By hand: `sh -n` passes under dash, busybox ash and bash in POSIX mode; `info` and `scan` were run on the development machine's own Wi-Fi link.

## What is verified, and what is NOT

Verified on the real Red Pitaya (Ubuntu 24.04, python3 3.12), 2026-11-04: the script runs there; the app on a phone found it, accepted its MAC address and held the link (the user reported the Red Pitaya connected through the phone's hotspot and the app reaching the Ready screen).

**Not verified: the streaming half (version 0.2.0).** It has run against the app's Rust code, a browser stand-in for Android, and the Java link tests with the real mock, but not on the Red Pitaya and not against the app on a phone. Unknown until it does:

- Whether the Capacitor bridge on a real phone keeps up with a `frame` event every 50 ms, in the foreground and with the screen off.
- Whether the Red Pitaya keeps the 50 ms schedule under its own load (late ticks send larger batches; they never drop pulses).
- That a phone's hotspot delivers the beacon (the unicast to the gateway is the fallback; the app's subnet scan does not need it).

## Maintenance

- The frame layout and message layouts are copied into the python part of the script from `mobile/rust/cantol-proto` (`frame.rs`, `msg.rs`). If the protocol changes (ADR-005), change both; `device_script.rs` fails if they disagree.
- When the real Cantol software implements the protocol, this script stays useful for `scan` and `info`; its responder is then a stand-in for tests only.
