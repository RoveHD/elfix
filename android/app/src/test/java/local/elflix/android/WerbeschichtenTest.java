package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Die Regeln der Fernseh-Werbeentfernung - ohne Fernseher.
 *
 * <p>Was hier geprueft wird, ist der Teil, an dem ein Fehler weh tut: welche
 * Auswahl auf welcher Seite gilt und welche nie. Eine Regel, die das
 * Episodenmenue trifft, faellt nicht als Werbung auf, sondern als kaputte
 * Seite - und sie faellt erst auf dem Geraet auf, wenn niemand sie vorher
 * gefragt hat.
 *
 * <p>Das Verhalten im Dokument selbst laesst sich hier nicht pruefen: dafuer
 * braucht es ein DOM. Die Punktevergabe und der Beobachter sind deshalb
 * bewusst in einer einzigen Zeichenkette gebaut, die sich herausziehen und
 * gegen eine nachgebaute Seite laufen lassen laesst.
 */
public class WerbeschichtenTest {

    @Test
    public void erkenntDieAnbieterAmNamenUndAnDerAdresse() {
        assertEquals(Werbeschichten.ANIWORLD,
            Werbeschichten.kennung("AniWorld", "https://aniworld.to/"));
        // Der Anbieter zieht um; der Name bleibt.
        assertEquals(Werbeschichten.ANIWORLD,
            Werbeschichten.kennung("AniWorld", "https://186.2.175.5/"));
        // Und umgekehrt: der Name ist frei gewaehlt, die Adresse nicht.
        assertEquals(Werbeschichten.ANIWORLD,
            Werbeschichten.kennung("Anime", "https://aniworld.to/animes"));
        assertEquals(Werbeschichten.STO, Werbeschichten.kennung("s.to", "https://s.to/"));
        assertEquals(Werbeschichten.FILMO, Werbeschichten.kennung("Filmo", "https://filmo.to/"));
        assertEquals("", Werbeschichten.kennung("Irgendwer", "https://beispiel.de/"));
        assertEquals("", Werbeschichten.kennung(null, null));
    }

    @Test
    public void jedeSeiteBekommtNurIhreEigenenRegeln() {
        String aniworld = Werbeschichten.schutzRegeln(Werbeschichten.ANIWORLD);
        String filmo = Werbeschichten.schutzRegeln(Werbeschichten.FILMO);
        // Was AniWorld schuetzt, kennt filmo.to nicht - und umgekehrt. Eine
        // gemeinsame Liste waere der Weg, auf dem eine Regel des einen
        // Anbieters beim anderen etwas trifft.
        assertTrue(aniworld.contains(".changeLanguageBox"));
        assertFalse(filmo.contains(".changeLanguageBox"));
        assertTrue(filmo.contains(".provider-frame"));
        assertFalse(aniworld.contains(".provider-frame"));
        // Der allgemeine Satz steht in beiden.
        assertTrue(aniworld.contains("video"));
        assertTrue(filmo.contains("video"));
    }

    @Test
    public void derSchutzHaeltPlayerCaptchaUndAnmeldungFest() {
        for (String kennung : new String[]{Werbeschichten.ANIWORLD, Werbeschichten.STO,
            Werbeschichten.FILMO, ""}) {
            String schutz = Werbeschichten.schutzRegeln(kennung);
            assertTrue(kennung + ": Video", schutz.contains("video"));
            assertTrue(kennung + ": Formular", schutz.contains("form"));
            assertTrue(kennung + ": Captcha", schutz.contains("captcha"));
            assertTrue(kennung + ": Turnstile", schutz.contains("turnstile"));
            assertTrue(kennung + ": Anmeldung", schutz.contains("login"));
        }
    }

    @Test
    public void aniworldSchuetztFolgenSpracheUndHoster() {
        String schutz = Werbeschichten.schutzRegeln(Werbeschichten.ANIWORLD);
        for (String noetig : new String[]{"#stream", ".hosterSiteVideo", ".hosterSiteDirectNav",
            ".inSiteWebStream", ".changeLanguageBox", ".watchEpisode", ".episodeList"}) {
            assertTrue("fehlt: " + noetig, schutz.contains(noetig));
        }
    }

