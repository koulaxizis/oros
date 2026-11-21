package gr.koulaxizis.apps;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;

import org.json.JSONArray;
import org.json.JSONObject;

/** Picks the text for the phone's languages from an index-v2 locale map. */
final class Locales {
    private Locales() {}

    /** "el-GR" → ["el-GR", "el"], then English, as the fallback F-Droid uses. */
    static List<String> chain(List<Locale> phone) {
        List<String> out = new ArrayList<>();
        for (Locale l : phone) {
            String lang = l.getLanguage();
            if (lang.isEmpty()) continue;
            String tag = l.getCountry().isEmpty() ? lang : lang + "-" + l.getCountry();
            if (!out.contains(tag)) out.add(tag);
            if (!out.contains(lang)) out.add(lang);
        }
        if (!out.contains("en-US")) out.add("en-US");
        if (!out.contains("en")) out.add("en");
        return out;
    }

    static String pick(JSONObject map, List<String> chain) {
        String key = key(map, chain);
        if (key == null) return null;
        String s = map.optString(key, null);
        return s == null || s.trim().isEmpty() ? null : s.trim();
    }

    static JSONObject pickObject(JSONObject map, List<String> chain) {
        String key = key(map, chain);
        return key == null ? null : map.optJSONObject(key);
    }

    /** A locale map of lists (index-v2 screenshots): the phone's language, else English, else any. */
    static JSONArray pickArray(JSONObject map, List<String> chain) {
        String key = key(map, chain);
        return key == null ? null : map.optJSONArray(key);
    }

    private static String key(JSONObject map, List<String> chain) {
        if (map == null || map.length() == 0) return null;
        for (String want : chain) {
            Iterator<String> it = map.keys();
            while (it.hasNext()) {
                String k = it.next();
                if (k.equalsIgnoreCase(want)) return k;
            }
            // "el" also takes "el-GR" and "el_GR".
            if (want.indexOf('-') < 0) {
                it = map.keys();
                while (it.hasNext()) {
                    String k = it.next();
                    if (k.toLowerCase(Locale.ROOT).startsWith(want.toLowerCase(Locale.ROOT) + "-")
                        || k.toLowerCase(Locale.ROOT).startsWith(want.toLowerCase(Locale.ROOT) + "_")) return k;
                }
            }
        }
        return map.keys().next();
    }
}
