package online.useoros.twa;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/** Health Connect shows this app's privacy policy from its own
 *  screens (BR-PHONE v5): open orOS's privacy page. */
public class HealthPrivacyActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Uri u = Uri.parse(getString(R.string.launchUrl)).buildUpon().path("/privacy.html").build();
        startActivity(new Intent(this, LauncherActivity.class).setAction(Intent.ACTION_VIEW).setData(u)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        finish();
    }
}
