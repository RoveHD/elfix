package local.elflix.android;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Die Presence darf ausschliesslich aus einem aktuellen, sichtbaren WebView kommen. */
public class LiveGeraeteTest {

    @Test
    public void aktuellerVordergrundMesswertDarfLiveMelden() {
        assertTrue(MainActivity.webLiveIstAktuell(true, false, true, "provider",
            "https://aniworld.example/serie/staffel-1/folge-2",
            "https://aniworld.example/serie/staffel-1/folge-2"));
    }

    @Test
    public void spaeteAntwortAusDemHintergrundBelebtDiePresenceNicht() {
        assertFalse(MainActivity.webLiveIstAktuell(false, false, true, "provider",
            "https://aniworld.example/serie/staffel-1/folge-2",
            "https://aniworld.example/serie/staffel-1/folge-2"));
    }

    @Test
    public void alteOderNichtSichtbareSeiteDarfNichtLiveMelden() {
        assertFalse(MainActivity.webLiveIstAktuell(true, false, true, "provider",
            "https://aniworld.example/serie/staffel-1/folge-2",
            "https://aniworld.example/serie/staffel-1/folge-3"));
        assertFalse(MainActivity.webLiveIstAktuell(true, false, true, "home",
            "https://aniworld.example/serie/staffel-1/folge-2",
            "https://aniworld.example/serie/staffel-1/folge-2"));
    }
}
