package gr.koulaxizis.apps;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.junit.Test;

public class IndexParserTest {
    static final List<String> EN = Locales.chain(Collections.singletonList(Locale.US));
    static final List<String> EL = Locales.chain(Collections.singletonList(new Locale("el", "GR")));
    static final List<String> ARM = Arrays.asList("arm64-v8a", "armeabi-v7a");

    static AppInfo find(List<AppInfo> list, String pkg) {
        for (AppInfo a : list) if (a.pkg.equals(pkg)) return a;
        return null;
    }

    @Test
    public void realIndexGivesNewestVersionWithItsFileAndSigner() throws Exception {
        Source s = RepoEntryTest.source("nulljsfx");
        List<AppInfo> list = IndexParser.parse(RepoEntryTest.read("nulljsfx-index-v2.json"), s, EN, 34, ARM, "gr.koulaxizis.apps");
        assertEquals(2, list.size());
        AppInfo d = find(list, "tech.nulljsfx.remote.daws");
        assertEquals("Remote for DAWs", d.name);
        assertEquals("4.0", d.versionName);
        assertEquals(40000, d.versionCode);
        assertFalse(d.beta);
        assertEquals(s.address + "/tech.nulljsfx.remote.daws_40000_591b70a5.apk", d.apkUrl);
        assertEquals("591b70a5efba9b5f4c9e8db0606093d455de81cdb37b1d7686e6d1366bf043f9", d.apkSha256);
        assertTrue(d.signers.contains("21441e31a60a89708c6cece649390c1863ec8ca147f08da7399ae7646e02ee4e"));
        assertNotNull(d.iconUrl);
    }

    @Test
    public void tooOldAndroidOrOtherProcessorGetsNothing() throws Exception {
        Source s = RepoEntryTest.source("noxpress");
        String json = RepoEntryTest.read("noxpress-index-v2.json");
        assertEquals(2, IndexParser.parse(json, s, EN, 34, ARM, "x.y").size());
        assertEquals(0, IndexParser.parse(json, s, EN, 27, ARM, "x.y").size()); // minSdk 28
        List<AppInfo> mips = IndexParser.parse(json, s, EN, 34, Collections.singletonList("mips"), "x.y");
        assertNull(find(mips, "tech.noxpress.sitebridge")); // native code
        assertNotNull(find(mips, "tech.noxpress.liveoperator"));
    }

    @Test
    public void greekNamesWhereGiven() throws Exception {
        List<AppInfo> list = IndexParser.parse(RepoEntryTest.read("noxpress-index-v2.json"),
            RepoEntryTest.source("noxpress"), EL, 34, ARM, "x.y");
        assertEquals("Live Operator", find(list, "tech.noxpress.liveoperator").name);
        assertEquals(Arrays.asList("el-GR", "el", "en-US", "en"), EL);
    }

    @Test
    public void stableWinsOverNewerBetaAndBetaOnlyIsOffered() throws Exception {
        String sig = "\"signer\":{\"sha256\":[\"" + "a".repeat(64) + "\"]}";
        String v = "{\"file\":{\"name\":\"/%s.apk\",\"sha256\":\"" + "b".repeat(64) + "\",\"size\":10},"
            + "\"manifest\":{\"versionName\":\"%s\",\"versionCode\":%d," + sig + "}%s}";
        String beta = ",\"releaseChannels\":[\"Beta\"]";
        String json = "{\"packages\":{"
            + "\"a.one\":{\"metadata\":{\"name\":{\"en-US\":\"One\"}},\"versions\":{"
            + "\"1\":" + String.format(v, "one1", "1.0", 1, "") + ","
            + "\"2\":" + String.format(v, "one2", "2.0-b", 2, beta) + "}},"
            + "\"a.two\":{\"metadata\":{\"name\":{\"en-US\":\"Two\"}},\"versions\":{"
            + "\"3\":" + String.format(v, "two3", "0.9-b", 3, beta) + "}},"
            + "\"gr.koulaxizis.apps\":{\"metadata\":{},\"versions\":{\"4\":" + String.format(v, "self", "1", 1, "") + "}}"
            + "}}";
        List<AppInfo> list = IndexParser.parse(json, RepoEntryTest.source("oros"), EN, 34, ARM, "gr.koulaxizis.apps");
        assertEquals(2, list.size()); // never lists itself
        AppInfo one = find(list, "a.one");
        assertEquals("1.0", one.versionName);
        assertFalse(one.beta);
        AppInfo two = find(list, "a.two");
        assertEquals("0.9-b", two.versionName);
        assertTrue(two.beta);
    }

