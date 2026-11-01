package online.useoros.twa;

import android.app.PendingIntent;
import android.app.assist.AssistStructure;
import android.content.Intent;
import android.content.IntentSender;
import android.os.Build;
import android.os.CancellationSignal;
import android.service.autofill.AutofillService;
import android.service.autofill.Dataset;
import android.service.autofill.FillCallback;
import android.service.autofill.FillContext;
import android.service.autofill.FillRequest;
import android.service.autofill.FillResponse;
import android.service.autofill.SaveCallback;
import android.service.autofill.SaveRequest;
import android.text.InputType;
import android.util.Log;
import android.util.Pair;
import android.view.View;
import android.view.ViewStructure;
import android.view.autofill.AutofillId;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Passwords autofill on the phone (PW-AF2, Bible "Phone autofill").
 * Chosen by the person in Android Settings › Passwords › Autofill
 * service. On a form it reads only the "names" list (AfVault: titles,
 * user names, sites, apps; no secrets) to decide what to suggest; every
 * suggestion is locked: a tap opens AfAuthActivity (fingerprint, face
 * or screen lock), which opens the values and fills just that entry.
 * Suggests nothing when autofill is off in orOS, nothing in orOS
 * itself, and never saves anything (PW-AF3).
 */
public class OrosAutofillService extends AutofillService {
    private static final String TAG = "orOS/Autofill";
    static final int MAX_SUGGEST = 6;

    /** One field of the form. */
    static final class Field {
        final AutofillId id;
        int kind;
        Field(AutofillId id, int kind) {
            this.id = id;
            this.kind = kind;
        }
    }

    /** What the form is: its fields, the app, and (in a known browser) the page. */
    static final class Form {
        final List<Field> fields = new ArrayList<>();
        String pkg = "", scheme, host, port = "";
        boolean browser;

        boolean has(int kind) {
            for (Field f : fields) if (f.kind == kind) return true;
            return false;
        }
        boolean any(int what) {   // 1 login, 2 card, 3 person
            for (Field f : fields) {
                if (what == 1 && AfMatch.isLogin(f.kind)) return true;
                if (what == 2 && AfMatch.isCard(f.kind)) return true;
                if (what == 3 && AfMatch.isPerson(f.kind)) return true;
            }
            return false;
        }
    }

    @Override
    public void onFillRequest(FillRequest request, CancellationSignal cancel, FillCallback callback) {
        try {
            List<FillContext> ctx = request.getFillContexts();
            AssistStructure st = ctx.get(ctx.size() - 1).getStructure();
            Form form = parse(st);
            callback.onSuccess(respond(form));
        } catch (Exception e) {
            Log.w(TAG, "fill request: " + e);
            callback.onSuccess(null);
        }
    }

    @Override
    public void onSaveRequest(SaveRequest request, SaveCallback callback) {
        callback.onSuccess();   // nothing is saved from the phone yet (PW-AF3)
    }

    // ---- the form ----
    static Form parse(AssistStructure st) {
        Form f = new Form();
        f.pkg = st.getActivityComponent() != null ? st.getActivityComponent().getPackageName() : "";
        f.browser = AfMatch.BROWSERS.contains(f.pkg);
        List<Field> plain = new ArrayList<>();   // text fields with no kind yet, in order
        for (int i = 0; i < st.getWindowNodeCount(); i++) walk(st.getWindowNodeAt(i).getRootViewNode(), f, plain);
        // a login form without a user-name field: the text field just
        // before the first password field; an e-mail field counts too
        if (f.has(AfMatch.PASS) && !f.has(AfMatch.USER)) {
            Field email = null;
            for (Field x : f.fields) if (x.kind == AfMatch.EMAIL) { email = x; break; }
            if (email != null) email.kind = AfMatch.USER;
            else {
                Field before = null;
                for (Field x : f.fields) {
                    if (x.kind == AfMatch.PASS) break;
                    if (plain.contains(x)) before = x;
                }
                if (before != null) before.kind = AfMatch.USER;
            }
        }
        List<Field> keep = new ArrayList<>();
        for (Field x : f.fields) if (x.kind != AfMatch.NONE && x.kind != AfMatch.NEW_PASS) keep.add(x);
        f.fields.clear();
        f.fields.addAll(keep);
        return f;
    }

