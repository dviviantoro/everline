package id.cantol.mobile.link;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.util.List;
import org.junit.Test;

public class TcpProbeTest {
    @Test
    public void onlyTheHostThatAcceptsIsReported() throws IOException {
        try (ServerSocket server = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))) {
            // 127.0.0.2 is also loopback but nothing listens on it, so it refuses at once.
            List<String> open = TcpProbe.openHosts(List.of("127.0.0.2", "127.0.0.1", "127.0.0.3"), server.getLocalPort(), 500, 8);
            assertEquals(List.of("127.0.0.1"), open);
        }
    }

    @Test
    public void nothingToScanIsNothingFound() {
        assertTrue(TcpProbe.openHosts(List.of(), 47000, 100, 8).isEmpty());
    }

    @Test
    public void aWholeSubnetOfClosedHostsEndsPromptly() {
        long start = System.nanoTime();
        List<String> hosts = Subnet.hosts("127.0.0.1", 24);
        assertEquals(253, hosts.size());
        assertTrue(TcpProbe.openHosts(hosts, 9, 300, 64).isEmpty());
        assertTrue("took " + (System.nanoTime() - start) / 1_000_000 + " ms", (System.nanoTime() - start) / 1_000_000 < 10_000);
    }
}
