package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import org.junit.Test;

/** Index and show cache updates must never write the same .neu file concurrently. */
public class ZwischenspeicherSchreiberTest {
    @Test
    public void schreibtMehrereCacheStaendeNacheinanderInEinreichReihenfolge() throws Exception {
        ZwischenspeicherSchreiber schreiber = new ZwischenspeicherSchreiber();
        List<String> reihenfolge = Collections.synchronizedList(new ArrayList<>());
        CountDownLatch ersterBegonnen = new CountDownLatch(1);
        CountDownLatch ersterDarfEnden = new CountDownLatch(1);
        CountDownLatch fertig = new CountDownLatch(2);
        try {
            schreiber.ausfuehren(() -> {
                reihenfolge.add("index:start");
                ersterBegonnen.countDown();
                try { ersterDarfEnden.await(2, TimeUnit.SECONDS); } catch (InterruptedException ignoriert) { }
                reihenfolge.add("index:ende");
                fertig.countDown();
            });
            assertTrue(ersterBegonnen.await(2, TimeUnit.SECONDS));
            schreiber.ausfuehren(() -> {
                reihenfolge.add("show:start");
                reihenfolge.add("show:ende");
                fertig.countDown();
            });
            ersterDarfEnden.countDown();
            assertTrue(fertig.await(2, TimeUnit.SECONDS));
            assertEquals(java.util.Arrays.asList("index:start", "index:ende", "show:start", "show:ende"), reihenfolge);
        } finally {
            schreiber.beenden();
        }
    }
}
