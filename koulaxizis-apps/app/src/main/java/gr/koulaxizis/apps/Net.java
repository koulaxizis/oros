package gr.koulaxizis.apps;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * HTTPS downloads with a size cap. Only the repository addresses in
 * {@link Source#ALL} and the files their signed indexes name are ever
 * fetched; nothing about the phone or its apps is sent (no cookies, no
 * query strings, a fixed user agent).
 */
final class Net {
    private Net() {}

    static final String UA = "KoulaxizisApps/1";

    static HttpURLConnection open(String url) throws RepoException {
        if (!url.startsWith("https://")) throw new RepoException(RepoException.NETWORK, "not https");
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setUseCaches(false);
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("User-Agent", UA);
            int code = c.getResponseCode();
            if (code != 200) {
                c.disconnect();
                throw new RepoException(RepoException.NETWORK, "HTTP " + code + " " + url);
            }
            return c;
        } catch (IOException e) {
            throw new RepoException(RepoException.NETWORK, url, e);
        }
    }

    static byte[] bytes(String url, long max) throws RepoException {
        HttpURLConnection c = open(url);
        try (InputStream in = c.getInputStream()) {
            return RepoEntry.readAll(in, max);
        } catch (IOException e) {
            throw new RepoException(RepoException.NETWORK, url, e);
        } finally {
            c.disconnect();
        }
    }

    /**
     * Downloads to {@code dest} and checks size and SHA-256; on any
     * mismatch the file is deleted and nothing is kept.
     */
    static void file(String url, File dest, long size, String sha256) throws RepoException {
        HttpURLConnection c = open(url);
        MessageDigest md = Hashes.sha256();
        long total = 0;
        boolean ok = false;
        try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(dest)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > size) throw new RepoException(RepoException.HASH, "larger than the index says");
                md.update(buf, 0, n);
                out.write(buf, 0, n);
            }
            if (total != size) throw new RepoException(RepoException.HASH, "size");
            if (!Hashes.hex(md.digest()).equals(sha256)) throw new RepoException(RepoException.HASH, "sha256");
            ok = true;
        } catch (IOException e) {
            throw new RepoException(RepoException.NETWORK, url, e);
        } finally {
            c.disconnect();
            if (!ok) dest.delete();
        }
    }
}
