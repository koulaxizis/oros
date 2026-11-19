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
            v != stable, apk, sha, size, Collections.unmodifiableSet(signers), iconUrl, iconSha, whatsNew);
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
