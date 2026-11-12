package online.useoros.twa;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.hardware.biometrics.BiometricManager;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Iterator;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Passwords: unlock with fingerprint or face (PW-BIO, BR-PHONE v9).
 *
 * One Android Keystore AES-256-GCM key (ALIAS) that works only right
 * after a strong biometric (fingerprint or face, never the screen PIN:
 * a 4-digit PIN is weaker than the master password), for each use
 * (BiometricPrompt CryptoObject), and is invalidated for good when a
 * new fingerprint or face is enrolled. Per vault (kid) it seals one
 * 32-byte random secret, generated here, in this app's private prefs.
 * The page keeps the vault key wrapped with that secret in its own
 * storage (passwords/pmcrypto.js section 7); neither half opens the
 * vault alone, and the master password still does. This side never
 * sees the vault, its key or the master password.
 *
 * A request comes in two parts: {t:"pw-bio", op:"want", act, kid, n}
 * over the port, then the page's intent://<act>?n=<n> (scheme oros-bio)
 * opens BioActivity, which acts only on the "want" with that n (one
 * use, WANT_MS). Any other page or app that opens the link gets nothing.
 */
final class BioVault {
    static final String ALIAS = "oros-pw-bio";
    private static final String PREFS = "oros-pw-bio";
    static final long WANT_MS = 120000;
    static final int MAX_KIDS = 16;
    private static final Pattern KID = Pattern.compile("[0-9a-f]{24}");
    private static final Pattern NONCE = Pattern.compile("[0-9a-f]{32}");

    private BioVault() {
    }

    // ---- the request the page announced ----
    static final class Want {
        final String act, kid, n;
        /** "lock" = the orOS screen lock asks (BR-PHONE v11), else Passwords. */
        final boolean lock;
        final long at;

        Want(String act, String kid, String n, boolean lock, long at) {
            this.act = act;
            this.kid = kid;
            this.n = n;
            this.lock = lock;
            this.at = at;
        }
    }

    private static Want want;

    /** {op:"want"} from the page: replaces any earlier one. */
    static synchronized boolean announce(String act, String kid, String n, String use) {
        if (!("seal".equals(act) || "open".equals(act)) || !validKid(kid) || n == null || !NONCE.matcher(n).matches()) return false;
        want = new Want(act, kid, n, "lock".equals(use), System.currentTimeMillis());
        return true;
    }

    /** The announced request with this act and n, taken once. */
    static synchronized Want take(String act, String n) {
        Want w = want;
        if (w == null || n == null || !w.n.equals(n) || !w.act.equals(act)) return null;
        want = null;
        return System.currentTimeMillis() - w.at <= WANT_MS ? w : null;
    }

    static boolean validKid(String kid) {
        return kid != null && KID.matcher(kid).matches();
    }

    // ---- what this phone can do ----
    /** ok | none (nothing enrolled) | no-hw | no-lock | old (Android 8 or older). */
    static String can(Context c) {
        try {
            return canNow(c);
        } catch (RuntimeException e) {
            // e.g. SecurityException without USE_BIOMETRIC: answer, never
            // leave the page waiting
            return "no-hw";
        }
    }

    private static String canNow(Context c) {
        if (Build.VERSION.SDK_INT < 28) return "old";
        KeyguardManager km = (KeyguardManager) c.getSystemService(Context.KEYGUARD_SERVICE);
        if (km == null || !km.isDeviceSecure()) return "no-lock";
        if (Build.VERSION.SDK_INT >= 29) {
            BiometricManager bm = c.getSystemService(BiometricManager.class);
            if (bm == null) return "no-hw";
            int r = Build.VERSION.SDK_INT >= 30
                    ? bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    : bm.canAuthenticate();
            if (r == BiometricManager.BIOMETRIC_SUCCESS) return "ok";
            if (r == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED) return "none";
            return "no-hw";
        }
        return c.getPackageManager().hasSystemFeature(PackageManager.FEATURE_FINGERPRINT) ? "ok" : "no-hw";
    }

    /** {t:"pw-bio", op:"state", can, kids, pkg} */
    static JSONObject state(Context c) {
        JSONObject o = new JSONObject();
        try {
            o.put("t", "pw-bio");
            o.put("op", "state");
            o.put("can", can(c));
            JSONArray kids = new JSONArray();
            if (hasKey()) {
                Iterator<String> it = prefs(c).getAll().keySet().iterator();
                while (it.hasNext()) {
                    String k = it.next();
                    if (validKid(k)) kids.put(k);
                }
            }
            o.put("kids", kids);
            o.put("pkg", c.getPackageName());
        } catch (JSONException ignored) {
        }
        return o;
    }

