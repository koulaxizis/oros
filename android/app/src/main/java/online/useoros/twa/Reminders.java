package online.useoros.twa;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/**
 * BR-PHONE v3: reminders the page works out for the next 48 hours
 * (Clock alarms, Water, To-Do; phone.js reminderRows), rung by Android
 * even when orOS is closed. The page sends a full snapshot
 * {id, at, kind: "alarm"|"note", ns, title, body, link}; it is kept in
 * the app's preferences, so alarms survive a reboot (ReminderReceiver
 * re-arms them). A reminder that comes due while orOS is on screen is
 * skipped: the page shows its own.
 */
final class Reminders {
    static final String ACTION_FIRE = "online.useoros.twa.REMINDER";
    private static final String KEY = "reminders";
    private static final String ARMED = "reminders-armed";
    private static final String CH_NOTE = "reminders";
    private static final String CH_ALARM = "alarms";
    private static final int MAX = 100;

    private Reminders() {}

    private static SharedPreferences sp(Context c) {
        return c.getSharedPreferences(PhoneBridge.PREFS, Context.MODE_PRIVATE);
    }

    /** True when Android lets the app ring at an exact time. */
    static boolean exact(Context c) {
        if (Build.VERSION.SDK_INT < 31) return true;
        AlarmManager am = c.getSystemService(AlarmManager.class);
        return am != null && am.canScheduleExactAlarms();
    }

    /** Notifications allowed: "granted", "denied" or "ask" (Android 13+). */
    static String permission(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null && nm.areNotificationsEnabled()) return "granted";
        if (Build.VERSION.SDK_INT < 33) return "denied";
        return sp(c).getBoolean("asked-reminders", false) ? "denied" : "ask";
    }

    /** Replaces the stored reminders with the page's snapshot. */
    static int apply(Context c, JSONArray items) {
        JSONArray keep = new JSONArray();
        long now = System.currentTimeMillis();
        for (int i = 0; items != null && i < items.length() && keep.length() < MAX; i++) {
            JSONObject it = items.optJSONObject(i);
            if (it == null) continue;
            String id = it.optString("id");
            long at = it.optLong("at");
            if (id.isEmpty() || id.length() > 160 || at <= now) continue;
            try {
                JSONObject r = new JSONObject();
                r.put("id", id);
                r.put("at", at);
                r.put("kind", "alarm".equals(it.optString("kind")) ? "alarm" : "note");
                r.put("ns", cut(it.optString("ns"), 20));
                r.put("title", cut(it.optString("title"), 80));
                r.put("body", cut(it.optString("body"), 240));
                r.put("link", cut(it.optString("link"), 200));
                keep.put(r);
            } catch (Exception ignored) {
            }
        }
        sp(c).edit().putString(KEY, keep.toString()).apply();
        arm(c);
        return keep.length();
    }

    static void clear(Context c) {
        sp(c).edit().remove(KEY).apply();
        arm(c);
    }

    private static JSONArray stored(Context c) {
        try {
            return new JSONArray(sp(c).getString(KEY, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private static String cut(String s, int n) {
        return s == null ? "" : s.length() > n ? s.substring(0, n) : s;
    }

    /** Cancels what was armed before and arms every stored reminder
     *  still ahead. One PendingIntent per reminder id. */
    static void arm(Context c) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        if (am == null) return;
        SharedPreferences p = sp(c);
        Set<String> before = new HashSet<>(p.getStringSet(ARMED, new HashSet<>()));
        Set<String> now = new HashSet<>();
        JSONArray all = stored(c);
        long t = System.currentTimeMillis();
        boolean exact = exact(c);
        for (int i = 0; i < all.length(); i++) {
            JSONObject r = all.optJSONObject(i);
            if (r == null || r.optLong("at") <= t) continue;
            String id = r.optString("id");
            PendingIntent pi = fireIntent(c, id);
            long at = r.optLong("at");
            if ("alarm".equals(r.optString("kind")) && exact) {
                PendingIntent show = PendingIntent.getActivity(c, id.hashCode(), openIntent(c, r.optString("link")),
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, show), pi);
            } else if (exact) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            }
            now.add(id);
        }
        for (String id : before) {
            if (!now.contains(id)) am.cancel(fireIntent(c, id));
        }
        p.edit().putStringSet(ARMED, now).apply();
    }

    private static PendingIntent fireIntent(Context c, String id) {
        // The data only makes each reminder's PendingIntent distinct.
        Intent i = new Intent(c, ReminderReceiver.class).setAction(ACTION_FIRE)
                .setData(Uri.fromParts("oros-reminder", id, null)).putExtra("id", id);
        return PendingIntent.getBroadcast(c, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static Intent openIntent(Context c, String link) {
        Uri.Builder u = Uri.parse(c.getString(R.string.launchUrl)).buildUpon();
        if (link != null && !link.isEmpty()) u.appendQueryParameter("phone-open", link);
        return new Intent(c, LauncherActivity.class).setAction(Intent.ACTION_VIEW).setData(u.build())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    /** An alarm went off: show its reminder, unless orOS is on screen. */
    static void fire(Context c, String id) {
        JSONArray all = stored(c);
        JSONObject r = null;
        for (int i = 0; i < all.length(); i++) {
            JSONObject x = all.optJSONObject(i);
            if (x != null && id.equals(x.optString("id"))) r = x;
        }
        if (r == null) return;
        if (PhoneBridge.pageOnScreen()) {
            OrosApp.bridge(c).diag("reminder " + id + " left to the page (on screen)");
            return;
        }
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || !nm.areNotificationsEnabled()) return;
        boolean alarm = "alarm".equals(r.optString("kind"));
        channels(c, nm);
        PendingIntent open = PendingIntent.getActivity(c, id.hashCode(), openIntent(c, r.optString("link")),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = (Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(c, alarm ? CH_ALARM : CH_NOTE)
                : new Notification.Builder(c))
                .setSmallIcon(R.drawable.ic_stat_oros)
                .setContentTitle(r.optString("title"))
                .setContentText(r.optString("body"))
                .setStyle(new Notification.BigTextStyle().bigText(r.optString("body")))
                .setWhen(r.optLong("at"))
                .setShowWhen(true)
                .setAutoCancel(true)
                .setContentIntent(open)
                .setCategory(alarm ? Notification.CATEGORY_ALARM : Notification.CATEGORY_REMINDER);
        if (alarm) {
            if (Build.VERSION.SDK_INT >= 26) b.setTimeoutAfter(60000);
            if (Build.VERSION.SDK_INT < 26) {
                b.setPriority(Notification.PRIORITY_MAX)
                        .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), android.media.AudioManager.STREAM_ALARM);
            }
        }
        Notification n = b.build();
        if (alarm) n.flags |= Notification.FLAG_INSISTENT;   // the sound repeats until it is dismissed
        nm.notify(id, 1, n);
        OrosApp.bridge(c).diag("reminder rang: " + id);
    }

    private static void channels(Context c, NotificationManager nm) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel note = new NotificationChannel(CH_NOTE, c.getString(R.string.channel_reminders),
                NotificationManager.IMPORTANCE_DEFAULT);
        NotificationChannel alarm = new NotificationChannel(CH_ALARM, c.getString(R.string.channel_alarms),
                NotificationManager.IMPORTANCE_HIGH);
        alarm.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        alarm.enableVibration(true);
        nm.createNotificationChannel(note);
        nm.createNotificationChannel(alarm);
    }
}
