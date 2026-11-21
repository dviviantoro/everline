# ADR 011 — The Cantol measurement software for the four-input Red Pitaya, and tracking without a line

> Template: `ai-rules/decisions/001-architecture.md`. Related: ADR-003, ADR-005 (still to be written), ADR-008, ADR-009, ADR-010. Amends ADR-010 decision 6 (Tracking is no longer withheld from the field build) and the TASK-006 decision gate (the Cantol detects pulses).

## Status

Proposed — 2026-11-06. The user asked for it: "create cantol device to enable live measurement for both measuring partial discharge activity along cable and phase pattern partial discharge like the first mock UI design". Their answers to three questions fixed the hardware (channel 1 is a sine reference, channels 2, 3 and 4 are partial discharge sensors), the cable mode (a free walk, no line) and the order of work (build first, test on the board later). **Amended 2026-11-21: the SCPI front end has now run on a real STEMlab 125-14 4-Input v1.3 (Red Pitaya OS 3.00-57) with nothing connected to its inputs, and five of its assumptions were wrong (decision 8); they are fixed and tested.** Still never run: a mains reference on channel 1, a real sensor, or a real pulse on any input. Everything that cannot be reached without those is tested against a simulator that knows the truth.

---

## Context

- Until now the only Cantol-side software was `mobile/device/cantol-pingpong.sh`, a bring-up tool that makes up pulses (ADR-010). The user now wants the Cantol itself: the software that finds real partial discharge pulses and sends them to the app, for the phase-resolved pattern (the Live screen, mock screen 6) and for activity along a cable (Tracking, mock screens 6b and 6c).
- The decision gate of TASK-006 ("where does pulse detection run, Cantol or phone?") is answered by the request itself: the Cantol detects and sends events (`PdEvent`), which is also what the protocol and the screens already assumed. ADR-005 (the protocol) is still unwritten and the layouts are still placeholders.
- The board is a STEMlab 125-14 **4-Input**: four 14-bit analog inputs at 125 MS/s, a Zynq with two ARM cores, Linux with Python 3 and a SCPI server (TCP 5000). Channel 1 carries the mains reference, channels 2 to 4 three sensors. The project documents say nothing else about the hardware: not the sensor type, not the input range, not the reference's amplitude.
- The mock Tracking screens use free marks (M1 to M4 at 45 m spacing, "illustrative", `mobile-tracking-mode.md` section 2), while the built Tracking screens are tied to a line asset with five fixed stations, which needs the survey server the field build does not have.
- The protocol had no way to say which of three sensors saw a pulse.

---

## Decision

