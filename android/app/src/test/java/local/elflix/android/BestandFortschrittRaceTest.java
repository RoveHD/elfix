package local.elflix.android;

import static org.junit.Assert.assertEquals;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;

/** Verzögerte echte Bestand-Callbacks dürfen einen neueren Folgenstand nicht ersetzen. */
public class BestandFortschrittRaceTest {
    private static final String ID = "weise-leute";
    private static final String BASIS =
        "https://aniworld.to/anime/stream/wise-mans-grandchild/staffel-1/episode-";

    private FakeKern kern;
    private Speicher ablage;
    private Bestand bestand;
    private Provider provider;

    @Before
    public void vorbereiten() throws Exception {
        kern = new FakeKern();
        ablage = new Speicher(liste(eintrag(BASIS + "3", 180)));
        bestand = new Bestand(kern, ablage, null, null);
        bestand.laden();
        bestand.setzeAktivenEintrag(ID);
        provider = new Provider();
        provider.id = "aniworld";
        provider.name = "AniWorld";
        provider.startUrl = "https://aniworld.to";
    }

    @Test
    public void folgeDreiKannFolgeVierNichtMehrSpaetUeberschreiben() throws Exception {
        bestand.verbuchen(provider, BASIS + "3", messung(360), false);
        bestand.verbuchen(provider, BASIS + "4", messung(20), false);

        assertEquals("Nur der Kopf darf bereits im Kern laufen", 1,
            kern.anzahl("fortschritt.medienStandVerbuchen"));
        kern.nimm("fortschritt.medienStandVerbuchen")
            .antwort(fortschritt(eintrag(BASIS + "3", 360)));

        FakeKern.Aufruf folgeVier = kern.nimm("fortschritt.medienStandVerbuchen");
        assertEquals(BASIS + "3", folgeVier.argumente.getJSONObject(0)
            .getJSONArray("favoriten").getJSONObject(0).getString("url"));
        folgeVier.antwort(fortschritt(eintrag(BASIS + "4", 20)));

        assertEquals(BASIS + "4", ablage.aktuell().getJSONObject(0).getString("url"));
    }

    @Test
    public void geraeteAbgleichAufSpaetereFolgeVerwirftAlteMessung() throws Exception {
        bestand.verbuchen(provider, BASIS + "3", messung(360), false);
        FakeKern.Aufruf alt = kern.nimm("fortschritt.medienStandVerbuchen");

        bestand.setzeRoh(liste(eintrag(BASIS + "5", 25)));
        alt.antwort(fortschritt(eintrag(BASIS + "3", 360)));

        assertEquals(BASIS + "5", ablage.aktuell().getJSONObject(0).getString("url"));
        assertEquals(0, kern.anzahl("fortschritt.medienStandVerbuchen"));
    }

    @Test
    public void auchBereitsWartendeAlteMessungBleibtHinterGeraeteFolgeFuenf() throws Exception {
        bestand.verbuchen(provider, BASIS + "3", messung(350), false);
        bestand.verbuchen(provider, BASIS + "3", messung(360), false);
        FakeKern.Aufruf laufend = kern.nimm("fortschritt.medienStandVerbuchen");

        bestand.setzeRoh(liste(eintrag(BASIS + "5", 25)));
        laufend.antwort(fortschritt(eintrag(BASIS + "3", 350)));

        assertEquals(BASIS + "5", ablage.aktuell().getJSONObject(0).getString("url"));
        assertEquals("Auch der schon wartende E3-Stand muss verworfen sein", 0,
            kern.anzahl("fortschritt.medienStandVerbuchen"));
    }

    @Test
    public void alteAntwortSetztDenInzwischenAktivenEintragNichtZurueck() throws Exception {
        bestand.verbuchen(provider, BASIS + "3", messung(360), false);
        FakeKern.Aufruf alt = kern.nimm("fortschritt.medienStandVerbuchen");
        bestand.setzeAktivenEintrag("anderer-eintrag");
        alt.antwort(fortschritt(eintrag(BASIS + "3", 360)));

        bestand.verbuchen(provider, BASIS + "4", messung(20), false);
        FakeKern.Aufruf neu = kern.nimm("fortschritt.medienStandVerbuchen");
        assertEquals("anderer-eintrag",
            neu.argumente.getJSONObject(0).getString("aktiverFavoritId"));
    }

