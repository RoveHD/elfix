package local.elflix.android;

import android.net.Uri;
import androidx.annotation.Nullable;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.util.TimestampAdjuster;
import androidx.media3.common.util.UriUtil;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.exoplayer.analytics.PlayerId;
import androidx.media3.exoplayer.hls.DefaultHlsExtractorFactory;
import androidx.media3.exoplayer.hls.HlsExtractorFactory;
import androidx.media3.exoplayer.hls.HlsMediaChunkExtractor;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.hls.playlist.DefaultHlsPlaylistParserFactory;
import androidx.media3.exoplayer.hls.playlist.HlsMediaPlaylist;
import androidx.media3.exoplayer.hls.playlist.HlsMultivariantPlaylist;
import androidx.media3.exoplayer.hls.playlist.HlsPlaylist;
import androidx.media3.exoplayer.hls.playlist.HlsPlaylistParserFactory;
import androidx.media3.exoplayer.upstream.ParsingLoadable;
import androidx.media3.extractor.DefaultExtractorInput;
import androidx.media3.extractor.ExtractorInput;
import androidx.media3.extractor.text.SubtitleParser;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeoutException;
import java.util.function.Consumer;

/**
 * Gibt einer MPEG-TS-VOD eine feste Zeitnull.
 *
 * <p>Media3 richtet einen HLS-{@link TimestampAdjuster} nach einem Sprung neu ein. Dabei wird der
 * Anfang des zuerst geladenen Segments aus der Summe der EXTINF-Werte genommen. Sind diese Werte
 * nur grob (bei VOE stehen beispielsweise fast ueberall 12 Sekunden, obwohl die TS-Grenzen anders
 * liegen), bekommt derselbe Frame je nach erstem Segment eine andere Playerzeit.
 *
 * <p>Diese Klasse liest deshalb hoechstens den Kopf des ersten TS-Segments und merkt sich dessen
 * wirklichen 90-kHz-Zeitstempel. Jeder neue Adjuster derselben Wiedergabe bekommt damit wieder
 * denselben Versatz. Andere HLS-Container, Live-Listen, verschluesselte Segmente und Listen mit
 * Diskontinuitaeten bleiben unangetastet.
 */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
final class KanonischesHls {
    private static final int PROBE_BYTES = 64 * 1024;
    /** Ein einziger Vorlaeufer ist begrenzt; groessere Segmente fallen auf den Standardpfad. */
    private static final long MAX_VORLAUF_BYTES = 32L * 1024 * 1024;
    private static final long PTS_WRAP = 1L << 33;

    private final DataSource.Factory daten;
    private final Consumer<String> diagnose;
    private final ConcurrentHashMap<String, SegmentInfo> segmentInfos = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Anker> listenAnker = new ConcurrentHashMap<>();
    private final DefaultHlsExtractorFactory standardExtraktor = new DefaultHlsExtractorFactory();
    private volatile boolean anwendbar;
    private volatile boolean angewendet;
    private volatile boolean fehlgeschlagen;

    KanonischesHls(DataSource.Factory daten, Consumer<String> diagnose) {
        this.daten = daten;
        this.diagnose = diagnose;
    }

    HlsMediaSource.Factory fabrik() {
        return new HlsMediaSource.Factory(daten)
            .setPlaylistParserFactory(new ListenFabrik())
            .setExtractorFactory(new ExtraktorFabrik());
    }

    /** Nur ein wirklich gesetzter Anker darf eine exakte Runden-Bereitschaft bestaetigen. */
    boolean exaktBereit() {
        return anwendbar && angewendet && !fehlgeschlagen;
    }

    /** Nur eine erkannte TS-VOD mit gescheitertem Anker darf den exakten Pfad sperren. */
    boolean exaktBlockiert() {
        return anwendbar && !exaktBereit();
    }

    String zustand() {
        if (fehlgeschlagen) return "failed";
        if (angewendet) return "ready";
        if (anwendbar) return "pending";
        return "unsupported";
    }

    private void melden(String text) {
        if (diagnose != null) diagnose.accept(text);
    }

    private final class ListenFabrik implements HlsPlaylistParserFactory {
        private final HlsPlaylistParserFactory standard = new DefaultHlsPlaylistParserFactory();

        @Override public ParsingLoadable.Parser<HlsPlaylist> createPlaylistParser() {
            return merken(standard.createPlaylistParser());
        }

