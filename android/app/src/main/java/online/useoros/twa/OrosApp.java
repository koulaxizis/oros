package online.useoros.twa;

import android.app.Application;

/** Holds the phone bridge for the whole process: the TWA session and
 *  its postMessage channel outlive the short-lived LauncherActivity. */
public class OrosApp extends Application {
    private PhoneBridge bridge;

    @Override
    public void onCreate() {
        super.onCreate();
        bridge = new PhoneBridge(this);
        if (BuildConfig.DIAG) diagnostics();
    }

    /** Diagnostic builds: record crashes in the bridge trail and add a
     *  "Bridge diagnostics" shortcut (long-press the app icon). */
    private void diagnostics() {
        bridge.diag("app process started");
        Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
            bridge.diag("CRASH " + android.util.Log.getStackTraceString(e));
            if (prev != null) prev.uncaughtException(t, e);
        });
        if (android.os.Build.VERSION.SDK_INT < 25) return;
        try {
            android.content.pm.ShortcutManager sm = getSystemService(android.content.pm.ShortcutManager.class);
            android.content.Intent i = new android.content.Intent(this, DiagActivity.class)
                    .setAction(android.content.Intent.ACTION_VIEW);
            sm.addDynamicShortcuts(java.util.Collections.singletonList(
                    new android.content.pm.ShortcutInfo.Builder(this, "diag")
                            .setShortLabel("Bridge diagnostics")
                            .setIcon(android.graphics.drawable.Icon.createWithResource(this, android.R.drawable.ic_dialog_info))
                            .setIntent(i)
                            .build()));
        } catch (RuntimeException e) {
            android.util.Log.w("orOS", "diag shortcut", e);   // shortcut limit reached
        }
    }

    public static PhoneBridge bridge(android.content.Context c) {
        return ((OrosApp) c.getApplicationContext()).bridge;
    }
}
