package id.cantol.mobile.link;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import org.junit.Test;

public class LinkClientTest {
    private static final byte[] REQUEST = {1, 2, 3, 4};

    @Test
    public void returnsTheFrameThatCameBackAndHowLongItTook() throws Exception {
        try (FakeCantol cantol = new FakeCantol()) {
            LinkClient.Reply reply = LinkClient.exchange("127.0.0.1", cantol.port(), REQUEST, 500, 1000);
            assertArrayEquals(FakeCantol.FRAME, reply.frame());
            assertTrue(reply.rttMs() >= 0 && reply.rttMs() < 1000);
            assertEquals(1, cantol.received());
        }
    }

    @Test
    public void aSilentDeviceTimesOut() throws Exception {
        try (FakeCantol cantol = new FakeCantol()) {
            cantol.mode(FakeCantol.Mode.SILENT);
            long start = System.nanoTime();
            assertThrows(SocketTimeoutException.class, () -> LinkClient.exchange("127.0.0.1", cantol.port(), REQUEST, 500, 300));
            long ms = (System.nanoTime() - start) / 1_000_000;
            assertTrue("gave up after " + ms + " ms", ms >= 250 && ms < 2000);
        }
    }

    @Test
    public void nothingListeningIsRefused() throws Exception {
        int closedPort;
        try (FakeCantol cantol = new FakeCantol()) {
            closedPort = cantol.port();
        }
        assertThrows(ConnectException.class, () -> LinkClient.exchange("127.0.0.1", closedPort, REQUEST, 500, 300));
    }

    @Test
    public void aServerThatIsNotCantolIsRejected() throws Exception {
        try (java.net.ServerSocket http = new java.net.ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))) {
            Thread t = new Thread(() -> {
                try (java.net.Socket s = http.accept()) {
                    s.getInputStream().read(new byte[16]);
                    s.getOutputStream().write("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n".getBytes());
                } catch (IOException ignored) {
                    // test over
                }
            });
            t.setDaemon(true);
            t.start();
            IOException e = assertThrows(IOException.class, () -> LinkClient.exchange("127.0.0.1", http.getLocalPort(), REQUEST, 500, 1000));
            assertEquals("not a Cantol frame (bad magic)", e.getMessage());
        }
    }
}