        @Override public ParsingLoadable.Parser<HlsPlaylist> createPlaylistParser(
            HlsMultivariantPlaylist multivariant, @Nullable HlsMediaPlaylist vorher) {
            return merken(standard.createPlaylistParser(multivariant, vorher));
        }

        private ParsingLoadable.Parser<HlsPlaylist> merken(
            ParsingLoadable.Parser<HlsPlaylist> parser) {
            return (uri, eingang) -> {
                HlsPlaylist liste = parser.parse(uri, eingang);
                if (liste instanceof HlsMediaPlaylist) erfassen((HlsMediaPlaylist) liste);
                return liste;
            };
        }
    }

    private void erfassen(HlsMediaPlaylist liste) {
        if (!liste.hasEndTag || liste.segments.isEmpty()) return;
        HlsMediaPlaylist.Segment erstes = liste.segments.get(0);
        Uri ersteUri = UriUtil.resolveToUri(liste.baseUri, erstes.url);
        String pfad = ersteUri.getPath();
        if (pfad == null || !pfad.toLowerCase(Locale.ROOT).endsWith(".ts")
            || erstes.initializationSegment != null
            || erstes.fullSegmentEncryptionKeyUri != null) return;
        int sprungfolge = erstes.relativeDiscontinuitySequence;
        for (HlsMediaPlaylist.Segment segment : liste.segments) {
            if (segment.relativeDiscontinuitySequence != sprungfolge
                || segment.initializationSegment != null
                || segment.fullSegmentEncryptionKeyUri != null
                // Derselbe URI kann viele Bytebereiche enthalten. Die Chunk-Fabrik bekommt nur
                // den URI und koennte sie deshalb nicht eindeutig ihrem Vorgaenger zuordnen.
                || segment.byteRangeOffset != 0 || segment.byteRangeLength != C.LENGTH_UNSET) return;
        }

        Anker neu = new Anker(ersteUri, erstes.byteRangeOffset, erstes.byteRangeLength);
        Anker anker = listenAnker.putIfAbsent(liste.baseUri, neu);
        if (anker == null) {
            anker = neu;
            anwendbar = true;
            melden("captured segments=" + liste.segments.size());
        }
        SegmentInfo vorher = null;
        for (HlsMediaPlaylist.Segment segment : liste.segments) {
            Uri segmentUri = UriUtil.resolveToUri(liste.baseUri, segment.url);
            SegmentInfo info = new SegmentInfo(anker, segmentUri, segment.byteRangeOffset,
                segment.byteRangeLength, segment.hasGapTag ? null : vorher);
            segmentInfos.put(segmentUri.toString(), info);
            if (!segment.hasGapTag) vorher = info;
        }
    }

    private final class ExtraktorFabrik implements HlsExtractorFactory {
        @Override public HlsMediaChunkExtractor createExtractor(Uri uri, Format format,
            @Nullable List<Format> untertitel, TimestampAdjuster zeit,
            Map<String, List<String>> antwort, ExtractorInput schnuppern, PlayerId spieler)
            throws IOException {
            SegmentInfo info = segmentInfos.get(uri.toString());
            boolean neuerAnker = false;
            if (info != null && !zeit.isInitialized()) {
                try {
                    long basisPts = info.anker.basisPts90k();
                    if (adjusterSetzen(zeit, basisPts)) {
                        neuerAnker = true;
                        angewendet = true;
                        melden("applied basePts90k=" + basisPts + " baseUs="
                            + TimestampAdjuster.ptsToUs(basisPts));
                    }
                } catch (InterruptedIOException e) {
                    // Seek und Quellenwechsel brechen den Loader absichtlich ab. Derselbe
                    // Wiedergabeanker muss beim naechsten Chunk erneut gelesen werden koennen.
                    throw e;
                } catch (IOException e) {
                    if (Thread.currentThread().isInterrupted()) {
                        throw alsUnterbrechung(e);
                    }
                    fehlgeschlagen = true;
                    melden("failed reason=" + e.getClass().getSimpleName());
                    // Wiedergabe bleibt moeglich. Der Standard-Extraktor richtet seinen Adjuster
                    // wie bisher am aktuellen Segment aus; exaktBereit() bleibt dann aber false.
                }
            }
            HlsMediaChunkExtractor extraktor = standardExtraktor.createExtractor(uri, format,
                untertitel, zeit, antwort, schnuppern, spieler);
            // Der ChunkSource waehlt nach den ungenauen EXTINF-Grenzen. Beginnt der gewaehlte
            // Chunk in echten PTS erst hinter dem Ziel, waere dieses Bild nicht erreichbar. Nach
            // jedem neuen Adjuster wird deshalb genau ein wirklicher Vorgaenger in denselben
            // Extraktor gespeist. SampleQueue verwirft dessen Bilder vor dem Ziel, behaelt aber
            // das benoetigte Schluesselbild und macht den anschliessenden exakten Seek moeglich.
            if (neuerAnker && info.vorher != null) {
                extraktor = new VorlaufExtraktor(extraktor, info.vorher);
            }
            return extraktor;
        }

