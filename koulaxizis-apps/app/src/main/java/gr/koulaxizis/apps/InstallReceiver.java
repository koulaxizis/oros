package gr.koulaxizis.apps;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

/**
 * PackageInstaller's answers. When Android needs a yes, the open screen
 * shows the question itself once it is in front (APPS-M2 fix 1.2.2: an
 * OEM overlay such as Xiaomi's security scan can cover or close it), and
 * shows it again when it was lost; without a screen it is shown at once.
 * An install of the daily check (automatic updates, APPS-M6) never shows a
 * question: Android wanted a yes after all, so the session is dropped and
 * the update waits in the notice like any other.
 */
public final class InstallReceiver extends BroadcastReceiver {
    interface Listener {
        /** Android needs the person's yes for this session. */
        void onInstallConfirm(String pkg, int session, Intent confirm);

        void onInstallResult(String pkg, int session, boolean ok, String message);
    }

    /** The open screen, if any (main thread only). */
    static Listener listener;

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!Installer.ACTION_STATUS.equals(intent.getAction())) return;
        String pkg = intent.getStringExtra(Installer.EXTRA_PKG);
        int session = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1);
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            if (intent.getBooleanExtra(Installer.EXTRA_AUTO, false)) {
                Installer.abandon(ctx, session);
                return;
            }
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm == null) return;
            confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (listener != null) {
                listener.onInstallConfirm(pkg, session, confirm);
            } else {
                try {
                    ctx.startActivity(confirm);
                } catch (RuntimeException e) {
                    // Android may refuse a start from the background; the next "Update" asks again.
                }
            }
            return;
        }
        boolean ok = status == PackageInstaller.STATUS_SUCCESS;
        String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        if (status == PackageInstaller.STATUS_FAILURE_ABORTED) msg = null; // the person said no
        if (listener != null) listener.onInstallResult(pkg, session, ok, msg);
    }
}
