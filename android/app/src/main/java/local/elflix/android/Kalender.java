package local.elflix.android;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Der Anbieterkalender auf der Startseite.
 *
 * <p>Was diese Woche erscheint, stand am Rechner in einer eigenen Ansicht in
 * der Seitenleiste. Auf dem Telefon gibt es keine Seitenleiste, also steht er
 * als Reihe auf der Startseite - mit einer eigenen Seite dahinter, auf der die
 * Woche nach Tagen sortiert ist.
 *
 * <p>Gerechnet wird nichts hier: {@code kalender.js} im Kern probiert die
 * Adressen der Anbieter durch, {@code discover.js} liest sie aus. Diese Klasse
 * haelt nur die Antwort - im Speicher, solange die App laeuft, und auf der
 * Platte darueber hinaus.
 *
 * <p>Der Grund fuer das Zweite ist der Offline-Start. Ein Telefon startet
 * regelmaessig ohne Netz, und eine Woche, die beim letzten Start vorlag, ist
 * dann naeher an der Wahrheit als eine Fehlermeldung. Dass sie alt ist, sagt
 * die Oberflaeche dazu.
 */
public final class Kalender {
    private static final String TAG = CrashReporter.TAG;
    private static final String SPEICHER = "kalender";
    /** So lange gilt eine geholte Woche, ohne dass erneut gefragt wird. */
    private static final long FRISCH_MS = 30 * 60 * 1000L;
    /**
     * Und so lange, wenn das Gezeigte von der Platte stammt.
     *
     * <p>Dieselbe Ueberlegung wie bei den Vorschlagsreihen: ein alter Stand
     * steht nur da, weil gerade nichts Besseres zu haben war, und soll die
     * Rueckkehr des Netzes binnen einer Minute bemerken.
     */
    private static final long ALT_FRISCH_MS = 60 * 1000L;

    /** Wird gerufen, wenn eine Woche da ist - die Startseite zeichnet dann neu. */
    public interface Beobachter {
        void kalenderGeaendert();
    }

    /** Ein Eintrag der Woche, so wie ihn beide Geraete kennen. */
    public static final class Eintrag {
        public final String tag;
        public final String datum;
        public final String uhrzeit;
        public final String titel;
        public final String url;
        public final String bild;
        public final String art;
        public final String sprache;
        public final int staffel;
        public final int folge;
        public final String anbieterId;
        public final String anbieterName;

        Eintrag(JSONObject roh) {
            tag = roh.optString("day", "");
            datum = roh.optString("date", "");
            uhrzeit = roh.optString("time", "");
            titel = roh.optString("title", "");
            url = roh.optString("url", "");
            bild = roh.optString("image", "");
            art = roh.optString("type", "");
            sprache = roh.optString("language", "");
            staffel = roh.optInt("season", 0);
            folge = roh.optInt("episode", 0);
            anbieterId = roh.optString("providerId", "");
            anbieterName = roh.optString("providerName", "");
        }

        /** "S1E4" - oder nichts, wenn der Anbieter die Folge nicht nennt. */
        public String folgenText() {
            if (staffel <= 0 && folge <= 0) return "";
            if (staffel <= 0) return "E" + folge;
            return "S" + staffel + "E" + folge;
        }
    }

    private final Context context;
    private final Kern kern;
    private final Beobachter beobachter;

    private JSONObject woche;
    private long stand;
    private boolean laeuft;
    private boolean geladen;
    private String fehler = "";
    /** Ob das Gezeigte aus der Platte kommt und nicht aus dem Netz. */
    private boolean ausSpeicher;
    private String speicherAlter = "";
    private String anbieterSignatur = "";

    public Kalender(Context context, Kern kern, Beobachter beobachter) {
        this.context = context.getApplicationContext();
        this.kern = kern;
        this.beobachter = beobachter;
    }

