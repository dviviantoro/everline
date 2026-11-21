# MACHINE_HANDOFF

> Written 2026-11-22 because the work moves to another computer. Read it after `START_HERE.md`. It says what the old machine had that the repository does not, what works and what does not (each claim marked verified, with where, or not verified), and the order to do things on the new machine. Where it disagrees with an older document, this one is newer.
>
> Nothing in this file is a secret. The board's address, its password, the hotspot's name and password, and the board's MAC address are deliberately not here (the repository's rule, `START_HERE.md`). The board is written `rp-XXXXXX`: the real name is the last six hex digits of its MAC address, printed on its label and held in the git-ignored local file below.

---

## 1. Where things stand

| Area | State | Evidence |
|---|---|---|
| Field app (the phone build) on branch `feat/task-005-field-wizard` | Built. The Live screen, the sensor selector and the free-walk Tracking screen exist. **Never run on a phone since the stream was added.** The label and link screens ran on a real phone against the real board on 2026-11-04. | `CURRENT_STATE.md`, ADR-008 to ADR-011 |
| Cantol measurement program `mobile/device/cantol_device` | Runs on the real Red Pitaya. Five wrong SCPI assumptions were found on the board and fixed. | ADR-011 decision 8 (a measured table); 33 tests pass here (2026-11-22) and on the board (2026-11-21) |
| `--source pdsim` (software replay of pd-simulator on the board) | Works end to end against the real board. | `scripts/demo-pdsim-web.mjs`: two runs, 20 assertions each, all passed (2026-11-21) |
| Web version of the field app (`scripts/serve-field-web.mjs`) | Works. The real bundle, bridge script and WASM run in a browser against the real board. | `scripts/verify-field-web.mjs`: 91 assertions passed (2026-11-21, after the refactor) |
| pd-simulator on Linux | Preview scope and web UI verified. **Hardware path: connected, switched the outputs on and read one scope frame, then the W2 stream failed** (`DptiIO failed ERC:10`). | ADR-012 |
| **Analog Discovery 2 driving the Red Pitaya's inputs (the real chain)** | **Not run.** The AD2's USB link kept dropping on the old machine (section 5). W1 and W2 were wired to IN1 and IN2 but no real signal was ever measured. | ADR-012, 2026-11-22 update |
| Real mains reference, real sensors, a phone on the live stream | Not run. | |

