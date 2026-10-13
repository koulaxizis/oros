package online.useoros.twa;

import android.app.Activity;
import android.os.Bundle;
import android.widget.ScrollView;
import android.widget.TextView;

/** Diagnostic builds only: shows the phone-bridge steps PhoneBridge
 *  saved (long-press the app icon › "Bridge diagnostics"). */
public class DiagActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        TextView t = new TextView(this);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        t.setPadding(pad, pad, pad, pad);
        t.setTextIsSelectable(true);
        t.setText(getSharedPreferences(PhoneBridge.PREFS, MODE_PRIVATE)
                .getString(PhoneBridge.DIAG_KEY, "(no steps yet: open orOS first)"));
        ScrollView s = new ScrollView(this);
        s.addView(t);
        setContentView(s);
    }
}
