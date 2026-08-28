package local.elflix.android;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.util.LruCache;
import android.view.View;
import android.widget.ImageView;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Die Titelbilder der Karten - holen, merken, anzeigen.
 *
 * <p>Am Rechner traegt jede Karte das Bild des Titels; auf dem Telefon standen
 * dort zwei Buchstaben. Nicht, weil das Bild fehlte - es steht laengst im
 * Eintrag und kommt sogar ueber den Geraeteabgleich mit -, sondern weil es
 * niemand geholt hat. Genau das tut diese Klasse, und mehr nicht.
 *
 * <p>Zwei Speicher, aus zwei Gruenden. Der im Arbeitsspeicher haelt, was gerade
 * auf dem Schirm ist: eine Liste wird beim Blaettern staendig neu gezeichnet,
 * und ohne ihn flackerte jede Karte. Der auf der Platte haelt es ueber den
 * Neustart hinaus - ein Titelbild aendert sich nicht, und ein Telefon im
 * Mobilfunk soll es kein zweites Mal laden muessen.
 *
 * <p>Verkleinert wird schon beim Dekodieren. Ein Poster kommt mit 600 mal 900
 * Pixeln herein und liegt auf einer Karte von 66 dp - ungerechnet waeren das
 * zwei Megabyte je Karte, und zwanzig Karten haetten die App aus dem Speicher
 * getragen.
 *
 * <p>Alles hier ist statisch und ohne Zustand ausser den Speichern: eine Karte
 * entsteht in {@link MobileViews} und {@link TvViews}, und die kennen keine
 * Activity.
 */
public final class Bilder {
    private static final String TAG = CrashReporter.TAG;
    private static final String ORDNER = "titelbilder";
    /** Wie viel Platz die Bilder auf der Platte hoechstens belegen. */
    private static final long PLATZ_BYTES = 40L * 1024 * 1024;
    private static final int TIMEOUT_MS = 12_000;
    private static final String AGENT =
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";

    /**
     * Mit wie vielen Bits je Bildpunkt ein Titelbild im Speicher liegt.
     *
     * <p><b>Zwei statt vier Byte.</b> Gemessen am 2026-08-28 auf dem Handy-
     * Emulator, erste 45 Sekunden nach dem Start: <em>165 Verdraengungen</em>
     * bei einem randvollen Speicher (46610 von 49152 KB). Genau das ist das
     * gemeldete Flackern: was verdraengt wurde, faengt beim naechsten Zeichnen
     * wieder beim Platzhalter an - und beim Start wird sechsmal gezeichnet.
     *
     * <p>Der Titelhintergrund allein wiegt schwer. Er wird in Bildschirmbreite
     * dekodiert; ein Quellbild von 1280 mal 720 ergibt in ARGB_8888 3,7 MB, und
     * fuenf davon sind ein Drittel des ganzen Speichers.
     *
     * <p>Ein Titelbild ist ein Foto ohne Transparenz - hinter ihm liegt der
     * gestaltete Platzhalter, davor ein Verlauf. RGB_565 halbiert den Bedarf
     * genau und ist an einem Foto dieser Groesse nicht zu unterscheiden. Was
     * damit *nicht* geht, ist Transparenz: ein PNG mit durchsichtigen Stellen
     * bekaeme Schwarz dahinter. Anbieter liefern Poster als JPEG oder WebP,
     * und der Fall ist in dieser App keiner.
     */
    private static final Bitmap.Config FARBEN = Bitmap.Config.RGB_565;

    private static final ExecutorService netz = Executors.newFixedThreadPool(3);
    private static final Handler haupt = new Handler(Looper.getMainLooper());

    private static LruCache<String, Bitmap> speicher;
    private static boolean aufgeraeumt;

    /**
     * Wer gerade auf welches Bild wartet.
     *
     * <p><b>Warum es das gibt.</b> Gemessen am 2026-08-28 auf dem Handy-
     * Emulator, erste 45 Sekunden nach dem Start: <em>569 Ladeauftraege fuer
     * 108 verschiedene Bilder</em>, eines allein vierzehnmal. Der Grund war
     * nicht der Speicher - der greift erst, wenn ein Auftrag fertig ist. Bis
     * dahin lief jeder weitere Auftrag zu derselben Adresse an ihm vorbei und
     * legte noch eine Datei-Lesung samt vollstaendiger Dekodierung auf die drei
     * Threads. Die Karten, die gerade auf dem Schirm standen, warteten damit
     * hinter der vierzehnten Kopie eines Bildes, das laengst unterwegs war.
     *
     * <p>Also wird je Schluessel genau einmal geholt. Wer in der Zwischenzeit
     * dasselbe Bild will, haengt sich an und bekommt dieselbe Bitmap.
     */
    private static final java.util.HashMap<String, java.util.ArrayList<Wartender>> laufend =
        new java.util.HashMap<>();

