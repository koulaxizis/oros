package gr.koulaxizis.apps;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Which apps on the phone have a newer version in our repositories
 * (APPS-M2). Only an installed app signed with a key the repository vouches
 * for counts, so a test build or a copy from elsewhere is never offered
 * as an update. Pure: the phone is asked through {@link Phone}.
 */
final class Updates {
    interface Phone {
        /** Null when the app is not installed. */
        Installed of(String pkg);
    }

    private Updates() {}

    /** In {@link Source#ALL} order, each package once (the first project that lists it). */
    static List<AppInfo> pending(List<Source> sources, Map<String, List<AppInfo>> apps, Phone phone) {
        List<AppInfo> offers = new ArrayList<>();
        for (Source s : sources) {
            List<AppInfo> list = apps.get(s.id);
            if (list != null) offers.addAll(list);
        }
        return pending(offers, phone);
    }

    /** The offers in their order, each package once (its first offer). */
    static List<AppInfo> pending(List<AppInfo> offers, Phone phone) {
        List<AppInfo> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (AppInfo a : offers) {
            if (!seen.add(a.pkg)) continue;
            if (Installed.state(phone.of(a.pkg), a) == Installed.UPDATE) out.add(a);
        }
        return out;
    }

    /** The manager's own newer version, or null (only when this very package is installed). */
    static AppInfo self(AppInfo offer, Installed me) {
        if (offer == null || me == null) return null;
        return Installed.state(me, offer) == Installed.UPDATE ? offer : null;
    }

    /** A stable key for a set of updates, so the same updates are announced once. */
    static String key(List<AppInfo> list, AppInfo self) {
        StringBuilder b = new StringBuilder();
        for (AppInfo a : list) b.append(a.pkg).append(':').append(a.versionCode).append(';');
        if (self != null) b.append(self.pkg).append(':').append(self.versionCode);
        return b.toString();
    }

    /** The same set of updates is told again after three days. */
    static final long AGAIN = 72L * 60 * 60 * 1000;

    /**
     * Whether the daily check tells about this set now: a new set at once,
     * the same set again after {@link #AGAIN} (or when the clock went back).
     */
    static boolean due(String key, String told, long toldAt, long now) {
        return !key.equals(told) || now - toldAt >= AGAIN || now < toldAt;
    }
}
