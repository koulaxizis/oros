package gr.koulaxizis.apps;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.Test;

public class UpdatesTest {
    private static final String OUR = "aa";
    private static final String OTHER = "bb";

    private static AppInfo offer(String src, String pkg, long code) {
        return new AppInfo(src, pkg, pkg, null, "v" + code, code, false, "https://x/" + pkg + ".apk",
            "00", 1, set(OUR), null, null, null);
    }

    private static Set<String> set(String... s) {
        return new HashSet<>(Arrays.asList(s));
    }

    private static Installed have(long code, String key) {
        return new Installed(code, "v" + code, set(key));
    }

    @Test
    public void onlyOlderCopiesSignedWithOurKeyAreUpdates() {
        Map<String, Installed> phone = new HashMap<>();
        phone.put("a.old", have(1, OUR));
        phone.put("a.same", have(2, OUR));
        phone.put("a.newer", have(9, OUR));
        phone.put("a.test", have(1, OTHER));
        List<AppInfo> offers = Arrays.asList(offer("oros", "a.old", 2), offer("oros", "a.same", 2),
            offer("oros", "a.newer", 2), offer("oros", "a.test", 2), offer("oros", "a.none", 2));
        List<AppInfo> got = Updates.pending(offers, phone::get);
        assertEquals(1, got.size());
        assertEquals("a.old", got.get(0).pkg);
    }

    @Test
    public void projectOrderAndEachPackageOnce() {
        List<Source> sources = Source.ALL;
        Map<String, List<AppInfo>> apps = new HashMap<>();
        apps.put("noxpress", Arrays.asList(offer("noxpress", "n.app", 3)));
        apps.put("oros", Arrays.asList(offer("oros", "o.app", 3), offer("oros", "n.app", 5)));
        Map<String, Installed> phone = new HashMap<>();
        phone.put("n.app", have(1, OUR));
        phone.put("o.app", have(1, OUR));
        List<AppInfo> got = Updates.pending(sources, apps, phone::get);
        assertEquals(2, got.size());
        assertEquals("o.app", got.get(0).pkg);
        assertEquals("n.app", got.get(1).pkg);
        assertEquals(5, got.get(1).versionCode); // first project that lists it
    }

    @Test
    public void selfOnlyWhenNewerAndSameKey() {
        AppInfo me = offer("oros", "gr.koulaxizis.apps", 10100);
        assertSame(me, Updates.self(me, have(10000, OUR)));
        assertNull(Updates.self(me, have(10100, OUR)));
        assertNull(Updates.self(me, have(10000, OTHER)));
        assertNull(Updates.self(me, null));
        assertNull(Updates.self(null, have(1, OUR)));
    }

    @Test
    public void keyChangesWithVersions() {
        List<AppInfo> a = Collections.singletonList(offer("oros", "a", 2));
        List<AppInfo> b = Collections.singletonList(offer("oros", "a", 3));
        assertEquals(Updates.key(a, null), Updates.key(a, null));
        assertNotEquals(Updates.key(a, null), Updates.key(b, null));
        assertNotEquals(Updates.key(a, null), Updates.key(a, offer("oros", "gr.koulaxizis.apps", 1)));
    }

    @Test
    public void newSetIsToldAtOnceAndTheSameSetAfterThreeDays() {
        long t = 1_800_000_000_000L;
        assertTrue(Updates.due("a:2", "", 0, t));             // never told
        assertTrue(Updates.due("a:2,b:5", "a:2", t, t + 1));  // a new update joined
        assertFalse(Updates.due("a:2", "a:2", t, t + Updates.AGAIN - 1));
        assertTrue(Updates.due("a:2", "a:2", t, t + Updates.AGAIN));
        assertTrue(Updates.due("a:2", "a:2", t, t - 1));      // clock went back
        assertTrue(Updates.due("a:2", "a:2", 0, t));          // told by 1.0-1.2.0 (no time kept)
    }
}
