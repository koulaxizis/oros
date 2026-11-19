package gr.koulaxizis.apps;

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

    AppInfo(String sourceId, String pkg, String name, String summary, String versionName, long versionCode,
            boolean beta, String apkUrl, String apkSha256, long apkSize, Set<String> signers,
            String iconUrl, String iconSha256, String whatsNew) {
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
    }
}
