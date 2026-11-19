package online.useoros.twa;

import android.content.pm.PackageManager;
import android.net.Uri;

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
 * can still carry postMessage traffic. The start address also says
 * whether Koulaxizis Apps (the app manager, APPS-M3) is installed, so
 * orOS leaves the APK update notice to it.
 */
public class LauncherActivity extends com.google.androidbrowserhelper.trusted.LauncherActivity {

    @Override
    protected CustomTabsCallback getCustomTabsCallback() {
        return OrosApp.bridge(this).callback();
    }

    @Override
    protected TwaLauncher createTwaLauncher() {
        // Same arguments as the base class (2.7.4 keeps its metadata
        // private, so it is parsed again; cheap, manifest only).
        LauncherActivityMetadata md = LauncherActivityMetadata.parse(this);
        KeptTwaLauncher launcher = new KeptTwaLauncher(this, md.launchingBrowser,
                SessionStore.makeSessionId(getTaskId()), new SharedPreferencesTokenStore(this));
        OrosApp.bridge(this).attach(launcher);
        return launcher;
    }

    /** Koulaxizis Apps (koulaxizis-apps/, APPS-M3), named in <queries>. */
    static final String MANAGER = "gr.koulaxizis.apps";

    /** The start address (?apk=<versionCode>, android/tools/gen.js) gets
     *  mgr=1 while the app manager is installed: it then tells about new
     *  APKs, and solo.js apkNotice stays quiet. Other addresses (links,
     *  shares, files) stay as they are. */
    @Override
    protected Uri getLaunchingUrl() {
        Uri u = super.getLaunchingUrl();
        if (u == null || u.getQueryParameter("apk") == null || !hasManager()) return u;
        return u.buildUpon().appendQueryParameter("mgr", "1").build();
    }

    private boolean hasManager() {
        try {
            getPackageManager().getPackageInfo(MANAGER, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }
}
