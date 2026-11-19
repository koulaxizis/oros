package gr.koulaxizis.apps;

/** A repository or download that failed a check; {@link #code} picks the message shown. */
final class RepoException extends Exception {
    static final String NETWORK = "network";
    static final String SIGNATURE = "signature";
    static final String HASH = "hash";
    static final String OLDER = "older";
    static final String FORMAT = "format";
    static final String TOO_BIG = "too_big";

    final String code;

    RepoException(String code, String detail) {
        super(code + ": " + detail);
        this.code = code;
    }

    RepoException(String code, String detail, Throwable cause) {
        super(code + ": " + detail, cause);
        this.code = code;
    }
}
