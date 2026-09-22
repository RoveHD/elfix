package local.elflix.android;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * Alles, was ELFIX sich gemerkt hat - und die einzige Stelle, die es aendert.
 *
 * <p>Watchlist, Weiterschauen, Mediathek und Verlauf sind vier Blicke auf
 * dieselbe Liste. Welcher Eintrag wohin gehoert, entscheidet nicht diese
 * Klasse, sondern die geteilte Regel im {@link Kern} - dieselbe, die am Desktop
 * laeuft. Hier steht nur, wie die Antwort in die Ablage kommt und wer davon
 * erfaehrt.
 *
 * <p>Die Trennung ist der Grund, warum sich der Stand ueberhaupt abgleichen
 * laesst: beide Geraete kommen bei derselben Wiedergabe zum selben Eintrag,
 * weil beide dieselbe Funktion fragen.
 */
public final class Bestand {
    private static final String TAG = CrashReporter.TAG;

    /** Wird gerufen, wenn sich etwas geaendert hat - die Oberflaeche zeichnet dann neu. */
    public interface Beobachter {
        void bestandGeaendert();
    }

    /** Etwas, das dem Benutzer zu sagen waere. */
    public interface Melder {
        void melde(String text);
    }

    /** Wohin ein frisch verbuchter Stand zusaetzlich gehoert - die Watchparty. */
    public interface StandMelder {
        void melde(JSONObject eintrag);
    }

    /**
     * Wer ausserdem erfaehrt, dass gerade etwas lief - die gemessene Zeit.
     *
     * <p>Getrennt vom {@link StandMelder}, weil es etwas anderes meldet: der
     * dort geht der <em>Stand</em> hinaus, hier die <em>Wiedergabe</em>. Am
     * Rechner steht an genau dieser Stelle der Aufruf von {@code sitzungMelden},
     * und zwar erst nach der Regel: gezaehlt wird nur, was auch als Fortschritt
     * durchgegangen ist.
     */
    public interface Sitzungsmelder {
        void melde(Provider provider, String url, JSONObject eintrag, JSONObject fortschritt);
    }

    interface KernZugang {
        boolean istBereit();
        void wennBereit(Runnable aufgabe);
        void rufe(String pfad, JSONArray argumente, Kern.Antwort antwort);
        void rufe(String pfad, Kern.Antwort antwort);
    }

    interface Ablage {
        JSONArray laden();
        void speichern(JSONArray eintraege);
    }

    private final KernZugang kern;
    private final Ablage ablage;
    private final Beobachter beobachter;
    private final Melder melder;

    private JSONArray eintraege = new JSONArray();
    /** Welcher Eintrag gerade geoeffnet ist - entscheidet bei mehrfach vorhandenen Titeln. */
    private String aktiverEintragId = "";
    /**
     * Der kanonische Schluessel je Eintrag - Kennung auf Werk.
     *
     * <p>Die Listen werden synchron gezeichnet und koennen nicht je Zeile auf
     * eine Antwort aus dem Kern warten. Gerechnet wird der Schluessel trotzdem
     * dort ({@code watchlist.js}); hier liegt nur das Ergebnis. Ein Nachbau in
     * Java waere die zweite Antwort auf "welcher Titel ist das?", und genau
     * daran ist die Watchlist zerfallen.
     */
    private java.util.Map<String, String> werkeNachId = new java.util.HashMap<>();
    /**
     * Woran erkannt wird, dass sich die Zusammensetzung der Ablage geaendert
     * hat.
     *
     * <p>Die Kennungen, aneinandergereiht - nicht der Inhalt. Fortschritt
     * meldet sich im Sekundentakt und aendert Staende, aber keine Werke; nur
     * wenn Eintraege dazukommen oder verschwinden, muss der Kern noch einmal
     * gefragt werden.
     */
    private String werkeAbdruck = "";
    /**
     * Das Werk der gerade offenen Seite.
     *
     * <p>Beim Seitenwechsel einmal bestimmt, wie {@link #aktiverEintragId} -
     * und getrennt von ihm. Der Fortschritt gehoert dem aktiven Eintrag, und
     * das ist waehrend einer Watchparty der des Raums. Die Watchlist ist
     * dagegen die private Liste, und der Herz-Knopf muss sie meinen.
     */
    private String offenesWerk = "";
    private StandMelder standMelder;
    private Sitzungsmelder sitzungsmelder;
    /**
     * Die zuletzt gemeldete Art von Diagnose.
     *
     * <p>Die Messung meldet alle fuenf Sekunden. Ohne diesen Merker stuende
     * dieselbe Zeile zwoelfmal in der Minute im Protokoll und man saehe vor
     * lauter Wiederholung die Aenderung nicht.
     */
    private String letzteDiagnose = "";
    /** Eine laufende Pruefung reicht; Aenderungen waehrenddessen bekommen einen Nachlauf. */
    private boolean nachschubBereinigungLaeuft;
    private boolean nachschubBereinigungErneut;
    /** Fortschrittsaufrufe ersetzen ganze Listen und muessen deshalb nacheinander laufen. */
    private final FortschrittReihe<FortschrittsMeldung> fortschrittReihe =
        new FortschrittReihe<>();
    /** Geraete-Deltas derselben Kennung muessen in Serverreihenfolge ankommen. */
    private final FortschrittReihe<JSONObject> geraeteAenderungenReihe =
        new FortschrittReihe<>();
    private boolean geraeteAenderungenWartenAufKern;
    private int geraeteAenderungenFehlversuche;
    private Runnable geraeteFortsetzung;
    /** Aendert sich bei jeder dauerhaften Mutation, auch bei einem Geraeteabgleich. */
    private long bestandRevision;

    private static final class FortschrittsMeldung {
        final Provider provider;
        final String url;
        final JSONObject meta;
        final boolean watchpartyFuehrt;
        final String aktiverEintragId;
        final String zielUrlBeimMessen;

        FortschrittsMeldung(Provider provider, String url, JSONObject meta,
                            boolean watchpartyFuehrt, String aktiverEintragId,
                            String zielUrlBeimMessen) {
            this.provider = provider;
            this.url = url;
            this.meta = meta;
            this.watchpartyFuehrt = watchpartyFuehrt;
            // Der Ziel-Eintrag gehoert zum Messzeitpunkt. Ein spaeterer
            // Folgenwechsel darf eine wartende Messung nicht in den dann
            // offenen privaten oder Raum-Eintrag umlenken.
            this.aktiverEintragId = aktiverEintragId;
            this.zielUrlBeimMessen = zielUrlBeimMessen;
        }
    }

    public Bestand(Context context, Kern kern, Beobachter beobachter, Melder melder) {
        this(kernZugang(kern), dateiAblage(context.getApplicationContext()), beobachter, melder);
    }

    Bestand(KernZugang kern, Ablage ablage, Beobachter beobachter, Melder melder) {
        this.kern = kern;
        this.ablage = ablage;
        this.beobachter = beobachter;
        this.melder = melder;
    }

    private static KernZugang kernZugang(Kern kern) {
        return new KernZugang() {
            @Override public boolean istBereit() { return kern != null && kern.istBereit(); }
            @Override public void wennBereit(Runnable aufgabe) {
                if (kern != null) kern.wennBereit(aufgabe);
            }
            @Override public void rufe(String pfad, JSONArray argumente, Kern.Antwort antwort) {
                if (kern != null) kern.rufe(pfad, argumente, antwort);
            }
            @Override public void rufe(String pfad, Kern.Antwort antwort) {
                if (kern != null) kern.rufe(pfad, antwort);
            }
        };
    }

    private static Ablage dateiAblage(Context context) {
        return new Ablage() {
            @Override public JSONArray laden() { return FavoriteStore.ladeRoh(context); }
            @Override public void speichern(JSONArray eintraege) {
                FavoriteStore.speichereRoh(context, eintraege);
            }
        };
    }

    /**
     * Wohin ein verbuchter Stand ausserdem geht.
     *
     * <p>Genau eine Stelle: die Watchparty. Am Rechner steht dafuer ein Aufruf
     * am Ende von recordMediaActivity; hier haengt er an derselben Stelle,
     * damit gemeldet wird, was wirklich abgelegt wurde - und nicht das, was
     * gemessen wurde.
     */
    public void setzeStandMelder(StandMelder melder) {
        this.standMelder = melder;
    }

    /** Wer die gemessene Wiedergabezeit mitschreibt. Siehe {@link Sitzungsmelder}. */
    public void setzeSitzungsmelder(Sitzungsmelder melder) {
        this.sitzungsmelder = melder;
    }

    public void laden() {
        eintraege = ablage.laden();
        Log.i(TAG, "Bestand geladen: " + eintraege.length() + " Eintraege");
        werkeAuffrischen();
    }

