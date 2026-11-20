package gr.koulaxizis.apps;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * One project and its F-Droid repository (APPS-M1). The fingerprint is the
 * SHA-256 of the repository's signing certificate, pinned here: an index
 * signed by any other key is refused. A new project is one more line in
 * {@link #ALL} and a manager update. A project can also be a section of
 * another project's repository ({@link #from}, {@link #only}): the
 * Glarolykoi app is published in the orOS repository but has its own
 * section on the screen, with the same checks and one download.
 */
final class Source {
    final String id;
    /** Brand name, the same in every language. */
    final String title;
    /** Repository address, ending in /repo, https only. */
    final String address;
    /** Upper-case hex SHA-256 of the repository certificate. */
    final String fingerprint;
    /** Packages shown first, in this order; the rest follow under "More apps". */
    final List<String> featured;
    /** The repository source this section reads from, or null for its own repository. */
    final String from;
    /** A section's packages (taken out of its repository's own section); empty for a repository. */
    final Set<String> only;

    Source(String id, String title, String address, String fingerprint, String... featured) {
        this(id, title, address, fingerprint, null, Collections.emptySet(), featured);
    }

    private Source(String id, String title, String address, String fingerprint, String from, Set<String> only,
                   String... featured) {
        this.id = id;
        this.title = title;
        this.address = address;
        this.fingerprint = fingerprint;
        this.from = from;
        this.only = only;
        this.featured = Collections.unmodifiableList(Arrays.asList(featured));
    }

    /** A section of {@code repo}'s repository holding only {@code packages}. */
    static Source section(String id, String title, Source repo, String... packages) {
        return new Source(id, title, repo.address, repo.fingerprint, repo.id,
            Collections.unmodifiableSet(new HashSet<>(Arrays.asList(packages))), packages);
    }

    /**
     * Fingerprints as published by each project: orOS solo.js REPO_FP,
     * null-jsfx android/README.md, noxpress index.html (checked against the
     * live entry.jar files on 2026-11-17).
     */
    private static final Source OROS = new Source("oros", "orOS",
        "https://koulaxizis.github.io/oros-fdroid/repo",
        "2A066758DF27F6AFDF6D96F72D575E3E04844B9F85A22A54B7F2C03905A11846",
        "online.useoros.twa", "online.useoros.drive");

    /** The sections on the screen, in this order. */
    static final List<Source> ALL = Collections.unmodifiableList(Arrays.asList(
        OROS,
        new Source("nulljsfx", "NULL JSFX",
            "https://koulaxizis.github.io/null-jsfx-fdroid/repo",
            "1C071614D51503C5ED3260A1B69A0D44CEA6057A5DC6A3ACC3FA7AD130EF64EB"),
        new Source("noxpress", "Noxpress",
            "https://koulaxizis.github.io/noxpress-fdroid/repo",
            "21441E31A60A89708C6CECE649390C1863EC8CA147F08DA7399AE7646E02EE4E"),
        // Glarolykoi (GL-1, glarolykoi-android/ in the orOS repo): published
        // in the orOS F-Droid repository, shown as its own project.
        section("glarolykoi", "Glarolykoi", OROS, "net.glarolykoi.android")
    ));

    /** The repositories that are read, each once. */
    static final List<Source> REPOS;

    static {
        List<Source> r = new ArrayList<>();
        for (Source s : ALL) if (s.from == null) r.add(s);
        REPOS = Collections.unmodifiableList(r);
    }

    /**
     * Each section's apps from the repositories' verified lists: a section
     * gets its packages from its repository, and the repository's own
     * section keeps the rest. A missing list stays missing.
     */
    static Map<String, List<AppInfo>> sections(List<Source> sections, Map<String, List<AppInfo>> byRepo) {
        Map<String, Set<String>> taken = new HashMap<>();
        for (Source s : sections) {
            if (s.from != null) taken.computeIfAbsent(s.from, k -> new HashSet<>()).addAll(s.only);
        }
        Map<String, List<AppInfo>> out = new LinkedHashMap<>();
        for (Source s : sections) {
            List<AppInfo> all = byRepo.get(s.from == null ? s.id : s.from);
            if (all == null) continue;
            Set<String> away = s.from == null ? taken.getOrDefault(s.id, Collections.emptySet()) : null;
            List<AppInfo> list = new ArrayList<>();
            for (AppInfo a : all) {
                if (s.from != null ? s.only.contains(a.pkg) : !away.contains(a.pkg)) list.add(a);
            }
            out.put(s.id, list);
        }
        return out;
    }

    /** A section shares its repository's error. */
    static Map<String, String> sectionErrors(List<Source> sections, Map<String, String> byRepo) {
        Map<String, String> out = new HashMap<>();
        for (Source s : sections) {
            String e = byRepo.get(s.from == null ? s.id : s.from);
            if (e != null) out.put(s.id, e);
        }
        return out;
    }
}
