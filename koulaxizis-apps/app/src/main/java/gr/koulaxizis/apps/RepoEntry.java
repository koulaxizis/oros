package gr.koulaxizis.apps;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.CodeSigner;
import java.security.cert.Certificate;
import java.security.cert.CertificateEncodingException;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * The signed entry point of an F-Droid repository (index-v2): entry.jar
 * holds entry.json, which names index-v2.json with its SHA-256 and size.
 * {@link #verify} accepts it only when entry.json is signed by the pinned
 * certificate (APPS-M1 rule 1).
 */
final class RepoEntry {
    final long timestamp;
    final String indexName;
    final String indexSha256;
    final long indexSize;

    private RepoEntry(long timestamp, String indexName, String indexSha256, long indexSize) {
        this.timestamp = timestamp;
        this.indexName = indexName;
        this.indexSha256 = indexSha256;
        this.indexSize = indexSize;
    }

    /** Index files above this are refused (orOS: 0.3 MB in Nov 2026). */
    static final long MAX_INDEX = 32L * 1024 * 1024;

    static RepoEntry verify(File jar, String fingerprint) throws RepoException {
        byte[] json;
        CodeSigner[] signers;
        try (JarFile jf = new JarFile(jar, true)) {
            JarEntry e = jf.getJarEntry("entry.json");
            if (e == null) throw new RepoException(RepoException.FORMAT, "no entry.json");
            try (InputStream in = jf.getInputStream(e)) {
                json = readAll(in, 1024 * 1024);
            }
            // Only known after the entry was read to its end.
            signers = e.getCodeSigners();
        } catch (SecurityException e) {
            throw new RepoException(RepoException.SIGNATURE, "bad jar signature", e);
        } catch (IOException e) {
            throw new RepoException(RepoException.FORMAT, "unreadable entry.jar", e);
        }
        if (signers == null || signers.length != 1) {
            throw new RepoException(RepoException.SIGNATURE, "entry.json not signed by exactly one key");
        }
        Certificate cert = signers[0].getSignerCertPath().getCertificates().get(0);
        String fp;
        try {
            fp = Hashes.sha256(cert.getEncoded());
        } catch (CertificateEncodingException e) {
            throw new RepoException(RepoException.SIGNATURE, "certificate", e);
        }
        if (!fp.equalsIgnoreCase(fingerprint)) {
            throw new RepoException(RepoException.SIGNATURE, "signed by " + fp);
        }
        return parse(new String(json, StandardCharsets.UTF_8));
    }

    static RepoEntry parse(String json) throws RepoException {
        try {
            JSONObject o = new JSONObject(json);
            JSONObject idx = o.getJSONObject("index");
            String name = idx.getString("name");
            String sha = idx.getString("sha256").toLowerCase(java.util.Locale.ROOT);
            long size = idx.getLong("size");
            if (!name.startsWith("/") || name.contains("..") || !sha.matches("[0-9a-f]{64}")) {
                throw new RepoException(RepoException.FORMAT, "index reference");
            }
            if (size <= 0 || size > MAX_INDEX) throw new RepoException(RepoException.TOO_BIG, "index size " + size);
            return new RepoEntry(o.getLong("timestamp"), name, sha, size);
        } catch (JSONException e) {
            throw new RepoException(RepoException.FORMAT, "entry.json", e);
        }
    }

    /** The index must be the exact file entry.json names. */
    void checkIndex(byte[] index) throws RepoException {
        if (index.length != indexSize) throw new RepoException(RepoException.HASH, "index size");
        if (!Hashes.sha256(index).equals(indexSha256)) throw new RepoException(RepoException.HASH, "index sha256");
    }

    static byte[] readAll(InputStream in, long max) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[64 * 1024];
        long total = 0;
        int n;
        while ((n = in.read(buf)) > 0) {
            total += n;
            if (total > max) throw new IOException("over " + max + " bytes");
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }
}
