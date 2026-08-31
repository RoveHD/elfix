package local.elflix.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

/**
 * Kommt zu einer abgeschlossenen Serie noch etwas? - der Takt dazu.
 *
 * <h2>Was gefehlt hat</h2>
 *
 * <p>Am Rechner sieht ELFIX seit jeher von Zeit zu Zeit nach, ob zu einer
 * abgeschlossenen Serie neue Folgen erschienen sind: der Titel kommt dann
 * zurück auf die Watchlist, rückt auf die erste ungesehene Folge und bekommt
 * einen Hinweis. Auf Android gab es das nicht - der ganze Vorgang stand in
 * {@code main.js}, und was dort steht, sieht das Telefon nie.
 *
 * <p>Die Folge merkt man erst, wenn kein Rechner mehr läuft. „Black Torch"
 * war am Samstag mit Folge 9 da, und am Fernseher blieb der Watchparty-Titel
 * archiviert, bis irgendwann jemand den PC einschaltete. Wer den Fernseher als
 * einziges Gerät benutzt, bekam den Nachschub überhaupt nie zu sehen.
 *
 * <h2>Was hier steht - und was nicht</h2>
 *
 * <p>Hier steht der <em>Takt</em>: wann ein Durchgang läuft, wie viele Titel
 * er ansieht und wann der nächste dran ist. Die Entscheidung, ob eine Folge
 * Nachschub ist, steht in {@code nachschub.js} im gemeinsamen Kern - derselben
 * Datei, die der Rechner fragt. Es gibt also keine zweite Erkennung, sondern
 * eine, die jetzt auch das Telefon erreicht.
 *
 * <h2>Warum so selten</h2>
 *
 * <p>Jeder geprüfte Titel kostet zwei Seitenaufrufe beim Anbieter. Sechs je
 * Durchgang alle sechs Stunden - dieselben Zahlen wie am Rechner, und sie
 * kommen aus derselben Quelle ({@code nachschub.PRO_LAUF}). Die faire Rotation
 * darüber ({@code nachschub.kandidaten}) sorgt dafür, dass nicht immer
 * dieselben sechs drankommen: sie sortiert nach dem letzten Blick auf den
 * Titel, und der steht am Eintrag.
 *
 * <p>Der Zeitpunkt des letzten Durchgangs liegt daneben in den
 * SharedPreferences. Ein Telefon wird zwanzigmal am Tag gestartet - ohne
 * diesen Stempel liefe bei jedem Start ein Durchgang, und das wäre genau die
 * Dauerabfrage, die niemand will.
 */
public final class Nachschub {
    private static final String TAG = CrashReporter.TAG;

    /** Dieselbe Ablage wie die übrigen Einstellungen der App. */
    static final String ABLAGE = "elflix_settings";
    /** Wann zuletzt ein Durchgang lief - als Millisekunden seit der Epoche. */
    static final String SCHLUESSEL_ZULETZT = "nachschub_zuletzt";

    /**
     * So lange nach dem Start wird gewartet.
     *
     * <p>Ein Start hat Dringenderes zu tun: Anbieter laden, Startseite bauen,
     * Filterlisten prüfen. Der Rechner wartet an derselben Stelle zwanzig
     * Sekunden; hier sind es dreißig, weil ein Fernseher langsamer hochkommt.
     */
    private static final long ANLAUF_MS = 30_000L;

    /** Und in diesem Abstand danach - der Wert aus dem Kern, siehe {@link #taktSetzen}. */
    private static final long RUECKFALL_INTERVALL_MS = 6 * 60 * 60 * 1000L;

    private final Context context;
    private final Bestand bestand;
    private final Handler takt = new Handler(Looper.getMainLooper());

    private long intervallMs = RUECKFALL_INTERVALL_MS;
    private int proLauf = 6;
    private boolean laeuft = false;
    private boolean unterwegs = false;

    private final Runnable durchgang = this::pruefen;

    public Nachschub(Context context, Bestand bestand) {
        this.context = context.getApplicationContext();
        this.bestand = bestand;
    }

    /**
     * Portion und Abstand aus dem Kern übernehmen.
     *
     * <p>Damit stehen die Zahlen an genau einer Stelle. Kommt der Kern nicht
     * dazu, bleibt es bei den Rückfallwerten oben - sie sind dieselben, aber
     * ein Rückfall ist ein Rückfall und keine zweite Quelle.
     */
    public void taktSetzen(int proLauf, long intervallMs) {
        if (proLauf > 0) this.proLauf = proLauf;
        if (intervallMs > 0) this.intervallMs = intervallMs;
    }

    /**
     * Den Takt anwerfen.
     *
     * <p>Der erste Durchgang läuft nach der Anlaufzeit - aber nur, wenn seit
     * dem letzten wirklich genug Zeit vergangen ist. Sonst wird bis zum
     * fälligen Zeitpunkt gewartet.
     */
    public void starten() {
        if (laeuft) return;
        laeuft = true;
        takt.postDelayed(durchgang, Math.max(ANLAUF_MS, verbleibend()));
    }

    /** Beim Beenden: kein Durchgang mehr, und der Handler hält nichts fest. */
    public void anhalten() {
        laeuft = false;
        takt.removeCallbacks(durchgang);
    }

    /** Wie lange es bis zum nächsten fälligen Durchgang noch dauert. */
    private long verbleibend() {
        long zuletzt = ablage().getLong(SCHLUESSEL_ZULETZT, 0L);
        if (zuletzt <= 0) return 0;
        long seither = System.currentTimeMillis() - zuletzt;
        // Eine Uhr, die zurückgestellt wurde, darf den Takt nicht für Wochen
        // anhalten: ein negatives "seither" zählt als "lange her".
        if (seither < 0) return 0;
        return Math.max(0, intervallMs - seither);
    }

    private SharedPreferences ablage() {
        return context.getSharedPreferences(ABLAGE, Context.MODE_PRIVATE);
    }

    private void planen(long inMs) {
        if (!laeuft) return;
        takt.removeCallbacks(durchgang);
        takt.postDelayed(durchgang, Math.max(60_000L, inMs));
    }

    private void pruefen() {
        if (!laeuft || bestand == null) return;
        if (unterwegs) {
            // Der vorige Durchgang wartet noch auf Anbieterseiten. Zwei
            // gleichzeitig wären doppelt so viele Aufrufe für dasselbe
            // Ergebnis.
            planen(intervallMs);
            return;
        }
        long faellig = verbleibend();
        if (faellig > 0) {
            planen(faellig);
            return;
        }
        unterwegs = true;
        // Der Stempel gehört vor den Lauf und nicht dahinter. Bricht der
        // Durchgang ab - kein Netz, App wird weggewischt -, soll der nächste
        // Start nicht sofort wieder einen auslösen.
        ablage().edit().putLong(SCHLUESSEL_ZULETZT, System.currentTimeMillis()).apply();
        bestand.nachschubPruefen(proLauf, gefunden -> {
            unterwegs = false;
            if (gefunden > 0) Log.i(TAG, "Nachschub: " + gefunden + " Titel wieder offen");
            planen(intervallMs);
        });
    }
}
