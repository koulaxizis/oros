package gr.koulaxizis.apps;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** The install watch (APPS-M2 fix 1.2.2): an overlay never leaves an app on "Working". */
public class WatchTest {
    private static final long T = 1_000_000;
    private static final long FRONT = Watch.GONE; // in front long enough for every decision

    @Test public void installedCountsAsDoneEvenWithoutAnAnswer() {
        assertEquals(Watch.DONE, Watch.look(true, false, true, true, 0, 0, T, T));
    }

    @Test public void droppedSessionIsLost() {
        assertEquals(Watch.LOST, Watch.look(false, false, false, false, 0, FRONT, T, T));
    }

    @Test public void nothingWhileTheScreenHasJustComeBack() {
        // A "no" from the person arrives right after the screen comes back: wait for it.
        assertEquals(Watch.WAIT, Watch.look(false, true, true, true, 0, Watch.SETTLE - 1, T, T + Watch.STALL));
    }

    @Test public void questionThatCameUnderAnOverlayIsShownOnceInFront() {
        assertEquals(Watch.WAIT, Watch.look(false, true, true, false, 0, Watch.SETTLE - 1, T, T));
        assertEquals(Watch.PROMPT, Watch.look(false, true, true, false, 0, Watch.SETTLE, T, T));
    }

    @Test public void shownQuestionThatWentAwayIsOfferedAgain() {
        assertEquals(Watch.WAIT, Watch.look(false, true, true, true, 0, Watch.GONE - 1, T, T + 5000));
        assertEquals(Watch.ASK, Watch.look(false, true, true, true, 0, Watch.GONE, T, T + 5000));
    }

    @Test public void acceptedQuestionWaitsForTheInstall() {
        assertEquals(Watch.WAIT, Watch.look(false, true, true, true, 0.9f, FRONT, T, T + 5000));
        assertEquals(Watch.GIVE_UP, Watch.look(false, true, true, true, 0.9f, FRONT, T, T + Watch.STALL));
    }

    @Test public void installWithoutQuestionGivesUpAfterTheStall() {
        assertEquals(Watch.WAIT, Watch.look(false, true, false, false, 0.8f, FRONT, T, T + Watch.STALL - 1));
        assertEquals(Watch.GIVE_UP, Watch.look(false, true, false, false, 0.8f, FRONT, T, T + Watch.STALL));
        assertEquals(Watch.GIVE_UP, Watch.look(false, true, false, false, 0.8f, FRONT, T, T - 1)); // clock went back
    }

    @Test public void unansweredQuestionNeverGivesUpByItself() {
        // The person decides: show again or skip.
        assertEquals(Watch.ASK, Watch.look(false, true, true, true, 0, FRONT, T, T + 10 * Watch.STALL));
    }
}
