package online.useoros.twa;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.pm.ProviderInfo;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.security.SecureRandom;

/**
 * PW-AF6: one autofill on the phone, from "orOS Passwords" (Bible
 * "Phone autofill", BR-PHONE v13).
 *
 * With both the orOS app and the single app "orOS Passwords" installed,
 * orOS Passwords is the phone's only Passwords autofill service. The
 * orOS app switches its own OrosAutofillService off (sync()) and, when
 * Passwords is unlocked or changed inside it, hands the lists the page
 * sealed with orOS Passwords' Keystore keys to orOS Passwords
 * (AfFeedProvider) over a provider that only an app signed with our key
 * may call. The orOS app passes ciphertext and public keys only: the
 * values open only inside orOS Passwords, after the fingerprint, face
 * or screen lock, as before. When orOS Passwords is gone, or too old to
 * have the provider, or signed with another key, the orOS app keeps its
 * own autofill exactly as before.
 *
 * The orOS app uses the methods below; orOS Passwords answers in
 * AfFeedProvider. Errors come back as {"err": "…"}, never as thrown
 * exceptions across the process boundary.
 */
final class AfFeed {
    private static final String TAG = "orOS/AfFeed";
    static final String FULL_BASE = "online.useoros.twa";
    static final String PASS_BASE = "online.useoros.passwords";
    static final String AUTH_TAIL = ".affeed";
    /** Characters per call: a Binder transaction holds about 1 MB. */
    static final int CHUNK = 128 * 1024;
    /** The whole sealed payload (two lists of at most MAX_BLOB each). */
    static final int MAX_PAYLOAD = 2 * AfVault.MAX_BLOB + 4096;

    private AfFeed() {
    }

    /** ".debug" for debug builds: both apps carry the same suffix. */
    private static String suffix(Context c) {
        String p = c.getPackageName();
        if (p.startsWith(FULL_BASE)) return p.substring(FULL_BASE.length());
        if (p.startsWith(PASS_BASE)) return p.substring(PASS_BASE.length());
        return "";
    }

    static String passPkg(Context c) {
        return PASS_BASE + suffix(c);
    }

    static String fullPkg(Context c) {
        return FULL_BASE + suffix(c);
    }

    static String authority(Context c) {
        return passPkg(c) + AUTH_TAIL;
    }

    private static Uri uri(Context c) {
        return Uri.parse("content://" + authority(c));
    }

    /** The orOS app, with an orOS Passwords that has the feed and is
     *  signed with the same key. */
    static boolean available(Context c) {
        if (!PhoneBridge.FULL || android.os.Build.VERSION.SDK_INT < 26) return false;
        try {
            PackageManager pm = c.getPackageManager();
            ProviderInfo pi = pm.resolveContentProvider(authority(c), 0);
            if (pi == null || !passPkg(c).equals(pi.packageName)) return false;
            return pm.checkSignatures(c.getPackageName(), passPkg(c)) == PackageManager.SIGNATURE_MATCH;
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** The orOS app only: its own autofill service is off exactly while
     *  orOS Passwords takes the feed, and then its own copy and fill keys
     *  go (logins waiting to be saved stay). Returns available(). */
    static boolean sync(Context c) {
        if (!PhoneBridge.FULL) return false;
        boolean pass = available(c);
        try {
            PackageManager pm = c.getPackageManager();
            ComponentName svc = new ComponentName(c, OrosAutofillService.class);
            int want = pass ? PackageManager.COMPONENT_ENABLED_STATE_DISABLED : PackageManager.COMPONENT_ENABLED_STATE_DEFAULT;
            if (pm.getComponentEnabledSetting(svc) != want) {
                pm.setComponentEnabledSetting(svc, want, PackageManager.DONT_KILL_APP);
                Log.i(TAG, pass ? "own autofill off: orOS Passwords fills" : "own autofill on");
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "service switch: " + e);
        }
        if (pass && (AfVault.stored(c) || AfVault.hasKeys())) {
            AfVault.dropCopy(c);
            AfVault.deleteFillKeys();
        }
        return pass;
    }

    private static JSONObject call(Context c, String method, Bundle extras) {
        try {
            Bundle b = c.getContentResolver().call(uri(c), method, null, extras);
            String s = b == null ? null : b.getString("r");
            return s == null ? err("no answer") : new JSONObject(s);
        } catch (Exception e) {
            Log.w(TAG, method + ": " + e);
            return err(String.valueOf(e.getMessage()));
        }
    }

    static JSONObject err(String msg) {
        JSONObject o = new JSONObject();
        try {
            o.put("err", msg == null ? "error" : msg);
        } catch (JSONException ignored) {
        }
        return o;
    }

    /** {af} : orOS Passwords' autofill state. */
    static JSONObject state(Context c) {
        return call(c, "state", null);
    }

    /** {idx, names, af}: orOS Passwords' public keys (made once there). */
    static JSONObject keys(Context c) {
        return call(c, "keys", null);
    }

    /** {af}: copies and fill keys removed in orOS Passwords. */
    static JSONObject clear(Context c) {
        return call(c, "clear", null);
    }

    /** {af} or {err, keys?}: the sealed lists stored in orOS Passwords.
     *  k: the tail of the index key the page sealed with ("" = not told). */
    static JSONObject index(Context c, JSONObject idx, JSONObject names, long at, String k) {
        String all;
        try {
            JSONObject p = new JSONObject();
            p.put("idx", idx);
            p.put("names", names);
            p.put("at", at);
            p.put("k", k == null ? "" : k);
            all = p.toString();
        } catch (JSONException e) {
            return err("bad lists");
        }
        if (all.length() > MAX_PAYLOAD) return err("too large");
        byte[] r = new byte[12];
        new SecureRandom().nextBytes(r);
        String tok = android.util.Base64.encodeToString(r, android.util.Base64.NO_WRAP | android.util.Base64.URL_SAFE);
        int n = (all.length() + CHUNK - 1) / CHUNK;
        JSONObject last = err("no answer");
        for (int i = 0; i < n; i++) {
            Bundle x = new Bundle();
            x.putString("tok", tok);
            x.putInt("i", i);
            x.putInt("n", n);
            x.putString("s", all.substring(i * CHUNK, Math.min(all.length(), (i + 1) * CHUNK)));
            last = call(c, "index", x);
            if (last.has("err")) return last;
        }
        return last;
    }

    /** k: the end of the SPKI the page sealed with; empty = an older page. */
    static boolean keyFits(String k, String spki) {
        if (k == null || k.isEmpty()) return true;
        return spki != null && k.length() >= 16 && spki.endsWith(k);
    }
}
