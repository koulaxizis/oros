package online.useoros.twa;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PersistableBundle;

/**
 * PW-CLIP (BR-PHONE v14): Passwords copies a secret through the app,
 * because the web Clipboard API cannot say "this is a password".
 *
 * The copy carries ClipDescription.EXTRA_IS_SENSITIVE (Android 13+
 * then shows "••••••" in its copy preview and keyboards keep it out of
 * their clipboard history; older Android versions read the same key
 * name, so it is set there too). After ms the app clears the clipboard
 * itself, also when orOS is no longer on screen (a page cannot: the
 * browser refuses without focus). Like the page, it clears even if
 * something else was copied since: since Android 10 an app cannot read
 * the clipboard in the background to check. The text is never logged
 * or stored; only the latest copy's clear counts.
 */
final class Clip {
    static final int MAX_CHARS = 100000;
    static final long MIN_MS = 5000, MAX_MS = 600000;
    /** android.content.ClipDescription.EXTRA_IS_SENSITIVE (API 33). */
    static final String EXTRA_SENSITIVE = "android.content.extra.IS_SENSITIVE";

    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static int gen;          // main thread only
    private static boolean ours;     // the latest copy is ours and not cleared yet

    private Clip() {}

    /** Copies text marked sensitive; ms > 0 clears it after ms. Main thread. */
    static void set(Context c, String text, long ms) {
        ClipboardManager cm = (ClipboardManager) c.getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm == null) throw new IllegalStateException("no clipboard");
        ClipData cd = ClipData.newPlainText("orOS", text);
        PersistableBundle ex = new PersistableBundle();
        ex.putBoolean(Build.VERSION.SDK_INT >= 33 ? ClipDescription.EXTRA_IS_SENSITIVE : EXTRA_SENSITIVE, true);
        cd.getDescription().setExtras(ex);
        cm.setPrimaryClip(cd);
        final int my = ++gen;
        ours = true;
        if (ms > 0) {
            long wait = Math.max(MIN_MS, Math.min(MAX_MS, ms));
            final Context app = c.getApplicationContext();
            MAIN.postDelayed(() -> { if (gen == my) clear(app); }, wait);
        }
    }

    /** Clears the copy made by set(), once. Main thread. Returns whether it cleared. */
    static boolean clear(Context c) {
        if (!ours) return false;
        ours = false;
        gen++;
        ClipboardManager cm = (ClipboardManager) c.getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm == null) return false;
        if (Build.VERSION.SDK_INT >= 28) cm.clearPrimaryClip();
        else cm.setPrimaryClip(ClipData.newPlainText("", ""));
        return true;
    }
}
