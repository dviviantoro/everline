package id.cantol.mobile.link;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
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

    /** The frames the link handed over; a heartbeat's answer is the plain status frame and is skipped by {@link #await}. */
    private static final class Frames implements CantolConnection.Listener {
        final LinkedBlockingQueue<byte[]> queue = new LinkedBlockingQueue<>();
        volatile boolean failOnFrame;

        @Override
        public void onState(CantolConnection.State state, String detail) {}

        @Override
        public void onFrame(byte[] frame) {
            queue.add(frame);
            if (failOnFrame) throw new IllegalStateException("a listener with a bug");
        }

        /** The next frame that is not an answer to the heartbeat, or null after {@code timeoutMs}. */
        byte[] await(long timeoutMs) throws InterruptedException {
            long end = System.currentTimeMillis() + timeoutMs;
            while (true) {
                byte[] frame = queue.poll(Math.max(1, end - System.currentTimeMillis()), TimeUnit.MILLISECONDS);
                if (frame == null) return null;
                if (!Arrays.equals(frame, FakeCantol.FRAME)) return frame;
            }
        }
    }

    private static byte[] payload(int length, int seed) {
        byte[] out = new byte[length];
        for (int i = 0; i < length; i++) out[i] = (byte) (seed + i * 7);
        return out;
    }

    @Test
    public void everyFrameThatArrivesIsHandedOverWholeAndInOrder() throws Exception {
        try (FakeCantol cantol = new FakeCantol()) {
            Frames frames = new Frames();
            CantolConnection link = new CantolConnection("127.0.0.1", cantol.port(), HEARTBEAT, INTERVAL_MS, 500, frames);
            link.open();
            try {
                assertArrayEquals("the answer to the first heartbeat is delivered too", FakeCantol.FRAME, frames.queue.poll(1, TimeUnit.SECONDS));
                List<byte[]> sent = new ArrayList<>();
                sent.add(FakeCantol.frame(0x10, payload(2 + 12 * 20, 1)));
                sent.add(FakeCantol.frame(0x03, payload(11, 2)));
                sent.add(FakeCantol.frame(0x10, payload(2, 3)));
                sent.add(FakeCantol.frame(0x10, payload(2 + 12 * 500, 4)));
                for (byte[] frame : sent) cantol.emit(frame, frame.length);
                for (byte[] expected : sent) assertArrayEquals(expected, frames.await(2000));
            } finally {
                link.close();
            }
        }
    }

    @Test
    public void aFrameThatArrivesInPiecesIsDeliveredOnceWhenItIsComplete() throws Exception {
        try (FakeCantol cantol = new FakeCantol()) {
            Frames frames = new Frames();
            CantolConnection link = new CantolConnection("127.0.0.1", cantol.port(), HEARTBEAT, INTERVAL_MS, 500, frames);
            link.open();
            try {
                byte[] frame = FakeCantol.frame(0x10, payload(2 + 12 * 30, 9));
                // Pieces of 40 bytes, a few milliseconds apart: the heartbeat's read timeout fires in between.
                cantol.emit(frame, 40);
                assertArrayEquals(frame, frames.await(3000));
                assertEquals(null, frames.await(300));
            } finally {
                link.close();
            }
        }
    }

    @Test
    public void aListenerThatFailsDoesNotStopTheLinkOrTheFramesAfterIt() throws Exception {
        try (FakeCantol cantol = new FakeCantol()) {
            Frames frames = new Frames();
            frames.failOnFrame = true;
            CantolConnection link = new CantolConnection("127.0.0.1", cantol.port(), HEARTBEAT, INTERVAL_MS, 500, frames);
            link.open();
            try {
                byte[] first = FakeCantol.frame(0x10, payload(14, 5));
                byte[] second = FakeCantol.frame(0x10, payload(14, 6));
                cantol.emit(first, first.length);
                assertArrayEquals(first, frames.await(2000));
                cantol.emit(second, second.length);
                assertArrayEquals(second, frames.await(2000));
                assertTrue(link.isUp());
            } finally {
                link.close();
            }
        }
    }

    @Test
    public void aFrameTheAppBuiltReachesTheCantolIntactAmongTheHeartbeats() throws Exception {
        try (FakeCantol cantol = new FakeCantol()) {
            CantolConnection link = connection(cantol, new Events());
            link.open();
            try {
                byte[] start = FakeCantol.frame(0x20, new byte[0]);
                link.send(start);
                Thread.sleep(INTERVAL_MS * 3);
                link.send(start);
                Thread.sleep(100);
                // Whatever order the heartbeats fall in, each frame is whole: the stream is 9,9,9 and frames, nothing torn.
                byte[] got = cantol.receivedBytes();
                int starts = 0;
                int at = 0;
                while (at < got.length) {
                    if (got[at] == 9) {
                        assertTrue("a whole heartbeat at " + at, at + 3 <= got.length && got[at + 1] == 9 && got[at + 2] == 9);
                        at += 3;
                    } else {
                        assertTrue("a whole frame at " + at, at + start.length <= got.length);
                        assertArrayEquals(start, Arrays.copyOfRange(got, at, at + start.length));
                        starts++;
                        at += start.length;
                    }
                }
                assertEquals(2, starts);
            } finally {
                link.close();
            }
        }
    }

    @Test
    public void sendFailsWhenTheLinkIsNotUp() throws Exception {
        try (FakeCantol cantol = new FakeCantol()) {
            Events events = new Events();
            CantolConnection link = connection(cantol, events);
            assertThrows("before open", IOException.class, () -> link.send(new byte[] {1}));
            link.open();
            link.send(new byte[] {1});
            cantol.mode(FakeCantol.Mode.SILENT);
            assertEquals("LOST", events.next(2000));
            assertThrows("while lost", IOException.class, () -> link.send(new byte[] {1}));
            cantol.mode(FakeCantol.Mode.ANSWER);
            assertEquals("UP", events.next(4000));
            link.send(new byte[] {1});
            link.close();
            assertThrows("after close", IOException.class, () -> link.send(new byte[] {1}));
        }
    }
}