    private static void walk(AssistStructure.ViewNode n, Form f, List<Field> plain) {
        if (n == null) return;
        if (n.getVisibility() != View.VISIBLE) return;
        if (f.host == null && n.getWebDomain() != null && !n.getWebDomain().isEmpty()) {
            f.host = AfMatch.host(n.getWebDomain());
            if (Build.VERSION.SDK_INT >= 28) f.scheme = n.getWebScheme();
        }
        AutofillId id = n.getAutofillId();
        if (id != null && n.getAutofillType() == View.AUTOFILL_TYPE_TEXT && n.isEnabled()) {
            int kind = kindOf(n);
            if (kind != -1) {
                Field fl = new Field(id, kind);
                f.fields.add(fl);
                if (kind == AfMatch.NONE) plain.add(fl);
            }
        }
        for (int i = 0; i < n.getChildCount(); i++) walk(n.getChildAt(i), f, plain);
    }

    /** -1: not a fillable field (hidden, a search box…). */
    static int kindOf(AssistStructure.ViewNode n) {
        String type = null, ac = null, words = "";
        ViewStructure.HtmlInfo html = n.getHtmlInfo();
        if (html != null) {
            if (!"input".equalsIgnoreCase(html.getTag()) && !"textarea".equalsIgnoreCase(html.getTag())) return -1;
            List<Pair<String, String>> attrs = html.getAttributes();
            if (attrs != null) for (Pair<String, String> a : attrs) {
                if (a == null || a.first == null) continue;
                String k = a.first.toLowerCase(java.util.Locale.ROOT);
                if (k.equals("type")) type = a.second;
                else if (k.equals("autocomplete")) ac = a.second;
                else if (k.equals("name") || k.equals("id") || k.equals("placeholder") || k.equals("label") || k.equals("aria-label")) words += " " + a.second;
            }
            if (type != null && type.toLowerCase(java.util.Locale.ROOT).matches("hidden|search|submit|button|checkbox|radio|file|image|reset|range|color")) return -1;
        }
        String[] hints = n.getAutofillHints();
        if (hints != null) for (String h : hints) {
            int k = AfMatch.fromHint(h);
            if (k != AfMatch.NONE) return k;
        }
        int k = AfMatch.fromAutocomplete(ac);
        if (k != AfMatch.NONE) return k;
        if ("off".equalsIgnoreCase(ac) && type == null) { /* still guessed below */ }
        int it = n.getInputType();
        int cls = it & InputType.TYPE_MASK_CLASS, var = it & InputType.TYPE_MASK_VARIATION;
        boolean pw = (type != null && type.equalsIgnoreCase("password"))
                || (cls == InputType.TYPE_CLASS_TEXT && (var == InputType.TYPE_TEXT_VARIATION_PASSWORD
                    || var == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD || var == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD))
                || (cls == InputType.TYPE_CLASS_NUMBER && var == InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        if (n.getIdEntry() != null) words += " " + n.getIdEntry();
        if (n.getHint() != null) words += " " + n.getHint();
        if (n.getContentDescription() != null) words += " " + n.getContentDescription();
        int byText = AfMatch.fromText(words);
        if (pw) return byText == AfMatch.CVV || byText == AfMatch.OTP ? byText : AfMatch.PASS;
        if (byText == AfMatch.NONE && cls == InputType.TYPE_CLASS_TEXT
                && (var == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS || var == InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS)) return AfMatch.EMAIL;
        return byText;
    }

    // ---- suggestions ----
    private FillResponse respond(Form form) {
        if (form.fields.isEmpty()) return null;
        if (form.pkg.equals(getPackageName())) return null;          // never inside orOS itself
        if (form.browser && form.host != null && form.host.equals("useoros.online")) return null;
        if (!AfVault.stored(this)) return null;
        JSONArray names;
        try {
            names = AfVault.names(this);
        } catch (Exception e) {
            Log.w(TAG, "names: " + e);
            return null;
        }
        if (names == null) return null;
        String webPort = form.port;
        boolean wantLogin = form.any(1), wantCard = form.any(2), wantPerson = form.any(3);
        boolean otpOnly = wantLogin && form.has(AfMatch.OTP) && !form.has(AfMatch.USER) && !form.has(AfMatch.PASS);
        JSONArray links = form.browser ? new JSONArray() : AfVault.links(this, form.pkg);
        List<JSONObject> exact = new ArrayList<>(), sub = new ArrayList<>(), cards = new ArrayList<>(), people = new ArrayList<>();
        for (int i = 0; i < names.length(); i++) {
            JSONObject e = names.optJSONObject(i);
            if (e == null) continue;
            String k = e.optString("k");
            if (k.equals("login") || k.equals("otp")) {
                if (!wantLogin || (otpOnly && e.optInt("o") != 1)) continue;
                int score = score(e, form, webPort, links);
                if (score == 2) exact.add(e);
                else if (score == 1) sub.add(e);
            } else if (k.equals("card") && wantCard) cards.add(e);
            else if ((k.equals("identity") || k.equals("address")) && wantPerson) people.add(e);
        }
        List<JSONObject> pick = new ArrayList<>(exact);
        pick.addAll(sub);
        pick.addAll(cards);
        pick.addAll(people);
        FillResponse.Builder r = new FillResponse.Builder();
        int n = 0;
        for (JSONObject e : pick) {
            if (n >= MAX_SUGGEST) break;
            Dataset d = dataset(form, e.optString("i"), e.optString("t"), e.optString("s"), e.optString("k"), false, n);
            if (d != null) { r.addDataset(d); n++; }
        }
        // An app no login names yet: one locked "choose a login" entry
        // (the person confirms the link, AfAuthActivity).
        if (wantLogin && !form.browser && exact.isEmpty() && sub.isEmpty() && n < MAX_SUGGEST) {
            Dataset d = dataset(form, "", getString(R.string.af_pick), "", "login", true, n);
            if (d != null) { r.addDataset(d); n++; }
        }
        return n > 0 ? r.build() : null;
    }

    /** 2: the exact host or a linked app, 1: a sub-domain, 0: no. */
    private static int score(JSONObject e, Form form, String port, JSONArray links) {
        if (form.browser) {
            if (form.host == null) return 0;
            JSONArray w = e.optJSONArray("w");
            int best = 0;
            if (w != null) for (int i = 0; i < w.length(); i++) {
                String s = w.optString(i);
                if (!AfMatch.fits(s, form.scheme, form.host, port)) continue;
                String[] a = AfMatch.site(s);
                best = Math.max(best, a != null && a[1].equals(form.host) ? 2 : 1);
            }
            return best;
        }
        JSONArray a = e.optJSONArray("a");
        if (a != null) for (int i = 0; i < a.length(); i++) if (form.pkg.equals(a.optString(i))) return 2;
        for (int i = 0; i < links.length(); i++) if (e.optString("i").equals(links.optString(i))) return 2;
        return 0;
    }

    private Dataset dataset(Form form, String id, String title, String sub, String kind, boolean pick, int n) {
        ArrayList<AutofillId> ids = new ArrayList<>();
        int[] kinds = new int[form.fields.size()];
        int c = 0;
        for (Field f : form.fields) {
            boolean ok = kind.equals("card") ? AfMatch.isCard(f.kind)
                    : (kind.equals("identity") || kind.equals("address")) ? AfMatch.isPerson(f.kind)
                    : AfMatch.isLogin(f.kind);
            if (!ok) continue;
            ids.add(f.id);
            kinds[c++] = f.kind;
        }
        if (ids.isEmpty()) return null;
        RemoteViews p = new RemoteViews(getPackageName(), R.layout.af_item);
        p.setTextViewText(R.id.af_title, title.isEmpty() ? "orOS" : title);
        p.setTextViewText(R.id.af_sub, sub);
        p.setViewVisibility(R.id.af_sub, sub.isEmpty() ? View.GONE : View.VISIBLE);
        Intent i = new Intent(this, AfAuthActivity.class)
                .putExtra(AfAuthActivity.X_ID, id)
                .putExtra(AfAuthActivity.X_PICK, pick)
                .putExtra(AfAuthActivity.X_PKG, form.pkg)
                .putExtra(AfAuthActivity.X_BROWSER, form.browser)
                .putExtra(AfAuthActivity.X_KINDS, java.util.Arrays.copyOf(kinds, c))
                .putParcelableArrayListExtra(AfAuthActivity.X_IDS, ids);
        int flags = PendingIntent.FLAG_CANCEL_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        IntentSender auth = PendingIntent.getActivity(this, 7100 + n, i, flags).getIntentSender();
        Dataset.Builder b = new Dataset.Builder(p);
        for (AutofillId a : ids) b.setValue(a, null, p);
        b.setAuthentication(auth);
        return b.build();
    }
}
