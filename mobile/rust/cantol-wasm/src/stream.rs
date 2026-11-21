//! What the phone makes of a frame that arrives while Cantol streams: one frame in, one line of
//! JSON out, with the amplitudes and the noise floor already in dBmV.
//!
//! The Android plugin cuts the TCP stream into whole frames and hands each to the app; the app
//! passes it here. Framing, CRC and meaning stay in Rust (ADR-003), and so does the calibration
//! (`cantol_dsp::calibration`), so no screen holds a conversion factor.

use std::fmt::Write as _;

use cantol_dsp::counts_to_dbmv;
use cantol_proto::FrameDecoder;
use cantol_proto::frame::{FLAG_DROPPED_BEFORE, Kind};
use cantol_proto::msg::{STATUS_MAINS_LOCK, STATUS_SYNTHETIC, Status, decode_pd_events};

fn error(code: &str) -> String {
    format!("{{\"error\":\"{code}\"}}")
}

fn status_json(payload: &[u8]) -> String {
    let Ok(s) = Status::decode(payload) else {
        return error("bad_status");
    };
    let mut out = String::with_capacity(220);
    let _ = write!(
        out,
        "{{\"kind\":\"status\",\"temp_c\":{:.1},\"adc_clip_pct\":{:.1},\"noise_floor_dbmv\":{:.2},\"trigger_rate_hz\":{},\"queue\":{},\"mains_lock\":{},\"synthetic\":{},\"sensors\":[",
        f64::from(s.temp_c_x10) / 10.0,
        f64::from(s.adc_clip_pct_x10) / 10.0,
        counts_to_dbmv(f64::from(s.noise_floor_counts)),
        s.trigger_rate_hz,
        s.queue,
        s.flags & STATUS_MAINS_LOCK != 0,
        s.flags & STATUS_SYNTHETIC != 0,
    );
    for (i, sensor) in Status::sensors_of(payload)
        .unwrap_or_default()
        .iter()
        .enumerate()
    {
        if i > 0 {
            out.push(',');
        }
        let _ = write!(
            out,
            "{{\"noise_floor_dbmv\":{:.2},\"trigger_rate_hz\":{}}}",
            counts_to_dbmv(f64::from(sensor.noise_floor_counts)),
            sensor.trigger_rate_hz
        );
    }
    out.push_str("]}");
    out
}

fn events_json(payload: &[u8], dropped_before: bool) -> String {
    let Ok(events) = decode_pd_events(payload) else {
        return error("bad_events");
    };
    let mut out = String::with_capacity(48 + events.len() * 72);
    let _ = write!(
        out,
        "{{\"kind\":\"events\",\"dropped_before\":{dropped_before},\"events\":["
    );
    for (i, e) in events.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        let _ = write!(
            out,
            "{{\"t_us\":{},\"amp_dbmv\":{:.2},\"phase\":{},\"width_ns\":{},\"polarity\":{},\"ch\":{}}}",
            e.t_us,
            counts_to_dbmv(f64::from(e.amp_counts)),
            e.phase,
            e.width_ns,
            u8::from(e.polarity != 0),
            e.channel,
        );
    }
    out.push_str("]}");
    out
}

