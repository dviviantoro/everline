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
}
