package online.useoros.twa;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.Toast;

/**
 * Opened from a tap in orOS ("intent://contacts#Intent;scheme=oros-permission;…").
 * Asks Android for Contacts or Calendar access; when the person said
 * "don't ask again", opens the app's settings page instead. Shows
 * nothing of its own and finishes at once, so orOS is back on screen.
 */
public class PermissionActivity extends Activity {
    private String kind;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Uri data = getIntent().getData();
        kind = data != null ? data.getHost() : null;
        if ("reminders".equals(kind)) { reminders(); return; }
        if ("install".equals(kind)) { install(data); return; }
        if ("drive".equals(kind)) { drive(); return; }
        if ("autofill".equals(kind)) { autofill(); return; }
        if ("health".equals(kind)) {
            startActivity(new Intent(this, HealthPermissionActivity.class));
            finish();
            return;
        }
        String[] perms = "contacts".equals(kind) ? PhoneBridge.CONTACTS_PERMS
                : "calendar".equals(kind) ? PhoneBridge.CALENDAR_PERMS : null;
        if (perms == null) { finish(); return; }
        PhoneBridge bridge = OrosApp.bridge(this);
        if (bridge.granted(perms)) {
            bridge.permissionsChanged();
            finish();
            return;
        }
        boolean asked = getSharedPreferences(PhoneBridge.PREFS, Context.MODE_PRIVATE).getBoolean("asked-" + kind, false);
        boolean canAsk = !asked || shouldShowRequestPermissionRationale(perms[0]);
        if (!canAsk) {
            // Android will not show its dialog again: send the person to
            // the app's settings, where the permission can be switched on.
            Toast.makeText(this, R.string.perm_denied, Toast.LENGTH_LONG).show();
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", getPackageName(), null)));
            finish();
            return;
        }
        requestPermissions(perms, 1);
    }

    /** Single apps (SOLO-1): "intent://install/notes#Intent;scheme=oros-permission;…"
     *  opens /notes/solo.html?install in the person's default browser
     *  (Chrome when none is set). Inside the orOS app a page cannot do
     *  this: its intent to the browser comes back to the TWA, where a
     *  web app cannot be installed. */
    private void install(Uri data) {
        String id = data.getPath() != null ? data.getPath().replaceFirst("^/", "") : "";
        if (id.matches("[a-z0-9-]{1,40}")) {
            Uri page = PhoneBridge.ORIGIN.buildUpon().appendPath(id).appendPath("solo.html")
                    .encodedQuery("install").build();
            Intent i = new Intent(Intent.ACTION_VIEW, page).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            String browser = defaultBrowser();
            i.setPackage(browser != null ? browser : "com.android.chrome");
            try {
                startActivity(i);
            } catch (android.content.ActivityNotFoundException e) {
                // Neither: the person picks a browser.
                startActivity(Intent.createChooser(new Intent(Intent.ACTION_VIEW, page), null)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            }
        }
        finish();
    }

    /** orOS Drive (DRIVE-APP): the orOS Drive app when it is installed,
     *  else where to get it (the download page, which names the F-Droid
     *  repository and the APK). */
    private void drive() {
        Intent open = PhoneBridge.hasDrive(this) ? getPackageManager().getLaunchIntentForPackage(PhoneBridge.DRIVE_APP) : null;
        if (open == null) {
            boolean el = java.util.Locale.getDefault().getLanguage().equals("el");
            open = new Intent(Intent.ACTION_VIEW, Uri.parse("https://useoros.online/download/" + (el ? "?lang=el#drive-el" : "#drive")));
        }
        try {
            startActivity(open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (android.content.ActivityNotFoundException ignored) { }
        finish();
    }

    /** The default browser's package: whoever opens a web link that no
     *  app claims. Null when none is set (Android's chooser) or it is
     *  this app. */
    private String defaultBrowser() {
        android.content.pm.ResolveInfo r = getPackageManager().resolveActivity(
                new Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com/")), PackageManager.MATCH_DEFAULT_ONLY);
        String p = r != null && r.activityInfo != null ? r.activityInfo.packageName : null;
        return p == null || "android".equals(p) || p.equals(getPackageName()) ? null : p;
    }

    /** Reminders (v3): notifications first (Android 13+), then exact
     *  alarms (Android 12+), each from Android's own screen. */
    private void reminders() {
        PhoneBridge bridge = OrosApp.bridge(this);
        if (!"granted".equals(Reminders.permission(this))) {
            boolean asked = getSharedPreferences(PhoneBridge.PREFS, Context.MODE_PRIVATE).getBoolean("asked-reminders", false);
            if (android.os.Build.VERSION.SDK_INT >= 33
                    && (!asked || shouldShowRequestPermissionRationale(android.Manifest.permission.POST_NOTIFICATIONS))) {
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 1);
                return;
            }
            Toast.makeText(this, R.string.perm_denied, Toast.LENGTH_LONG).show();
            Intent i = android.os.Build.VERSION.SDK_INT >= 26
                    ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())
                    : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getPackageName(), null));
            startActivity(i);
            finish();
            return;
        }
        if (!Reminders.exact(this) && android.os.Build.VERSION.SDK_INT >= 31) {
            startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.fromParts("package", getPackageName(), null)));
        }
        bridge.permissionsChanged();
        finish();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        getSharedPreferences(PhoneBridge.PREFS, Context.MODE_PRIVATE).edit().putBoolean("asked-" + kind, true).apply();
        boolean all = grantResults.length > 0;
        for (int r : grantResults) all &= r == PackageManager.PERMISSION_GRANTED;
        if ("reminders".equals(kind)) {
            if (all && !Reminders.exact(this) && android.os.Build.VERSION.SDK_INT >= 31) {
                startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.fromParts("package", getPackageName(), null)));
            }
            OrosApp.bridge(this).permissionsChanged();
            finish();
            return;
        }
        if (all) {
            try {
                OrosAccount.ensure(this);
            } catch (RuntimeException e) {
                OrosApp.bridge(this).diag("account setup failed: " + e);
            }
        }
        OrosApp.bridge(this).permissionsChanged();
        finish();
    }

    /** Passwords autofill (PW-AF2): Android's own screen that makes orOS
     *  the autofill service (Android 8+), else the autofill settings. */
    private void autofill() {
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            try {
                startActivity(new Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE,
                        Uri.fromParts("package", getPackageName(), null)));
            } catch (android.content.ActivityNotFoundException e) {
                Toast.makeText(this, R.string.af_settings_missing, Toast.LENGTH_LONG).show();
            }
        }
        finish();
    }
}