/// Report on the first valid frame in `bytes`:
///
/// - `{"kind":"status","temp_c":41.2,"adc_clip_pct":0.3,"noise_floor_dbmv":15.56,"trigger_rate_hz":300,"queue":0,"mains_lock":true,"synthetic":false,"sensors":[{"noise_floor_dbmv":15.56,"trigger_rate_hz":300}]}` (`sensors` is empty when the device reports none)
/// - `{"kind":"events","dropped_before":false,"events":[{"t_us":10,"amp_dbmv":40.00,"phase":16384,"width_ns":120,"polarity":0,"ch":0}]}` (`ch` is the sensor, counted from 0)
/// - `{"kind":"device_error","code":3}` when Cantol sends an `Error` frame
/// - `{"kind":"other","frame_kind":17}` for a frame the stream does not need (a pong, a waveform, a kind from a newer protocol)
/// - `{"error":"no_frame"}` when nothing complete and valid is there (a truncated or corrupted frame), `{"error":"bad_status"}` / `{"error":"bad_events"}` when the payload does not fit its layout
pub fn stream_report(bytes: &[u8]) -> String {
    let mut decoder = FrameDecoder::new();
    let mut report: Option<String> = None;
    decoder.push(bytes, |f| {
        if report.is_some() {
            return;
        }
        report = Some(match Kind::from_u8(f.kind) {
            Some(Kind::Status) => status_json(f.payload),
            Some(Kind::PdEvent) => events_json(f.payload, f.flags & FLAG_DROPPED_BEFORE != 0),
            Some(Kind::Error) => format!(
                "{{\"kind\":\"device_error\",\"code\":{}}}",
                f.payload.first().copied().unwrap_or(0)
            ),
            _ => format!("{{\"kind\":\"other\",\"frame_kind\":{}}}", f.kind),
        });
    });
    report.unwrap_or_else(|| error("no_frame"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use cantol_proto::frame::{FLAG_MORE, encode_frame};
    use cantol_proto::msg::{PdEvent, SensorStat, encode_pd_events};

    fn frame(kind: Kind, flags: u8, payload: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        encode_frame(&mut out, kind as u8, flags, 1, 0, payload).unwrap();
        out
    }

    #[test]
    fn a_status_is_reported_in_engineering_units() {
        let status = Status {
            temp_c_x10: 412,
            adc_clip_pct_x10: 3,
            noise_floor_counts: 20,
            trigger_rate_hz: 300,
            queue: 4,
            flags: STATUS_MAINS_LOCK,
        };
        assert_eq!(
            stream_report(&frame(Kind::Status, 0, &status.encode())),
            "{\"kind\":\"status\",\"temp_c\":41.2,\"adc_clip_pct\":0.3,\"noise_floor_dbmv\":6.02,\"trigger_rate_hz\":300,\"queue\":4,\"mains_lock\":true,\"synthetic\":false,\"sensors\":[]}"
        );
    }

    #[test]
    fn a_status_reports_each_sensor_when_the_device_sends_them() {
        let status = Status {
            temp_c_x10: 410,
            adc_clip_pct_x10: 0,
            noise_floor_counts: 20,
            trigger_rate_hz: 300,
            queue: 0,
            flags: STATUS_MAINS_LOCK,
        };
        let payload = status.encode_with_sensors(&[
            SensorStat {
                noise_floor_counts: 20,
                trigger_rate_hz: 200,
            },
            SensorStat {
                noise_floor_counts: 100,
                trigger_rate_hz: 100,
            },
        ]);
        let report = stream_report(&frame(Kind::Status, 0, &payload));
        assert!(
            report.ends_with(
                "\"sensors\":[{\"noise_floor_dbmv\":6.02,\"trigger_rate_hz\":200},{\"noise_floor_dbmv\":20.00,\"trigger_rate_hz\":100}]}"
            ),
            "{report}"
        );
    }

    #[test]
    fn the_flags_are_read_one_bit_each() {
        let report = |flags| {
            let status = Status {
                temp_c_x10: -35,
                adc_clip_pct_x10: 0,
                noise_floor_counts: 100,
                trigger_rate_hz: 0,
                queue: 0,
                flags,
            };
            stream_report(&frame(Kind::Status, 0, &status.encode()))
        };
        assert!(report(0).ends_with("\"mains_lock\":false,\"synthetic\":false,\"sensors\":[]}"));
        assert!(
            report(STATUS_MAINS_LOCK)
                .ends_with("\"mains_lock\":true,\"synthetic\":false,\"sensors\":[]}")
        );
        assert!(
            report(STATUS_SYNTHETIC)
                .ends_with("\"mains_lock\":false,\"synthetic\":true,\"sensors\":[]}")
        );
        assert!(
            report(STATUS_MAINS_LOCK | STATUS_SYNTHETIC)
                .ends_with("\"mains_lock\":true,\"synthetic\":true,\"sensors\":[]}")
        );
        assert!(report(0).contains("\"temp_c\":-3.5,"));
    }

    #[test]
    fn pulses_are_reported_with_calibrated_amplitudes() {
        let events = [
            PdEvent {
                t_us: 10,
                amp_counts: 1000,
                phase: 16384,
                width_ns: 120,
                polarity: 0,
                channel: 0,
            },
            PdEvent {
                t_us: 20,
                amp_counts: -100,
                phase: 49152,
                width_ns: 90,
                polarity: 1,
                channel: 2,
            },
        ];
        let mut payload = Vec::new();
        encode_pd_events(&events, &mut payload);
        assert_eq!(
            stream_report(&frame(Kind::PdEvent, 0, &payload)),
            "{\"kind\":\"events\",\"dropped_before\":false,\"events\":[{\"t_us\":10,\"amp_dbmv\":40.00,\"phase\":16384,\"width_ns\":120,\"polarity\":0,\"ch\":0},{\"t_us\":20,\"amp_dbmv\":20.00,\"phase\":49152,\"width_ns\":90,\"polarity\":1,\"ch\":2}]}"
        );
    }

    #[test]
    fn an_empty_batch_a_dropped_flag_and_a_wild_polarity_byte_are_handled() {
        let mut payload = Vec::new();
        encode_pd_events(&[], &mut payload);
        assert_eq!(
            stream_report(&frame(Kind::PdEvent, 0, &payload)),
            "{\"kind\":\"events\",\"dropped_before\":false,\"events\":[]}"
        );
        assert!(
            stream_report(&frame(Kind::PdEvent, FLAG_DROPPED_BEFORE, &payload))
                .contains("\"dropped_before\":true")
        );
        // A byte that is neither 0 nor 1 still reaches the screens as a polarity they know.
        let wild = PdEvent {
            t_us: 0,
            amp_counts: 0,
            phase: 0,
            width_ns: 0,
            polarity: 7,
            channel: 0,
        };
        let mut payload = Vec::new();
        encode_pd_events(&[wild], &mut payload);
        let report = stream_report(&frame(Kind::PdEvent, 0, &payload));
        assert!(report.contains("\"polarity\":1,\"ch\":0}"), "{report}");
        assert!(
            report.contains("\"amp_dbmv\":-20.00,"),
            "zero counts: the smallest step"
        );
    }

    #[test]
    fn a_batch_of_the_largest_size_the_device_sends_is_reported_whole() {
        let events: Vec<PdEvent> = (0..500)
            .map(|i| PdEvent {
                t_us: i,
                amp_counts: 500,
                phase: i as u16,
                width_ns: 100,
                polarity: (i % 2) as u8,
                channel: 0,
            })
            .collect();
        let mut payload = Vec::new();
        encode_pd_events(&events, &mut payload);
        let report = stream_report(&frame(Kind::PdEvent, FLAG_MORE, &payload));
        assert_eq!(report.matches("\"t_us\"").count(), 500);
        assert!(report.ends_with("]}"));
    }

    #[test]
    fn other_frames_errors_and_damage_are_named_not_guessed() {
        assert_eq!(
            stream_report(&frame(Kind::Error, 0, &[3])),
            "{\"kind\":\"device_error\",\"code\":3}"
        );
        assert_eq!(
            stream_report(&frame(Kind::Pong, 0, &[0; 26])),
            "{\"kind\":\"other\",\"frame_kind\":2}"
        );
        assert_eq!(
            stream_report(&frame(Kind::Status, 0, &[1, 2, 3])),
            "{\"error\":\"bad_status\"}"
        );
        assert_eq!(
            stream_report(&frame(Kind::PdEvent, 0, &[2, 0, 1])),
            "{\"error\":\"bad_events\"}"
        );
        assert_eq!(stream_report(&[]), "{\"error\":\"no_frame\"}");
        let whole = frame(Kind::Status, 0, &[0; 11]);
        assert_eq!(
            stream_report(&whole[..whole.len() - 1]),
            "{\"error\":\"no_frame\"}",
            "truncated"
        );
        let mut corrupt = whole.clone();
        corrupt[22] ^= 0x10;
        assert_eq!(
            stream_report(&corrupt),
            "{\"error\":\"no_frame\"}",
            "bad CRC"
        );
    }
}
