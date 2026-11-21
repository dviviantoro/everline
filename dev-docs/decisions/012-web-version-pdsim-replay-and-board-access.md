# ADR 012 — A web version of the field app, a replay of pd-simulator on the Cantol, and how this repository reaches the board

> Template: `ai-rules/decisions/001-architecture.md`. Related: ADR-008, ADR-010, ADR-011. Amends ADR-011 decision 8 (the SCPI facts are now measured, see ADR-011) and adds a third source to the Cantol program.

## Status

Proposed — 2026-11-21. The user asked, in the session that added `pd-simulator/` to the repository: install the Analog Discovery 2 driver and make pd-simulator work; enter the Red Pitaya over ssh and save the credential in the repository so the next session can enter it again; and "make simulation what everline mobile apps do with pd-simulator", with a web version of the app if the mobile app cannot run on this machine. **At first the driver could not be installed and the AD2 was not seen by this machine; later the arm64 packages were supplied and installed (see Context), and the AD2 is seen and opened, but its USB link keeps dropping, so it never ran long enough to drive the Red Pitaya. The simulation therefore replays pd-simulator's waveforms in software; the AD2-to-Red-Pitaya chain itself has not run.**

---

## Context

- `pd-simulator/` is a Digilent Analog Discovery 2 (AD2) test-signal source: W1 a reference sine, W2 a partial discharge (PD) signal, with a web scope. It was macOS-only (`ad2.py` raised `OSError` at import on any other system) and its own README says the hardware path was tested on a Mac.
- This machine is an `aarch64` Jetson (Ubuntu 24.04). The installers in `~/Downloads` are all `amd64`: `digilent.adept.runtime_2.30.1_amd64.deb`, `digilent.adept.utilities_2.7.1-amd64.deb`, `digilent.waveforms_3.25.1_amd64.deb`, and the Adept SDK tarball. They cannot be installed here, and the simulator loads `libdwf` into an arm64 Python through `ctypes`, so an emulated x86 library would not help either. Digilent publishes arm64 builds, but its download server answers 403 to every request from a script (its own guide says the downloads need a signed-in account), so they could not be fetched; that was not worked around.
- `lsusb` lists only the root hubs, a hub and a Bluetooth radio: no device with Digilent's vendor ID (1443), and the kernel log has no USB attach event since boot. Whatever was plugged in, this machine did not see it enumerate. **Update, same day:** after the user replugged it, a Digilent FT232H device (`0403:6014`, high speed) enumerated, claimed by the kernel's `ftdi_sio` as `ttyUSB0`; the DWF library is still not installed and the arm64 packages have not been supplied, so the hardware path still has not run. **Update, later the same day, after the user supplied the arm64 packages:** the Adept runtime 2.27.9 was installed with `dpkg` (udev rule with `MODE 666` and `dftdrvdtch`, loader entry, firmware); the WaveForms 3.25.1 arm64 package was **not** installed, because it declares `libc6 >= 2.41` (this machine has 2.39) although `libdwf.so` needs only glibc 2.38; instead `libdwf.so` went to `/usr/local/lib` and the package's `firmware/` folder (48 MB, the AD2's FPGA configurations) to `/usr/local/share/digilent/waveforms/firmware/`, outside `dpkg`'s control (a first attempt with the library alone found the AD2 but listed no configurations and refused to open it). DWF 3.25.1 then named the device (Analog Discovery 2, revision C), opened it once, and pd-simulator connected, applied settings, switched the outputs on and read a hardware scope frame. **The USB link is unstable:** the AD2 disconnects and re-enumerates repeatedly (169 times in 254 s at the worst, later about every 17 s; some enumerations fail with `error -71`; the hub's over-current counters stay 0), so the W2 stream failed within seconds (`DptiIO failed ERC:10`). The disconnects were already happening before the runtime was installed. A test that would have separated the kernel's `ftdi_sio` driver from the cause (a temporary modprobe rule) was not run because it was refused as a persistent system change. **Update, 2026-11-22:** the user moved the AD2 to another port (`1-2.2`, on the same four-port hub as before) and wired W1 and W2 to the Red Pitaya's IN1 and IN2. The link still drops, on a steady cycle: 137 disconnects in 10 minutes, 1.8 to 2.3 s apart (median 2.05 s), the device present for 1.4 to 2.1 s each time, no gap longer than 2.3 s. Ruled out by reading: USB autosuspend (`power/control` is `on`, `runtime_status` stays `active`), link power management (a plain USB 2.00 device with no LPM), over-current (hub port counters 0), and a reset by Digilent's helper (no `reset` lines in the kernel log; it detaches `ftdi_sio` within 7 ms of each attach). `usbmon` is not in this kernel (`CONFIG_USB_MON` unset), so there is no packet trace. The hardware path has therefore still not run past connect, and the AD2-to-Red-Pitaya wiring is untested.
- The mobile app is not running here: no phone is attached (`adb devices` is empty) and the Android SDK on this machine has no emulator or system image installed. Whether one could be installed for this CPU was not investigated. Its web bundle can run: `scripts/verify-field-web.mjs` already runs it in headless Chromium with a scripted stand-in for the Android side.
- The Red Pitaya (`rp-XXXXXX`, STEMlab 125-14 4-Input v1.3, OS 3.00-57) was reachable on the home Wi-Fi, with the program and tests of ADR-011 deployable to `/cantol`.