    @Test
    public void versionsWithoutSignerOrWithOddPathsAreSkipped() throws Exception {
        String json = "{\"packages\":{"
            + "\"a.nosig\":{\"metadata\":{},\"versions\":{\"1\":{\"file\":{\"name\":\"/a.apk\",\"sha256\":\"" + "b".repeat(64)
            + "\",\"size\":10},\"manifest\":{\"versionCode\":1}}}},"
            + "\"a.path\":{\"metadata\":{},\"versions\":{\"1\":{\"file\":{\"name\":\"https://evil.example/a.apk\",\"sha256\":\""
            + "b".repeat(64) + "\",\"size\":10},\"manifest\":{\"versionCode\":1,\"signer\":{\"sha256\":[\"" + "a".repeat(64) + "\"]}}}}}"
            + "}}";
        assertEquals(0, IndexParser.parse(json, RepoEntryTest.source("oros"), EN, 34, ARM, "x.y").size());
        assertNull(IndexParser.path("https://r/repo", "/../x.apk"));
        assertNull(IndexParser.path("https://r/repo", "//evil/x.apk"));
        assertEquals("https://r/repo/x.apk", IndexParser.path("https://r/repo", "/x.apk"));
    }

    @Test
    public void rowsGroupPerProjectFeaturedFirst() throws Exception {
        Source oros = RepoEntryTest.source("oros");
        String sig = "\"signer\":{\"sha256\":[\"" + "a".repeat(64) + "\"]}";
        StringBuilder sb = new StringBuilder("{\"packages\":{");
        String[][] apps = { {"online.useoros.notes", "orOS Notes"}, {"online.useoros.drive", "orOS Drive"},
            {"online.useoros.twa", "orOS"}, {"online.useoros.budget", "orOS Budget"} };
        for (int i = 0; i < apps.length; i++) {
            if (i > 0) sb.append(',');
            sb.append('"').append(apps[i][0]).append("\":{\"metadata\":{\"name\":{\"en-US\":\"").append(apps[i][1])
                .append("\"}},\"versions\":{\"1\":{\"file\":{\"name\":\"/").append(i).append(".apk\",\"sha256\":\"")
                .append("b".repeat(64)).append("\",\"size\":10},\"manifest\":{\"versionCode\":1,").append(sig).append("}}}}");
        }
        sb.append("}}");
        Map<String, List<AppInfo>> byId = new HashMap<>();
        byId.put("oros", IndexParser.parse(sb.toString(), oros, EN, 34, ARM, "x.y"));
        byId.put("nulljsfx", IndexParser.parse(RepoEntryTest.read("nulljsfx-index-v2.json"),
            RepoEntryTest.source("nulljsfx"), EN, 34, ARM, "x.y"));
        Map<String, String> errors = new HashMap<>();
        errors.put("noxpress", RepoException.NETWORK);
        List<Rows.Row> rows = Rows.build(Source.ALL, byId, errors, Locale.US);
        StringBuilder got = new StringBuilder();
        for (Rows.Row r : rows) {
            got.append(r.kind == Rows.HEADER ? "H:" + r.source.title : r.kind == Rows.SUB ? "S"
                : r.kind == Rows.NOTE ? "N:" + r.note : r.app.name).append('|');
        }
        assertEquals("H:orOS|orOS|orOS Drive|S|orOS Budget|orOS Notes|"
            + "H:NULL JSFX|Remote for DAWs|Remote for Mixers|"
            + "H:Noxpress|N:network|", got.toString());
    }

