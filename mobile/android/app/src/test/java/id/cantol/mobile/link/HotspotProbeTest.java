package id.cantol.mobile.link;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import id.cantol.mobile.link.HotspotProbe.Addr;
import id.cantol.mobile.link.HotspotProbe.Hotspot;
import id.cantol.mobile.link.HotspotProbe.Iface;
import java.util.List;
import org.junit.Test;

public class HotspotProbeTest {
    private static Iface iface(String name, boolean up, String ip, int prefix) {
        return new Iface(name, up, false, ip == null ? List.of() : List.of(new Addr(ip, prefix)));
    }

    @Test
    public void theNamesPhonesGiveTheirAccessPointMatch() {
        for (String name : new String[] {"ap0", "ap1", "swlan0", "softap0", "softap", "wlan1", "wlan2", "WLAN1"}) {
            assertTrue(name, HotspotProbe.looksLikeAccessPoint(name));
        }
    }

    @Test
    public void clientDataUsbBluetoothAndDirectInterfacesDoNot() {
        for (String name : new String[] {"wlan0", "rmnet_data0", "ccmni0", "rndis0", "usb0", "bt-pan", "p2p-wlan0-0", "lo", "dummy0", "tun0", "wlan", "wlan01", "apple", "", null}) {
            assertFalse("" + name, HotspotProbe.looksLikeAccessPoint(name));
        }
    }

    @Test
    public void anUpAccessPointWithASiteLocalAddressIsTheHotspot() {
        Hotspot hotspot = HotspotProbe.detect(List.of(
                iface("wlan0", true, "192.168.1.50", 24),
                iface("rmnet_data0", true, "10.5.5.5", 30),
                iface("ap0", true, "192.168.43.1", 24)));
        assertNotNull(hotspot);
        assertEquals("ap0", hotspot.iface());
        assertEquals("192.168.43.1", hotspot.address());
        assertEquals(24, hotspot.prefix());
    }

    @Test
    public void theWifiClientAloneIsNotAHotspot() {
        assertNull(HotspotProbe.detect(List.of(iface("wlan0", true, "192.168.1.50", 24), iface("rmnet_data0", true, "10.5.5.5", 30))));
    }

    @Test
    public void aDownInterfaceOrOneWithoutAPrivateAddressIsNotAHotspot() {
        assertNull(HotspotProbe.detect(List.of(iface("ap0", false, "192.168.43.1", 24))));
        assertNull(HotspotProbe.detect(List.of(iface("ap0", true, null, 0))));
        assertNull(HotspotProbe.detect(List.of(iface("swlan0", true, "8.8.8.8", 24))));
        assertNull(HotspotProbe.detect(List.of(new Iface("ap0", true, true, List.of(new Addr("192.168.43.1", 24))))));
    }

    @Test
    public void noInterfacesIsNoHotspot() {
        assertNull(HotspotProbe.detect(List.of()));
    }

    @Test
    public void theSystemListingNeverThrows() {
        assertNotNull(HotspotProbe.fromSystem());
    }
}
