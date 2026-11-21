//! Message payloads carried inside frames, plus the UDP discovery beacon.
//!
//! PLACEHOLDER layouts (little-endian), to be agreed with the Cantol side (ADR-005).

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MsgError {
    /// Fewer bytes than the fixed layout needs.
    TooShort,
    /// A length field disagrees with the number of bytes present.
    BadLength,
}

fn u16_at(p: &[u8], i: usize) -> u16 {
    u16::from_le_bytes([p[i], p[i + 1]])
}

fn i16_at(p: &[u8], i: usize) -> i16 {
    i16::from_le_bytes([p[i], p[i + 1]])
}

fn u32_at(p: &[u8], i: usize) -> u32 {
    u32::from_le_bytes([p[i], p[i + 1], p[i + 2], p[i + 3]])
}

fn u64_at(p: &[u8], i: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&p[i..i + 8]);
    u64::from_le_bytes(b)
}

/// Phone to Cantol: first frame on a connection. Also the payload of a "ping".
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Hello {
    pub proto_min: u8,
    pub proto_max: u8,
    pub nonce: u32,
    pub phone_epoch_ms: u64,
}

impl Hello {
    pub const LEN: usize = 14;

    pub fn encode(&self) -> [u8; Self::LEN] {
        let mut b = [0u8; Self::LEN];
        b[0] = self.proto_min;
        b[1] = self.proto_max;
        b[2..6].copy_from_slice(&self.nonce.to_le_bytes());
        b[6..14].copy_from_slice(&self.phone_epoch_ms.to_le_bytes());
        b
    }

    pub fn decode(p: &[u8]) -> Result<Hello, MsgError> {
        if p.len() < Self::LEN {
            return Err(MsgError::TooShort);
        }
        Ok(Hello {
            proto_min: p[0],
            proto_max: p[1],
            nonce: u32_at(p, 2),
            phone_epoch_ms: u64_at(p, 6),
        })
    }
}

/// Length of a hardware (MAC) address.
pub const MAC_LEN: usize = 6;

/// The MAC address a device reports in its `Pong` and beacon: six bytes after the base layout.
/// All zeros means "not reported" (no real device has that address), so a device that predates the
/// field, and the golden vectors that contain the base layout, still decode.
fn trailing_mac(p: &[u8], base: usize) -> Option<[u8; MAC_LEN]> {
    let bytes = p.get(base..base + MAC_LEN)?;
    let mut mac = [0u8; MAC_LEN];
    mac.copy_from_slice(bytes);
    if mac == [0u8; MAC_LEN] {
        None
    } else {
        Some(mac)
    }
}

/// Cantol to phone: answer to `Hello`, echoing its nonce so the phone can match it and time the RTT.
///
/// The base layout is 26 bytes and is what the golden vectors contain. A device that wants to prove
/// which unit it is appends its MAC address: see [`Pong::encode_with_mac`] and [`Pong::mac_of`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Pong {
    pub proto: u8,
    pub caps: u16,
    pub fw: [u8; 3],
    pub device_id: [u8; 8],
    pub cantol_epoch_ms: u64,
    pub nonce: u32,
}

impl Pong {
    pub const LEN: usize = 26;
    /// Base layout plus the trailing MAC address.
    pub const LEN_WITH_MAC: usize = Self::LEN + MAC_LEN;

    /// The base layout, without a MAC address.
    pub fn encode(&self) -> [u8; Self::LEN] {
        let mut b = [0u8; Self::LEN];
        b[0] = self.proto;
        b[1..3].copy_from_slice(&self.caps.to_le_bytes());
        b[3..6].copy_from_slice(&self.fw);
        b[6..14].copy_from_slice(&self.device_id);
        b[14..22].copy_from_slice(&self.cantol_epoch_ms.to_le_bytes());
        b[22..26].copy_from_slice(&self.nonce.to_le_bytes());
        b
    }

