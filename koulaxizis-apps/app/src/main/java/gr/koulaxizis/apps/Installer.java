package gr.koulaxizis.apps;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
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
 * Android always asks the person before a first install; nothing is ever
 * uninstalled or removed from the phone by this app.
 */
final class Installer {
    static final String ACTION_STATUS = "gr.koulaxizis.apps.INSTALL_STATUS";
    static final String EXTRA_PKG = "pkg";

    private Installer() {}

    /** Blocking: call off the main thread. Throws when a check fails; nothing is installed then. */
    static void install(Context ctx, AppInfo app) throws RepoException {
        File dir = new File(ctx.getCacheDir(), "apk");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new RepoException(RepoException.NETWORK, "cache");
        File apk = new File(dir, app.apkSha256 + ".apk");
        try {
            Net.file(app.apkUrl, apk, app.apkSize, app.apkSha256);
            Set<String> got = Installed.archiveSigners(ctx.getPackageManager(), apk.getPath());
            boolean vouched = false;
            for (String s : got) if (app.signers.contains(s)) vouched = true;
            if (!vouched) throw new RepoException(RepoException.SIGNATURE, "apk signer not in index");
            commit(ctx, app, apk);
        } finally {
            apk.delete();
        }
    }

    private static void commit(Context ctx, AppInfo app, File apk) throws RepoException {
        PackageInstaller pi = ctx.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        p.setAppPackageName(app.pkg);
        p.setSize(apk.length());
        if (Build.VERSION.SDK_INT >= 31) {
            // Updates of apps this manager installed go through without a
            // question where Android allows it; a first install always asks.
            p.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
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
                Intent status = new Intent(ctx, InstallReceiver.class).setAction(ACTION_STATUS).putExtra(EXTRA_PKG, app.pkg);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                PendingIntent pend = PendingIntent.getBroadcast(ctx, id, status, flags);
                s.commit(pend.getIntentSender());
            }
        } catch (IOException | SecurityException e) {
            throw new RepoException(RepoException.NETWORK, "installer", e);
        }
    }
}