    /**
     * Die Bedingung aus der Aufgabe: nicht nach allgemeinen Woertern filtern.
     *
     * <p>Geprueft wird sie an der Verstecklisten - der einzigen Stelle, die
     * ohne jede weitere Pruefung ausblendet. Ein Eintrag darf ein allgemeines
     * Wort enthalten ({@code iframe[src*="/ads/"]}), aber er darf nicht
     * daraus bestehen: {@code .banner} traefe den Kopf einer Anbieterseite.
     */
    @Test
    public void versteckenNiemalsAlleinNachAllgemeinenWoertern() {
        Set<String> verboten = new HashSet<>(Arrays.asList(
            ".banner", "#banner", ".popup", "#popup", ".overlay", "#overlay",
            ".ad", "#ad", ".ads", "#ads", ".werbung-container", ".modal", "#modal",
            ".notification", "#notification", ".sticky", "#sticky", "iframe", "div"));
        for (String kennung : new String[]{Werbeschichten.ANIWORLD, Werbeschichten.STO,
            Werbeschichten.FILMO, ""}) {
            for (String regel : Werbeschichten.versteckRegeln(kennung).split(",")) {
                assertFalse("zu allgemein: " + regel + " (" + kennung + ")",
                    verboten.contains(regel.trim()));
            }
        }
    }

    /** Kein Anbietersatz darf leerlaufen, und keiner darf den anderen enthalten. */
    @Test
    public void anbietersaetzeStehenGetrennt() {
        List<String> aniworld = Werbeschichten.anbieterSchuetzen(Werbeschichten.ANIWORLD);
        List<String> filmo = Werbeschichten.anbieterSchuetzen(Werbeschichten.FILMO);
        assertFalse(aniworld.isEmpty());
        assertFalse(filmo.isEmpty());
        assertTrue(java.util.Collections.disjoint(aniworld, filmo));
        assertTrue(Werbeschichten.anbieterSchuetzen("unbekannt").isEmpty());
        assertTrue(Werbeschichten.anbieterVerstecken("unbekannt").isEmpty());
    }

    @Test
    public void dasSkriptTraegtRegelnWirteUndSchwelle() {
        String skript = Werbeschichten.skript(Werbeschichten.ANIWORLD,
            Arrays.asList("doubleclick.net", "popads.net"), false);
        assertTrue(skript.contains("\"doubleclick.net\""));
        assertTrue(skript.contains("\"popads.net\""));
        assertTrue(skript.contains("var SCHWELLE=" + Werbeschichten.SCHWELLE + ";"));
        assertTrue(skript.contains("var HOECHST=" + Werbeschichten.HOECHSTPRUEFUNGEN + ";"));
        assertTrue(skript.contains("#stream"));
        assertTrue(skript.contains("MutationObserver"));
        // Die Wache gegen mehrfaches Einspielen - sonst haengen nach drei
        // Seitenwechseln drei Beobachter am selben Dokument.
        assertTrue(skript.contains("__elfixTvWerbungV1"));
        // Im Release schreibt es nichts in die Konsole.
        assertTrue(skript.contains("var MELDEN=false;"));
        assertTrue(Werbeschichten.skript("", null, true).contains("var MELDEN=true;"));
    }

