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

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        getSharedPreferences(PhoneBridge.PREFS, Context.MODE_PRIVATE).edit().putBoolean("asked-" + kind, true).apply();
        boolean all = grantResults.length > 0;
        for (int r : grantResults) all &= r == PackageManager.PERMISSION_GRANTED;
        if (all) OrosAccount.ensure(this);
        OrosApp.bridge(this).permissionsChanged();
        finish();
    }
}
