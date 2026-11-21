# ADR 009 — Mobile field build: the Cantol label values are typed on the phone, and the link checks the device's MAC address

> Template: `ai-rules/decisions/001-architecture.md`. Related: ADR-003, ADR-005 (still to be written), ADR-008. Replaces ADR-003 decision 4 and ADR-008 decision 8 for the field build; nothing else in them changes.

## Status

Proposed — 2026-11-04. The user asked for it in the field-build session; the design choices below were made while building it and are for the user to accept or change. Not run on a phone or a Red Pitaya yet.

---

## Context

- ADR-003 and ADR-008 put the hotspot name, password, band and ports in a gitignored device profile read at build time. The password was therefore inside the APK, and one APK served one Cantol. The first field build showed the example values (`CANTOL-EXAMPLE`), which match no device.
- Each Cantol (a Red Pitaya) is set up in firmware to join one hotspot, and a label on it shows that name and password. The device has a fixed MAC address, also on the label.
- Android has no public API to set the hotspot's name and password, so the operator types them into the phone's settings once. They need to see the right values, and the app must not connect to some other device that happens to answer on the same hotspot (a second Cantol, a leftover test unit).
- Android 10 and later do not let an app read the neighbour (ARP) table, so the app cannot learn a peer's MAC address from the network layer. A device has to say it.
- The Cantol link protocol is a placeholder (ADR-005 is not written). Its PONG and beacon have fixed layouts, and the golden vectors in `mobile/rust/vectors` contain the existing PONG bytes and must not change.

---

## Decision

1. **The label values are typed on the phone, once.** A new screen, `/setup/device`, asks for the hotspot name (at most 32 bytes), the password (8 to 63 plain keyboard characters, hidden with a Show toggle) and the Cantol's MAC address (twelve hex digits in any common notation, shown as `AA:BB:CC:DD:EE:FF`). It is the first step of the wizard (`DEVICE_SETUP`) until the values are saved, and can be reopened from the hotspot screen ("Not what the Cantol label says? Change"). The hotspot screen shows what was typed. Validation messages never repeat a value.
2. **They are stored on the phone, not in the build.** `AppStore` keeps them (`getCantolSetup`, `saveCantolSetup`) in the app's own storage, beside the operator. Signing out keeps them: they belong to the device. The APK carries no network secret any more, and one build serves every unit. The device profile shrinks to the band and the two ports; a `ssid` or `password` left in an old local profile is ignored. The password is stored as typed, because the operator needs to see it again and it is printed on the label anyway; Android's per-app storage and `allowBackup=false` are the protection.
3. **The device reports its MAC address; the link refuses any other.** The PONG and the beacon get a trailing six-byte MAC field (`Pong::encode_with_mac`, `Beacon::encode_with_mac`; the existing 26- and 18-byte layouts, and so the vectors and the self-test digest, are unchanged). All zeros means "not reported". The WASM module's `decode_pong` and `decode_beacon` return `"mac":"AA:BB:CC:DD:EE:FF"` or `null`. After the nonce check, the field link accepts a device only if its MAC equals the one typed; otherwise it throws `WrongDeviceError`. A device that sends no MAC is refused too: the point is to know which unit it is. The expected address is read at each handshake, so a correction applies at once.
4. **A refusal is a message, not a silent search.** `discover` throws the `WrongDeviceError` when a round found devices but none was the right one; the wizard shows "A device answered at 192.0.2.7 (RP-MOCK) with MAC address ..., not the ... you entered" with a "Check the label values" button, and does not show the "Cantol has not answered" help (something did answer). Saving a different MAC address drops the current link and searches again. Saving only a new name or password keeps the link.
5. **A Cantol-side tool, `mobile/device/cantol-pingpong.sh`,** runs on the Red Pitaya. It searches the network (the Wi-Fi link, the phone as the hotspot's gateway, other hosts, a ping to the phone) and plays the device's side of the protocol: HELLO answered by a PONG with the device's MAC, each keep-alive PING answered by STATUS, the beacon broadcast. It is a POSIX `sh` script; the binary protocol part is a `python3` program it writes out and runs (Red Pitaya OS ships python3; frame handling with a CRC is not something to do reliably in shell). It changes no network configuration. It is a bring-up tool: its STATUS values are placeholders and it sends no measurements. `cantol-mock/tests/device_script.rs` starts it and talks to it with the app's own Rust protocol functions, so the python copy of the frame layout cannot drift unnoticed.

Alternatives considered:

| Alternative | Outcome |
|---|---|
| Keep the values in the device profile and rebuild per unit | Rejected: a secret in every APK, a build per unit, and it showed example values when the profile was missing. |
| Read the peer's MAC address from the network (ARP) | Not possible for an app on Android 10 and later. |
| Make the PONG one fixed 32-byte layout | Rejected: it changes the bytes the golden vectors pin. A trailing optional field is read by older code unchanged. |
| Accept a device with no MAC (to stay compatible) | Rejected for the field build: it would make the check optional exactly where it matters. A device without the field is refused with a message that says so. |
| Write the device tool entirely in shell (`nc`, `printf`, a CRC from `gzip`) | Rejected: a held TCP listener with several clients and binary frames is fragile in shell, and which netcat the device has is unknown. The shell does what it is good at (network search); python3 does the protocol. |
| Encrypt the stored password with a keystore | Not built: no plugin for it in the project, and the same password is on the label. Revisit if the threat model changes. |

---

## Consequences

### Positive

- One APK for every Cantol; no network secret in it or in the repository.
- A wrong or second device on the hotspot is named and refused instead of silently connected.
- The Cantol side has a script that shows, on the device, whether the phone reached it.

### Trade-offs

- The Cantol firmware (ADR-005) must send the MAC in its PONG and beacon. Until then only `cantol-mock` and this script do, and a real unit without the field is refused.
- The check proves which unit answered, not that the answer is honest: anyone on the hotspot can announce any MAC address. The hotspot password is the real gate. This is an eligibility check against mistakes, not authentication.
- The protocol is now written twice (Rust and the script's python), pinned together by one test.
- The demo build is unchanged: it supplies no setup source, so it never shows the new screen.

### Risks (none of these has been run on a phone or a Red Pitaya)

- Whether Red Pitaya OS has the tools the script calls (`ip`, `ping -W`, `iw` or `iwgetid` or `wpa_cli` for the hotspot name; python 3.5 or newer). Missing ones degrade the printout; missing python3 stops only the ping-pong part.
- Whether a phone in the access-point role delivers the UDP beacon to the app; the script also sends it directly to the gateway, and the app's subnet scan does not depend on it.
- The MAC on the label may be the Ethernet address while the Wi-Fi adapter has another. The script prints the Wi-Fi interface's address and takes `--mac` to report any other; the operator must type what the device reports.