    /** Ein Ziel, das auf ein Bild wartet - samt dem, was danach zu tun ist. */
    private static final class Wartender {
        final ImageView ziel;
        final String schluessel;
        final Runnable beiBild;

        Wartender(ImageView ziel, String schluessel, Runnable beiBild) {
            this.ziel = ziel;
            this.schluessel = schluessel;
            this.beiBild = beiBild;
        }
    }

    private Bilder() {
    }

    /**
     * Das Bild an eine Karte haengen.
     *
     * <p>Der Aufruf kehrt sofort zurueck; geholt wird nebenher. Bis dahin
     * bleibt stehen, was die Karte ohnehin zeigt - der gestaltete Platzhalter
     * mit den Anfangsbuchstaben. Kommt nie ein Bild (kein Netz, kaputte
     * Adresse, Anbieter blockt), bleibt er einfach stehen; ein Loch entsteht
     * nicht.
     *
     * <p><b>Steht schon das richtige Bild da, geschieht nichts.</b> Hier wurde
     * bis hierher bei jedem Aufruf zuerst {@code setImageDrawable(null)} und
     * {@code GONE} gesetzt - auch dann, wenn genau dieses Bild in genau dieser
     * Groesse schon in genau diesem {@link ImageView} stand. Beim Titel-
     * hintergrund, der sich alle fuenfzehn Sekunden neu zeichnet, war das der
     * sichtbare Sprung: Bild weg, Platzhalter da, Bild wieder da.
     *
     * @param ziel     wohin das Bild gehoert
     * @param adresse  die Bildadresse aus dem Eintrag, leer erlaubt
     * @param breiteDp Kartenmass, damit nicht groesser dekodiert wird als noetig
     * @param beiBild  laeuft im Hauptthread, sobald wirklich ein Bild da ist
     */
    static void laden(ImageView ziel, String adresse, int breiteDp, int hoeheDp, Runnable beiBild) {
        if (ziel == null) return;
        String sauber = adresse == null ? "" : adresse.trim();
        if (sauber.isEmpty()) {
            ziel.setTag(null);
            ziel.setImageDrawable(null);
            ziel.setVisibility(ImageView.GONE);
            return;
        }

        Context context = ziel.getContext().getApplicationContext();
        float dichte = context.getResources().getDisplayMetrics().density;
        int breite = Math.max(1, Math.round(breiteDp * dichte));
        int hoehe = Math.max(1, Math.round(hoeheDp * dichte));
        String schluessel = sauber + "@" + breite + "x" + hoehe;

        // Dasselbe Bild in derselben Groesse steht schon da. Nichts anfassen -
        // aber die Karte erfaehrt es trotzdem, sonst blendet sie ihren
        // Platzhalter wieder ein.
        if (schluessel.equals(ziel.getTag()) && ziel.getDrawable() != null) {
            if (beiBild != null) beiBild.run();
            return;
        }

        // Ein anderes Bild als bisher: erst jetzt raeumen. Der Merker haengt am
        // Ziel, nicht am Auftrag - Listen benutzen ihre Ansichten wieder, und
        // die Antwort auf den vorigen Auftrag darf nicht im Bild des naechsten
        // landen.
        ziel.setTag(schluessel);
        ziel.setImageDrawable(null);
        ziel.setVisibility(ImageView.GONE);

        Bitmap bekannt = speicher(context).get(schluessel);
        if (bekannt != null) {
            zeigen(ziel, schluessel, bekannt, beiBild, false);
            return;
        }
        anstellen(context, sauber, schluessel, breite, hoehe,
            new Wartender(ziel, schluessel, beiBild));
    }

