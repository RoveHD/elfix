package local.elflix.android;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Die Empfehlungen der Startseite - und die Seiten dahinter.
 *
 * <p>Bis hierher hatte die Android-Startseite gar keine: der Empfehlungslauf
 * lag in {@code main.js} und damit hinter Electron. Er liegt jetzt in
 * {@code empfehlungslauf.js} und laeuft im Kern, also mit derselben Rechnung,
 * denselben Schwellen und denselben Begruendungen wie am Rechner. Diese Klasse
 * ist nur die Vermittlung: sie sagt dem Lauf, wer die Anbieter sind und was in
 * der Ablage steht, fragt ihn und haelt die Antworten so lange, wie die
 * Oberflaeche sie braucht.
 *
 * <p>Der Zwischenspeicher hier ist kein zweiter Cache neben dem des Laufs. Er
 * beantwortet eine andere Frage: <em>Muss beim erneuten Zeichnen ueberhaupt
 * gefragt werden?</em> Die Startseite baut sich bei jeder Aenderung neu auf -
 * beim Drehen des Geraets, nach jedem Fortschritt, nach jedem Wechsel auf einen
 * anderen Bildschirm. Ohne ihn liefe je Reihe ein Aufruf in den Kern, und die
 * Reihen stuenden bei jedem Zeichnen erneut als Skelett da.
 *
 * <p>Alles hier laeuft auf dem Hauptthread; der Kern antwortet ebenfalls dort.
 */
public final class Empfehlungen {
    private static final String TAG = CrashReporter.TAG;

    /** Die Arten, fuer die es eine eigene Reihe und eine eigene Seite gibt. */
    public static final String ANIME = "anime";
    public static final String SERIE = "serie";
    public static final String FILM = "film";
    /** Der Schluessel der Reihe "Empfohlen fuer dich" - sie hat keine Art. */
    public static final String FUER_DICH = "";
    /** Der Schluessel der Reihe "Neu bei deinen Anbietern". */
    public static final String NEUES = "neues";

    /**
     * Kleinere Zahlen als am Rechner.
     *
     * <p>Der Kern-WebView traegt neben dem Lauf schon den Werbefilter, und der
     * kostet allein ein paar hundert Megabyte. Ein Pool von viertausend Titeln
     * dazu ist auf einem Telefon nicht die Tiefe wert: gerechnet wird dieselbe
     * Rangfolge, sie endet nur frueher. Wer weiter scrollt, bekommt Nachschub
     * ueber den Katalog-Nachschlag - der laeuft auch hier.
     */
    private static final int POOL_GROESSE = 1200;
    private static final int LISTEN_GROESSE = 900;
    private static final int GENRE_KANDIDATEN = 2000;

    /** So lange gilt eine geholte Reihe als frisch genug, um nicht neu zu fragen. */
    private static final long REIHE_FRISCH_MS = 15 * 60 * 1000L;
    /**
     * Und so lange, wenn das Gezeigte von der Platte stammt.
     *
     * <p>Deutlich kuerzer, aus einem einfachen Grund: ein Stand von der Platte
     * steht nur da, weil gerade nichts Besseres zu haben war. Kommt das Netz
     * zurueck - und auf einem Telefon geschieht das staendig -, soll die Reihe
     * das binnen einer Minute merken und nicht erst nach einer Viertelstunde.
     * Null waere hier falsch: dann fragte jeder Zeichenlauf erneut.
     */
    private static final long ALT_FRISCH_MS = 60 * 1000L;

    /** Eine fertige Antwort und wann sie kam. */
    private static final class Reihe {
        JSONArray eintraege = new JSONArray();
        long stand;
        boolean laeuft;
        boolean geladen;
        String fehler = "";
        /** Ob das Gezeigte von der Platte kommt und nicht aus diesem Lauf. */
        boolean ausSpeicher;
        String alter = "";
    }

    /** Unter welchem Namen eine Reihe auf der Platte liegt. */
    private static String speicherName(String schluessel) {
        return "reihe-" + (schluessel == null || schluessel.isEmpty() ? "fuerdich" : schluessel);
    }

