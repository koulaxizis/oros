package gr.koulaxizis.apps;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Reads every repository: entry.jar (signature checked against the pinned
 * fingerprint), then the index it names (size and SHA-256 checked). A
 * verified index is kept in the app's own storage, so the list also shows
 * offline; an entry older than the last one accepted is refused, so a
 * stale or replayed repository cannot offer an older version.
 */
final class Catalog {
    /** Per section of {@link Source#ALL} (see {@link Source#sections}). */
    final Map<String, List<AppInfo>> apps = new HashMap<>();
    final Map<String, String> errors = new HashMap<>();
    /** Per repository of {@link Source#REPOS}: the verified lists and the failures. */
    private final Map<String, List<AppInfo>> byRepo = new HashMap<>();
    private final Map<String, String> repoErrors = new HashMap<>();
    /** Newest accepted entry timestamp over all repositories, or 0. */
    long checkedAt;
    /** The manager itself as a repository offers it (newest over all), or null; never in {@link #apps}. */
    AppInfo self;

    /** The package of the signed manager (the debug build adds ".debug" and never updates it). */
    static final String OWN = "gr.koulaxizis.apps";
    /** The screen and the daily check share the files on the phone. */
    private static final Object LOCK = new Object();

    private final Context ctx;
    private final SharedPreferences prefs;

    Catalog(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.prefs = ctx.getSharedPreferences("repos", Context.MODE_PRIVATE);
    }

    /** From the copies kept on the phone only; no network. */
    void loadCached() {
        synchronized (LOCK) {
            loadCachedLocked();
        }
    }

    private void loadCachedLocked() {
        for (Source s : Source.REPOS) {
            File f = indexFile(s);
            if (!f.exists()) continue;
            try {
                byRepo.put(s.id, parse(s, new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8)));
                checkedAt = Math.max(checkedAt, prefs.getLong("ts." + s.id, 0));
            } catch (IOException | RepoException e) {
                f.delete();
            }
        }
        split();
    }

    /** The screen's sections from the repositories' lists. */
    private void split() {
        apps.clear();
        apps.putAll(Source.sections(Source.ALL, byRepo));
        errors.clear();
        errors.putAll(Source.sectionErrors(Source.ALL, repoErrors));
    }

    /** Network: refreshes every repository; a failing one keeps its last good list and gets an error. */
    void refresh() {
        synchronized (LOCK) {
            repoErrors.clear();
            for (Source s : Source.REPOS) {
                try {
                    refresh(s);
                } catch (RepoException e) {
                    // The reason, for adb logcat; no addresses or data of the phone.
                    android.util.Log.w("KoulaxizisApps", s.id + ": " + e.getMessage(), e.getCause());
                    repoErrors.put(s.id, e.code);
                }
            }
            split();
        }
    }

    private void refresh(Source s) throws RepoException {
        File jar = new File(ctx.getCacheDir(), "entry-" + s.id + ".jar");
        try {
            byte[] jb = Net.bytes(s.address + "/entry.jar", 1024 * 1024);
            try (FileOutputStream out = new FileOutputStream(jar)) {
                out.write(jb);
            }
        } catch (IOException e) {
            throw new RepoException(RepoException.NETWORK, "cache", e);
        }
        RepoEntry entry;
        try {
            entry = RepoEntry.verify(jar, s.fingerprint);
        } finally {
            jar.delete();
        }
        long last = prefs.getLong("ts." + s.id, 0);
        if (entry.timestamp < last) throw new RepoException(RepoException.OLDER, s.id);
        if (entry.timestamp == last && indexFile(s).exists() && byRepo.containsKey(s.id)) {
            checkedAt = Math.max(checkedAt, last);
            return; // nothing new
        }
        String path = IndexParser.path(s.address, entry.indexName);
        if (path == null) throw new RepoException(RepoException.FORMAT, "index path");
        byte[] index = Net.bytes(path, entry.indexSize);
        entry.checkIndex(index);
        String json = new String(index, StandardCharsets.UTF_8);
        List<AppInfo> list = parse(s, json);
        try {
            File tmp = new File(ctx.getFilesDir(), "index-" + s.id + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(index);
            }
            if (!tmp.renameTo(indexFile(s))) throw new IOException("rename");
        } catch (IOException e) {
            throw new RepoException(RepoException.NETWORK, "storage", e);
        }
        prefs.edit().putLong("ts." + s.id, entry.timestamp).apply();
        byRepo.put(s.id, list);
        checkedAt = Math.max(checkedAt, entry.timestamp);
    }

    private List<AppInfo> parse(Source s, String json) throws RepoException {
        List<Locale> phone = new ArrayList<>();
        android.os.LocaleList ll = ctx.getResources().getConfiguration().getLocales();
        for (int i = 0; i < ll.size(); i++) phone.add(ll.get(i));
        List<AppInfo> all = IndexParser.parse(json, s, Locales.chain(phone), Build.VERSION.SDK_INT,
            Arrays.asList(Build.SUPPORTED_ABIS), null);
        List<AppInfo> list = new ArrayList<>();
        for (AppInfo a : all) {
            if (!a.pkg.equals(OWN)) list.add(a);
            else if (self == null || a.versionCode > self.versionCode) self = a;
        }
        return list;
    }

    private File indexFile(Source s) {
        return new File(ctx.getFilesDir(), "index-" + s.id + ".json");
    }
}
