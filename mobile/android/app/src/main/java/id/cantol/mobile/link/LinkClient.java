package id.cantol.mobile.link;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;

/** One short-lived exchange with Cantol: connect, send some bytes, read one frame, hang up. */
public final class LinkClient {
    private LinkClient() {}

    public record Reply(byte[] frame, double rttMs) {}

    /**
     * Sends {@code request} (a frame built by the WASM codec) and returns the first whole frame
     * that comes back, with the time from the write to the end of that frame. Fails with an
     * {@link IOException} if nothing connects, answers, or looks like a Cantol frame.
     */
    public static Reply exchange(String host, int port, byte[] request, int connectTimeoutMs, int readTimeoutMs) throws IOException {
        try (Socket socket = new Socket()) {
            socket.setTcpNoDelay(true);
            socket.connect(new InetSocketAddress(host, port), connectTimeoutMs);
            socket.setSoTimeout(readTimeoutMs);
            OutputStream out = socket.getOutputStream();
            long sentAt = System.nanoTime();
            out.write(request);
            out.flush();
            byte[] frame = FrameIo.readFrame(socket.getInputStream());
            return new Reply(frame, (System.nanoTime() - sentAt) / 1_000_000.0);
        }
    }
}
