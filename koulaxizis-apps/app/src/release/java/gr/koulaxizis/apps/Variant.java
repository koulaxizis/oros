package gr.koulaxizis.apps;

/** Build type facts (release build). */
final class Variant {
    /** The debug build (CI, tests) says so in its user agent, so the download counter skips it. */
    static final boolean TEST = false;

    private Variant() {}
}