        @Override public HlsExtractorFactory setSubtitleParserFactory(
            SubtitleParser.Factory factory) {
            standardExtraktor.setSubtitleParserFactory(factory);
            return this;
        }

        @Override public HlsExtractorFactory experimentalParseSubtitlesDuringExtraction(
            boolean waehrendExtraktion) {
            standardExtraktor.experimentalParseSubtitlesDuringExtraction(waehrendExtraktion);
            return this;
        }

        @Override public Format getOutputTextFormat(Format quelle) {
            return standardExtraktor.getOutputTextFormat(quelle);
        }
    }

    private static final class SegmentInfo {
        final Anker anker;
        final Uri uri;
        final long position;
        final long laenge;
        @Nullable final SegmentInfo vorher;

        SegmentInfo(Anker anker, Uri uri, long position, long laenge,
            @Nullable SegmentInfo vorher) {
            this.anker = anker;
            this.uri = uri;
            this.position = Math.max(0, position);
            this.laenge = laenge;
            this.vorher = vorher;
        }
    }

    /** Speist vor dem von Media3 gewaehlten TS genau dessen Vorgaenger in denselben Extraktor. */
    private final class VorlaufExtraktor implements HlsMediaChunkExtractor {
        private final HlsMediaChunkExtractor standard;
        private final SegmentInfo vorlauf;
        private boolean erledigt;

        VorlaufExtraktor(HlsMediaChunkExtractor standard, SegmentInfo vorlauf) {
            this.standard = standard;
            this.vorlauf = vorlauf;
        }

        @Override public void init(androidx.media3.extractor.ExtractorOutput ausgabe) {
            standard.init(ausgabe);
        }

        @Override public boolean read(ExtractorInput aktuell) throws IOException {
            if (!erledigt) {
                erledigt = true;
                vorlaufLaden();
            }
            return standard.read(aktuell);
        }

        private void vorlaufLaden() throws IOException {
            DataSource quelle = daten.createDataSource();
            long gelesen = 0;
            try {
                long laenge = vorlauf.laenge == C.LENGTH_UNSET
                    ? MAX_VORLAUF_BYTES : Math.min(vorlauf.laenge, MAX_VORLAUF_BYTES);
                if (laenge <= 0 || (vorlauf.laenge != C.LENGTH_UNSET
                    && vorlauf.laenge > MAX_VORLAUF_BYTES)) {
                    throw new IOException("TS-Vorlauf zu gross");
                }
                DataSpec abruf = new DataSpec.Builder().setUri(vorlauf.uri)
                    .setPosition(vorlauf.position).setLength(laenge).build();
                long offen = quelle.open(abruf);
                DefaultExtractorInput eingang = new DefaultExtractorInput(
                    quelle, vorlauf.position, offen);
                while (standard.read(eingang)) {
                    if (Thread.currentThread().isInterrupted()) {
                        throw new InterruptedIOException("TS-Vorlauf abgebrochen");
                    }
                }
                gelesen = eingang.getPosition() - vorlauf.position;
                if (vorlauf.laenge == C.LENGTH_UNSET && gelesen >= MAX_VORLAUF_BYTES) {
                    throw new IOException("TS-Vorlauf ueberschreitet Grenze");
                }
                melden("prerolled bytes=" + gelesen);
            } catch (InterruptedIOException e) {
                // Ein neuer Seek oder Quellenwechsel bricht den Loader absichtlich ab. Der
                // naechste, neue Adjuster versucht seinen eigenen Vorlauf; das ist kein Defekt der
                // Quelle und darf die ganze Wiedergabe nicht dauerhaft als ungenau markieren.
                throw e;
            } catch (IOException e) {
                fehlgeschlagen = true;
                melden("preroll-failed reason=" + e.getClass().getSimpleName());
            } finally {
                try { quelle.close(); } catch (IOException e) {
                    if (!Thread.currentThread().isInterrupted()) {
                        fehlgeschlagen = true;
                        melden("preroll-close-failed reason=" + e.getClass().getSimpleName());
                    }
                }
            }
        }