    @Test
    public void detailsGiveDescriptionScreenshotsCategoryLicenceAndLinks() throws Exception {
        List<AppInfo> list = IndexParser.parse(RepoEntryTest.read("nulljsfx-index-v2.json"),
            RepoEntryTest.source("nulljsfx"), EN, 34, ARM, "x.y");
        AppInfo d = find(list, "tech.nulljsfx.remote.daws");
        assertTrue(d.details.description.startsWith("Remote for DAWs puts"));
        assertTrue(d.details.categories.contains("Multimedia"));
        assertNotNull(d.details.license);
        assertTrue(d.details.sourceCode.startsWith("https://"));
        assertTrue(d.details.added > 0);
        assertTrue(d.details.screenshots.isEmpty());

        String sig = "\"signer\":{\"sha256\":[\"" + "a".repeat(64) + "\"]}";
        String shot = "{\"name\":\"/p/%s/phoneScreenshots/%d.jpg\",\"sha256\":\"" + "c".repeat(64) + "\",\"size\":%d}";
        String json = "{\"packages\":{\"a.one\":{\"metadata\":{\"name\":{\"en-US\":\"One\"},"
            + "\"description\":{\"en-US\":\"English text\",\"el\":\"Ελληνικό κείμενο\"},"
            + "\"categories\":[\"Office\",\"Office\",\"\"],\"license\":\"MIT\","
            + "\"webSite\":\"http://plain.example/\",\"sourceCode\":\"https://user@evil.example/\","
            + "\"screenshots\":{\"phone\":{\"en-US\":[" + String.format(shot, "en-US", 1, 100) + ","
            + String.format(shot, "en-US", 2, 9L * 1024 * 1024) + ",{\"name\":\"https://evil.example/x.jpg\",\"sha256\":\""
            + "c".repeat(64) + "\"}],"
            + "\"el\":[" + String.format(shot, "el", 1, 100) + "]}}},"
            + "\"versions\":{\"1\":{\"added\":1700000000000,\"file\":{\"name\":\"/a.apk\",\"sha256\":\"" + "b".repeat(64)
            + "\",\"size\":10},\"manifest\":{\"versionCode\":1," + sig + "}}}}}}";
        Source s = RepoEntryTest.source("oros");
        AppInfo en = IndexParser.parse(json, s, EN, 34, ARM, "x.y").get(0);
        assertEquals("English text", en.details.description);
        // Only the screenshot inside the repository and under the size cap.
        assertEquals(1, en.details.screenshots.size());
        assertEquals(s.address + "/p/en-US/phoneScreenshots/1.jpg", en.details.screenshots.get(0).url);
        assertEquals(Arrays.asList("Office"), en.details.categories);
        assertEquals("MIT", en.details.license);
        assertNull(en.details.webSite); // not https
        assertNull(en.details.sourceCode); // a user part in the address
        assertEquals(1700000000000L, en.details.added);
        AppInfo el = IndexParser.parse(json, s, EL, 34, ARM, "x.y").get(0);
        assertEquals("Ελληνικό κείμενο", el.details.description);
        assertEquals(s.address + "/p/el/phoneScreenshots/1.jpg", el.details.screenshots.get(0).url);
        // German phones get the English pictures.
        List<String> de = Locales.chain(java.util.Collections.singletonList(Locale.GERMANY));
        assertEquals(s.address + "/p/en-US/phoneScreenshots/1.jpg",
            IndexParser.parse(json, s, de, 34, ARM, "x.y").get(0).details.screenshots.get(0).url);
        assertEquals("https://useoros.online/notes/", IndexParser.https(" https://useoros.online/notes/ "));
        assertNull(IndexParser.https("https:// x"));
    }
}
