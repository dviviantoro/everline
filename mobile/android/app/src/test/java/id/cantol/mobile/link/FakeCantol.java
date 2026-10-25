package id.cantol.mobile.link;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * A stand-in Cantol on a real loopback socket. It answers every chunk it reads with one valid
 * frame header (kind 0x03, empty payload), or stays silent, or hangs up, as the test says. The
 * bytes are not the real protocol: the Rust side is tested separately, and against the real mock
 * in {@code MockIntegrationTest}.
 */
final class FakeCantol implements AutoCloseable {
    enum Mode { ANSWER, SILENT }

    /** magic, ver 1, kind 0x03 (status), flags 0, seq 0, ts_us 0, len 0, crc 0 (not checked here). */
    static final byte[] FRAME = new byte[FrameIo.HEADER_LEN + FrameIo.CRC_LEN];

    static {
        FRAME[0] = 0x57;
        FRAME[1] = (byte) 0xCA;
        FRAME[2] = 1;
        FRAME[3] = 0x03;
    }

    private final ServerSocket server;
    private final CopyOnWriteArrayList<Socket> clients = new CopyOnWriteArrayList<>();
    private volatile Mode mode = Mode.ANSWER;
    private volatile int accepted;
    private volatile int received;

    FakeCantol() throws IOException {
        server = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
        Thread acceptor = new Thread(this::acceptLoop, "fake-cantol-accept");
        acceptor.setDaemon(true);
        acceptor.start();
    }

    int port() {
        return server.getLocalPort();
    }

    void mode(Mode mode) {
        this.mode = mode;
    }

    int accepted() {
        return accepted;
    }

    int received() {
        return received;
    }

    /** Hangs up on every connected client at once. */
    void hangUp() {
        for (Socket client : clients) {
            try {
                client.close();
            } catch (IOException ignored) {
                // already closed
            }
        }
    }

    private void acceptLoop() {
        while (!server.isClosed()) {
            try {
                Socket client = server.accept();
                accepted++;
                clients.add(client);
                Thread handler = new Thread(() -> serve(client), "fake-cantol-client");
                handler.setDaemon(true);
                handler.start();
            } catch (IOException e) {
                return;
            }
        }
    }

    private void serve(Socket client) {
        byte[] buf = new byte[512];
        try {
            InputStream in = client.getInputStream();
            OutputStream out = client.getOutputStream();
            int n;
            while ((n = in.read(buf)) >= 0) {
                if (n > 0) received++;
                if (mode == Mode.ANSWER) {
                    out.write(FRAME);
                    out.flush();
                }
            }
        } catch (IOException ignored) {
            // the client went away
        }
    }

    @Override
    public void close() throws IOException {
        server.close();
        hangUp();
    }
}
