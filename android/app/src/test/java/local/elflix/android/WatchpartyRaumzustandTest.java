package local.elflix.android;

import static org.junit.Assert.assertNotEquals;

import java.util.Arrays;
import java.util.Collections;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public final class WatchpartyRaumzustandTest {
    @Test public void leererRaumBeimErstenStartWirdAbgeglichen() {
        assertNotEquals("", Watchparty.raumzustandKennzeichen(new JSONArray(),
            Arrays.asList("runde"), 0));
    }

    @Test public void archivierungUndBeitrittAendernAuchOhneNeuenFortschrittDasKennzeichen() throws Exception {
        JSONObject titel = new JSONObject().put("key", "serie:tombraiderking")
            .put("room", "runde").put("joined", true);
        JSONArray eintraege = new JSONArray().put(titel);
        String vorher = Watchparty.raumzustandKennzeichen(eintraege, Arrays.asList("runde"), 0);
        titel.put("archived", true);
        String archiv = Watchparty.raumzustandKennzeichen(eintraege, Arrays.asList("runde"), 0);
        assertNotEquals(vorher, archiv);
        titel.put("joined", false);
        assertNotEquals(archiv, Watchparty.raumzustandKennzeichen(eintraege, Arrays.asList("runde"), 0));
    }

    @Test public void quittungUndEntfernungDesLetztenRaumsLoesenAbgleichAus() {
        JSONArray leer = new JSONArray();
        String vorQuittung = Watchparty.raumzustandKennzeichen(leer, Arrays.asList("runde"), 0);
        String quittiert = Watchparty.raumzustandKennzeichen(leer, Arrays.asList("runde"), 1);
        assertNotEquals(vorQuittung, quittiert);
        assertNotEquals(quittiert, Watchparty.raumzustandKennzeichen(leer, Collections.emptyList(), 1));
    }
}
