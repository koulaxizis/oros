package gr.koulaxizis.apps;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.Test;

/** Sections of one repository (APPS-M3: Glarolykoi from the orOS repository). */
public class SourceTest {
    private static AppInfo offer(String pkg) {
        return new AppInfo("oros", pkg, pkg, null, "1", 1, false, "https://x/" + pkg + ".apk",
            "00", 1, Collections.singleton("aa"), null, null, null);
    }

    private static List<String> pkgs(List<AppInfo> list) {
        List<String> out = new ArrayList<>();
        for (AppInfo a : list) out.add(a.pkg);
        return out;
    }

    private static Source byId(String id) {
        for (Source s : Source.ALL) if (s.id.equals(id)) return s;
        throw new AssertionError(id);
    }

    @Test
    public void glarolykoiIsASectionOfTheOrosRepository() {
        Source g = byId("glarolykoi");
        Source o = byId("oros");
        assertEquals("oros", g.from);
        assertEquals(o.address, g.address);
        assertEquals(o.fingerprint, g.fingerprint);
        assertTrue(g.only.contains("net.glarolykoi.android"));
        // Read once: only repositories are fetched
        assertFalse(Source.REPOS.contains(g));
        assertEquals(Arrays.asList("oros", "nulljsfx", "noxpress"), Arrays.asList(
            Source.REPOS.get(0).id, Source.REPOS.get(1).id, Source.REPOS.get(2).id));
        assertEquals(3, Source.REPOS.size());
        assertEquals("glarolykoi", Source.ALL.get(Source.ALL.size() - 1).id);
    }

    @Test
    public void sectionsSplitOneListAndShareItsError() {
        Map<String, List<AppInfo>> byRepo = new HashMap<>();
        byRepo.put("oros", Arrays.asList(offer("online.useoros.twa"), offer("net.glarolykoi.android"),
            offer("online.useoros.notes")));
        Map<String, List<AppInfo>> got = Source.sections(Source.ALL, byRepo);
        assertEquals(Arrays.asList("online.useoros.twa", "online.useoros.notes"), pkgs(got.get("oros")));
        assertEquals(Arrays.asList("net.glarolykoi.android"), pkgs(got.get("glarolykoi")));
        assertNull(got.get("nulljsfx"));
        // Rows: Glarolykoi has its own header with its app
        List<Rows.Row> rows = Rows.build(Source.ALL, got, new HashMap<>(), java.util.Locale.US);
        StringBuilder sb = new StringBuilder();
        for (Rows.Row r : rows) {
            if (r.kind == Rows.HEADER) sb.append("H:").append(r.source.title).append('|');
            else if (r.kind == Rows.APP) sb.append(r.app.pkg).append('|');
        }
        assertTrue(sb.toString(), sb.toString().endsWith("H:Glarolykoi|net.glarolykoi.android|"));

        Map<String, String> errs = new HashMap<>();
        errs.put("oros", RepoException.NETWORK);
        Map<String, String> e = Source.sectionErrors(Source.ALL, errs);
        assertEquals(RepoException.NETWORK, e.get("glarolykoi"));
        assertEquals(RepoException.NETWORK, e.get("oros"));
        assertNull(e.get("noxpress"));
    }
}
