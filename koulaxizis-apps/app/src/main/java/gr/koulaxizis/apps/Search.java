package gr.koulaxizis.apps;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * The search bar at the top (APPS-M5): every word typed must appear in the
 * app's name, summary, description, category, package name or project.
 * Case, Greek accents and final sigma do not count ("σημειωσεις" finds
 * «Σημειώσεις»). The list keeps its order and its project headers; with an
 * empty search it is exactly the home screen. {@code extra} adds words in
 * the phone's language (the category's translated name).
 */
final class Search {
    private Search() {}

    /** Lower case, no accents, ς as σ, any run of spaces as one. */
    static String fold(String s) {
        if (s == null) return "";
        String n = Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}+", "");
        n = n.toLowerCase(Locale.ROOT).replace('ς', 'σ');
        return n.replaceAll("<[^>]{0,200}>", " ").replaceAll("\\s+", " ").trim();
    }

    /** The words of a search, folded; empty when there is nothing to look for. */
    static List<String> words(String query) {
        List<String> out = new ArrayList<>();
        for (String w : fold(query).split(" ")) if (!w.isEmpty() && !out.contains(w)) out.add(w);
        return out;
    }

    /** Everything a search looks at for one app, folded once. */
    static String haystack(AppInfo a, Source s, String extra) {
        StringBuilder b = new StringBuilder();
        if (extra != null) b.append(extra).append(' ');
        b.append(a.name).append(' ').append(a.pkg).append(' ');
        if (a.summary != null) b.append(a.summary).append(' ');
        if (a.details.description != null) b.append(a.details.description).append(' ');
        for (String c : a.details.categories) b.append(c).append(' ');
        if (s != null) b.append(s.title);
        return fold(b.toString());
    }

    static boolean matches(String haystack, List<String> words) {
        for (String w : words) if (!haystack.contains(w)) return false;
        return true;
    }

    /**
     * The rows for a search: the apps that match under their project's
     * header, in the home screen's order. "More apps" and notes go, a project
     * with no match goes. Empty words give the rows back unchanged.
     */
    static List<Rows.Row> filter(List<Rows.Row> rows, List<String> words,
                                 java.util.function.Function<AppInfo, String> extra) {
        if (words.isEmpty()) return rows;
        List<Rows.Row> out = new ArrayList<>();
        Rows.Row header = null;
        for (Rows.Row r : rows) {
            if (r.kind == Rows.HEADER) {
                header = r;
            } else if (r.kind == Rows.APP && matches(haystack(r.app, r.source, extra == null ? null : extra.apply(r.app)), words)) {
                if (header != null) {
                    out.add(header);
                    header = null;
                }
                out.add(r);
            }
        }
        return out;
    }
}
