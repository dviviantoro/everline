package id.cantol.mobile.link;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/** The /24 scan of ADR-003: which hosts accept a TCP connection on the data port. */
public final class TcpProbe {
    private TcpProbe() {}

    /** The hosts that accepted a connection, in the order given. Blocks until every attempt has ended. */
    public static List<String> openHosts(List<String> hosts, int port, int connectTimeoutMs, int threads) {
        List<String> open = new ArrayList<>();
        if (hosts.isEmpty()) return open;
        ExecutorService pool = Executors.newFixedThreadPool(Math.max(1, Math.min(threads, hosts.size())));
        try {
            List<Future<Boolean>> results = new ArrayList<>();
            for (String host : hosts) {
                results.add(pool.submit(() -> accepts(host, port, connectTimeoutMs)));
            }
            for (int i = 0; i < hosts.size(); i++) {
                try {
                    if (results.get(i).get()) open.add(hosts.get(i));
                } catch (ExecutionException e) {
                    // An attempt that failed in an unexpected way counts as closed.
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        } finally {
            pool.shutdownNow();
        }
        return open;
    }

    static boolean accepts(String host, int port, int connectTimeoutMs) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), connectTimeoutMs);
            return true;
        } catch (IOException e) {
            return false;
        }
    }
}
