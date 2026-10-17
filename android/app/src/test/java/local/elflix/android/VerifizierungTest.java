package local.elflix.android;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class VerifizierungTest {
    @Test public void verschwindendesTorOhneBeweisIstNichtGeloest() {
        assertFalse(Verifizierung.darfFortsetzen(false, false, true, true, false, 2));
    }

    @Test public void serverSitzungOderEchteNavigationBrauchenInhaltUndZweiFreieProben() {
        assertFalse(Verifizierung.darfFortsetzen(true, false, true, true, false, 1));
        assertTrue(Verifizierung.darfFortsetzen(true, false, true, true, false, 2));
        assertTrue(Verifizierung.darfFortsetzen(true, false, false, true, false, 2));
        assertTrue(Verifizierung.darfFortsetzen(false, true, true, true, false, 2));
        assertFalse(Verifizierung.darfFortsetzen(true, true, true, false, false, 3));
        assertFalse(Verifizierung.darfFortsetzen(false, true, false, true, false, 3));
        assertFalse(Verifizierung.darfFortsetzen(true, true, true, true, true, 3));
    }

    @Test public void skripteErkennenMehrereSignaleUndBleibenPassiv() {
        String zustand = Verifizierung.zustandScript();
        String maske = Verifizierung.maskierenScript();
        assertTrue(zustand.contains("just a moment"));
        assertTrue(zustand.contains("challenge-platform"));
        assertTrue(zustand.contains("cf-chl-"));
        assertTrue(maske.contains("data-elfix-verifizierung"));
        String alles = zustand + maske;
        assertFalse(alles.contains(".click()"));
        assertFalse(alles.contains("requestSubmit"));
        assertFalse(alles.contains("turnstile.render"));
        assertFalse(alles.contains("grecaptcha.execute"));
        assertFalse(alles.contains("window.open="));
    }
}