    @Test
    public void leereKernantwortBlockiertDieNaechsteMessungNicht() throws Exception {
        bestand.verbuchen(provider, BASIS + "3", messung(360), false);
        bestand.verbuchen(provider, BASIS + "4", messung(20), false);

        kern.nimm("fortschritt.medienStandVerbuchen").antwortLeer();
        kern.nimm("fortschritt.medienStandVerbuchen")
            .antwort(fortschritt(eintrag(BASIS + "4", 20)));

        assertEquals(BASIS + "4", ablage.aktuell().getJSONObject(0).getString("url"));
    }

    @Test
    public void spaeterRaumSnapshotWirdAufAktuelleFolgeNeuGerechnet() throws Exception {
        AtomicInteger fertig = new AtomicInteger();
        bestand.raumEintraegeSichern(new JSONArray(), fertig::incrementAndGet);
        FakeKern.Aufruf alterRaum = kern.nimm("watchparty-bruecke.raumEintraegeSichern");

        bestand.verbuchen(provider, BASIS + "4", messung(20), false);
        kern.nimm("fortschritt.medienStandVerbuchen")
            .antwort(fortschritt(eintrag(BASIS + "4", 20)));

        alterRaum.antwort(raumErgebnis(eintrag(BASIS + "3", 180)));
        assertEquals("Der veraltete Raumlauf ist noch nicht fertig", 0, fertig.get());
        assertEquals(BASIS + "4", ablage.aktuell().getJSONObject(0).getString("url"));

        FakeKern.Aufruf neuerRaum = kern.nimm("watchparty-bruecke.raumEintraegeSichern");
        assertEquals(BASIS + "4", neuerRaum.argumente.getJSONObject(0)
            .getJSONArray("favoriten").getJSONObject(0).getString("url"));
        JSONObject mitRaum = eintrag(BASIS + "4", 20).put("watchpartyRoom", "ABCD");
        neuerRaum.antwort(raumErgebnis(mitRaum));

        assertEquals(1, fertig.get());
        assertEquals(BASIS + "4", ablage.aktuell().getJSONObject(0).getString("url"));
    }

    @Test
    public void geraeteDeltaWirdNachPlayerstandAufAktuelleFolgeNeuAngewandt() throws Exception {
        JSONObject delta = batch("anderer-titel");
        bestand.geraeteAenderungenUebernehmen(delta);
        FakeKern.Aufruf altesDelta =
            kern.nimm("geraete-bruecke.aenderungenUebernehmen");

        bestand.verbuchen(provider, BASIS + "4", messung(20), false);
        kern.nimm("fortschritt.medienStandVerbuchen")
            .antwort(fortschritt(eintrag(BASIS + "4", 20)));
        altesDelta.antwort(geraeteErgebnis(eintrag(BASIS + "3", 180), true));

        assertEquals(BASIS + "4", ablage.aktuell().getJSONObject(0).getString("url"));
        FakeKern.Aufruf neu = kern.nimm("geraete-bruecke.aenderungenUebernehmen");
        assertEquals(BASIS + "4", neu.argumente.getJSONArray(0)
            .getJSONObject(0).getString("url"));
        JSONObject e4 = eintrag(BASIS + "4", 20).put("favorite", true);
        neu.antwort(geraeteErgebnis(e4, true));

        assertEquals(BASIS + "4", ablage.aktuell().getJSONObject(0).getString("url"));
        assertEquals(true, ablage.aktuell().getJSONObject(0).getBoolean("favorite"));
    }

    @Test
    public void geraeteBatchesLaufenInAnkunftsreihenfolgeUndAlsKopie() throws Exception {
        JSONObject erster = batch("eins");
        JSONObject zweiter = batch("zwei");
        bestand.geraeteAenderungenUebernehmen(erster);
        bestand.geraeteAenderungenUebernehmen(zweiter);

        assertEquals(1, kern.anzahl("geraete-bruecke.aenderungenUebernehmen"));
        zweiter.getJSONArray("aenderungen").getJSONObject(0).put("key", "nachtraeglich-veraendert");
        kern.nimm("geraete-bruecke.aenderungenUebernehmen")
            .antwort(geraeteErgebnis(eintrag(BASIS + "4", 20), true));

        FakeKern.Aufruf zweiterLauf =
            kern.nimm("geraete-bruecke.aenderungenUebernehmen");
        assertEquals("zwei", zweiterLauf.argumente.getJSONObject(1)
            .getJSONArray("aenderungen").getJSONObject(0).getString("key"));
        assertEquals(BASIS + "4", zweiterLauf.argumente.getJSONArray(0)
            .getJSONObject(0).getString("url"));
        zweiterLauf.antwort(geraeteErgebnis(eintrag(BASIS + "5", 25), true));
        assertEquals(BASIS + "5", ablage.aktuell().getJSONObject(0).getString("url"));
    }

