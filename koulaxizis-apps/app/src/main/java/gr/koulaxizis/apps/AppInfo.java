package gr.koulaxizis.apps;

import java.util.Collections;
import java.util.List;
import java.util.Set;

/** One app as its repository offers it: the version this phone should get. */
final class AppInfo {
    final String sourceId;
    final String pkg;
    final String name;
    final String summary;
    final String versionName;
    final long versionCode;
    final boolean beta;
    final String apkUrl;
    final String apkSha256;
    final long apkSize;
    /** Lower-case hex SHA-256 of the certificates the APK is signed with. */
    final Set<String> signers;
    /** Null when the repository has no icon for the app. */
    final String iconUrl;
    final String iconSha256;
    /** What is new in this version, or null. */
    final String whatsNew;
    /** The rest of the store listing, for the app's own page (APPS-M5). */
    final Details details;

    /** One picture of the repository: a path inside it, checked by size and SHA-256. */
    static final class Shot {
        final String url;
        final String sha256;
        final long size;

        Shot(String url, String sha256, long size) {
            this.url = url;
            this.sha256 = sha256;
            this.size = size;
        }
    }

    /** Store texts and links as the repository's signed index gives them; any of them may be missing. */
    static final class Details {
        static final Details NONE = new Details(null, Collections.emptyList(), Collections.emptyList(),
            null, null, null, null, 0);

        /** The full description (plain text or F-Droid's small HTML), or null. */
        final String description;
        /** Phone screenshots in the phone's language, in order. */
        final List<Shot> screenshots;
        /** F-Droid categories, such as "Office". */
        final List<String> categories;
        final String license;
        /** https only, else null. */
        final String webSite;
        final String sourceCode;
        final String author;
        /** When this version was published (ms), or 0. */
        final long added;

        Details(String description, List<Shot> screenshots, List<String> categories, String license,
                String webSite, String sourceCode, String author, long added) {
            this.description = description;
            this.screenshots = Collections.unmodifiableList(screenshots);
            this.categories = Collections.unmodifiableList(categories);
            this.license = license;
            this.webSite = webSite;
            this.sourceCode = sourceCode;
            this.author = author;
            this.added = added;
        }
    }

    AppInfo(String sourceId, String pkg, String name, String summary, String versionName, long versionCode,
            boolean beta, String apkUrl, String apkSha256, long apkSize, Set<String> signers,
            String iconUrl, String iconSha256, String whatsNew) {
        this(sourceId, pkg, name, summary, versionName, versionCode, beta, apkUrl, apkSha256, apkSize, signers,
            iconUrl, iconSha256, whatsNew, Details.NONE);
    }

    AppInfo(String sourceId, String pkg, String name, String summary, String versionName, long versionCode,
            boolean beta, String apkUrl, String apkSha256, long apkSize, Set<String> signers,
            String iconUrl, String iconSha256, String whatsNew, Details details) {
        this.sourceId = sourceId;
        this.pkg = pkg;
        this.name = name;
        this.summary = summary;
        this.versionName = versionName;
        this.versionCode = versionCode;
        this.beta = beta;
        this.apkUrl = apkUrl;
        this.apkSha256 = apkSha256;
        this.apkSize = apkSize;
        this.signers = signers;
        this.iconUrl = iconUrl;
        this.iconSha256 = iconSha256;
        this.whatsNew = whatsNew;
        this.details = details == null ? Details.NONE : details;
    }
}
