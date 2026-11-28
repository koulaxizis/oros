package gr.koulaxizis.apps;

import android.content.Context;
import android.content.pm.PackageManager;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.List;

import rikka.shizuku.Shizuku;

/**
 * Optional installs without any question through Shizuku (APPS-M6, off by
 * default, the person turns it on in the menu). Shizuku is a separate app
 * that runs a helper with the shell's rights (started with Wireless
 * debugging, no root); with its permission this manager runs `pm install`
 * there. The APK has passed every check of {@link Installer} before it gets
 * here; Play Protect is never touched. Anything that goes wrong returns
 * false, and the normal install (with Android's question) follows.
 */
final class Silent {
    static final int REQUEST = 7;
    private static final String PREF = "shizuku";

    private Silent() {}

    /** The person turned it on in the menu. */
    static boolean on(Context ctx) {
        return UpdateJob.prefs(ctx).getBoolean(PREF, false);
    }

    static void set(Context ctx, boolean on) {
        UpdateJob.prefs(ctx).edit().putBoolean(PREF, on).apply();
    }

    /** Shizuku is installed and its helper runs now. */
    static boolean running() {
        try {
            return Shizuku.pingBinder() && !Shizuku.isPreV11();
        } catch (Throwable t) {
            return false;
        }
    }

    /** Shizuku runs and lets this manager use it. */
    static boolean allowed() {
        try {
            return running() && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED;
        } catch (Throwable t) {
            return false;
        }
    }

    /** Turned on, running and allowed: installs go this way. */
    static boolean ready(Context ctx) {
        return on(ctx) && allowed();
    }

    /** Blocking: call off the main thread. True only when Android reports the app installed. */
    static boolean install(Context ctx, File apk) {
        Process p = null;
        try {
            List<String> cmd = Quiet.pmInstall(apk.length(), ctx.getPackageName());
            p = start(cmd.toArray(new String[0]));
            if (p == null) return false;
            try (InputStream in = new FileInputStream(apk); OutputStream out = p.getOutputStream()) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            String said = read(p.getInputStream()) + read(p.getErrorStream());
            return Quiet.pmOk(p.waitFor(), said);
        } catch (Throwable t) {
            return false;
        } finally {
            if (p != null) p.destroy();
        }
    }

    /**
     * Shizuku API 13 keeps its process call private (planned to be replaced
     * by its "user service"); it still works and is kept by proguard-rules.pro.
     */
    private static Process start(String[] cmd) throws Exception {
        Method m = Shizuku.class.getDeclaredMethod("newProcess", String[].class, String[].class, String.class);
        m.setAccessible(true);
        return (Process) m.invoke(null, cmd, null, null);
    }

    private static String read(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) > 0 && b.size() < 64 * 1024) b.write(buf, 0, n);
        return b.toString("UTF-8");
    }
}
