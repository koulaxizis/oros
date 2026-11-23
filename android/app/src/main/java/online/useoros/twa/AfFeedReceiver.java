package online.useoros.twa;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * PW-AF6: the orOS app turns its own autofill back on as soon as orOS
 * Passwords is removed from the phone (PACKAGE_FULLY_REMOVED reaches a
 * manifest receiver on every Android version), so the phone is never
 * left without autofill. Not in the single apps (gen.js REMOVE_NODES).
 */
public class AfFeedReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        if (i == null || i.getData() == null) return;
        if (!AfFeed.passPkg(c).equals(i.getData().getSchemeSpecificPart())) return;
        PendingResult r = goAsync();
        new Thread(() -> {
            try {
                AfFeed.sync(c);
            } finally {
                r.finish();
            }
        }, "af-feed").start();
    }
}
