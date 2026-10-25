package id.cantol.mobile.link;

import java.util.ArrayList;
import java.util.List;

/** IPv4 arithmetic for the hotspot subnet. No Android classes, so it runs under plain JUnit. */
public final class Subnet {
    private Subnet() {}

    /** The four octets of a dotted-quad IPv4 address, or null when the text is not one. */
    static int[] octets(String ip) {
        if (ip == null) return null;
        String[] parts = ip.split("\\.", -1);
        if (parts.length != 4) return null;
        int[] out = new int[4];
        for (int i = 0; i < 4; i++) {
            String part = parts[i];
            if (part.isEmpty() || part.length() > 3) return null;
            for (int c = 0; c < part.length(); c++) {
                if (part.charAt(c) < '0' || part.charAt(c) > '9') return null;
            }
            int value = Integer.parseInt(part);
            if (value > 255) return null;
            out[i] = value;
        }
        return out;
    }

    /** True for 10/8, 172.16/12 and 192.168/16: the ranges a phone's hotspot hands out. */
    public static boolean isSiteLocal(String ip) {
        int[] o = octets(ip);
        if (o == null) return false;
        return o[0] == 10 || (o[0] == 172 && o[1] >= 16 && o[1] <= 31) || (o[0] == 192 && o[1] == 168);
    }

    /**
     * Every host address in the subnet of {@code ip}, except {@code ip} itself, in ascending order.
     * A hotspot is nearly always a /24. A wider prefix is narrowed to the /24 around our own
     * address (scanning 65 thousand hosts is not an option); a narrower one stays as it is.
     * Empty for an invalid address or a prefix with no room for hosts.
     */
    public static List<String> hosts(String ip, int prefixLength) {
        List<String> out = new ArrayList<>();
        int[] o = octets(ip);
        if (o == null || prefixLength < 0 || prefixLength > 32) return out;
        int hostBits = 32 - Math.max(prefixLength, 24);
        if (hostBits < 2) return out;
        long self = ((long) o[0] << 24) | ((long) o[1] << 16) | ((long) o[2] << 8) | o[3];
        long size = 1L << hostBits;
        long network = self & ~(size - 1);
        for (long address = network + 1; address < network + size - 1; address++) {
            if (address != self) out.add(format(address));
        }
        return out;
    }

    private static String format(long address) {
        return ((address >> 24) & 0xFF) + "." + ((address >> 16) & 0xFF) + "." + ((address >> 8) & 0xFF) + "." + (address & 0xFF);
    }
}
