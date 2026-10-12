package online.useoros.twa;

import androidx.browser.customtabs.CustomTabsCallback;

import com.google.androidbrowserhelper.trusted.LauncherActivityMetadata;
import com.google.androidbrowserhelper.trusted.SessionStore;
import com.google.androidbrowserhelper.trusted.SharedPreferencesTokenStore;
import com.google.androidbrowserhelper.trusted.TwaLauncher;

/**
 * The standard android-browser-helper launcher (splash, share target,
 * file handling, fallback), with two changes for the phone bridge:
 * the Custom Tabs callback is PhoneBridge's, and the TwaLauncher is
 * kept alive after this Activity finishes, so the session it created
 * can still carry postMessage traffic.
 */
public class LauncherActivity extends com.google.androidbrowserhelper.trusted.LauncherActivity {

    @Override
    protected CustomTabsCallback getCustomTabsCallback() {
        return OrosApp.bridge(this).callback();
    }

    @Override
    protected TwaLauncher createTwaLauncher() {
        LauncherActivityMetadata md = getMetadata();
        KeptTwaLauncher launcher = new KeptTwaLauncher(this,
                md == null ? null : md.launchingBrowser,
                SessionStore.makeSessionId(getTaskId()),
                new SharedPreferencesTokenStore(this),
                md == null ? null : md.launchingBrowserToken);
        OrosApp.bridge(this).attach(launcher);
        return launcher;
    }
}
