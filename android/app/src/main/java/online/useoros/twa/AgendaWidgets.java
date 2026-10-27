package online.useoros.twa;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.format.DateFormat;
import android.text.style.ForegroundColorSpan;
import android.text.style.StrikethroughSpan;
import android.text.style.StyleSpan;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * The "Calendar" and "To-Do" home-screen widgets (BR-PHONE v7).
 *
 * While the phone has one of them, the page sends {t:"agenda", cal,
 * todo} (phone.js agendaData; a kind whose widget is not placed comes
 * as null and the rows kept here stay). Both are drawn again with the
 * Today widget every hour (Widgets.update), so finished events leave
 * and a task whose day passed shows as late while orOS stays closed.
 *
 * A tick on the To-Do widget is kept here ("widget-ticks", never
 * cleared with the widgets) and the row shows ticked at once; the
 * bridge sends the ticks as {t:"ticks"} on every channel until the
 * page answers {t:"applied", what:"ticks"}: the page writes them with
 * To-Do's own stamps and sync carries them like any change. A
 * repeating task is not ticked here: its box opens To-Do, which works
 * out the next date. Nothing is shown on the lock screen.
 */
final class AgendaWidgets {
    static final String PREFS = "widget-agenda";
    static final String TICKS = "widget-ticks";
    static final String ACTION_TICK = "online.useoros.twa.WIDGET_TICK";
    private static final int MAX_TICKS = 200;
    private static final long HOUR = 3_600_000L, DAY = 86_400_000L;
    private static final int[] CAL_ROWS = {R.id.w_row0, R.id.w_row1, R.id.w_row2, R.id.w_row3,
            R.id.w_row4, R.id.w_row5, R.id.w_row6, R.id.w_row7};
    private static final int[] TODO_ROWS = {R.id.w_trow0, R.id.w_trow1, R.id.w_trow2, R.id.w_trow3,
            R.id.w_trow4, R.id.w_trow5, R.id.w_trow6, R.id.w_trow7};
    private static final int[] TODO_CHECKS = {R.id.w_tchk0, R.id.w_tchk1, R.id.w_tchk2, R.id.w_tchk3,
            R.id.w_tchk4, R.id.w_tchk5, R.id.w_tchk6, R.id.w_tchk7};
    private static final int[] TODO_TEXTS = {R.id.w_ttxt0, R.id.w_ttxt1, R.id.w_ttxt2, R.id.w_ttxt3,
            R.id.w_ttxt4, R.id.w_ttxt5, R.id.w_ttxt6, R.id.w_ttxt7};

    private AgendaWidgets() {}

