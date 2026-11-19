package net.glarolykoi.android;

import java.util.ArrayList;
import java.util.List;

/**
 * Which shop items are new since the last check (GL-NEW). Pure Java,
 * unit tested in ReleasesTest; ReleaseJob does the network and the
 * notification.
 */
final class Releases {
    private Releases() {}

    /** No check has run yet: the first one only records where we are. */
    static final long NONE = -1;

    static final class Item {
        final long id;
        final String name;
        final String url;

        Item(long id, String name, String url) {
            this.id = id;
            this.name = name;
            this.url = url;
        }
    }

    /**
     * Items newer than lastSeen, newest first. The first check
     * (lastSeen == NONE) finds nothing, so installing the app never
     * announces the whole catalogue. Items without a shop link are
     * skipped.
     */
    static List<Item> fresh(List<Item> items, long lastSeen) {
        List<Item> out = new ArrayList<>();
        if (lastSeen == NONE) return out;
        for (Item i : items) {
            if (i.id > lastSeen && i.url != null && i.name != null && !i.name.isEmpty()) out.add(i);
        }
        out.sort((a, b) -> Long.compare(b.id, a.id));
        return out;
    }

    /** The newest id seen, never lower than before. */
    static long newest(List<Item> items, long lastSeen) {
        long max = lastSeen;
        for (Item i : items) max = Math.max(max, i.id);
        return max;
    }

    /** Only https links to the shop may be opened from a notification. */
    static boolean safeUrl(String url) {
        if (url == null || !url.startsWith("https://")) return false;
        int end = url.indexOf('/', 8);
        String host = end < 0 ? url.substring(8) : url.substring(8, end);
        if (host.contains("@") || host.contains(":")) return false;
        return Links.isSiteHost(host);
    }
}
