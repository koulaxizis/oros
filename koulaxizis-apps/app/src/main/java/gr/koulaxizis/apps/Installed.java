package gr.koulaxizis.apps;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.os.Build;

import java.util.HashSet;
import java.util.Set;

/** What the phone has of an app: version and signing certificates. */
final class Installed {
    static final int NONE = 0, CURRENT = 1, UPDATE = 2, OTHER_KEY = 3, NEWER = 4;

    final long versionCode;
    final String versionName;
    final Set<String> signers;

    Installed(long versionCode, String versionName, Set<String> signers) {
        this.versionCode = versionCode;
        this.versionName = versionName;
        this.signers = signers;
    }

    /** Null when the app is not installed (or not visible to this app). */
    static Installed of(PackageManager pm, String pkg) {
        try {
            PackageInfo pi = Build.VERSION.SDK_INT >= 28
                ? pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES)
                : pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES);
            return new Installed(Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode,
                pi.versionName, signers(pi));
        } catch (PackageManager.NameNotFoundException e) {
            return null;
        }
    }

    /** The certificates of a downloaded APK, before it is handed to Android. */
    static Set<String> archiveSigners(PackageManager pm, String path) {
        PackageInfo pi = pm.getPackageArchiveInfo(path, Build.VERSION.SDK_INT >= 28
            ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES);
        return pi == null ? new HashSet<>() : signers(pi);
    }

    @SuppressWarnings("deprecation")
    private static Set<String> signers(PackageInfo pi) {
        Signature[] sigs;
        if (Build.VERSION.SDK_INT >= 28 && pi.signingInfo != null) {
            SigningInfo si = pi.signingInfo;
            sigs = si.hasMultipleSigners() ? si.getApkContentsSigners() : si.getSigningCertificateHistory();
        } else {
            sigs = pi.signatures;
        }
        Set<String> out = new HashSet<>();
        if (sigs != null) for (Signature s : sigs) out.add(Hashes.sha256(s.toByteArray()));
        return out;
    }

    static int state(Installed have, AppInfo offer) {
        if (have == null) return NONE;
        boolean shared = false;
        for (String s : have.signers) if (offer.signers.contains(s)) shared = true;
        if (!shared) return OTHER_KEY;
        if (have.versionCode < offer.versionCode) return UPDATE;
        if (have.versionCode > offer.versionCode) return NEWER;
        return CURRENT;
    }
}