    /**
     * Einen Wartenden an den Auftrag zu diesem Schluessel haengen - und den
     * Auftrag anlegen, falls er noch nicht laeuft.
     */
    private static void anstellen(Context context, String adresse, String schluessel,
                                  int breite, int hoehe, Wartender wartender) {
        synchronized (laufend) {
            java.util.ArrayList<Wartender> warteschlange = laufend.get(schluessel);
            if (warteschlange != null) {
                warteschlange.add(wartender);
                return;
            }
            warteschlange = new java.util.ArrayList<>();
            warteschlange.add(wartender);
            laufend.put(schluessel, warteschlange);
        }
        netz.execute(() -> {
            Bitmap bild = holen(context, adresse, breite, hoehe);
            if (bild != null) speicher(context).put(schluessel, bild);
            java.util.ArrayList<Wartender> fertig;
            synchronized (laufend) {
                fertig = laufend.remove(schluessel);
            }
            if (fertig == null || bild == null) return;
            haupt.post(() -> {
                for (Wartender einer : fertig) {
                    zeigen(einer.ziel, einer.schluessel, bild, einer.beiBild, true);
                }
            });
        });
    }

    /**
     * Bilder nur laden, solange ihre Karte in der Naehe des Bildschirms ist.
     *
     * <p>Fuer kurze Reihen braucht es das nicht - da laedt {@link #laden}
     * einfach alles. Die Entdeckungsseite ist etwas anderes: sie waechst beim
     * Scrollen unbegrenzt weiter, und jedes gesetzte Bitmap bleibt am
     * {@link ImageView} haengen, auch wenn die Karte laengst hundert Zeilen
     * weiter oben steht. Der Bildspeicher raeumt es dann nicht mehr weg - er
     * kennt es zwar nicht mehr, aber die Ansicht haelt es fest. Bei
     * dreihundert Karten sind das mehrere hundert Megabyte, und die App
     * verschwindet lautlos.
     *
     * <p>Also wird geladen, was in der Naehe ist, und wieder freigegeben, was
     * es nicht mehr ist. Zurueck bleibt der gestaltete Platzhalter - dieselbe
     * Karte wie vor dem Laden, kein Loch.
     */
    public static final class Sichtfenster {
        /** So weit ueber den Bildschirm hinaus wird geladen. */
        private static final int VORLAUF_DP = 600;

        private static final class Posten {
            final ImageView bild;
            final String adresse;
            final int breiteDp;
            final int hoeheDp;
            final Runnable beiBild;
            final Runnable beiLeer;
            boolean geladen;

            Posten(ImageView bild, String adresse, int breiteDp, int hoeheDp,
                   Runnable beiBild, Runnable beiLeer) {
                this.bild = bild;
                this.adresse = adresse;
                this.breiteDp = breiteDp;
                this.hoeheDp = hoeheDp;
                this.beiBild = beiBild;
                this.beiLeer = beiLeer;
            }
        }

        private final java.util.ArrayList<Posten> posten = new java.util.ArrayList<>();
        /**
         * Wann zuletzt nachgesehen wurde.
         *
         * <p>Der Aufruf haengt an jedem Scrollschritt, und die Liste hat auf
         * einer weit gescrollten Entdeckungsseite mehrere hundert Eintraege.
         * Jeden davon sechzigmal in der Sekunde zu vermessen waere genau das
         * Ruckeln, das diese Klasse verhindern soll. Ein Achtelsekunde reicht:
         * so weit scrollt niemand, dass ein Bild zu spaet kaeme.
         */
        private long zuletzt;
        private static final long PAUSE_MS = 120;

        /**
         * Ein Bild anmelden. Geholt wird es erst, wenn seine Karte in die Naehe
         * des Bildschirms kommt.
         *
         * @param beiLeer laeuft, wenn das Bild wieder freigegeben wird - dort
         *                gehoert der Platzhalter zurueck
         */
        public void merken(ImageView bild, String adresse, int breiteDp, int hoeheDp,
                           Runnable beiBild, Runnable beiLeer) {
            if (bild == null) return;
            String sauber = adresse == null ? "" : adresse.trim();
            if (sauber.isEmpty()) return;
            posten.add(new Posten(bild, sauber, breiteDp, hoeheDp, beiBild, beiLeer));
        }

        /** Alles vergessen - beim Verlassen der Seite. */
        public void leeren() {
            posten.clear();
        }

        /**
         * Nachsehen, was jetzt in der Naehe ist.
         *
         * <p>Billig gehalten: es wird nur gerechnet, kein Bild angefasst, das
         * schon im richtigen Zustand ist. Der Aufruf haengt an jedem
         * Scrollschritt.
         */
        public void pruefen(View fenster) {
            pruefen(fenster, false);
        }

