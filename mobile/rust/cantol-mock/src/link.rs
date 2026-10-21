//! Protocol behaviour for one phone connection: answer HELLO, stream STATUS and PD events,
//! and apply the configured faults when writing.

use std::io::{self, Write};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use cantol_proto::frame::{FrameRef, Kind, PROTO_VERSION, encode_frame};
use cantol_proto::msg::{Hello, PdEvent, Pong, STATUS_MAINS_LOCK, Status, encode_pd_events};

use crate::config::Config;
use crate::rng::Rng;

const STATUS_PERIOD: Duration = Duration::from_secs(1);
const PD_PERIOD: Duration = Duration::from_millis(50);
const MAX_EVENTS_PER_BATCH: usize = 500;
/// `Error` payload: the phone's protocol range does not include ours.
const ERR_UNSUPPORTED_VERSION: u8 = 1;

pub type Outgoing = Vec<(Kind, Vec<u8>)>;

pub struct Link<'a> {
    cfg: &'a Config,
    rng: Rng,
    seq: u32,
    streaming: bool,
    next_status: Duration,
    next_pd: Duration,
    pd_carry: f64,
}

impl<'a> Link<'a> {
    pub fn new(cfg: &'a Config, conn_id: u64) -> Self {
        Link {
            cfg,
            rng: Rng::new(cfg.seed ^ conn_id.wrapping_mul(0x9E37_79B9_7F4A_7C15)),
            seq: 0,
            streaming: false,
            next_status: Duration::ZERO,
            next_pd: Duration::ZERO,
            pd_carry: 0.0,
        }
    }

    /// React to a frame from the phone, queueing any replies.
    pub fn on_frame(&mut self, frame: &FrameRef<'_>, out: &mut Outgoing) {
        match Kind::from_u8(frame.kind) {
            Some(Kind::Hello) => {
                if let Ok(hello) = Hello::decode(frame.payload) {
                    out.push(self.answer_hello(&hello));
                }
            }
            Some(Kind::Start) => self.streaming = true,
            Some(Kind::Stop) => self.streaming = false,
            // The phone's keep-alive: answer at once so it sees traffic even between statuses.
            Some(Kind::Ping) => out.push((Kind::Status, self.status().encode().to_vec())),
            _ => {}
        }
    }

    fn answer_hello(&self, hello: &Hello) -> (Kind, Vec<u8>) {
        if hello.proto_min > PROTO_VERSION || hello.proto_max < PROTO_VERSION {
            return (Kind::Error, vec![ERR_UNSUPPORTED_VERSION]);
        }
        let pong = Pong {
            proto: PROTO_VERSION,
            caps: 0b11,
            fw: self.cfg.fw,
            device_id: self.cfg.device_id,
            cantol_epoch_ms: epoch_ms(),
            nonce: hello.nonce,
        };
        (Kind::Pong, pong.encode().to_vec())
    }

    /// Queue whatever periodic messages are due at `now` (time since the connection opened).
    pub fn tick(&mut self, now: Duration, out: &mut Outgoing) {
        if now >= self.next_status {
            self.next_status = now + STATUS_PERIOD;
            out.push((Kind::Status, self.status().encode().to_vec()));
        }
        if self.streaming && now >= self.next_pd {
            self.next_pd = now + PD_PERIOD;
            if let Some(batch) = self.pd_batch() {
                out.push((Kind::PdEvent, batch));
            }
        }
    }

    fn status(&mut self) -> Status {
        Status {
            temp_c_x10: 400 + self.rng.range(0, 30) as i16,
            adc_clip_pct_x10: 0,
            noise_floor_counts: 60 + self.rng.range(0, 20) as u16,
            trigger_rate_hz: self.cfg.pd_rate_hz.min(u32::from(u16::MAX)) as u16,
            queue: 0,
            flags: STATUS_MAINS_LOCK,
        }
    }

    fn pd_batch(&mut self) -> Option<Vec<u8>> {
        let wanted = f64::from(self.cfg.pd_rate_hz) * PD_PERIOD.as_secs_f64() + self.pd_carry;
        let count = (wanted.floor() as usize).min(MAX_EVENTS_PER_BATCH);
        self.pd_carry = wanted - wanted.floor();
        if count == 0 {
            return None;
        }
        let span = PD_PERIOD.as_micros() as u32;
        let events: Vec<PdEvent> = (0..count)
            .map(|i| PdEvent {
                t_us: span * i as u32 / count as u32,
                amp_counts: self.rng.range(50, 4_000) as i16 * if i % 2 == 0 { 1 } else { -1 },
                phase: self.rng.range(0, u32::from(u16::MAX)) as u16,
                width_ns: self.rng.range(40, 600) as u16,
                polarity: (i % 2) as u8,
            })
            .collect();
        let mut payload = Vec::new();
        encode_pd_events(&events, &mut payload);
        Some(payload)
    }

    /// Write one frame, applying loss and corruption. A lost frame still consumes its sequence
    /// number, which is how the phone detects the gap.
    pub fn send(
        &mut self,
        w: &mut impl Write,
        now: Duration,
        kind: Kind,
        payload: &[u8],
    ) -> io::Result<()> {
        let seq = self.seq;
        self.seq = self.seq.wrapping_add(1);
        if self.rng.chance_pct(self.cfg.loss_pct) {
            return Ok(());
        }
        let mut frame = Vec::with_capacity(payload.len() + 25);
        encode_frame(
            &mut frame,
            kind as u8,
            0,
            seq,
            now.as_micros() as u64,
            payload,
        )
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "payload too large"))?;
        if self.rng.chance_pct(self.cfg.corrupt_pct) {
            let bit = self.rng.range(0, frame.len() as u32 * 8 - 1) as usize;
            frame[bit / 8] ^= 1 << (bit % 8);
        }
        w.write_all(&frame)
    }
}

fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}
