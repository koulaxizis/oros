package gr.koulaxizis.apps;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.InstallSourceInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Set;

/**
 * Downloads an APK named by a verified index, checks its size, SHA-256
 * and signing certificate, and hands it to Android's PackageInstaller.
 * Android always asks the person before a first install (unless Shizuku is
 * turned on, {@link Silent}); updates of apps this manager installed go
 * through without a question from Android 12 ({@link Quiet}, APPS-M6).
 * Nothing is ever uninstalled or removed from the phone by this app.
 */
final class Installer {
    static final String ACTION_STATUS = "gr.koulaxizis.apps.INSTALL_STATUS";
    static final String EXTRA_PKG = "pkg";
    /** The daily check's own install: a question is dropped, never shown. */
    static final String EXTRA_AUTO = "auto";
    /** The session asked Android for no question (USER_ACTION_NOT_REQUIRED). */
    static final String EXTRA_QUIET = "quiet";
    /** {@link #install} result: Shizuku installed it, there is no session. */
    static final int SILENT = -2;
    /** The system build on which a quiet update was refused (HyperOS), see {@link Quiet#refused}. */
    private static final String REFUSED = "quiet_refused";

    /** This phone's system refused a quiet update: ask for no quiet ones until its system changes. */
    static boolean refused(Context ctx) {
        return Build.FINGERPRINT.equals(UpdateJob.prefs(ctx).getString(REFUSED, null));
    }

    static void markRefused(Context ctx) {
        UpdateJob.prefs(ctx).edit().putString(REFUSED, Build.FINGERPRINT).apply();
    }

    /** Whether Android will ask before updating this installed app ({@link Quiet}). */
    @SuppressWarnings("deprecation")
    static int quiet(Context ctx, String pkg) {
        String installer = null, owner = null;
        PackageManager pm = ctx.getPackageManager();
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                InstallSourceInfo src = pm.getInstallSourceInfo(pkg);
                installer = src.getInstallingPackageName();
                if (Build.VERSION.SDK_INT >= 34) owner = src.getUpdateOwnerPackageName();
            } else {
                installer = pm.getInstallerPackageName(pkg);
            }
        } catch (PackageManager.NameNotFoundException | RuntimeException e) {
            // Not installed or not visible: Android will ask.
        }
        return Quiet.update(Build.VERSION.SDK_INT, ctx.getPackageName(), installer, owner, refused(ctx));
    }

    /** The session's progress (0..1), or -1 when Android no longer has it. */
    static float progress(Context ctx, int session) {
        try {
            PackageInstaller.SessionInfo i = ctx.getPackageManager().getPackageInstaller().getSessionInfo(session);
            return i == null ? -1 : i.getProgress();
        } catch (RuntimeException e) {
            return 0;
        }
    }

    /** Drops a session this app made (an unanswered question), so the app can be tried again. */
    static void abandon(Context ctx, int session) {
        try {
            ctx.getPackageManager().getPackageInstaller().abandonSession(session);
        } catch (RuntimeException e) {
            // Already gone or finished.
        }
    }

    private Installer() {}

    /**
     * Blocking: call off the main thread. Throws when a check fails; nothing
     * is installed then. Returns the PackageInstaller session's id, or
     * {@link #SILENT} when Shizuku installed it already. With auto (the
     * daily check), a session that needs the person's yes is dropped.
     */
    static int install(Context ctx, AppInfo app, boolean auto) throws RepoException {
        File dir = new File(ctx.getCacheDir(), "apk");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new RepoException(RepoException.NETWORK, "cache");
        File apk = new File(dir, app.apkSha256 + ".apk");
        try {
            Net.apk(app.apkUrl, apk, app.apkSize, app.apkSha256);
            Set<String> got = Installed.archiveSigners(ctx.getPackageManager(), apk.getPath());
            boolean vouched = false;
            for (String s : got) if (app.signers.contains(s)) vouched = true;
            if (!vouched) throw new RepoException(RepoException.SIGNATURE, "apk signer not in index");
            boolean first = Installed.of(ctx.getPackageManager(), app.pkg) == null;
            if (Silent.ready(ctx) && Silent.install(ctx, apk)) return SILENT;
            return commit(ctx, app, apk, first, auto);
        } finally {
            apk.delete();
        }
    }

    private static int commit(Context ctx, AppInfo app, File apk, boolean first, boolean auto) throws RepoException {
        PackageInstaller pi = ctx.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        p.setAppPackageName(app.pkg);
        p.setSize(apk.length());
        // Updates of apps this manager installed go through without a
        // question where Android allows it; a first install always asks, so
        // it never asks for none (HyperOS would refuse it). Not on a phone
        // whose system refused one already (Quiet.refused).
        // Needs UPDATE_PACKAGES_WITHOUT_USER_ACTION in the manifest, or Android ignores it.
        boolean quiet = Build.VERSION.SDK_INT >= 31 && !first && !refused(ctx);
        if (quiet) p.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        if (first && Build.VERSION.SDK_INT >= 34) {
            // This manager owns the app's updates (ENFORCE_UPDATE_OWNERSHIP),
            // so another store cannot take them over without a question and
            // the next updates here stay quiet.
            p.setRequestUpdateOwnership(true);
        }
        try {
            int id = pi.createSession(p);
            try (PackageInstaller.Session s = pi.openSession(id)) {
                try (InputStream in = new FileInputStream(apk); OutputStream out = s.openWrite("base.apk", 0, apk.length())) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    s.fsync(out);
                }
                // Explicit, to our own receiver (not exported).
                Intent status = new Intent(ctx, InstallReceiver.class).setAction(ACTION_STATUS).putExtra(EXTRA_PKG, app.pkg).putExtra(EXTRA_AUTO, auto).putExtra(EXTRA_QUIET, quiet);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                PendingIntent pend = PendingIntent.getBroadcast(ctx, id, status, flags);
                s.commit(pend.getIntentSender());
            }
            return id;
        } catch (IOException | SecurityException e) {
            throw new RepoException(RepoException.NETWORK, "installer", e);
        }
    }
}
