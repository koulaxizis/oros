package online.useoros.twa;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Passwords autofill on the phone (PW-AF2): the two Android Keystore
 * keys and the sealed copies the page hands over through BR-PHONE.
 *
 * The page (passwords/afindex.js) builds two lists while the vault is
 * open and seals each with a fresh AES-256-GCM key wrapped by one of
 * our RSA-OAEP public keys (SHA-1 for both OAEP digests: WebCrypto
 * uses one hash for OAEP and MGF1, and Android Keystore's RSA keys
 * support MGF1 with SHA-1 only).
 *  - "names" (key ALIAS_NAMES, no user authentication): titles, user
 *    names, sites and Android apps, so the service knows what to
 *    suggest on which screen.
 *  - "index" (key ALIAS_INDEX, opens only within AUTH_SECONDS of a
 *    fingerprint / face / screen lock, and is invalidated when a new
 *    fingerprint is enrolled): the values to fill.
 * Neither key ever leaves the Keystore; the master password and the
 * vault key never reach this side. Nothing is kept in plain text.
 *
 * PW-AF3: a login the person asks Android to save waits here, sealed
 * with a third Keystore key (ALIAS_SAVE, AES-GCM), until the orOS page
 * takes it over the bridge ({t:"af-save"}); at most MAX_SAVES, each
 * for SAVE_HOURS. orOS shows it in the Passwords editor and stores it
 * only when the person presses Save there.
 */
final class AfVault {
    static final String ALIAS_INDEX = "oros-af-index";
    static final String ALIAS_NAMES = "oros-af-names";
    static final int AUTH_SECONDS = 30;
    private static final String PREFS = "oros-autofill";
    private static final String RSA = "RSA/ECB/OAEPWithSHA-1AndMGF1Padding";
    static final int MAX_BLOB = 8 * 1024 * 1024;
    static final String ALIAS_SAVE = "oros-af-save";
    static final int MAX_SAVES = 10;
    static final long SAVE_HOURS = 24;

    private AfVault() {
    }

    private static KeyStore ks() throws Exception {
        KeyStore k = KeyStore.getInstance("AndroidKeyStore");
        k.load(null);
        return k;
    }

    static boolean hasKeys() {
        try {
            KeyStore k = ks();
            return k.containsAlias(ALIAS_INDEX) && k.containsAlias(ALIAS_NAMES);
        } catch (Exception e) {
            return false;
        }
    }

    /** Creates the keys once (RSA 3072, a second or two on a phone). */
    static synchronized void ensureKeys() throws Exception {
        KeyStore k = ks();
        if (!k.containsAlias(ALIAS_NAMES)) make(ALIAS_NAMES, false);
        if (!k.containsAlias(ALIAS_INDEX)) make(ALIAS_INDEX, true);
    }

