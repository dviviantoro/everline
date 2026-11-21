use std::process::ExitCode;
use std::thread;
use std::time::Duration;

use cantol_mock::{Config, spawn};
use cantol_proto::msg::SensorStat;

const USAGE: &str = "\
cantol-mock: simulated Cantol device for the Cantol mobile app

usage: cantol-mock [options]
  --bind ADDR             listen address                      (default 0.0.0.0)
  --port N                TCP data port                       (default 47000)
  --beacon-port N         UDP beacon port                     (default 47001)
  --beacon-target IP      where the beacon is sent            (default 255.255.255.255)
  --no-beacon             do not send the discovery beacon
  --seed N                seed for all randomness             (default 1)
  --pd-rate N             PD events per second when streaming (default 200)
  --loss PCT              percent of frames not sent          (default 0)
  --corrupt PCT           percent of frames with a flipped bit (default 0)
  --disconnect-every SECS close each connection after SECS    (default never)
  --device-id TEXT        up to 8 characters                  (default RP-MOCK)
  --mac ADDR              MAC address it reports               (default 02:CA:57:00:00:01)
  --sensors N             pretend to have N sensors (1 to 8)   (default 1; pulses cycle through them)
";

fn main() -> ExitCode {
    match parse(std::env::args().skip(1).collect()) {
        Ok(Some(cfg)) => run(cfg),
        Ok(None) => {
            print!("{USAGE}");
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("cantol-mock: {message}\n\n{USAGE}");
            ExitCode::from(2)
        }
    }
}

fn run(cfg: Config) -> ExitCode {
    match spawn(cfg) {
        Ok(handle) => {
            eprintln!(
                "cantol-mock: listening on {} (Ctrl-C to stop)",
                handle.addr()
            );
            loop {
                thread::sleep(Duration::from_secs(3600));
            }
        }
        Err(e) => {
            eprintln!("cantol-mock: cannot start: {e}");
            ExitCode::FAILURE
        }
    }
}

/// `Ok(None)` means help was requested.
fn parse(args: Vec<String>) -> Result<Option<Config>, String> {
    let mut cfg = Config::default();
    let mut it = args.into_iter();
    while let Some(flag) = it.next() {
        let mut value = |name: &str| it.next().ok_or_else(|| format!("{name} needs a value"));
        match flag.as_str() {
            "-h" | "--help" => return Ok(None),
            "--no-beacon" => cfg.beacon = false,
            "--bind" => cfg.bind = value("--bind")?,
            "--port" => cfg.port = number(&value("--port")?, "--port")?,
            "--beacon-port" => cfg.beacon_port = number(&value("--beacon-port")?, "--beacon-port")?,
            "--beacon-target" => cfg.beacon_target = value("--beacon-target")?,
            "--seed" => cfg.seed = number(&value("--seed")?, "--seed")?,
            "--pd-rate" => cfg.pd_rate_hz = number(&value("--pd-rate")?, "--pd-rate")?,
            "--loss" => cfg.loss_pct = number(&value("--loss")?, "--loss")?,
            "--corrupt" => cfg.corrupt_pct = number(&value("--corrupt")?, "--corrupt")?,
            "--disconnect-every" => {
                cfg.disconnect_every_s =
                    number(&value("--disconnect-every")?, "--disconnect-every")?;
            }
            "--device-id" => cfg.device_id = device_id(&value("--device-id")?)?,
            "--mac" => cfg.mac = mac(&value("--mac")?)?,
            "--sensors" => {
                cfg.sensors = number(&value("--sensors")?, "--sensors")?;
                if cfg.sensors == 0 || usize::from(cfg.sensors) > SensorStat::MAX_SENSORS {
                    return Err("--sensors must be from 1 to 8".into());
                }
            }
            other => return Err(format!("unknown option {other}")),
        }
    }
    Ok(Some(cfg))
}

fn number<T: std::str::FromStr>(text: &str, name: &str) -> Result<T, String> {
    text.parse()
        .map_err(|_| format!("{name}: '{text}' is not a valid number"))
}

fn device_id(text: &str) -> Result<[u8; 8], String> {
    if !text.is_ascii() || text.len() > 8 {
        return Err("--device-id must be at most 8 ASCII characters".into());
    }
    let mut id = [0u8; 8];
    id[..text.len()].copy_from_slice(text.as_bytes());
    Ok(id)
}

/// `AA:BB:CC:DD:EE:FF` (colons or dashes, either case).
fn mac(text: &str) -> Result<[u8; 6], String> {
    let parts: Vec<&str> = text.split([':', '-']).collect();
    let bad = || format!("--mac: '{text}' is not a MAC address like 02:CA:57:00:00:01");
    if parts.len() != 6 {
        return Err(bad());
    }
    let mut out = [0u8; 6];
    for (slot, part) in out.iter_mut().zip(parts) {
        if part.len() != 2 {
            return Err(bad());
        }
        *slot = u8::from_str_radix(part, 16).map_err(|_| bad())?;
    }
    if out == [0u8; 6] {
        return Err("--mac: 00:00:00:00:00:00 means \"no MAC\" and cannot be used".into());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn defaults_and_overrides() {
        let cfg = parse(args(&[])).unwrap().unwrap();
        assert_eq!((cfg.port, cfg.beacon, cfg.loss_pct), (47000, true, 0.0));
        let cfg = parse(args(&[
            "--port",
            "5000",
            "--no-beacon",
            "--loss",
            "2.5",
            "--device-id",
            "RP-01",
        ]))
        .unwrap()
        .unwrap();
        assert_eq!((cfg.port, cfg.beacon, cfg.loss_pct), (5000, false, 2.5));
        assert_eq!(&cfg.device_id, b"RP-01\0\0\0");
    }

    #[test]
    fn mac_option_takes_colons_or_dashes() {
        let cfg = parse(args(&["--mac", "00:26:32:f0:1a:BC"]))
            .unwrap()
            .unwrap();
        assert_eq!(cfg.mac, [0x00, 0x26, 0x32, 0xF0, 0x1A, 0xBC]);
        let cfg = parse(args(&["--mac", "00-26-32-F0-1A-BC"]))
            .unwrap()
            .unwrap();
        assert_eq!(cfg.mac, [0x00, 0x26, 0x32, 0xF0, 0x1A, 0xBC]);
        assert_eq!(
            parse(args(&[])).unwrap().unwrap().mac,
            [0x02, 0xCA, 0x57, 0, 0, 1]
        );
    }

    #[test]
    fn rejects_bad_input() {
        assert!(parse(args(&["--port", "abc"])).is_err());
        assert!(parse(args(&["--port"])).is_err());
        assert!(parse(args(&["--bogus"])).is_err());
        assert!(parse(args(&["--device-id", "far-too-long-id"])).is_err());
        for bad in [
            "",
            "02:CA:57:00:00",
            "02:CA:57:00:00:01:02",
            "0:CA:57:00:00:01",
            "GG:CA:57:00:00:01",
            "00:00:00:00:00:00",
        ] {
            assert!(parse(args(&["--mac", bad])).is_err(), "{bad}");
        }
        assert!(parse(args(&["--help"])).unwrap().is_none());
    }
}
