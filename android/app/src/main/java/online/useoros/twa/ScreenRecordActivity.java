package online.useoros.twa;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

/**
 * Screen recording on the phone (QS-REC-1 Android, 2026-11-27). Opened by
 * orOS from a tap on Quick settings' "Screen recording"
 * ("intent://start?mic=1#Intent;scheme=oros-rec;…"): Chrome on Android
 * cannot share the screen with a page, so the app records it.
 *
 * A recording already running stops (the same button starts and stops).
 * Otherwise: the microphone permission first when orOS asks for the
 * microphone (Screen Capture's option, off by default; refused = a
 * recording without sound), then Android's own "start recording?"
 * screen, then {@link ScreenRecordService} records. Shows nothing of its
 * own and finishes, so orOS is back on screen.
 */
public class ScreenRecordActivity extends Activity {
    private static final int ASK_MIC = 1, ASK_CAPTURE = 2;
    private boolean mic;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!PhoneBridge.FULL) { finish(); return; }
        Uri data = getIntent().getData();
        String what = data != null ? data.getHost() : null;
        if (ScreenRecordService.running() || "stop".equals(what)) {
            ScreenRecordService.stop(this);
            finish();
            return;
        }
        if (!"start".equals(what)) { finish(); return; }
        mic = "1".equals(data.getQueryParameter("mic"));
        if (mic && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            boolean asked = getSharedPreferences(PhoneBridge.PREFS, Context.MODE_PRIVATE).getBoolean("asked-rec-mic", false);
            if (!asked || shouldShowRequestPermissionRationale(Manifest.permission.RECORD_AUDIO)) {
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, ASK_MIC);
                return;
            }
            mic = false;   // refused for good: record without the microphone
        }
        // Android 13+: the notification with Stop needs this; asked once.
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                && !getSharedPreferences(PhoneBridge.PREFS, Context.MODE_PRIVATE).getBoolean("asked-rec-note", false)) {
            getSharedPreferences(PhoneBridge.PREFS, Context.MODE_PRIVATE).edit().putBoolean("asked-rec-note", true).apply();
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, ASK_MIC);
            return;
        }
        askCapture();
    }

    private void askCapture() {
        MediaProjectionManager pm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (pm == null) { finish(); return; }
        try {
            startActivityForResult(pm.createScreenCaptureIntent(), ASK_CAPTURE);
        } catch (android.content.ActivityNotFoundException e) {
            finish();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode != ASK_MIC) { finish(); return; }
        for (int i = 0; i < permissions.length; i++) {
            if (Manifest.permission.RECORD_AUDIO.equals(permissions[i])) {
                getSharedPreferences(PhoneBridge.PREFS, Context.MODE_PRIVATE).edit().putBoolean("asked-rec-mic", true).apply();
                if (grantResults.length <= i || grantResults[i] != PackageManager.PERMISSION_GRANTED) mic = false;
            }
        }
        askCapture();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == ASK_CAPTURE && resultCode == RESULT_OK && data != null) {
            ScreenRecordService.start(this, resultCode, data, mic);
        }
        finish();
    }
}