    private static void make(String alias, boolean auth) throws Exception {
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(3072)
                .setDigests(KeyProperties.DIGEST_SHA1, KeyProperties.DIGEST_SHA256)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP);
        if (auth) {
            b.setUserAuthenticationRequired(true);
            b.setInvalidatedByBiometricEnrollment(true);
            if (Build.VERSION.SDK_INT >= 30) {
                b.setUserAuthenticationParameters(AUTH_SECONDS,
                        KeyProperties.AUTH_BIOMETRIC_STRONG | KeyProperties.AUTH_DEVICE_CREDENTIAL);
            } else {
                b.setUserAuthenticationValidityDurationSeconds(AUTH_SECONDS);
            }
        }
        KeyPairGenerator g = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore");
        g.initialize(b.build());
        g.generateKeyPair();
    }

    /** Public key as base64 SPKI (what WebCrypto imports). */
    static String publicKey(String alias) throws Exception {
        PublicKey p = ks().getCertificate(alias).getPublicKey();
        return Base64.encodeToString(p.getEncoded(), Base64.NO_WRAP);
    }

    /** Removes the keys (autofill turned off, or a key was invalidated). */
    static synchronized void deleteKeys() {
        try {
            KeyStore k = ks();
            k.deleteEntry(ALIAS_INDEX);
            k.deleteEntry(ALIAS_NAMES);
            k.deleteEntry(ALIAS_SAVE);
        } catch (Exception ignored) {
        }
    }

    // ---- the sealed copies ----
    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean stored(Context c) {
        SharedPreferences p = prefs(c);
        return p.contains("index") && p.contains("names");
    }

    static long storedAt(Context c) {
        return prefs(c).getLong("at", 0);
    }

    static void save(Context c, JSONObject index, JSONObject names, long at) {
        prefs(c).edit().putString("index", index.toString()).putString("names", names.toString())
                .putLong("at", at).commit();
    }

    /** Forgets the copies and the logins waiting to be saved; keeps
     *  the per-phone app links. */
    static void clear(Context c) {
        prefs(c).edit().remove("index").remove("names").remove("at").remove("saves").commit();
    }

    /** Checks the shape the page sends: {w, iv, ct} base64, bounded. */
    static boolean validBlob(JSONObject o) {
        if (o == null) return false;
        String w = o.optString("w"), iv = o.optString("iv"), ct = o.optString("ct");
        return !w.isEmpty() && w.length() < 2048 && !iv.isEmpty() && iv.length() < 64
                && !ct.isEmpty() && ct.length() < MAX_BLOB;
    }

    /** Opens the "names" list (no authentication needed). */
    static JSONArray names(Context c) throws Exception {
        String s = prefs(c).getString("names", null);
        if (s == null) return null;
        return new JSONArray(open(ALIAS_NAMES, new JSONObject(s)));
    }

    /** Opens the "index" list. Throws UserNotAuthenticatedException
     *  when the person has not unlocked within AUTH_SECONDS, and
     *  KeyPermanentlyInvalidatedException after a new fingerprint. */
    static JSONArray index(Context c) throws Exception {
        String s = prefs(c).getString("index", null);
        if (s == null) return null;
        return new JSONArray(open(ALIAS_INDEX, new JSONObject(s)));
    }

    private static String open(String alias, JSONObject blob) throws Exception {
        PrivateKey key = (PrivateKey) ks().getKey(alias, null);
        if (key == null) throw new IllegalStateException("no key");
        Cipher rsa = Cipher.getInstance(RSA);
        rsa.init(Cipher.DECRYPT_MODE, key);
        byte[] raw = rsa.doFinal(Base64.decode(blob.getString("w"), Base64.NO_WRAP));
        byte[] plain = null;
        try {
            Cipher gcm = Cipher.getInstance("AES/GCM/NoPadding");
            gcm.init(Cipher.DECRYPT_MODE, new SecretKeySpec(raw, "AES"),
                    new GCMParameterSpec(128, Base64.decode(blob.getString("iv"), Base64.NO_WRAP)));
            plain = gcm.doFinal(Base64.decode(blob.getString("ct"), Base64.NO_WRAP));
            return new String(plain, StandardCharsets.UTF_8);
        } finally {
            Arrays.fill(raw, (byte) 0);
            if (plain != null) Arrays.fill(plain, (byte) 0);
        }
    }

    // ---- logins waiting to be saved in orOS (PW-AF3) ----
    private static SecretKey saveKey() throws Exception {
        KeyStore k = ks();
        if (k.containsAlias(ALIAS_SAVE)) return (SecretKey) k.getKey(ALIAS_SAVE, null);
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder(ALIAS_SAVE, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return g.generateKey();
    }

    private static JSONArray saves(SharedPreferences p) {
        try {
            return new JSONArray(p.getString("saves", "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    /** Seals one login {url|app, user, pw, title} and keeps it until
     *  the page takes it. The oldest goes when there are MAX_SAVES. */
    static synchronized void queueSave(Context c, JSONObject item) throws Exception {
        Cipher gcm = Cipher.getInstance("AES/GCM/NoPadding");
        gcm.init(Cipher.ENCRYPT_MODE, saveKey());
        byte[] plain = item.toString().getBytes(StandardCharsets.UTF_8);
        byte[] ct;
        try {
            ct = gcm.doFinal(plain);
        } finally {
            Arrays.fill(plain, (byte) 0);
        }
        long now = System.currentTimeMillis();
        JSONArray old = saves(prefs(c)), keep = new JSONArray();
        for (int i = Math.max(0, old.length() - (MAX_SAVES - 1)); i < old.length(); i++) {
            JSONObject o = old.optJSONObject(i);
            if (o != null && now - o.optLong("at") < SAVE_HOURS * 3600_000L) keep.put(o);
        }
        JSONObject o = new JSONObject();
        o.put("ref", Long.toString(now, 36) + "-" + Integer.toString((int) (Math.random() * 1e6), 36));
        o.put("at", now);
        o.put("iv", Base64.encodeToString(gcm.getIV(), Base64.NO_WRAP));
        o.put("ct", Base64.encodeToString(ct, Base64.NO_WRAP));
        keep.put(o);
        prefs(c).edit().putString("saves", keep.toString()).commit();
    }

    /** The logins still waiting, opened, each with its ref. */
    static synchronized JSONArray pendingSaves(Context c) {
        JSONArray out = new JSONArray();
        JSONArray all = saves(prefs(c));
        if (all.length() == 0) return out;
        long now = System.currentTimeMillis();
        try {
            SecretKey key = saveKey();
            for (int i = 0; i < all.length(); i++) {
                JSONObject o = all.optJSONObject(i);
                if (o == null || now - o.optLong("at") >= SAVE_HOURS * 3600_000L) continue;
                byte[] plain = null;
                try {
                    Cipher gcm = Cipher.getInstance("AES/GCM/NoPadding");
                    gcm.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Base64.decode(o.getString("iv"), Base64.NO_WRAP)));
                    plain = gcm.doFinal(Base64.decode(o.getString("ct"), Base64.NO_WRAP));
                    JSONObject it = new JSONObject(new String(plain, StandardCharsets.UTF_8));
                    it.put("ref", o.optString("ref"));
                    out.put(it);
                } catch (Exception ignored) {
                    // a copy that no longer opens is dropped by takenSaves
                } finally {
                    if (plain != null) Arrays.fill(plain, (byte) 0);
                }
            }
        } catch (Exception ignored) {
        }
        return out;
    }

    /** The page took these (and expired ones go too). */
    static synchronized void takenSaves(Context c, JSONArray refs) {
        JSONArray all = saves(prefs(c)), keep = new JSONArray();
        long now = System.currentTimeMillis();
        for (int i = 0; i < all.length(); i++) {
            JSONObject o = all.optJSONObject(i);
            if (o == null || now - o.optLong("at") >= SAVE_HOURS * 3600_000L) continue;
            boolean taken = false;
            for (int j = 0; refs != null && j < refs.length(); j++) if (o.optString("ref").equals(refs.optString(j))) taken = true;
            if (!taken) keep.put(o);
        }
        prefs(c).edit().putString("saves", keep.toString()).commit();
    }

    // ---- links from apps to logins, made on this phone ----
    /** Logins the person chose for an app that no entry names
     *  (package → entry ids). Never synced; the entry ids say nothing
     *  without the vault. */
    static JSONArray links(Context c, String pkg) {
        try {
            JSONObject all = new JSONObject(prefs(c).getString("links", "{}"));
            JSONArray a = all.optJSONArray(pkg);
            return a != null ? a : new JSONArray();
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    static void link(Context c, String pkg, String id) {
        try {
            JSONObject all = new JSONObject(prefs(c).getString("links", "{}"));
            JSONArray a = all.optJSONArray(pkg);
            if (a == null) a = new JSONArray();
            for (int i = 0; i < a.length(); i++) if (id.equals(a.optString(i))) return;
            a.put(id);
            all.put(pkg, a);
            prefs(c).edit().putString("links", all.toString()).commit();
        } catch (JSONException ignored) {
        }
    }
}
