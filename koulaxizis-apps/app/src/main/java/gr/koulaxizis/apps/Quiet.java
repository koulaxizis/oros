package gr.koulaxizis.apps;

import java.util.ArrayList;
import java.util.List;

/**
 * Whether Android will ask before an update (APPS-M6). From Android 12
 * (API 31) an update goes through without a question when this manager
 * asks for it (USER_ACTION_NOT_REQUIRED, with the
 * UPDATE_PACKAGES_WITHOUT_USER_ACTION permission), the app targets a recent
 * SDK (all of ours do) and this manager installed the app last (Android's
 * "installer of record"). From Android 14 an app may also name the one
 * store that owns its updates. A first install always asks, unless the
 * person turned on Shizuku ({@link Silent}). Some phones (Xiaomi/Redmi)
 * add their own question on top; HyperOS even refuses a session that asks
 * for no question (STATUS_FAILURE_ABORTED, "Permission denied", before any
 * question shows). Once seen, this phone counts as one that always asks
 * ({@link #refused}) until its system is updated. Pure, for unit tests.
 */
final class Quiet {
    /** Android asks before every update. */
    static final int ASKS = 0;
    /** The update goes through without a question. */
    static final int QUIET = 1;
    /** Another app installed it: Android asks this once, after that this manager is its installer. */
    static final int ONCE_MORE = 2;

    private Quiet() {}

    /**
     * @param sdk the phone's API level
     * @param me this manager's package
     * @param installer the package that installed the app last, or null
     * @param owner the package that owns its updates (API 34+), or null
     * @param refused this phone's system refused a quiet update before
     */
    static int update(int sdk, String me, String installer, String owner, boolean refused) {
        if (sdk < 31 || refused) return ASKS;
        if (owner != null && !owner.equals(me)) return ASKS;
        return me.equals(installer) ? QUIET : ONCE_MORE;
    }

    /** PackageInstaller.STATUS_FAILURE_ABORTED. */
    static final int ABORTED = 3;

    /**
     * The system refused a session that asked for no question (HyperOS):
     * aborted before the person was asked anything, or with HyperOS's
     * "Permission denied". A "Cancel" on Android's question always comes
     * after a question, so it never counts.
     */
    static boolean refused(int status, boolean triedQuiet, boolean asked, String message) {
        if (status != ABORTED || !triedQuiet) return false;
        if (!asked) return true;
        return message != null && message.toLowerCase(java.util.Locale.ROOT).contains("permission denied");
    }

    /**
     * Whether the daily check may update this app by itself (automatic
     * updates on): only when no question can come, through Shizuku or a
     * quiet update. A question is never put on screen from the background.
     */
    static boolean auto(int quiet, boolean shizuku, boolean mayInstall) {
        return shizuku || (mayInstall && quiet == QUIET);
    }

    /**
     * The shell command Shizuku runs for an install: the APK comes on the
     * command's input, this manager is named as the installer (so later
     * updates are quiet without Shizuku too), for the current user only.
     */
    static List<String> pmInstall(long size, String me) {
        List<String> cmd = new ArrayList<>();
        cmd.add("pm");
        cmd.add("install");
        cmd.add("-r");
        cmd.add("-i");
        cmd.add(me);
        cmd.add("--user");
        cmd.add("current");
        cmd.add("-S");
        cmd.add(Long.toString(size));
        return cmd;
    }

    /** `pm install` succeeded: exit code 0 and "Success" on its output. */
    static boolean pmOk(int exit, String out) {
        return exit == 0 && out != null && out.contains("Success");
    }

    /** What one "Update all" did, for the line at its end. */
    static final class Tally {
        int quiet, asked, failed;

        void add(boolean ok, boolean askedYes) {
            if (!ok) failed++;
            else if (askedYes) asked++;
            else quiet++;
        }

        int done() { return quiet + asked; }

        int total() { return quiet + asked + failed; }

        /** Every app updated and none needed a yes. */
        boolean allQuiet() { return failed == 0 && asked == 0 && quiet > 0; }
    }
}
