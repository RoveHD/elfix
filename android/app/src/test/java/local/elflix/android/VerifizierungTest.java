package local.elflix.android;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class VerifizierungTest {
    @Test public void verschwindendesTorOhneBeweisIstNichtGeloest() {
        assertFalse(Verifizierung.darfFortsetzen(false, false, false, 2));
    }

    @Test public void tokenOderEchteNavigationBrauchenZweiFreieProben() {
        assertFalse(Verifizierung.darfFortsetzen(true, false, false, 1));
        assertTrue(Verifizierung.darfFortsetzen(true, false, false, 2));
        assertTrue(Verifizierung.darfFortsetzen(false, true, false, 2));
        assertFalse(Verifizierung.darfFortsetzen(true, true, true, 3));
    }

    @Test public void skripteTeilenStrikteTokenUndMaskenRegeln() {
        String zustand = Verifizierung.zustandScript();
        String maske = Verifizierung.maskierenScript();
        String weiter = Verifizierung.weiterScript();
        assertTrue(zustand.contains("just a moment"));
        assertTrue(maske.contains("data-elfix-verifizierung"));
        assertTrue(weiter.contains("if(!tor||!tor.token)"));
        assertFalse(weiter.contains("turnstile.render"));
        assertFalse(weiter.contains("grecaptcha.execute"));
    }
}
