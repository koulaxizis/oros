package online.useoros.twa;

import android.app.Activity;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyPermanentlyInvalidatedException;

import org.json.JSONException;
import org.json.JSONObject;

import javax.crypto.Cipher;

/**
 * Passwords: unlock with fingerprint or face (PW-BIO, BR-PHONE v9).
 * Opened by the page from a tap ("intent://open?n=…#Intent;scheme=oros-bio;…",
 * or "seal" to turn it on). Takes the request the page announced over
 * the port with the same one-time n (BioVault.take), shows Android's
 * prompt (fingerprint or face only; "Use master password" cancels),
 * and answers over the bridge with the secret or why not. Shows
 * nothing of its own, keeps nothing, and finishes at once.
 */
public class BioActivity extends Activity {
    private static final int WAIT_TRIES = 20;          // the "want" may come a moment after the link
    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean answered;
    private String n;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Uri data = getIntent().getData();
        String act = data != null ? data.getHost() : null;
        n = data != null ? data.getQueryParameter("n") : null;
        if (Build.VERSION.SDK_INT < 28 || act == null || n == null) { finish(); return; }
        await(act, 0);
    }

    private void await(String act, int tries) {
        BioVault.Want w = BioVault.take(act, n);
        if (w != null) { start(w); return; }
        if (tries >= WAIT_TRIES) { finish(); return; }     // nothing announced: not from orOS
        main.postDelayed(() -> await(act, tries + 1), 100);
    }

    private void start(BioVault.Want w) {
        Cipher c;
        try {
            if ("seal".equals(w.act)) {
                try {
                    c = BioVault.sealCipher();
                } catch (KeyPermanentlyInvalidatedException e) {
                    // an old key from before a new fingerprint: start over
                    BioVault.clearAll(this);
                    c = BioVault.sealCipher();
                }
            } else {
                c = BioVault.openCipher(this, w.kid);
                if (c == null) { fail("none"); return; }
            }
        } catch (KeyPermanentlyInvalidatedException e) {
            BioVault.clearAll(this);
            fail("invalidated");
            return;
        } catch (Exception e) {
            fail("failed");
            return;
        }
        prompt(w, c);
    }

    private void prompt(BioVault.Want w, Cipher c) {
        BiometricPrompt.Builder b = new BiometricPrompt.Builder(this)
                .setTitle(getString("seal".equals(w.act) ? R.string.bio_title_on : R.string.bio_title))
                .setSubtitle(getString(R.string.bio_sub))
                .setNegativeButton(getString(R.string.bio_use_pw), getMainExecutor(), (dlg, which) -> fail("cancel"));
        if (Build.VERSION.SDK_INT >= 29) b.setConfirmationRequired(false);
        if (Build.VERSION.SDK_INT >= 30) b.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        // Leaving for another app cancels the prompt (Android answers
        // BIOMETRIC_ERROR_CANCELED); the page also gives up after 3 minutes.
        b.build().authenticate(new BiometricPrompt.CryptoObject(c), new CancellationSignal(), getMainExecutor(),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        Cipher authed = result.getCryptoObject() != null ? result.getCryptoObject().getCipher() : null;
                        if (authed == null) { fail("failed"); return; }
                        try {
                            String d = "seal".equals(w.act) ? BioVault.seal(BioActivity.this, authed, w.kid)
                                    : BioVault.open(BioActivity.this, authed, w.kid);
                            answer("key", "d", d);
                        } catch (Exception e) {
                            fail("none".equals(e.getMessage()) ? "none" : "failed");
                        }
                    }

                    @Override
                    public void onAuthenticationError(int code, CharSequence msg) {
                        fail(code == BiometricPrompt.BIOMETRIC_ERROR_LOCKOUT
                                || code == BiometricPrompt.BIOMETRIC_ERROR_LOCKOUT_PERMANENT ? "lockout"
                                : code == BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED
                                || code == BiometricPrompt.BIOMETRIC_ERROR_CANCELED ? "cancel" : "failed");
                    }
                    // onAuthenticationFailed: one finger not recognised; the prompt stays
                });
    }

    private void fail(String code) {
        answer("fail", "code", code);
    }

    private void answer(String op, String key, String value) {
        if (answered) return;
        answered = true;
        JSONObject o = new JSONObject();
        try {
            o.put("t", "pw-bio");
            o.put("op", op);
            o.put("n", n);
            o.put(key, value);
        } catch (JSONException ignored) {
        }
        PhoneBridge bridge = OrosApp.bridge(this);
        bridge.sendBio(o);
        bridge.sendBio(BioVault.state(this));
        finish();
    }
}
