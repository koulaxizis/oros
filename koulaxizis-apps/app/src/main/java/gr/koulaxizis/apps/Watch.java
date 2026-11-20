package gr.koulaxizis.apps;

/**
 * What the screen does for an app it is installing when it looks again
 * (APPS-M2 fix 1.2.2). Some phones (Xiaomi/Redmi "security scan", other
 * OEM overlays) cover or close Android's install question, and then no
 * answer ever comes; the screen must never stay on "Working" for that.
 * The screen looks only while it is in front and has been for a moment,
 * so Android's question is not on top of it then. Pure, for unit tests.
 */
final class Watch {
    /** Nothing to do yet. */
    static final int WAIT = 0;
    /** Show Android's question (it came while the screen was covered). */
    static final int PROMPT = 1;
    /** The question was shown and is gone without an answer: ask the person. */
    static final int ASK = 2;
    /** The phone has the new version: count it as done. */
    static final int DONE = 3;
    /** Android dropped the install: count it as not done, the person may retry. */
    static final int LOST = 4;
    /** No answer for too long: stop waiting, the person may retry. */
    static final int GIVE_UP = 5;

    /** How long the screen must be in front before it looks (an answer to a "no" arrives first). */
    static final long SETTLE = 1500;
    /** A shown question counts as gone only this long after the screen came back. */
    static final long GONE = 4000;
    /** The longest wait for Android without a question to show. */
    static final long STALL = 3L * 60 * 1000;
    /** PackageInstaller's progress above this means the install itself is running. */
    static final float INSTALLING = 0.81f;

    private Watch() {}

    /**
     * @param installed the phone has the offered version (or newer) now
     * @param session Android still has the install session (true while it is not known yet)
     * @param confirm Android asked for a yes that is still unanswered
     * @param shown that question was put on screen
     * @param progress the session's progress (0..1), or 0 when unknown
     * @param front how long the screen has been in front
     * @param since when this app last changed phase (commit, question shown)
     */
    static int look(boolean installed, boolean session, boolean confirm, boolean shown,
                    float progress, long front, long since, long now) {
        if (installed) return DONE;
        if (!session) return LOST;
        if (front < SETTLE) return WAIT;
        boolean stalled = now - since >= STALL || now < since;
        if (confirm && progress < INSTALLING) {
            if (!shown) return PROMPT;
            return front >= GONE ? ASK : WAIT;
        }
        return stalled ? GIVE_UP : WAIT;
    }
}
