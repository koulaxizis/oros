package online.useoros.twa;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.UserNotAuthenticatedException;
import android.service.autofill.Dataset;
import android.util.Base64;
import android.view.autofill.AutofillId;
import android.view.autofill.AutofillManager;
import android.view.autofill.AutofillValue;
import android.widget.RemoteViews;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * A tap on an orOS suggestion (PW-AF2). Asks for the fingerprint,
 * face or screen lock, opens the sealed values (AfVault "index", in
 * memory only), and hands Android exactly one entry's values for the
 * fields of this form. In an app no login names yet, the person first
 * picks a login and confirms that it belongs to this app; the link is
 * kept on this phone. Shows nothing else and keeps nothing.
 */
public class AfAuthActivity extends Activity {
    static final String X_ID = "af-id", X_PICK = "af-pick", X_PKG = "af-pkg", X_BROWSER = "af-browser",
            X_KINDS = "af-kinds", X_IDS = "af-ids";
    private static final int REQ_CREDENTIAL = 1;
    private boolean asked;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        tryOpen();
    }

    private void tryOpen() {
        JSONArray index;
        try {
            index = AfVault.index(this);
        } catch (UserNotAuthenticatedException e) {
            if (asked) { done(null); return; }
            asked = true;
            authenticate();
            return;
        } catch (KeyPermanentlyInvalidatedException e) {
            // a new fingerprint on the phone: the old key is gone for good
            AfVault.deleteKeys();
            AfVault.clear(this);
            Toast.makeText(this, R.string.af_invalidated, Toast.LENGTH_LONG).show();
            done(null);
            return;
        } catch (Exception e) {
            Toast.makeText(this, R.string.af_failed, Toast.LENGTH_LONG).show();
            done(null);
            return;
        }
        if (index == null) { done(null); return; }
        if (getIntent().getBooleanExtra(X_PICK, false)) pick(index);
        else fill(find(index, getIntent().getStringExtra(X_ID)));
    }

    private void authenticate() {
        String title = getString(R.string.af_auth_title);
        if (Build.VERSION.SDK_INT >= 29) {
            BiometricPrompt.Builder b = new BiometricPrompt.Builder(this).setTitle(title)
                    .setSubtitle(getString(R.string.af_auth_sub));
            if (Build.VERSION.SDK_INT >= 30) {
                b.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG
                        | BiometricManager.Authenticators.DEVICE_CREDENTIAL);
            } else {
                b.setDeviceCredentialAllowed(true);
            }
            b.build().authenticate(new CancellationSignal(), getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    tryOpen();
                }

                @Override
                public void onAuthenticationError(int code, CharSequence msg) {
                    done(null);
                }
            });
            return;
        }
        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        Intent i = km != null ? km.createConfirmDeviceCredentialIntent(title, getString(R.string.af_auth_sub)) : null;
        if (i == null) {
            // no screen lock: the key cannot exist without one
            Toast.makeText(this, R.string.af_no_lock, Toast.LENGTH_LONG).show();
            done(null);
            return;
        }
        startActivityForResult(i, REQ_CREDENTIAL);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_CREDENTIAL) return;
        if (resultCode == RESULT_OK) tryOpen();
        else done(null);
    }

    private static JSONObject find(JSONArray index, String id) {
        if (id == null) return null;
        for (int i = 0; i < index.length(); i++) {
            JSONObject e = index.optJSONObject(i);
            if (e != null && id.equals(e.optString("i"))) return e;
        }
        return null;
    }

    /** An app no login names: choose one, then confirm the link. */
    private void pick(JSONArray index) {
        final List<JSONObject> logins = new ArrayList<>();
        for (int i = 0; i < index.length(); i++) {
            JSONObject e = index.optJSONObject(i);
            if (e != null && ("login".equals(e.optString("k")) || "otp".equals(e.optString("k")))) logins.add(e);
        }
        logins.sort((a, b) -> a.optString("t").compareToIgnoreCase(b.optString("t")));
        if (logins.isEmpty()) {
            Toast.makeText(this, R.string.af_none, Toast.LENGTH_LONG).show();
            done(null);
            return;
        }
        String[] labels = new String[logins.size()];
        for (int i = 0; i < labels.length; i++) {
            JSONObject e = logins.get(i);
            String u = e.optString("u");
            labels[i] = e.optString("t") + (u.isEmpty() ? "" : " · " + u);
        }
        final String pkg = getIntent().getStringExtra(X_PKG);
        final String appName = appLabel(pkg);
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(getString(R.string.af_pick_title, appName))
                .setItems(labels, (dlg, which) -> {
                    JSONObject e = logins.get(which);
                    new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                            .setMessage(getString(R.string.af_link_q, e.optString("t"), appName, pkg))
                            .setPositiveButton(R.string.af_yes, (d2, w2) -> {
                                if (pkg != null && !pkg.isEmpty()) AfVault.link(this, pkg, e.optString("i"));
                                fill(e);
                            })
                            .setNegativeButton(R.string.af_no, (d2, w2) -> done(null))
                            .setOnCancelListener(d2 -> done(null))
                            .show();
                })
                .setOnCancelListener(dlg -> done(null))
                .show();
    }

    private String appLabel(String pkg) {
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            return String.valueOf(pm.getApplicationLabel(ai));
        } catch (Exception e) {
            return pkg;
        }
    }

    private void fill(JSONObject e) {
        if (e == null) { done(null); return; }
        ArrayList<AutofillId> ids = getIntent().getParcelableArrayListExtra(X_IDS);
        int[] kinds = getIntent().getIntArrayExtra(X_KINDS);
        if (ids == null || kinds == null || ids.size() != kinds.length) { done(null); return; }
        RemoteViews p = new RemoteViews(getPackageName(), R.layout.af_item);
        p.setTextViewText(R.id.af_title, e.optString("t"));
        Dataset.Builder b = new Dataset.Builder(p);
        int set = 0;
        String code = null;
        for (int i = 0; i < ids.size(); i++) {
            String v;
            if (kinds[i] == AfMatch.OTP) {
                if (code == null) code = code(e.optJSONObject("o"));
                v = code;
            } else v = value(e, kinds[i]);
            if (v == null || v.isEmpty()) continue;
            b.setValue(ids.get(i), AutofillValue.forText(v));
            set++;
        }
        if (set == 0) {
            Toast.makeText(this, R.string.af_none, Toast.LENGTH_SHORT).show();
            done(null);
            return;
        }
        done(b.build());
    }

    /** One value of the entry for a field kind; never a card PIN,
     *  document numbers or notes (the page does not even send them). */
    static String value(JSONObject e, int kind) {
        JSONObject c = e.optJSONObject("c"), h = e.optJSONObject("h");
        switch (kind) {
            case AfMatch.USER: return e.optString("u");
            case AfMatch.PASS: return e.optString("p");
            case AfMatch.CC_NAME: return c != null ? c.optString("name") : null;
            case AfMatch.CC_NUM: return c != null ? c.optString("num") : null;
            case AfMatch.CC_EXP: return c != null && !c.optString("mm").isEmpty() ? c.optString("mm") + "/" + tail(c.optString("yyyy")) : null;
            case AfMatch.CC_MM: return c != null ? c.optString("mm") : null;
            case AfMatch.CC_YY: return c != null ? c.optString("yyyy") : null;
            case AfMatch.CVV: return c != null ? c.optString("cvv") : null;
            case AfMatch.FIRST: return h != null ? h.optString("first") : null;
            case AfMatch.LAST: return h != null ? h.optString("last") : null;
            case AfMatch.FULL: return h != null ? h.optString("full") : null;
            case AfMatch.EMAIL: return h != null ? h.optString("email") : e.optString("u");
            case AfMatch.PHONE: return h != null ? h.optString("phone") : null;
            case AfMatch.COMPANY: return h != null ? h.optString("company") : null;
            case AfMatch.STREET: return h != null ? h.optString("street") : null;
            case AfMatch.LINE2: return h != null ? h.optString("line2") : null;
            case AfMatch.CITY: return h != null ? h.optString("city") : null;
            case AfMatch.ZIP: return h != null ? h.optString("zip") : null;
            case AfMatch.REGION: return h != null ? h.optString("region") : null;
            case AfMatch.COUNTRY: return h != null ? h.optString("country") : null;
            default: return null;
        }
    }

    private static String tail(String yyyy) {
        return yyyy != null && yyyy.length() == 4 ? yyyy.substring(2) : yyyy;
    }

    private static String code(JSONObject o) {
        if (o == null) return null;
        byte[] key = null;
        try {
            key = Base64.decode(o.optString("k"), Base64.NO_WRAP);
            if (key.length < 10) return null;
            return AfMatch.totp(key, o.optString("a"), o.optInt("d", 6), o.optInt("n", 30), System.currentTimeMillis());
        } catch (Exception ex) {
            return null;
        } finally {
            if (key != null) Arrays.fill(key, (byte) 0);
        }
    }

    private void done(Dataset d) {
        if (d != null) {
            setResult(RESULT_OK, new Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, d));
        } else {
            setResult(RESULT_CANCELED);
        }
        finish();
    }
}
