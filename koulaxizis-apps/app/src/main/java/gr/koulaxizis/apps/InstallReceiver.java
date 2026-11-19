package gr.koulaxizis.apps;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

/** PackageInstaller's answers: asks the person when Android needs a yes, then tells the screen. */
public final class InstallReceiver extends BroadcastReceiver {
    interface Listener {
        void onInstallResult(String pkg, boolean ok, String message);
    }

    /** The open screen, if any (main thread only). */
    static Listener listener;

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!Installer.ACTION_STATUS.equals(intent.getAction())) return;
        String pkg = intent.getStringExtra(Installer.EXTRA_PKG);
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) {
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(confirm);
            }
            return;
        }
        boolean ok = status == PackageInstaller.STATUS_SUCCESS;
        String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        if (status == PackageInstaller.STATUS_FAILURE_ABORTED) msg = null; // the person said no
        if (listener != null) listener.onInstallResult(pkg, ok, msg);
    }
}
