package online.useoros.twa;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Toast;

/**
 * Health Connect's permission screen (BR-PHONE v5), opened by
 * PermissionActivity for "oros-permission://health". Kept apart
 * because PermissionActivity is noHistory: a full-screen result
 * screen on top would finish it before the answer arrives. When
 * Health Connect is missing or too old, opens its Play Store page.
 */
public class HealthPermissionActivity extends Activity {
    private static final int REQ = 7;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null) return;      // already asked, waiting for the answer
        String st = HealthBridge.status(this);
        if ("update".equals(st)) {
            try {
                startActivity(HealthBridge.installIntent());
            } catch (ActivityNotFoundException e) {
                Toast.makeText(this, R.string.health_missing, Toast.LENGTH_LONG).show();
            }
            finish();
            return;
        }
        if ("unavailable".equals(st)) {
            Toast.makeText(this, R.string.health_missing, Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        try {
            startActivityForResult(HealthBridge.requestIntent(this), REQ);
        } catch (RuntimeException e) {
            OrosApp.bridge(this).diag("health permission screen failed: " + e);
            finish();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        getSharedPreferences(PhoneBridge.PREFS, Context.MODE_PRIVATE).edit().putBoolean("asked-health", true).apply();
        OrosApp.bridge(this).permissionsChanged();
        finish();
    }
}
