package id.cantol.mobile.link;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeNotNull;

import java.nio.charset.StandardCharsets;
import org.junit.Test;

/**
 * The Java link against the real {@code cantol-mock}, with frames built by the real WASM codec.
 * Skipped unless all three environment variables are set; {@code scripts/verify-link-jvm.sh}
 * starts the mock, prints the frames and sets them.
 */
public class MockIntegrationTest {
    private static byte[] hex(String text) {
        byte[] out = new byte[text.length() / 2];
        for (int i = 0; i < out.length; i++) out[i] = (byte) Integer.parseInt(text.substring(2 * i, 2 * i + 2), 16);
        return out;
    }

    @Test
    public void exchangeAndHeldLinkAgainstTheRealMock() throws Exception {
        String port = System.getenv("CANTOL_MOCK_PORT");
        String helloHex = System.getenv("CANTOL_HELLO_HEX");
        String pingHex = System.getenv("CANTOL_PING_HEX");
        assumeNotNull(port, helloHex, pingHex);
        int tcp = Integer.parseInt(port);

        LinkClient.Reply reply = LinkClient.exchange("127.0.0.1", tcp, hex(helloHex), 1000, 2000);
        assertEquals("a PONG frame", 0x02, reply.frame()[3]);
        assertTrue("the PONG names the mock", new String(reply.frame(), StandardCharsets.ISO_8859_1).contains("RP-MOCK"));

        assertEquals(java.util.List.of("127.0.0.1"), TcpProbe.openHosts(java.util.List.of("127.0.0.1"), tcp, 500, 1));

        java.util.concurrent.LinkedBlockingQueue<String> events = new java.util.concurrent.LinkedBlockingQueue<>();
        CantolConnection link = new CantolConnection("127.0.0.1", tcp, hex(pingHex), 500, 1000, (state, detail) -> events.add(state.name()));
        double rtt = link.open();
        try {
            assertNotNull(rtt);
            assertTrue("rtt " + rtt, rtt >= 0 && rtt < 500);
            Thread.sleep(1600);
            assertTrue("the link stays up on the mock's own traffic", link.isUp());
            assertTrue(events.isEmpty());
        } finally {
            link.close();
        }
    }

    /** Start and Stop, built by the real codec, against the real mock: pulses flow, then stop. */
    @Test
    public void startAndStopStreamPulsesFromTheRealMock() throws Exception {
        String port = System.getenv("CANTOL_MOCK_PORT");
        String pingHex = System.getenv("CANTOL_PING_HEX");
        String startHex = System.getenv("CANTOL_START_HEX");
        String stopHex = System.getenv("CANTOL_STOP_HEX");
        assumeNotNull(port, pingHex, startHex, stopHex);

        java.util.concurrent.atomic.AtomicInteger pulseFrames = new java.util.concurrent.atomic.AtomicInteger();
        java.util.concurrent.atomic.AtomicInteger statusFrames = new java.util.concurrent.atomic.AtomicInteger();
        CantolConnection.Listener listener = new CantolConnection.Listener() {
            @Override
            public void onState(CantolConnection.State state, String detail) {}

            @Override
            public void onFrame(byte[] frame) {
                if (frame[3] == 0x10) pulseFrames.incrementAndGet();
                if (frame[3] == 0x03) statusFrames.incrementAndGet();
            }
        };
        CantolConnection link = new CantolConnection("127.0.0.1", Integer.parseInt(port), hex(pingHex), 500, 1000, listener);
        link.open();
        try {
            Thread.sleep(700);
            assertEquals("no pulses before Start", 0, pulseFrames.get());
            assertTrue("the status arrives anyway", statusFrames.get() >= 1);

            link.send(hex(startHex));
            Thread.sleep(1200);
            int whileStreaming = pulseFrames.get();
            assertTrue("pulses after Start: " + whileStreaming, whileStreaming >= 10);

            link.send(hex(stopHex));
            Thread.sleep(300);
            int afterStop = pulseFrames.get();
            Thread.sleep(800);
            assertEquals("no more pulses after Stop", afterStop, pulseFrames.get());
            assertTrue(link.isUp());
        } finally {
            link.close();
        }
    }
}