    /**
     * Doppelte Eintraege desselben Werks zusammenfuehren.
     *
     * <p>Dieselbe Bereinigung, die der Rechner beim Laden faehrt, und
     * ausdruecklich dieselbe Regel: sie steht in {@code src/watchlist.js} und
     * laeuft hier im Kern. Ein Nachbau in Java waere eine zweite Vorstellung
     * davon, wann zwei Eintraege denselben Titel meinen - und genau davon kamen
     * die Doppelten.
     *
     * <p>Laeuft einmal nach dem Start, sobald der Kern bereit ist. Sie tut nur
     * dann etwas, wenn wirklich zwei Eintraege dasselbe Werk meinen, und fuehrt
     * dann zusammen statt zu loeschen: Verlauf, abgeschlossene Folgen, eigenes
     * Bild und Serienlaenge gehen mit.
     */
    public void doppelteZusammenfuehren() {
        if (kern == null || !kern.istBereit()) return;
        final long ausgangsRevision = bestandRevision;
        JSONArray argumente = new JSONArray();
        argumente.put(eintraege);
        kern.rufe("watchlist.doppelteZusammenfuehren", argumente, (wert, fehler) -> {
            if (fehler != null || wert == null) return;
            if (bestandRevision != ausgangsRevision) {
                doppelteZusammenfuehren();
                return;
            }
            try {
                JSONObject urteil = new JSONObject(wert);
                if (urteil.optInt("zusammengefuehrt", 0) <= 0) return;
                JSONArray bereinigt = urteil.optJSONArray("favoriten");
                if (bereinigt == null) return;
                eintraege = bereinigt;
                Log.i(TAG, "Bestand: " + urteil.optInt("zusammengefuehrt", 0)
                    + " doppelte Eintraege zusammengefuehrt");
                speichern();
                werkeAuffrischen();
                if (beobachter != null) beobachter.bestandGeaendert();
            } catch (Exception ausnahme) {
                Log.e(TAG, "Zusammenfuehren fehlgeschlagen", ausnahme);
            }
        });
    }

    public void speichern() {
        bestandRevision += 1;
        ablage.speichern(eintraege);
        // Kostet einen Zeichenvergleich; der Aufruf in den Kern geht nur
        // hinaus, wenn wirklich Eintraege dazugekommen oder verschwunden sind.
        werkeAuffrischen();
        nachschubHinweiseBereinigen();
    }

    /**
     * Entfernt Nachschubhinweise, deren Folge schon auf diesem Konto gesehen
     * wurde. Die Entscheidung liegt im gemeinsamen Modul: nur es kann eigene
     * und gleichgeschaltete Fortschritte zusammen betrachten.
     *
     * <p>Die Antwort ist absichtlich kein Ersatz fuer die ganze Liste. Ein
     * Fortschritt oder Geraeteabgleich kann waehrend der Anfrage einen Eintrag
     * veraendern; geloescht wird deshalb nur, wenn Kennung, Adresse und der
     * noch sichtbare Hinweisstempel unveraendert zusammenpassen.
     */
    public void nachschubHinweiseBereinigen() {
        if (kern == null || !kern.istBereit()) return;
        if (nachschubBereinigungLaeuft) {
            nachschubBereinigungErneut = true;
            return;
        }
        boolean hatHinweis = false;
        for (int i = 0; i < eintraege.length(); i += 1) {
            JSONObject eintrag = eintraege.optJSONObject(i);
            if (eintrag != null && !eintrag.optString("newEpisodeAt", "").isEmpty()) {
                hatHinweis = true;
                break;
            }
        }
        if (!hatHinweis) return;

        nachschubBereinigungLaeuft = true;
        nachschubBereinigungErneut = false;
        kern.rufe("geraete-stand.geseheneNachschubHinweise", Kern.args(eintraege), (wert, fehler) -> {
            boolean geaendert = false;
            try {
                if (fehler == null && wert != null) {
                    JSONArray gesehen = new JSONArray(wert);
                    for (int i = 0; i < gesehen.length(); i += 1) {
                        JSONObject hinweis = gesehen.optJSONObject(i);
                        if (hinweis == null) continue;
                        JSONObject aktuell = rohMitId(hinweis.optString("id", ""));
                        if (aktuell == null) continue;
                        String url = hinweis.optString("url", "");
                        String stempel = hinweis.optString("newEpisodeAt", "");
                        if (url.isEmpty() || stempel.isEmpty()
                            || !url.equals(aktuell.optString("url", ""))
                            || !stempel.equals(aktuell.optString("newEpisodeAt", ""))) continue;
                        aktuell.put("newEpisodeAt", "");
                        aktuell.put("newEpisodeLabel", "");
                        geaendert = true;
                    }
                } else if (fehler != null) {
                    Log.d(TAG, "Nachschubhinweise nicht bereinigt: " + fehler);
                }
            } catch (Exception ausnahme) {
                Log.e(TAG, "Nachschubhinweise unlesbar", ausnahme);
            } finally {
                nachschubBereinigungLaeuft = false;
                boolean nachlauf = nachschubBereinigungErneut;
                nachschubBereinigungErneut = false;
                if (geaendert) {
                    // Absichtlich ohne speichern(): das wuerde dieselbe
                    // Bereinigung sofort wieder anwerfen. Fuer laufende
                    // Snapshot-Aufrufe ist es trotzdem eine echte Mutation.
                    bestandRevision += 1;
                    ablage.speichern(eintraege);
                    werkeAuffrischen();
                    if (beobachter != null) beobachter.bestandGeaendert();
                }
                if (nachlauf) nachschubHinweiseBereinigen();
            }
        });
    }

    /** Die Kennungen aneinandergereiht - der Abdruck der Zusammensetzung. */
    private String idsAbdruck() {
        StringBuilder bau = new StringBuilder(eintraege.length() * 8);
        for (int i = 0; i < eintraege.length(); i += 1) {
            JSONObject eintrag = eintraege.optJSONObject(i);
            if (eintrag != null) bau.append(eintrag.optString("id", "")).append(',');
        }
        return bau.toString();
    }

    /**
     * Die Werkschluessel nachziehen, wenn sich die Ablage zusammengesetzt hat.
     *
     * <p>Ein Aufruf in den Kern, und nur dann, wenn wirklich Eintraege
     * dazugekommen oder verschwunden sind. Waehrend der Wiedergabe aendern sich
     * Staende, nicht Werke - dort passiert hier nichts.
     */
    public void werkeAuffrischen() {
        if (kern == null || !kern.istBereit()) return;
        String abdruck = idsAbdruck();
        if (abdruck.equals(werkeAbdruck)) return;
        werkeAbdruck = abdruck;
        kern.rufe("watchlist.schluesselJeEintrag", Kern.args(eintraege), (wert, fehler) -> {
            if (fehler != null || wert == null) return;
            try {
                JSONObject karte = new JSONObject(wert);
                java.util.HashMap<String, String> neu = new java.util.HashMap<>();
                for (java.util.Iterator<String> namen = karte.keys(); namen.hasNext(); ) {
                    String id = namen.next();
                    neu.put(id, karte.optString(id, ""));
                }
                werkeNachId = neu;
                if (beobachter != null) beobachter.bestandGeaendert();
            } catch (Exception ausnahme) {
                Log.e(TAG, "Werkschluessel unlesbar", ausnahme);
            }
        });
    }

    /** Das Werk eines Eintrags, oder "" solange der Kern noch nicht geantwortet hat. */
    public String werkVon(Favorite eintrag) {
        if (eintrag == null) return "";
        String schluessel = werkeNachId.get(eintrag.id());
        return schluessel == null ? "" : schluessel;
    }

    /** Das Werk der offenen Seite - siehe {@link #offenesWerk}. */
    public String offenesWerk() {
        return offenesWerk;
    }

    public String aktiverEintragId() {
        return aktiverEintragId;
    }

    public void setzeAktivenEintrag(String id) {
        aktiverEintragId = id == null ? "" : id;
    }

    /* ------------------------------------------------------------- Ansichten */

    public List<Favorite> alle() {
        ArrayList<Favorite> liste = new ArrayList<>(eintraege.length());
        for (int i = 0; i < eintraege.length(); i += 1) {
            JSONObject roh = eintraege.optJSONObject(i);
            if (roh != null) liste.add(new Favorite(roh));
        }
        return liste;
    }

    /**
     * Weiterschauen: was angefangen und nicht abgeschlossen ist.
     *
     * <p>Sortiert nach dem letzten Mal, dass wirklich etwas lief - nicht nach
     * dem letzten Oeffnen. Sonst schoebe ein versehentlicher Klick einen Titel
     * nach vorn, den man gar nicht geschaut hat.
     */
    public List<Favorite> weiterschauen() {
        ArrayList<Favorite> liste = new ArrayList<>();
        for (Favorite eintrag : alle()) {
            if (eintrag.stehtInWeiterschauen()) liste.add(eintrag);
        }
        Collections.sort(liste, Comparator.comparingLong(Favorite::zeitstempel).reversed());
        return liste;
    }

    /**
     * Die Merkliste: gemerkt, aber noch nicht durch - und je Werk einmal.
     *
     * <p>Nur private Eintraege. Ein Eintrag einer Watchparty-Runde gehoert dem
     * Raum und nie der eigenen Merkliste; stand er trotzdem darauf (der
     * Herz-Knopf konnte das, solange er den *aktiven* Eintrag vormerkte, und
     * waehrend einer Runde ist das der des Raums), erschien derselbe Titel
     * zweimal.
     *
     * <p>Die Entdoppelung darueber hinaus macht {@code watchlist.js} beim
     * Laden. Hier wird nichts nach Namen gefiltert - zwei Titel koennen gleich
     * heissen und verschiedene Werke sein.
     */
    public List<Favorite> watchlist() {
        ArrayList<Favorite> liste = new ArrayList<>();
        for (Favorite eintrag : alle()) {
            if (!eintrag.watchpartyRaum().isEmpty()) continue;
            if (eintrag.istWatchlist() && !eintrag.istAbgeschlossen()) liste.add(eintrag);
        }
        return liste;
    }

