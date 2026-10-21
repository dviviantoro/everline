#[derive(Clone, Debug)]
pub struct Config {
    /// Address to listen on. `0.0.0.0` so a phone on the hotspot can reach it.
    pub bind: String,
    /// TCP data port (0 picks a free one; used by tests).
    pub port: u16,
    pub beacon: bool,
    pub beacon_port: u16,
    /// Where the beacon is sent. The limited broadcast address reaches a hotspot subnet.
    pub beacon_target: String,
    /// Seeds all randomness so a run is reproducible.
    pub seed: u64,
    /// PD events per second while streaming.
    pub pd_rate_hz: u32,
    /// Percentage of frames silently not sent (their sequence numbers still advance).
    pub loss_pct: f64,
    /// Percentage of frames sent with one flipped bit.
    pub corrupt_pct: f64,
    /// Close each connection after this many seconds (0 = never).
    pub disconnect_every_s: u64,
    pub device_id: [u8; 8],
    pub fw: [u8; 3],
}

impl Default for Config {
    fn default() -> Self {
        Config {
            bind: "0.0.0.0".into(),
            port: 47000,
            beacon: true,
            beacon_port: 47001,
            beacon_target: "255.255.255.255".into(),
            seed: 1,
            pd_rate_hz: 200,
            loss_pct: 0.0,
            corrupt_pct: 0.0,
            disconnect_every_s: 0,
            device_id: *b"RP-MOCK\0",
            fw: [0, 1, 0],
        }
    }
}
