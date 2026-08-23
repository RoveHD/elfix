package local.elflix.android;

import java.util.List;

/**
 * Die vier Listen und was sie unterscheidet.
 *
 * <p>Weiterschauen, Watchlist, Mediathek und Verlauf sind Blicke auf denselben
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
            case WEITERSCHAUEN: return bestand.weiterschauen();
            case WATCHLIST: return bestand.watchlist();
            case MEDIATHEK: return bestand.mediathek();
            default: return bestand.verlauf();
        }
    }

    /** Ob in dieser Liste der Fortschrittsbalken gehoert. */
    public boolean zeigtFortschritt() {
        return this == WEITERSCHAUEN || this == VERLAUF;
    }

    public static Bibliothek ausKennung(String kennung) {
        for (Bibliothek liste : values()) {
            if (liste.kennung.equals(kennung)) return liste;
        }
        return WEITERSCHAUEN;
    }
}
