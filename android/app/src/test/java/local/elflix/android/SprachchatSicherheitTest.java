package local.elflix.android;

import org.junit.Test;
import static org.junit.Assert.*;

public class SprachchatSicherheitTest {
    private static final String AUDIO = "android.webkit.resource.AUDIO_CAPTURE";
    private static final String VIDEO = "android.webkit.resource.VIDEO_CAPTURE";

    @Test public void nurEigeneHttpsOriginOhneFremdeAuthority() {
        assertTrue(SprachchatSicherheit.originErlaubt(SprachchatSicherheit.ORIGIN));
        assertTrue(SprachchatSicherheit.originErlaubt(SprachchatSicherheit.ORIGIN + "/"));
        for (String origin : new String[] { "https://aniworld.to", "http://appassets.androidplatform.net",
            "https://appassets.androidplatform.net.evil.test", "https://evil@appassets.androidplatform.net",
            "https://appassets.androidplatform.net:444", "https://appassets.androidplatform.net/assets/",
            "file:///android_asset/sprachchat/sprachchat.html", "null", "" }) {
            assertFalse(origin, SprachchatSicherheit.originErlaubt(origin));
        }
    }

    @Test public void ausschliesslichAudioNachExpliziterBewilligung() {
        assertTrue(SprachchatSicherheit.audioErlaubt(SprachchatSicherheit.ORIGIN, new String[] { AUDIO }, true));
        assertFalse(SprachchatSicherheit.audioErlaubt(SprachchatSicherheit.ORIGIN, new String[] { AUDIO }, false));
        assertFalse(SprachchatSicherheit.audioErlaubt("https://provider.test", new String[] { AUDIO }, true));
        assertFalse(SprachchatSicherheit.audioErlaubt(SprachchatSicherheit.ORIGIN, new String[] { AUDIO, VIDEO }, true));
        assertFalse(SprachchatSicherheit.audioErlaubt(SprachchatSicherheit.ORIGIN, new String[] { VIDEO }, true));
        assertFalse(SprachchatSicherheit.audioErlaubt(SprachchatSicherheit.ORIGIN, new String[0], true));
        assertFalse(SprachchatSicherheit.audioErlaubt(SprachchatSicherheit.ORIGIN, null, true));
    }

    @Test public void nurSprachAssetsKeinProviderNetzUndKeineTraversal() {
        assertTrue(SprachchatSicherheit.assetErlaubt(SprachchatSicherheit.SEITE));
        assertTrue(SprachchatSicherheit.assetErlaubt(SprachchatSicherheit.ORIGIN + "/assets/sprachchat/sprachchat.js"));
        for (String url : new String[] { "https://provider.test/script.js",
            SprachchatSicherheit.ORIGIN + "/assets/kern/kern.html",
            SprachchatSicherheit.ORIGIN + "/assets/sprachchat/../kern/kern.html",
            SprachchatSicherheit.ORIGIN + "/assets/sprachchat/%2e%2e/kern/kern.html",
            SprachchatSicherheit.SEITE + "?remote=https://evil.test",
            SprachchatSicherheit.ORIGIN + "/assets/sprachchat/unknown.js" }) {
            assertFalse(url, SprachchatSicherheit.assetErlaubt(url));
        }
    }
}
