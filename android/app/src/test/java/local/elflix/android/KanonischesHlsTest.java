package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import androidx.media3.common.C;
import androidx.media3.common.util.TimestampAdjuster;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.util.concurrent.TimeoutException;
import org.junit.Test;

public class KanonischesHlsTest {
    @Test public void liestAudioPtsUndVideoDtsAlsGemeinsamenAnker() {
        byte[] audio = paket(0xC0, 9_090, C.TIME_UNSET);
        byte[] video = paket(0xE0, 16_597, 9_090);

        assertEquals(9_090, KanonischesHls.basisPts90k(verbinden(audio, video)));
    }

    @Test public void findetTsNachVorangestelltenBytes() {
        byte[] rauschen = new byte[] { 1, 2, 3, 4, 5 };
        byte[] video = paket(0xE0, 16_597, 9_090);
        byte[] audio = paket(0xC0, 9_090, C.TIME_UNSET);

        assertEquals(9_090,
            KanonischesHls.basisPts90k(verbinden(rauschen, video, audio)));
    }

    @Test public void weistZufaelligenPesKopfOhneMarkerbitsAb() {
        byte[] falsch = paket(0xC0, 9_090, C.TIME_UNSET);
        falsch[4 + 9 + 2] &= 0xFE;
        byte[] leer = new byte[188];
        leer[0] = 0x47;

        assertEquals(C.TIME_UNSET, KanonischesHls.basisPts90k(verbinden(falsch, leer)));
    }

    @Test public void festerAnkerIstVomErstenSeekSegmentUnabhaengig()
        throws InterruptedException, TimeoutException, IOException {
        TimestampAdjuster bei270 = adjusterMitMedia3Wunsch(264_000_000);
        TimestampAdjuster bei459 = adjusterMitMedia3Wunsch(456_000_000);

        assertTrue(KanonischesHls.adjusterSetzen(bei270, 9_090));
        assertTrue(KanonischesHls.adjusterSetzen(bei459, 9_090));
        long framePts = 9_090 + 459L * 90_000L;
        assertEquals(459_000_000, bei270.adjustTsTimestamp(framePts));
        assertEquals(459_000_000, bei459.adjustTsTimestamp(framePts));
        assertEquals(-101_000, bei270.getTimestampOffsetUs());
        assertEquals(bei270.getTimestampOffsetUs(), bei459.getTimestampOffsetUs());
    }

    @Test public void bleibtSharedUndWirdNurEinmalInitialisiert()
        throws InterruptedException, TimeoutException, IOException {
        TimestampAdjuster zeit = adjusterMitMedia3Wunsch(456_000_000);

        assertTrue(KanonischesHls.adjusterSetzen(zeit, 9_090));
        // Genau dieser Aufruf geschieht vor jedem folgenden HlsMediaChunk. reset(0) wuerde hier
        // mit einer verletzten MODE_SHARED-Vorbedingung abbrechen.
        zeit.sharedInitializeOrWait(true, 468_000_000, 0);
        assertFalse(KanonischesHls.adjusterSetzen(zeit, 123_456));
        assertEquals(-101_000, zeit.getTimestampOffsetUs());
    }

    @Test public void erkenntDirekteUndVerpackteLoaderAbbrueche() {
        assertTrue(KanonischesHls.istUnterbrechung(new InterruptedIOException("abgebrochen")));
        assertTrue(KanonischesHls.istUnterbrechung(
            new IOException("DataSource", new InterruptedIOException("abgebrochen"))));
        assertFalse(KanonischesHls.istUnterbrechung(new IOException("dauerhaft")));
    }

    private static TimestampAdjuster adjusterMitMedia3Wunsch(long segmentStartUs)
        throws InterruptedException, TimeoutException {
        TimestampAdjuster zeit = new TimestampAdjuster(TimestampAdjuster.MODE_SHARED);
        zeit.sharedInitializeOrWait(true, segmentStartUs, 0);
        return zeit;
    }

    private static byte[] paket(int stream, long pts, long dts) {
        byte[] paket = new byte[188];
        java.util.Arrays.fill(paket, (byte) 0xFF);
        paket[0] = 0x47;
        paket[1] = 0x41; // payload_unit_start, PID 0x100
        paket[2] = 0;
        paket[3] = 0x10; // nur Payload
        int i = 4;
        paket[i] = 0;
        paket[i + 1] = 0;
        paket[i + 2] = 1;
        paket[i + 3] = (byte) stream;
        paket[i + 4] = 0;
        paket[i + 5] = 0;
        paket[i + 6] = (byte) 0x80;
        boolean hatDts = dts != C.TIME_UNSET;
        paket[i + 7] = (byte) (hatDts ? 0xC0 : 0x80);
        paket[i + 8] = (byte) (hatDts ? 10 : 5);
        ptsSchreiben(paket, i + 9, pts, hatDts ? 3 : 2);
        if (hatDts) ptsSchreiben(paket, i + 14, dts, 1);
        return paket;
    }

    private static void ptsSchreiben(byte[] ziel, int i, long pts, int kennung) {
        ziel[i] = (byte) ((kennung << 4) | (((pts >>> 30) & 7) << 1) | 1);
        ziel[i + 1] = (byte) (pts >>> 22);
        ziel[i + 2] = (byte) ((((pts >>> 15) & 0x7F) << 1) | 1);
        ziel[i + 3] = (byte) (pts >>> 7);
        ziel[i + 4] = (byte) (((pts & 0x7F) << 1) | 1);
    }

    private static byte[] verbinden(byte[]... teile) {
        int laenge = 0;
        for (byte[] teil : teile) laenge += teil.length;
        byte[] ganz = new byte[laenge];
        int stelle = 0;
        for (byte[] teil : teile) {
            System.arraycopy(teil, 0, ganz, stelle, teil.length);
            stelle += teil.length;
        }
        return ganz;
    }
}
