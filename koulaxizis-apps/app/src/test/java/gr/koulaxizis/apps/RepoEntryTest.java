package gr.koulaxizis.apps;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.fail;

import java.io.File;
import java.io.InputStream;
import java.net.URL;
import java.nio.file.Files;

import org.junit.Test;

/** APPS-M1 rule 1: only an entry signed by the pinned key is used, and only the exact index it names. */
public class RepoEntryTest {
    static File fixture(String name) throws Exception {
        URL u = RepoEntryTest.class.getClassLoader().getResource("fixtures/" + name);
        return new File(u.toURI());
    }

    static Source source(String id) {
        for (Source s : Source.ALL) if (s.id.equals(id)) return s;
        throw new AssertionError(id);
    }

    @Test
    public void realRepositoriesVerifyWithTheirPinnedKey() throws Exception {
        RepoEntry n = RepoEntry.verify(fixture("nulljsfx-entry.jar"), source("nulljsfx").fingerprint);
        n.checkIndex(Files.readAllBytes(fixture("nulljsfx-index-v2.json").toPath()));
        assertEquals("/index-v2.json", n.indexName);
        RepoEntry x = RepoEntry.verify(fixture("noxpress-entry.jar"), source("noxpress").fingerprint);
        x.checkIndex(Files.readAllBytes(fixture("noxpress-index-v2.json").toPath()));
    }

    @Test
    public void anotherProjectsKeyIsRefused() throws Exception {
        expect(RepoException.SIGNATURE, fixture("nulljsfx-entry.jar"), source("noxpress").fingerprint);
        expect(RepoException.SIGNATURE, fixture("noxpress-entry.jar"), source("oros").fingerprint);
    }

    @Test
    public void unsignedOrForeignSignedEntryIsRefused() throws Exception {
        expect(RepoException.SIGNATURE, fixture("unsigned-entry.jar"), source("nulljsfx").fingerprint);
        expect(RepoException.SIGNATURE, fixture("otherkey-entry.jar"), source("nulljsfx").fingerprint);
    }

    @Test
    public void changedIndexIsRefused() throws Exception {
        RepoEntry n = RepoEntry.verify(fixture("nulljsfx-entry.jar"), source("nulljsfx").fingerprint);
        byte[] idx = Files.readAllBytes(fixture("nulljsfx-index-v2.json").toPath());
        idx[idx.length / 2] ^= 1;
        try {
            n.checkIndex(idx);
            fail();
        } catch (RepoException e) {
            assertEquals(RepoException.HASH, e.code);
        }
        try {
            n.checkIndex(java.util.Arrays.copyOf(idx, idx.length - 1));
            fail();
        } catch (RepoException e) {
            assertEquals(RepoException.HASH, e.code);
        }
    }

    @Test
    public void badIndexReferencesAreRefused() {
        String sha = "0".repeat(64);
        for (String bad : new String[] {
            "{\"timestamp\":1,\"index\":{\"name\":\"../x.json\",\"sha256\":\"" + sha + "\",\"size\":5}}",
            "{\"timestamp\":1,\"index\":{\"name\":\"/x.json\",\"sha256\":\"zz\",\"size\":5}}",
            "{\"timestamp\":1,\"index\":{\"name\":\"/x.json\",\"sha256\":\"" + sha + "\",\"size\":999999999999}}",
            "not json" }) {
            try {
                RepoEntry.parse(bad);
                fail(bad);
            } catch (RepoException expected) {
                // refused
            }
        }
    }

    @Test
    public void fingerprintsArePinnedHex() {
        for (Source s : Source.ALL) {
            assertEquals(s.id, true, s.fingerprint.matches("[0-9A-F]{64}"));
            assertEquals(s.id, true, s.address.startsWith("https://") && s.address.endsWith("/repo"));
        }
    }

    private static void expect(String code, File jar, String fp) {
        try {
            RepoEntry.verify(jar, fp);
            fail("accepted " + jar);
        } catch (RepoException e) {
            assertEquals(code, e.code);
        }
    }

    static String read(String name) throws Exception {
        try (InputStream in = RepoEntryTest.class.getClassLoader().getResourceAsStream("fixtures/" + name)) {
            return new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        }
    }
}
