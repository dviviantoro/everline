//! Message payloads carried inside frames, plus the UDP discovery beacon.
//!
//! PLACEHOLDER layouts (little-endian), to be agreed with the Red Pitaya side (ADR-005).

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

/// Phone to RP: first frame on a connection. Also the payload of a "ping".
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

/// RP to phone: answer to `Hello`, echoing its nonce so the phone can match it and time the RTT.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Pong {
    pub proto: u8,
    pub caps: u16,
    pub fw: [u8; 3],
    pub device_id: [u8; 8],
    pub rp_epoch_ms: u64,
    pub nonce: u32,
}

impl Pong {
    pub const LEN: usize = 26;

    pub fn encode(&self) -> [u8; Self::LEN] {
        let mut b = [0u8; Self::LEN];
        b[0] = self.proto;
        b[1..3].copy_from_slice(&self.caps.to_le_bytes());
        b[3..6].copy_from_slice(&self.fw);
        b[6..14].copy_from_slice(&self.device_id);
        b[14..22].copy_from_slice(&self.rp_epoch_ms.to_le_bytes());
        b[22..26].copy_from_slice(&self.nonce.to_le_bytes());
        b
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
            rp_epoch_ms: u64_at(p, 14),
            nonce: u32_at(p, 22),
        })
    }
}

/// `Status.flags` bit: the RP is locked to the mains phase (needed for phase-resolved PD).
pub const STATUS_MAINS_LOCK: u8 = 0b1;

/// RP to phone, about once per second.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Status {
    pub temp_c_x10: i16,
    pub adc_clip_pct_x10: u16,
    pub noise_floor_counts: u16,
    pub trigger_rate_hz: u16,
    pub queue: u16,
    pub flags: u8,
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
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PdEvent {
    pub t_us: u32,
    pub amp_counts: i16,
    pub phase: u16,
    pub width_ns: u16,
    pub polarity: u8,
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
        out.push(0); // reserved
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
            }
        })
        .collect())
}

/// UDP discovery beacon, broadcast by the RP about once per second. Not a frame.
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

    pub fn encode(&self) -> [u8; Self::LEN] {
        let mut b = [0u8; Self::LEN];
        b[0..4].copy_from_slice(&Self::MAGIC);
        b[4] = self.proto;
        b[5..13].copy_from_slice(&self.device_id);
        b[13..15].copy_from_slice(&self.tcp_port.to_le_bytes());
        b[15..18].copy_from_slice(&self.fw);
        b
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
            rp_epoch_ms: 42,
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
            },
            PdEvent {
                t_us: 20,
                amp_counts: 4000,
                phase: 0,
                width_ns: 90,
                polarity: 0,
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
}