        @Override public boolean isPackedAudioExtractor() {
            return standard.isPackedAudioExtractor();
        }

        @Override public boolean isReusable() {
            return standard.isReusable();
        }

        @Override public HlsMediaChunkExtractor recreate() {
            return standard.recreate();
        }

        @Override public void onTruncatedSegmentParsed() {
            standard.onTruncatedSegmentParsed();
        }
    }

    private final class Anker {
        private final Uri uri;
        private final long position;
        private final long laenge;
        private boolean geladen;
        private long basisPts = C.TIME_UNSET;
        private IOException fehler;

        Anker(Uri uri, long position, long laenge) {
            this.uri = uri;
            this.position = Math.max(0, position);
            this.laenge = laenge;
        }

        synchronized long basisPts90k() throws IOException {
            if (!geladen) laden();
            if (fehler != null) throw fehler;
            return basisPts;
        }

        private void laden() throws IOException {
            DataSource quelle = daten.createDataSource();
            IOException lokalerFehler = null;
            boolean abschliessen = false;
            try {
                long begrenzt = laenge == C.LENGTH_UNSET
                    ? PROBE_BYTES : Math.min(PROBE_BYTES, laenge);
                DataSpec abruf = new DataSpec.Builder().setUri(uri).setPosition(position)
                    .setLength(begrenzt).build();
                quelle.open(abruf);
                ByteArrayOutputStream bytes = new ByteArrayOutputStream((int) begrenzt);
                byte[] teil = new byte[8192];
                int rest = (int) begrenzt;
                while (rest > 0) {
                    int gelesen = quelle.read(teil, 0, Math.min(teil.length, rest));
                    if (gelesen == C.RESULT_END_OF_INPUT) break;
                    if (gelesen == 0) continue;
                    bytes.write(teil, 0, gelesen);
                    rest -= gelesen;
                    if (Thread.currentThread().isInterrupted()) {
                        throw new InterruptedIOException("TS-Zeitanker abgebrochen");
                    }
                }
                basisPts = KanonischesHls.basisPts90k(bytes.toByteArray());
                if (basisPts == C.TIME_UNSET) throw new IOException("Kein TS-Zeitanker");
                melden("loaded basePts90k=" + basisPts + " bytes=" + bytes.size());
                abschliessen = true;
            } catch (IOException e) {
                if (istUnterbrechung(e)) throw alsUnterbrechung(e);
                lokalerFehler = e;
                abschliessen = true;
            } finally {
                try {
                    quelle.close();
                } catch (IOException e) {
                    if (istUnterbrechung(e)) {
                        abschliessen = false;
                        throw alsUnterbrechung(e);
                    }
                    if (abschliessen && lokalerFehler == null) lokalerFehler = e;
                }
                if (abschliessen) {
                    fehler = lokalerFehler;
                    geladen = true;
                }
            }
        }
    }

    /** Loader-Abbrueche koennen direkt oder in einer DataSource-Ausnahme verpackt ankommen. */
    static boolean istUnterbrechung(IOException fehler) {
        if (Thread.currentThread().isInterrupted()) return true;
        Throwable ursache = fehler;
        while (ursache != null) {
            if (ursache instanceof InterruptedIOException) return true;
            ursache = ursache.getCause();
        }
        return false;
    }

    private static InterruptedIOException alsUnterbrechung(IOException fehler) {
        if (fehler instanceof InterruptedIOException) return (InterruptedIOException) fehler;
        InterruptedIOException abbruch = new InterruptedIOException("TS-Zeitanker abgebrochen");
        abbruch.initCause(fehler);
        return abbruch;
    }

