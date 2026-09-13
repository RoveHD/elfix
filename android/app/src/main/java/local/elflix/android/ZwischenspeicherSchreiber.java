package local.elflix.android;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

/** A single ordered writer for atomic Kern cache replacements. */
final class ZwischenspeicherSchreiber {
    private final ExecutorService ausfuehrer = Executors.newSingleThreadExecutor();
    private volatile boolean beendet;

    /** Queues writes in submission order; caches are small and infrequent. */
    void ausfuehren(Runnable aufgabe) {
        if (aufgabe == null || beendet) return;
        try { ausfuehrer.execute(aufgabe); }
        catch (RejectedExecutionException ignoriert) { }
    }

    /** Lets an already-started atomic write finish during Kern shutdown. */
    void beenden() {
        beendet = true;
        ausfuehrer.shutdown();
    }
}
