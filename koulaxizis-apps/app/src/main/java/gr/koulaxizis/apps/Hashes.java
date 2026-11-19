package gr.koulaxizis.apps;

import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** SHA-256 in lower-case hex, as F-Droid's index-v2 writes it. */
final class Hashes {
    private Hashes() {}

    static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    static String sha256(byte[] data) {
        return hex(sha256().digest(data));
    }

    static String sha256(InputStream in) throws IOException {
        MessageDigest md = sha256();
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        return hex(md.digest());
    }

    static String hex(byte[] b) {
        char[] d = "0123456789abcdef".toCharArray();
        char[] out = new char[b.length * 2];
        for (int i = 0; i < b.length; i++) {
            out[2 * i] = d[(b[i] >> 4) & 15];
            out[2 * i + 1] = d[b[i] & 15];
        }
        return new String(out);
    }
}