        /** @param sofort ohne Pause - nach dem Anhaengen neuer Karten */
        public void pruefen(View fenster, boolean sofort) {
            if (fenster == null || posten.isEmpty()) return;
            long jetzt = android.os.SystemClock.uptimeMillis();
            if (!sofort && jetzt - zuletzt < PAUSE_MS) return;
            zuletzt = jetzt;
            int vorlauf = Math.round(VORLAUF_DP
                * fenster.getResources().getDisplayMetrics().density);
            int[] rahmen = new int[2];
            fenster.getLocationOnScreen(rahmen);
            int oben = rahmen[1] - vorlauf;
            int unten = rahmen[1] + fenster.getHeight() + vorlauf;
            int[] stelle = new int[2];
            for (Posten eintrag : posten) {
                if (eintrag.bild.getWindowToken() == null) continue;
                eintrag.bild.getLocationOnScreen(stelle);
                int hoehe = eintrag.bild.getHeight();
                // Eine Karte, die noch nie gemessen wurde, steht bei 0 - das
                // waere "weit oben" und damit nie in der Naehe. Sie gilt
                // deshalb als sichtbar, bis sie eine Hoehe hat.
                boolean nah = hoehe <= 0 || (stelle[1] + hoehe >= oben && stelle[1] <= unten);
                if (nah == eintrag.geladen) continue;
                eintrag.geladen = nah;
                if (nah) {
                    laden(eintrag.bild, eintrag.adresse, eintrag.breiteDp, eintrag.hoeheDp,
                        eintrag.beiBild);
                } else {
                    eintrag.bild.setImageDrawable(null);
                    eintrag.bild.setVisibility(View.GONE);
                    eintrag.bild.setTag(null);
                    if (eintrag.beiLeer != null) eintrag.beiLeer.run();
                }
            }
        }
    }

    /**
     * @param eingeblendet ob das Bild sanft aufkommen soll. Nur fuer Bilder, auf
     *                     die wirklich gewartet wurde: was aus dem Speicher
     *                     kommt, steht schon im ersten Bild der Seite da und
     *                     duerfte nicht erst einblenden - das waere ein
     *                     Flackern, wo vorher keins war.
     */
    private static void zeigen(ImageView ziel, String schluessel, Bitmap bild, Runnable beiBild,
                               boolean eingeblendet) {
        if (!schluessel.equals(ziel.getTag())) return;
        ziel.setImageBitmap(bild);
        ziel.setVisibility(ImageView.VISIBLE);
        if (eingeblendet) {
            long dauer = Bewegung.dauer(ziel.getContext(), Bewegung.AUFTRITT);
            if (dauer > 0) {
                // Blende und ein Hauch Zoom: von 1.03 auf 1. Das Bild kommt
                // damit aus der Tiefe statt aus dem Nichts - und weil der
                // Platzhalter darunter dieselbe Flaeche fuellt, sieht man
                // keinen Rand, waehrend es noch groesser ist.
                ziel.setAlpha(0f);
                boolean weit = Bewegung.weiteWege(ziel.getContext());
                ziel.setScaleX(weit ? 1.03f : 1f);
                ziel.setScaleY(weit ? 1.03f : 1f);
                ziel.animate().alpha(1f).scaleX(1f).scaleY(1f)
                    .setDuration(dauer).setInterpolator(Bewegung.hinein()).start();
            } else {
                ziel.setAlpha(1f);
                ziel.setScaleX(1f);
                ziel.setScaleY(1f);
            }
        } else {
            // Aus dem Speicher: es stand schon im ersten Bild der Seite da und
            // darf nicht erst einblenden - das waere ein Flackern, wo vorher
            // keins war.
            ziel.animate().cancel();
            ziel.setAlpha(1f);
            ziel.setScaleX(1f);
            ziel.setScaleY(1f);
        }
        if (beiBild != null) beiBild.run();
    }

