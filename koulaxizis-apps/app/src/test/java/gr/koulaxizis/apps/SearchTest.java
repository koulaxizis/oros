package gr.koulaxizis.apps;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.junit.Test;

public class SearchTest {
    static AppInfo app(String pkg, String name, String summary, String description, String... cats) {
        AppInfo.Details d = new AppInfo.Details(description, Collections.emptyList(), Arrays.asList(cats),
            "MIT", null, null, null, 0);
        return new AppInfo("oros", pkg, name, summary, "1", 1, false, "https://x/" + pkg + ".apk",
            "b".repeat(64), 10, Collections.singleton("a".repeat(64)), null, null, null, d);
    }

    static List<Rows.Row> rows() throws Exception {
        Map<String, List<AppInfo>> byId = new HashMap<>();
        byId.put("oros", Arrays.asList(
            app("online.useoros.twa", "orOS", "Your workspace", null, "System"),
            app("online.useoros.notes", "Σημειώσεις orOS", "Σελίδες και λίστες", "Γράψτε σελίδες με Markdown.", "Writing"),
            app("online.useoros.budget", "orOS Budget", "Money in and out", "Accounts, <b>budgets</b> and reports.", "Money")));
        byId.put("nulljsfx", IndexParser.parse(RepoEntryTest.read("nulljsfx-index-v2.json"),
            RepoEntryTest.source("nulljsfx"), IndexParserTest.EN, 34, IndexParserTest.ARM, "x.y"));
        return Rows.build(Source.ALL, byId, new HashMap<>(), Locale.US);
    }

    static String names(List<Rows.Row> rows) {
        StringBuilder b = new StringBuilder();
        for (Rows.Row r : rows) b.append(r.kind == Rows.HEADER ? "H:" + r.source.title : r.kind == Rows.APP ? r.app.name
            : r.kind == Rows.SUB ? "S" : "N:" + r.note).append('|');
        return b.toString();
    }

    @Test
    public void foldIgnoresCaseAccentsFinalSigmaAndTags() {
        assertEquals("σημειωσεισ", Search.fold("ΣΗΜΕΙΏΣΕΙΣ"));
        assertEquals("σημειωσεισ", Search.fold("σημειώσεις"));
        assertEquals("cafe uber", Search.fold("  Café\n<b>Über</b> "));
        assertEquals(Arrays.asList("remote", "daws"), Search.words(" Remote  DAWs remote "));
        assertTrue(Search.words("   ").isEmpty());
    }

    @Test
    public void emptySearchIsTheHomeScreen() throws Exception {
        List<Rows.Row> all = rows();
        assertSame(all, Search.filter(all, Search.words(""), null));
    }

    @Test
    public void everyWordMustMatchNameSummaryDescriptionCategoryOrProject() throws Exception {
        List<Rows.Row> all = rows();
        // Greek without accents finds the Greek name; headers only for projects with a match.
        assertEquals("H:orOS|Σημειώσεις orOS|", names(Search.filter(all, Search.words("σημειωσεις"), null)));
        // The description counts, its tags do not.
        assertEquals("H:orOS|orOS Budget|", names(Search.filter(all, Search.words("budgets reports"), null)));
        assertEquals("", names(Search.filter(all, Search.words("b budgets"), null)).replace("H:orOS|orOS Budget|", ""));
        // The F-Droid category, and the translated one the screen adds.
        assertEquals("H:orOS|orOS Budget|", names(Search.filter(all, Search.words("money"), null)));
        assertEquals("H:orOS|orOS Budget|", names(Search.filter(all, Search.words("οικονομικα"),
            a -> a.details.categories.contains("Money") ? "Οικονομικά" : "")));
        // The project's name: every app of NULL JSFX, none of orOS.
        assertEquals("H:NULL JSFX|Remote for DAWs|Remote for Mixers|", names(Search.filter(all, Search.words("null jsfx"), null)));
        // The package name.
        assertEquals("H:orOS|orOS|", names(Search.filter(all, Search.words("useoros.twa"), null)));
        assertTrue(Search.filter(all, Search.words("budget daws"), null).isEmpty());
    }

    @Test
    public void matchesNeedsEveryWord() {
        assertTrue(Search.matches("remote for daws", Arrays.asList("rem", "daw")));
        assertFalse(Search.matches("remote for daws", Arrays.asList("rem", "mixer")));
    }
}