    /**
     * Die Mediathek: was durch ist - und je Werk einmal.
     *
     * <p>Denselben Titel gibt es absichtlich mehrfach: den eigenen Eintrag und
     * je Watchparty-Runde einen. Auf der Startseite ist das getrennt, hier
     * nicht: die Mediathek zeigt das Werk und nicht den Raum, in dem man es
     * geschaut hat. Ohne diese Zusammenlegung stand derselbe Film zweimal da -
     * am Rechner war das laengst behoben, hier nicht.
     *
     * <p>Uebrig bleibt der private Eintrag: er traegt die von Hand gelegte
     * Stelle und die laengere Geschichte. Gibt es nur einen aus einer Runde,
     * steht eben der da. Dieselbe Wahl wie in {@code istBessererMediathekEintrag}
     * am Rechner.
     */
    public List<Favorite> mediathek() {
        java.util.LinkedHashMap<String, Favorite> nachWerk = new java.util.LinkedHashMap<>();
        ArrayList<Favorite> ohneSchluessel = new ArrayList<>();
        for (Favorite eintrag : alle()) {
            if (!eintrag.istAbgeschlossen()) continue;
            String werk = werkVon(eintrag);
            // Ohne Schluessel wird nichts zusammengelegt - lieber eine Karte zu
            // viel als zwei verschmolzene, die nichts miteinander zu tun haben.
            if (werk.isEmpty()) { ohneSchluessel.add(eintrag); continue; }
            Favorite bisher = nachWerk.get(werk);
            if (bisher == null || istBesserFuerMediathek(eintrag, bisher)) nachWerk.put(werk, eintrag);
        }
        ArrayList<Favorite> liste = new ArrayList<>(nachWerk.values());
        liste.addAll(ohneSchluessel);
        return liste;
    }

    private static boolean istBesserFuerMediathek(Favorite neu, Favorite bisher) {
        boolean neuPrivat = neu.watchpartyRaum().isEmpty();
        boolean bisherPrivat = bisher.watchpartyRaum().isEmpty();
        if (neuPrivat != bisherPrivat) return neuPrivat;
        // Beide gleich privat: der aeltere hat die laengere Geschichte hinter
        // sich.
        return neu.createdAt().compareTo(bisher.createdAt()) < 0;
    }

    /** Der Verlauf: alles, in der Reihenfolge der Ablage - die ist bereits die zeitliche. */
    public List<Favorite> verlauf() {
        return alle();
    }

    public Favorite mitId(String id) {
        if (id == null || id.isEmpty()) return null;
        for (Favorite eintrag : alle()) {
            if (id.equals(eintrag.id())) return eintrag;
        }
        return null;
    }

    /* ------------------------------------------------------------ Verbuchen */

    /**
     * Meldet, was gerade lief, und laesst die geteilte Regel entscheiden.
     *
     * <p>Genau das ist die Stelle, an der Android und Desktop dasselbe tun:
     * dieselbe Funktion, dieselben Schwellen, dieselbe Entscheidung darueber,
     * ob eine Folge durch ist und wohin der Eintrag rueckt. Was hier
     * zurueckkommt, ist bereits die fertige Liste.
     *
     * @param meta was die Seite gemeldet hat: currentTime, duration, watchedSeconds, title, ...
     */
    public void verbuchen(Provider provider, String url, JSONObject meta, boolean watchpartyFuehrt) {
        if (kern == null || !kern.istBereit() || provider == null || url == null) return;
        JSONObject kopie;
        try {
            kopie = meta == null ? new JSONObject() : new JSONObject(meta.toString());
        } catch (Exception fehler) {
            Log.e(TAG, "Fortschrittsmeldung unlesbar", fehler);
            return;
        }
        JSONObject ziel = rohMitId(aktiverEintragId);
        FortschrittsMeldung meldung = new FortschrittsMeldung(
            provider, url, kopie, watchpartyFuehrt, aktiverEintragId,
            ziel == null ? "" : ziel.optString("url", ""));
        fortschrittReihe.hinzufuegen(meldung, Bestand::gleicheFortschrittsFolge);
        fortschrittStarten();
    }

    private static boolean gleicheFortschrittsFolge(FortschrittsMeldung links,
                                                     FortschrittsMeldung rechts) {
        return links.watchpartyFuehrt == rechts.watchpartyFuehrt
            && links.provider.id.equals(rechts.provider.id)
            && links.url.equals(rechts.url)
            && links.aktiverEintragId.equals(rechts.aktiverEintragId);
    }

    private void fortschrittStarten() {
        FortschrittsMeldung meldung = fortschrittReihe.beginnen();
        if (meldung == null) return;
        // Die Meldung kann einige Millisekunden hinter einer bereits laufenden
        // gewartet haben. Ein zwischenzeitlicher Folgenwechsel ist dann schon
        // vor ihrem ersten Kernaufruf sichtbar und muss ebenso gelten wie ein
        // Wechsel waehrend des Aufrufs.
        if (fortschrittsZielWeitergezogen(meldung)) {
            Log.i(TAG, "Wartende Fortschrittsmeldung nach Folgenwechsel verworfen");
            fortschrittAbschliessen();
            return;
        }
        fortschrittAusfuehren(meldung);
    }

    private void fortschrittAusfuehren(FortschrittsMeldung meldung) {
        final long ausgangsRevision = bestandRevision;
        JSONObject zustand = new JSONObject();
        try {
            zustand.put("favoriten", eintraege);
            zustand.put("aktiverFavoritId", meldung.aktiverEintragId);
            zustand.put("watchpartyFuehrt", meldung.watchpartyFuehrt);
        } catch (Exception fehler) {
            Log.e(TAG, "Zustand liess sich nicht bauen", fehler);
            fortschrittAbschliessen();
            return;
        }
        JSONArray argumente = new JSONArray();
        argumente.put(zustand);
        argumente.put(meldung.provider.alsJson());
        argumente.put(meldung.url);
        argumente.put(meldung.meta);
        argumente.put(new JSONObject());

        kern.rufe("fortschritt.medienStandVerbuchen", argumente, (wert, fehler) -> {
            if (fehler != null) {
                Log.e(TAG, "Fortschritt nicht verbucht: " + fehler);
                fortschrittAbschliessen();
                return;
            }
            // Waehrend der Kern rechnete, kann der Geraeteabgleich oder eine
            // Bedienung den Bestand geaendert haben. Die Antwort beruht dann
            // auf einer alten Gesamtliste. Dieselbe Messung noch einmal auf
            // den aktuellen Stand anwenden, statt die neue Liste zu verlieren.
            if (bestandRevision != ausgangsRevision) {
                if (fortschrittsZielWeitergezogen(meldung)) {
                    Log.i(TAG, "Alte Fortschrittsmeldung nach Folgenwechsel verworfen");
                    fortschrittAbschliessen();
                    return;
                }
                Log.i(TAG, "Fortschritt wird nach Bestandsaenderung neu angewandt");
                fortschrittAusfuehren(meldung);
                return;
            }
            uebernehmen(wert, meldung.provider, meldung.url, meldung.meta,
                meldung.aktiverEintragId);
            fortschrittAbschliessen();
        });
    }

    private void fortschrittAbschliessen() {
        fortschrittReihe.abschliessen();
        fortschrittStarten();
    }

    /**
     * Ein anderer abgeschlossener Vorgang hat denselben Eintrag bereits auf
     * eine andere Folge gezogen. Eine davor gemessene Folge darf dann nicht
     * noch einmal gegen den neuen Stand gerechnet werden. Passt der aktuelle
     * Stand dagegen genau zur gemessenen Adresse, ist dies die neuere Folge
     * selbst und die Messung wird normal wiederholt.
     */
    private boolean fortschrittsZielWeitergezogen(FortschrittsMeldung meldung) {
        if (meldung.aktiverEintragId.isEmpty() || meldung.zielUrlBeimMessen.isEmpty()) return false;
        JSONObject aktuell = rohMitId(meldung.aktiverEintragId);
        if (aktuell == null) return true;
        String aktuelleUrl = aktuell.optString("url", "");
        return !gleicheAdresse(aktuelleUrl, meldung.zielUrlBeimMessen)
            && !gleicheAdresse(aktuelleUrl, meldung.url);
    }

    private static boolean gleicheAdresse(String links, String rechts) {
        String a = links == null ? "" : links.replaceFirst("(?i)^https?://", "").replaceAll("/+$", "");
        String b = rechts == null ? "" : rechts.replaceFirst("(?i)^https?://", "").replaceAll("/+$", "");
        return !a.isEmpty() && a.equalsIgnoreCase(b);
    }