    @Test
    public void fehlgeschlagenerGeraeteBatchBleibtVorDemNaechstenBisZumFortsetzen()
            throws Exception {
        bestand.geraeteAenderungenUebernehmen(batch("eins"));
        bestand.geraeteAenderungenUebernehmen(batch("zwei"));

        FakeKern.Aufruf ersterVersuch =
            kern.nimm("geraete-bruecke.aenderungenUebernehmen");
        assertEquals("eins", batchKey(ersterVersuch));
        ersterVersuch.antwortFehler("voruebergehend");
        assertEquals("Nach einem Fehler darf kein spaeterer Batch vorbeiziehen", 0,
            kern.anzahl("geraete-bruecke.aenderungenUebernehmen"));

        assertEquals("Wartende Deltas sperren den ausgehenden Bestandsabgleich", false,
            bestand.geraeteAenderungenFortsetzen());
        FakeKern.Aufruf ersterNeustart =
            kern.nimm("geraete-bruecke.aenderungenUebernehmen");
        assertEquals("Der fehlgeschlagene Kopf muss zuerst erneut laufen", "eins",
            batchKey(ersterNeustart));
        ersterNeustart.antwort(geraeteErgebnis(eintrag(BASIS + "4", 20), true));

        FakeKern.Aufruf zweiterLauf =
            kern.nimm("geraete-bruecke.aenderungenUebernehmen");
        assertEquals("zwei", batchKey(zweiterLauf));
        zweiterLauf.antwort(geraeteErgebnis(eintrag(BASIS + "5", 25), true));
        assertEquals(BASIS + "5", ablage.aktuell().getJSONObject(0).getString("url"));
        assertEquals("Nach dem Sichern darf der aktuelle Bestand hinaus", true,
            bestand.geraeteAenderungenFortsetzen());
    }

    @Test
    public void unlesbareGeraeteAntwortBehaeltDenBatchFuerSpaeterenVersuch()
            throws Exception {
        bestand.geraeteAenderungenUebernehmen(batch("kaputt"));
        kern.nimm("geraete-bruecke.aenderungenUebernehmen").antwortText("{");
        assertEquals(0, kern.anzahl("geraete-bruecke.aenderungenUebernehmen"));

        bestand.geraeteAenderungenFortsetzen();
        FakeKern.Aufruf neustart =
            kern.nimm("geraete-bruecke.aenderungenUebernehmen");
        assertEquals("kaputt", batchKey(neustart));
        neustart.antwort(geraeteErgebnis(eintrag(BASIS + "4", 20), true));
        assertEquals(BASIS + "4", ablage.aktuell().getJSONObject(0).getString("url"));
    }

    @Test
    public void geraetefehlerErholtSichOhneNeueMessungOderBedienung() throws Exception {
        ArrayDeque<Runnable> geplant = new ArrayDeque<>();
        bestand.setzeGeraeteFortsetzung(() -> geplant.addLast(
            () -> bestand.geraeteAenderungenFortsetzen()));
        bestand.geraeteAenderungenUebernehmen(batch("eins"));
        bestand.geraeteAenderungenUebernehmen(batch("zwei"));
        kern.nimm("geraete-bruecke.aenderungenUebernehmen").antwortFehler("voruebergehend");
        assertEquals(1, geplant.size());
        geplant.removeFirst().run();
        FakeKern.Aufruf erneut = kern.nimm("geraete-bruecke.aenderungenUebernehmen");
        assertEquals("eins", batchKey(erneut));
        erneut.antwort(geraeteErgebnis(eintrag(BASIS + "4", 20), true));
        FakeKern.Aufruf zweiter = kern.nimm("geraete-bruecke.aenderungenUebernehmen");
        assertEquals("zwei", batchKey(zweiter));
        zweiter.antwort(geraeteErgebnis(eintrag(BASIS + "5", 25), true));
        geplant.removeFirst().run();
        assertEquals(0, geplant.size());
        assertEquals(0, kern.anzahl("geraete-bruecke.aenderungenUebernehmen"));
        assertEquals(BASIS + "5", ablage.aktuell().getJSONObject(0).getString("url"));
    }

