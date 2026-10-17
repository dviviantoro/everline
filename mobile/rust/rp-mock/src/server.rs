use std::io::{self, Read};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use cantol_proto::FrameDecoder;
use cantol_proto::frame::PROTO_VERSION;
use cantol_proto::msg::Beacon;

use crate::config::Config;
use crate::link::{Link, Outgoing};

const POLL: Duration = Duration::from_millis(20);

/// A running mock. Dropping it stops the server and joins its threads.
pub struct Handle {
    addr: SocketAddr,
    stop: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
}

impl Handle {
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }
}

impl Drop for Handle {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        for t in self.threads.drain(..) {
            let _ = t.join();
        }
    }
}

pub fn spawn(cfg: Config) -> io::Result<Handle> {
    let listener = TcpListener::bind((cfg.bind.as_str(), cfg.port))?;
    listener.set_nonblocking(true)?;
    let addr = listener.local_addr()?;
    let stop = Arc::new(AtomicBool::new(false));
    let mut threads = Vec::new();

    let (accept_cfg, accept_stop) = (cfg.clone(), stop.clone());
    threads.push(thread::spawn(move || {
        accept_loop(&listener, &accept_cfg, &accept_stop)
    }));

    if cfg.beacon {
        let beacon_stop = stop.clone();
        // Announce the port actually bound, which matters when `port` was 0.
        threads.push(thread::spawn(move || {
            beacon_loop(&cfg, addr.port(), &beacon_stop)
        }));
    }
    Ok(Handle {
        addr,
        stop,
        threads,
    })
}

fn accept_loop(listener: &TcpListener, cfg: &Config, stop: &Arc<AtomicBool>) {
    let mut connections = Vec::new();
    let mut conn_id = 0u64;
    while !stop.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, peer)) => {
                conn_id += 1;
                eprintln!("rp-mock: connection {conn_id} from {peer}");
                let (cfg, stop) = (cfg.clone(), stop.clone());
                connections.push(thread::spawn(move || {
                    if let Err(e) = serve(stream, &cfg, conn_id, &stop) {
                        eprintln!("rp-mock: connection {conn_id} ended: {e}");
                    }
                }));
            }
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => thread::sleep(POLL),
            Err(e) => {
                eprintln!("rp-mock: accept failed: {e}");
                break;
            }
        }
    }
    for c in connections {
        let _ = c.join();
    }
}

fn serve(mut stream: TcpStream, cfg: &Config, conn_id: u64, stop: &AtomicBool) -> io::Result<()> {
    stream.set_nodelay(true)?;
    stream.set_read_timeout(Some(POLL))?;
    let started = Instant::now();
    let mut link = Link::new(cfg, conn_id);
    let mut decoder = FrameDecoder::new();
    let mut buf = [0u8; 2048];
    let mut outgoing: Outgoing = Vec::new();

    while !stop.load(Ordering::Relaxed) {
        if cfg.disconnect_every_s > 0
            && started.elapsed() >= Duration::from_secs(cfg.disconnect_every_s)
        {
            break;
        }
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => decoder.push(&buf[..n], |frame| link.on_frame(frame, &mut outgoing)),
            Err(e)
                if matches!(
                    e.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) => {}
            Err(e) => return Err(e),
        }
        let now = started.elapsed();
        link.tick(now, &mut outgoing);
        for (kind, payload) in outgoing.drain(..) {
            link.send(&mut stream, now, kind, &payload)?;
        }
    }
    let _ = stream.shutdown(Shutdown::Both);
    Ok(())
}

fn beacon_loop(cfg: &Config, tcp_port: u16, stop: &AtomicBool) {
    let Ok(socket) = UdpSocket::bind("0.0.0.0:0") else {
        eprintln!("rp-mock: cannot open the beacon socket");
        return;
    };
    let _ = socket.set_broadcast(true);
    let packet = Beacon {
        proto: PROTO_VERSION,
        device_id: cfg.device_id,
        tcp_port,
        fw: cfg.fw,
    }
    .encode();
    let target = format!("{}:{}", cfg.beacon_target, cfg.beacon_port);
    while !stop.load(Ordering::Relaxed) {
        let _ = socket.send_to(&packet, &target);
        // Sleep in short steps so a stop request is honoured promptly.
        for _ in 0..10 {
            if stop.load(Ordering::Relaxed) {
                return;
            }
            thread::sleep(Duration::from_millis(100));
        }
    }
}
