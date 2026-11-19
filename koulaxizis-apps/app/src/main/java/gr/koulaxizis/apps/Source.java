package gr.koulaxizis.apps;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * One project and its F-Droid repository (APPS-M1). The fingerprint is the
 * SHA-256 of the repository's signing certificate, pinned here: an index
 * signed by any other key is refused. A new project is one more line in
 * {@link #ALL} and a manager update.
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

    Source(String id, String title, String address, String fingerprint, String... featured) {
        this.id = id;
        this.title = title;
        this.address = address;
        this.fingerprint = fingerprint;
        this.featured = Collections.unmodifiableList(Arrays.asList(featured));
    }

    /**
     * Fingerprints as published by each project: orOS solo.js REPO_FP,
     * null-jsfx android/README.md, noxpress index.html (checked against the
     * live entry.jar files on 2026-11-17).
     */
    static final List<Source> ALL = Collections.unmodifiableList(Arrays.asList(
        new Source("oros", "orOS",
            "https://koulaxizis.github.io/oros-fdroid/repo",
            "2A066758DF27F6AFDF6D96F72D575E3E04844B9F85A22A54B7F2C03905A11846",
            "online.useoros.twa", "online.useoros.drive"),
        new Source("nulljsfx", "NULL JSFX",
            "https://koulaxizis.github.io/null-jsfx-fdroid/repo",
            "1C071614D51503C5ED3260A1B69A0D44CEA6057A5DC6A3ACC3FA7AD130EF64EB"),
        new Source("noxpress", "Noxpress",
            "https://koulaxizis.github.io/noxpress-fdroid/repo",
            "21441E31A60A89708C6CECE649390C1863EC8CA147F08DA7399AE7646E02EE4E")
    ));
}
