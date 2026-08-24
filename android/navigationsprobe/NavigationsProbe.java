// Im selben Paket, damit die Regel pruefbar ist, ohne sie nur fuer eine Probe
// oeffentlich zu machen.
package local.elflix.android;

/**
 * Wer den Hauptrahmen bekommt - und warum AniWorld dabei nicht mehr weiss wird.
 *
 * <p>Der Fall, den diese Probe festhaelt, ist der gemeldete: auf AniWorld
 * erschien "Weiterleitung blockiert", und danach stand der Hauptrahmen leer.
 * Die Ursache war nicht die Sperre, sondern ihr Zeitpunkt. Ein Hoster-Klick gab
 * vier Spruenge Budget, und dieses Budget wurde verbraucht, <em>bevor</em>
 * irgendjemand nach dem Ziel gefragt hatte. Die Werbeskripte der Episodenseite
 * feuern genau dann; sie nahmen die vier Spruenge, und gesperrt wurde erst der
 * fuenfte - da war die Folgenseite drei Navigationen her.
 *
 * <p>Beide Haelften stehen hier, und die erste ist die wichtigere: ohne sie
 * waere die Reparatur eine Verschaerfung, die den Hoster mit erschlaegt.
 *
 * <p>Aufruf (aus dem Repo-Verzeichnis):
 * <pre>
 * javac -d build/navigationsprobe \
 *   android/app/src/main/java/local/elflix/android/Navigationswache.java \
 *   android/navigationsprobe/NavigationsProbe.java
 * java -cp build/navigationsprobe local.elflix.android.NavigationsProbe
 * </pre>
 */
public final class NavigationsProbe {
    private static int gesamt = 0;
    private static int fehler = 0;

    private static void pruefe(String name, boolean erwartet, boolean bekommen) {
        gesamt += 1;
        boolean ok = erwartet == bekommen;
        if (!ok) fehler += 1;
        System.out.println((ok ? "OK   " : "FAIL ") + name
            + (ok ? "" : "   -> erwartet " + erwartet + ", bekommen " + bekommen));
    }

    private static void gleich(String name, String erwartet, String bekommen) {
        gesamt += 1;
        boolean ok = erwartet.equals(bekommen);
        if (!ok) fehler += 1;
        System.out.println((ok ? "OK   " : "FAIL ") + name
            + (ok ? "" : "   -> erwartet " + erwartet + ", bekommen " + bekommen));
    }

    /** Die Adressen aus dem gemeldeten Fehler, damit die Probe nicht ausgedacht ist. */
    private static final String FOLGE = "https://aniworld.to/anime/stream/one-piece/staffel-1/episode-1";
    private static final String WEICHE = "https://aniworld.to/redirect/1234567";
    private static final String VOE = "https://voe.sx/e/abcdef";
    private static final String ROTIEREND = "https://nicolehappyoutside.com/e/abcdef";
    private static final String WERBUNG1 = "https://blue-ribbonmacadamizeprovide.com/7/99dd9bb";
    private static final String WERBUNG2 = "https://cruzswim.org/";
    private static final String WERBUNG3 = "https://crmared.com/";

    public static void main(String[] args) {
        werbungBleibtDraussenWaehrendDieSeitesteht();
        hosterKommtWeiterhinDurch();
        budgetLaeuftAb();
        eigeneNavigationKommtDurch();
        leereSeiteWirdErkannt();
        meldungWiederholtSichNicht();
        rettungSchaukeltSichNichtHoch();

        System.out.println();
        System.out.println((gesamt - fehler) + "/" + gesamt + " bestanden");
        System.exit(fehler == 0 ? 0 : 1);
    }

