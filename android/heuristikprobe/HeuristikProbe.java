// Im selben Paket, damit die reine Regel sichtbar ist, ohne sie nur fuer eine
// Probe oeffentlich zu machen.
package local.elflix.android;

/**
 * Wem ELFIX seinen Hauptrahmen ueberlaesst - und wem nicht.
 *
 * <p>Am 24.08.2026 auf AniWorld gemessen: ein Popunder auf
 * {@code blue-ribbonmacadamizeprovide.com} galt als Video-Player, weil der
 * Wirt die Zeichenfolge "vid" enthaelt - in "pro<b>vid</b>e". ELFIX lud ihn
 * daraufhin in den Hauptrahmen und gab ihm vier Weiterleitungen Budget; ueber
 * cruzswim.org ging es nach crmared.com, und die Folge war weg. Der Player
 * selbst hatte zu diesem Zeitpunkt laengst geladen - die weisse Seite war nie
 * der Player, sondern die Werbung.
 *
 * <p>Diese Probe haelt beide Seiten fest: die Hoster, die weiterhin
 * durchkommen muessen, und die Werbenamen, an denen sich der Fehler zeigte.
 * Ohne die erste Haelfte waere die Reparatur eine Verschaerfung, die den
 * Player mit erschlaegt.
 *
 * <p>Aufruf (aus dem Repo-Verzeichnis):
 * <pre>
 * javac -cp C:/tmp/android-sdk/platforms/android-35/android.jar \
 *   -d build/heuristikprobe \
 *   android/app/src/main/java/local/elflix/android/Adblocker.java \
 *   android/app/src/main/java/local/elflix/android/Provider.java \
 *   android/app/src/main/java/local/elflix/android/CrashReporter.java \
 *   android/heuristikprobe/HeuristikProbe.java
 * java -cp build/heuristikprobe HeuristikProbe
 * </pre>
 */
public final class HeuristikProbe {
    private static int gesamt = 0;
    private static int fehler = 0;

    private static void pruefe(String name, boolean erwartet, boolean bekommen) {
        gesamt += 1;
        boolean ok = erwartet == bekommen;
        if (!ok) fehler += 1;
        System.out.println((ok ? "OK   " : "FAIL ") + name
            + (ok ? "" : "   -> erwartet " + erwartet + ", bekommen " + bekommen));
    }

    private static void player(String host, String pfad) {
        pruefe("Player: " + host + pfad, true, Adblocker.istPlayerName(host, pfad));
    }

    private static void keinPlayer(String host, String pfad) {
        pruefe("Kein Player: " + host + pfad, false, Adblocker.istPlayerName(host, pfad));
    }

    public static void main(String[] args) {
        // --- Die Hoster, die weiterhin durchkommen muessen -------------------
        player("voe.sx", "/");
        player("v-o-e.sx", "/");
        player("vidmoly.to", "/embed-abc.html");
        player("vidoza.net", "/");
        player("vidsrc.me", "/");
        player("streamtape.com", "/e/xyz");
        player("streamwish.to", "/");
        player("streamsb.net", "/");
        player("lulustream.com", "/");
        player("filemoon.sx", "/");
        player("filelions.to", "/");
        player("dood.li", "/");
        player("mixdrop.co", "/");
        player("upstream.to", "/");
        player("supervideo.cc", "/");
        player("savefiles.com", "/");
        player("mp4upload.com", "/");
        player("player.example.com", "/");
        player("embed.example.net", "/");
        player("stream.example.org", "/");
        // Ein rotierender Wegwerf-Wirt wird ueber den Pfad erkannt, nicht ueber
        // den Namen - deshalb steht der Pfad ueberhaupt in der Regel.
        player("tracylocalschool.com", "/embed/28l8uviusy6y");
        player("irgendwas.com", "/video/abc.m3u8");
        player("irgendwas.com", "/stream/folge-1");

        // --- Und die Werbenamen, an denen der Fehler haengt -------------------
        //
        // Alle drei sind echt: so hiess die Kette, die am 24.08.2026 die Folge
        // verdraengt hat.
        keinPlayer("blue-ribbonmacadamizeprovide.com", "/7/99dd9bb003fcb3e33daff528a373c39a");
        keinPlayer("cruzswim.org", "/");
        keinPlayer("crmared.com", "/");
        // Dieselbe Falle in anderen Woertern - "vid" und "stream" kommen in
        // gewoehnlicher Sprache oft genug vor, und Werbenetze waehlen ihre
        // Namen danach aus.
        keinPlayer("evidence-tracker.com", "/");
        keinPlayer("individual-offers.net", "/");
        keinPlayer("providence-media.com", "/");
        keinPlayer("mainstreamads.com", "/");
        keinPlayer("livestreaming-deals.info", "/");
        keinPlayer("watchcolleague.com", "/");
        keinPlayer("omg10.com", "/");
        keinPlayer("blue-ribbon.example", "/7/abc");

        // Der Vergleich zwischen lockerer und strenger Fassung geht ueber
        // ganze Adressen und damit ueber android.net.Uri - auf einer nackten
        // JVM ist das ein Stummel, der wirft. Dass die Verdrahtung stimmt,
        // zeigt der Lauf auf dem Geraet.

        System.out.println();
        System.out.println((gesamt - fehler) + "/" + gesamt + " bestanden");
        System.exit(fehler == 0 ? 0 : 1);
    }
}