1. **The software is Python 3 with numpy, in `mobile/device/cantol_device`,** run on the board as `python3 -m cantol_device run`. It has two front ends behind one interface: `scpi.RedPitayaFrontEnd`, which drives the board through its SCPI server on localhost, and `frontend.SimulatedFrontEnd`, which makes up raw samples (a mains sine, ringing pulses, noise) and behaves like the scope: it waits for a trigger, loses pulses that arrive while it is busy, and a long capture takes as long as it would on the board. Python and the SCPI server are on the board already and need no cross-compiler; the limit on how many pulses are seen is the scope's one-buffer design, not Python.
2. **Acquisition takes turns, because the scope can watch one trigger at a time.** One buffer is 16384 samples, 131 µs at full rate. The engine arms on each sensor and each edge in turn (six triggers, 10 ms each), reads all four channels of every capture it gets (a pulse on another sensor within the same 131 µs is found too), takes a free-running capture once a second to learn each sensor's noise and clipping, and a slow capture of the reference (decimation 1024, 134 ms, several mains cycles) every four seconds. **The pulses counted are a lower bound of what the sensors saw**: nothing is seen while the scope is re-armed or reading. A true pulse rate needs FPGA streaming, which is not built.
3. **Detection** on each sensor of each capture: the baseline is the median, the noise deviation the median absolute deviation (so pulses do not inflate it), a pulse is a run of samples beyond 6 deviations (at least 8 counts), at least 3 samples long, with runs closer than 1.5 µs merged and a pulse touching the buffer's edge skipped. Amplitude is the largest excursion from the baseline, its sign the pulse's own, the width the time from the first to the last sample over the threshold. Triggers are set at 7 deviations, above the detector's threshold. Two discharges within a few microseconds read as one.
4. **Phase comes from the reference, with no clock.** The slow capture gives the mains frequency (a spectrum peak refined by a least-squares search on the fit's residual) and offset, and says whether the reference is there (amplitude at least 300 counts, residual at most 15 percent of it, 40 to 70 Hz, renewed within 12 s). Every fast capture carries the reference's own samples; a quadratic fit over 4096 of them gives its value and slope at a pulse's sample, and the phase is `atan2(value − offset, slope / ω)`: where the sine is, and which way it is going. 0° is the positive-going zero crossing and 90° its peak, the usual PRPD convention. `--ref-invert` and `--phase-offset` correct a reversed or shifted reference. Without a lock the phase is 0 and the status's mains-lock bit is clear, so the app shows "Ref not locked", hides the phase plot and keeps the tiles; Tracking does not need phase.
5. **Calibration lives on the device.** The app converts protocol counts at 0.1 mV each (ADR-010). The device converts from the ADC: counts at the protocol's scale = volts at the input ÷ 0.1 mV × the sensor's gain, with `--adc-range` (the jumper: LV ±1 V is 0.122 mV per ADC count, HV ±20 V is 2.44 mV) and `--sensor-gain-db` (an attenuator of 20 dB in front of an input is +20). The levels are therefore dBmV at the input plus the gain given. **The sensor's own transfer (volts per ampere, picocoulombs) is not modelled**; nobody has characterised the sensors.
6. **The protocol grows two backward-compatible fields.** `PdEvent` takes the sensor in its former reserved byte (`channel`, 0 to 7; 0 for a one-sensor device, which is what every earlier sender wrote). `Status` takes an optional trailer after its 11 bytes: a count and, per sensor, its noise floor and its pulse rate (`encode_with_sensors`, `sensors_of`). The golden vectors and the self-test digest `f7f47846` are unchanged. The WASM stream reader reports `ch` and `sensors`.
7. **Live shows sensors; Tracking walks free.** When the device reports more than one sensor, the Live screen offers "All | 1 | 2 | 3": the plot, Peak, Rate and Noise follow the choice (Rate is the sensor's own from the status). The field build serves `/track` with a new `FreeWalkScreen`: the operator walks the cable and taps "Mark station" at each stop (M1, M2, ... up to 12); the app shows the level now, rising or falling, the level at each stop on a chart, the strongest stop, and the distance between two stops when both had a GPS fix. The rules are the span walk's, from the WASM (`cantol-dsp` trend rules). The level is the per-second window peak over **all sensors**, or the noise floor in a second with no pulses, so that moving away from a source shows as falling instead of freezing. Nothing is saved: there is no asset for a walk to be a survey of, and ADR-010's reason for withholding Record (test data must not become a survey) still stands. A build with the survey server keeps the span walk.
8. **The SCPI backend was written from the OS 2 command reference, then run on the board (2026-11-21, OS 3.00-57, inputs open); what was wrong, found, and fixed.**

   | Assumed | Found on the board | Fixed |
   |---|---|---|
   | Binary blocks are little-endian int16 | **Big-endian** (the first bytes `ff ff 00 08` are -1, 8; the ASCII read of the same buffer agrees). Read little-endian, 4.4 counts of noise read as 760 | `dtype=">i2"` |
   | `ACQ:TRig:DLY 8192` puts the trigger in the middle | The data comes oldest first and the trigger sample is at index **8192 - DLY** (`ACQ:TPOS?`/`ACQ:WPOS?` agree: WPOS - TPOS = 8191 + DLY). DLY 8192 put it on sample 0, where the detector discards pulses touching the edge: nearly every real pulse would have been lost | DLY 0; the trigger is at 8192 in 30 of 30 captures on all three sensors and both edges |
   | The default trigger hysteresis is harmless | It is **5 mV**; our level is 7 noise deviations, about 3.7 mV, so a rising edge only fires after the signal dipped below -1.3 mV: erratic on a quiet baseline | `ACQ:TRig:HYST` = half the level |
   | A falling-edge trigger uses the same level | It must be negative; the code armed it at +level and would never have seen a negative pulse | the level is signed by the edge |
   | A request/answer round trip is fast | **50 ms each, whatever the size** (a 2 KB block as much as 32 KB): the server answers in pieces and the kernel's delayed ACK holds the second back. A capture (status, fill, four channels) took 300 ms | `TCP_QUICKACK` re-armed around each receive: 0.6 ms a round trip, 6 ms a channel, **29 ms a capture (about 35 a second)** |

   Confirmed as assumed: the SCPI server on port 5000 (`systemctl start redpitaya_scpi`; it loads FPGA image `z20_125_4ch` v0.94), `*IDN?`, 125 MS/s, a 16384-sample buffer, RAW units and `ACQ:AVG OFF`, 0.122 mV per count on the LV input, an open input's noise of 4.4 counts (0.54 mV), the six trigger names `CH2_PE` to `CH4_NE` (accepted and firing), and no sign of stale data in the half of an immediately triggered capture that precedes the trigger (six trials). Python 3.12 and numpy 2.4.1 are on the board already.

   Not confirmed: which physical input each trigger name watches (that needs a signal on one input only), the trigger on a real pulse, any reference signal, the thermal path (`temperature()` returned nothing). `python3 -m cantol_device selftest --source redpitaya` prints what the board answers so each can be checked.

   The board's two ARMv7 cores (about 670 MHz) cost 23 ms of detection and 5 to 9 ms of event building per capture: with the I/O fixed, a ceiling of about 20 captures a second, which is the figure to improve if the pulse rate matters (see the risks).

Alternatives considered:

| Alternative | Outcome |
|---|---|
| C on the board against the Red Pitaya API (`librp`) | Faster per capture, but nobody here can compile or test on the board yet, and the limit is the scope's buffer, not the language. Revisit if the Python loop proves the bottleneck. |
| Rust cross-compiled for the board's ARM | Would share the app's detection code and vectors, but needs a cross toolchain not set up; detection written in numpy is tested against the simulator's ground truth instead. |
| FPGA firmware for continuous capture and on-chip detection | The right answer for a true pulse rate and no dead time; a project of its own. |
| The Red Pitaya Python module (`rp`) instead of SCPI | Not known to be installed; SCPI is a documented, stable interface and a text protocol that is easy to inspect. |
| Detection on the phone from raw waveforms | Rejected by the request, and a phone cannot take 125 MS/s over Wi-Fi anyway. |
| Phase from a software clock tied to a zero-crossing detector | Needs the capture time to be known to microseconds through Linux and SCPI latency; reading the sine's value and slope from the same capture needs no clock. |
| A line-free walk that reuses the span walk with invented stations | The span walk's types, chart, draft and survey are all five-station and asset-shaped; a separate small module with the same rules is simpler and leaves the demo alone. |
| A per-sensor Tracking level | The operator is hunting the source, which is the strongest sensor; the per-sensor view is on the Live screen. |

---

## Consequences

### Positive

- The whole chain from the three sensors and the mains reference to the phone's plot and the walk exists, and the part that can be tested without the board is tested against what the simulator really fired: pulses found where and as strong as they were (isolated pulses to within 12 percent, 2 percent mean), phase to 0.03° typical and 0.4° worst over 1,195 pulses, no false pulses in 14 million samples of noise.
- The app and the device agree on the wire to the byte, pinned by a Rust test that runs the real program against the app's own decoder and calibration.
- Sensors are first-class in the protocol, the WASM, the screens and the status.

### Trade-offs

- The pulse rate is a lower bound, and the dead time depends on the board's SCPI round trips, which are unknown.
- Two copies of the protocol layout remain in Python (this program and the script's responder), pinned to Rust by tests (TECHNICAL_DEBT).
- The levels are dBmV at the input, not at a sensor's output in physical units, until the sensors are characterised.
- The free walk's level in a quiet second is the noise floor, which differs from the span walk (which keeps the last value); the span walk's behaviour is noted as debt, not changed here.

### Risks (none of these has run on the board)

- The parts of decision 8 not yet confirmed (the physical input each trigger name watches, a real pulse, a reference signal).
- Python's per-capture cost on the board's ARM cores: measured at 28 ms of detection and event building per three-sensor capture, which with the 29 ms of I/O limits the program to about 15 to 20 captures a second; a pulse-heavy source will show a rate far below the truth (the Rate is a lower bound already).
- The reference's real amplitude and noise: the lock threshold (300 counts) and the `--ref-min-counts` option are guesses.
- Pulse shapes of the real sensors: the detector's merge gap (1.5 µs) and the 3-sample minimum assume a ring of about a microsecond.
- Connecting sensors to energised equipment is the operator's responsibility; nothing in the software makes it safe.