    /**
     * Initialisiert genau einmal, behaelt aber MODE_SHARED fuer jeden folgenden HLS-Chunk.
     */
    static boolean adjusterSetzen(TimestampAdjuster zeit, long basisPts90k) throws IOException {
        synchronized (zeit) {
            if (zeit.isInitialized()) return false;
            try {
                zeit.reset(TimestampAdjuster.MODE_SHARED);
                zeit.sharedInitializeOrWait(true, 0, 0);
                zeit.adjustTsTimestamp(basisPts90k);
                return true;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IOException("Zeitanker unterbrochen", e);
            } catch (TimeoutException e) {
                throw new IOException("Zeitanker lief ab", e);
            }
        }
    }

    /** Liest den fruehesten Audio-PTS beziehungsweise Video-DTS aus MPEG-TS. */
    static long basisPts90k(byte[] daten) {
        int start = syncStart(daten);
        if (start < 0) return C.TIME_UNSET;
        long erster = C.TIME_UNSET;
        long kleinster = Long.MAX_VALUE;
        for (int paket = start; paket + 188 <= daten.length; paket += 188) {
            if ((daten[paket] & 0xFF) != 0x47) continue;
            if ((daten[paket + 1] & 0x40) == 0) continue;
            int steuerung = (daten[paket + 3] >>> 4) & 3;
            if ((daten[paket + 1] & 0x80) != 0 || (daten[paket + 3] & 0xC0) != 0
                || steuerung == 0 || steuerung == 2) continue;
            int nutz = paket + 4;
            if (steuerung == 3) {
                int anpassung = daten[nutz] & 0xFF;
                nutz += 1 + anpassung;
            }
            if (nutz + 14 > paket + 188 || daten[nutz] != 0 || daten[nutz + 1] != 0
                || daten[nutz + 2] != 1) continue;
            int stream = daten[nutz + 3] & 0xFF;
            boolean video = stream >= 0xE0 && stream <= 0xEF;
            boolean audio = stream >= 0xC0 && stream <= 0xDF;
            if (!video && !audio) continue;
            if ((daten[nutz + 6] & 0xC0) != 0x80) continue;
            int flags = (daten[nutz + 7] >>> 6) & 3;
            int kopfLaenge = daten[nutz + 8] & 0xFF;
            long wert = C.TIME_UNSET;
            if (video && flags == 3 && kopfLaenge >= 10 && nutz + 19 <= paket + 188) {
                wert = ptsLesen(daten, nutz + 14, 1);
            } else if ((flags == 2 || flags == 3) && kopfLaenge >= 5
                && nutz + 14 <= paket + 188) {
                wert = ptsLesen(daten, nutz + 9, flags == 3 ? 3 : 2);
            }
            if (wert == C.TIME_UNSET) continue;
            if (erster == C.TIME_UNSET) erster = wert;
            long ohneUmbruch = nahe(wert, erster);
            kleinster = Math.min(kleinster, ohneUmbruch);
        }
        return kleinster == Long.MAX_VALUE ? C.TIME_UNSET : (kleinster & (PTS_WRAP - 1));
    }

    private static int syncStart(byte[] daten) {
        int ende = Math.min(188, daten.length);
        for (int i = 0; i < ende; i++) {
            if ((daten[i] & 0xFF) != 0x47) continue;
            if (i + 188 >= daten.length || (daten[i + 188] & 0xFF) == 0x47) return i;
        }
        return -1;
    }

    private static long ptsLesen(byte[] daten, int i, int kennung) {
        if (i < 0 || i + 4 >= daten.length) return C.TIME_UNSET;
        if (((daten[i] >>> 4) & 0x0F) != kennung || (daten[i] & 1) != 1
            || (daten[i + 2] & 1) != 1 || (daten[i + 4] & 1) != 1) {
            return C.TIME_UNSET;
        }
        return ((long) (daten[i] & 0x0E) << 29)
            | ((long) (daten[i + 1] & 0xFF) << 22)
            | ((long) (daten[i + 2] & 0xFE) << 14)
            | ((long) (daten[i + 3] & 0xFF) << 7)
            | ((long) (daten[i + 4] & 0xFE) >>> 1);
    }

    private static long nahe(long wert, long bezug) {
        long runde = (bezug + PTS_WRAP / 2) / PTS_WRAP;
        long darunter = wert + (runde - 1) * PTS_WRAP;
        long darueber = wert + runde * PTS_WRAP;
        return Math.abs(darunter - bezug) < Math.abs(darueber - bezug) ? darunter : darueber;
    }
}
