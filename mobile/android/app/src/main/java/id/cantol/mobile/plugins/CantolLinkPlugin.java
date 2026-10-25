package id.cantol.mobile.plugins;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import id.cantol.mobile.link.CantolConnection;
import id.cantol.mobile.link.HotspotProbe;
import id.cantol.mobile.link.LinkClient;
import id.cantol.mobile.link.Subnet;
import id.cantol.mobile.link.TcpProbe;
import java.io.IOException;
import java.net.ConnectException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The transport half of the Cantol link (ADR-003): scan the hotspot subnet, listen for the
 * beacon, make one exchange, hold the connection with a heartbeat. It moves bytes and nothing
 * else: every frame it sends is built by the WASM codec and every reply goes back to the app as
 * base64 to be read there.
 *
 * Capacitor runs all plugin methods on one shared thread, so every method that waits on the
 * network hands its work to this plugin's own pool and resolves the call from there.
 */
@CapacitorPlugin(name = "CantolLink")
public class CantolLinkPlugin extends Plugin {
    private static final String PREFS = "cantol_link";
    private static final String LAST_KNOWN = "last_known_address";

    private final ExecutorService pool = Executors.newCachedThreadPool(runnable -> {
        Thread thread = new Thread(runnable, "cantol-link-io");
        thread.setDaemon(true);
        return thread;
    });
    private CantolConnection connection;
    private volatile String lastError = "";

    /** Which hosts on the hotspot subnet accept a TCP connection on `port`. */
    @PluginMethod
    public void scan(PluginCall call) {
        int port = call.getInt("port", 47000);
        int timeoutMs = call.getInt("connectTimeoutMs", 400);
        pool.execute(() -> {
            try {
                HotspotProbe.Hotspot hotspot = HotspotProbe.detect(HotspotProbe.fromSystem());
                JSObject out = new JSObject();
                JSArray hosts = new JSArray();
                if (hotspot == null) {
                    out.put("scanned", 0);
                } else {
                    List<String> candidates = Subnet.hosts(hotspot.address(), hotspot.prefix());
                    for (String host : TcpProbe.openHosts(candidates, port, timeoutMs, 48)) hosts.put(host);
                    out.put("subnet", hotspot.address() + "/" + hotspot.prefix());
                    out.put("scanned", candidates.size());
                }
                out.put("hosts", hosts);
                call.resolve(out);
            } catch (RuntimeException e) {
                fail(call, e);
            }
        });
    }

    /** Waits up to `timeoutMs` for one UDP datagram on `port`; `timedOut` is true if none came. */
    @PluginMethod
    public void listenBeacon(PluginCall call) {
        int port = call.getInt("port", 47001);
        int timeoutMs = call.getInt("timeoutMs", 1500);
        pool.execute(() -> {
            try (DatagramSocket socket = new DatagramSocket(null)) {
                socket.setReuseAddress(true);
                socket.bind(new InetSocketAddress(port));
                socket.setBroadcast(true);
                socket.setSoTimeout(timeoutMs);
                DatagramPacket packet = new DatagramPacket(new byte[512], 512);
                JSObject out = new JSObject();
                try {
                    socket.receive(packet);
                    out.put("from", packet.getAddress().getHostAddress());
                    out.put("dataB64", Base64.encodeToString(packet.getData(), 0, packet.getLength(), Base64.NO_WRAP));
                } catch (SocketTimeoutException e) {
                    out.put("timedOut", true);
                }
                call.resolve(out);
            } catch (IOException | RuntimeException e) {
                fail(call, e);
            }
        });
    }

    /** Sends one frame to host:port and returns the first whole frame that comes back, with the round trip. */
    @PluginMethod
    public void exchange(PluginCall call) {
        String host = call.getString("host");
        String data = call.getString("dataB64");
        if (host == null || data == null) {
            call.reject("host and dataB64 are required", "bad_request");
            return;
        }
        int port = call.getInt("port", 47000);
        int connectMs = call.getInt("connectTimeoutMs", 800);
        int readMs = call.getInt("readTimeoutMs", 1500);
        pool.execute(() -> {
            try {
                LinkClient.Reply reply = LinkClient.exchange(host, port, Base64.decode(data, Base64.DEFAULT), connectMs, readMs);
                JSObject out = new JSObject();
                out.put("replyB64", Base64.encodeToString(reply.frame(), Base64.NO_WRAP));
                out.put("rttMs", reply.rttMs());
                call.resolve(out);
            } catch (IOException | RuntimeException e) {
                fail(call, e);
            }
        });
    }

