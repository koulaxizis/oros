package online.useoros.twa;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.CalendarContract;
import android.provider.ContactsContract;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.browser.customtabs.CustomTabsCallback;
import androidx.browser.customtabs.CustomTabsService;
import androidx.browser.customtabs.CustomTabsSession;

import com.google.androidbrowserhelper.trusted.QualityEnforcer;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * BR-PHONE v1: the native end of the orOS phone bridge (web end:
 * phone.js in the shell).
 *
 * After the page finishes loading, the app asks Chrome to validate
 * the "use_as_origin" relation (assetlinks.json) and opens a
 * postMessage channel to https://useoros.online. The page then sends
 * full snapshots of its Contacts and Calendar rows (already decrypted
 * by the page; no key ever reaches this side), and the writers mirror
 * them into the "orOS" account. v2: edits made on the phone in that
 * account go back to the page as {t:"changes"}. v3: reminders
 * (Reminders). v4: the Today summary for the home-screen widget
 * (Widgets). v5: Health Connect (HealthBridge). v7: the Calendar and
 * To-Do widgets, and tasks ticked on the To-Do widget back to the
 * page as {t:"ticks"} (AgendaWidgets). v8: Passwords autofill (PW-AF2,
 * AfVault): the page asks for two Keystore public keys and hands over
 * its sealed fill lists; this side never sees the vault or its key.
 */
public class PhoneBridge {
    private static final String TAG = "orOS/PhoneBridge";
    static final Uri ORIGIN = Uri.parse("https://useoros.online");
    static final String PREFS = "oros-phone";
    private static final int MAX_MESSAGE = 32 * 1024 * 1024;
    private static final int MAX_ITEMS = 20000;
    /** The page shows this when the person turned a kind off in Settings › Accounts › orOS. */
    static final String SYNC_OFF = "sync is off in Android Settings › Accounts › orOS";

    static final String[] CONTACTS_PERMS = {Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS};
    static final String[] CALENDAR_PERMS = {Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR};

    private final Context app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Callback callback = new Callback();

    @Nullable private KeptTwaLauncher launcher;
    @Nullable private CustomTabsSession session;
    private boolean validated;
    private int retries;
    private boolean channelReady;
    private boolean channelAsked;   // a channel was requested for the current page
    // Phone changes sent and not yet answered ("what:ref" → row text).
    // The page applies each change once, so a row is sent again only
    // when it changed since, or on a new channel. io thread only.
    private final java.util.Map<String, String> inFlight = new java.util.HashMap<>();
    // Whether orOS is on screen, from the page's {t:"seen"} (sent on
    // every visibility change and every 15 s while visible).
    private static volatile boolean seenVisible;
    private static volatile long seenAt;

    /** orOS is on screen now: reminders are left to the page. */
    static boolean pageOnScreen() {
        return seenVisible && System.currentTimeMillis() - seenAt < 45000;
    }

    PhoneBridge(Context context) {
        app = context.getApplicationContext();
    }

    static final String DIAG_KEY = "diag-trail";

    /** orOS Drive for Android (DRIVE-APP, online.useoros.drive): its own
     *  app since wave 5; this app only opens it (or its download). */
    static final String DRIVE_APP = "online.useoros.drive";