Checks re-run on 2026-11-22, before this was committed: `scripts/check-no-secrets.sh` passes; `npm run typecheck` and `npm run lint` pass; `npm test` 275 passed; `cargo test --workspace` 92 passed; the device suite 33 passed (it had one flaky test, fixed the same day: the test's ground truth ignored 100 samples at each end of the buffer, the detector only 64, so a real pulse between them looked spurious in about one run in eight; 24 of 24 runs pass now).

---

## 2. What is in git, and what is not

| Item | Where it lives |
|---|---|
| This repository, branch `feat/task-005-field-wizard` (stacked on `feat/mobile-demo-apk`; 24 earlier commits plus today's) | `git@github.com:dviviantoro/everline.git`. **Both repositories are public.** |
| `pd-simulator/` | **A separate repository**, nested in the project root: `git@github.com:dviviantoro/pd-simulator.git`. The Linux changes (`ad2.py`, `README.md`) are on its branch `feat/linux-support`, not on its `master`. The outer repository does not track it. **Do not `git add -A` or `git add pd-simulator` at the project root**: git would record an embedded repository. |
| `mobile/config/redpitaya.local.json` (the board's host, user, password, remote folder) | **Not in git** (ignored, and `check-no-secrets.sh` fails if it is ever tracked). Copy it from the old machine by hand, or recreate it from `redpitaya.example.json`. The password is the Red Pitaya's `root` password, which the board's owner knows. |
| `graphify-out/` | Generated, untracked, not committed. |
| The Digilent installers (`~/Downloads` on the old machine) | Not in git (vendor binaries). Section 5 lists them. |
| The assistant's own notes on the old machine (`~/.claude/projects/.../memory`) | Not portable. This document replaces them. |

---

## 3. Setting up the new machine

1. **Clone.**
   ```
   git clone git@github.com:dviviantoro/everline.git && cd everline
   git checkout feat/task-005-field-wizard
   git clone git@github.com:dviviantoro/pd-simulator.git pd-simulator
   git -C pd-simulator checkout feat/linux-support
   ```
   pd-simulator must sit at `<repo>/pd-simulator`: `cantol_device` finds `signals.py` at `../../../pd-simulator` from its own folder (or `/cantol/pd-simulator` on the board).
2. **Toolchains** (versions used on the old machine): Node 22 (nvm), Rust 1.97.1 (pinned by `mobile/rust/rust-toolchain.toml`, with the `wasm32-unknown-unknown` target; rustup installs it), Python 3 with numpy (3.12 and numpy 1.26 here; the board has 3.12 and numpy 2.4), JDK 21 only for Android builds (`source mobile/scripts/env.sh`; JDK 26 breaks Gradle). For the browser demo, a Chromium: set `CHROMIUM_PATH`, or let Playwright download a headless shell into `~/.cache/ms-playwright/chromium_headless_shell-*` (for example `npx playwright-core install chromium-headless-shell`; this command was not run here).
3. **Dependencies.** `cd mobile && npm ci`. The WASM package (`src/wasm-pkg/`, git-ignored) is built by `npm run wasm`; `npm test`, `typecheck` and `lint` build it first if it is missing.
4. **The board's login.** Put `redpitaya.local.json` in `mobile/config/` (section 2), then `mobile/scripts/rp.sh info` (never prints the password) and `mobile/scripts/rp.sh ssh 'uname -a'`. The first connection records the board's host key (`accept-new`). The new machine must be on the same Wi-Fi as the board, or on the phone's hotspot (the board knows both; section 4).
5. **Run the checks** from `mobile/`:
   - `bash scripts/check-no-secrets.sh`
   - `npm run typecheck && npm run lint && npm test` (275 tests)
   - `cd rust && cargo test --workspace` (92 tests; `cargo fmt --check` and `cargo clippy --workspace --all-targets -- -D warnings` are the other two gates)
   - `cd device && python3 -m unittest discover -s tests` (33 tests; about 20 s on a PC, about 90 s on the board)
   - `node scripts/verify-field-web.mjs` (91 assertions; needs the Chromium above)
6. **Confirm the chain that already works** (no AD2 needed), using the commands in `mobile/docs/operations/cantol-device.md`: copy the program to the board (section "Install"), start it with `--source pdsim`, then on the new machine `node scripts/serve-field-web.mjs --cantol rp-XXXXXX.local` and `node scripts/demo-pdsim-web.mjs --url http://localhost:4190/ --out <dir>`. Expect "all checks passed" with 20 assertions and seven marks rising and falling with the defect.

---

## 4. The Red Pitaya (the Cantol)

| Item | Value |
|---|---|
| Model | STEMlab 125-14 4-Input v1.3, OS 3.00-57, armv7, two cores at about 670 MHz, Python 3.12.3, numpy 2.4.1, FPGA `z20_125_4ch` v0.94 |
| Reach it | `mobile/scripts/rp.sh {ssh\|push\|pull\|info}` (the password reaches ssh only through `SSH_ASKPASS`, never a command line) |
| Network | The home Wi-Fi (mDNS name `rp-XXXXXX.local`), or the phone's hotspot when it is on. In an earlier session the board's `wpa_supplicant.conf` was edited to join the hotspot; the previous file is kept in `/cantol/` as `wpa_supplicant.conf.before-*`. The board rebooted once, unexplained, on 2026-11-21. |
| `/cantol` on the board | `cantol_device/`, `tests/`, `cantol-pingpong.sh`, `pd-simulator/signals.py`, `pdsim.json` (the last demo setting), the `wpa_supplicant` backup |
| State left | `redpitaya_scpi` stopped (it was off when found), `cantol_device` stopped, ports 47000 and 5000 closed |
| Real source | `systemctl start redpitaya_scpi`, then `python3 -m cantol_device run --source redpitaya --adc-range lv\|hv`; stop the service afterwards. The SCPI server owns the FPGA image. |

The facts measured on this board (all in ADR-011 decision 8): blocks are big-endian int16; `ACQ:SOURn:DATA?` is oldest-first; the trigger sample is at index 8192 minus `ACQ:TRig:DLY` (so a delay of 0 puts it in the middle); trigger hysteresis defaults to 5 mV; a falling-edge level must be negative; each request cost 50 ms until `TCP_QUICKACK` was re-armed around every recv, after which a capture takes about 29 ms; open-input noise is 4.4 counts (0.54 mV); 0.122 mV per count on LV. The Cantol sees about 14 events a second where pd-simulator fires about 200, so the Rate on screen is a lower bound.

---

## 5. The Analog Discovery 2

**What it is here:** an Analog Discovery 2, revision C. Over USB it is an FTDI FT232H (`0403:6014`, manufacturer string "Digilent"); the Digilent library finds it by that, and `lsusb` does not show `1443:` for it.

**What happened on the old machine** (an `aarch64` Jetson, Ubuntu 24.04, glibc 2.39):

- The `amd64` packages in `~/Downloads` could not be used. The `arm64` ones (supplied later) were: `digilent.adept.runtime_2.27.9-arm64.deb` was installed with `dpkg`; `digilent.waveforms_3.25.1_arm64.deb` was **not**, because it declares `libc6 (>= 2.41)`. Instead `libdwf.so` 3.25.1 went to `/usr/local/lib` and the package's `firmware/` folder (48 MB, the AD2's FPGA configurations) to `/usr/local/share/digilent/waveforms/firmware/`. Without that folder the library finds the AD2 but reports "No compatible configuration found".
- DWF named the device, opened it once, and pd-simulator connected, applied settings, switched W1 and W2 on and read one hardware scope frame.
- **The USB link does not hold.** The AD2 disconnects and re-enumerates over and over: on the last port tried, 137 times in 10 minutes, 1.8 to 2.3 s apart (median 2.05 s), present for 1.4 to 2.1 s each time, never a gap above 2.3 s. The kernel log shows clean disconnects, no errors. Ruled out by reading: USB autosuspend (`power/control` is `on`, the runtime status stays `active`), link power management (a plain USB 2.00 device), over-current (the hub's counters stay 0), a reset by Digilent's helper (no reset lines; it detaches `ftdi_sio` about 7 ms after each attach). Not ruled out: the cable, the AD2 unit, this host's hub, a power shortfall, or the interplay with the kernel's `ftdi_sio` driver. `usbmon` is not in that kernel. Two ports on the same four-port hub were tried; whether the cable was changed between them is not known.
- Refused by the permission system and **not worked around**: a second request to Digilent's download server (the downloads sit behind an account; scripts get 403), and a modprobe rule to stop `ftdi_sio` from binding (a persistent system change). Ask the user before either.

**On the new machine, by system:**

| System | What to do |
|---|---|
| macOS | Install Digilent WaveForms (it provides `dwf.framework`). pd-simulator was written and tested there. Expected to work; not tried by this work. |
| Linux, `x86_64` | `~/Downloads` on the old machine had `digilent.adept.runtime_2.30.1_amd64.deb`, `digilent.adept.utilities_2.7.1-amd64.deb` and `digilent.waveforms_3.25.1_amd64.deb` (the WaveForms one needs `libc6 >= 2.35`; the arm64 runtime installed a udev rule with `MODE 666` and `dftdrvdtch`, and the amd64 runtime was not inspected). `sudo dpkg -i` the runtime, then WaveForms. Replug the AD2 afterwards so the rule applies. Not tried here. |
| Linux, `arm64` | As above for the old machine; the `libc6 >= 2.41` workaround is in `pd-simulator/README.md`. |

**Before blaming software again, check the link:** `lsusb` must keep showing the device for a minute or more, and `dmesg -w` must not scroll `USB disconnect` / `new high-speed USB device`. If it flaps on the new machine as well, the AD2 or its cable is the suspect (the Mac, where pd-simulator is known to work, is the best second host; then another cable, then a powered hub).

**Wiring and ranges** (the user connected W1 and W2 to IN1 and IN2 on 2026-11-22; the AD2's ground must be tied to the inputs' ground too, which was not checked): the Red Pitaya's inputs are ±1 V (LV) or ±20 V (HV) by jumper, and `--adc-range` must match. pd-simulator's defaults (W1 2 V peak, W2 pulses to 1.2 V, noise ±50 mV) clip an LV input, so either set the jumpers to HV and use `--adc-range hv`, or on LV keep W1 at 0.9 V or less and the pulses in the tens of millivolts. pd-simulator refuses a PD peak under 10 mV (valid range 0.01 to 5 V).

**Undo on the old machine** (nothing else was installed outside the repository): `sudo dpkg -r digilent.adept.runtime && sudo rm -r /usr/local/lib/libdwf.so* /usr/local/share/digilent`.

---

## 6. The first session on the new machine, in order

1. Section 3 (setup and the checks). Stop if a check fails and say so.
2. Section 3 step 6: confirm the replay chain still passes against the board.
3. Plug in the AD2. If its link holds for a minute: start pd-simulator (`cd pd-simulator && python3 -m venv .venv && .venv/bin/pip install numpy && .venv/bin/python server.py`, then `http://127.0.0.1:8000`), choose the scope inputs, Connect, switch the outputs on. If the link does not hold, go no further with the AD2 (section 5).
4. With the AD2 wired and the jumpers set, on the board: `python3 -m cantol_device selftest --source redpitaya --adc-range ...`. It should report `reference: 50.0xx Hz ... LOCKED` and find pulses on sensor 1 (the PD channel). Then `run --source redpitaya`, the web version of the app, and `scripts/demo-pdsim-web.mjs` with pd-simulator's Apply in place of the settings file.
5. Compare the real marks with what the replay predicted (about ±3 dB per mark is expected from the sampling). Differences are the first real calibration data: the dBmV conversion is a placeholder (0.1 mV per count).
6. Only then the larger items: a real mains reference, real sensors, the phone with the field build.

---

## 7. Open items and decisions waiting

| Item | State |
|---|---|
| The AD2's USB link | Unresolved, section 5. The user was asked to try the AD2 on the Mac, another cable, a powered hub, and to report the LED. Two further tests need the user's go-ahead: moving Digilent's udev rule aside for a minute, and a temporary stop of the kernel's `ftdi_sio` binding. |
| Calibration | The ADC-count to dBmV conversion is a placeholder (0.1 mV per count); ADR-005 is not written. |
| Pulse rate | A lower bound: the board manages about 15 to 20 captures a second. |
| Mark noise | About ±3 dB per mark against pd-simulator; the trend rules call a change at 3 dB, so two stops closer than about 6 dB in level can read in either order. |
| An SSH key for the board | Left to the board's owner (it edits `authorized_keys` on a device that is not this repository's). The password sits in plain text in an ignored file (`TECHNICAL_DEBT.md`). |
| `cantol_device` at boot on the board | Not done (a persistent change on the user's device). Ask first. |
| Pull requests | None opened. This branch is stacked on `feat/mobile-demo-apk` (TASK-015), which has not been merged; merge order matters. |
| The "pole" wording conflict | Recorded in the TASK-015 report; undecided. |
| pd-simulator's place in the repository | A nested clone today. Whether to track it (and drop its `.git`), make it a submodule, or ignore it is the user's decision. |
| Status of ADR-008 to ADR-012 | All Proposed. |

---

## 8. Rules the next agent should keep

- **Kill only your own processes, by exact PID.** Never `pkill` or match a command line by substring on a shared machine. `$!` after `ssh 'cmd &'` is the `bash -c` wrapper, not the program; find the real listener with `ss -ltnp | grep :<port>` and check its command line starts with exactly what you started. One substring match killed the wrong process in this work.
- **Persistent system changes need the user's go-ahead** (modprobe rules, udev edits, boot services, sudo-installed packages beyond what was asked). They were refused when attempted unasked, and that was right. Do not work around a refusal.
- **Do not request Digilent's download server from a script** again; ask the user for the file.
- **No credentials, IP addresses, SSIDs, passwords or the board's real name or MAC in a committed file.** Use `rp-XXXXXX` and made-up MACs (`00:26:32:AB:CD:EF`). `check-no-secrets.sh` guards some of this; it does not scan for IPs or MACs.
- **Commit and push only when asked.** Commits follow `type: short title` with a 2 to 5 line body, and each is logged in `dev-docs/ai/commit-logs/YYYY-MM-DD.md` and indexed in `COMMIT_LOG.md` (the log lags its own commit).
- Wait for background work by notification, not by `sleep`. Use `mktemp -d` and the session's scratch folder for temporary files.
- Report faithfully: say what ran and what did not. Where this work said "not verified", it meant it.

---

## 9. What this work added

| Path | What |
|---|---|
| `mobile/device/cantol_device/` | The measurement program: `scpi.py` (board front end, corrected), `pdsim.py` (replay), `frontend.py` (simulated source), `dsp.py`, `engine.py`, `server.py`, `protocol.py`, `__main__.py`; `mobile/device/tests/` (33 tests, including a fake SCPI server in the board's wire format) |
| `mobile/scripts/rp.sh`, `mobile/config/redpitaya.example.json` | Board access with a saved login (the real file is ignored) |
| `mobile/scripts/serve-field-web.mjs`, `scripts/lib/phone-standin.mjs`, `scripts/demo-pdsim-web.mjs` | The web version of the field app, the shared Android stand-in, and the seven-stop walk driver |
| `pd-simulator/ad2.py`, `README.md` (separate repo, branch `feat/linux-support`) | Linux support and a banner instead of a crash when the DWF library is missing |
| `dev-docs/decisions/009` to `012` | The label and MAC check, the live stream and synthetic data, the measurement software and the free walk, the web version / pd-simulator replay / board access |
| `mobile/docs/operations/cantol-device.md`, `cantol-pingpong.md`, `field-build.md` | How to run each piece |
