package id.cantol.mobile.link;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * ADR-003 strategy S0: is the phone's hotspot on? There is no public API for that, so this looks
 * for an access-point-style network interface that is up and holds a site-local IPv4 address. It
 * needs no permission and is a best guess: the final proof is always that Cantol answers.
 */
public final class HotspotProbe {
    private HotspotProbe() {}

    public record Addr(String ip, int prefix) {}

    public record Iface(String name, boolean up, boolean loopback, List<Addr> ipv4) {}

    public record Hotspot(String iface, String address, int prefix) {}

    /**
     * Names phones give the tethering interface: {@code ap0} (AOSP, Pixel), {@code swlan0}
     * (Samsung), {@code softap0}, and {@code wlan1} and up (Qualcomm and MediaTek, where
     * {@code wlan0} stays the Wi-Fi client). Mobile data, USB and Bluetooth tethering and Wi-Fi
     * Direct ({@code p2p-wlan0-0}) deliberately do not match.
     */
    private static final Pattern ACCESS_POINT = Pattern.compile("^(ap\\d+|swlan\\d+|softap\\d*|wlan[1-9]\\d*)$");

    static boolean looksLikeAccessPoint(String name) {
        return name != null && ACCESS_POINT.matcher(name.toLowerCase(Locale.ROOT)).matches();
    }

    /** The first interface that looks like an active hotspot, or null. */
    public static Hotspot detect(List<Iface> interfaces) {
        for (Iface iface : interfaces) {
            if (!iface.up() || iface.loopback() || !looksLikeAccessPoint(iface.name())) continue;
            for (Addr addr : iface.ipv4()) {
                if (Subnet.isSiteLocal(addr.ip())) return new Hotspot(iface.name(), addr.ip(), addr.prefix());
            }
        }
        return null;
    }

    /** The phone's interfaces as the system reports them; empty if it will not say. */
    public static List<Iface> fromSystem() {
        List<Iface> out = new ArrayList<>();
        Enumeration<NetworkInterface> all;
        try {
            all = NetworkInterface.getNetworkInterfaces();
        } catch (java.net.SocketException | RuntimeException e) {
            return out;
        }
        if (all == null) return out;
        for (NetworkInterface net : Collections.list(all)) {
            try {
                List<Addr> v4 = new ArrayList<>();
                for (InterfaceAddress ia : net.getInterfaceAddresses()) {
                    InetAddress address = ia.getAddress();
                    if (address instanceof Inet4Address) {
                        v4.add(new Addr(address.getHostAddress(), ia.getNetworkPrefixLength()));
                    }
                }
                out.add(new Iface(net.getName(), net.isUp(), net.isLoopback(), v4));
            } catch (java.net.SocketException | RuntimeException e) {
                // One interface that will not describe itself must not hide the others.
            }
        }
        return out;
    }
}
