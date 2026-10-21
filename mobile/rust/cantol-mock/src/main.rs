use std::process::ExitCode;
use std::thread;
use std::time::Duration;

use cantol_mock::{Config, spawn};

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
    fn rejects_bad_input() {
        assert!(parse(args(&["--port", "abc"])).is_err());
        assert!(parse(args(&["--port"])).is_err());
        assert!(parse(args(&["--bogus"])).is_err());
        assert!(parse(args(&["--device-id", "far-too-long-id"])).is_err());
        assert!(parse(args(&["--help"])).unwrap().is_none());
    }
}