    /** Was eine Entdeckungsseite ueber ihren Stand weiss. */
    public static final class Seite {
        public final JSONArray eintraege;
        public final boolean fertig;
        public final boolean waechst;

        Seite(JSONArray eintraege, boolean fertig, boolean waechst) {
            this.eintraege = eintraege;
            this.fertig = fertig;
            this.waechst = waechst;
        }
    }

    /** Wird gerufen, wenn eine Reihe fertig ist - die Startseite zeichnet dann neu. */
    public interface Beobachter {
        void empfehlungenGeaendert();
    }

    public interface SeitenAntwort {
        void fertig(Seite seite, String fehler);
    }

    private final android.content.Context context;
    private final Kern kern;
    private final Beobachter beobachter;
    private final Map<String, Reihe> reihen = new HashMap<>();

    private boolean gestartet;
    private boolean bereit;
    private String startFehler = "";
    /** Woran der zuletzt gemeldete Stand haengt - aendert er sich, sind die Reihen veraltet. */
    private String standSignatur = "";

    public Empfehlungen(android.content.Context context, Kern kern, Beobachter beobachter) {
        this.context = context == null ? null : context.getApplicationContext();
        this.kern = kern;
        this.beobachter = beobachter;
    }

    /**
     * Was beim letzten Mal in den Reihen stand.
     *
     * <p>Wird beim Start gerufen, bevor der Lauf ueberhaupt aufgesetzt ist. Ohne
     * diesen Schritt stehen bei einem Start ohne Netz alle Vorschlagsreihen als
     * Fehlermeldung da - obwohl sie beim letzten Start vorlagen und nur im
     * Arbeitsspeicher hingen, den Android beim Beenden abraeumt.
     *
     * <p>Was hier hereinkommt, ist ausdruecklich alt: es traegt sein Alter, die
     * Oberflaeche schreibt es dazu, und der erste erfolgreiche Abruf ersetzt es.
     */
    public void vorladen() {
        if (context == null) return;
        int geladeneReihen = 0;
        for (String schluessel : new String[]{NEUES, FUER_DICH, ANIME, SERIE, FILM}) {
            Zwischenspeicher.Eintrag abgelegt =
                Zwischenspeicher.lesen(context, speicherName(schluessel));
            if (abgelegt == null) continue;
            try {
                JSONArray liste = new JSONArray(abgelegt.inhalt);
                if (liste.length() == 0) continue;
                Reihe reihe = new Reihe();
                reihe.eintraege = liste;
                reihe.geladen = true;
                reihe.ausSpeicher = true;
                reihe.alter = abgelegt.alter();
                reihen.put(schluessel, reihe);
                geladeneReihen += 1;
            } catch (Exception ausnahme) {
                Log.e(TAG, "Abgelegte Reihe unlesbar: " + schluessel, ausnahme);
            }
        }
        if (geladeneReihen > 0) Log.i(TAG, "Reihen aus der Ablage: " + geladeneReihen);
    }

    /**
     * Den Lauf im Kern aufsetzen.
     *
     * <p>Einmal je Programmlauf. Vorher liegt der Geschmacks-Cache noch auf der
     * Platte; danach steht er im Kern und die erste Frage kostet keinen
     * einzigen Abruf mehr, den er schon kennt.
     */
    public void vorbereiten(String relayAdresse) {
        if (kern == null || gestartet) return;
        gestartet = true;
        JSONObject vorgaben = new JSONObject();
        try {
            vorgaben.put("geschmackUrl", Kern.DATEI_WIRT + "geschmack.json");
            vorgaben.put("metadatenUrl", Kern.DATEI_WIRT + "metadaten.json");
            vorgaben.put("relay", relayFuerMetadaten(relayAdresse));
            JSONObject grenzen = new JSONObject();
            grenzen.put("poolGroesse", POOL_GROESSE);
            grenzen.put("listenGroesse", LISTEN_GROESSE);
            grenzen.put("genreKandidaten", GENRE_KANDIDATEN);
            vorgaben.put("grenzen", grenzen);
        } catch (Exception fehler) {
            Log.e(TAG, "Empfehlungs-Vorgaben nicht gebaut", fehler);
            return;
        }
        kern.wennBereit(() -> kern.rufe("empfehlung-bruecke.starten", Kern.args(vorgaben),
            (wert, fehler) -> {
                if (fehler != null) {
                    startFehler = fehler;
                    Log.e(TAG, "Empfehlungslauf nicht gestartet: " + fehler);
                    if (beobachter != null) beobachter.empfehlungenGeaendert();
                    return;
                }
                bereit = true;
                startFehler = "";
                Log.i(TAG, "Empfehlungslauf bereit: " + wert);
                if (beobachter != null) beobachter.empfehlungenGeaendert();
            }));
    }