    /**
     * Der gemeldete Fehler.
     *
     * <p>Ein Hoster-Klick ist gerade passiert, das Budget steht also. Die
     * Werbung springt vom Skript aus einer Seite des Anbieters heraus. Vorher
     * nahm sie das Budget; jetzt kommt sie gar nicht erst hinein - und weil die
     * Sperre faellt, solange der Hauptrahmen noch auf der Folgenseite steht,
     * bleibt die Folgenseite stehen.
     */
    private static void werbungBleibtDraussenWaehrendDieSeitesteht() {
        System.out.println("-- Werbung von der Folgenseite aus --");
        Navigationswache wache = new Navigationswache();
        wache.ketteEroeffnen(1_000);

        // Quelle ist die Folgenseite (Erstpartei), kein Server sagt den Sprung an.
        Navigationswache.Urteil erst = wache.hauptnavigation(WERBUNG1, false, true, false, 1_100);
        pruefe("Werbesprung von der Folgenseite wird gesperrt", false, erst.erlaubt);
        gleich("... und zwar als Werbung", "werbung", erst.grund);

        // Und die Kette dahinter bekommt auch nichts: das Budget ist unangetastet.
        pruefe("Budget wurde nicht angeknabbert", true, wache.offenesBudget(1_100) == 4);
        pruefe("zweiter Werbesprung gesperrt", false,
            wache.hauptnavigation(WERBUNG2, false, true, false, 1_200).erlaubt);
        pruefe("dritter Werbesprung gesperrt", false,
            wache.hauptnavigation(WERBUNG3, false, true, false, 1_300).erlaubt);
    }

    /**
     * Und die andere Haelfte: der Hoster muss weiterhin aufgehen.
     *
     * <p>Der zweite Sprung der Kette kommt vom Skript und nicht vom Server
     * (gemessen: {@code voe.sx -> nicolehappyoutside.com} mit
     * {@code isRedirect()=false}). Genau deshalb gibt es das Budget ueberhaupt.
     */
    private static void hosterKommtWeiterhinDurch() {
        System.out.println("-- Der Hoster --");
        Navigationswache wache = new Navigationswache();

        // Klick auf den Hoster: gleiche Lasche, erst auf die Weiche des Anbieters.
        gleich("Weiche des Anbieters ist Erstpartei", "erstpartei",
            wache.hauptnavigation(WEICHE, true, true, false, 2_000).grund);
        // Deren Server leitet weiter - das eroeffnet die Kette.
        Navigationswache.Urteil hinaus = wache.hauptnavigation(VOE, false, true, true, 2_100);
        pruefe("302 der Weiche auf den Hoster kommt durch", true, hinaus.erlaubt);
        gleich("... als Weiche erkannt", "weiche", hinaus.grund);
        // Und der Sprung des Hosters auf seine rotierende Adresse, ohne 302.
        Navigationswache.Urteil rotation = wache.hauptnavigation(ROTIEREND, false, false, false, 2_200);
        pruefe("Rotationssprung des Hosters kommt durch", true, rotation.erlaubt);
        gleich("... als Kette erkannt", "kette", rotation.grund);

        // Zurueck zur Folge: immer erlaubt, egal was das Budget sagt.
        pruefe("zurueck zur Folgenseite", true,
            wache.hauptnavigation(FOLGE, true, false, false, 2_300).erlaubt);

        // Das Popup-Tor eines Hosters oeffnet dieselbe Kette.
        Navigationswache zweite = new Navigationswache();
        zweite.ketteEroeffnen(3_000);
        pruefe("nach dem Popup folgt der Hostersprung", true,
            zweite.hauptnavigation(ROTIEREND, false, false, false, 3_050).erlaubt);
    }

    /** Ein Budget, das eine halbe Minute alt ist, gehoert zu keiner Kette mehr. */
    private static void budgetLaeuftAb() {
        System.out.println("-- Ablauf --");
        Navigationswache wache = new Navigationswache();
        wache.ketteEroeffnen(10_000);
        pruefe("kurz danach: offen", true, wache.offenesBudget(11_000) > 0);
        pruefe("eine Minute spaeter: zu", true, wache.offenesBudget(70_000) == 0);
        pruefe("und der spaete Sprung wird gesperrt", false,
            wache.hauptnavigation(WERBUNG3, false, false, false, 70_000).erlaubt);

        // Auch der Vorrat ist endlich: fuenf Spruenge sind keine Kette mehr.
        Navigationswache kurz = new Navigationswache();
        kurz.ketteEroeffnen(0);
        for (int i = 1; i <= Navigationswache.BUDGET_SPRUENGE; i += 1) {
            pruefe("Kettensprung " + i + " erlaubt", true,
                kurz.hauptnavigation(ROTIEREND, false, false, false, 100L * i).erlaubt);
        }
        pruefe("Sprung " + (Navigationswache.BUDGET_SPRUENGE + 1) + " gesperrt", false,
            kurz.hauptnavigation(WERBUNG3, false, false, false, 900).erlaubt);
    }

