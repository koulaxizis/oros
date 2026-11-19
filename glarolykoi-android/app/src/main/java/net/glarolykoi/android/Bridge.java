package net.glarolykoi.android;

import android.app.Activity;
import android.content.Intent;
import android.os.SystemClock;
import android.webkit.JavascriptInterface;
import java.util.function.BooleanSupplier;

/**
 * The only thing the page can ask of the app: share a link (GL-SHARE).
 * WebView has no navigator.share, so MainActivity defines it on
 * glarolykoi.net pages and it ends here. Nothing is read or returned.
 */
final class Bridge {
    private final Activity activity;
    /** True while the top page is glarolykoi.net (checked on the UI thread). */
    private final BooleanSupplier onSite;
    private long lastShare;

    Bridge(Activity activity, BooleanSupplier onSite) {
        this.activity = activity;
        this.onSite = onSite;
    }

    @JavascriptInterface
    public void share(String title, String text, String url) {
        StringBuilder body = new StringBuilder();
        if (text != null && !text.isEmpty()) body.append(text);
        if (url != null && !url.isEmpty()) {
            if (body.length() > 0) body.append('\n');
            body.append(url);
        }
        if (body.length() == 0) return;
        // Cap what a page can put on the share sheet.
        String shared = body.length() > 2000 ? body.substring(0, 2000) : body.toString();
        Intent send = new Intent(Intent.ACTION_SEND)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, shared);
        if (title != null && !title.isEmpty()) {
            send.putExtra(Intent.EXTRA_SUBJECT, title.length() > 200 ? title.substring(0, 200) : title);
        }
        Intent chooser = Intent.createChooser(send, null);
        activity.runOnUiThread(() -> {
            // Frames from other sites (payment, maps) see the bridge too:
            // only the shop's own page may share, at most once a second.
            long now = SystemClock.elapsedRealtime();
            if (activity.isFinishing() || !onSite.getAsBoolean() || now - lastShare < 1000) return;
            lastShare = now;
            activity.startActivity(chooser);
        });
    }
}