    private void uebernehmen(String ergebnisJson, Provider provider, String url, JSONObject gemeldet,
                             String erwarteterAktiverEintrag) {
        try {
            JSONObject ergebnis = new JSONObject(ergebnisJson);
            JSONArray neueListe = ergebnis.optJSONArray("favoriten");
            JSONObject eintrag = ergebnis.optJSONObject("eintrag");

            JSONArray meldungen = ergebnis.optJSONArray("meldungen");
            if (meldungen != null && melder != null) {
                for (int i = 0; i < meldungen.length(); i += 1) {
                    String text = meldungen.optString(i, "");
                    if (!text.isEmpty()) melder.melde(text);
                }
            }
            // Ohne Eintrag hat die Regel bewusst nichts uebernommen - etwa weil
            // die 2:30 noch nicht um sind. Dann bleibt auch die Ablage, wie sie
            // war; ein Speichern waere hier nur unnoetiges Schreiben.
            //
            // Warum sie nichts uebernommen hat, sagt sie selbst. Am Rechner
            // steht das in der Medien-Diagnose; hier stand es nirgends, und ein
            // Stand, der nicht weiterrueckt, war damit nicht zu erklaeren -
            // man sah die gemessenen Sekunden und danach nichts mehr.
            if (eintrag == null) {
                JSONArray diagnosen = ergebnis.optJSONArray("diagnosen");
                JSONObject erste = diagnosen == null ? null : diagnosen.optJSONObject(0);
                if (erste != null && !erste.optString("art").equals(letzteDiagnose)) {
                    letzteDiagnose = erste.optString("art");
                    Log.i(TAG, "Stand nicht uebernommen (" + letzteDiagnose + "): "
                        + erste.optString("text"));
                }
                return;
            }
            letzteDiagnose = "";

            // Die gemessene Wiedergabezeit festhalten - dieselbe Stelle wie am
            // Rechner, und aus demselben Grund erst hier: gezaehlt wird nur,
            // was die Regel auch als Fortschritt gelten laesst. Die Sekunden
            // entstehen ohnehin, sie wurden bisher nur geprueft und danach
            // weggeworfen.
            if (sitzungsmelder != null) {
                sitzungsmelder.melde(provider, url, eintrag, gemeldet);
            }

            if (neueListe != null) eintraege = neueListe;
            // Eine Antwort gehoert weiterhin in ihren eingefrorenen Eintrag,
            // aber sie darf den inzwischen geoeffneten Titel nicht wieder zum
            // aktiven machen. Sonst wuerden erst die folgenden Messungen auf
            // das falsche private/Room-Ziel gelenkt.
            if (aktiverEintragId.equals(erwarteterAktiverEintrag)) {
                aktiverEintragId = eintrag.optString("id", aktiverEintragId);
            }
            speichern();
            if (standMelder != null) standMelder.melde(eintrag);
            if (beobachter != null) beobachter.bestandGeaendert();
        } catch (Exception fehler) {
            Log.e(TAG, "Ergebnis des Kerns unlesbar", fehler);
        }
    }

    /**
     * Legt einen Eintrag fuer diese Adresse an und setzt ihn auf die Watchlist.
     *
     * <p>Ueber {@code fortschritt.vonHandAnlegen} und nicht ueber die
     * Fortschrittsregel. Der Unterschied ist keine Feinheit, sondern der
     * Unterschied zwischen "tut etwas" und "tut nichts": die Fortschrittsregel
     * verlangt zu Recht Videodaten, sonst fuellte jeder geoeffnete Reiter die
     * Liste. Hier wurde ihr deshalb ein Mindeststand vorgetaeuscht - mit zwei
     * Folgen, die beide falsch waren.
     *
     * <p>Erstens legte sie bei einer Serienuebersicht und bei jeder Folge
     * ausser der ersten gar nichts an: ohne 2:30 Wiedergabe und ohne Folge 1
     * blockiert sie, und der Herz-Knopf tat schlicht nichts. Zweitens trug ein
     * angelegter Eintrag zehn Prozent Fortschritt und stand damit sofort auch
     * in "Weiterschauen" - vorgemerkt und angefangen sind aber zwei
     * verschiedene Dinge.
     *
     * <p>Die neue Regel steht in demselben geteilten Modul und wird am Rechner
     * an derselben Stelle benutzt (siehe {@code favorites:add-result}).
     *
     * @param meta was ueber den Titel bekannt ist: title, thumbnail, type
     */
    public void anlegenUndMerken(Provider provider, String url, JSONObject meta, Runnable danach) {
        if (kern == null || !kern.istBereit() || provider == null || url == null) return;
        final long ausgangsRevision = bestandRevision;
        JSONObject zustand = new JSONObject();
        try {
            zustand.put("favoriten", eintraege);
            zustand.put("aktiverFavoritId", aktiverEintragId);
        } catch (Exception fehler) {
            Log.e(TAG, "Eintrag liess sich nicht anlegen", fehler);
            return;
        }
        kern.rufe("fortschritt.vonHandAnlegen",
            Kern.args(zustand, provider.alsJson(), url, meta == null ? new JSONObject() : meta),
            (wert, fehler) -> {
                if (fehler != null) {
                    Log.e(TAG, "Eintrag nicht angelegt: " + fehler);
                    if (melder != null) melder.melde("Konnte nicht gemerkt werden");
                    return;
                }
                if (bestandRevision != ausgangsRevision) {
                    anlegenUndMerken(provider, url, meta, danach);
                    return;
                }
                try {
                    JSONObject urteil = new JSONObject(wert == null ? "{}" : wert);
                    JSONObject eintrag = urteil.optJSONObject("eintrag");
                    if (eintrag == null) {
                        if (melder != null) melder.melde("Adresse nicht erkannt");
                        return;
                    }
                    JSONArray neueListe = urteil.optJSONArray("favoriten");
                    if (neueListe != null) eintraege = neueListe;
                    aktiverEintragId = eintrag.optString("id", aktiverEintragId);
                    speichern();
                    if (beobachter != null) beobachter.bestandGeaendert();
                    if (danach != null) danach.run();
                } catch (Exception ausnahme) {
                    Log.e(TAG, "Ergebnis des Kerns unlesbar", ausnahme);
                }
            });
    }

    /**
     * Merkt sich, welcher Eintrag zu der Seite gehoert, die gerade offen ist.
     *
     * <p>Der Herz-Knopf und die Fortschrittsmeldung muessen das jederzeit
     * wissen, koennen aber nicht jedes Mal auf eine Antwort aus dem Kern
     * warten. Deshalb wird es beim Seitenwechsel einmal bestimmt und behalten -
     * genau wie der Hauptprozess es mit seinem aktiven Favoriten haelt.
     */
    public void aktuellenEintragBestimmen(Provider provider, String url, Runnable danach) {
        if (kern == null || !kern.istBereit() || provider == null || url == null) {
            aktiverEintragId = "";
            offenesWerk = "";
            if (danach != null) danach.run();
            return;
        }
        // Das Werk der offenen Seite - drei Zeichenketten hinein, eine heraus.
        // Es haengt allein an der Adresse und nicht daran, welcher Eintrag
        // gerade aktiv ist; genau deshalb kann der Herz-Knopf damit auch
        // waehrend einer Watchparty die richtige Antwort geben.
        kern.rufe("watchlist.werkSchluessel", Kern.args("", url, ""), (wert, fehler) -> {
            offenesWerk = fehler == null ? Kern.text(wert) : "";
            if (danach != null) danach.run();
        });
        JSONArray argumente = new JSONArray();
        argumente.put(eintraege);
        argumente.put(provider.alsJson());
        argumente.put(url);
        kern.rufe("fortschritt.eintragFinden", argumente, (wert, fehler) -> {
            aktiverEintragId = "";
            if (fehler == null && wert != null) {
                // Der Wert kommt als JSON-Text an; eine Kennung ist in
                // Anfuehrungszeichen gefasst.
                String text = wert.trim();
                if (text.length() >= 2 && text.startsWith("\"") && text.endsWith("\"")) {
                    text = text.substring(1, text.length() - 1);
                }
                if (!"null".equals(text)) aktiverEintragId = text;
            }
            if (danach != null) danach.run();
        });
    }

    /**
     * Zieht den geoeffneten Eintrag nach, wenn jemand zur naechsten Folge
     * blaettert, ohne dass etwas gelaufen waere.
     *
     * <p>Der zweite Weg, auf dem sich ein Stand bewegt. Die Entscheidung faellt
     * im geteilten Modul, damit sie hier nicht anders ausfaellt als am Rechner.
     */
    public void nachziehen(Provider provider, String url, String folgemodus) {
        if (kern == null || !kern.istBereit() || provider == null || url == null) return;
        JSONObject eintrag = rohMitId(aktiverEintragId);
        if (eintrag == null) return;
        final String eintragId = aktiverEintragId;
        final long ausgangsRevision = bestandRevision;

        JSONArray argumente = new JSONArray();
        argumente.put(eintrag);
        argumente.put(url);
        argumente.put(provider.alsJson());
        argumente.put(folgemodus == null ? "sequential" : folgemodus);

        kern.rufe("fortschritt.favoritNachziehen", argumente, (wert, fehler) -> {
            if (fehler != null || wert == null) return;
            if (bestandRevision != ausgangsRevision) {
                if (eintragId.equals(aktiverEintragId)) nachziehen(provider, url, folgemodus);
                return;
            }
            try {
                JSONObject urteil = new JSONObject(wert);
                String art = urteil.optString("art", "nichts");
                if ("loesen".equals(art)) {
                    // Der Benutzer ist woandershin gegangen - dieser Eintrag
                    // ist nicht mehr der geoeffnete.
                    aktiverEintragId = "";
                    return;
                }
                if (!"nachziehen".equals(art)) return;
                JSONObject aenderung = urteil.optJSONObject("aenderung");
                if (aenderung == null) return;
                for (java.util.Iterator<String> namen = aenderung.keys(); namen.hasNext(); ) {
                    String name = namen.next();
                    eintrag.put(name, aenderung.get(name));
                }
                nachVorn(eintrag);
                speichern();
                String meldung = urteil.optString("meldung", "");
                if (!meldung.isEmpty() && melder != null) melder.melde(meldung);
                if (beobachter != null) beobachter.bestandGeaendert();
            } catch (Exception ausnahme) {
                Log.e(TAG, "Nachziehen fehlgeschlagen", ausnahme);
            }
        });
    }

    private void nachVorn(JSONObject eintrag) {
        JSONArray neu = new JSONArray();
        neu.put(eintrag);
        for (int i = 0; i < eintraege.length(); i += 1) {
            JSONObject anderer = eintraege.optJSONObject(i);
            if (anderer == null || anderer == eintrag) continue;
            neu.put(anderer);
        }
        eintraege = neu;
    }