    @Test
    public void ersterGeraetefehlerPlantOhneBedienungEinenBegrenztenNachlauf() throws Exception {
        ArrayDeque<Runnable> geplant = new ArrayDeque<>();
        bestand.setzeGeraeteFortsetzung(() -> geplant.addLast(
            () -> bestand.geraeteAenderungenFortsetzen()));
        bestand.geraeteAenderungenUebernehmen(batch("eins"));
        bestand.geraeteAenderungenUebernehmen(batch("zwei"));
        kern.nimm("geraete-bruecke.aenderungenUebernehmen").antwortFehler("voruebergehend");

        assertEquals("Der erste Fehler plant selbst den normalen Folgeabgleich", 1, geplant.size());
        geplant.removeFirst().run();
        FakeKern.Aufruf nachlauf = kern.nimm("geraete-bruecke.aenderungenUebernehmen");
        assertEquals("eins", batchKey(nachlauf));
        nachlauf.antwortText("{");
        assertEquals("Dauerhaft unlesbare Antworten starten keine Endlosschleife", 0, geplant.size());
        assertEquals(0, kern.anzahl("geraete-bruecke.aenderungenUebernehmen"));

        // Ein neuer ausdruecklicher Abgleich darf denselben Kopf wiederholen.
        bestand.geraeteAenderungenFortsetzen();
        kern.nimm("geraete-bruecke.aenderungenUebernehmen")
            .antwort(geraeteErgebnis(eintrag(BASIS + "4", 20), true));
        FakeKern.Aufruf zweiter = kern.nimm("geraete-bruecke.aenderungenUebernehmen");
        assertEquals("zwei", batchKey(zweiter));
        zweiter.antwort(geraeteErgebnis(eintrag(BASIS + "5", 25), true));
        assertEquals(1, geplant.size());
        geplant.removeFirst().run();
        assertEquals(0, kern.anzahl("geraete-bruecke.aenderungenUebernehmen"));
        assertEquals(BASIS + "5", ablage.aktuell().getJSONObject(0).getString("url"));
    }

    @Test
    public void wartenderGeraeteBatchStartetBeiKernBereitschaft() throws Exception {
        kern.setzeBereit(false);
        bestand.geraeteAenderungenUebernehmen(batch("wartend"));
        assertEquals(0, kern.anzahl("geraete-bruecke.aenderungenUebernehmen"));

        kern.setzeBereit(true);
        FakeKern.Aufruf lauf = kern.nimm("geraete-bruecke.aenderungenUebernehmen");
        assertEquals("wartend", batchKey(lauf));
        lauf.antwort(geraeteErgebnis(eintrag(BASIS + "4", 20), true));
        assertEquals(BASIS + "4", ablage.aktuell().getJSONObject(0).getString("url"));
    }

    @Test
    public void raumAbdruckWirdNurNachGueltigerAntwortBestaetigt() throws Exception {
        AtomicReference<Boolean> fehlgeschlagen = new AtomicReference<>();
        bestand.raumEintraegeSichern(new JSONArray(),
            (Boolean erfolgreich) -> fehlgeschlagen.set(erfolgreich));
        kern.nimm("watchparty-bruecke.raumEintraegeSichern").antwortText("{");
        assertEquals(Boolean.FALSE, fehlgeschlagen.get());

        AtomicReference<Boolean> gelungen = new AtomicReference<>();
        bestand.raumEintraegeSichern(new JSONArray(),
            (Boolean erfolgreich) -> gelungen.set(erfolgreich));
        kern.nimm("watchparty-bruecke.raumEintraegeSichern")
            .antwort(raumErgebnis(eintrag(BASIS + "3", 180)));
        assertEquals(Boolean.TRUE, gelungen.get());
    }

    private static JSONObject messung(double position) throws Exception {
        return new JSONObject().put("currentTime", position).put("duration", 1400)
            .put("watchedSeconds", 180).put("progress", Math.round(position / 14));
    }

    private static JSONObject eintrag(String url, double position) throws Exception {
        return new JSONObject().put("id", ID).put("providerId", "aniworld")
            .put("providerName", "AniWorld").put("title", "wise-mans-grandchild")
            .put("type", "serie").put("url", url).put("normalizedUrl", url)
            .put("currentTime", position).put("position", position).put("duration", 1400)
            .put("progress", Math.round(position / 14)).put("favorite", false)
            .put("completed", false).put("watchpartyRoom", "");
    }

    private static JSONArray liste(JSONObject eintrag) {
        return new JSONArray().put(eintrag);
    }

