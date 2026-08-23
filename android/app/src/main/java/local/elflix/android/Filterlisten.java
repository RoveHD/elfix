package local.elflix.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Die Filterlisten - geladen statt eingebacken.
 *
 * <p>Bis hierher lag im Paket eine Datei mit 141.728 Domains, herausgezogen aus
 * den AdGuard-Listen am 12.08.2026 und danach nie wieder angefasst. Werbenetze
 * wechseln ihre Adressen im Wochenrhythmus; eine Liste, die mit der App altert,
 * blockt nach einem halben Jahr an den falschen Stellen.
 *
 * <p>Geholt werden dieselben vier Listen wie am Rechner. Was daraus wird, ist
 * bewusst weniger als dort: der Rechner faehrt die vollstaendige Regelsprache
 * ueber tsurlfilter, das hier waere mit rund 480 MB Dauerbedarf auf einem
 * Fernseher nicht zu halten. Also werden nur die reinen Domainsperren
 * herausgezogen - {@code ||host^} und Freunde -, und die genuegen fuer den
 * groessten Teil des Verkehrs.
 *
 * <p>Die eingebaute Liste bleibt als Notnagel: solange nichts geladen ist, und
 * fuer den Fall, dass das Laden dauerhaft scheitert.
 */
public final class Filterlisten {
    private static final String TAG = CrashReporter.TAG;
    private static final String PREFS = "elflix_filterlisten";
    private static final String DATEI = "filterdomains.txt";
    /** Dieselben vier Quellen wie am Desktop (siehe FILTER_LISTEN in main.js). */
    private static final String[] QUELLEN = {
        "https://filters.adtidy.org/extension/chromium/filters/2.txt",   // Base
        "https://filters.adtidy.org/extension/chromium/filters/3.txt",   // Tracking Protection
        "https://filters.adtidy.org/extension/chromium/filters/14.txt",  // Annoyances
        "https://filters.adtidy.org/extension/chromium/filters/6.txt",   // German
        "https://filters.adtidy.org/extension/chromium/filters/11.txt"   // Mobile Ads
    };
    /** Eine Woche - dieselbe Frist wie am Rechner. */
    private static final long HOECHSTALTER_MS = 7L * 24 * 60 * 60 * 1000;
    private static final int TIMEOUT_MS = 30_000;

    private Filterlisten() {
    }

    /** Die abgelegten Domains, oder eine leere Menge, wenn noch nichts geladen ist. */
    public static Set<String> geladene(Context context) {
        File datei = new File(context.getFilesDir(), DATEI);
        if (!datei.isFile()) return java.util.Collections.emptySet();
        LinkedHashSet<String> domains = new LinkedHashSet<>(200_000);
        try (BufferedReader leser = new BufferedReader(
            new InputStreamReader(new java.io.FileInputStream(datei), StandardCharsets.UTF_8))) {
            String zeile;
            while ((zeile = leser.readLine()) != null) {
                String sauber = zeile.trim();
                if (!sauber.isEmpty()) domains.add(sauber);
            }
        } catch (Exception fehler) {
            Log.e(TAG, "Abgelegte Filterdomains unlesbar", fehler);
            return java.util.Collections.emptySet();
        }
        return domains;
    }

    /** Wann zuletzt geladen wurde, als Text fuer die Einstellungen. */
    public static String standText(Context context) {
        long wann = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong("aktualisiert", 0);
        if (wann <= 0) return "Noch nie geladen - es gilt die mitgelieferte Liste.";
        long tage = (System.currentTimeMillis() - wann) / (24L * 60 * 60 * 1000);
        int anzahl = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt("anzahl", 0);
        String alter = tage <= 0 ? "heute" : (tage == 1 ? "gestern" : "vor " + tage + " Tagen");
        return anzahl + " Domains, geladen " + alter + ".";
    }

    /** Ob es Zeit fuer einen neuen Abruf ist. */
    public static boolean faellig(Context context) {
        long wann = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong("aktualisiert", 0);
        return System.currentTimeMillis() - wann > HOECHSTALTER_MS;
    }

    /** Meldet, wie der Abruf ausgegangen ist. */
    public interface Rueckmeldung {
        void fertig(int anzahl, String fehler);
    }