    /* --------------------------------------------------------- Watchparty */

    /**
     * Bindet einen Eintrag an eine Runde - oder loest ihn wieder.
     *
     * <p>Erst dadurch meldet er ueberhaupt etwas: ein Eintrag ohne Raum ist der
     * eigene und bleibt privat. Gibt es zu dem Titel noch keinen Eintrag, wird
     * beim ersten eingehenden Stand einer angelegt.
     */
    public void raumSetzen(String eintragId, String raum) {
        JSONObject eintrag = rohMitId(eintragId);
        if (eintrag == null) return;
        try {
            eintrag.put("watchpartyRoom", raum == null ? "" : raum);
        } catch (Exception fehler) {
            Log.e(TAG, "Raum liess sich nicht setzen", fehler);
            return;
        }
        speichern();
        if (beobachter != null) beobachter.bestandGeaendert();
    }

    /**
     * Der Eintrag zu genau dieser Adresse.
     *
     * <p>Grober Abgleich ueber Protokoll und abschliessenden Schraegstrich
     * hinweg - dieselbe Regel wie {@code adressSchluessel} am Rechner. Fuer die
     * Frage "steht dieser Vorschlag schon auf der Watchlist?" reicht das; was
     * feiner zu entscheiden ist, entscheidet der Kern.
     */
    public Favorite zuAdresse(String url) {
        String gesucht = adressSchluessel(url);
        if (gesucht.isEmpty()) return null;
        for (Favorite eintrag : alle()) {
            if (gesucht.equals(adressSchluessel(eintrag.url()))) return eintrag;
        }
        return null;
    }

    private static String adressSchluessel(String url) {
        String text = url == null ? "" : url.trim();
        // ROOT und nicht die Sprache des Geraets: in der Tuerkei wird aus einem
        // "I" ein punktloses "ı", und zwei Adressen, die gleich sind, waeren
        // es dort nicht mehr.
        return text.replaceFirst("(?i)^https?://", "").replaceAll("/+$", "")
            .toLowerCase(java.util.Locale.ROOT);
    }

    /**
     * Der Eintrag zu einer Serienadresse, egal auf welcher Folge er gerade steht.
     *
     * <p><b>Achtung.</b> Das findet <em>irgendeinen</em> Eintrag der Serie -
     * auch den privaten und auch den einer fremden Runde. Fuer alles, was mit
     * Raeumen zu tun hat, ist das die falsche Frage: dafuer gibt es
     * {@link #zuSerieImRaum} und {@link #raumBindungSetzen}.
     */
    public Favorite zuSerie(String serienUrl) {
        if (serienUrl == null || serienUrl.isEmpty()) return null;
        String gesucht = serienUrl.toLowerCase();
        for (Favorite eintrag : alle()) {
            String url = eintrag.url().toLowerCase();
            if (url.startsWith(gesucht)) return eintrag;
        }
        return null;
    }

    /**
     * Der Eintrag dieser Serie in genau dieser Runde.
     *
     * <p>Der Java-Zwilling von {@code fortschritt.watchpartyEintragFinden}:
     * Serie <em>und</em> Raum. Derselbe Titel darf privat laufen und in zwei
     * Runden stehen - das sind drei Staende, die nichts miteinander zu tun
     * haben.
     */
    public Favorite zuSerieImRaum(String serienUrl, String raum) {
        if (serienUrl == null || serienUrl.isEmpty() || raum == null || raum.isEmpty()) return null;
        String gesucht = serienUrl.toLowerCase();
        for (Favorite eintrag : alle()) {
            if (!raum.equals(eintrag.watchpartyRaum())) continue;
            if (eintrag.url().toLowerCase().startsWith(gesucht)) return eintrag;
        }
        return null;
    }

    /** Und der eigene Eintrag derselben Serie - der ohne Raum. */
    public Favorite privatZuSerie(String serienUrl) {
        if (serienUrl == null || serienUrl.isEmpty()) return null;
        String gesucht = serienUrl.toLowerCase();
        for (Favorite eintrag : alle()) {
            if (!eintrag.watchpartyRaum().isEmpty()) continue;
            if (eintrag.url().toLowerCase().startsWith(gesucht)) return eintrag;
        }
        return null;
    }

    /**
     * Den eigenen Eintrag an eine Runde binden - oder eben nicht.
     *
     * <p><b>Der gemeldete Fehler.</b> In "Gemeinsam weiterschauen" stand
     * "Black Torch" zweimal, einmal auf Folge 12 und einmal auf Folge 11,
     * beide im Raum "Bangus". Gebunden wurde bis hierher ueber
     * {@link #zuSerie} - also ueber <em>irgendeinen</em> Eintrag der Serie, und
     * das war oft der private. Er bekam den Raum aufgestempelt und stand von
     * da an neben dem echten Raum-Eintrag: der lief mit der Runde weiter, der
     * andere blieb stehen, wo er gebunden wurde. Jede neue Folge trieb die
     * beiden weiter auseinander.
     *
     * <p>Die Regel steht im geteilten Modul ({@code raumBindungWaehlen}); hier
     * steht ihr Zwilling, weil das Binden eine Schreiboperation dieser Ablage
     * ist und nicht durch den Kern laufen muss:
     *
     * <ul>
     *   <li>Gibt es den Eintrag dieser Runde schon, ist nichts zu tun.
     *   <li>Sonst wird der eigene, private Eintrag zu ihm - einen zweiten
     *       braucht es nicht.
     *   <li>Gibt es hier noch gar keinen, geschieht nichts. Er entsteht beim
     *       naechsten Raumzustand ueber die geteilte Regel.
     * </ul>
     *
     * <p>Ein Eintrag, der einer <em>anderen</em> Runde gehoert, wird nie
     * gebunden: er ist deren Stand.
     *
     * @return true, wenn es jetzt einen Eintrag dieser Runde gibt
     */
    public boolean raumBindungSetzen(String serienUrl, String raum) {
        if (serienUrl == null || serienUrl.isEmpty() || raum == null || raum.isEmpty()) return false;
        if (zuSerieImRaum(serienUrl, raum) != null) return true;
        Favorite privat = privatZuSerie(serienUrl);
        if (privat == null) return false;
        raumSetzen(privat.id(), raum);
        return true;
    }

    /**
     * Und zurueck: der Eintrag <em>dieser</em> Runde zaehlt wieder nur hier.
     *
     * <p>Genau dieser - nicht der erstbeste der Serie. Sonst liesse ein Austritt
     * den Raum-Eintrag stehen und machte stattdessen am privaten nichts.
     */
    public boolean raumBindungLoesen(String serienUrl, String raum) {
        Favorite imRaum = zuSerieImRaum(serienUrl, raum);
        if (imRaum == null) return false;
        raumSetzen(imRaum.id(), "");
        return true;
    }

    /**
     * Uebernimmt einen Stand aus der Runde.
     *
     * <p>Die Entscheidung faellt im geteilten Modul - dieselbe, die der Rechner
     * trifft. Hier wird sie nur angewandt und abgelegt.
     */
    /**
     * Sorgt dafuer, dass es zu diesem Titel in dieser Runde einen Eintrag gibt.
     *
     * <p>Gerechnet wird nichts hier: gesucht und angelegt wird in
     * {@code watchparty-bruecke.raumEintragSichern}, und die ruft ihrerseits
     * {@code fortschritt.watchpartyEintragAnlegen} - dieselbe Regel, mit der
     * der Rechner seinen Raum-Eintrag anlegt.
     *
     * @param nimm bekommt die Kennung des Eintrags, oder leer, wenn sich
     *             keiner sicherstellen liess
     */
    public void raumEintragSichern(String key, String raum, JSONArray anbieter, JSONObject stand,
                                   java.util.function.Consumer<String> nimm) {
        if (kern == null || !kern.istBereit() || key == null || key.isEmpty()) {
            nimm.accept("");
            return;
        }
        JSONObject zustand = new JSONObject();
        final long ausgangsRevision = bestandRevision;
        try {
            zustand.put("favoriten", eintraege);
        } catch (Exception fehler) {
            Log.e(TAG, "Raum-Eintrag liess sich nicht vorbereiten", fehler);
            nimm.accept("");
            return;
        }
        kern.rufe("watchparty-bruecke.raumEintragSichern",
            Kern.args(zustand, key, raum == null ? "" : raum,
                anbieter == null ? new JSONArray() : anbieter,
                stand == null ? new JSONObject() : stand),
            (wert, fehler) -> {
                if (fehler != null || wert == null) {
                    Log.d(TAG, "Raum-Eintrag nicht sichergestellt: " + fehler);
                    nimm.accept("");
                    return;
                }
                if (bestandRevision != ausgangsRevision) {
                    raumEintragSichern(key, raum, anbieter, stand, nimm);
                    return;
                }
                try {
                    JSONObject urteil = new JSONObject(wert);
                    String id = urteil.optString("eintragId", "");
                    if (id.isEmpty()) {
                        nimm.accept("");
                        return;
                    }
                    JSONArray neueListe = urteil.optJSONArray("favoriten");
                    if (neueListe != null) eintraege = neueListe;
                    if (urteil.optBoolean("neu", false)) {
                        Log.i(TAG, "Aus der Watchparty uebernommen: " + key + " (Raum " + raum + ")");
                        speichern();
                        if (beobachter != null) beobachter.bestandGeaendert();
                    }
                    nimm.accept(id);
                } catch (Exception ausnahme) {
                    Log.e(TAG, "Antwort zum Raum-Eintrag unlesbar", ausnahme);
                    nimm.accept("");
                }
            });
    }

