package id.cantol.mobile.link;

import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;

/**
 * Cuts a TCP byte stream into whole Cantol frames, and nothing more. It knows the length prefix
 * of the frame (see {@code mobile/rust/cantol-proto/src/frame.rs}) so it can tell where one frame
 * ends; it does not check the CRC or read the payload. Meaning, CRC and resync stay in Rust.
 */
public final class FrameIo {
    private FrameIo() {}

    /** magic u16, ver u8, kind u8, flags u8, seq u32, ts_us u64, len u32. */
    public static final int HEADER_LEN = 21;
    /** Offset of {@code len}, a little-endian u32. */
    public static final int LEN_OFFSET = 17;
    public static final int CRC_LEN = 4;
    public static final int MAX_PAYLOAD = 64 * 1024;
    private static final byte MAGIC_0 = 0x57;
    private static final byte MAGIC_1 = (byte) 0xCA;

    /** Blocks until one whole frame has arrived. */
    public static byte[] readFrame(InputStream in) throws IOException {
        return new Reader(in).next();
    }

    /**
     * Reads frames from one stream. A read timeout ({@link java.net.SocketTimeoutException}) leaves
     * the bytes read so far in place, so the next call carries on from the same frame instead of
     * losing its place in the stream.
     */
    public static final class Reader {
        private final InputStream in;
        private byte[] buf = new byte[HEADER_LEN];
        private int have;
        private boolean sized;

        public Reader(InputStream in) {
            this.in = in;
        }

        public byte[] next() throws IOException {
            while (true) {
                int n = in.read(buf, have, buf.length - have);
                if (n < 0) throw new EOFException(have == 0 ? "the link was closed" : "the link closed in the middle of a frame");
                have += n;
                if (have < buf.length) continue;
                if (!sized) {
                    if (buf[0] != MAGIC_0 || buf[1] != MAGIC_1) throw new IOException("not a Cantol frame (bad magic)");
                    long len = (buf[LEN_OFFSET] & 0xFFL)
                            | ((buf[LEN_OFFSET + 1] & 0xFFL) << 8)
                            | ((buf[LEN_OFFSET + 2] & 0xFFL) << 16)
                            | ((buf[LEN_OFFSET + 3] & 0xFFL) << 24);
                    if (len > MAX_PAYLOAD) throw new IOException("not a Cantol frame (length " + len + ")");
                    buf = Arrays.copyOf(buf, HEADER_LEN + (int) len + CRC_LEN);
                    sized = true;
                    if (have < buf.length) continue;
                }
                byte[] frame = buf;
                buf = new byte[HEADER_LEN];
                have = 0;
                sized = false;
                return frame;
            }
        }
    }
}