    /**
     * Holt die Listen und legt die Domains ab.
     *
     * <p>Laeuft im Hintergrund und beruehrt die laufende Filterung nicht: erst
     * wenn alles vollstaendig geschrieben ist, wird umgeschaltet. Ein
     * abgebrochener Abruf laesst damit den alten Stand stehen, statt die
     * Filterung halb zu leeren.
     */
    public static void aktualisieren(Context context, Rueckmeldung rueckmeldung) {
        Context anwendung = context.getApplicationContext();
        new Thread(() -> {
            LinkedHashSet<String> domains = new LinkedHashSet<>(250_000);
            String letzterFehler = null;
            int gelungen = 0;
            for (String quelle : QUELLEN) {
                try {
                    int vorher = domains.size();
                    listeLesen(quelle, domains);
                    gelungen += 1;
                    Log.i(TAG, "Filterliste " + quelle + ": +" + (domains.size() - vorher) + " Domains");
                } catch (Exception fehler) {
                    letzterFehler = String.valueOf(fehler.getMessage() == null ? fehler : fehler.getMessage());
                    Log.e(TAG, "Filterliste nicht geladen: " + quelle, fehler);
                }
            }
            // Eine einzelne unerreichbare Liste ist kein Grund, den ganzen
            // Stand zu verwerfen - vier von fuenf sind besser als der alte.
            if (gelungen == 0 || domains.isEmpty()) {
                final String fehlertext = letzterFehler == null ? "Keine Liste erreichbar" : letzterFehler;
                melde(rueckmeldung, 0, fehlertext);
                return;
            }
            if (!schreiben(anwendung, domains)) {
                melde(rueckmeldung, 0, "Liste liess sich nicht ablegen");
                return;
            }
            anwendung.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putLong("aktualisiert", System.currentTimeMillis())
                .putInt("anzahl", domains.size())
                .apply();
            Adblocker.uebernimmGeladeneDomains(domains);
            melde(rueckmeldung, domains.size(), null);
        }, "elfix-filterlisten").start();
    }

    private static void melde(Rueckmeldung rueckmeldung, int anzahl, String fehler) {
        if (rueckmeldung == null) return;
        new android.os.Handler(android.os.Looper.getMainLooper())
            .post(() -> rueckmeldung.fertig(anzahl, fehler));
    }

    /**
     * Zieht die Domainsperren aus einer AdGuard-Liste.
     *
     * <p>Genommen wird nur, was eine ganze Domain sperrt und keine Bedingung
     * traegt: {@code ||beispiel.de^}. Regeln mit Pfad, mit Modifikatoren
     * ({@code $domain=}, {@code $third-party}) oder mit Platzhaltern koennen
     * ohne echte Engine nicht richtig ausgewertet werden - halb ausgewertet
     * blockten sie an falscher Stelle, und das faellt als kaputte Seite auf.
     *
     * <p>Ausnahmen ({@code @@}) werden ebenfalls uebergangen: ohne die Regeln,
     * auf die sie sich beziehen, haetten sie keinen Sinn.
     */
    static void listeLesen(String adresse, Set<String> ziel) throws Exception {
        HttpURLConnection verbindung = (HttpURLConnection) new URL(adresse).openConnection();
        verbindung.setConnectTimeout(TIMEOUT_MS);
        verbindung.setReadTimeout(TIMEOUT_MS);
        verbindung.setRequestProperty("User-Agent", "ELFIX-Android");
        try (InputStream strom = verbindung.getInputStream();
             BufferedReader leser = new BufferedReader(new InputStreamReader(strom, StandardCharsets.UTF_8))) {
            String zeile;
            while ((zeile = leser.readLine()) != null) {
                String domain = domainAusRegel(zeile);
                if (domain != null) ziel.add(domain);
            }
        } finally {
            verbindung.disconnect();
        }
    }

    /** @return die gesperrte Domain, oder {@code null}, wenn die Zeile keine schlichte Domainsperre ist */
    static String domainAusRegel(String zeile) {
        if (zeile == null) return null;
        String regel = zeile.trim();
        if (regel.isEmpty()) return null;
        // Kommentare und kosmetische Regeln.
        if (regel.startsWith("!") || regel.startsWith("[")) return null;
        if (regel.contains("##") || regel.contains("#@#") || regel.contains("#?#") || regel.contains("#%#")) return null;
        // Ausnahmen ergeben ohne die zugehoerigen Regeln keinen Sinn.
        if (regel.startsWith("@@")) return null;
        if (!regel.startsWith("||")) return null;

        int ende = regel.indexOf('^', 2);
        if (ende < 0) return null;
        String rest = regel.substring(ende + 1);
        // Nach dem ^ darf nichts mehr stehen ausser einem leeren Modifikator.
        if (!rest.isEmpty() && !rest.equals("$all") && !rest.equals("$document")) return null;

        String domain = regel.substring(2, ende).toLowerCase();
        if (domain.isEmpty() || domain.contains("/") || domain.contains("*") || domain.contains("?")) return null;
        if (domain.indexOf('.') <= 0) return null;
        return domain;
    }

    private static boolean schreiben(Context context, Set<String> domains) {
        File ziel = new File(context.getFilesDir(), DATEI);
        File zwischen = new File(context.getFilesDir(), DATEI + ".neu");
        try (FileOutputStream aus = new FileOutputStream(zwischen)) {
            StringBuilder puffer = new StringBuilder(1 << 20);
            for (String domain : domains) {
                puffer.append(domain).append('\n');
                if (puffer.length() > (1 << 20)) {
                    aus.write(puffer.toString().getBytes(StandardCharsets.UTF_8));
                    puffer.setLength(0);
                }
            }
            aus.write(puffer.toString().getBytes(StandardCharsets.UTF_8));
            aus.flush();
        } catch (Exception fehler) {
            Log.e(TAG, "Filterdomains liessen sich nicht schreiben", fehler);
            return false;
        }
        if (!zwischen.renameTo(ziel) && (!ziel.delete() || !zwischen.renameTo(ziel))) {
            Log.e(TAG, "Filterdomains liessen sich nicht ersetzen");
            return false;
        }
        return true;
    }
}