    /** Whether the orOS Drive app is installed (named in <queries>). */
    static boolean hasDrive(Context c) {
        try {
            c.getPackageManager().getPackageInfo(DRIVE_APP, 0);
            return true;
        } catch (android.content.pm.PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    /** Diagnostic builds (workflow input "diag") save each bridge step
     *  with its clock time; DiagActivity shows them. Toasts
     *  and notifications proved unreliable for this (Android drops
     *  queued toasts and cuts them to two lines). */
    synchronized void diag(String step) {
        Log.d(TAG, step);
        if (!BuildConfig.DIAG) return;
        String line = new java.text.SimpleDateFormat("HH:mm:ss.S", java.util.Locale.ROOT)
                .format(new java.util.Date()) + " " + step;
        SharedPreferences sp = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String old = sp.getString(DIAG_KEY, "");
        if (old.length() > 6000) old = old.substring(old.length() - 6000);
        sp.edit().putString(DIAG_KEY, old + line + "\n").commit();
    }

    CustomTabsCallback callback() {
        return callback;
    }

    /** A new launch: the newest launcher owns the session from now on. */
    void attach(KeptTwaLauncher l) {
        diag("--- launch ---");
        main.post(() -> {
            if (launcher != null && launcher != l) launcher.reallyDestroy();
            launcher = l;
            session = null;
            validated = false;
            channelReady = false;
            retries = 0;
            warmUp();
        });
    }

    private void onPageLoaded() {
        CustomTabsSession s = launcher != null ? launcher.session() : null;
        diag("page loaded, browser " + browser() + ", session " + (s != null));
        if (s == null) return;
        channelAsked = false;              // a new page needs its own port
        if (s != session) {
            session = s;
            validated = false;
            channelReady = false;
            boolean asked = s.validateRelationship(CustomTabsService.RELATION_USE_AS_ORIGIN, ORIGIN, null);
            diag("validate requested: " + asked);
            if (!asked && retries++ < 2) {
                warmUp();
                main.postDelayed(this::validate, 2000);
            }
            return;
        }
        if (validated) requestChannel();   // reload: the page needs a new port
        else validate();                   // an earlier check failed: ask again
    }

    /** Chrome answers validateRelationship() with false until the app
     *  has called warmup() on it (TwaLauncher never does), so warm the
     *  serving browser up as soon as a launch starts. */
    private void warmUp() {
        String p = launcher != null ? launcher.provider() : null;
        if (p == null) p = androidx.browser.customtabs.CustomTabsClient.getPackageName(app, null);
        boolean ok = p != null && androidx.browser.customtabs.CustomTabsClient.connectAndInitialize(app, p);
        diag("warmup " + p + ": " + ok);
    }

    private void validate() {
        if (session == null) return;
        boolean asked = session.validateRelationship(CustomTabsService.RELATION_USE_AS_ORIGIN, ORIGIN, null);
        diag("validate requested again: " + asked);
        if (!asked && retries++ < 2) {
            warmUp();
            main.postDelayed(this::validate, 2000);
        }
    }

    private String browser() {
        String p = launcher != null ? launcher.provider() : null;
        if (p == null) p = androidx.browser.customtabs.CustomTabsClient.getPackageName(app, null);
        if (p == null) return "?";
        try {
            return p + " " + app.getPackageManager().getPackageInfo(p, 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return p;
        }
    }

    private void requestChannel() {
        if (session == null) return;
        channelReady = false;
        channelAsked = true;
        boolean ok = session.requestPostMessageChannel(ORIGIN, ORIGIN, new Bundle());

        diag("channel requested: " + ok);
    }

    private class Callback extends QualityEnforcer {
        @Override
        public void onNavigationEvent(int navigationEvent, @Nullable Bundle extras) {
            super.onNavigationEvent(navigationEvent, extras);
            if (navigationEvent == NAVIGATION_FINISHED) main.post(PhoneBridge.this::onPageLoaded);
            else if (navigationEvent == NAVIGATION_FAILED) diag("navigation failed");
        }

        @Override
        public void onRelationshipValidationResult(int relation, @NonNull Uri requestedOrigin,
                boolean result, @Nullable Bundle extras) {
            super.onRelationshipValidationResult(relation, requestedOrigin, result, extras);
            diag("relationship " + requestedOrigin + ": " + result);
            main.post(() -> {
                // Chromium checks the origin again for every channel request
                // and reports it here; answering that with another request
                // loops (seen on a phone: a new channel every few ms, so the
                // page's port was always already replaced). One request per
                // page load.
                if (channelAsked) return;
                validated = result;
                if (result) {
                    requestChannel();
                } else if (retries++ < 2) {
                    // The browser may still be fetching assetlinks.json.
                    main.postDelayed(PhoneBridge.this::validate, 4000);
                } else {
                    // Some browsers open the channel anyway; harmless if not.
                    requestChannel();
                }
            });
        }

        @Override
        public void onMessageChannelReady(@Nullable Bundle extras) {
            super.onMessageChannelReady(extras);
            diag("channel ready");
            io.execute(inFlight::clear);
            main.post(() -> {
                channelReady = true;
                // The first message hands the page its port (phone.js).
                // state() asks Health Connect: off the main thread.
                io.execute(() -> {
                    send(state());
                    sendTicksNow();
                    sendSavesNow();
                });
            });
        }

        @Override
        public void onPostMessage(@NonNull String message, @Nullable Bundle extras) {
            super.onPostMessage(message, extras);
            diag("message from page, " + message.length() + " chars: "
                    + message.substring(0, Math.min(120, message.length())));
            if (message.length() > MAX_MESSAGE) return;
            io.execute(() -> handle(message));
        }
    }

    /** Tasks ticked on the To-Do widget (v7): sent on every channel
     *  until the page answers {t:"applied", what:"ticks"}. */
    void sendTicks() {
        io.execute(this::sendTicksNow);
    }

    private void sendTicksNow() {
        JSONArray items = AgendaWidgets.pending(app);
        if (items.length() == 0) return;
        try {
            JSONObject o = new JSONObject();
            o.put("t", "ticks");
            o.put("items", items);
            diag("widget ticks sent: " + items.length());
            send(o);
        } catch (JSONException ignored) {
        }
    }

    /** PW-AF3: logins the person chose to save in another app, sent on
     *  every channel until the page answers {t:"applied", what:"af-save"}. */
    void sendSaves() {
        io.execute(this::sendSavesNow);
    }

    private void sendSavesNow() {
        JSONArray items = AfVault.pendingSaves(app);
        if (items.length() == 0) return;
        try {
            JSONObject o = new JSONObject();
            o.put("t", "af-save");
            o.put("items", items);
            diag("logins to save sent: " + items.length());
            send(o);
        } catch (JSONException ignored) {
        }
    }

    /** Called by PermissionActivity after Android answered. */
    void permissionsChanged() {
        io.execute(() -> send(state()));
    }

    private void send(JSONObject msg) {
        main.post(() -> {
            if (session == null || !channelReady) return;
            int r = session.postMessage(msg.toString(), null);
            diag("postMessage " + msg.optString("t") + ": " + r);
        });
    }

    boolean granted(String[] perms) {
        for (String p : perms) {
            if (app.checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false;
        }
        return true;
    }

    private String permState(String kind, String[] perms) {
        if (granted(perms)) return "granted";
        SharedPreferences sp = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return sp.getBoolean("asked-" + kind, false) ? "denied" : "ask";
    }

    private JSONObject state() {
        JSONObject o = new JSONObject();
        try {
            o.put("t", "state");
            o.put("v", 1);
            o.put("contacts", permState("contacts", CONTACTS_PERMS));
            o.put("calendar", permState("calendar", CALENDAR_PERMS));
            o.put("reminders", Reminders.permission(app));
            o.put("exact", Reminders.exact(app));
            o.put("widgets", Widgets.count(app));
            o.put("wcal", AgendaWidgets.count(app, CalendarWidget.class));
            o.put("wtodo", AgendaWidgets.count(app, TodoWidget.class));
            o.put("health", HealthBridge.status(app));
            o.put("drive", hasDrive(app));
            o.put("app", BuildConfig.VERSION_NAME);
            o.put("af", afState());
        } catch (JSONException ignored) {
        }
        return o;
    }

    /** Passwords autofill (v8): whether orOS is the phone's autofill
     *  service, whether keys and a sealed copy are here, and when the
     *  copy was made. Public keys only after {t:"af-keys"}. */
    private JSONObject afState() throws JSONException {
        JSONObject a = new JSONObject();
        a.put("svc", afService());
        a.put("keys", AfVault.hasKeys());
        a.put("stored", AfVault.stored(app));
        a.put("at", AfVault.storedAt(app));
        return a;
    }

    private boolean afService() {
        if (android.os.Build.VERSION.SDK_INT < 26) return false;
        try {
            android.view.autofill.AutofillManager am = app.getSystemService(android.view.autofill.AutofillManager.class);
            return am != null && am.hasEnabledAutofillServices();
        } catch (Exception e) {
            return false;
        }
    }

    /** Edits made on the phone in the orOS account go to the page (v2). */
    private void sendChanges() {
        sendChanges("contacts");
        sendChanges("calendar");
    }

    private void sendChanges(String what) {
        boolean contacts = "contacts".equals(what);
        if (!granted(contacts ? CONTACTS_PERMS : CALENDAR_PERMS)) return;
        if (!OrosAccount.syncOn(app, contacts ? ContactsContract.AUTHORITY : CalendarContract.AUTHORITY)) return;
        try {
            JSONArray all = contacts ? new ContactsWriter(app).changes() : new CalendarWriter(app).changes();
            JSONArray ch = new JSONArray();
            for (int i = 0; i < all.length(); i++) {
                JSONObject it = all.optJSONObject(i);
                if (it == null) continue;
                String key = what + ":" + it.optString("ref"), text = it.toString();
                if (text.equals(inFlight.get(key))) continue;
                inFlight.put(key, text);
                ch.put(it);
            }
            if (ch.length() == 0) return;
            JSONObject o = new JSONObject();
            o.put("t", "changes");
            o.put("what", what);
            o.put("items", ch);
            diag(what + " changes sent: " + ch.length());
            send(o);
        } catch (Exception e) {
            diag(what + " changes failed: " + e);
        }
    }

    private void handle(String message) {
        JSONObject m;
        try {
            m = new JSONObject(message);
        } catch (JSONException e) {
            return;
        }
        String t = m.optString("t");
        String what = "clear".equals(t) ? m.optString("what") : t;
        long seq = m.optLong("seq", 0);
        try {
            switch (t) {
                case "state":
                    send(state());
                    sendChanges();
                    sendTicksNow();
                    sendSavesNow();
                    return;
                case "seen":
                    seenVisible = m.optBoolean("v");
                    seenAt = System.currentTimeMillis();
                    return;
                case "reminders": {
                    int n = Reminders.apply(app, m.optJSONArray("items"));
                    JSONObject done = new JSONObject();
                    done.put("t", "done");
                    done.put("what", "reminders");
                    done.put("seq", seq);
                    done.put("added", n);
                    diag("reminders armed: " + n + (Reminders.exact(app) ? "" : " (inexact)"));
                    send(done);
                    return;
                }
                case "today": {
                    JSONObject data = m.optJSONObject("data");
                    if (data == null) throw new IllegalArgumentException("bad data");
                    Widgets.save(app, data);
                    diag("widget rows: " + (data.optJSONArray("rows") == null ? 0 : data.optJSONArray("rows").length()));
                    return;
                }
                case "agenda": {
                    AgendaWidgets.save(app, m);
                    diag("widget agenda: " + (m.optJSONArray("cal") == null ? "-" : m.optJSONArray("cal").length())
                            + " events, " + (m.optJSONArray("todo") == null ? "-" : m.optJSONArray("todo").length()) + " tasks");
                    return;
                }
                case "health": {
                    if (!HealthBridge.available(app)) throw new IllegalStateException("no Health Connect");
                    JSONObject in = HealthBridge.sync(app, m);
                    diag("health: wrote " + in.optInt("wrote") + ", removed " + in.optInt("removed")
                            + ", in " + (in.optJSONArray("steps") == null ? 0 : in.optJSONArray("steps").length()) + " days of steps");
                    send(in);
                    JSONObject done = new JSONObject();
                    done.put("t", "done");
                    done.put("what", "health");
                    done.put("seq", seq);
                    done.put("added", in.optInt("wrote"));
                    done.put("removed", in.optInt("removed"));
                    send(done);
                    return;
                }
                case "applied": {
                    String w = m.optString("what");
                    JSONArray refs = m.optJSONArray("refs");
                    if ("af-save".equals(w)) {
                        AfVault.takenSaves(app, refs);
                        diag("logins to save taken: " + (refs == null ? 0 : refs.length()));
                        return;
                    }
                    if ("ticks".equals(w)) {
                        AgendaWidgets.taken(app, refs);
                        Widgets.update(app);
                        diag("widget ticks taken: " + (refs == null ? 0 : refs.length()));
                        return;
                    }
                    for (int i = 0; refs != null && i < refs.length(); i++) inFlight.remove(w + ":" + refs.optString(i));
                    if ("calendar".equals(w) && granted(CALENDAR_PERMS)) {
                        new CalendarWriter(app).ack(refs);
                    } else if ("contacts".equals(w) && granted(CONTACTS_PERMS)) {
                        new ContactsWriter(app).ack(refs, m.optJSONObject("ids"));
                    } else {
                        return;
                    }
                    diag(w + " changes taken: " + (refs == null ? 0 : refs.length()));
                    return;
                }
                case "contacts":
                case "calendar": {
                    JSONArray items = m.optJSONArray("items");
                    if (items == null || items.length() > MAX_ITEMS) throw new IllegalArgumentException("bad items");
                    String authority = "contacts".equals(t) ? ContactsContract.AUTHORITY : CalendarContract.AUTHORITY;
                    if (!OrosAccount.syncOn(app, authority)) throw new IllegalStateException(SYNC_OFF);
                    int[] n;
                    if ("contacts".equals(t)) {
                        if (!granted(CONTACTS_PERMS)) throw new SecurityException("no permission");
                        n = new ContactsWriter(app).apply(items);
                    } else {
                        if (!granted(CALENDAR_PERMS)) throw new SecurityException("no permission");
                        CalendarWriter w = new CalendarWriter(app);
                        n = w.apply(items);
                        if (BuildConfig.DIAG) diag("calendar colours: " + w.colorCheck(items));
                    }
                    JSONObject done = new JSONObject();
                    done.put("t", "done");
                    done.put("what", t);
                    done.put("seq", seq);
                    done.put("added", n[0]);
                    done.put("updated", n[1]);
                    done.put("removed", n[2]);
                    done.put("kept", n[3]);
                    diag(t + " written: +" + n[0] + " ~" + n[1] + " -" + n[2] + " =" + n[3]);
                    OrosAccount.synced(app, authority);
                    send(done);
                    sendChanges(t);
                    return;
                }
                case "af-keys": {
                    AfVault.ensureKeys();
                    JSONObject o = new JSONObject();
                    o.put("t", "af-keys");
                    o.put("idx", AfVault.publicKey(AfVault.ALIAS_INDEX));
                    o.put("names", AfVault.publicKey(AfVault.ALIAS_NAMES));
                    o.put("af", afState());
                    diag("autofill keys sent");
                    send(o);
                    return;
                }
                case "af-index": {
                    JSONObject idx = m.optJSONObject("idx"), names = m.optJSONObject("names");
                    if (!AfVault.validBlob(idx) || !AfVault.validBlob(names)) throw new IllegalArgumentException("bad blob");
                    if (!AfVault.hasKeys()) throw new IllegalStateException("no keys");
                    AfVault.save(app, idx, names, m.optLong("at", System.currentTimeMillis()));
                    JSONObject done = new JSONObject();
                    done.put("t", "done");
                    done.put("what", "af-index");
                    done.put("seq", seq);
                    done.put("af", afState());
                    diag("autofill copy stored");
                    send(done);
                    return;
                }
                case "clear":
                    if ("af".equals(what)) {
                        AfVault.clear(app);
                        AfVault.deleteKeys();
                        send(state());
                        return;
                    }
                    if ("contacts".equals(what) && granted(CONTACTS_PERMS)) new ContactsWriter(app).clear();
                    else if ("calendar".equals(what) && granted(CALENDAR_PERMS)) new CalendarWriter(app).clear();
                    else if ("reminders".equals(what)) Reminders.clear(app);
                    else if ("health".equals(what)) HealthBridge.clear(app);
                    return;
                default:
            }
        } catch (Exception e) {
            Log.w(TAG, "message " + t + " failed", e);
            diag(t + " failed: " + e);
            JSONObject err = new JSONObject();
            try {
                err.put("t", "error");
                err.put("what", what);
                err.put("seq", seq);
                err.put("msg", String.valueOf(e.getMessage()));
            } catch (JSONException ignored) {
            }
            send(err);
        }
    }
}
