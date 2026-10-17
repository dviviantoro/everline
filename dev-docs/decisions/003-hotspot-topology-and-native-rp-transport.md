# ADR 003 — Phone-hosted hotspot, guided setup by default, and native-only Red Pitaya transport

> Template: `ai-rules/decisions/001-architecture.md`. Related: ADR-002.

## Status

Proposed — 2026-10-18. To be Accepted (or amended) after the Phase 0 spike results on real phones are recorded in this file.

---

## Context

- The user decided the phone creates the Wi-Fi hotspot and the Red Pitaya (RP) joins it as a Wi-Fi client with SSID/password hardcoded on the RP side (details to be discussed later). The RP uses a USB Wi-Fi dongle (Edimax EW-7811Un V2 / RTL8188CUS class), which is 2.4 GHz only; client mode is its best-supported mode.
- The app must work on all Android versions (Capacitor 8: installable on API 24+) and many OEMs.
- Android facts (official docs unless marked):
  - There is no public API to switch on the normal tethering hotspot or to set its SSID/password. The only public API is `WifiManager.startLocalOnlyHotspot()`, which generates random credentials, shares no internet, and needs `NEARBY_WIFI_DEVICES` (target 33+) or `ACCESS_FINE_LOCATION` (target 32 and below).
  - A hidden `startLocalOnlyHotspot(SoftApConfiguration, Executor, callback)` overload (reflection, Android 13+) reportedly accepts a custom SSID/passphrase/band (community gist, unverified on Android 14-16, non-SDK, the platform may ignore the config).
  - Cleartext HTTP is blocked by default at API 28+; Network Security Config documents hostnames only; `http://` and `ws://` from the `https://localhost` WebView origin are mixed content.
  - Android 17 requires `ACCESS_LOCAL_NETWORK` only for apps targeting API 37 (v1 targets 36).
- Capacitor 8.3.4 bridge, read in source: all plugin methods run on one shared `CapacitorPlugins` thread (`Bridge.java:138,854`), and native-to-JS events are JSON strings (`MessageHandler.java:125-144`), so binary data travels as base64.
- The hotspot subnet is not fixed (vendor specific), so the RP's IP is unknown ahead of time.

---

## Decision

1. Hotspot strategies, chosen at runtime by capability probe:
   - S0 already on: detect an up AP-style network interface with a site-local IPv4 (no permission needed). The final proof is always RP reachability.
   - S3 guided (default on every Android version): show a setup card (SSID, password with copy button, 2.4 GHz, auto-off disabled, phone Wi-Fi client off), open the system hotspot settings through an ordered list of intents held in a data table, then poll S0. The phone remembers the hotspot config, so after first setup it is one toggle per session.
   - S1 custom-config local-only hotspot (hidden overload, Android 13+): spike only, behind a feature flag, off by default. It must read back the applied configuration and fall through on any mismatch. Enabled in a build only if it passes on at least three OEMs. It is not part of a Play-compliant default build.
   - S2 plain local-only hotspot: random credentials, so the RP cannot join. Lab and diagnostics only.
2. All RP I/O runs in a Kotlin plugin over raw TCP/UDP sockets. The WebView never talks to the RP. No cleartext flag and no network-security-config are declared.
3. Discovery order: last known IP, UDP beacon, parallel /24 TCP scan of the hotspot subnet on the data port, manual IP. "Ping" is a TCP connect plus a HELLO/PONG handshake (protocol version, device id, median RTT of 3); ICMP is a diagnostic only.
4. The SSID/password/band/ports come from a gitignored device profile loaded at build time through one function, never from source. Only the `.example` file is committed. The password is displayed to the operator, never sent anywhere.
5. Runtime permissions in the default build are limited to location (needed for GPS anyway). `NEARBY_WIFI_DEVICES`, `CHANGE_WIFI_STATE` and `WRITE_SETTINGS` are not declared unless S1/S2 ship.
6. Heartbeat and reconnect timers live in Kotlin (JS timers throttle in the background). Plugin methods return immediately and I/O runs on the plugin's own threads, because plugin calls share a single thread.

Alternatives considered:

| Alternative | Outcome |
|---|---|
| RP is the access point; the phone joins with `WifiNetworkSpecifier` (public API, Android 10+, one system confirm dialog) | Deferred, not rejected. It removes the hotspot problem, but RP-side hostapd with a USB dongle is documented yet has been reported failing on some RP OS and dongle combinations. Kept possible behind the same link interface. |
| WebView `fetch`/WebSocket directly to the RP | Rejected: cleartext policy, mixed content, and the hotspot IP is unknown ahead of time. |
| Plain local-only hotspot as the main path | Rejected: random credentials the RP cannot know. |
| Reflection plus `WRITE_SETTINGS` or accessibility automation to toggle tethering | Rejected: brittle, restricted by the platform, and not Play-compliant. |

---

## Consequences

### Positive

- A path that works on every Android version and OEM with public APIs only.
- The WebView security model (mixed content, cleartext, CORS) is irrelevant to the device link.
- Diagnostics from the field show which OEM paths work, so the intent table can grow from evidence.

### Trade-offs

- The requested flow ("enable the hotspot with the hardcoded SSID") becomes "set up once, then one toggle per session" on most phones. The user was told this explicitly before approving.
- The app cannot read the hotspot's SSID, password or band without hidden APIs; only RP discovery proves they match.

### Risks

- Dongle is 2.4 GHz only; a phone on 5 GHz Wi-Fi may force the AP to 5 GHz or drop it. Surfaces only as "RP not found"; mitigated by the wizard checklist and Diagnostics.
- Hotspot auto-off, Doze and OEM task killers drop the link. Mitigated by keep-screen-on, native heartbeat and reconnect, and a foreground service in Phase 5.
- A static password shared across a fleet would expose a real tethering hotspot (it shares the phone's mobile data) to anyone who learns it. Mitigation: per-unit credentials through profile import in a later phase.
- Unverified until Phase 0: the S1 reflection on Android 14-16, OEM settings components, Worker access to the Capacitor bridge, whether a multicast lock is needed in the AP role, and `application/wasm` MIME handling on device.