    /**
     * Noch einmal versuchen, den Lauf aufzusetzen.
     *
     * <p>Der erste Versuch kann scheitern, ohne dass etwas kaputt waere - der
     * Kern-WebView kann beim Start gestorben sein, oder der Geschmacks-Cache
     * war unlesbar. Ein Fehler ohne Ausweg waere hier eine Sackgasse: die
     * Empfehlungen blieben bis zum naechsten Programmstart weg.
     */
    public void erneutStarten(String relayAdresse) {
        gestartet = false;
        startFehler = "";
        reihenVerwerfen();
        vorbereiten(relayAdresse);
    }

    /**
     * Die Adresse des Relays, in der Form, die {@code metadaten.js} erwartet.
     *
     * <p>Dieselbe Ableitung wie am Rechner: eingestellt wird die
     * Watchparty-Adresse, und das ist dieselbe Maschine - nur das andere
     * Protokoll. Eine zweite Einstellung waere eine zweite Fehlerquelle.
     */
    static String relayFuerMetadaten(String roh) {
        String text = roh == null ? "" : roh.trim();
        if (text.isEmpty()) return "";
        if (!text.matches("(?i)^[a-z]+://.*")) text = "https://" + text;
        text = text.replaceFirst("(?i)^ws:", "http:").replaceFirst("(?i)^wss:", "https:");
        return text.replaceAll("/+$", "");
    }

    /**
     * Anbieter und Ablage in den Kern reichen.
     *
     * <p>Aendert sich dabei etwas, das den Geschmack beruehrt, sind die
     * gehaltenen Reihen veraltet - dann wird beim naechsten Zeichnen neu
     * gefragt. Der Lauf selbst entscheidet danach noch einmal, ob wirklich neu
     * zu rechnen ist (siehe {@code verlaufSignatur}); ohne diese Vorstufe
     * bliebe hier aber die alte Antwort stehen.
     */
    public void standSetzen(List<Provider> anbieter, JSONArray ablage) {
        if (kern == null || !bereit) return;
        JSONArray anbieterJson = new JSONArray();
        StringBuilder signatur = new StringBuilder();
        for (Provider provider : anbieter) {
            anbieterJson.put(provider.alsJson());
            signatur.append(provider.id).append(',');
        }
        signatur.append('#').append(signaturVon(ablage));
        // Nichts Wesentliches geaendert: dann auch nichts hinueberschicken. Der
        // Aufruf traegt die ganze Ablage als Text ueber die Bruecke, und die
        // Startseite zeichnet sich oft neu - bei einer grossen Mediathek waeren
        // das bei jedem Zeichnen ein paar hundert Kilobyte fuer nichts.
        if (signatur.toString().equals(standSignatur)) return;
        standSignatur = signatur.toString();
        kern.rufe("empfehlung-bruecke.standSetzen", Kern.args(anbieterJson, ablage), (wert, fehler) -> {
            if (fehler != null) Log.e(TAG, "Stand nicht gesetzt: " + fehler);
        });
        // Was gehalten wurde, gehoert zu einem anderen Stand.
        reihenVerwerfen();
    }

