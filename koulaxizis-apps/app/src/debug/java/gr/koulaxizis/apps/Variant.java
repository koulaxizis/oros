package gr.koulaxizis.apps;

/** Build type facts (debug build). */
final class Variant {
    /** The debug build (CI, tests) says so in its user agent, so the download counter skips it. */
    static final boolean TEST = true;

    private Variant() {}
}
