package net.glarolykoi.android;

import java.util.Locale;

/**
 * Where a link opens (GL-LINK). Pure Java, no Android classes, so it is
 * unit tested on its own (app/src/test).
 *
 * The shop and its payment pages stay in the app; a link the person taps
 * to any other site opens in their browser, so the app never becomes a
 * browser without an address bar. Redirects and loads the person did not
 * tap (a payment provider sending them back, a bank's 3-D Secure step)
 * stay in the app, or the checkout would break half way.
 */
final class Links {
    private Links() {}

    /** The site the app shows. */
    static final String HOME = "https://glarolykoi.net/";

    /** What the app does with a navigation. */
    enum Target { APP, BROWSER, OTHER_APP, BLOCK }

    /** Hosts that always stay in the app: the shop and Viva.com checkout. */
    private static final String[] APP_HOSTS = {
        "glarolykoi.net",
        "vivapayments.com", "viva.com", "vivawallet.com",
    };

    static boolean isSiteHost(String host) {
        return host != null && matches(host.toLowerCase(Locale.ROOT), "glarolykoi.net");
    }

    static boolean isAppHost(String host) {
        if (host == null) return false;
        String h = host.toLowerCase(Locale.ROOT);
        for (String a : APP_HOSTS) if (matches(h, a)) return true;
        return false;
    }

    /** host is base or a subdomain of it ("www.glarolykoi.net"). */
    private static boolean matches(String host, String base) {
        return host.equals(base) || host.endsWith("." + base);
    }

    /**
     * @param scheme     the URL's scheme, lower or upper case, may be null
     * @param host       the URL's host, may be null
     * @param tapped     the person tapped it (WebResourceRequest.hasGesture)
     * @param redirect   a server redirect (WebResourceRequest.isRedirect)
     */
    static Target route(String scheme, String host, boolean tapped, boolean redirect) {
        String s = scheme == null ? "" : scheme.toLowerCase(Locale.ROOT);
        switch (s) {
            case "https":
                if (isAppHost(host)) return Target.APP;
                return tapped && !redirect ? Target.BROWSER : Target.APP;
            case "http":
                // Never load a plain http page inside the app.
                return Target.BROWSER;
            case "tel": case "mailto": case "sms": case "geo": case "viber":
            case "whatsapp": case "market": case "intent":
                return Target.OTHER_APP;
            default:
                // file:, content:, javascript:, data: and unknown schemes.
                return Target.BLOCK;
        }
    }
}
