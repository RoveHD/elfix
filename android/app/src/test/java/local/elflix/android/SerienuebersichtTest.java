package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Die Filme-Registerkarte aus dem gemeinsamen Seitendaten-Skript bleibt auf Android erhalten. */
public class SerienuebersichtTest {

    @Test
    public void behaltetStaffelNullAlsFilmeUndNenntSieNieStaffelNull() {
        Serienuebersicht.Bestand bestand = Serienuebersicht.auswerten("{"
            + "\"titel\":\"Demon Slayer\",\"offeneStaffel\":0,"
            + "\"staffeln\":[{\"staffel\":0,\"url\":\"https://aniworld.test/filme\"},"
            + "{\"staffel\":1,\"url\":\"https://aniworld.test/staffel-1\"}],"
            + "\"folgen\":[{\"staffel\":0,\"folge\":1,\"url\":\"https://aniworld.test/film\",\"titel\":\"Mugen Train\"}]"
            + "}");

        assertEquals(2, bestand.staffeln.size());
        assertEquals(0, bestand.staffeln.get(0).nummer);
        assertEquals("Filme", Serienuebersicht.staffelName(bestand.staffeln.get(0).nummer));
        assertEquals("Filme  ·  Folge 1", bestand.folgen.get(0).unterschrift());
        assertFalse(bestand.folgen.get(0).unterschrift().contains("Staffel 0"));
        assertTrue(bestand.taugt());
    }

    @Test
    public void behaeltAnimeFillerBadgeUndRoheTitelAlternativenFuerDieAnreicherung() {
        Serienuebersicht.Bestand bestand = Serienuebersicht.auswerten("{"
            + "\"titel\":\"One Piece\",\"folgen\":[{\"staffel\":2,\"folge\":4,"
            + "\"url\":\"https://aniworld.test/anime/stream/one-piece/staffel-2/episode-4\","
            + "\"titel\":\"Der Titel\",\"titelAlternativen\":[\"The English Title\"],"
            + "\"filler\":{\"type\":\"filler\",\"label\":\"Filler\","
            + "\"source\":\"AnimeFillerList\"}}]}" );

        assertEquals("Filler", bestand.folgen.get(0).filler);
        assertEquals("The English Title", Serienuebersicht.alsJson(bestand)
            .optJSONArray("folgen").optJSONObject(0).optJSONArray("titelAlternativen").optString(0));
    }
}