    /// The base layout followed by the device's MAC address.
    pub fn encode_with_mac(&self, mac: [u8; MAC_LEN]) -> [u8; Self::LEN_WITH_MAC] {
        let mut b = [0u8; Self::LEN_WITH_MAC];
        b[..Self::LEN].copy_from_slice(&self.encode());
        b[Self::LEN..].copy_from_slice(&mac);
        b
    }

    /// The MAC address a payload reports, or `None` when it has none (a base-layout payload, or
    /// all zeros). Call it on the payload `decode` accepted.
    pub fn mac_of(p: &[u8]) -> Option<[u8; MAC_LEN]> {
        trailing_mac(p, Self::LEN)
    }

    pub fn decode(p: &[u8]) -> Result<Pong, MsgError> {
        if p.len() < Self::LEN {
            return Err(MsgError::TooShort);
        }
        let mut fw = [0u8; 3];
        fw.copy_from_slice(&p[3..6]);
        let mut device_id = [0u8; 8];
        device_id.copy_from_slice(&p[6..14]);
        Ok(Pong {
            proto: p[0],
            caps: u16_at(p, 1),
            fw,
            device_id,
            cantol_epoch_ms: u64_at(p, 14),
            nonce: u32_at(p, 22),
        })
    }
}

/// `Status.flags` bit: Cantol is locked to the mains phase (needed for phase-resolved PD).
pub const STATUS_MAINS_LOCK: u8 = 0b1;
/// `Status.flags` bit: the numbers this device sends are generated test data, not measurements.
/// A device that sets it must set it in every `Status`, so the app can say so on every screen that
/// shows the numbers and never lets them pass for a reading.
pub const STATUS_SYNTHETIC: u8 = 0b10;

/// Cantol to phone, about once per second.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Status {
    pub temp_c_x10: i16,
    pub adc_clip_pct_x10: u16,
    pub noise_floor_counts: u16,
    pub trigger_rate_hz: u16,
    pub queue: u16,
    pub flags: u8,
}

/// What one sensor reports in a status: its own noise floor and how many pulses a second it saw.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SensorStat {
    pub noise_floor_counts: u16,
    pub trigger_rate_hz: u16,
}

impl SensorStat {
    pub const LEN: usize = 4;
    /// A device with more sensors than this reports the first `MAX_SENSORS`.
    pub const MAX_SENSORS: usize = 8;
}

impl Status {
    pub const LEN: usize = 11;

    pub fn encode(&self) -> [u8; Self::LEN] {
        let mut b = [0u8; Self::LEN];
        b[0..2].copy_from_slice(&self.temp_c_x10.to_le_bytes());
        b[2..4].copy_from_slice(&self.adc_clip_pct_x10.to_le_bytes());
        b[4..6].copy_from_slice(&self.noise_floor_counts.to_le_bytes());
        b[6..8].copy_from_slice(&self.trigger_rate_hz.to_le_bytes());
        b[8..10].copy_from_slice(&self.queue.to_le_bytes());
        b[10] = self.flags;
        b
    }

    /// The base layout followed by a count byte and one `SensorStat` per sensor. The base fields
    /// stay what they were (the overall noise floor and rate); a reader that stops at 11 bytes
    /// still decodes it. At most [`SensorStat::MAX_SENSORS`] are written.
    pub fn encode_with_sensors(&self, sensors: &[SensorStat]) -> Vec<u8> {
        let sensors = &sensors[..sensors.len().min(SensorStat::MAX_SENSORS)];
        let mut b = self.encode().to_vec();
        b.push(sensors.len() as u8);
        for s in sensors {
            b.extend_from_slice(&s.noise_floor_counts.to_le_bytes());
            b.extend_from_slice(&s.trigger_rate_hz.to_le_bytes());
        }
        b
    }