## Decision

1. **pd-simulator runs on Linux, and a missing DWF library is a banner, not a crash.** `ad2.py` finds `/usr/lib/libdwf.so` (the path the Digilent package installs) or the loader's `libdwf.so`; if the library cannot be loaded, `open()` raises the `DeviceError` the server already shows as a banner, and the Preview scope works. macOS behaviour is unchanged. The README says Linux works and which package to install for which CPU. Checked here without an AD2: the server, its API (state, frame, refused values with a reason, a cross-site request refused, outputs refused without a device), and the generator against its own ground truth (pulses in their windows, 1 to 3 per window per cycle, 40 to 100 percent of the peak, wrapping and negative windows, calibration timing at 0° and 180°, the HFCT ring's damping, repeatability by seed, clipping at 5 V). Not checked: any hardware.
2. **The Cantol program gets a third source, `--source pdsim`** (`cantol_device/pdsim.py`): what the Red Pitaya's inputs would see with the AD2 wired to them (W1 on channel 1, W2 on channel 2, sensors 2 and 3 as scaled copies of W2), computed from pd-simulator's own `signals.py` at the instants the ADC samples, with the board's measured input noise (4.4 counts) added. Everything after the samples is the real program. pd-simulator's settings come from a JSON file (its `GeneratorConfig` names), read again when it changes, and a change restarts W1's and W2's shared clock as Apply does. The status carries the synthetic flag, so the app shows the "Test data" banner.
3. **A web version of the field app: `scripts/serve-field-web.mjs`.** It serves the real field bundle, the real Capacitor bridge script and the real WASM codec; the Android side is the stand-in that already existed in `verify-field-web.mjs`, **moved to `scripts/lib/phone-standin.mjs` and shared** (the harness was re-run after the move: the same 91 assertions pass). The page's `androidBridge.postMessage` becomes a POST and replies and events come back over server-sent events. The stand-in gained three options that default to the old behaviour: what a scan finds, which connections the page may open, and what the GPS reads. The host links to the one Cantol it is told about, over real TCP; the GPS is a simulated walk. It listens on 127.0.0.1, and checks `Host` and `Origin`.
4. **The Red Pitaya login is saved in the repository, in a file git ignores.** `mobile/config/redpitaya.local.json` (matched by the existing `config/*.local.json` rule) holds host, user, password and remote folder; `mobile/config/redpitaya.example.json` is the tracked template; `mobile/scripts/rp.sh` runs `ssh`, `push` and `pull` with it, giving ssh the password only when it asks (`SSH_ASKPASS`), never on a command line; `scripts/check-no-secrets.sh` now also fails if the local file is ever tracked. `demo-pdsim-web.mjs` drives the web version through a seven-stop walk, setting the defect's strength on the board at each stop.
5. **The SCPI front end was corrected from the board** (ADR-011 decision 8 has the table): big-endian blocks, the trigger at index 8192 − DLY, the trigger hysteresis, the sign of a falling-edge level, and `TCP_QUICKACK`, which takes a capture from about 300 ms to about 29 ms. Two things in the tests changed because of the board and are not weakenings of what they check: the reference lock helper no longer expires within a test (a slow CPU outlasts the lock's 12 s where the real engine renews it every 4), and the engine's "measuring" floor is a count of events that any CPU reaches, not the 100 a PC does.

Alternatives considered:

| Alternative | Outcome |
|---|---|
| Emulate the `amd64` Digilent libraries (qemu, box64) | Rejected: the simulator would need an emulated x86 Python as well, real-time USB streaming of W2 at 250 kS/s under emulation is not credible, and there is no AD2 to test it with. |
| Fetch the arm64 packages with a script anyway | Rejected: the server refuses scripts and the downloads sit behind an account; getting around that is not the install the user asked for. |
| Drive pd-simulator's own web server from the Cantol (poll `/api/state`) | Rejected for now: without an AD2 its outputs cannot be switched on (the API answers 409), and a network dependency from the board to this machine is more than a settings file needs. |
| Put the password in a tracked file, or in the memory directory | Rejected: a tracked file would publish it; memory is not the repository. |
| Install an SSH key on the board instead of keeping a password | Left to the board's owner: it changes `authorized_keys` on a device that is not this repository's. |
| A new browser app instead of hosting the existing bundle | Rejected: the point is to exercise the same screens and the same Rust codec the phone runs. |

---

## Result of the first runs (2026-11-21)

Setup: the Red Pitaya `rp-XXXXXX` running `python3 -m cantol_device run --source pdsim --sensors 3 --adc-range lv`, the web host on this machine linked to it over the home Wi-Fi, a headless browser as the operator (`demo-pdsim-web.mjs`), the defect's strength changed by rewriting pd-simulator's settings on the board.

- The app linked to the real board (the MAC check against the label passed; the link answered in 3.9 ms), locked on pd-simulator's W1 ("Ref locked"), drew the phase pattern with its two clusters at about 30 to 60° and 210 to 240°, and offered the sensor selector with three sensors.
- A seven-stop free walk with settings of 10, 30, 100, 300, 100, 30 and 10 mV peak (20.0, 29.5, 40.0, 49.5, 40.0, 29.5, 20.0 dBmV) was marked at 21.2, 29.9, 40.0, 51.1, 39.8, 32.0, 21.3 dBmV in one run and 21.1, 29.6, 39.8, 51.8, 40.0, 30.7, 22.8 in the next: M4 named the strongest, the marks rising and falling in order, "Go back to M4" shown at the end, and the distance between stops (12 to 13 m) from the simulated GPS. 20 assertions in each run, both passing.
- **Findings, none of them a surprise to the design but all of them new numbers:**
  1. A mark is noisy by about ±3 dB against this source. The same setting marked 15 mV at 29.0 and 24.1 dBmV in two runs, 60 mV at 37.3 and 40.6. Cause: a mark is the biggest of five seconds of what the Cantol saw, and it sees a sample of the pulses (about 14 events a second against about 200 fired: the Rate is a lower bound, here by a factor of 14) while pd-simulator's pulses sometimes land within 15 µs of each other and add (its 5-second waveform maximum is about 4 dB above its setting). The trend rules call a change of 3 dB rising or falling, so two stops closer than about 6 dB in level can read in either order; the walk above uses steps of about 9.5 dB.
  2. pd-simulator refuses a PD peak under 10 mV (`0.01 - 5 V`). The replay logged "refused (the old ones stay)" and kept running the old setting, which looked like a wrong reading until the log was read; the driver now stays inside the range.
  3. The stand-in lacked the phone's keep-alive, and the board closed the link after 30 s of silence ("idle for 30 s, closing"); the stand-in now repeats the heartbeat every `intervalMs` when asked.

---

## Consequences

### Positive

- The whole software chain runs against the real board: a real Red Pitaya streams measured-looking pulses to the app's real Live and Tracking screens, in a browser, with pd-simulator's signals; changing the defect's strength changes what the screens show.
- Five wrong assumptions about the board's SCPI interface were found and fixed, and a fake SCPI server now holds the wire format in the tests.
- The next session can reach the board with `scripts/rp.sh`.

### Trade-offs

- The replay is software: it does not exercise the AD2's DAC, the cables, the input jumpers, or the Red Pitaya's ADC with a real signal. Those are the next things to test once the AD2 is seen by a machine.
- The password is in plain text in an ignored local file.
- The web version's GPS and hotspot are simulated; it says what it is, and its use is trying screens, not judging field behaviour.
- Two pd-simulator signals behave unlike a real sensor's: its pulses last 15 µs or more (a real one's under 1 µs) and its HFCT shape rings at 20 kHz, so each lobe counts as a pulse of its own sign.

### Risks

- The Digilent arm64 packages may not suit this machine either (Digilent's forums report segmentation faults with some arm64 releases on Raspberry Pi 64-bit); nothing here has installed one.
- A pulse rate above what the board can capture (about 15 to 20 captures a second) reads low; the Rate is a lower bound already.
- `serve-field-web.mjs` hands out a working link to the Cantol to anyone who can reach its port when `--bind` opens it.