    private static synchronized LruCache<String, Bitmap> speicher(Context context) {
        if (speicher == null) {
            // Ein Viertel des Heaps.
            //
            // <p>Hier stand ein Achtel - die uebliche Faustregel, und fuer eine
            // Liste, die man durchblaettert, die richtige. Fuer diese
            // Startseite war sie zu klein. Gemessen am 2026-08-28 auf dem
            // Handy-Emulator (192 MB Heap, also 24 MB Speicher): <em>279
            // abgelegte Bilder, 235 davon wieder verdraengt</em>. Der
            // Titelhintergrund allein wiegt schwer - er wird in Bildschirm-
            // breite dekodiert, waehrend eine Kachel ein Sechstel davon
            // braucht -, und fuenf davon reichen, um die uebrigen hundert
            // hinauszudraengen.
            //
            // <p>Sichtbar wurde das als das gemeldete Flackern: jedes
            // Neuzeichnen fand einen leeren Speicher vor und musste jedes Bild
            // von der Platte neu dekodieren. Der Platzhalter stand also nicht
            // deshalb da, weil ein Bild fehlte, sondern weil es zum wievielten
            // Mal auch immer geholt wurde.
            int platz = (int) (Runtime.getRuntime().maxMemory() / 1024 / 4);
            speicher = new LruCache<String, Bitmap>(Math.max(2048, platz)) {
                @Override
                protected int sizeOf(String schluessel, Bitmap wert) {
                    return wert.getByteCount() / 1024;
                }
            };
        }
        if (!aufgeraeumt) {
            aufgeraeumt = true;
            Context anwendung = context.getApplicationContext();
            netz.execute(() -> aufraeumen(anwendung));
        }
        return speicher;
    }

    /* --------------------------------------------------------------- Holen */

    private static Bitmap holen(Context context, String adresse, int breite, int hoehe) {
        try {
            if (adresse.startsWith("data:")) return ausDatenAdresse(adresse, breite, hoehe);
            if (!adresse.startsWith("http")) return null;

            File datei = ablage(context, adresse);
            if (datei.isFile() && datei.length() > 0) {
                Bitmap ausAblage = dekodieren(datei, breite, hoehe);
                if (ausAblage != null) return ausAblage;
                // Eine unlesbare Datei ist schlimmer als keine: sie stuende
                // jedem weiteren Versuch im Weg.
                if (!datei.delete()) Log.d(TAG, "Titelbild nicht loeschbar: " + datei.getName());
            }
            byte[] roh = herunterladen(adresse);
            if (roh == null || roh.length == 0) return null;
            schreiben(datei, roh);
            Bitmap frisch = dekodieren(datei, breite, hoehe);
            if (frisch != null) return frisch;
            return BitmapFactory.decodeByteArray(roh, 0, roh.length);
        } catch (Exception fehler) {
            Log.d(TAG, "Titelbild nicht geladen: " + fehler);
            return null;
        } catch (OutOfMemoryError knapp) {
            Log.w(TAG, "Titelbild zu gross fuer den Speicher", knapp);
            return null;
        }
    }

    private static byte[] herunterladen(String adresse) throws Exception {
        HttpURLConnection verbindung = null;
        try {
            verbindung = (HttpURLConnection) new URL(adresse).openConnection();
            verbindung.setConnectTimeout(TIMEOUT_MS);
            verbindung.setReadTimeout(TIMEOUT_MS);
            verbindung.setInstanceFollowRedirects(true);
            verbindung.setRequestProperty("Accept", "image/avif,image/webp,image/*,*/*;q=0.8");
            verbindung.setRequestProperty("User-Agent", AGENT);
            // Manche Anbieter geben ihre Bilder nur an ihre eigene Seite
            // heraus. Der Verweis auf den eigenen Wirt ist das, was ein
            // Browser ohnehin schickte, wenn die Karte dort stuende.
            String herkunft = herkunftVon(adresse);
            if (!herkunft.isEmpty()) verbindung.setRequestProperty("Referer", herkunft);
            int status = verbindung.getResponseCode();
            if (status < 200 || status >= 300) return null;
            try (InputStream strom = verbindung.getInputStream()) {
                ByteArrayOutputStream puffer = new ByteArrayOutputStream(32 * 1024);
                byte[] block = new byte[16 * 1024];
                int gelesen;
                int gesamt = 0;
                while ((gelesen = strom.read(block)) > 0) {
                    gesamt += gelesen;
                    // Ein Titelbild ist keine zehn Megabyte gross. Was
                    // groesser ist, ist kein Titelbild.
                    if (gesamt > 10 * 1024 * 1024) return null;
                    puffer.write(block, 0, gelesen);
                }
                return puffer.toByteArray();
            }
        } finally {
            if (verbindung != null) verbindung.disconnect();
        }
    }

    private static String herkunftVon(String adresse) {
        try {
            URL url = new URL(adresse);
            return url.getProtocol() + "://" + url.getHost() + "/";
        } catch (Exception fehler) {
            return "";
        }
    }

