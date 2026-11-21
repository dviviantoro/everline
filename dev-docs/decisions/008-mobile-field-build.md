# ADR 008 — Mobile field build: the real hotspot, Cantol link and GPS behind the existing interfaces

> Template: `ai-rules/decisions/001-architecture.md`. Related: ADR-002, ADR-003, ADR-006, ADR-007. ADR-005 (the device protocol) is still to be written.

## Status

Proposed — 2026-10-25. The user asked for the MVP of the connection wizard (TASK-005); the design choices below were made while building it and are for the user to accept or change. Not run on a phone yet.

Decision 8 (the device profile holds the hotspot name and password) is replaced by ADR-009 (2026-11-04): the operator types them from the Cantol label, and the profile keeps only the band and the ports.

---

## Context

- ADR-007 built every screen on simulated sources behind four interfaces (`HotspotAssistant`, `CantolLink`, `Gnss`, `SurveyApi`). TASK-005 is the real implementation of the first three.
- The user asked for an app that "forces the phone to change its hotspot configuration", waits for the Cantol to join, and enables GPS. ADR-003 records that Android has **no public API** to switch the normal hotspot on or to set its name and password, and that the user was told so before approving: the setup is guided, once, and then one toggle per session. Nothing in this ADR changes that.
- The Cantol link protocol is a placeholder (frames, ports 47000 and 47001, HELLO/PONG). The Cantol-side software is undecided, so nothing here can say whether a real device answers it. `cantol-mock` speaks it.
- The Android project is Java only: `MainActivity` is Java and there is no Kotlin Gradle plugin.
- No phone was attached while this was built.

---

## Decision

1. **A third build, `VITE_FIELD=1`** (`npm run build:field`, `scripts/android-build.sh field`). It supplies real implementations through the same `Services` the demo uses; the wizard, guards and screens are unchanged. `main.tsx` imports the field entry behind a build-time constant, so the normal and demo bundles contain none of it.
2. **The hotspot is guided, never forced.** Strategies S0 (detect) and S3 (open the system settings from an ordered table) of ADR-003 only. The setup card shows the network name, password and band from the device profile. S1 (a hidden-API custom hotspot) and S2 are not built: they cannot be verified without phones and ADR-003 says they stay off until they pass on at least three OEMs.
3. **Native code moves bytes; Rust owns the protocol.** The Java plugins scan, listen, connect, hold a socket and cut the TCP stream into frames by the length prefix. They never read a CRC or a message. The frames the phone sends (HELLO, PING) and the decoding of the answers (PONG, beacon) are new `cantol-proto` functions exported through `cantol-wasm`, so the existing frame code, vectors and self-test digest are untouched.
4. **Discovery and the held link.** Order as in ADR-003: the last address that worked; then the UDP beacon and a scan of the hotspot subnet together; then a manual address. Whatever is found is only a candidate until it answers a HELLO with a PONG that echoes the phone's nonce. The held connection sends a PING frame every 2 s and counts any frame back as proof of life; after one silent interval it reports `lost` once and reconnects by itself, reporting `up`. While that link is healthy, a ping from the app reuses it instead of opening a second connection.
5. **GPS.** Fixes and the permission come from `@capacitor/geolocation`. A small app plugin, `GnssHelper`, answers "are location services on" and opens the location and app settings screens. The Play Services dialog that turns location on without leaving the app is not used.
6. **Java, not Kotlin.** ADR-002 and ADR-003 say Kotlin. The code is Java because the project has no Kotlin Gradle plugin and its only native file is Java; the plugin classes are thin and moving them to Kotlin later is mechanical. This is a change of wording in those ADRs, not of design.
7. **This build cannot measure.** The live stream is TASK-006 and is gated on the open decision about where pulse detection runs; upload is TASK-007. `AppConfig.measurementNote`, when set, disables "Start measurement" with a plain note, hides the tab bar and redirects the measurement routes to the Ready screen. *(Amended 2026-11-04 by ADR-010: the field build now streams and shows the Live screen, fed by a device that sends test data. `measurementNote` was replaced by `surveysNote`, which withholds only Record, Tag, Tracking and Surveys. Upload (TASK-007) and the decision gate are unchanged.)*
8. **The device profile** is `mobile/config/device-profile.local.json` (gitignored) or, failing that, the committed example, read at build time through one function. The password is inside the APK, because the operator is shown it; an APK built with a real profile is not for sharing.

Alternatives considered:

| Alternative | Outcome |
|---|---|
| Try to change the hotspot name and password from the app (hidden `startLocalOnlyHotspot` overload, `WRITE_SETTINGS`, accessibility automation) | Not built. No public API; the hidden path is unverified on Android 14 to 16 and not Play-compliant. ADR-003. |
| Build the HELLO frame and read the PONG in Java | Rejected: it would put protocol meaning in two languages. Java gets bytes from the WASM codec and returns bytes. |
| Kotlin plugins | Deferred, see decision 6. |
| `SettingsClient` Play Services dialog for location | Not used: ties the app to Google Play Services. The system settings screen is the fallback ADR-003 already names. |
| A runtime switch inside the normal app | Rejected for the reason ADR-007 gives: it ships code the build should not contain. |

---

## Consequences

### Positive

- The three setup steps run on real sources through the interfaces and screens that already exist and are tested.
- Every byte on the link is built and read by tested Rust. The Java core runs under JUnit on any machine, including against the real `cantol-mock`.
- The normal and demo builds behave as before.

### Trade-offs

- The Android project is shared, so **all three APKs now declare** `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION`, and `ACCESS_NETWORK_STATE`, which arrives with a dependency of the geolocation plugin. The demo and the normal build never ask for location.
- The geolocation plugin brings Google Play Services location and an Ionic geolocation library: the APK is roughly 0.7 MB larger.
- After a restart the wizard stops on the first step it found unmet and the operator taps Continue through the steps that are met by then (usually two taps). That is the specified flow, not new, but it is noticeable on real hardware.

### Risks (none of these has been run on a phone)

- Whether the access-point interface names in `HotspotProbe` (`ap0`, `swlan0`, `softap`, `wlan1` and up) match real phones, and whether Android 11 and later let an app list that interface at all.
- Whether the OEM settings components in `SettingsTargets` exist; only the two public fallbacks are certain.
- Whether a phone in the access-point role delivers a UDP broadcast to the app without a multicast lock. The subnet scan does not depend on it.
- Whether the geolocation plugin falls back cleanly on a phone without Play Services.
- Whether a real Cantol speaks this placeholder protocol at all (ADR-005).
- The hotspot name and password in the profile must match what the Cantol is set to join; the app cannot read the phone's real hotspot settings.