    private static JSONObject fortschritt(JSONObject eintrag) throws Exception {
        return new JSONObject().put("favoriten", liste(eintrag)).put("eintrag", eintrag)
            .put("meldungen", new JSONArray()).put("diagnosen", new JSONArray());
    }

    private static JSONObject raumErgebnis(JSONObject eintrag) throws Exception {
        return new JSONObject().put("favoriten", liste(eintrag)).put("geaendert", true)
            .put("angelegt", 0).put("gesichert", new JSONArray());
    }

    private static JSONObject geraeteErgebnis(JSONObject eintrag, boolean geaendert)
            throws Exception {
        return new JSONObject().put("favoriten", liste(eintrag)).put("geaendert", geaendert);
    }

    private static JSONObject batch(String key) throws Exception {
        return new JSONObject().put("aenderungen", new JSONArray()
            .put(new JSONObject().put("key", key).put("vorher", JSONObject.NULL)
                .put("stand", new JSONObject().put("id", key))));
    }

    private static String batchKey(FakeKern.Aufruf aufruf) throws Exception {
        return aufruf.argumente.getJSONObject(1).getJSONArray("aenderungen")
            .getJSONObject(0).getString("key");
    }

    private static final class Speicher implements Bestand.Ablage {
        private JSONArray daten;

        Speicher(JSONArray daten) { this.daten = kopie(daten); }
        @Override public JSONArray laden() { return kopie(daten); }
        @Override public void speichern(JSONArray eintraege) { daten = kopie(eintraege); }
        JSONArray aktuell() { return kopie(daten); }

        private static JSONArray kopie(JSONArray wert) {
            try { return new JSONArray(wert.toString()); }
            catch (Exception fehler) { throw new AssertionError(fehler); }
        }
    }

    private static final class FakeKern implements Bestand.KernZugang {
        private final ArrayDeque<Aufruf> offen = new ArrayDeque<>();
        private final List<Runnable> bereitAufgaben = new ArrayList<>();
        private boolean bereit = true;

        @Override public boolean istBereit() { return bereit; }

        @Override public void wennBereit(Runnable aufgabe) {
            if (bereit) aufgabe.run();
            else bereitAufgaben.add(aufgabe);
        }

        void setzeBereit(boolean wert) {
            bereit = wert;
            if (!wert) return;
            List<Runnable> aufgaben = new ArrayList<>(bereitAufgaben);
            bereitAufgaben.clear();
            for (Runnable aufgabe : aufgaben) aufgabe.run();
        }

        @Override public void rufe(String pfad, JSONArray argumente, Kern.Antwort antwort) {
            if (antwort == null) return;
            if ("watchlist.schluesselJeEintrag".equals(pfad)) {
                antwort.fertig("{}", null);
                return;
            }
            if ("geraete-stand.geseheneNachschubHinweise".equals(pfad)) {
                antwort.fertig("[]", null);
                return;
            }
            offen.addLast(new Aufruf(pfad, kopie(argumente), antwort));
        }

        @Override public void rufe(String pfad, Kern.Antwort antwort) {
            rufe(pfad, new JSONArray(), antwort);
        }

        int anzahl(String pfad) {
            int anzahl = 0;
            for (Aufruf aufruf : offen) if (pfad.equals(aufruf.pfad)) anzahl += 1;
            return anzahl;
        }

        Aufruf nimm(String pfad) {
            for (Iterator<Aufruf> lauf = offen.iterator(); lauf.hasNext(); ) {
                Aufruf aufruf = lauf.next();
                if (!pfad.equals(aufruf.pfad)) continue;
                lauf.remove();
                return aufruf;
            }
            throw new AssertionError("Kein offener Aufruf: " + pfad);
        }

        private static JSONArray kopie(JSONArray wert) {
            try { return new JSONArray(wert.toString()); }
            catch (Exception fehler) { throw new AssertionError(fehler); }
        }

        static final class Aufruf {
            final String pfad;
            final JSONArray argumente;
            final Kern.Antwort rueckweg;

            Aufruf(String pfad, JSONArray argumente, Kern.Antwort rueckweg) {
                this.pfad = pfad;
                this.argumente = argumente;
                this.rueckweg = rueckweg;
            }

            void antwort(JSONObject wert) { rueckweg.fertig(wert.toString(), null); }
            void antwortLeer() { rueckweg.fertig(null, null); }
            void antwortText(String wert) { rueckweg.fertig(wert, null); }
            void antwortFehler(String fehler) { rueckweg.fertig(null, fehler); }
        }
    }
}
