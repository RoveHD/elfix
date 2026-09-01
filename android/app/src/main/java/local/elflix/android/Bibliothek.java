package local.elflix.android;

import java.util.ArrayList;
import java.util.List;

/**
 * Die fuenf Listen und was sie unterscheidet.
 *
 * <p>Weiterschauen, Gemeinsam, Watchlist, Mediathek und Verlauf sind Blicke auf denselben
 * Bestand - was sie trennt, ist nicht die Ablage, sondern die Frage, die sie
 * beantworten. Diese Aufzaehlung haelt die Antworten an einer Stelle, damit
 * Telefon und Fernseher dieselben Ueberschriften, dieselben Leerzustaende und
 * dieselben Aktionen zeigen.
 *
 * <p>Die Zuordnung selbst - welcher Eintrag in welche Liste faellt - steht in
 * {@link Bestand} und damit letztlich in der geteilten Regel.
 */
public enum Bibliothek {
    WEITERSCHAUEN(
        "weiterschauen", "Weiterschauen", "Angefangen und noch nicht zu Ende",
        "Nichts angefangen",
        "Sobald du eine Folge ansiehst, steht sie hier - mit dem Stand, an dem du aufgehört hast.",
        "Weiter ansehen"),
    /**
     * Was in einer Watchparty laeuft - und warum es eine eigene Liste ist.
     *
     * <p>Die Startseite trennt beides seit jeher: dort stehen "Weiterschauen"
     * und "Gemeinsam weiterschauen" als zwei Reihen. In "Meine Liste" liefen
     * sie zusammen, und damit stand ein Titel, den man mit jemandem zusammen
     * schaut, mitten zwischen den eigenen - mit einem Stand, der nicht der
     * eigene ist. Gemeldet als Wunsch, beides zu trennen.
     *
     * <p>Getrennt wird am Raum: ein Eintrag, der zu einem Watchparty-Raum
     * gehoert, ist gemeinsam, jeder andere ist der eigene. Dieselbe Frage wie
     * auf der Startseite, damit ein Titel nicht auf der einen Seite hier und
     * auf der anderen dort steht.
     */
    GEMEINSAM(
        "gemeinsam", "Gemeinsam", "Was ihr zusammen angefangen habt",
        "Noch nichts gemeinsam",
        "Titel aus einer Watchparty stehen hier - getrennt von dem, was du allein schaust.",
        "Weiter ansehen"),
    WATCHLIST(
        "watchlist", "Watchlist", "Für später gemerkt",
        "Noch nichts gemerkt",
        "Tippe beim Ansehen oben auf das Herz. Der Titel steht dann hier, bis du ihn durch hast.",
        "Ansehen"),
    MEDIATHEK(
        "mediathek", "Mediathek", "Alles, was du durch hast",
        "Noch nichts abgeschlossen",
        "Wenn du die letzte Folge einer Serie durchschaust, wandert sie von der Watchlist hierher.",
        "Nochmal ansehen"),
    VERLAUF(
        "verlauf", "Verlauf", "Was du zuletzt geöffnet hast",
        "Noch kein Verlauf",
        "Hier steht später, was du dir angesehen hast - unabhängig davon, ob du es gemerkt hast.",
        "Öffnen");

    public final String kennung;
    public final String titel;
    public final String untertitel;
    public final String leerTitel;
    public final String leerText;
    /** Was auf dem Knopf einer Karte steht. */
    public final String aufruf;

    Bibliothek(String kennung, String titel, String untertitel,
               String leerTitel, String leerText, String aufruf) {
        this.kennung = kennung;
        this.titel = titel;
        this.untertitel = untertitel;
        this.leerTitel = leerTitel;
        this.leerText = leerText;
        this.aufruf = aufruf;
    }

    public List<Favorite> eintraege(Bestand bestand) {
        switch (this) {
            case WEITERSCHAUEN: return nachRaum(bestand.weiterschauen(), false);
            case GEMEINSAM: return nachRaum(bestand.weiterschauen(), true);
            case WATCHLIST: return bestand.watchlist();
            case MEDIATHEK: return bestand.mediathek();
            default: return bestand.verlauf();
        }
    }

    /**
     * Angefangenes nach eigen und gemeinsam scheiden.
     *
     * <p>Die Ablage kennt den Unterschied nicht - sie fuehrt eine Liste. Er
     * steht am Eintrag: wer einen Raum hat, gehoert zu einer Watchparty.
     */
    static List<Favorite> nachRaum(List<Favorite> alle, boolean gemeinsam) {
        List<Favorite> gewaehlt = new ArrayList<>();
        for (Favorite eintrag : alle) {
            if (eintrag.watchpartyRaum().isEmpty() != gemeinsam) gewaehlt.add(eintrag);
        }
        return gewaehlt;
    }

    /**
     * Ob diese Liste Angefangenes zeigt - eigenes oder gemeinsames.
     *
     * <p>Die beiden unterscheidet nur, mit wem man schaut. Alles, was daran
     * haengt - "Naechste Folge:" statt der laufenden, der Punkt "Aus
     * Weiterschauen nehmen" -, gilt fuer beide, und diese Frage haelt es an
     * einer Stelle statt an dreien.
     */
    public boolean zeigtAngefangenes() {
        return this == WEITERSCHAUEN || this == GEMEINSAM;
    }

    /** Ob in dieser Liste der Fortschrittsbalken gehoert. */
    public boolean zeigtFortschritt() {
        return zeigtAngefangenes() || this == VERLAUF;
    }

    public static Bibliothek ausKennung(String kennung) {
        for (Bibliothek liste : values()) {
            if (liste.kennung.equals(kennung)) return liste;
        }
        return WEITERSCHAUEN;
    }
}