    /**
     * Opens the held connection, sends the first heartbeat and waits for an answer; then repeats
     * the heartbeat and emits `linkState` ("lost", then "up" again after a reconnect).
     */
    @PluginMethod
    public void connect(PluginCall call) {
        String host = call.getString("host");
        String heartbeat = call.getString("heartbeatB64");
        if (host == null || heartbeat == null) {
            call.reject("host and heartbeatB64 are required", "bad_request");
            return;
        }
        int port = call.getInt("port", 47000);
        int intervalMs = call.getInt("intervalMs", 2000);
        int connectMs = call.getInt("connectTimeoutMs", 1500);
        pool.execute(() -> {
            closeConnection();
            CantolConnection next = new CantolConnection(host, port, Base64.decode(heartbeat, Base64.DEFAULT), intervalMs, connectMs, (state, detail) -> {
                JSObject event = new JSObject();
                event.put("state", state.name().toLowerCase(Locale.ROOT));
                event.put("detail", detail);
                notifyListeners("linkState", event);
            });
            try {
                double rtt = next.open();
                synchronized (this) {
                    connection = next;
                }
                getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(LAST_KNOWN, host).apply();
                JSObject out = new JSObject();
                out.put("rttMs", rtt);
                call.resolve(out);
            } catch (IOException | RuntimeException e) {
                next.close();
                fail(call, e);
            }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        closeConnection();
        call.resolve();
    }

    /** The held link's health: whether it is up, and how long ago anything last arrived. */
    @PluginMethod
    public void linkStatus(PluginCall call) {
        JSObject out = new JSObject();
        CantolConnection link;
        synchronized (this) {
            link = connection;
        }
        out.put("connected", link != null && link.isUp());
        if (link != null) {
            out.put("host", link.host());
            out.put("lastRxAgeMs", link.lastRxAgeMs());
            if (!Double.isNaN(link.rttMs())) out.put("rttMs", link.rttMs());
        }
        call.resolve(out);
    }

    @PluginMethod
    public void getLastKnown(PluginCall call) {
        String address = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(LAST_KNOWN, null);
        JSObject out = new JSObject();
        if (address != null) out.put("address", address);
        call.resolve(out);
    }

    @PluginMethod
    public void setLastKnown(PluginCall call) {
        String address = call.getString("address");
        SharedPreferences.Editor editor = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        if (address == null) editor.remove(LAST_KNOWN);
        else editor.putString(LAST_KNOWN, address);
        editor.apply();
        call.resolve();
    }

    /** Plain facts for the Diagnostics screen. */
    @PluginMethod
    public void diagnostics(PluginCall call) {
        HotspotProbe.Hotspot hotspot = HotspotProbe.detect(HotspotProbe.fromSystem());
        CantolConnection link;
        synchronized (this) {
            link = connection;
        }
        JSArray rows = new JSArray();
        rows.put(row("Hotspot interface", hotspot == null ? "none found" : hotspot.iface() + " " + hotspot.address() + "/" + hotspot.prefix()));
        rows.put(row("Held link", link == null ? "not connected" : (link.isUp() ? "up to " : "lost to ") + link.host()));
        if (link != null) {
            rows.put(row("Last frame", link.lastRxAgeMs() < 0 ? "none yet" : link.lastRxAgeMs() + " ms ago"));
            rows.put(row("Link error", link.lastError().isEmpty() ? "none" : link.lastError()));
        }
        rows.put(row("Last known address", getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(LAST_KNOWN, "none")));
        rows.put(row("Last request error", lastError.isEmpty() ? "none" : lastError));
        JSObject out = new JSObject();
        out.put("rows", rows);
        call.resolve(out);
    }

    @Override
    protected void handleOnDestroy() {
        closeConnection();
        pool.shutdownNow();
        super.handleOnDestroy();
    }

    private static JSObject row(String label, String value) {
        JSObject row = new JSObject();
        row.put("label", label);
        row.put("value", value);
        return row;
    }

    private synchronized void closeConnection() {
        if (connection != null) {
            connection.close();
            connection = null;
        }
    }

    /** Rejects with a short code the app can show, and keeps the text for Diagnostics. */
    private void fail(PluginCall call, Exception e) {
        String code = e instanceof SocketTimeoutException ? "timeout" : e instanceof ConnectException ? "refused" : "io";
        String message = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        lastError = code + ": " + message;
        call.reject(message, code);
    }
}
