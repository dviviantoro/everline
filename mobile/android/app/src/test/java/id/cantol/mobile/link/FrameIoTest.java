package id.cantol.mobile.link;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.io.ByteArrayInputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.net.SocketTimeoutException;
import java.util.Arrays;
import org.junit.Test;

public class FrameIoTest {
    /** A frame with the real layout; the CRC is zeros because the reader does not check it. */
    private static byte[] frame(int payloadLen, int fill) {
        byte[] out = new byte[FrameIo.HEADER_LEN + payloadLen + FrameIo.CRC_LEN];
        out[0] = 0x57;
        out[1] = (byte) 0xCA;
        out[2] = 1;
        out[3] = 0x02;
        out[FrameIo.LEN_OFFSET] = (byte) payloadLen;
        out[FrameIo.LEN_OFFSET + 1] = (byte) (payloadLen >> 8);
        Arrays.fill(out, FrameIo.HEADER_LEN, FrameIo.HEADER_LEN + payloadLen, (byte) fill);
        return out;
    }

    /** Hands out one byte per read, the worst a TCP stream can do. */
    private static final class Trickle extends InputStream {
        private final byte[] data;
        private int pos;

        Trickle(byte[] data) {
            this.data = data;
        }

        @Override
        public int read() {
            return pos < data.length ? data[pos++] & 0xFF : -1;
        }

        @Override
        public int read(byte[] b, int off, int len) {
            if (len == 0) return 0;
            if (pos >= data.length) return -1;
            b[off] = data[pos++];
            return 1;
        }
    }

    @Test
    public void readsOneWholeFrame() throws IOException {
        byte[] sent = frame(26, 7);
        assertArrayEquals(sent, FrameIo.readFrame(new ByteArrayInputStream(sent)));
    }

    @Test
    public void readsAFrameThatArrivesOneByteAtATime() throws IOException {
        byte[] sent = frame(300, 9);
        assertArrayEquals(sent, FrameIo.readFrame(new Trickle(sent)));
    }

    @Test
    public void readsAnEmptyPayloadAndTheFrameAfterIt() throws IOException {
        byte[] first = frame(0, 0);
        byte[] second = frame(5, 3);
        byte[] both = new byte[first.length + second.length];
        System.arraycopy(first, 0, both, 0, first.length);
        System.arraycopy(second, 0, both, first.length, second.length);
        FrameIo.Reader reader = new FrameIo.Reader(new Trickle(both));
        assertArrayEquals(first, reader.next());
        assertArrayEquals(second, reader.next());
    }

    @Test
    public void somethingThatIsNotCantolIsRefusedAtOnce() {
        byte[] http = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n".getBytes();
        assertEquals("not a Cantol frame (bad magic)", assertThrows(IOException.class, () -> FrameIo.readFrame(new ByteArrayInputStream(http))).getMessage());
    }

    @Test
    public void aLengthBeyondTheProtocolMaximumIsRefused() {
        byte[] sent = frame(0, 0);
        sent[FrameIo.LEN_OFFSET + 2] = 0x01; // 65536 + 0
        assertThrows(IOException.class, () -> FrameIo.readFrame(new ByteArrayInputStream(sent)));
    }

    @Test
    public void aLinkThatClosesMidFrameIsAnError() {
        byte[] sent = frame(40, 1);
        assertThrows(EOFException.class, () -> FrameIo.readFrame(new ByteArrayInputStream(Arrays.copyOf(sent, sent.length - 3))));
        assertThrows(EOFException.class, () -> FrameIo.readFrame(new ByteArrayInputStream(new byte[0])));
    }

    @Test
    public void aReadTimeoutKeepsTheReaderInPlace() throws IOException {
        byte[] sent = frame(30, 5);
        final int[] calls = {0};
        final int[] pos = {0};
        InputStream stalls = new InputStream() {
            @Override
            public int read() {
                throw new UnsupportedOperationException();
            }

            @Override
            public int read(byte[] b, int off, int len) throws IOException {
                calls[0]++;
                // Deliver the first 10 bytes, time out once, then deliver the rest in pieces.
                if (calls[0] == 2) throw new SocketTimeoutException("slow");
                int n = Math.min(calls[0] == 1 ? 10 : 12, Math.min(len, sent.length - pos[0]));
                if (n <= 0) return -1;
                System.arraycopy(sent, pos[0], b, off, n);
                pos[0] += n;
                return n;
            }
        };
        FrameIo.Reader reader = new FrameIo.Reader(stalls);
        assertThrows(SocketTimeoutException.class, reader::next);
        assertArrayEquals("the bytes read before the timeout were not lost", sent, reader.next());
    }
}