    // ---- the Keystore key ----
    private static KeyStore ks() throws Exception {
        KeyStore k = KeyStore.getInstance("AndroidKeyStore");
        k.load(null);
        return k;
    }

    static boolean hasKey() {
        try {
            return ks().containsAlias(ALIAS);
        } catch (Exception e) {
            return false;
        }
    }

    private static SecretKey key(boolean create) throws Exception {
        KeyStore k = ks();
        if (k.containsAlias(ALIAS)) return (SecretKey) k.getKey(ALIAS, null);
        if (!create) return null;
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= 30) {
            // 0 = every use needs its own fingerprint or face (CryptoObject)
            b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        } else {
            b.setUserAuthenticationValidityDurationSeconds(-1);
        }
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(b.build());
        return g.generateKey();
    }

    /** A cipher ready to seal a new secret; the prompt unlocks it.
     *  Throws KeyPermanentlyInvalidatedException after a new fingerprint. */
    static Cipher sealCipher() throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key(true));
        return c;
    }

    /** A cipher ready to open kid's secret, or null when there is none. */
    static Cipher openCipher(Context ctx, String kid) throws Exception {
        JSONObject s = sealed(ctx, kid);
        SecretKey k = key(false);
        if (s == null || k == null) return null;
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, k, new GCMParameterSpec(128, Base64.decode(s.getString("iv"), Base64.NO_WRAP)));
        return c;
    }

    /** After the prompt: a new random secret, sealed and kept for kid.
     *  Returns it base64 for the page. */
    static String seal(Context ctx, Cipher authed, String kid) throws Exception {
        byte[] d = new byte[32];
        new SecureRandom().nextBytes(d);
        try {
            authed.updateAAD(aad(kid));
            byte[] ct = authed.doFinal(d);
            SharedPreferences p = prefs(ctx);
            if (!p.contains(kid) && p.getAll().size() >= MAX_KIDS) throw new IllegalStateException("too many vaults");
            JSONObject s = new JSONObject();
            s.put("iv", Base64.encodeToString(authed.getIV(), Base64.NO_WRAP));
            s.put("ct", Base64.encodeToString(ct, Base64.NO_WRAP));
            s.put("at", System.currentTimeMillis());
            p.edit().putString(kid, s.toString()).commit();
            return Base64.encodeToString(d, Base64.NO_WRAP);
        } finally {
            Arrays.fill(d, (byte) 0);
        }
    }

    /** After the prompt: kid's secret, base64 for the page. */
    static String open(Context ctx, Cipher authed, String kid) throws Exception {
        JSONObject s = sealed(ctx, kid);
        if (s == null) throw new IllegalStateException("none");
        authed.updateAAD(aad(kid));
        byte[] d = authed.doFinal(Base64.decode(s.getString("ct"), Base64.NO_WRAP));
        try {
            if (d.length != 32) throw new IllegalStateException("bad secret");
            return Base64.encodeToString(d, Base64.NO_WRAP);
        } finally {
            Arrays.fill(d, (byte) 0);
        }
    }

    private static byte[] aad(String kid) {
        return ("oros-pw-bio/1/" + kid).getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }

    private static JSONObject sealed(Context ctx, String kid) {
        if (!validKid(kid)) return null;
        String s = prefs(ctx).getString(kid, null);
        if (s == null) return null;
        try {
            return new JSONObject(s);
        } catch (JSONException e) {
            return null;
        }
    }

    // ---- removing ----
    /** Turned off for kid: its secret goes; the key too when none is left. */
    static synchronized void clear(Context ctx, String kid) {
        if (!validKid(kid)) return;
        SharedPreferences p = prefs(ctx);
        p.edit().remove(kid).commit();
        if (p.getAll().isEmpty()) deleteKey();
    }

    /** A new fingerprint or face: the key is gone for good, so is every secret. */
    static synchronized void clearAll(Context ctx) {
        prefs(ctx).edit().clear().commit();
        deleteKey();
    }

    private static void deleteKey() {
        try {
            ks().deleteEntry(ALIAS);
        } catch (Exception ignored) {
        }
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
