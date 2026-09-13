package local.elflix.android;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.lang.reflect.Method;

import org.junit.Test;

/** The AnimeFiller cache uses the generic atomic Kern cache route. */
public class KernZwischenspeicherTest {
    @Test
    public void erlaubtDenAnimeFillerCacheNamenAberKeinePfade() throws Exception {
        Method name = Kern.class.getDeclaredMethod("zwischenName", String.class);
        name.setAccessible(true);
        assertTrue((Boolean) name.invoke(null, "animefiller"));
        assertFalse((Boolean) name.invoke(null, "anime-filler"));
        assertFalse((Boolean) name.invoke(null, "../animefiller"));
    }
}