    private static Bitmap ausDatenAdresse(String adresse, int breite, int hoehe) {
        int komma = adresse.indexOf(',');
        if (komma < 0 || !adresse.substring(0, komma).contains("base64")) return null;
        byte[] roh = Base64.decode(adresse.substring(komma + 1), Base64.DEFAULT);
        if (roh.length == 0) return null;
        BitmapFactory.Options masse = new BitmapFactory.Options();
        masse.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(roh, 0, roh.length, masse);
        BitmapFactory.Options einstellung = new BitmapFactory.Options();
        einstellung.inSampleSize = schrittweite(masse, breite, hoehe);
        einstellung.inPreferredConfig = FARBEN;
        return BitmapFactory.decodeByteArray(roh, 0, roh.length, einstellung);
    }

    private static Bitmap dekodieren(File datei, int breite, int hoehe) {
        BitmapFactory.Options masse = new BitmapFactory.Options();
        masse.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(datei.getAbsolutePath(), masse);
        if (masse.outWidth <= 0 || masse.outHeight <= 0) return null;
        BitmapFactory.Options einstellung = new BitmapFactory.Options();
        einstellung.inSampleSize = schrittweite(masse, breite, hoehe);
        einstellung.inPreferredConfig = FARBEN;
        return BitmapFactory.decodeFile(datei.getAbsolutePath(), einstellung);
    }

    /**
     * Um welche Zweierpotenz beim Dekodieren verkleinert wird.
     *
     * <p>Halbiert wird, solange beide Seiten noch groesser bleiben als die
     * Karte - so bleibt das Bild scharf und kostet trotzdem nur einen Bruchteil.
     */
    private static int schrittweite(BitmapFactory.Options masse, int breite, int hoehe) {
        int schritt = 1;
        while (masse.outWidth / (schritt * 2) >= breite && masse.outHeight / (schritt * 2) >= hoehe) {
            schritt *= 2;
        }
        return schritt;
    }

    /* -------------------------------------------------------------- Ablage */

    private static File ablage(Context context, String adresse) {
        File ordner = new File(context.getCacheDir(), ORDNER);
        if (!ordner.isDirectory() && !ordner.mkdirs()) {
            Log.d(TAG, "Bildablage nicht angelegt");
        }
        return new File(ordner, name(adresse));
    }

    private static String name(String adresse) {
        try {
            MessageDigest sha = MessageDigest.getInstance("SHA-1");
            byte[] abdruck = sha.digest(adresse.getBytes("UTF-8"));
            StringBuilder text = new StringBuilder(abdruck.length * 2);
            for (byte wert : abdruck) text.append(String.format("%02x", wert));
            return text.toString();
        } catch (Exception fehler) {
            return Integer.toHexString(adresse.hashCode());
        }
    }

    private static void schreiben(File ziel, byte[] roh) {
        // Erst daneben, dann umbenennen - wie bei der Favoritenablage: ein
        // abgebrochener Schreibvorgang hinterlaesst sonst eine halbe Datei,
        // die von da an als "schon geholt" gilt.
        File zwischen = new File(ziel.getAbsolutePath() + ".neu");
        try (FileOutputStream aus = new FileOutputStream(zwischen)) {
            aus.write(roh);
            aus.flush();
        } catch (Exception fehler) {
            Log.d(TAG, "Titelbild nicht abgelegt: " + fehler);
            return;
        }
        if (!zwischen.renameTo(ziel) && !zwischen.delete()) {
            Log.d(TAG, "Zwischendatei blieb liegen: " + zwischen.getName());
        }
    }

    /**
     * Platz schaffen, wenn die Ablage zu gross wird.
     *
     * <p>Weg kommt das Aelteste zuerst. Ein Bild, das noch gebraucht wird,
     * wird beim naechsten Zeichnen einfach wieder geholt - hier geht nichts
     * verloren, was nicht wiederzubeschaffen waere.
     */
    private static void aufraeumen(Context context) {
        File ordner = new File(context.getCacheDir(), ORDNER);
        File[] dateien = ordner.listFiles();
        if (dateien == null || dateien.length == 0) return;
        long gesamt = 0;
        for (File datei : dateien) gesamt += datei.length();
        if (gesamt <= PLATZ_BYTES) return;

        Arrays.sort(dateien, (links, rechts) -> Long.compare(links.lastModified(), rechts.lastModified()));
        for (File datei : dateien) {
            if (gesamt <= PLATZ_BYTES) break;
            long groesse = datei.length();
            if (datei.delete()) gesamt -= groesse;
        }
    }
}