    /** Was ELFIX selbst laedt, darf sich nicht an der eigenen Regel stossen. */
    private static void eigeneNavigationKommtDurch() {
        System.out.println("-- Eigene Navigation --");
        Navigationswache wache = new Navigationswache();
        wache.selbstGewaehlt(ROTIEREND, 5_000);
        gleich("selbst gewaehlte Adresse kommt durch", "selbst",
            wache.hauptnavigation(ROTIEREND, false, true, false, 5_100).grund);
        // Genau einmal - danach ist sie nichts Besonderes mehr.
        pruefe("aber kein Dauerausweis", false,
            wache.hauptnavigation(ROTIEREND, false, true, false, 5_200).erlaubt);

        Navigationswache alt = new Navigationswache();
        alt.selbstGewaehlt(ROTIEREND, 0);
        pruefe("und er verfaellt", false,
            alt.hauptnavigation(ROTIEREND, false, true, false, 60_000).erlaubt);

        Navigationswache zurueck = new Navigationswache();
        zurueck.ketteEroeffnen(6_000);
        zurueck.zuruecksetzen();
        pruefe("ein Anbieterwechsel beendet die Kette", true, zurueck.offenesBudget(6_100) == 0);
    }

    /**
     * Was als "da steht nichts" gilt.
     *
     * <p>Bewusst eng: eine Seite, die geladen hat, ist eine Seite. Waere hier
     * auch "fremder Wirt" gestrandet, floege der laufende Film beim naechsten
     * gesperrten Werbeversuch zurueck auf die Folgenseite - der Hoster liegt zu
     * dem Zeitpunkt auf einer Wegwerf-Adresse, die keinen Hosternamen traegt.
     */
    private static void leereSeiteWirdErkannt() {
        System.out.println("-- Leere Seite --");
        pruefe("about:blank ist gestrandet", true, Navigationswache.istGestrandet("about:blank"));
        pruefe("null ist gestrandet", true, Navigationswache.istGestrandet(null));
        pruefe("leer ist gestrandet", true, Navigationswache.istGestrandet("   "));
        pruefe("data: ist gestrandet", true, Navigationswache.istGestrandet("data:text/html,<b>x"));
        pruefe("Folgenseite ist nicht gestrandet", false, Navigationswache.istGestrandet(FOLGE));
        pruefe("Hoster ist nicht gestrandet", false, Navigationswache.istGestrandet(VOE));
        pruefe("rotierende Hosteradresse ist nicht gestrandet", false,
            Navigationswache.istGestrandet(ROTIEREND));
        // Auch eine Werbeseite, die wirklich geladen hat, gilt nicht als leer:
        // sie zurueckzuholen waere Aufgabe der Sperre davor, nicht der Rettung.
        pruefe("geladene Werbeseite gilt nicht als leer", false,
            Navigationswache.istGestrandet(WERBUNG2));
    }

    /** Fuenf Meldungen uebereinander erklaeren weniger als eine. */
    private static void meldungWiederholtSichNicht() {
        System.out.println("-- Meldungen --");
        Navigationswache wache = new Navigationswache();
        pruefe("erste Meldung kommt", true, wache.meldungFaellig("crmared.com", 0));
        pruefe("dieselbe gleich darauf nicht", false, wache.meldungFaellig("crmared.com", 500));
        pruefe("ein anderer Wirt gleich darauf auch nicht", false,
            wache.meldungFaellig("cruzswim.org", 800));
        pruefe("nach dem Abstand ein anderer Wirt schon", true,
            wache.meldungFaellig("cruzswim.org", 4_000));
        pruefe("der erste Wirt weiterhin nicht", false, wache.meldungFaellig("crmared.com", 8_000));
        pruefe("und nach der Wirtssperre wieder", true, wache.meldungFaellig("crmared.com", 30_000));
    }

    /** Eine Rettung, die eine Rettung ausloest, waere die Schleife von vorhin. */
    private static void rettungSchaukeltSichNichtHoch() {
        System.out.println("-- Rettung --");
        Navigationswache wache = new Navigationswache();
        pruefe("erste Rettung faellig", true, wache.rettungFaellig(0));
        pruefe("die naechste gleich darauf nicht", false, wache.rettungFaellig(1_000));
        pruefe("und nach dem Abstand wieder", true, wache.rettungFaellig(6_000));
    }
}