    /**
     * Was beim letzten Mal vorlag.
     *
     * <p>Wird beim Start gerufen, bevor irgendetwas geholt wird. Ohne diesen
     * Schritt stuende die Reihe bei einem Start ohne Netz leer da, obwohl die
     * Woche auf der Platte liegt.
     */
    public void vorladen() {
        Zwischenspeicher.Eintrag abgelegt = Zwischenspeicher.lesen(context, SPEICHER);
        if (abgelegt == null) return;
        try {
            woche = new JSONObject(abgelegt.inhalt);
            geladen = true;
            ausSpeicher = true;
            speicherAlter = abgelegt.alter();
            Log.i(TAG, "Kalender aus der Ablage: " + eintraege().size() + " Eintraege ("
                + speicherAlter + ")");
        } catch (Exception ausnahme) {
            Log.e(TAG, "Abgelegter Kalender unlesbar", ausnahme);
        }
    }

    /**
     * Die eingeschalteten Anbieter nachreichen.
     *
     * <p>Aendert sich die Liste, ist die gehaltene Woche veraltet: ein neu
     * eingeschalteter Anbieter hat seinen eigenen Kalender.
     */
    public void anbieterSetzen(List<Provider> anbieter) {
        if (kern == null || !kern.istBereit()) return;
        JSONArray liste = new JSONArray();
        StringBuilder signatur = new StringBuilder();
        for (Provider provider : anbieter) {
            liste.put(provider.alsJson());
            signatur.append(provider.id).append(',');
        }
        if (signatur.toString().equals(anbieterSignatur)) return;
        anbieterSignatur = signatur.toString();
        kern.rufe("kalender-bruecke.anbieterSetzen", Kern.args(liste), (wert, ausfall) -> {
            if (ausfall != null) Log.e(TAG, "Kalender-Anbieter nicht gesetzt: " + ausfall);
        });
        // Was gehalten wurde, gehoert zu einer anderen Anbieterliste - aber nur
        // verwerfen, wenn schon einmal etwas geholt wurde. Beim ersten Setzen
        // waere es der frisch geladene Speicherstand.
        if (!ausSpeicher) {
            geladen = false;
            stand = 0;
        }
    }

    /**
     * Holen, falls noetig.
     *
     * <p>"Falls noetig" ist der Punkt: die Startseite ruft das bei jedem
     * Zeichnen auf. Geholt wird nur, wenn nichts da ist oder das Gehaltene alt
     * ist - und nie zweimal gleichzeitig.
     */
    public void anfordern(boolean erzwingen) {
        if (kern == null || !kern.istBereit() || laeuft) return;
        // Der Zeitpunkt entscheidet, nicht die Herkunft. Ein Stand von der
        // Platte traegt keinen (stand = 0) und wird deshalb einmal nachgefasst;
        // danach steht einer da, auch wenn nichts hereinkam. Ohne das Letzte
        // fragt die Startseite, zeichnet auf die Antwort hin neu, fragt wieder -
        // und ein Telefon ohne Empfang holt in einer Tour Anbieterseiten, die
        // es nicht erreicht.
        long frist = ausSpeicher ? ALT_FRISCH_MS : FRISCH_MS;
        if (!erzwingen && geladen && System.currentTimeMillis() - stand < frist) return;
        laeuft = true;
        fehler = "";
        kern.rufe("kalender-bruecke.laden", Kern.args(erzwingen), (wert, ausfall) -> {
            laeuft = false;
            geladen = true;
            stand = System.currentTimeMillis();
            if (ausfall != null) {
                // Bleibt etwas aus der Ablage stehen, ist das kein Fehlerfall
                // fuer den Benutzer: er sieht die letzte Woche mit einem
                // Hinweis. Nur wenn gar nichts da ist, wird es einer.
                fehler = ausfall;
                Log.e(TAG, "Kalender nicht geholt: " + ausfall);
                melden();
                return;
            }
            try {
                JSONObject neu = new JSONObject(wert == null ? "{}" : wert);
                JSONArray liste = neu.optJSONArray("entries");
                if (liste == null || liste.length() == 0) {
                    // Nichts gefunden. Wenn etwas Altes dasteht, bleibt es
                    // stehen - eine leere Woche ist keine Information.
                    if (woche == null) woche = neu;
                    Log.i(TAG, "Kalender: keine Eintraege");
                    melden();
                    return;
                }
                woche = neu;
                ausSpeicher = neu.optBoolean("ausCache", false);
                speicherAlter = "";
                Zwischenspeicher.ablegen(context, SPEICHER, neu.toString());
                Log.i(TAG, "Kalender: " + liste.length() + " Eintraege");
            } catch (Exception ausnahme) {
                fehler = "Antwort unlesbar";
                Log.e(TAG, "Kalender unlesbar", ausnahme);
            }
            melden();
        });
    }

