package gr.koulaxizis.apps;

import java.text.Collator;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The list on screen: one header per project in {@link Source#ALL} order,
 * its featured apps first, the rest under a "More apps" sub-header in
 * alphabetical order. A project whose repository could not be read shows
 * its header and the reason, never apps from somewhere else.
 */
final class Rows {
    static final int HEADER = 0, SUB = 1, APP = 2, NOTE = 3;

    static final class Row {
        final int kind;
        final Source source;
        final AppInfo app;
        /** NOTE rows: RepoException code, or "empty". */
        final String note;

        Row(int kind, Source source, AppInfo app, String note) {
            this.kind = kind;
            this.source = source;
            this.app = app;
            this.note = note;
        }
    }

    private Rows() {}

    static List<Row> build(List<Source> sources, Map<String, List<AppInfo>> apps, Map<String, String> errors,
                           Locale locale) {
        Collator col = Collator.getInstance(locale);
        col.setStrength(Collator.PRIMARY);
        List<Row> out = new ArrayList<>();
        for (Source s : sources) {
            out.add(new Row(HEADER, s, null, null));
            List<AppInfo> list = apps.get(s.id);
            String err = errors.get(s.id);
            if (err != null) out.add(new Row(NOTE, s, null, err));
            if (list == null || list.isEmpty()) {
                if (err == null) out.add(new Row(NOTE, s, null, "empty"));
                continue;
            }
            List<AppInfo> featured = new ArrayList<>(), rest = new ArrayList<>();
            for (String pkg : s.featured) {
                for (AppInfo a : list) if (a.pkg.equals(pkg)) featured.add(a);
            }
            for (AppInfo a : list) if (!s.featured.contains(a.pkg)) rest.add(a);
            rest.sort(Comparator.comparing((AppInfo a) -> a.name, col).thenComparing(a -> a.pkg));
            for (AppInfo a : featured) out.add(new Row(APP, s, a, null));
            if (!featured.isEmpty() && !rest.isEmpty()) out.add(new Row(SUB, s, null, null));
            for (AppInfo a : rest) out.add(new Row(APP, s, a, null));
        }
        return out;
    }
}
