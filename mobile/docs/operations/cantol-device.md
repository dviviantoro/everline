# The Cantol measurement software: `cantol_device`

## What

`mobile/device/cantol_device` is the program that runs **on the Cantol** (a STEMlab 125-14 4-Input Red Pitaya). It reads the board's four analog inputs, finds partial discharge pulses on the three sensors, gives each pulse its phase of the mains cycle, and streams them to the Cantol mobile app, which draws the phase pattern (Live screen) and the level along a cable (Tracking screen). Decision record: ADR-011 (Proposed).

| Input | What goes on it |
|---|---|
| IN1 | the mains reference: a sine at the mains frequency (50 or 60 Hz), taken from the mains through a transformer or divider, centred near zero, at least about 300 ADC counts amplitude (40 mV on the LV jumper) |
| IN2, IN3, IN4 | the three partial discharge sensors (the app calls them 1, 2 and 3) |

**What has run on a real board.** On 2026-11-21 the SCPI side ran on a STEMlab 125-14 4-Input v1.3 (Red Pitaya OS 3.00-57) with nothing connected to the inputs: it reads four channels, reports the noise (4.4 counts, 0.5 mV, on every input), correctly says "not a mains reference", and captures about 35 times a second. Five assumptions were wrong and are fixed (byte order, where the trigger lands, the trigger's hysteresis, the sign of a falling-edge level, a 50 ms stall per request); ADR-011 decision 8 lists them. **Not yet run: a mains reference, a real sensor, or a pulse on any input.** The program is also tested against a simulator that makes up raw samples, against a replay of pd-simulator (`--source pdsim`), and against the app's own protocol code. Section "Try it in stages" is the order to find out what else differs.

**Safety.** Connecting a sensor or a reference to energised equipment is for qualified people, with the equipment's own isolation. The software does not make a connection safe.

## What it needs

- The Red Pitaya OS (Ubuntu based) with Python 3 and **numpy**. OS 3.00 already has Python 3.12 and numpy 2.4 (`python3 -c "import numpy"`; if numpy is missing, `apt install python3-numpy`, with the board on a network that has internet).
- The board's SCPI server for the real source: `systemctl start redpitaya_scpi` (the program says so if it cannot reach it). The server owns the FPGA image; no other program should be using the ADC.
- For the app: the board on the phone's hotspot, as in `field-build.md`. The program listens on TCP 47000 and sends a UDP beacon to port 47001 (both can be changed).

## Install

From the repository, with the credential saved for this repository (next section): `cd mobile/device && tar --exclude=__pycache__ -czf - cantol_device tests | ../scripts/rp.sh ssh 'cd /cantol && tar xzf -'` (the folder `/cantol` already holds `cantol-pingpong.sh`). Nothing else is installed on the board and no configuration file is written. For `--source pdsim`, also copy pd-simulator's `signals.py`: `../scripts/rp.sh push ../../pd-simulator/signals.py /cantol/pd-simulator/signals.py` (after `mkdir -p /cantol/pd-simulator`).

## Reaching the board from this repository

`mobile/config/redpitaya.local.json` (host, user, password, remote folder; git ignores it, and `scripts/check-no-secrets.sh` fails if it is ever tracked) holds the login, and `mobile/scripts/rp.sh` uses it:

| Command | What it does |
|---|---|
| `scripts/rp.sh ssh [command]` | a shell on the board, or one command |
| `scripts/rp.sh push <local> [remote]` | copy a file or folder to the board (default `/cantol/`) |
| `scripts/rp.sh pull <remote> [local]` | copy from the board |
| `scripts/rp.sh info` | host, user and folder (never the password) |

Copy `config/redpitaya.example.json` to `config/redpitaya.local.json` on another machine and fill it in. The password is handed to ssh only when it asks (`SSH_ASKPASS`), never on a command line. The board answers as `rp-XXXXXX.local` on the same Wi-Fi as the computer (mDNS); when the phone's hotspot is on it is on that network instead. Using an SSH key would be tidier than a password in a file: it adds a line to the board's `authorized_keys`, so it was left for the person who owns the board to choose.

## Try it in stages

1. **Without the board's inputs, to try the phone chain.** `cd /cantol && python3 -m cantol_device run --source simulated`. The app's Live screen then fills from three simulated sensors, with a "Test data" banner (the program says its data is made up in every status). `--level 45`, `--no-ref` (no mains reference: the phase plot hides), `--sensors 2`, `--seed N` change the simulation.
2. **The board, nothing connected.** `python3 -m cantol_device selftest --source redpitaya`. It prints the board's identity, a free capture's statistics per channel (min, max, mean, noise deviation), the reference result (probably "not a mains reference"), captures a second, and triggers and pulses per sensor. **Copy its output**: it is how the unverified parts (trigger names, buffer layout, speed) are checked or corrected.
3. **The reference.** Connect the mains reference to IN1. `selftest` should say `reference: 50.0xx Hz ... LOCKED`. If it says "not a mains reference", read the amplitude and the fit residual it prints; `--ref-min-counts` lowers the threshold, and `--ref-invert` reverses a reference wired upside down.
4. **A known pulse.** Before a real sensor, loop a signal into a sensor input if you can (the board's own generator, a short cable) and check that `selftest` finds pulses on that sensor only, with a phase that follows the reference.
5. **The real sensors.** Then `python3 -m cantol_device run --source redpitaya`, and the app.

## Run

`python3 -m cantol_device run [options]` (and `selftest`, with the same source options).

| Option | Default | Meaning |
|---|---|---|
| `--source redpitaya\|simulated\|pdsim` | redpitaya | Where the samples come from: the board's inputs, made-up pulses, or a replay of pd-simulator (below). |
| `--sensors N` | 3 | Sensors on channels 2 and up (1 to 3 on the real board). |
| `--adc-range lv\|hv` | lv | The input jumper: LV is ±1 V (0.122 mV per ADC count), HV is ±20 V (2.44 mV). Must match the jumpers. |
| `--sensor-gain-db a,b,c` | 0 each | What stands between each sensor and its input, in dB: an attenuator of 20 dB is `20`. The levels reported are the sensor's output. |
| `--ref-invert` | off | The reference is wired upside down: add 180°. |
| `--phase-offset DEG` | 0 | A fixed shift of the reference path, added to every phase. |
| `--ref-min-counts N` | 300 | The smallest reference amplitude, in ADC counts, that counts as a mains reference. |
| `--port`, `--beacon-port`, `--bind` | 47000, 47001, 0.0.0.0 | The link, as in `cantol-pingpong.md`. |
| `--mac`, `--device-id` | the Ethernet MAC, RP-xxxx | What the app checks against the label (ADR-009). |
| `--iface`, `--beacon-target` | all subnets | Where the beacon goes. |
| `--scpi-host`, `--scpi-port` | 127.0.0.1, 5000 | The board's SCPI server. |
| `--level`, `--seed`, `--no-ref`, `--mains-hz` | 38, 1, off, 50 | The simulated source only. |
| `--pdsim-dir` | `../pd-simulator`, else `/cantol/pd-simulator` | Where pd-simulator's `signals.py` is (`--source pdsim`). |
| `--pdsim-config FILE` | none | pd-simulator's settings as JSON (its `GeneratorConfig` names), read again whenever the file changes. |
| `--pdsim-coupling-db a,b,c` | 0,-6,-12 | How much of W2 reaches each sensor input. |
| `--duration`, `--quiet` | until Ctrl-C | |

Run it instead of `cantol-pingpong.sh`'s responder, not beside it: both listen on 47000. Stop the transient unit first (`systemctl stop cantol-pingpong.service`).

## Trying it with pd-simulator (no Analog Discovery needed)

`--source pdsim` replays what a Digilent Analog Discovery 2 running `pd-simulator` would put on the inputs (W1, the sine, on channel 1; W2, the PD signal, on channel 2), using pd-simulator's own waveform code, sampled the way the Red Pitaya's ADC would. Everything after the samples is the real program: the detector, the phase from the reference, the protocol and the app. With the real AD2 wired to the real inputs, `--source redpitaya` is the same program.

```
python3 -m cantol_device run --source pdsim --pdsim-config /cantol/pdsim.json --sensors 3 --adc-range lv
```

A settings file such as `{"ch1_amplitude_v": 0.8, "ch2_bg_amplitude_v": 0.0005, "pos_pd_max_amplitude_v": 0.025, "neg_pd_max_amplitude_v": 0.025}` is the defect: change the numbers while it runs and the app sees the level move within a second, as when you press Apply in pd-simulator's web page. Sensors 2 and 3 get W2 scaled by `--pdsim-coupling-db`.

**What the real wiring needs (and the replay assumes).** The Red Pitaya's inputs are ±1 V (LV) or ±20 V (HV) by jumper, and `--adc-range` must match the jumper. pd-simulator's defaults (W1 2 V peak, W2 pulses up to 1.2 V, noise ±50 mV) **clip an LV input** (the sine would be twice full scale): use HV jumpers and `--adc-range hv` for the defaults (W1 819 counts, 1.2 V is 492 counts), or keep W1 at 0.9 V or less and the pulses in the tens of millivolts on LV (what the replay example above does; LV resolves 5 mV as 41 counts, HV as 2).

What is stand-in in the replay: the Red Pitaya's own input noise (4.4 counts, measured), and sensors 2 and 3 (scaled copies of W2). What it keeps from pd-simulator: the 4.9 µs staircase of W2, its noise, the shared clock whose zero is W1's rising zero crossing, and restart-on-change. Two limits of the signal, not of the program: pd-simulator's pulses last 15 µs or more where a real sensor's last under a microsecond, and its HFCT shape rings at 20 kHz, so each lobe above the threshold counts as a pulse of its own sign (a real HFCT rings at MHz and merges). Two pulses within about 15 µs of each other overlap on the staircase and read as one pulse of their sum.

## What the app shows

- **Live:** the phase pattern of the sensor you choose (All, 1, 2, 3), Peak, Rate and Noise for it, "Ref locked" when the reference is there. Rate counts the pulses the program saw, which is **a lower bound** (see below).
- **Tracking:** a free walk. Walk the cable, stand still at a stop for five seconds, tap Mark station: M1, M2, and so on, with the level at each, whether it rose or fell from the last, the strongest, and the distance between stops when the phone had a GPS fix at both. The level is the strongest of the three sensors.

## How it works, in short

The scope holds one buffer of 16384 samples (131 µs). The program arms it on each sensor and each edge in turn, reads all four channels of each capture and finds the pulses; once a second a free-running capture gives each sensor's noise; every few seconds a slow capture of the reference gives the mains frequency, offset and lock. A pulse's phase is read from the reference samples of its own capture (where the sine is and which way it is going), so no clock is needed. Details and limits: ADR-011.

## What it cannot do

- **Count every pulse.** While the scope is re-armed or being read it sees nothing; on a quiet line that is most of the time. The Rate it reports is a lower bound, and a strong source shows as many pulses a second only up to what the board can capture. Continuous capture needs FPGA streaming.
- **Tell two pulses within a few microseconds apart.** They read as one.
- **Report charge or amperes.** The level is dBmV at the input plus the gain you set; the sensors' own transfer is not modelled.
- **Save or upload anything.** The app's Tracking walk lives on the screen only.

## Troubleshooting

| What you see | Cause and fix |
|---|---|
| `cannot reach the SCPI server at 127.0.0.1:5000` | `systemctl start redpitaya_scpi`. |
| `selftest` fails at the first capture with a parse or "expected a binary block" message | The board's SCPI answer differs from what was probed (OS 3.00-57); send the whole `selftest` output. |
| Noise looks like hundreds of counts on open inputs | It should be about 4.4 counts. Larger means the block is being read with the wrong byte order (it is big-endian) or the input has a signal on it. |
| About 3 captures a second instead of about 35 | The 50 ms stall per request is back: `TCP_QUICKACK` is not being applied (non-Linux client, or the option refused). |
| The app says "Ref not locked" and hides the phase plot | No usable mains reference on IN1: see `selftest`'s reference line; check the wiring, the jumper (`--adc-range`), `--ref-min-counts`. Activity and Tracking still work. |
| All phases are 0 and the pattern is a vertical line | The same: no lock. The status says so and the app hides the plot; an old app version does not. |
| The phase pattern sits at the wrong place on the cycle | The reference is shifted or inverted: `--ref-invert`, `--phase-offset`. |
| No pulses with a sensor connected | The noise there is above the pulses (the threshold is 6 noise deviations: `selftest` prints the noise per channel), or the sensor is on another input, or the jumper is wrong. |
| Levels look too high or too low by a constant | `--adc-range` and `--sensor-gain-db`; the calibration is not measured. |
| `numpy` is missing | `apt install python3-numpy` or `pip install numpy`. |
| The app says "Waiting for data from the Cantol" | The link is up but nothing arrived for 5 seconds. Check the program's log for `START from`: if it is absent the app's Start did not reach this program (another program, such as `cantol-pingpong.sh`'s responder, may hold port 47000). If it is there, no pulse and no status is being produced: look for `measurement problem:` lines. |
| The program logs `measurement problem: ...` | The board or its SCPI server failed; it says it once and retries every second. |

## Verification

- `cd mobile/device && python3 -m unittest discover -s tests -v`: 33 tests (the same suite passes on the board itself, in about 90 s on its two ARM cores). Against the simulator's ground truth: the reference frequency, amplitude and offset (50, 60 and 49.6 Hz), no lock when the reference is missing, weak, noise or a square wave; phase at known points of the cycle, an inverted reference and a shifted one; pulses found where and as strong as they were fired (no false pulses, at most 2 percent of isolated pulses above 200 counts missed), their phase (99 percent within 0.25°), amplitude (2 percent mean) and sensor; no false pulses in 300 captures of noise; a lone spike is not a pulse; a pulse at the buffer's edge is skipped; calibration; the feed; the engine measuring only while someone streams; a failing front end reported once and retried.
- `cd mobile/rust && cargo test -p cantol-mock --test device_program` starts the program and talks to it with the app's own protocol code and calibration: the handshake, a status with three sensors, pulses on every sensor at calibrated levels with phases in the simulated lobes, the lock, Stop and a second Start, the beacon, no mains reference, bad options exit 2, and the unit tests above.
- A fake SCPI server that answers in the board's real wire format (big-endian blocks, CRLF lines) tests the front end: samples, the commands sent, the trigger at the middle, a falling edge armed below zero, the hysteresis, no trigger.
- The pd-simulator replay is judged against pd-simulator's own settings: W1 locks as the reference, a calibration pulse reads at 0° and at its height, PD pulses fall in their two windows with the right sign, changed settings are seen without a restart, a refused file keeps the old settings.
- Not verified: a real reference, real sensors, a pulse on a real input, and everything the phone side adds, listed above and in ADR-011.

## Maintenance

- The frame and message layouts in `protocol.py` copy `mobile/rust/cantol-proto`; `device_program.rs` fails if they differ.
- The 0.1 mV per protocol count in `protocol.py` is `MV_PER_COUNT` in `mobile/rust/cantol-dsp/src/calibration.rs`.
- When the real sensors are characterised, put their transfer in `--sensor-gain-db` or a calibration file, and say so in the ADR.
