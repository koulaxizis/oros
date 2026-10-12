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
    }

    public static PhoneBridge bridge(android.content.Context c) {
        return ((OrosApp) c.getApplicationContext()).bridge;
    }
}