    private void melden() {
        if (beobachter != null) beobachter.kalenderGeaendert();
    }

    /** Noch einmal versuchen - der Knopf unter einer gescheiterten Reihe. */
    public void erneutVersuchen() {
        geladen = false;
        stand = 0;
        fehler = "";
        anfordern(true);
    }

    public boolean laedt() {
        return laeuft;
    }

    public boolean geladen() {
        return geladen;
    }

    /** Der Fehler - aber nur, wenn auch nichts Altes dasteht. */
    public String fehler() {
        if (!fehler.isEmpty() && eintraege().isEmpty()) return fehler;
        return "";
    }

    /** Ob das Gezeigte von der Platte stammt; dann gehoert sein Alter dazu. */
    public boolean istAlt() {
        return ausSpeicher && !eintraege().isEmpty();
    }

    public String alter() {
        return speicherAlter;
    }

    /** Die Wochentage in ihrer Reihenfolge - Montag zuerst. */
    public List<String> tage() {
        ArrayList<String> liste = new ArrayList<>();
        JSONArray roh = woche == null ? null : woche.optJSONArray("days");
        if (roh == null) return liste;
        for (int i = 0; i < roh.length(); i += 1) liste.add(roh.optString(i, ""));
        return liste;
    }

    /** Das Datum zu einem Wochentag, so wie die Eintraege es nennen. */
    public String datumVon(String tag) {
        JSONObject daten = woche == null ? null : woche.optJSONObject("dates");
        return daten == null ? "" : daten.optString(tag, "");
    }

    public List<Eintrag> eintraege() {
        ArrayList<Eintrag> liste = new ArrayList<>();
        JSONArray roh = woche == null ? null : woche.optJSONArray("entries");
        if (roh == null) return liste;
        for (int i = 0; i < roh.length(); i += 1) {
            JSONObject eintrag = roh.optJSONObject(i);
            if (eintrag != null) liste.add(new Eintrag(eintrag));
        }
        return liste;
    }

    /** Die Eintraege eines Tages. */
    public List<Eintrag> anTag(String tag) {
        ArrayList<Eintrag> liste = new ArrayList<>();
        for (Eintrag eintrag : eintraege()) {
            if (eintrag.tag.equals(tag)) liste.add(eintrag);
        }
        return liste;
    }

    /**
     * Der Tag, mit dem die Ansicht aufmacht.
     *
     * <p>Heute, wenn dort etwas steht - sonst der naechste Tag, an dem etwas
     * kommt. Ein leerer Reiter als Startbild waere die schlechtere Antwort auf
     * "was laeuft diese Woche".
     */
    public String ersterTagMitInhalt() {
        List<String> tage = tage();
        if (tage.isEmpty()) return "";
        String heute = heutigerTag();
        int start = Math.max(0, tage.indexOf(heute));
        for (int i = 0; i < tage.size(); i += 1) {
            String tag = tage.get((start + i) % tage.size());
            if (!anTag(tag).isEmpty()) return tag;
        }
        return tage.get(start);
    }

    static String heutigerTag() {
        java.util.Calendar kalender = java.util.Calendar.getInstance();
        // Calendar zaehlt ab Sonntag; die Liste beginnt am Montag.
        int tag = kalender.get(java.util.Calendar.DAY_OF_WEEK);
        String[] namen = {"Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"};
        return namen[Math.max(0, Math.min(namen.length - 1, tag - 1))];
    }
}
