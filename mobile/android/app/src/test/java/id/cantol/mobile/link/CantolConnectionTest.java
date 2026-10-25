package id.cantol.mobile.link;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.Test;

public class CantolConnectionTest {
    private static final byte[] HEARTBEAT = {9, 9, 9};
    private static final int INTERVAL_MS = 200;

    private static final class Events implements CantolConnection.Listener {
        final LinkedBlockingQueue<String> queue = new LinkedBlockingQueue<>();

        @Override
        public void onState(CantolConnection.State state, String detail) {
            queue.add(state.name());
        }

        String next(long timeoutMs) throws InterruptedException {
            return queue.poll(timeoutMs, TimeUnit.MILLISECONDS);
        }
    }

    private static CantolConnection connection(FakeCantol cantol, Events events) {
        return new CantolConnection("127.0.0.1", cantol.port(), HEARTBEAT, INTERVAL_MS, 500, events);
    }

    @Test
    public void openWaitsForTheFirstAnswerAndReportsTheRoundTrip() throws Exception {
        try (FakeCantol cantol = new FakeCantol()) {
            Events events = new Events();
            CantolConnection link = connection(cantol, events);
            double rtt = link.open();
            try {
                assertTrue("rtt " + rtt, rtt >= 0 && rtt < 200);
                assertTrue(link.isUp());
                assertTrue(link.lastRxAgeMs() >= 0);
                assertEquals(null, events.next(300));
            } finally {
                link.close();
            }
        }
    }

    @Test
    public void openFailsWhenNothingAnswers() throws Exception {
        try (FakeCantol cantol = new FakeCantol()) {
            cantol.mode(FakeCantol.Mode.SILENT);
            CantolConnection link = connection(cantol, new Events());
            assertThrows(IOException.class, link::open);
            assertFalse(link.isUp());
        }
    }

    @Test
    public void aHeartbeatIsSentEveryInterval() throws Exception {
        try (FakeCantol cantol = new FakeCantol()) {
            CantolConnection link = connection(cantol, new Events());
            link.open();
            try {
                Thread.sleep(INTERVAL_MS * 5);
                assertTrue("heartbeats received: " + cantol.received(), cantol.received() >= 4);
            } finally {
                link.close();
            }
        }
    }

    @Test
    public void silenceIsReportedOnceAndTheLinkComesBackBySelf() throws Exception {
        try (FakeCantol cantol = new FakeCantol()) {
            Events events = new Events();
            CantolConnection link = connection(cantol, events);
            link.open();
            try {
                cantol.mode(FakeCantol.Mode.SILENT);
                assertEquals("LOST", events.next(2000));
                assertFalse(link.isUp());
                assertNotNull(link.lastError());
                // Still silent: it keeps trying but says nothing more.
                assertEquals(null, events.next(2500));
                cantol.mode(FakeCantol.Mode.ANSWER);
                assertEquals("UP", events.next(4000));
                assertTrue(link.isUp());
            } finally {
                link.close();
            }
        }
    }

    @Test
    public void aHungUpConnectionIsLostAndThenReconnected() throws Exception {
        try (FakeCantol cantol = new FakeCantol()) {
            Events events = new Events();
            CantolConnection link = connection(cantol, events);
            link.open();
            try {
                cantol.hangUp();
                assertEquals("LOST", events.next(2000));
                assertEquals("UP", events.next(4000));
                assertEquals(2, cantol.accepted());
            } finally {
                link.close();
            }
        }
    }

    @Test
    public void closeStopsEverythingAndSaysNothing() throws Exception {
        try (FakeCantol cantol = new FakeCantol()) {
            Events events = new Events();
            CantolConnection link = connection(cantol, events);
            link.open();
            link.close();
            assertFalse(link.isUp());
            Thread.sleep(INTERVAL_MS * 3);
            int seen = cantol.received();
            Thread.sleep(INTERVAL_MS * 3);
            assertEquals("no heartbeat after close", seen, cantol.received());
            assertEquals(null, events.next(100));
        }
    }
}