    /**
     * Woran haengt die Gueltigkeit der Reihen?
     *
     * <p>Nur an dem, was den Geschmack wirklich veraendert - abgeschlossen,
     * gemerkt, geschaut, ganze Zehntel Fortschritt. Nicht an jeder Sekunde
     * Wiedergabezeit: sonst gaelten die Reihen waehrend des Schauens im
     * Sekundentakt als veraltet, und die Startseite fragte den Kern in einer
     * Tour. Dieselbe Ueberlegung wie {@code verlaufSignatur} im Lauf.
     */
    private static String signaturVon(JSONArray ablage) {
        if (ablage == null) return "";
        StringBuilder text = new StringBuilder();
        for (int i = 0; i < ablage.length(); i += 1) {
            JSONObject eintrag = ablage.optJSONObject(i);
            if (eintrag == null) continue;
            text.append(eintrag.optString("id")).append('.')
                .append(eintrag.optBoolean("completed") ? 1 : 0)
                .append(eintrag.optBoolean("watched") ? 1 : 0)
                .append(eintrag.optBoolean("favorite") ? 1 : 0)
                .append((int) (eintrag.optDouble("progress", 0) / 10))
                .append('|');
        }
        return text.toString();
    }


    /**
     * Die gehaltenen Reihen verwerfen - bis auf die von der Platte.
     *
     * <p>Der Unterschied zu {@code reihen.clear()} ist der Offline-Start. Was
     * von der Platte kam, gehoert zu keinem Lauf und wird durch einen neuen
     * Stand nicht falsch: es ist die Reihe von gestern, und sie steht ohnehin
     * nur da, bis das Netz etwas Besseres liefert. Wer sie hier mit wegwirft,
     * hat auf einem Telefon ohne Empfang eine leere Startseite - und genau das
     * war der Fall.
     */
    private void reihenVerwerfen() {
        Map<String, Reihe> behalten = new HashMap<>();
        for (Map.Entry<String, Reihe> eintrag : reihen.entrySet()) {
            Reihe reihe = eintrag.getValue();
            if (reihe != null && reihe.ausSpeicher && reihe.eintraege.length() > 0) {
                // Nicht mehr als geholt zaehlen: der naechste Zeichenlauf soll
                // fragen, aber die Karten bis dahin stehen lassen.
                reihe.laeuft = false;
                reihe.stand = 0;
                behalten.put(eintrag.getKey(), reihe);
            }
        }
        reihen.clear();
        reihen.putAll(behalten);
    }

    public boolean istBereit() {
        return bereit;
    }

    public String startFehler() {
        return startFehler;
    }

    /* --------------------------------------------------------- Die Reihen */

    /**
     * Was in einer Reihe steht.
     *
     * @param schluessel {@link #NEUES}, {@link #FUER_DICH}, {@link #ANIME},
     *                   {@link #SERIE} oder {@link #FILM}
     */
    public List<JSONObject> eintraege(String schluessel) {
        ArrayList<JSONObject> liste = new ArrayList<>();
        Reihe reihe = reihen.get(schluessel);
        if (reihe == null) return liste;
        for (int i = 0; i < reihe.eintraege.length(); i += 1) {
            JSONObject eintrag = reihe.eintraege.optJSONObject(i);
            if (eintrag != null) liste.add(eintrag);
        }
        return liste;
    }

    /**
     * Eine gescheiterte Reihe noch einmal versuchen.
     *
     * <p>Sie gilt danach als nie geholt - sonst haelt sie {@link #anfordern}
     * fuer frisch genug und faengt gar nicht erst an.
     *
     * <p>Was dabei <em>nicht</em> geschieht: die gezeigten Karten wegwerfen.
     * Wer ohne Netz auf "Erneut versuchen" tippt, hat sonst hinterher weniger
     * vor sich als vorher - die Reihe von gestern wich einem Skelett und dann
     * einer Fehlermeldung. Sie bleibt stehen, bis etwas Besseres da ist.
     */
    public void erneutVersuchen(String schluessel) {
        Reihe reihe = reihen.get(schluessel);
        if (reihe == null || reihe.eintraege.length() == 0) {
            reihen.remove(schluessel);
            return;
        }
        reihe.geladen = false;
        reihe.stand = 0;
        reihe.fehler = "";
    }

    /** Ob diese Reihe gerade noch geholt wird - dann steht dort ein Ladehinweis. */
    public boolean laedt(String schluessel) {
        Reihe reihe = reihen.get(schluessel);
        return reihe != null && reihe.laeuft;
    }