    static int count(Context c, Class<?> cls) {
        try {
            return AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c, cls)).length;
        } catch (RuntimeException e) {
            return 0;
        }
    }

    /** {t:"agenda"}: a null kind keeps what is stored. */
    static void save(Context c, JSONObject m) {
        SharedPreferences.Editor e = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        JSONArray cal = m.optJSONArray("cal"), todo = m.optJSONArray("todo");
        long now = System.currentTimeMillis();
        if (cal != null) e.putString("cal", cal.toString()).putLong("calAt", now);
        if (todo != null) e.putString("todo", todo.toString()).putLong("todoAt", now);
        e.apply();
        Widgets.update(c);
    }

    /** The last widget of a kind left the home screen: its rows go (the ticks stay). */
    static void clear(Context c, boolean calendar) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .remove(calendar ? "cal" : "todo").remove(calendar ? "calAt" : "todoAt").apply();
        Widgets.update(c);
    }

    /** Draws every Calendar and To-Do widget; true when there is one. */
    static boolean update(Context c, AppWidgetManager m) {
        int[] cal = m.getAppWidgetIds(new ComponentName(c, CalendarWidget.class));
        int[] todo = m.getAppWidgetIds(new ComponentName(c, TodoWidget.class));
        for (int id : cal) m.updateAppWidget(id, calendar(c, m.getAppWidgetOptions(id)));
        for (int id : todo) m.updateAppWidget(id, todo(c, m.getAppWidgetOptions(id)));
        return cal.length + todo.length > 0;
    }

    private static JSONArray rows(Context c, String key) {
        try {
            String s = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key, null);
            return s == null ? null : new JSONArray(s);
        } catch (Exception e) {
            return null;
        }
    }

    private static int slots(Bundle opts, int rowDp) {
        int h = opts != null ? opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0) : 0;
        return h <= 0 ? 4 : Math.max(1, Math.min(CAL_ROWS.length, (h - 48) / rowDp));
    }

    /** "Late", "", "Tomorrow" or the weekday, plus the time. */
    private static String label(Context c, String d, String tm, String today, String tomorrow) {
        int cmp = d.compareTo(today);
        if (cmp < 0) return c.getString(R.string.widget_late);
        if (cmp == 0) return tm;
        return (d.equals(tomorrow) ? c.getString(R.string.widget_tomorrow) : Widgets.weekday(d))
                + (tm.isEmpty() ? "" : " " + tm);
    }

    private static void info(Context c, RemoteViews v, String text) {
        v.setTextViewText(R.id.w_info, text);
        v.setViewVisibility(R.id.w_info, text.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private static void foot(Context c, RemoteViews v, JSONArray data, int shown, int total, int nothing) {
        if (total == 0) {
            v.setTextViewText(R.id.w_empty, c.getString(data == null ? R.string.widget_no_data : nothing));
            v.setViewVisibility(R.id.w_empty, View.VISIBLE);
        } else if (total > shown) {
            v.setTextViewText(R.id.w_empty, c.getString(R.string.widget_more, total - shown));
            v.setViewVisibility(R.id.w_empty, View.VISIBLE);
        } else {
            v.setViewVisibility(R.id.w_empty, View.GONE);
        }
    }

    private static boolean stale(Context c, String key, long now) {
        long at = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(key, 0);
        return at > 0 && at < now - 2 * DAY;
    }

    // ---------- Calendar ----------

    static RemoteViews calendar(Context c, Bundle opts) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_calendar);
        long now = System.currentTimeMillis();
        String today = Widgets.ymd(now), tomorrow = Widgets.ymd(now + DAY);
        String hourAgo = Widgets.ymd(now - HOUR).equals(today) ? Widgets.hm(now - HOUR) : "";
        v.setTextViewText(R.id.w_date, DateFormat.format(
                DateFormat.getBestDateTimePattern(Locale.getDefault(), "EEEdMMM"), now));
        v.setOnClickPendingIntent(R.id.w_root, Widgets.open(c, "calendar"));
        v.setOnClickPendingIntent(R.id.w_add_event, Widgets.open(c, "event"));
        JSONArray data = rows(c, "cal");
        info(c, v, data != null && stale(c, "calAt", now) ? c.getString(R.string.widget_stale) : "");

        int sub = c.getColor(R.color.w_sub), accent = c.getColor(R.color.w_accent);
        int max = slots(opts, 22), shown = 0, total = 0;
        for (int i = 0; data != null && i < data.length(); i++) {
            JSONObject r = data.optJSONObject(i);
            if (r == null) continue;
            String d = r.optString("d"), tm = r.optString("tm"), t = r.optString("t"), s = r.optString("s"), o = r.optString("o");
            if (t.isEmpty() || d.compareTo(today) < 0) continue;
            if (d.equals(today) && !tm.isEmpty() && tm.compareTo(hourAgo) < 0) continue;   // over
            total++;
            if (shown >= max) continue;
            SpannableStringBuilder b = new SpannableStringBuilder();
            String l = label(c, d, tm, today, tomorrow);
            if (!l.isEmpty()) {
                b.append(l);
                b.setSpan(new StyleSpan(Typeface.BOLD), 0, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                b.setSpan(new ForegroundColorSpan(accent), 0, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                b.append("  ");
            }
            b.append(t);
            if (!s.isEmpty()) {
                int at = b.length();
                b.append(" · ").append(s);
                b.setSpan(new ForegroundColorSpan(sub), at, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            }
            int id = CAL_ROWS[shown++];
            v.setTextViewText(id, b);
            v.setViewVisibility(id, View.VISIBLE);
            v.setOnClickPendingIntent(id, o.startsWith("calendar:")
                    ? Widgets.link(c, "phone-open", o) : Widgets.open(c, "calendar"));
        }
        for (int i = shown; i < CAL_ROWS.length; i++) v.setViewVisibility(CAL_ROWS[i], View.GONE);
        foot(c, v, data, shown, total, R.string.widget_no_events);
        return v;
    }

    // ---------- To-Do ----------

    private static String key(String list, String item) {
        return list + "/" + item;
    }

    static synchronized JSONArray pending(Context c) {
        try {
            return new JSONArray(c.getSharedPreferences(TICKS, Context.MODE_PRIVATE).getString("items", "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private static synchronized void store(Context c, JSONArray a) {
        c.getSharedPreferences(TICKS, Context.MODE_PRIVATE).edit().putString("items", a.toString()).commit();
    }

    /** A tick on the widget: kept until the page takes it. */
    static synchronized void tick(Context c, String list, String item) {
        JSONArray a = pending(c);
        for (int i = 0; i < a.length(); i++) {
            JSONObject x = a.optJSONObject(i);
            if (x != null && key(list, item).equals(key(x.optString("l"), x.optString("i")))) return;
        }
        if (a.length() >= MAX_TICKS) return;
        try {
            long at = System.currentTimeMillis();
            JSONObject x = new JSONObject();
            x.put("ref", key(list, item) + "@" + at);
            x.put("l", list);
            x.put("i", item);
            x.put("at", at);
            a.put(x);
        } catch (Exception e) {
            return;
        }
        store(c, a);
    }

    /** {t:"applied", what:"ticks", refs}: those ticks are in orOS now. */
    static synchronized void taken(Context c, JSONArray refs) {
        if (refs == null || refs.length() == 0) return;
        Set<String> done = new HashSet<>();
        for (int i = 0; i < refs.length(); i++) done.add(refs.optString(i));
        JSONArray a = pending(c), keep = new JSONArray();
        for (int i = 0; i < a.length(); i++) {
            JSONObject x = a.optJSONObject(i);
            if (x != null && !done.contains(x.optString("ref"))) keep.put(x);
        }
        store(c, keep);
    }

    private static PendingIntent tickIntent(Context c, String list, String item) {
        Uri u = new Uri.Builder().scheme("oros-widget").authority("tick").appendPath(list).appendPath(item).build();
        Intent i = new Intent(c, TodoWidget.class).setAction(ACTION_TICK).setData(u);
        return PendingIntent.getBroadcast(c, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static RemoteViews todo(Context c, Bundle opts) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_todo);
        long now = System.currentTimeMillis();
        String today = Widgets.ymd(now), tomorrow = Widgets.ymd(now + DAY);
        v.setOnClickPendingIntent(R.id.w_root, Widgets.open(c, "todo"));
        v.setOnClickPendingIntent(R.id.w_add_task, Widgets.open(c, "task"));
        JSONArray data = rows(c, "todo"), wait = pending(c);
        Set<String> ticked = new HashSet<>();
        for (int i = 0; i < wait.length(); i++) {
            JSONObject x = wait.optJSONObject(i);
            if (x != null) ticked.add(key(x.optString("l"), x.optString("i")));
        }
        String note = data != null && stale(c, "todoAt", now) ? c.getString(R.string.widget_stale) : "";
        if (!ticked.isEmpty()) note = c.getResources().getQuantityString(R.plurals.widget_ticks_wait, ticked.size(), ticked.size());
        info(c, v, note);

        int sub = c.getColor(R.color.w_sub), accent = c.getColor(R.color.w_accent), late = c.getColor(R.color.w_late);
        int max = slots(opts, 28), shown = 0, total = 0;
        for (int i = 0; data != null && i < data.length(); i++) {
            JSONObject r = data.optJSONObject(i);
            if (r == null) continue;
            String l = r.optString("l"), it = r.optString("i"), t = r.optString("t"), s = r.optString("s"), d = r.optString("d");
            if (t.isEmpty() || l.isEmpty() || it.isEmpty()) continue;
            total++;
            if (shown >= max) continue;
            boolean done = ticked.contains(key(l, it)), isLate = !d.isEmpty() && d.compareTo(today) < 0;
            SpannableStringBuilder b = new SpannableStringBuilder();
            String lb = d.isEmpty() ? "" : label(c, d, "", today, tomorrow);
            if (!lb.isEmpty()) {
                b.append(lb);
                b.setSpan(new StyleSpan(Typeface.BOLD), 0, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                b.setSpan(new ForegroundColorSpan(isLate ? late : accent), 0, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                b.append("  ");
            }
            int from = b.length();
            b.append(t);
            if (done) {
                b.setSpan(new StrikethroughSpan(), from, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                b.setSpan(new ForegroundColorSpan(sub), from, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            }
            if (!s.isEmpty()) {
                int at = b.length();
                b.append(" · ").append(s);
                b.setSpan(new ForegroundColorSpan(sub), at, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            }
            int n = shown++;
            v.setViewVisibility(TODO_ROWS[n], View.VISIBLE);
            v.setTextViewText(TODO_TEXTS[n], b);
            v.setImageViewResource(TODO_CHECKS[n], done ? R.drawable.ic_widget_check_on : R.drawable.ic_widget_check_off);
            v.setContentDescription(TODO_CHECKS[n], c.getString(done ? R.string.widget_ticked : R.string.widget_tick, t));
            v.setOnClickPendingIntent(TODO_TEXTS[n], Widgets.link(c, "phone-open", "todo:" + l));
            if (done) {
                v.setOnClickPendingIntent(TODO_CHECKS[n], Widgets.link(c, "phone-open", "todo:" + l));
            } else if (r.optInt("r") == 1) {
                v.setOnClickPendingIntent(TODO_CHECKS[n], Widgets.link(c, "phone-done", key(l, it)));
            } else {
                v.setOnClickPendingIntent(TODO_CHECKS[n], tickIntent(c, l, it));
            }
        }
        for (int i = shown; i < TODO_ROWS.length; i++) v.setViewVisibility(TODO_ROWS[i], View.GONE);
        foot(c, v, data, shown, total, R.string.widget_no_tasks);
        return v;
    }

    /** The tick's list and task from its intent (TodoWidget). */
    static String[] tickOf(Intent in) {
        Uri u = in.getData();
        if (u == null || !"oros-widget".equals(u.getScheme()) || !"tick".equals(u.getAuthority())) return null;
        java.util.List<String> p = u.getPathSegments();
        if (p.size() != 2 || p.get(0).isEmpty() || p.get(1).isEmpty()) return null;
        return new String[]{p.get(0), p.get(1)};
    }
}
