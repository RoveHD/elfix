package local.elflix.android;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/**
 * Die Adresse des Relays, wie {@code metadaten.js} sie erwartet.
 *
 * <p>Eingestellt wird die Watchparty-Adresse - dieselbe Maschine, nur das
 * andere Protokoll. Eine zweite Einstellung wäre eine zweite Fehlerquelle;
 * dieselbe Ableitung steht am Rechner. Geprüft wird sie, weil ein falsch
 * abgeleiteter Wert nicht auffällt: die Empfehlungen laufen weiter, nur ohne
 * externe Metadaten, und der Unterschied ist von aussen keiner.
 */
public class EmpfehlungenTest {

    @Test
    public void leerBleibtLeer() {
        assertEquals("", Empfehlungen.relayFuerMetadaten(""));
        assertEquals("", Empfehlungen.relayFuerMetadaten(null));
        assertEquals("", Empfehlungen.relayFuerMetadaten("   "));
    }

    @Test
    public void ohneProtokollWirdHttps() {
        assertEquals("https://relay.example.org",
            Empfehlungen.relayFuerMetadaten("relay.example.org"));
    }

    @Test
    public void websocketWirdHttp() {
        assertEquals("http://relay.example.org",
            Empfehlungen.relayFuerMetadaten("ws://relay.example.org"));
        assertEquals("https://relay.example.org",
            Empfehlungen.relayFuerMetadaten("wss://relay.example.org"));
    }

    @Test
    public void abschliessendeSchraegstricheFallenWeg() {
        assertEquals("https://relay.example.org",
            Empfehlungen.relayFuerMetadaten("wss://relay.example.org///"));
    }

    @Test
    public void einPfadBleibtStehen() {
        assertEquals("https://relay.example.org/api",
            Empfehlungen.relayFuerMetadaten("wss://relay.example.org/api/"));
    }
}