    /** Ob diese Reihe schon einmal fertig wurde - erst danach darf sie leer bleiben. */
    public boolean geladen(String schluessel) {
        Reihe reihe = reihen.get(schluessel);
        return reihe != null && reihe.geladen;
    }

    /**
     * Der Fehler dieser Reihe - aber nur, wenn auch nichts dasteht.
     *
     * <p>Ist ein Stand von der Platte da, hat der Benutzer etwas zu sehen; ihn
     * gegen eine Fehlermeldung zu tauschen, waere ein Rueckschritt. Dass er alt
     * ist, sagt {@link #istAlt} an derselben Stelle.
     */
    public String fehler(String schluessel) {
        Reihe reihe = reihen.get(schluessel);
        if (reihe == null) return "";
        return reihe.eintraege.length() > 0 ? "" : reihe.fehler;
    }

    /** Ob das Gezeigte von der Platte stammt - dann gehoert sein Alter dazu. */
    public boolean istAlt(String schluessel) {
        Reihe reihe = reihen.get(schluessel);
        return reihe != null && reihe.ausSpeicher && reihe.eintraege.length() > 0;
    }

    public String alter(String schluessel) {
        Reihe reihe = reihen.get(schluessel);
        return reihe == null ? "" : reihe.alter;
    }

    /**
     * Eine Reihe holen, falls noetig.
     *
     * <p>"Falls noetig" ist der Punkt: die Startseite ruft das bei jedem
     * Zeichnen auf, und gezeichnet wird oft. Geholt wird nur, wenn die Reihe
     * fehlt oder alt ist - und nie zweimal gleichzeitig.
     */
    public void anfordern(String schluessel, int anzahl) {
        if (!bereit) return;
        Reihe reihe = reihen.get(schluessel);
        if (reihe == null) {
            reihe = new Reihe();
            reihen.put(schluessel, reihe);
        }
        if (reihe.laeuft) return;
        // Frisch ist eine Reihe, die vor weniger als einer Viertelstunde geholt
        // wurde. Ein Stand von der Platte traegt keinen Zeitpunkt (stand = 0)
        // und gilt damit sofort als alt - er wird gezeigt, damit die Reihe
        // nicht leer dasteht, und einmal nachgefasst.
        //
        // "Einmal" ist hier keine Feinheit, sondern die ganze Bedingung: der
        // Zeitpunkt wird auch dann gesetzt, wenn nichts hereinkam. Ohne das
        // fragt die Startseite, bekommt eine Antwort, zeichnet daraufhin neu,
        // fragt wieder - und ein Telefon ohne Empfang schickt in einer Tour
        // Abrufe los, die alle scheitern.
        long frist = reihe.ausSpeicher ? ALT_FRISCH_MS : REIHE_FRISCH_MS;
        if (reihe.geladen && System.currentTimeMillis() - reihe.stand < frist) return;
        reihe.laeuft = true;
        reihe.fehler = "";

        Reihe ziel = reihe;
        Kern.Antwort antwort = (wert, fehler) -> {
            ziel.laeuft = false;
            ziel.geladen = true;
            ziel.stand = System.currentTimeMillis();
            if (fehler != null) {
                ziel.fehler = fehler;
                Log.e(TAG, "Reihe " + schluessel + " nicht geholt: " + fehler);
            } else {
                try {
                    JSONArray frisch = new JSONArray(wert == null ? "[]" : wert);
                    // Eine leere Antwort ersetzt keinen vorhandenen Stand: ohne
                    // Netz kommt der Lauf mit leeren Haenden zurueck, und die
                    // Reihe von gestern ist mehr wert als gar keine.
                    if (frisch.length() > 0 || !ziel.ausSpeicher) {
                        ziel.eintraege = frisch;
                        ziel.ausSpeicher = false;
                        ziel.alter = "";
                        if (context != null && frisch.length() > 0) {
                            Zwischenspeicher.ablegen(context, speicherName(schluessel), frisch.toString());
                        }
                    }
                    // Eine Zeile je fertiger Reihe. Sie kostet nichts und ist
                    // das Einzige, woran sich von aussen ablesen laesst, ob der
                    // Lauf ueberhaupt etwas gefunden hat - eine leere Reihe
                    // sieht auf dem Bildschirm aus wie eine fehlende.
                    Log.i(TAG, "Reihe " + (schluessel.isEmpty() ? "fuerdich" : schluessel)
                        + ": " + ziel.eintraege.length() + " Vorschlaege");
                } catch (Exception ausnahme) {
                    ziel.fehler = "Antwort unlesbar";
                    Log.e(TAG, "Reihe " + schluessel + " unlesbar", ausnahme);
                }
            }
            if (beobachter != null) beobachter.empfehlungenGeaendert();
        };

        if (NEUES.equals(schluessel)) {
            kern.rufe("empfehlung-bruecke.neuesVonAnbietern", Kern.args(anzahl, false), antwort);
            return;
        }
        // Die Kategoriereihen lassen aus, was schon in "Empfohlen fuer dich"
        // steht - genau wie am Rechner, sonst stuende derselbe Titel zweimal
        // auf der Startseite.
        kern.rufe("empfehlung-bruecke.persoenlich",
            Kern.args(anzahl, schluessel, false, true), antwort);
    }