    /**
     * Dasselbe fuer alle betretenen Titel - in einem einzigen Aufruf.
     *
     * <p><b>Der gemeldete Fehler.</b> {@link Watchparty} rief
     * {@link #raumEintragSichern} je Titel einmal, in einer Schleife. Jeder
     * Aufruf schickt die ganze Ablage in den Kern und bekommt eine neue Liste
     * zurueck - und weil die Antwort erst spaeter kommt, war die Schleife
     * durch, bevor die erste eintraf. Alle Aufrufe trugen damit denselben
     * Schnappschuss, und die letzte Antwort setzte {@code eintraege} auf eine
     * Liste, in der die vorherigen Neuzugaenge nie standen.
     *
     * <p>Am 2026-08-29 am Fire TV Stick gemessen: vier Eintraege angelegt,
     * Bestand danach 80 -> 81. Beim naechsten Start standen drei davon wieder
     * als neu im Protokoll. Auf der Startseite kam so je Start genau eine
     * Runde dazu.
     *
     * @param danach laeuft, wenn dieser Lauf durch ist - erst dann steht die
     *               neue Liste, und erst dann darf der naechste beginnen
     */
    public void raumEintraegeSichern(JSONArray anbieter, Runnable danach) {
        raumEintraegeSichern(anbieter, erfolgreich -> danach.run());
    }

    /**
     * Wie {@link #raumEintraegeSichern(JSONArray, Runnable)}, mit belastbarem
     * Ergebnis fuer den Zustandsabdruck der Watchparty. Nur eine gelesene und
     * auf den aktuellen Bestand angewandte Kernantwort ist erfolgreich.
     */
    public void raumEintraegeSichern(JSONArray anbieter,
                                     java.util.function.Consumer<Boolean> danach) {
        if (kern == null || !kern.istBereit()) {
            danach.accept(false);
            return;
        }
        JSONObject zustand = new JSONObject();
        final long ausgangsRevision = bestandRevision;
        try {
            zustand.put("favoriten", eintraege);
        } catch (Exception fehler) {
            Log.e(TAG, "Raum-Eintraege liessen sich nicht vorbereiten", fehler);
            danach.accept(false);
            return;
        }
        kern.rufe("watchparty-bruecke.raumEintraegeSichern",
            Kern.args(zustand, anbieter == null ? new JSONArray() : anbieter),
            (wert, fehler) -> {
                if (fehler == null && wert != null && bestandRevision != ausgangsRevision) {
                    raumEintraegeSichern(anbieter, danach);
                    return;
                }
                // Erst die Antwort einarbeiten, dann melden: wer auf diesen
                // Lauf gewartet hat, faenge sonst mit der alten Liste an.
                boolean erfolgreich = false;
                try {
                    if (fehler != null || wert == null) {
                        Log.d(TAG, "Raum-Eintraege nicht sichergestellt: " + fehler);
                        return;
                    }
                    JSONObject urteil = new JSONObject(wert);
                    JSONArray neueListe = urteil.optJSONArray("favoriten");
                    if (neueListe != null) eintraege = neueListe;
                    erfolgreich = neueListe != null;
                    if (!urteil.optBoolean("geaendert", false)) return;
                    JSONArray gesichert = urteil.optJSONArray("gesichert");
                    Log.i(TAG, "Aus der Watchparty uebernommen: "
                        + urteil.optInt("angelegt", 0) + " angelegt, "
                        + (gesichert == null ? 0 : gesichert.length()) + " Runden geprueft");
                    speichern();
                    if (beobachter != null) beobachter.bestandGeaendert();
                } catch (Exception ausnahme) {
                    Log.e(TAG, "Antwort zu den Raum-Eintraegen unlesbar", ausnahme);
                } finally {
                    danach.accept(erfolgreich);
                }
            });
    }

    /**
     * Den Eintrag zu einer Runde sicherstellen und dann den Stand uebernehmen.
     *
     * <p><b>Der gemeldete Fehler.</b> Hier stand zuerst {@code zuSerie(...)} und
     * darunter {@code if (lokal == null) return;} - kam ein Stand zu einem
     * Titel herein, den diese Ablage nicht kannte, geschah nichts. Angelegt hat
     * ihn auch niemand sonst: die Regel dafuer lag am Rechner in {@code main.js}
     * und damit an einem Ort, den das Telefon nie sieht. Ergebnis: "Gemeinsam
     * weiterschauen" blieb auf Android leer, egal wie lange die Runde lief.
     *
     * <p>Am Geraet nachgestellt (Emulator, echtes Relay, ein zweites Mitglied,
     * das im Sekundentakt meldet): Android trat dem Titel bei, das Relay
     * leitete weiter - und nach zwanzig Sekunden standen zwei Eintraege in der
     * Ablage, <em>keiner</em> mit Raum, der eingestellte Titel gar nicht.
     *
     * <p>{@code zuSerie} war ausserdem in die andere Richtung falsch: es findet
     * <em>irgendeinen</em> Eintrag der Serie, auch den privaten. Der Stand der
     * Runde waere damit in den eigenen Verlauf gelaufen. Gesucht wird jetzt
     * nach Serie <em>und</em> Raum, und das tut die geteilte Regel.
     *
     * @param eintragId die Kennung, die {@code raumEintragSichern} zurueckgibt
     */
    public void watchpartyStandUebernehmen(String eintragId, JSONObject stand) {
        if (kern == null || !kern.istBereit() || stand == null) return;
        Favorite lokal = mitId(eintragId);
        if (lokal == null) return;
        final long ausgangsRevision = bestandRevision;

        kern.rufe("fortschritt.watchpartyStandUebernehmen",
            Kern.args(lokal.roh, stand), (wert, fehler) -> {
                if (fehler != null || wert == null) return;
                if (bestandRevision != ausgangsRevision) {
                    watchpartyStandUebernehmen(eintragId, stand);
                    return;
                }
                try {
                    JSONObject urteil = new JSONObject(wert);
                    if (!"aendern".equals(urteil.optString("art"))) return;
                    JSONObject aenderung = urteil.optJSONObject("aenderung");
                    if (aenderung == null) return;
                    for (java.util.Iterator<String> namen = aenderung.keys(); namen.hasNext(); ) {
                        String name = namen.next();
                        lokal.roh.put(name, aenderung.get(name));
                    }
                    speichern();
                    if (melder != null) {
                        melder.melde("Stand von " + stand.optString("from", "einem Gerät") + " übernommen");
                    }
                    if (beobachter != null) beobachter.bestandGeaendert();
                } catch (Exception ausnahme) {
                    Log.e(TAG, "Stand nicht uebernommen", ausnahme);
                }
            });
    }

    /* ----------------------------------------------------------- Nachschub */

    /**
     * Einen Durchgang "gibt es zu abgeschlossenen Serien etwas Neues?" fahren.
     *
     * <p>Gerechnet wird nichts hier. Welche Titel drankommen, was aus den
     * Anbieterseiten zu lesen ist und ob daraus eine Reaktivierung folgt, steht
     * in {@code nachschub.js} - <em>demselben</em> Modul, das der Rechner
     * fragt. Diese Methode reicht die Ablage hinein, nimmt sie zurueck und
     * sagt weiter, was dabei herauskam.
     *
     * <p><b>Warum es das ueberhaupt gibt.</b> Der Vorgang stand vollstaendig in
     * {@code main.js}, also an einem Ort, den das Telefon nie sieht. Eine
     * archivierte Watchparty-Serie wurde damit erst wieder aktiv, wenn
     * irgendwann ein Rechner lief - fuer wen der Fernseher das einzige Geraet
     * ist, kam der Nachschub nie an.
     *
     * <p>Der Rueckweg zur Runde laeuft ueber denselben {@link StandMelder} wie
     * jeder andere Stand: findet dieses Geraet die neue Folge, meldet es sie,
     * und das Relay holt den archivierten Raumtitel zurueck.
     *
     * @param hoechstens wie viele Titel dieser Durchgang ansieht
     * @param danach     bekommt die Zahl der gefundenen Titel; laeuft auch,
     *                   wenn nichts gefunden wurde oder der Kern nicht bereit
     *                   war
     */
    public void nachschubPruefen(int hoechstens, java.util.function.Consumer<Integer> danach) {
        if (kern == null || !kern.istBereit()) {
            danach.accept(0);
            return;
        }
        JSONObject zustand = new JSONObject();
        final long ausgangsRevision = bestandRevision;
        try {
            zustand.put("favoriten", eintraege);
        } catch (Exception fehler) {
            Log.e(TAG, "Nachschublauf liess sich nicht vorbereiten", fehler);
            danach.accept(0);
            return;
        }
        kern.rufe("nachschub-bruecke.lauf", Kern.args(zustand, hoechstens), (wert, fehler) -> {
            if (fehler == null && wert != null && bestandRevision != ausgangsRevision) {
                nachschubPruefen(hoechstens, danach);
                return;
            }
            int gefunden = 0;
            try {
                if (fehler != null || wert == null) {
                    Log.d(TAG, "Nachschub nicht geprueft: " + fehler);
                    return;
                }
                JSONObject urteil = new JSONObject(wert);
                JSONArray neueListe = urteil.optJSONArray("favoriten");
                if (neueListe != null) eintraege = neueListe;
                // Gestempelt wird jeder Versuch, nicht nur der Fund - sonst
                // stuenden dieselben Titel beim naechsten Durchgang wieder
                // vorn. Deshalb wird auch dann gespeichert, wenn nichts
                // Neues dabei war.
                if (!urteil.optBoolean("geaendert", false)) return;
                JSONArray funde = urteil.optJSONArray("gefunden");
                gefunden = funde == null ? 0 : funde.length();
                speichern();
                for (int i = 0; i < gefunden; i += 1) {
                    JSONObject fund = funde.optJSONObject(i);
                    if (fund == null) continue;
                    Log.i(TAG, "Nachschub: " + fund.optString("titel") + " - " + fund.optString("label"));
                    if (melder != null) {
                        melder.melde(fund.optString("titel") + ": " + fund.optString("label"));
                    }
                    // Gehoert der Titel zu einer Runde, gehoert der Fund
                    // dorthin. Ohne diese Meldung wuesste nur dieses Geraet,
                    // dass der archivierte Raumtitel wieder aktiv ist.
                    JSONObject roh = fund.optString("raum").isEmpty()
                        ? null
                        : rohMitId(fund.optString("id"));
                    if (roh != null && standMelder != null) standMelder.melde(roh);
                }
                if (beobachter != null) beobachter.bestandGeaendert();
            } catch (Exception ausnahme) {
                Log.e(TAG, "Antwort des Nachschublaufs unlesbar", ausnahme);
            } finally {
                danach.accept(gefunden);
            }
        });
    }

