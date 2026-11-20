package gr.koulaxizis.apps;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Puts the daily check back after a restart of the phone or an update of
 * this app (APPS-M2), so it runs even when the app is not opened again.
 */
public final class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) {
            UpdateJob.schedule(ctx);
        }
    }
}
