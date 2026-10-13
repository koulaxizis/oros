package online.useoros.twa;

import androidx.browser.customtabs.CustomTabsCallback;
import androidx.browser.customtabs.CustomTabsClient;

import java.util.Collections;

import com.google.androidbrowserhelper.trusted.LauncherActivityMetadata;
import com.google.androidbrowserhelper.trusted.SessionStore;
import com.google.androidbrowserhelper.trusted.SharedPreferencesTokenStore;
import com.google.androidbrowserhelper.trusted.TwaLauncher;

/**
 * The standard android-browser-helper launcher (splash, share target,
 * file handling, fallback), with three changes for the phone bridge:
 * the Custom Tabs callback is PhoneBridge's, Chrome is preferred as
 * the browser when installed, and the TwaLauncher is kept alive after
 * this Activity finishes, so the session it created can still carry
 * postMessage traffic.
 */
public class LauncherActivity extends com.google.androidbrowserhelper.trusted.LauncherActivity {
    private static final String CHROME = "com.android.chrome";

    @Override
    protected CustomTabsCallback getCustomTabsCallback() {
        return OrosApp.bridge(this).callback();
    }

    @Override
    protected TwaLauncher createTwaLauncher() {
        // Same arguments as the base class (2.7.4 keeps its metadata
        // private, so it is parsed again; cheap, manifest only).
        LauncherActivityMetadata md = LauncherActivityMetadata.parse(this);
        String browser = md.launchingBrowser;
        if (browser == null) {
            // The phone bridge needs a browser that validates the
            // "use_as_origin" relation (Chrome does; Brave, for one,
            // does not), so Chrome is preferred when it is installed.
            browser = CustomTabsClient.getPackageName(this,
                    Collections.singletonList(CHROME), true);
        }
        KeptTwaLauncher launcher = new KeptTwaLauncher(this, browser,
                SessionStore.makeSessionId(getTaskId()), new SharedPreferencesTokenStore(this));
        OrosApp.bridge(this).attach(launcher);
        return launcher;
    }
}