    /// The per-sensor figures a payload carries, or `None` when it has none (a base-layout status,
    /// or a trailer that does not fit its own count).
    pub fn sensors_of(p: &[u8]) -> Option<Vec<SensorStat>> {
        let count = usize::from(*p.get(Self::LEN)?);
        if count > SensorStat::MAX_SENSORS || p.len() != Self::LEN + 1 + count * SensorStat::LEN {
            return None;
        }
        Some(
            (0..count)
                .map(|i| {
                    let o = Self::LEN + 1 + i * SensorStat::LEN;
                    SensorStat {
                        noise_floor_counts: u16_at(p, o),
                        trigger_rate_hz: u16_at(p, o + 2),
                    }
                })
                .collect(),
        )
    }

    pub fn decode(p: &[u8]) -> Result<Status, MsgError> {
        if p.len() < Self::LEN {
            return Err(MsgError::TooShort);
        }
        Ok(Status {
            temp_c_x10: i16_at(p, 0),
            adc_clip_pct_x10: u16_at(p, 2),
            noise_floor_counts: u16_at(p, 4),
            trigger_rate_hz: u16_at(p, 6),
            queue: u16_at(p, 8),
            flags: p[10],
        })
    }
}

/// One detected pulse. `t_us` is an offset from the enclosing frame's `ts_us`; `phase` maps
/// 0..=65535 onto 0..360 degrees of the mains cycle (meaningful only with mains lock).
///
/// `polarity` is the half-cycle the pulse fell in (0 for 0 to 180 degrees, 1 for 180 to 360); the
/// sign of `amp_counts` is the pulse's own sign. `channel` is the sensor that saw it, counted from
/// 0: it was the reserved byte, so a device that sends 0 there is a one-sensor device.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PdEvent {
    pub t_us: u32,
    pub amp_counts: i16,
    pub phase: u16,
    pub width_ns: u16,
    pub polarity: u8,
    pub channel: u8,
}

impl PdEvent {
    pub const LEN: usize = 12;
}

/// Append a `PdEvent` batch payload: `count u16` followed by `count` 12-byte records.
pub fn encode_pd_events(events: &[PdEvent], out: &mut Vec<u8>) {
    out.extend_from_slice(&(events.len() as u16).to_le_bytes());
    for e in events {
        out.extend_from_slice(&e.t_us.to_le_bytes());
        out.extend_from_slice(&e.amp_counts.to_le_bytes());
        out.extend_from_slice(&e.phase.to_le_bytes());
        out.extend_from_slice(&e.width_ns.to_le_bytes());
        out.push(e.polarity);
        out.push(e.channel);
    }
}

pub fn decode_pd_events(p: &[u8]) -> Result<Vec<PdEvent>, MsgError> {
    if p.len() < 2 {
        return Err(MsgError::TooShort);
    }
    let count = usize::from(u16_at(p, 0));
    if p.len() != 2 + count * PdEvent::LEN {
        return Err(MsgError::BadLength);
    }
    Ok((0..count)
        .map(|i| {
            let o = 2 + i * PdEvent::LEN;
            PdEvent {
                t_us: u32_at(p, o),
                amp_counts: i16_at(p, o + 4),
                phase: u16_at(p, o + 6),
                width_ns: u16_at(p, o + 8),
                polarity: p[o + 10],
                channel: p[o + 11],
            }
        })
        .collect())
}

/// UDP discovery beacon, broadcast by Cantol about once per second. Not a frame.
///
/// Like [`Pong`], the base layout is 18 bytes and a device may append its MAC address
/// ([`Beacon::encode_with_mac`], [`Beacon::mac_of`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Beacon {
    pub proto: u8,
    pub device_id: [u8; 8],
    pub tcp_port: u16,
    pub fw: [u8; 3],
}

impl Beacon {
    pub const MAGIC: [u8; 4] = *b"CNTL";
    pub const LEN: usize = 18;
    /// Base layout plus the trailing MAC address.
    pub const LEN_WITH_MAC: usize = Self::LEN + MAC_LEN;

    /// The base layout, without a MAC address.
    pub fn encode(&self) -> [u8; Self::LEN] {
        let mut b = [0u8; Self::LEN];
        b[0..4].copy_from_slice(&Self::MAGIC);
        b[4] = self.proto;
        b[5..13].copy_from_slice(&self.device_id);
        b[13..15].copy_from_slice(&self.tcp_port.to_le_bytes());
        b[15..18].copy_from_slice(&self.fw);
        b
    }

