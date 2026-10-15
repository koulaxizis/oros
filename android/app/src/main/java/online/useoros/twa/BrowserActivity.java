package online.useoros.twa;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Bundle;

/**
 * Opens a link in the person's default browser, in a normal tab
 * ("intent://open?u=<url>#Intent;scheme=oros-browser;package=<this app>;…").
 * Inside the app a link to another site opens in the browser's in-app
 * tab, where an APK download stops at 100% and never finishes (Chris
 * 2026-10-15, Brave; a normal tab works in every browser), and the
 * download page opened from the menu belongs in a tab too. Only orOS's
 * own APK downloads, the download page and the F-Droid repository are
 * accepted; anything else is ignored. In every flavour (the orOS app and
 * each single app). Shows nothing and finishes at once.
 */
public class BrowserActivity extends Activity {
    static final String APK_BASE = "https://github.com/koulaxizis/oros/releases/download/android-apks/";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Uri data = getIntent().getData();
        String u = data != null && "open".equals(data.getHost()) ? data.getQueryParameter("u") : null;
        if (allowed(u)) open(Uri.parse(u));
        finish();
    }

    static boolean allowed(String u) {
        if (u == null || u.length() > 300) return false;
        if (u.startsWith(APK_BASE)) return u.substring(APK_BASE.length()).matches("oros(-[a-z0-9]{1,40})?\\.apk");
        return u.matches("https://useoros\\.online/download/(\\?lang=(en|el))?")
                || u.matches("https://koulaxizis\\.github\\.io/oros-fdroid/(repo/?)?");
    }

    private void open(Uri page) {
        Intent i = new Intent(Intent.ACTION_VIEW, page).addCategory(Intent.CATEGORY_BROWSABLE)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        String browser = defaultBrowser();
        if (browser != null) i.setPackage(browser);
        try {
            startActivity(browser != null ? i : Intent.createChooser(i, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException | SecurityException e) {
            // Nothing can open it: stay in the app.
        }
    }

    /** Whoever opens a web link that no app claims; null when none is set
     *  (Android's chooser) or it is this app. */
    private String defaultBrowser() {
        ResolveInfo r = getPackageManager().resolveActivity(
                new Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com/")), PackageManager.MATCH_DEFAULT_ONLY);
        String p = r != null && r.activityInfo != null ? r.activityInfo.packageName : null;
        return p == null || "android".equals(p) || p.equals(getPackageName()) ? null : p;
    }
}