    /* ------------------------------------------------ Aenderungen von Hand */

    /** Der Herz-Knopf: auf die Merkliste oder herunter. */
    public void watchlistSetzen(String id, boolean wert) {
        JSONObject eintrag = rohMitId(id);
        if (eintrag == null) return;
        try {
            eintrag.put("favorite", wert);
            if (wert) {
                // Wieder auf die Liste heisst: nicht mehr abgeschlossen. Sonst
                // stuende der Titel gleichzeitig in Watchlist und Mediathek.
                eintrag.put("completed", false);
                eintrag.put("completedManually", false);
                eintrag.put("completedAt", "");
                eintrag.put("hideFromContinueWatching", false);
                // Ohne Abschluss kein Wiederansehen: der Titel ist jetzt
                // schlicht offen. Die Zahl der Durchlaeufe bleibt stehen - sie
                // sagt, was war, nicht was gerade ist.
                eintrag.put("rewatching", false);
            }
        } catch (Exception fehler) {
            Log.e(TAG, "Watchlist liess sich nicht setzen", fehler);
            return;
        }
        speichern();
        if (beobachter != null) beobachter.bestandGeaendert();
    }

    /**
     * Der Herz-Knopf: die offene Adresse vormerken oder herunternehmen.
     *
     * <p>Ueber den kanonischen Schluessel aus {@code watchlist.js} und nicht
     * ueber den aktiven Eintrag. Der Unterschied ist der gemeldete Fehler:
     * waehrend einer Watchparty ist der aktive Eintrag der des Raums, und der
     * gehoert nie auf die eigene Merkliste. Vorgemerkt wurde damit ein
     * Eintrag, den die Watchlist gar nicht fuehrt.
     *
     * <p>Gebraucht wird nur die Adresse - der Schluessel kommt aus ihr.
     *
     * @param fertig bekommt {@code true}, wenn der Titel jetzt vorgemerkt ist,
     *               und {@code null}, wenn es ihn hier noch gar nicht gibt;
     *               dann ist {@link #anlegenUndMerken} zustaendig.
     */
    public void watchlistUmschalten(String url, String titel, String art,
                                    java.util.function.Consumer<Boolean> fertig) {
        if (kern == null || !kern.istBereit() || url == null || url.isEmpty()) {
            if (fertig != null) fertig.accept(null);
            return;
        }
        JSONObject werk = new JSONObject();
        try {
            werk.put("title", titel == null ? "" : titel);
            werk.put("url", url);
            werk.put("type", art == null ? "" : art);
        } catch (Exception fehler) {
            Log.e(TAG, "Watchlist liess sich nicht umschalten", fehler);
            if (fertig != null) fertig.accept(null);
            return;
        }
        final long ausgangsRevision = bestandRevision;
        kern.rufe("watchlist.umschalten", Kern.args(eintraege, werk), (wert, fehler) -> {
            if (fehler != null || wert == null) {
                if (fertig != null) fertig.accept(null);
                return;
            }
            if (bestandRevision != ausgangsRevision) {
                watchlistUmschalten(url, titel, art, fertig);
                return;
            }
            try {
                JSONObject urteil = new JSONObject(wert);
                if (!urteil.optBoolean("gefunden", false)) {
                    if (fertig != null) fertig.accept(null);
                    return;
                }
                JSONArray neu = urteil.optJSONArray("favoriten");
                if (neu != null) eintraege = neu;
                speichern();
                if (beobachter != null) beobachter.bestandGeaendert();
                if (fertig != null) fertig.accept(urteil.optBoolean("vorgemerkt", false));
            } catch (Exception ausnahme) {
                Log.e(TAG, "Watchlist liess sich nicht umschalten", ausnahme);
                if (fertig != null) fertig.accept(null);
            }
        });
    }

    /** Wie am Rechner: beim Oeffnen ist der Hinweis auf die neue Folge gesehen. */
    public void neueFolgeGesehen(String id) {
        JSONObject eintrag = rohMitId(id);
        if (eintrag == null || eintrag.optString("newEpisodeAt", "").isEmpty()) return;
        try {
            eintrag.put("newEpisodeAt", "");
            eintrag.put("newEpisodeLabel", "");
        } catch (Exception fehler) {
            Log.e(TAG, "Folgenhinweis liess sich nicht bestaetigen", fehler);
            return;
        }
        speichern();
        if (beobachter != null) beobachter.bestandGeaendert();
    }

    /** Von Hand abhaken: der Titel wandert in die Mediathek. */
    public void alsAbgeschlossenMarkieren(String id) {
        JSONObject eintrag = rohMitId(id);
        if (eintrag == null) return;
        try {
            eintrag.put("completed", true);
            eintrag.put("completedManually", true);
            eintrag.put("completedAt", new java.util.Date().toInstant().toString());
            eintrag.put("favorite", false);
            eintrag.put("hideFromContinueWatching", true);
            eintrag.put("continuePending", false);
            // Von Hand abhaken heisst "ich bin damit durch" - auch mit einem
            // gerade laufenden weiteren Durchlauf.
            eintrag.put("rewatching", false);
            eintrag.put("progress", 100);
        } catch (Exception fehler) {
            Log.e(TAG, "Abschluss liess sich nicht setzen", fehler);
            return;
        }
        speichern();
        if (beobachter != null) beobachter.bestandGeaendert();
    }

    /**
     * Von vorn ansehen - und dabei in der Mediathek bleiben.
     *
     * <p>Das Gegenstueck zu {@code library:rewatch} am Rechner, und aus
     * demselben Grund da: eine Kachel in der Mediathek oeffnet die gespeicherte
     * Adresse, und die ist bei einer durchgeschauten Serie die letzte Folge -
     * das Ende, nicht der Anfang. {@code completed} bleibt dabei unangetastet;
     * der Eintrag steht danach in der Mediathek <em>und</em> in
     * "Weiterschauen".
     *
     * <p>Die erste Folge wird ueber den geteilten Kern bestimmt, damit hier
     * keine zweite Vorstellung davon entsteht, wie eine Folgenadresse aussieht.
     *
     * @param fertig bekommt die Adresse, mit der es weitergeht (nie {@code null})
     */
    public void wiederansehenStarten(String id, java.util.function.Consumer<String> fertig) {
        JSONObject eintrag = rohMitId(id);
        if (eintrag == null || kern == null || !kern.istBereit()) {
            if (fertig != null) fertig.accept(eintrag == null ? "" : eintrag.optString("url", ""));
            return;
        }
        final long ausgangsRevision = bestandRevision;
        JSONArray argumente = new JSONArray();
        argumente.put(eintrag);
        kern.rufe("fortschritt.wiederansehenBeginnen", argumente, (wert, fehler) -> {
            if (fehler == null && wert != null && bestandRevision != ausgangsRevision) {
                wiederansehenStarten(id, fertig);
                return;
            }
            if (fehler == null && wert != null) {
                try {
                    JSONObject aenderung = new JSONObject(wert);
                    for (java.util.Iterator<String> namen = aenderung.keys(); namen.hasNext(); ) {
                        String name = namen.next();
                        eintrag.put(name, aenderung.get(name));
                    }
                    nachVorn(eintrag);
                } catch (Exception ausnahme) {
                    Log.e(TAG, "Wiederansehen liess sich nicht starten", ausnahme);
                }
            }
            speichern();
            if (beobachter != null) beobachter.bestandGeaendert();
            if (fertig != null) fertig.accept(eintrag.optString("url", ""));
        });
    }

    /**
     * Aus Weiterschauen nehmen, ohne den Eintrag zu verlieren.
     *
     * <p>Der Titel bleibt im Verlauf und in der Watchlist - nur die Zeile
     * "Weiterschauen" wird ihn los. Loeschen waere hier falsch: wer eine Folge
     * abbricht, will sie nicht vergessen, sondern nur nicht vorgeschlagen
     * bekommen.
     */
    public void ausWeiterschauenNehmen(String id) {
        JSONObject eintrag = rohMitId(id);
        if (eintrag == null) return;
        try {
            eintrag.put("hideFromContinueWatching", true);
            eintrag.put("continuePending", false);
        } catch (Exception fehler) {
            Log.e(TAG, "Eintrag liess sich nicht ausblenden", fehler);
            return;
        }
        speichern();
        if (beobachter != null) beobachter.bestandGeaendert();
    }

