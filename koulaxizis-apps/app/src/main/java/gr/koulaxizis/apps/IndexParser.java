package gr.koulaxizis.apps;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Reads an F-Droid index-v2.json (already checked against its signed
 * entry) into the apps this phone can install: per package the newest
 * stable version that fits the phone's Android version and processor, or
 * the newest beta while no stable one exists (as F-Droid suggests it).
 */
final class IndexParser {
    private IndexParser() {}

    /** Largest APK the manager downloads. */
    static final long MAX_APK = 400L * 1024 * 1024;

    static List<AppInfo> parse(String json, Source src, List<String> locales, int sdk, List<String> abis,
                               String ownPkg) throws RepoException {
        List<AppInfo> out = new ArrayList<>();
        try {
            JSONObject root = new JSONObject(json);
            JSONObject packages = root.getJSONObject("packages");
            Iterator<String> it = packages.keys();
            while (it.hasNext()) {
                String pkg = it.next();
                if (pkg.equals(ownPkg) || !pkg.matches("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+")) continue;
                AppInfo a = app(src, pkg, packages.getJSONObject(pkg), locales, sdk, abis);
                if (a != null) out.add(a);
            }
        } catch (JSONException e) {
            throw new RepoException(RepoException.FORMAT, "index-v2.json", e);
        }
        return out;
    }

    private static AppInfo app(Source src, String pkg, JSONObject p, List<String> locales, int sdk, List<String> abis) {
        JSONObject meta = p.optJSONObject("metadata");
        JSONObject versions = p.optJSONObject("versions");
        if (meta == null || versions == null) return null;
        JSONObject stable = null, any = null;
        long stableCode = -1, anyCode = -1;
        Iterator<String> it = versions.keys();
        while (it.hasNext()) {
            JSONObject v = versions.optJSONObject(it.next());
            if (v == null) continue;
            JSONObject m = v.optJSONObject("manifest");
            if (m == null || !fits(m, sdk, abis)) continue;
            long code = m.optLong("versionCode", -1);
            JSONArray ch = v.optJSONArray("releaseChannels");
            boolean isBeta = ch != null && ch.length() > 0;
            if (code > anyCode) { anyCode = code; any = v; }
            if (!isBeta && code > stableCode) { stableCode = code; stable = v; }
        }
        JSONObject v = stable != null ? stable : any;
        if (v == null) return null;
        JSONObject m = v.optJSONObject("manifest");
        JSONObject file = v.optJSONObject("file");
        if (file == null) return null;
        String apk = path(src.address, file.optString("name", null));
        String sha = file.optString("sha256", "").toLowerCase(Locale.ROOT);
        long size = file.optLong("size", -1);
        if (apk == null || !sha.matches("[0-9a-f]{64}") || size <= 0 || size > MAX_APK) return null;
        Set<String> signers = new HashSet<>();
        JSONObject signer = m.optJSONObject("signer");
        JSONArray sl = signer == null ? null : signer.optJSONArray("sha256");
        if (sl != null) for (int i = 0; i < sl.length(); i++) signers.add(sl.optString(i).toLowerCase(Locale.ROOT));
        if (signers.isEmpty()) return null; // never install what the index does not vouch for
        String name = Locales.pick(meta.optJSONObject("name"), locales);
        if (name == null) name = pkg;
        String summary = Locales.pick(meta.optJSONObject("summary"), locales);
        String iconUrl = null, iconSha = null;
        JSONObject icon = Locales.pickObject(meta.optJSONObject("icon"), locales);
        if (icon != null) {
            iconUrl = path(src.address, icon.optString("name", null));
            iconSha = icon.optString("sha256", "").toLowerCase(Locale.ROOT);
            if (!iconSha.matches("[0-9a-f]{64}")) { iconUrl = null; iconSha = null; }
        }
        String whatsNew = Locales.pick(v.optJSONObject("whatsNew"), locales);
        return new AppInfo(src.id, pkg, name, summary, m.optString("versionName", ""), m.optLong("versionCode"),
            v != stable, apk, sha, size, Collections.unmodifiableSet(signers), iconUrl, iconSha, whatsNew,
            details(src, meta, v, locales));
    }

    /** Largest screenshot the manager downloads. */
    static final long MAX_SHOT = 4L * 1024 * 1024;
    /** At most this many screenshots per app. */
    static final int MAX_SHOTS = 8;

    /** The app's own page (APPS-M5): description, phone screenshots, category, licence and links. */
    static AppInfo.Details details(Source src, JSONObject meta, JSONObject version, List<String> locales) {
        String description = Locales.pick(meta.optJSONObject("description"), locales);
        List<AppInfo.Shot> shots = new ArrayList<>();
        JSONObject screens = meta.optJSONObject("screenshots");
        JSONArray phone = screens == null ? null : Locales.pickArray(screens.optJSONObject("phone"), locales);
        if (phone != null) {
            for (int i = 0; i < phone.length() && shots.size() < MAX_SHOTS; i++) {
                JSONObject f = phone.optJSONObject(i);
                if (f == null) continue;
                String url = path(src.address, f.optString("name", null));
                String sha = f.optString("sha256", "").toLowerCase(Locale.ROOT);
                long size = f.optLong("size", -1);
                // Without a size the cap is the limit; the hash still decides.
                if (size <= 0) size = MAX_SHOT;
                if (url == null || !sha.matches("[0-9a-f]{64}") || size > MAX_SHOT) continue;
                shots.add(new AppInfo.Shot(url, sha, size));
            }
        }
        List<String> cats = new ArrayList<>();
        JSONArray c = meta.optJSONArray("categories");
        if (c != null) for (int i = 0; i < c.length(); i++) {
            String s = c.optString(i, "").trim();
            if (!s.isEmpty() && !cats.contains(s)) cats.add(s);
        }
        long added = version == null ? 0 : version.optLong("added", 0);
        return new AppInfo.Details(description, shots, cats, text(meta, "license"), https(meta.optString("webSite", null)),
            https(meta.optString("sourceCode", null)), text(meta, "authorName"), added);
    }

    private static String text(JSONObject o, String key) {
        String s = o.optString(key, "").trim();
        return s.isEmpty() || s.length() > 200 ? null : s;
    }

    /** A link the page may open: https, no spaces, no user part. */
    static String https(String url) {
        if (url == null) return null;
        url = url.trim();
        if (!url.startsWith("https://") || url.length() > 500 || url.matches(".*\\s.*")) return null;
        int end = url.indexOf('/', 8);
        String host = end < 0 ? url.substring(8) : url.substring(8, end);
        if (host.isEmpty() || host.contains("@")) return null;
        return url;
    }

    private static boolean fits(JSONObject m, int sdk, List<String> abis) {
        JSONObject uses = m.optJSONObject("usesSdk");
        if (uses != null) {
            if (uses.optInt("minSdkVersion", 1) > sdk) return false;
            int max = uses.optInt("maxSdkVersion", 0);
            if (max > 0 && max < sdk) return false;
        }
        JSONArray native_ = m.optJSONArray("nativecode");
        if (native_ != null && native_.length() > 0) {
            for (int i = 0; i < native_.length(); i++) if (abis.contains(native_.optString(i))) return true;
            return false;
        }
        return true;
    }

    /** A file of the repository: "/x.apk" under the address, nothing else. */
    static String path(String address, String name) {
        if (name == null || !name.startsWith("/") || name.contains("..") || name.contains("//")
            || name.contains("?") || name.contains("#") || name.contains("\\")) return null;
        return address + name;
    }
}
