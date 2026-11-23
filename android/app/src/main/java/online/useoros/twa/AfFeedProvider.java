package online.useoros.twa;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * PW-AF6 (see AfFeed): orOS Passwords' end of the autofill feed. Only
 * in the "passwords" flavour (android/tools/gen.js), guarded by a
 * signature permission, and it answers only the orOS app's package.
 * It hands out its public keys and its state, stores sealed lists it
 * cannot read without the person's fingerprint, face or screen lock,
 * and forgets them on request. Nothing it returns is secret.
 */
public class AfFeedProvider extends ContentProvider {
    private static final String TAG = "orOS/AfFeedProvider";
    // The lists arrive in parts (AfFeed.CHUNK); one transfer at a time.
    private static final Object LOCK = new Object();
    private static String tok;
    private static int next;
    private static StringBuilder buf;

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Bundle call(String method, String arg, Bundle extras) {
        JSONObject r;
        try {
            if (getContext() == null || !AfFeed.fullPkg(getContext()).equals(getCallingPackage())) {
                throw new SecurityException("not the orOS app");
            }
            r = answer(method, extras);
        } catch (Exception e) {
            Log.w(TAG, method + ": " + e);
            r = AfFeed.err(String.valueOf(e.getMessage()));
        }
        Bundle b = new Bundle();
        b.putString("r", r.toString());
        return b;
    }

    private JSONObject answer(String method, Bundle x) throws Exception {
        android.content.Context c = getContext();
        JSONObject r = new JSONObject();
        switch (method == null ? "" : method) {
            case "state":
                r.put("af", AfVault.state(c));
                return r;
            case "keys":
                AfVault.ensureKeys();
                r.put("idx", AfVault.publicKey(AfVault.ALIAS_INDEX));
                r.put("names", AfVault.publicKey(AfVault.ALIAS_NAMES));
                r.put("af", AfVault.state(c));
                return r;
            case "clear":
                AfVault.clear(c);
                AfVault.deleteKeys();
                r.put("af", AfVault.state(c));
                return r;
            case "index": {
                String all = part(x);
                if (all == null) {   // more parts to come
                    r.put("more", true);
                    return r;
                }
                JSONObject p = new JSONObject(all);
                JSONObject idx = p.optJSONObject("idx"), names = p.optJSONObject("names");
                if (!AfVault.validBlob(idx) || !AfVault.validBlob(names)) return AfFeed.err("bad blob");
                if (!AfVault.hasKeys()) return AfFeed.err("no keys");
                if (!AfFeed.keyFits(p.optString("k", ""), AfVault.publicKey(AfVault.ALIAS_INDEX))) {
                    JSONObject e = AfFeed.err("keys changed");
                    e.put("keys", true);
                    return e;
                }
                AfVault.save(c, idx, names, p.optLong("at", System.currentTimeMillis()));
                r.put("af", AfVault.state(c));
                return r;
            }
            default:
                return AfFeed.err("unknown");
        }
    }

    /** Joins the parts; the whole text after the last one, else null. */
    private static String part(Bundle x) throws JSONException {
        if (x == null) throw new IllegalArgumentException("no part");
        String t = x.getString("tok"), s = x.getString("s");
        int i = x.getInt("i", -1), n = x.getInt("n", 0);
        if (t == null || s == null || n < 1 || i < 0 || i >= n || s.length() > AfFeed.CHUNK) throw new IllegalArgumentException("bad part");
        synchronized (LOCK) {
            if (i == 0) {
                tok = t;
                next = 0;
                buf = new StringBuilder();
            }
            if (!t.equals(tok) || i != next || buf == null) throw new IllegalArgumentException("parts out of order");
            buf.append(s);
            if (buf.length() > AfFeed.MAX_PAYLOAD) {
                buf = null;
                throw new IllegalArgumentException("too large");
            }
            next++;
            if (next < n) return null;
            String all = buf.toString();
            buf = null;
            tok = null;
            return all;
        }
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public String getType(Uri uri) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
