package gr.koulaxizis.apps;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;

import org.junit.Test;

/** Fewer questions (APPS-M6): when Android asks, what runs by itself, Shizuku's command, the "Update all" line. */
public class QuietTest {
    private static final String ME = "gr.koulaxizis.apps";

    @Test public void android11AndOlderAlwaysAsk() {
        assertEquals(Quiet.ASKS, Quiet.update(30, ME, ME, null, false));
        assertEquals(Quiet.ASKS, Quiet.update(26, ME, ME, null, false));
    }

    @Test public void ourOwnInstallsUpdateQuietlyFromAndroid12() {
        assertEquals(Quiet.QUIET, Quiet.update(31, ME, ME, null, false));
        assertEquals(Quiet.QUIET, Quiet.update(36, ME, ME, ME, false));
    }

    @Test public void anotherInstallerAsksOnceMore() {
        assertEquals(Quiet.ONCE_MORE, Quiet.update(34, ME, "org.fdroid.fdroid", null, false));
        assertEquals(Quiet.ONCE_MORE, Quiet.update(31, ME, null, null, false)); // adb or a browser download
    }

    @Test public void anotherUpdateOwnerAlwaysAsks() {
        assertEquals(Quiet.ASKS, Quiet.update(34, ME, ME, "com.looker.droidify", false));
        assertEquals(Quiet.ASKS, Quiet.update(34, ME, "com.android.vending", "com.android.vending", false));
    }

    @Test public void aPhoneThatRefusedOnceAlwaysAsks() {
        assertEquals(Quiet.ASKS, Quiet.update(36, ME, ME, null, true));
    }

    @Test public void hyperOsRefusalIsNotACancel() {
        // HyperOS aborts a quiet session before any question.
        assertTrue(Quiet.refused(Quiet.ABORTED, true, false, "INSTALL_FAILED_ABORTED: Permission denied"));
        assertTrue(Quiet.refused(Quiet.ABORTED, true, false, null));
        assertTrue(Quiet.refused(Quiet.ABORTED, true, true, "Permission denied"));
        // "Cancel" on Android's question, a session that asked for a question, other failures.
        assertFalse(Quiet.refused(Quiet.ABORTED, true, true, null));
        assertFalse(Quiet.refused(Quiet.ABORTED, true, true, "User rejected permissions"));
        assertFalse(Quiet.refused(Quiet.ABORTED, false, false, "Permission denied"));
        assertFalse(Quiet.refused(1, true, false, "Permission denied"));
    }

    @Test public void theDailyCheckInstallsOnlyWhatNeedsNoQuestion() {
        assertTrue(Quiet.auto(Quiet.QUIET, false, true));
        assertFalse(Quiet.auto(Quiet.ONCE_MORE, false, true));
        assertFalse(Quiet.auto(Quiet.ASKS, false, true));
        // Without the "install unknown apps" switch Android would ask.
        assertFalse(Quiet.auto(Quiet.QUIET, false, false));
        // Shizuku needs no question at all.
        assertTrue(Quiet.auto(Quiet.ASKS, true, false));
    }

    @Test public void shizukuRunsPmInstallFromItsInputAsThisManager() {
        assertEquals(Arrays.asList("pm", "install", "-r", "-i", ME, "--user", "current", "-S", "12345"),
            Quiet.pmInstall(12345, ME));
    }

    @Test public void pmInstallCountsOnlyARealSuccess() {
        assertTrue(Quiet.pmOk(0, "Success\n"));
        assertFalse(Quiet.pmOk(0, ""));
        assertFalse(Quiet.pmOk(1, "Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]"));
        assertFalse(Quiet.pmOk(0, null));
    }

    @Test public void updateAllLine() {
        Quiet.Tally t = new Quiet.Tally();
        t.add(true, false);
        t.add(true, false);
        assertTrue(t.allQuiet());
        t.add(true, true);
        t.add(false, true);
        assertFalse(t.allQuiet());
        assertEquals(2, t.quiet);
        assertEquals(1, t.asked);
        assertEquals(1, t.failed);
        assertEquals(3, t.done());
        assertEquals(4, t.total());
        assertFalse(new Quiet.Tally().allQuiet());
    }
}
