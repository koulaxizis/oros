package online.useoros.twa;

import java.net.IDN;
import java.text.Normalizer;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Passwords autofill on the phone (PW-AF2): the pure rules, kept in
 * step with the browser add-on (extension/pmfill.js, Bible PW-AF1).
 *  - fits(): a login fits a web page only when the page's host is the
 *    saved host or a sub-domain of it; a login saved for https never
 *    fills an http page; IP addresses need host and port equal; a
 *    single-label host other than localhost fits nothing.
 *  - A web domain counts only when a known browser reports it; in any
 *    other app only the app's own package name counts
 *    (androidapp://package, the Bitwarden convention).
 *  - kind(): which value a field takes, from the autofill hints, the
 *    HTML autocomplete token, the input type, then the field's name,
 *    id and hint text (lower-case, accents removed; EN / EL / DE).
 *  - totp(): RFC 6238, as orOS computes it (pmcore.js).
 */
final class AfMatch {
    private AfMatch() {
    }

    static final Set<String> BROWSERS = new HashSet<>(Arrays.asList(
            "com.android.chrome", "com.chrome.beta", "com.chrome.dev", "com.chrome.canary",
            "org.chromium.chrome", "org.mozilla.firefox", "org.mozilla.firefox_beta", "org.mozilla.fenix",
            "org.mozilla.focus", "org.mozilla.klar", "com.brave.browser", "com.brave.browser_beta",
            "com.microsoft.emmx", "com.sec.android.app.sbrowser", "com.sec.android.app.sbrowser.beta",
            "com.opera.browser", "com.opera.mini.native", "com.vivaldi.browser", "com.duckduckgo.mobile.android",
            "com.ecosia.android", "app.vanadium.browser", "org.ironfoxoss.ironfox", "io.github.forkmaintainers.iceraven",
            "com.mi.globalbrowser", "com.yandex.browser"));

    // ---- web pages ----
    /** [scheme, host, port] of a saved site, or null. A bare host counts as https. */
    static String[] site(String s) {
        if (s == null) return null;
        s = s.trim();
        if (s.isEmpty()) return null;
        if (!s.matches("^[A-Za-z][A-Za-z0-9+.-]*:.*")) s = "https://" + s;
        java.net.URI u;
        try {
            u = new java.net.URI(s);
        } catch (Exception e) {
            return null;
        }
        String sc = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
        if (!sc.equals("https") && !sc.equals("http")) return null;
        String h = u.getHost();
        if (h == null || h.isEmpty()) return null;
        return new String[]{sc, host(h), u.getPort() < 0 ? "" : String.valueOf(u.getPort())};
    }

    static String host(String h) {
        h = h.toLowerCase(Locale.ROOT);
        if (h.endsWith(".")) h = h.substring(0, h.length() - 1);
        if (h.startsWith("[") && h.endsWith("]")) h = h.substring(1, h.length() - 1);
        try {
            return IDN.toASCII(h).toLowerCase(Locale.ROOT);
        } catch (Exception e) {
            return h;
        }
    }

    /** saved: a site of the entry; scheme/host/port: the page (scheme may be null: unknown → http). */
    static boolean fits(String saved, String scheme, String pageHost, String port) {
        String[] a = site(saved);
        if (a == null || pageHost == null || pageHost.isEmpty()) return false;
        String sc = scheme == null ? "http" : scheme.toLowerCase(Locale.ROOT);
        if (!sc.equals("https") && !sc.equals("http")) return false;
        if (a[0].equals("https") && !sc.equals("https")) return false;
        String sh = a[1], ph = host(pageHost);
        if (sh.matches("^\\d+\\.\\d+\\.\\d+\\.\\d+$") || sh.contains(":")) {
            return sh.equals(ph) && a[2].equals(port == null ? "" : port);
        }
        if (!sh.contains(".") && !sh.equals("localhost")) return false;
        return ph.equals(sh) || ph.endsWith("." + sh);
    }

    /** "androidapp://com.bank.app" → "com.bank.app", else null. */
    static String app(String saved) {
        if (saved == null) return null;
        String s = saved.trim();
        if (!s.regionMatches(true, 0, "androidapp://", 0, 13)) return null;
        s = s.substring(13);
        int cut = s.indexOf('/');
        if (cut >= 0) s = s.substring(0, cut);
        return s.matches("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$") ? s : null;
    }

    // ---- fields ----
    static final int NONE = 0, USER = 1, PASS = 2, OTP = 3, CC_NAME = 4, CC_NUM = 5, CC_EXP = 6, CC_MM = 7,
            CC_YY = 8, CVV = 9, FIRST = 10, LAST = 11, FULL = 12, EMAIL = 13, PHONE = 14, COMPANY = 15,
            STREET = 16, LINE2 = 17, CITY = 18, ZIP = 19, REGION = 20, COUNTRY = 21, NEW_PASS = 22;

    static boolean isLogin(int k) {
        return k == USER || k == PASS || k == OTP;
    }

    static boolean isCard(int k) {
        return k >= CC_NAME && k <= CVV;
    }

    static boolean isPerson(int k) {
        return k >= FIRST && k <= COUNTRY;
    }

    /** Android autofill hints (View.AUTOFILL_HINT_* and androidx.autofill HintConstants). */
    static int fromHint(String h) {
        if (h == null) return NONE;
        switch (h.toLowerCase(Locale.ROOT).replace("_", "")) {
            case "username": return USER;
            case "password": case "currentpassword": return PASS;
            case "newpassword": return NEW_PASS;
            case "smsotpcode": case "onetimecode": case "otp": case "2facode": return OTP;
            case "emailaddress": case "email": return EMAIL;
            case "phone": case "phonenumber": case "phonenational": return PHONE;
            case "name": case "personname": return FULL;
            case "persongivenname": case "givenname": return FIRST;
            case "personfamilyname": case "familyname": return LAST;
            case "postalcode": return ZIP;
            case "postaladdressstreetaddress": case "streetaddress": case "postaladdress": return STREET;
            case "postaladdressextendedaddress": case "extendedaddress": return LINE2;
            case "postaladdresslocality": case "addresslocality": return CITY;
            case "postaladdressregion": case "addressregion": return REGION;
            case "postaladdresscountry": case "addresscountry": return COUNTRY;
            case "creditcardnumber": return CC_NUM;
            case "creditcardsecuritycode": return CVV;
            case "creditcardexpirationdate": return CC_EXP;
            case "creditcardexpirationmonth": return CC_MM;
            case "creditcardexpirationyear": return CC_YY;
            case "creditcardholdername": case "personnamecard": return CC_NAME;
            default: return NONE;
        }
    }

    /** HTML autocomplete tokens (the browser passes them in HtmlInfo). */
    static int fromAutocomplete(String ac) {
        if (ac == null) return NONE;
        for (String t : ac.toLowerCase(Locale.ROOT).trim().split("\\s+")) {
            switch (t) {
                case "username": return USER;
                case "current-password": return PASS;
                case "new-password": return NEW_PASS;
                case "one-time-code": return OTP;
                case "cc-name": return CC_NAME;
                case "cc-number": return CC_NUM;
                case "cc-exp": return CC_EXP;
                case "cc-exp-month": return CC_MM;
                case "cc-exp-year": return CC_YY;
                case "cc-csc": return CVV;
                case "given-name": return FIRST;
                case "family-name": return LAST;
                case "name": return FULL;
                case "email": return EMAIL;
                case "tel": case "tel-national": return PHONE;
                case "organization": return COMPANY;
                case "street-address": case "address-line1": return STREET;
                case "address-line2": return LINE2;
                case "address-level2": return CITY;
                case "postal-code": return ZIP;
                case "address-level1": return REGION;
                case "country": case "country-name": return COUNTRY;
                default: break;
            }
        }
        return NONE;
    }

    private static Pattern p(String s) {
        return Pattern.compile(s, Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    }

    // Same words as extension/pmfill.js RX, matched on text without accents.
    private static final Object[][] RX = {
            {OTP, p("one.?time|\\botp\\b|totp|2fa|mfa|two.?factor|verification|auth.?code|κωδικ.*(επαληθευσης|μιας)|bestatigungs|einmal")},
            {CVV, p("cvv|cvc|csc|security.?code|κωδικ.*ασφαλειας|pruf")},
            {CC_NAME, p("card.?holder|name.?on.?card|cc.?name|κατοχ|karteninhaber")},
            {CC_NUM, p("card.?num|cc.?num|credit.?card|αριθμ.*καρτας|kartennummer")},
            {CC_EXP, p("expir|valid.?thru|ληξη|ablauf|gultig")},
            {EMAIL, p("e-?mail")},
            {USER, p("user|login|account|χρηστη|benutzer|anmelde")},
            {FULL, p("full.?name|ονοματεπωνυμο|vollstandiger")},
            {LAST, p("last.?name|surname|family|lname|(?<!ονοματ)επωνυμο|nachname")},
            {FIRST, p("first.?name|given|fname|ονομα(?![α-ω])|vorname")},
            {PHONE, p("phone|mobile|τηλεφωνο|κινητο|telefon")},
            {COMPANY, p("company|organi[sz]ation|εταιρ|firma")},
            {LINE2, p("address.?(line)?.?2|addr2|apartment|suite|floor|οροφ|adresszusatz")},
            {STREET, p("address.?(line)?.?1|street|addr1|οδος|διευθυνση|strasse|straße")},
            {CITY, p("city|town|locality|πολη|stadt")},
            {ZIP, p("zip|postal|post.?code|ταχυδρομικος|plz|postleitzahl")},
            {REGION, p("state|region|province|county|νομος|περιφερεια|bundesland")},
            {COUNTRY, p("country|χωρα")}
    };

    static String fold(String s) {
        if (s == null) return "";
        return Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}+", "").toLowerCase(Locale.ROOT);
    }

    /** Field words (name, id, hint, label) → a kind, or NONE. */
    static int fromText(String text) {
        String t = fold(text);
        if (t.isEmpty()) return NONE;
        for (Object[] r : RX) if (((Pattern) r[1]).matcher(t).find()) return (Integer) r[0];
        return NONE;
    }

    // ---- saving (PW-AF3), as extension/pmfill.js readLogin ----
    /** Which typed password to save: a new-password field first; with
     *  three (current, new, confirm) the second; two equal ones the
     *  first; else the last. -1: none. */
    static int pickPassword(java.util.List<Integer> kinds, java.util.List<String> values) {
        int n = values.size();
        if (n == 0) return -1;
        for (int i = 0; i < n; i++) if (kinds.get(i) == NEW_PASS) return i;
        if (n >= 3) return 1;
        if (n == 2 && values.get(0).equals(values.get(1))) return 0;
        return n - 1;
    }

    // ---- 2FA codes ----
    static String totp(byte[] key, String algo, int digits, int period, long nowMs) throws Exception {
        String mac = "SHA-256".equals(algo) ? "HmacSHA256" : "SHA-512".equals(algo) ? "HmacSHA512" : "HmacSHA1";
        long counter = (nowMs / 1000L) / Math.max(1, period);
        byte[] msg = new byte[8];
        for (int i = 7; i >= 0; i--) {
            msg[i] = (byte) (counter & 0xff);
            counter >>>= 8;
        }
        Mac m = Mac.getInstance(mac);
        m.init(new SecretKeySpec(key, mac));
        byte[] h = m.doFinal(msg);
        int off = h[h.length - 1] & 15;
        int bin = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
        int mod = 1;
        for (int i = 0; i < digits; i++) mod *= 10;
        StringBuilder s = new StringBuilder(String.valueOf(bin % mod));
        while (s.length() < digits) s.insert(0, '0');
        return s.toString();
    }
}
