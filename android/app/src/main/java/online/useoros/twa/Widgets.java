package online.useoros.twa;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.format.DateFormat;
import android.text.style.ForegroundColorSpan;
import android.text.style.StyleSpan;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Home-screen widgets (BR-PHONE v4).
 *
 * "Today": the page sends its Today summary as {t:"today", data}
 * (phone.js widgetData) while the phone has such a widget; it is kept
 * here and drawn again every hour and at midnight, so on the days
 * orOS stays closed a task whose day passed shows as late and an
 * event that is over leaves. "Quick add": three buttons. Every tap
 * opens orOS at /?phone-quick=<word> (today, cmd, task, water, note);
 * nothing is written here. "Calendar" and "To-Do" (v7) are in
 * AgendaWidgets; they share the hourly redraw below.
 */
final class Widgets {
    static final String PREFS = "widget";
    static final String ACTION_REFRESH = "online.useoros.twa.WIDGET_REFRESH";
    private static final int[] ROWS = {R.id.w_row0, R.id.w_row1, R.id.w_row2, R.id.w_row3,
            R.id.w_row4, R.id.w_row5, R.id.w_row6, R.id.w_row7};
    private static final long HOUR = 3_600_000L, DAY = 86_400_000L;

    private Widgets() {}

    /** Today widgets on the home screen; the page sends data only then. */
    static int count(Context c) {
        try {
            return AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c, TodayWidget.class)).length;
        } catch (RuntimeException e) {
            return 0;
        }
    }

    static void save(Context c, JSONObject data) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("today", data == null ? "" : data.toString())
                .putLong("at", System.currentTimeMillis()).apply();
        update(c);
    }

    static void clear(Context c) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        update(c);
    }

    /** Draws every Today, Calendar and To-Do widget again and arms the
     *  next redraw while any of them is placed. */
    static void update(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, TodayWidget.class));
        for (int id : ids) m.updateAppWidget(id, today(c, m.getAppWidgetOptions(id)));
        boolean more = AgendaWidgets.update(c, m);
        schedule(c, ids.length > 0 || more);
    }

    static PendingIntent open(Context c, String word) {
        return link(c, "phone-quick", word);
    }

    /** orOS at /?<key>=<value> (phone-quick, phone-open, phone-done). */
    static PendingIntent link(Context c, String key, String value) {
        Uri u = Uri.parse(c.getString(R.string.launchUrl)).buildUpon().appendQueryParameter(key, value).build();
        Intent i = new Intent(c, LauncherActivity.class).setAction(Intent.ACTION_VIEW).setData(u)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, (key + "=" + value).hashCode(), i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** orOS with the Assistant's small window (quickmenu.js "#quick-ask",
     *  AS-OUT): the widget's Assistant button and the Quick Settings tile. */
    static Intent askIntent(Context c) {
        Uri u = Uri.parse(c.getString(R.string.launchUrl)).buildUpon().fragment("quick-ask").build();
        return new Intent(c, LauncherActivity.class).setAction(Intent.ACTION_VIEW).setData(u)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    static PendingIntent ask(Context c) {
        return PendingIntent.getActivity(c, "quick-ask".hashCode(), askIntent(c),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void buttons(Context c, RemoteViews v) {
        v.setOnClickPendingIntent(R.id.w_ask, ask(c));
        v.setOnClickPendingIntent(R.id.w_cmd, open(c, "cmd"));
        v.setOnClickPendingIntent(R.id.w_add_task, open(c, "task"));
        v.setOnClickPendingIntent(R.id.w_add_water, open(c, "water"));
        v.setOnClickPendingIntent(R.id.w_add_note, open(c, "note"));
    }

    static RemoteViews quick(Context c) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_quick);
        buttons(c, v);
        return v;
    }

    static RemoteViews today(Context c, Bundle opts) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_today);
        long now = System.currentTimeMillis();
        v.setTextViewText(R.id.w_date, DateFormat.format(
                DateFormat.getBestDateTimePattern(Locale.getDefault(), "EEEdMMM"), now));
        v.setOnClickPendingIntent(R.id.w_root, open(c, "today"));
        buttons(c, v);

        JSONObject data = null;
        try {
            String s = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("today", "");
            if (!s.isEmpty()) data = new JSONObject(s);
        } catch (Exception ignored) {
        }
        // Rows that fit: the height Android gives the widget, less the
        // title and the buttons.
        int h = opts != null ? opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0) : 0;
        int slots = h <= 0 ? 4 : Math.max(1, Math.min(ROWS.length, (h - 84) / 21));

        String info = data != null ? data.optString("info") : "";
        String day = data != null ? data.optString("day") : "";
        if (data != null && !day.isEmpty() && day.compareTo(ymd(now - 2 * DAY)) < 0) info = c.getString(R.string.widget_stale);
        v.setTextViewText(R.id.w_info, info);
        v.setViewVisibility(R.id.w_info, info.isEmpty() ? View.GONE : View.VISIBLE);

        List<CharSequence> lines = data != null ? lines(c, data.optJSONArray("rows"), now) : Collections.emptyList();
        for (int i = 0; i < ROWS.length; i++) {
            boolean on = i < slots && i < lines.size();
            v.setViewVisibility(ROWS[i], on ? View.VISIBLE : View.GONE);
            if (on) v.setTextViewText(ROWS[i], lines.get(i));
        }
        if (lines.isEmpty()) {
            v.setTextViewText(R.id.w_empty, c.getString(data == null ? R.string.widget_no_data : R.string.widget_nothing));
            v.setViewVisibility(R.id.w_empty, View.VISIBLE);
        } else if (lines.size() > slots) {
            v.setTextViewText(R.id.w_empty, c.getString(R.string.widget_more, lines.size() - slots));
            v.setViewVisibility(R.id.w_empty, View.VISIBLE);
        } else {
            v.setViewVisibility(R.id.w_empty, View.GONE);
        }
        return v;
    }

    private static final class Row {
        final int order;
        final boolean late;
        final String day, time;
        final CharSequence text;

        Row(int order, boolean late, String day, String time, CharSequence text) {
            this.order = order;
            this.late = late;
            this.day = day;
            this.time = time;
            this.text = text;
        }
    }

    /** The rows as of now: late tasks first, then by day and time
     *  (timed before all-day); events over an hour ago are left out. */
    static List<CharSequence> lines(Context c, JSONArray rows, long now) {
        String today = ymd(now), tomorrow = ymd(now + DAY);
        String hourAgo = ymd(now - HOUR).equals(today) ? hm(now - HOUR) : "";
        int sub = c.getColor(R.color.w_sub), late = c.getColor(R.color.w_late), accent = c.getColor(R.color.w_accent);
        List<Row> out = new ArrayList<>();
        for (int i = 0; rows != null && i < rows.length(); i++) {
            JSONObject r = rows.optJSONObject(i);
            if (r == null) continue;
            String d = r.optString("d"), tm = r.optString("tm"), t = r.optString("t"), app = r.optString("a");
            boolean task = !"event".equals(r.optString("k"));
            if (t.isEmpty()) continue;
            if (d.isEmpty()) d = today;
            String label;
            boolean isLate = false;
            int cmp = d.compareTo(today);
            if (cmp < 0) {
                if (!task) continue;
                isLate = true;
                label = c.getString(R.string.widget_late);
            } else if (cmp == 0) {
                if (!task && !tm.isEmpty() && tm.compareTo(hourAgo) < 0) continue;
                label = tm;
            } else {
                label = (d.equals(tomorrow) ? c.getString(R.string.widget_tomorrow) : weekday(d))
                        + (tm.isEmpty() ? "" : " " + tm);
            }
            SpannableStringBuilder b = new SpannableStringBuilder();
            if (!label.isEmpty()) {
                b.append(label);
                b.setSpan(new StyleSpan(Typeface.BOLD), 0, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                b.setSpan(new ForegroundColorSpan(isLate ? late : accent), 0, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                b.append("  ");
            }
            b.append(t);
            if (!app.isEmpty()) {
                int at = b.length();
                b.append(" · ").append(app);
                b.setSpan(new ForegroundColorSpan(sub), at, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            }
            out.add(new Row(i, isLate, d, tm, b));
        }
        Collections.sort(out, (a, b) -> {
            if (a.late != b.late) return a.late ? -1 : 1;
            if (!a.late) {
                int x = a.day.compareTo(b.day);
                if (x != 0) return x;
                x = (a.time.isEmpty() ? "~" : a.time).compareTo(b.time.isEmpty() ? "~" : b.time);
                if (x != 0) return x;
            }
            return Integer.compare(a.order, b.order);
        });
        List<CharSequence> lines = new ArrayList<>();
        for (Row r : out) lines.add(r.text);
        return lines;
    }

    /** Next redraw: the next full hour (inexact, never wakes the phone;
     *  covers midnight and events that end). */
    private static void schedule(Context c, boolean on) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        Intent i = new Intent(c, TodayWidget.class).setAction(ACTION_REFRESH);
        PendingIntent pi = PendingIntent.getBroadcast(c, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        if (am == null) return;
        if (!on) {
            am.cancel(pi);
            return;
        }
        Calendar next = Calendar.getInstance();
        next.add(Calendar.HOUR_OF_DAY, 1);
        next.set(Calendar.MINUTE, 0);
        next.set(Calendar.SECOND, 30);
        next.set(Calendar.MILLISECOND, 0);
        am.set(AlarmManager.RTC, next.getTimeInMillis(), pi);
    }

    static String ymd(long ms) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date(ms));
    }

    static String hm(long ms) {
        return new SimpleDateFormat("HH:mm", Locale.ROOT).format(new Date(ms));
    }

    static String weekday(String ymd) {
        try {
            Date d = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).parse(ymd);
            return d == null ? ymd : new SimpleDateFormat("EEE", Locale.getDefault()).format(d);
        } catch (Exception e) {
            return ymd;
        }
    }
}
