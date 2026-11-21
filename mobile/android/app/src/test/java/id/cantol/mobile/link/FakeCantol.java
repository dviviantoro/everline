package id.cantol.mobile.link;

import java.io.ByteArrayOutputStream;
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
    private final ByteArrayOutputStream receivedBytes = new ByteArrayOutputStream();

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

    /** Everything the clients have written so far, in the order it arrived. */
    synchronized byte[] receivedBytes() {
        return receivedBytes.toByteArray();
    }

    /** A frame with the given kind and payload (the CRC is zero: the Java side does not check it). */
    static byte[] frame(int kind, byte[] payload) {
        byte[] out = new byte[FrameIo.HEADER_LEN + payload.length + FrameIo.CRC_LEN];
        out[0] = 0x57;
        out[1] = (byte) 0xCA;
        out[2] = 1;
        out[3] = (byte) kind;
        out[FrameIo.LEN_OFFSET] = (byte) payload.length;
        out[FrameIo.LEN_OFFSET + 1] = (byte) (payload.length >> 8);
        System.arraycopy(payload, 0, out, FrameIo.HEADER_LEN, payload.length);
        return out;
    }

    /**
     * Sends bytes to every connected client now, in pieces of at most {@code piece} bytes a few
     * milliseconds apart, as a slow network would. Like a real device it has one writer: its own
     * answers to the heartbeat wait until the bytes have all gone, so they never land in the middle.
     */
    void emit(byte[] bytes, int piece) throws IOException, InterruptedException {
        for (Socket client : clients) {
            OutputStream out = client.getOutputStream();
            synchronized (out) {
                for (int at = 0; at < bytes.length; at += piece) {
                    out.write(bytes, at, Math.min(piece, bytes.length - at));
                    out.flush();
                    if (piece < bytes.length) Thread.sleep(5);
                }
            }
        }
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
                if (n > 0) {
                    received++;
                    synchronized (this) {
                        receivedBytes.write(buf, 0, n);
                    }
                }
                if (mode == Mode.ANSWER) {
                    synchronized (out) {
                        out.write(FRAME);
                        out.flush();
                    }
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
