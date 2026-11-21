package id.cantol.mobile.link;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;

/**
 * The held TCP link to Cantol. It repeats a heartbeat frame (built by the WASM codec) and counts
 * any frame coming back as proof of life; when none arrives within one interval, or the socket
 * fails, it reports {@link State#LOST} once and keeps trying to reconnect until {@link #close()}
 * (ADR-003: heartbeat and reconnect timers live in native code, because JavaScript timers are
 * throttled in the background). It never reads what the frames mean: each whole frame that arrives
 * is handed to {@link Listener#onFrame} as the bytes it was, and {@link #send} writes bytes the app
 * built, sharing the socket with the heartbeat without ever mixing their bytes.
 */
public final class CantolConnection {
    public enum State { UP, LOST }

    public interface Listener {
        /** Called on the link's own thread: after a loss once, and after a reconnect once. */
        void onState(State state, String detail);

        /**
         * Called on the link's own thread with every whole frame that arrives, answers to the
         * heartbeat included. The bytes are not checked here (the app's codec does that); a listener
         * that throws does not stop the link.
         */
        default void onFrame(byte[] frame) {}
    }

    private static final int RECONNECT_DELAY_MS = 1000;

    private final String host;
    private final int port;
    private final byte[] heartbeat;
    private final int intervalMs;
    private final int connectTimeoutMs;
    private final Listener listener;

    private volatile boolean closed;
    private volatile boolean up;
    private volatile Socket socket;
    /** The socket frames can be sent on now: set once the first heartbeat is answered, cleared when it fails. */
    private volatile Live current;
    private volatile long lastRxNanos;
    private volatile double rttMs = Double.NaN;
    private volatile String lastError = "";
    private Thread thread;

    /** One socket and the reader that keeps its place in the byte stream. */
    private static final class Live {
        final Socket socket;
        final OutputStream out;
        final FrameIo.Reader reader;

        Live(Socket socket) throws IOException {
            this.socket = socket;
            this.out = socket.getOutputStream();
            this.reader = new FrameIo.Reader(socket.getInputStream());
        }

        /** One writer at a time, so a frame from {@link #send} never lands in the middle of a heartbeat. */
        void write(byte[] bytes) throws IOException {
            synchronized (out) {
                out.write(bytes);
                out.flush();
            }
        }

        void close() {
            try {
                socket.close();
            } catch (IOException ignored) {
                // closing is best effort
            }
        }
    }

    public CantolConnection(String host, int port, byte[] heartbeat, int intervalMs, int connectTimeoutMs, Listener listener) {
        this.host = host;
        this.port = port;
        this.heartbeat = heartbeat.clone();
        this.intervalMs = intervalMs;
        this.connectTimeoutMs = connectTimeoutMs;
        this.listener = listener;
    }

    /**
     * Connects, sends the first heartbeat and waits for any frame; then keeps the link alive on a
     * background thread. Returns the round-trip time of that first heartbeat in milliseconds.
     */
    public synchronized double open() throws IOException {
        if (thread != null) throw new IllegalStateException("already open");
        Live live = dial();
        current = live;
        up = true;
        thread = new Thread(() -> run(live), "cantol-link");
        thread.setDaemon(true);
        thread.start();
        return rttMs;
    }

    /**
     * Sends bytes the app built (a Start or Stop frame, say) on the held connection. Fails with an
     * {@link IOException} if the link is not up, so the caller can tell the operator rather than
     * hope; a frame written just as the link drops may still be lost, which the app learns from
     * the link state.
     */
    public void send(byte[] bytes) throws IOException {
        Live live = current;
        if (live == null || !up || closed) throw new IOException("the Cantol link is not up");
        live.write(bytes);
    }

    public synchronized void close() {
        closed = true;
        up = false;
        current = null;
        Socket s = socket;
        if (s != null) {
            try {
                s.close();
            } catch (IOException ignored) {
                // closing is best effort
            }
        }
        if (thread != null) thread.interrupt();
    }

    public boolean isUp() {
        return up;
    }

    public String host() {
        return host;
    }

    /** Milliseconds since the last frame arrived, or -1 if none has. */
    public long lastRxAgeMs() {
        long at = lastRxNanos;
        return at == 0 ? -1 : (System.nanoTime() - at) / 1_000_000;
    }

    /** Round trip of the latest answered heartbeat in milliseconds, or NaN. */
    public double rttMs() {
        return rttMs;
    }

    public String lastError() {
        return lastError;
    }

    private Live dial() throws IOException {
        Socket s = new Socket();
        Live live = null;
        try {
            s.setTcpNoDelay(true);
            s.setKeepAlive(true);
            s.connect(new InetSocketAddress(host, port), connectTimeoutMs);
            socket = s;
            live = new Live(s);
            beat(live);
            return live;
        } catch (IOException | RuntimeException e) {
            if (live != null) live.close();
            else {
                try {
                    s.close();
                } catch (IOException ignored) {
                    // closing is best effort
                }
            }
            throw e;
        }
    }

    private void run(Live first) {
        Live live = first;
        while (!closed) {
            try {
                if (live == null) {
                    live = dial();
                    current = live;
                    up = true;
                    listener.onState(State.UP, "reconnected");
                }
                while (!closed) beat(live);
            } catch (IOException e) {
                lastError = describe(e);
                current = null;
                if (live != null) {
                    live.close();
                    live = null;
                }
                if (up && !closed) {
                    up = false;
                    listener.onState(State.LOST, lastError);
                }
                pause(RECONNECT_DELAY_MS);
            }
        }
        if (live != null) live.close();
    }

    /**
     * Sends one heartbeat and reads for one interval. The link is alive if at least one frame
     * (the answer, or the status Cantol sends anyway) arrives. Every frame is read, so the socket
     * buffer never fills, and handed to the listener. Throws if nothing arrives or the socket fails.
     */
    private void beat(Live live) throws IOException {
        long sentAt = System.nanoTime();
        live.write(heartbeat);
        long deadline = sentAt + intervalMs * 1_000_000L;
        boolean answered = false;
        while (true) {
            long remainingMs = (deadline - System.nanoTime()) / 1_000_000;
            if (remainingMs <= 0) break;
            live.socket.setSoTimeout((int) Math.max(1, remainingMs));
            byte[] frame;
            try {
                frame = live.reader.next();
            } catch (SocketTimeoutException e) {
                break;
            }
            long now = System.nanoTime();
            lastRxNanos = now;
            if (!answered) {
                answered = true;
                rttMs = (now - sentAt) / 1_000_000.0;
            }
            deliver(frame);
        }
        if (!answered) throw new IOException("no answer within " + intervalMs + " ms");
    }

    private void deliver(byte[] frame) {
        try {
            listener.onFrame(frame);
        } catch (RuntimeException e) {
            lastError = "a frame listener failed: " + e.getClass().getSimpleName();
        }
    }

    private static String describe(IOException e) {
        String message = e.getMessage();
        return message == null || message.isEmpty() ? e.getClass().getSimpleName() : message;
    }

    private void pause(int ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
