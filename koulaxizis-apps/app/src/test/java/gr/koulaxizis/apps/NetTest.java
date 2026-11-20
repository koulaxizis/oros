package gr.koulaxizis.apps;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/** APPS-DL: APKs of our repositories go through the counter, nothing else does. */
public class NetTest {
    @Test
    public void ourApksGoThroughTheCounter() {
        assertEquals("https://apps.koulaxizis.workers.dev/null-jsfx-fdroid/repo/tech.nulljsfx.remote.daws_40100_db128791.apk",
            Net.counted("https://koulaxizis.github.io/null-jsfx-fdroid/repo/tech.nulljsfx.remote.daws_40100_db128791.apk"));
        for (Source s : Source.REPOS) {
            String u = s.address + "/a.b_1_00000000.apk";
            assertEquals(u.replace(Net.PAGES, Net.COUNTER), Net.counted(u));
        }
    }

    @Test
    public void indexesIconsAndOtherHostsDoNot() {
        assertNull(Net.counted("https://koulaxizis.github.io/oros-fdroid/repo/index-v2.json"));
        assertNull(Net.counted("https://koulaxizis.github.io/oros-fdroid/repo/entry.jar"));
        assertNull(Net.counted("https://example.org/repo/a.apk"));
        assertNull(Net.counted("https://koulaxizis.github.io/oros-fdroid/repo/../x.apk"));
        assertNull(Net.counted(null));
    }
}