    /** Ganz entfernen - aus der Mediathek oder aus dem Verlauf. */
    public void entfernen(String id) {
        if (id == null || id.isEmpty()) return;
        JSONArray behalten = new JSONArray();
        for (int i = 0; i < eintraege.length(); i += 1) {
            JSONObject eintrag = eintraege.optJSONObject(i);
            if (eintrag == null || id.equals(eintrag.optString("id"))) continue;
            behalten.put(eintrag);
        }
        eintraege = behalten;
        if (id.equals(aktiverEintragId)) aktiverEintragId = "";
        speichern();
        if (beobachter != null) beobachter.bestandGeaendert();
    }

    public void verlaufLeeren() {
        // Was auf der Merkliste steht oder in der Mediathek, ist kein Verlauf -
        // es bleibt. Geloescht wird, was nur durchgelaufen ist.
        JSONArray behalten = new JSONArray();
        for (int i = 0; i < eintraege.length(); i += 1) {
            JSONObject eintrag = eintraege.optJSONObject(i);
            if (eintrag == null) continue;
            if (eintrag.optBoolean("favorite") || eintrag.optBoolean("completed")) behalten.put(eintrag);
        }
        eintraege = behalten;
        speichern();
        if (beobachter != null) beobachter.bestandGeaendert();
    }

    /** Die rohe Liste - fuer den Kern und fuer den Abgleich. */
    public JSONArray roh() {
        return eintraege;
    }

    /** Setzt die Liste, wie sie vom Abgleich hereinkommt. */
    public void setzeRoh(JSONArray neu) {
        if (neu == null) return;
        eintraege = neu;
        speichern();
        if (beobachter != null) beobachter.bestandGeaendert();
    }

    /**
     * Wendet nur die vom Geräteabgleich bestätigten Änderungen auf den gerade
     * aktuellen Bestand an.
     *
     * <p>Der frühere Rückweg ersetzte die ganze Liste durch den Snapshot, den
     * die Brücke einige Sekunden zuvor bekommen hatte. Kam in dieser Zeit ein
     * lokaler Playerstand hinzu, setzte ein völlig anderer Remote-Eintrag die
     * laufende Serie wieder zurück. Das Delta wird deshalb im gemeinsamen Kern
     * auf die <em>jetzige</em> Liste gerechnet. Ändert sie sich währenddessen,
     * wird dasselbe Delta erneut auf deren neuen Stand angewandt.
     */
    public void geraeteAenderungenUebernehmen(JSONObject aenderungen) {
        if (kern == null || aenderungen == null) return;
        JSONObject kopie;
        try {
            kopie = new JSONObject(aenderungen.toString());
        } catch (Exception fehler) {
            Log.e(TAG, "Geraeteaenderungen unlesbar", fehler);
            return;
        }
        geraeteAenderungenReihe.hinzufuegen(kopie, (links, rechts) -> false);
        geraeteAenderungenStarten();
    }

    private void geraeteAenderungenStarten() {
        JSONObject aenderungen = geraeteAenderungenReihe.beginnen();
        if (aenderungen == null) return;
        if (!kern.istBereit()) {
            geraeteAenderungenReihe.anhalten();
            if (!geraeteAenderungenWartenAufKern) {
                geraeteAenderungenWartenAufKern = true;
                kern.wennBereit(() -> {
                    geraeteAenderungenWartenAufKern = false;
                    geraeteAenderungenFortsetzen();
                });
            }
            return;
        }
        geraeteAenderungenAusfuehren(aenderungen);
    }

    private void geraeteAenderungenAusfuehren(JSONObject aenderungen) {
        final long ausgangsRevision = bestandRevision;
        kern.rufe("geraete-bruecke.aenderungenUebernehmen",
            Kern.args(eintraege, aenderungen), (wert, fehler) -> {
                if (fehler != null || wert == null) {
                    if (fehler != null) Log.e(TAG, "Geraeteaenderungen nicht uebernommen: " + fehler);
                    geraeteAenderungenPausieren();
                    return;
                }
                if (bestandRevision != ausgangsRevision) {
                    geraeteAenderungenAusfuehren(aenderungen);
                    return;
                }
                boolean gueltig = false;
                try {
                    JSONObject urteil = new JSONObject(wert);
                    JSONArray neu = urteil.optJSONArray("favoriten");
                    if (neu == null) throw new IllegalArgumentException("Favoriten fehlen");
                    gueltig = true;
                    if (urteil.optBoolean("geaendert", false)) {
                        eintraege = neu;
                        speichern();
                        if (beobachter != null) beobachter.bestandGeaendert();
                    }
                    // Der Pure-Helper veraendert absichtlich nicht den Cache
                    // der Geraetebruecke. Sofort das aktuelle Bild nachreichen,
                    // auch wenn das Delta wegen `vorher` ein No-op war; sonst
                    // koennte die Bruecke bis zum naechsten Poll denselben
                    // veralteten Vollstand noch einmal als Delta ausgeben.
                    kern.rufe("geraete-bruecke.favoritenSetzen", Kern.args(eintraege), null);
                } catch (Exception ausnahme) {
                    Log.e(TAG, "Geraeteaenderungen unlesbar", ausnahme);
                } finally {
                    if (gueltig) geraeteAenderungenAbschliessen();
                    else geraeteAenderungenPausieren();
                }
            });
    }

    /** Wird vom naechsten regulaeren Geraeteabgleich nach einem Fehler aufgerufen. */
    public boolean geraeteAenderungenFortsetzen() {
        geraeteAenderungenStarten();
        return geraeteAenderungenReihe.groesse() == 0;
    }

    public void setzeGeraeteFortsetzung(Runnable fortsetzen) {
        geraeteFortsetzung = fortsetzen;
    }

    private void geraeteAenderungenPausieren() {
        geraeteAenderungenReihe.anhalten();
        geraeteAenderungenFehlversuche += 1;
        if (!kern.istBereit()) {
            // Bei einem Kern-Neustart erst nach dessen Bereitschaft weiter.
            geraeteAenderungenStarten();
        } else if (geraeteAenderungenFehlversuche == 1 && geraeteFortsetzung != null) {
            // Einmal automatisch nachholen, auch wenn das Geraet danach idle
            // bleibt. Eine dauerhaft unlesbare Antwort erzeugt keinen Takt.
            geraeteFortsetzung.run();
        }
    }

    private void geraeteAenderungenAbschliessen() {
        geraeteAenderungenFehlversuche = 0;
        geraeteAenderungenReihe.abschliessen();
        geraeteAenderungenStarten();
        if (geraeteAenderungenReihe.groesse() == 0 && geraeteFortsetzung != null) {
            geraeteFortsetzung.run();
        }
    }

    /**
     * Ein Titelbild nachtragen, das die Anbieterseite hergegeben hat.
     *
     * <p>Das Gegenstueck zu {@code updateActiveFavoriteTitle} am Rechner: die
     * geteilte Regel setzt das Bild nur beim Anlegen des Eintrags. Wer ihn aus
     * dem Geraeteabgleich oder aus einer aelteren Fassung hat, hat deshalb oft
     * keines - sobald seine Seite offen ist, ist es zu haben.
     *
     * <p>Welcher Eintrag zu dieser Adresse gehoert, entscheidet der Kern und
     * nicht der gemerkte "aktive" Eintrag: der zeigt beim Seitenwechsel einen
     * Augenblick lang noch auf die vorige Seite, und ein Bild am falschen Titel
     * waere schlimmer als gar keins.
     *
     * <p>Nachgetragen wird nur, wo nichts steht. Ein vorhandenes Bild zu
     * ersetzen hiesse, bei jedem Seitenaufruf die Ablage neu zu schreiben und
     * dieselbe Aenderung ueber den Geraeteabgleich hinauszuschicken.
     */
    public void bildNachtragen(Provider provider, String url, String bild) {
        if (kern == null || !kern.istBereit() || provider == null || url == null) return;
        if (bild == null || bild.isEmpty()) return;
        JSONArray argumente = new JSONArray();
        argumente.put(eintraege);
        argumente.put(provider.alsJson());
        argumente.put(url);
        kern.rufe("fortschritt.eintragFinden", argumente, (wert, fehler) -> {
            if (fehler != null || wert == null) return;
            // Der Wert kommt als JSON-Text; eine Kennung ist in
            // Anfuehrungszeichen gefasst.
            String id = wert.trim();
            if (id.length() >= 2 && id.startsWith("\"") && id.endsWith("\"")) {
                id = id.substring(1, id.length() - 1);
            }
            JSONObject eintrag = rohMitId(id);
            if (eintrag == null || !eintrag.optString("thumbnail", "").isEmpty()) return;
            try {
                eintrag.put("thumbnail", bild);
            } catch (Exception ausnahme) {
                Log.e(TAG, "Titelbild nicht nachgetragen", ausnahme);
                return;
            }
            speichern();
            if (beobachter != null) beobachter.bestandGeaendert();
        });
    }

    private JSONObject rohMitId(String id) {
        if (id == null || id.isEmpty()) return null;
        for (int i = 0; i < eintraege.length(); i += 1) {
            JSONObject eintrag = eintraege.optJSONObject(i);
            if (eintrag != null && id.equals(eintrag.optString("id"))) return eintrag;
        }
        return null;
    }
}