    /// The base layout followed by the device's MAC address.
    pub fn encode_with_mac(&self, mac: [u8; MAC_LEN]) -> [u8; Self::LEN_WITH_MAC] {
        let mut b = [0u8; Self::LEN_WITH_MAC];
        b[..Self::LEN].copy_from_slice(&self.encode());
        b[Self::LEN..].copy_from_slice(&mac);
        b
    }

    /// The MAC address a datagram reports, or `None` when it has none.
    pub fn mac_of(p: &[u8]) -> Option<[u8; MAC_LEN]> {
        trailing_mac(p, Self::LEN)
    }

    pub fn decode(p: &[u8]) -> Result<Beacon, MsgError> {
        if p.len() < Self::LEN {
            return Err(MsgError::TooShort);
        }
        if p[0..4] != Self::MAGIC {
            return Err(MsgError::BadLength);
        }
        let mut device_id = [0u8; 8];
        device_id.copy_from_slice(&p[5..13]);
        let mut fw = [0u8; 3];
        fw.copy_from_slice(&p[15..18]);
        Ok(Beacon {
            proto: p[4],
            device_id,
            tcp_port: u16_at(p, 13),
            fw,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hello_pong_status_round_trip() {
        let h = Hello {
            proto_min: 1,
            proto_max: 1,
            nonce: 0xDEAD_BEEF,
            phone_epoch_ms: 1_760_000_000_123,
        };
        assert_eq!(Hello::decode(&h.encode()), Ok(h));
        let p = Pong {
            proto: 1,
            caps: 0b11,
            fw: [0, 1, 2],
            device_id: *b"RP-00A1\0",
            cantol_epoch_ms: 42,
            nonce: h.nonce,
        };
        assert_eq!(Pong::decode(&p.encode()), Ok(p));
        let s = Status {
            temp_c_x10: -35,
            adc_clip_pct_x10: 12,
            noise_floor_counts: 80,
            trigger_rate_hz: 300,
            queue: 4,
            flags: STATUS_MAINS_LOCK,
        };
        assert_eq!(Status::decode(&s.encode()), Ok(s));
    }

    #[test]
    fn pd_event_batch_round_trip_and_length_checks() {
        let events = [
            PdEvent {
                t_us: 10,
                amp_counts: -300,
                phase: 65535,
                width_ns: 120,
                polarity: 1,
                channel: 2,
            },
            PdEvent {
                t_us: 20,
                amp_counts: 4000,
                phase: 0,
                width_ns: 90,
                polarity: 0,
                channel: 0,
            },
        ];
        let mut payload = Vec::new();
        encode_pd_events(&events, &mut payload);
        assert_eq!(payload.len(), 2 + 2 * PdEvent::LEN);
        assert_eq!(decode_pd_events(&payload), Ok(events.to_vec()));
        assert_eq!(
            decode_pd_events(&payload[..payload.len() - 1]),
            Err(MsgError::BadLength)
        );
        assert_eq!(decode_pd_events(&[1]), Err(MsgError::TooShort));
    }

    #[test]
    fn a_status_may_carry_per_sensor_figures_after_the_base_layout() {
        let s = Status {
            temp_c_x10: 410,
            adc_clip_pct_x10: 3,
            noise_floor_counts: 12,
            trigger_rate_hz: 300,
            queue: 0,
            flags: STATUS_MAINS_LOCK,
        };
        let sensors = [
            SensorStat {
                noise_floor_counts: 12,
                trigger_rate_hz: 200,
            },
            SensorStat {
                noise_floor_counts: 9,
                trigger_rate_hz: 70,
            },
            SensorStat {
                noise_floor_counts: 15,
                trigger_rate_hz: 30,
            },
        ];
        let with = s.encode_with_sensors(&sensors);
        assert_eq!(with.len(), Status::LEN + 1 + 3 * SensorStat::LEN);
        assert_eq!(
            &with[..Status::LEN],
            &s.encode()[..],
            "the base layout is unchanged"
        );
        assert_eq!(
            Status::decode(&with),
            Ok(s),
            "an older reader still decodes it"
        );
        assert_eq!(Status::sensors_of(&with), Some(sensors.to_vec()));
        // No trailer, a trailer that lies about its count, and too many sensors all say "none".
        assert_eq!(Status::sensors_of(&s.encode()), None);
        assert_eq!(Status::sensors_of(&with[..with.len() - 1]), None);
        let mut lying = with.clone();
        lying[Status::LEN] = 4;
        assert_eq!(Status::sensors_of(&lying), None);
        let many = vec![sensors[0]; 12];
        assert_eq!(
            Status::sensors_of(&s.encode_with_sensors(&many)).map(|v| v.len()),
            Some(SensorStat::MAX_SENSORS)
        );
        assert_eq!(
            Status::sensors_of(&s.encode_with_sensors(&[])),
            Some(vec![])
        );
    }

    #[test]
    fn short_buffers_are_rejected() {
        assert_eq!(Hello::decode(&[0; 13]), Err(MsgError::TooShort));
        assert_eq!(Pong::decode(&[0; 25]), Err(MsgError::TooShort));
        assert_eq!(Status::decode(&[0; 10]), Err(MsgError::TooShort));
        assert_eq!(Beacon::decode(&[0; 17]), Err(MsgError::TooShort));
    }

    #[test]
    fn beacon_round_trip_and_magic_check() {
        let b = Beacon {
            proto: 1,
            device_id: [1, 2, 3, 4, 5, 6, 7, 8],
            tcp_port: 47000,
            fw: [0, 1, 0],
        };
        assert_eq!(Beacon::decode(&b.encode()), Ok(b));
        let mut wrong = b.encode();
        wrong[0] = b'X';
        assert!(Beacon::decode(&wrong).is_err());
    }

    #[test]
    fn a_pong_may_carry_its_mac_address_after_the_base_layout() {
        let p = Pong {
            proto: 1,
            caps: 0b11,
            fw: [0, 1, 2],
            device_id: *b"RP-00A1\0",
            cantol_epoch_ms: 42,
            nonce: 7,
        };
        let mac = [0x00, 0x26, 0x32, 0xF0, 0x1A, 0xBC];
        let with = p.encode_with_mac(mac);
        assert_eq!(with.len(), Pong::LEN + MAC_LEN);
        assert_eq!(
            &with[..Pong::LEN],
            &p.encode()[..],
            "the base layout is unchanged"
        );
        assert_eq!(
            Pong::decode(&with),
            Ok(p),
            "an older reader still decodes it"
        );
        assert_eq!(Pong::mac_of(&with), Some(mac));
        // No MAC: the base layout, a truncated tail and an all-zero field all say "not reported".
        assert_eq!(Pong::mac_of(&p.encode()), None);
        assert_eq!(Pong::mac_of(&with[..Pong::LEN + 3]), None);
        assert_eq!(Pong::mac_of(&p.encode_with_mac([0; MAC_LEN])), None);
    }

    #[test]
    fn a_beacon_may_carry_its_mac_address_after_the_base_layout() {
        let b = Beacon {
            proto: 1,
            device_id: *b"RP-00A1\0",
            tcp_port: 47000,
            fw: [0, 1, 0],
        };
        let mac = [0x00, 0x26, 0x32, 0xF0, 0x1A, 0xBC];
        let with = b.encode_with_mac(mac);
        assert_eq!(with.len(), Beacon::LEN + MAC_LEN);
        assert_eq!(&with[..Beacon::LEN], &b.encode()[..]);
        assert_eq!(Beacon::decode(&with), Ok(b));
        assert_eq!(Beacon::mac_of(&with), Some(mac));
        assert_eq!(Beacon::mac_of(&b.encode()), None);
        assert_eq!(Beacon::mac_of(&b.encode_with_mac([0; MAC_LEN])), None);
    }
}