    /**
     * Der Rahmen ohne Quelle - die Karte oben rechts aus Issue #7.
     *
     * <p>Gemessen am 26.08.2026 auf AniWorld, auf dem Fire TV und auf dem
     * Telefon: ein {@code <iframe>} ohne src, ohne id, ohne Klasse, an
     * {@code <html>} gehaengt, fest in der Ecke und auf Ebene 2147483647. Alles,
     * woran die Punktevergabe ein Element erkennt - Name, Text, Ziel - steht in
     * seinem <em>eigenen</em> Dokument und ist von aussen nicht zu lesen; er
     * kam damit auf zwei von vier Punkten und blieb stehen.
     *
     * <p>Geprueft wird hier, dass die Frage im Skript steht und <em>vor</em> der
     * Punktevergabe gestellt wird. Wie sie sich in einem echten Dokument
     * verhaelt, kann diese Stelle nicht sagen - dafuer gibt es kein DOM. Das
     * gehoert auf ein Geraet.
     */
    @Test
    public void dasSkriptKenntDenRahmenOhneQuelle() {
        String skript = Werbeschichten.skript(Werbeschichten.ANIWORLD, null, false);
        assertTrue(skript.contains("function rahmenschicht(el)"));
        assertTrue(skript.contains("function ohneQuelle(el)"));
        // Die drei Bedingungen, ohne die die Regel den Player traefe.
        assertTrue(skript.contains("el.tagName!=='IFRAME'"));
        assertTrue(skript.contains("if(!ohneQuelle(el))return false;"));
        assertTrue(skript.contains("var RAHMEN_EBENE=1000;"));
        // about:blank ist keine Adresse - der haeufigste Fall in freier Wildbahn.
        assertTrue(skript.contains("about:blank"));
        // Vor der Punktevergabe, sonst waere die Regel wirkungslos: die
        // Punktevergabe kommt an diesem Element nie ueber zwei.
        int rahmen = skript.indexOf("if(rahmenschicht(el))");
        int punkte = skript.indexOf("var urteil=punkte(el,spaet);");
        assertTrue(rahmen > 0 && punkte > 0 && rahmen < punkte);
        // Und nach dem Schutz: was geschuetzt ist, wird gar nicht erst gefragt.
        int schutz = skript.indexOf("if(geschuetzt(el))return;");
        assertTrue(schutz > 0 && schutz < rahmen);
    }

    /** Ohne bekannte Wirte bleibt die Liste leer - und das Skript trotzdem lesbar. */
    @Test
    public void skriptOhneWirteBleibtGueltig() {
        String skript = Werbeschichten.skript("", null, false);
        assertTrue(skript.contains("var WIRTE=[];"));
        assertTrue(skript.startsWith("(function(){"));
        assertTrue(skript.endsWith("})();"));
    }

    /**
     * Das Skript darf nicht in den Rahmen des Hosters.
     *
     * <p>Die eine Aenderung dieser Arbeit, die das Video kosten koennte -
     * deshalb steht sie hier als Pruefung und nicht nur als Kommentar.
     */
    @Test
    public void dasSkriptGehtNurAufDieSeiteDesAnbieters() {
        Provider aniworld = new Provider();
        aniworld.startUrl = "https://aniworld.to/";
        Set<String> regeln = Werbeschichten.wirtRegeln(aniworld);
        assertTrue(regeln.contains("https://aniworld.to"));
        assertTrue(regeln.contains("https://*.aniworld.to"));
        assertEquals(2, regeln.size());
        // Kein Platzhalter fuer alles: der waere genau der Rahmen des Hosters.
        assertFalse(regeln.contains("*"));

        // Ein Port gehoert nicht in die Regel, eine Anmeldung erst recht nicht.
        assertTrue(Werbeschichten.wirtRegeln("https://s.to:8443/serie/stream")
            .contains("https://s.to"));
        assertTrue(Werbeschichten.wirtRegeln("https://wer:was@filmo.to/")
            .contains("https://filmo.to"));

        Provider ohne = new Provider();
        ohne.startUrl = "";
        assertTrue(Werbeschichten.wirtRegeln(ohne).isEmpty());
        assertTrue(Werbeschichten.wirtRegeln((Provider) null).isEmpty());
        assertTrue(Werbeschichten.wirtRegeln((String) null).isEmpty());
        // Alles, was kein http(s) ist, bekommt gar keine Regel - ein
        // Platzhalter durch die Hintertuer waere genau der Rahmen des Hosters.
        assertTrue(Werbeschichten.wirtRegeln("file:///android_asset/x.html").isEmpty());
        assertTrue(Werbeschichten.wirtRegeln("aniworld.to").isEmpty());
        assertTrue(Werbeschichten.wirtRegeln("https://*/").isEmpty());
    }

    @Test
    public void zeichenkettenGehenUnbeschadetInsSkript() {
        assertEquals("\"a,b\"", Werbeschichten.jsText("a,b"));
        assertEquals("\"[id^=\\\"ad_\\\"]\"", Werbeschichten.jsText("[id^=\"ad_\"]"));
        assertEquals("\"a\\\\b\"", Werbeschichten.jsText("a\\b"));
        assertEquals("\"\"", Werbeschichten.jsText(null));
    }
}
