package id.cantol.mobile.link;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.List;
import org.junit.Test;

public class SubnetTest {
    @Test
    public void aSlash24HasEveryHostExceptItself() {
        List<String> hosts = Subnet.hosts("192.168.43.1", 24);
        assertEquals(253, hosts.size());
        assertEquals("192.168.43.2", hosts.get(0));
        assertEquals("192.168.43.254", hosts.get(hosts.size() - 1));
        assertFalse(hosts.contains("192.168.43.1"));
        assertFalse(hosts.contains("192.168.43.0"));
        assertFalse(hosts.contains("192.168.43.255"));
    }

    @Test
    public void aWiderPrefixIsNarrowedToTheSlash24AroundUs() {
        List<String> hosts = Subnet.hosts("10.20.30.40", 16);
        assertEquals(253, hosts.size());
        assertEquals("10.20.30.1", hosts.get(0));
        assertFalse(hosts.contains("10.20.30.40"));
    }

    @Test
    public void aNarrowerPrefixStaysNarrow() {
        assertEquals(List.of("192.168.1.2"), Subnet.hosts("192.168.1.1", 30));
        assertEquals(List.of("192.168.1.2", "192.168.1.3", "192.168.1.4", "192.168.1.5", "192.168.1.6"), Subnet.hosts("192.168.1.1", 29));
    }

    @Test
    public void thereIsNothingToScanWithoutRoomForHosts() {
        assertTrue(Subnet.hosts("192.168.1.1", 31).isEmpty());
        assertTrue(Subnet.hosts("192.168.1.1", 32).isEmpty());
        assertTrue(Subnet.hosts("192.168.1.1", -1).isEmpty());
        assertTrue(Subnet.hosts("192.168.1.1", 33).isEmpty());
    }

    @Test
    public void notAnAddressGivesNothing() {
        for (String bad : new String[] {null, "", "hello", "1.2.3", "1.2.3.4.5", "256.1.1.1", "1.2.3.-4", "1..3.4", "1.2.3.4444"}) {
            assertTrue("" + bad, Subnet.hosts(bad, 24).isEmpty());
        }
    }

    @Test
    public void siteLocalMeansTheRangesAHotspotUses() {
        for (String yes : new String[] {"10.0.0.1", "172.16.0.1", "172.31.255.1", "192.168.0.1"}) assertTrue(yes, Subnet.isSiteLocal(yes));
        for (String no : new String[] {"8.8.8.8", "172.15.0.1", "172.32.0.1", "192.169.0.1", "127.0.0.1", "169.254.1.1", "100.64.0.1", "x", null}) {
            assertFalse("" + no, Subnet.isSiteLocal(no));
        }
    }
}