    /** Alles neu rechnen - der Knopf "Neu berechnen". */
    public void neuBerechnen() {
        if (!bereit) return;
        // Hier faellt auch der Stand von der Platte: "Neu berechnen" ist eine
        // ausdrueckliche Ansage, und ein Ergebnis von gestern stehen zu lassen
        // waere das Gegenteil davon.
        if (context != null) {
            for (String schluessel : new String[]{NEUES, FUER_DICH, ANIME, SERIE, FILM}) {
                Zwischenspeicher.loeschen(context, speicherName(schluessel));
            }
        }
        reihen.clear();
        kern.rufe("empfehlung-bruecke.poolVerwerfen", (wert, fehler) -> {
            if (beobachter != null) beobachter.empfehlungenGeaendert();
        });
    }

    /**
     * Eine Seite der Entdeckungsansicht.
     *
     * <p>Anders als die Reihen wird sie nicht gehalten: die Ansicht selbst
     * fuehrt ihre Liste, weil nur sie weiss, wie weit gescrollt wurde.
     */
    public void seite(String art, int versatz, int anzahl, SeitenAntwort antwort) {
        if (!bereit) {
            antwort.fertig(null, startFehler.isEmpty()
                ? "Die Empfehlungen sind noch nicht bereit." : startFehler);
            return;
        }
        kern.rufe("empfehlung-bruecke.entdeckungsSeite", Kern.args(art, versatz, anzahl, false),
            (wert, fehler) -> {
                if (fehler != null) {
                    antwort.fertig(null, fehler);
                    return;
                }
                try {
                    JSONObject ergebnis = new JSONObject(wert == null ? "{}" : wert);
                    JSONArray eintraege = ergebnis.optJSONArray("items");
                    antwort.fertig(new Seite(eintraege == null ? new JSONArray() : eintraege,
                        ergebnis.optBoolean("fertig", false),
                        ergebnis.optBoolean("waechst", false)), null);
                } catch (Exception ausnahme) {
                    antwort.fertig(null, "Antwort unlesbar");
                }
            });
    }

    /**
     * Ein Vorschlag wurde geoeffnet.
     *
     * <p>Dann war er offenbar doch interessant, und seine Muedigkeitszaehlung
     * faengt von vorn an - dieselbe Stelle wie {@code did-navigate} am Rechner.
     */
    public void geoeffnet(String url, String titel, String art) {
        if (!bereit) return;
        kern.rufe("empfehlung-bruecke.vergissMuedigkeit",
            Kern.args(url == null ? "" : url, titel == null ? "" : titel, art == null ? "" : art),
            (wert, fehler) -> {
                if (fehler != null) Log.e(TAG, "Muedigkeit nicht zurueckgesetzt: " + fehler);
            });
    }

    /** Der Kern hat gemeldet, dass sich etwas gerechnet hat. */
    public void kernMeldung() {
        reihenVerwerfen();
        if (beobachter != null) beobachter.empfehlungenGeaendert();
    }
}
