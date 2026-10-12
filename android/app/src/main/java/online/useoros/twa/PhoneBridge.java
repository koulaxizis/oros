package online.useoros.twa;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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
 * them into the "orOS" account. Everything here is one-way and
 * read-only on the phone.
 */
public class PhoneBridge {
    private static final String TAG = "orOS/PhoneBridge";
    static final Uri ORIGIN = Uri.parse("https://useoros.online");
    static final String PREFS = "oros-phone";
    private static final int MAX_MESSAGE = 32 * 1024 * 1024;
    private static final int MAX_ITEMS = 20000;

    static final String[] CONTACTS_PERMS = {Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS};
    static final String[] CALENDAR_PERMS = {Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR};

    private final Context app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Callback callback = new Callback();

    @Nullable private KeptTwaLauncher launcher;
    @Nullable private CustomTabsSession session;
    private boolean validated;
    private boolean channelReady;

    PhoneBridge(Context context) {
        app = context.getApplicationContext();
    }

    CustomTabsCallback callback() {
        return callback;
    }

    /** A new launch: the newest launcher owns the session from now on. */
    void attach(KeptTwaLauncher l) {
        main.post(() -> {
            if (launcher != null && launcher != l) launcher.reallyDestroy();
            launcher = l;
            session = null;
            validated = false;
            channelReady = false;
        });
    }

    private void onPageLoaded() {
        CustomTabsSession s = launcher != null ? launcher.session() : null;
        if (s == null) return;
        if (s != session) {
            session = s;
            validated = false;
            channelReady = false;
            boolean asked = s.validateRelationship(CustomTabsService.RELATION_USE_AS_ORIGIN, ORIGIN, null);
            Log.d(TAG, "validateRelationship requested: " + asked);
            return;
        }
        if (validated) requestChannel();   // reload: the page needs a new port
    }

    private void requestChannel() {
        if (session == null) return;
        channelReady = false;
        boolean ok = session.requestPostMessageChannel(ORIGIN, ORIGIN, new Bundle());
        Log.d(TAG, "requestPostMessageChannel: " + ok);
    }

    private class Callback extends QualityEnforcer {
        @Override
        public void onNavigationEvent(int navigationEvent, @Nullable Bundle extras) {
            super.onNavigationEvent(navigationEvent, extras);
            if (navigationEvent == NAVIGATION_FINISHED) main.post(PhoneBridge.this::onPageLoaded);
        }

        @Override
        public void onRelationshipValidationResult(int relation, @NonNull Uri requestedOrigin,
                boolean result, @Nullable Bundle extras) {
            super.onRelationshipValidationResult(relation, requestedOrigin, result, extras);
            Log.d(TAG, "relationship " + requestedOrigin + ": " + result);
            main.post(() -> {
                validated = result;
                if (result) requestChannel();
            });
        }

        @Override
        public void onMessageChannelReady(@Nullable Bundle extras) {
            super.onMessageChannelReady(extras);
            main.post(() -> {
                channelReady = true;
                // The first message hands the page its port (phone.js).
                send(state());
            });
        }

        @Override
        public void onPostMessage(@NonNull String message, @Nullable Bundle extras) {
            super.onPostMessage(message, extras);
            if (message.length() > MAX_MESSAGE) return;
            io.execute(() -> handle(message));
        }
    }

    /** Called by PermissionActivity after Android answered. */
    void permissionsChanged() {
        main.post(() -> send(state()));
    }

    private void send(JSONObject msg) {
        main.post(() -> {
            if (session == null || !channelReady) return;
            int r = session.postMessage(msg.toString(), null);
            if (r != CustomTabsService.RESULT_SUCCESS) Log.w(TAG, "postMessage result " + r);
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
            o.put("app", BuildConfig.VERSION_NAME);
        } catch (JSONException ignored) {
        }
        return o;
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
                    return;
                case "contacts":
                case "calendar": {
                    JSONArray items = m.optJSONArray("items");
                    if (items == null || items.length() > MAX_ITEMS) throw new IllegalArgumentException("bad items");
                    int[] n;
                    if ("contacts".equals(t)) {
                        if (!granted(CONTACTS_PERMS)) throw new SecurityException("no permission");
                        n = new ContactsWriter(app).apply(items);
                    } else {
                        if (!granted(CALENDAR_PERMS)) throw new SecurityException("no permission");
                        n = new CalendarWriter(app).apply(items);
                    }
                    JSONObject done = new JSONObject();
                    done.put("t", "done");
                    done.put("what", t);
                    done.put("seq", seq);
                    done.put("added", n[0]);
                    done.put("updated", n[1]);
                    done.put("removed", n[2]);
                    done.put("kept", n[3]);
                    send(done);
                    return;
                }
                case "clear":
                    if ("contacts".equals(what) && granted(CONTACTS_PERMS)) new ContactsWriter(app).clear();
                    else if ("calendar".equals(what) && granted(CALENDAR_PERMS)) new CalendarWriter(app).clear();
                    return;
                default:
            }
        } catch (Exception e) {
            Log.w(TAG, "message " + t + " failed", e);
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
