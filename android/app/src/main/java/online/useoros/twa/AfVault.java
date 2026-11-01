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
 */
final class AfVault {
    static final String ALIAS_INDEX = "oros-af-index";
    static final String ALIAS_NAMES = "oros-af-names";
    static final int AUTH_SECONDS = 30;
    private static final String PREFS = "oros-autofill";
    private static final String RSA = "RSA/ECB/OAEPWithSHA-1AndMGF1Padding";
    static final int MAX_BLOB = 8 * 1024 * 1024;

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

    /** Forgets the copies; keeps the per-phone app links. */
    static void clear(Context c) {
        prefs(c).edit().remove("index").remove("names").remove("at").commit();
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
