package online.useoros.twa;

import android.accounts.Account;
import android.content.ContentProviderOperation;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;
import android.provider.CalendarContract.Calendars;
import android.provider.CalendarContract.Events;
import android.provider.CalendarContract.Reminders;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.TimeZone;

/**
 * Mirrors the page's rows into two calendars of the account:
 * "orOS" (the person's own events, editable on the phone; edits come
 * back through changes()/ack()) and "orOS feeds" (phone.js feedRows,
 * ids "f…", read-only). _SYNC_ID = orOS id, SYNC_DATA1 = row hash.
 * Rows the phone changed (DIRTY) are left alone until the page took
 * them. Returns {added, updated, removed, kept}.
 */
class CalendarWriter {
    private static final int BATCH = 300;
    private static final int COLOR = 0xFFD4AF37;
    private static final int FEEDS_COLOR = 0xFF9AA4B0;

    private final Context ctx;
    private final ContentResolver cr;
    private final Account acc;

    CalendarWriter(Context c) {
        ctx = c;
        cr = c.getContentResolver();
        acc = OrosAccount.ensure(c);
    }

    private Uri sa(Uri u) {
        return OrosAccount.asCalendarSyncAdapter(u, acc);
    }

    static final String FEEDS = "orOS-feeds";

    private long findCalendar(String name) {
        try (Cursor c = cr.query(Calendars.CONTENT_URI, new String[]{Calendars._ID, Calendars.NAME},
                Calendars.ACCOUNT_TYPE + "=? AND " + Calendars.ACCOUNT_NAME + "=?",
                new String[]{acc.type, acc.name}, Calendars._ID)) {
            while (c != null && c.moveToNext()) {
                String n = c.getString(1);
                // The first calendar (v1) has NAME "orOS" or none.
                if (FEEDS.equals(name) ? FEEDS.equals(n) : !FEEDS.equals(n)) return c.getLong(0);
            }
        }
        return -1;
    }

    private long ensureCalendar(String name) {
        boolean feeds = FEEDS.equals(name);
        int access = feeds ? Calendars.CAL_ACCESS_READ : Calendars.CAL_ACCESS_OWNER;
        long id = findCalendar(name);
        if (id >= 0) {
            ContentValues v = new ContentValues();
            v.put(Calendars.CALENDAR_ACCESS_LEVEL, access);   // v1 made "orOS" read-only
            cr.update(ContentUris.withAppendedId(sa(Calendars.CONTENT_URI), id), v, null, null);
            return id;
        }
        ContentValues v = new ContentValues();
        v.put(Calendars.ACCOUNT_NAME, acc.name);
        v.put(Calendars.ACCOUNT_TYPE, acc.type);
        v.put(Calendars.NAME, name);
        v.put(Calendars.CALENDAR_DISPLAY_NAME, ctx.getString(feeds ? R.string.calendar_feeds_name : R.string.calendar_name));
        v.put(Calendars.CALENDAR_COLOR, feeds ? FEEDS_COLOR : COLOR);
        v.put(Calendars.CALENDAR_ACCESS_LEVEL, access);
        v.put(Calendars.OWNER_ACCOUNT, acc.name);
        v.put(Calendars.VISIBLE, 1);
        v.put(Calendars.SYNC_EVENTS, 1);
        v.put(Calendars.CALENDAR_TIME_ZONE, TimeZone.getDefault().getID());
        v.put(Calendars.ALLOWED_REMINDERS, Reminders.METHOD_ALERT);
        Uri u = cr.insert(sa(Calendars.CONTENT_URI), v);
        if (u == null) throw new IllegalStateException("calendar insert failed");
        return ContentUris.parseId(u);
    }

    int[] apply(JSONArray items) throws Exception {
        JSONArray own = new JSONArray(), feeds = new JSONArray();
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            if (it == null) continue;
            if (it.optString("id").matches("f[0-9a-f]{16}")) feeds.put(it); else own.put(it);
        }
        int[] a = apply(ensureCalendar(OrosAccount.NAME), own);
        int[] b = apply(ensureCalendar(FEEDS), feeds);
        return new int[]{a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]};
    }

    private int[] apply(long cal, JSONArray items) throws Exception {
        Map<String, Long> rowId = new HashMap<>();
        Map<String, String> rowHash = new HashMap<>();
        java.util.Set<String> pending = new java.util.HashSet<>();
        try (Cursor c = cr.query(sa(Events.CONTENT_URI), new String[]{Events._ID, Events._SYNC_ID, Events.SYNC_DATA1, Events.DIRTY},
                Events.CALENDAR_ID + "=? AND " + Events.DELETED + "=0", new String[]{String.valueOf(cal)}, null)) {
            while (c != null && c.moveToNext()) {
                if (c.getInt(3) != 0) {
                    // Changed on the phone, not yet taken by the page: keep.
                    if (c.getString(1) != null) pending.add(c.getString(1));
                    continue;
                }
                String sid = c.getString(1);
                if (sid == null || rowId.containsKey(sid)) sid = "\u0000" + c.getLong(0);
                rowId.put(sid, c.getLong(0));
                rowHash.put(sid, c.getString(2));
            }
        }

        int added = 0, updated = 0, kept = 0;
        ArrayList<ContentProviderOperation> ops = new ArrayList<>();
        Uri events = sa(Events.CONTENT_URI), reminders = sa(Reminders.CONTENT_URI);
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            if (it == null) continue;
            String id = it.optString("id");
            if (id.isEmpty() || id.length() > 64 || it.optLong("dtstart", Long.MIN_VALUE) == Long.MIN_VALUE) continue;
            String h = it.optString("h");
            if (pending.contains(id)) { kept++; continue; }
            Long have = rowId.remove(id);
            if (have != null && h.equals(rowHash.get(id))) { kept++; continue; }

            if (ops.size() + 3 > BATCH) {
                cr.applyBatch(CalendarContract.AUTHORITY, ops);
                ops = new ArrayList<>();
            }
            ContentValues v = values(it, cal, h);
            int remind = it.isNull("remind") ? -1 : it.optInt("remind", -1);
            v.put(Events.HAS_ALARM, remind >= 0 ? 1 : 0);
            if (have == null) {
                int at = ops.size();
                v.put(Events._SYNC_ID, id);
                ops.add(ContentProviderOperation.newInsert(events).withValues(v).build());
                if (remind >= 0) {
                    ops.add(ContentProviderOperation.newInsert(reminders)
                            .withValueBackReference(Reminders.EVENT_ID, at)
                            .withValue(Reminders.METHOD, Reminders.METHOD_ALERT)
                            .withValue(Reminders.MINUTES, remind).build());
                }
                added++;
            } else {
                ops.add(ContentProviderOperation.newUpdate(ContentUris.withAppendedId(events, have)).withValues(v).build());
                ops.add(ContentProviderOperation.newDelete(reminders)
                        .withSelection(Reminders.EVENT_ID + "=?", new String[]{String.valueOf(have)}).build());
                if (remind >= 0) {
                    ops.add(ContentProviderOperation.newInsert(reminders)
                            .withValue(Reminders.EVENT_ID, have)
                            .withValue(Reminders.METHOD, Reminders.METHOD_ALERT)
                            .withValue(Reminders.MINUTES, remind).build());
                }
                updated++;
            }
        }

        int removed = 0;
        for (Long gone : rowId.values()) {
            ops.add(ContentProviderOperation.newDelete(ContentUris.withAppendedId(events, gone)).build());
            removed++;
            if (ops.size() >= BATCH) {
                cr.applyBatch(CalendarContract.AUTHORITY, ops);
                ops = new ArrayList<>();
            }
        }
        if (!ops.isEmpty()) cr.applyBatch(CalendarContract.AUTHORITY, ops);
        return new int[]{added, updated, removed, kept};
    }

    /** Event columns; the unused one of DTEND / RRULE+DURATION is nulled
     *  so a row that turns into (or out of) a series stays valid. */
    private static ContentValues values(JSONObject it, long cal, String h) {
        ContentValues v = new ContentValues();
        v.put(Events.CALENDAR_ID, cal);
        v.put(Events.SYNC_DATA1, h);
        v.put(Events.TITLE, it.optString("title"));
        v.put(Events.DESCRIPTION, it.optString("desc"));
        v.put(Events.EVENT_LOCATION, it.optString("loc"));
        v.put(Events.DTSTART, it.optLong("dtstart"));
        boolean allDay = it.optBoolean("allDay");
        v.put(Events.ALL_DAY, allDay ? 1 : 0);
        String tz = it.optString("tz");
        v.put(Events.EVENT_TIMEZONE, allDay || tz.isEmpty() ? "UTC" : tz);
        String rrule = it.isNull("rrule") ? "" : it.optString("rrule");
        if (!rrule.isEmpty()) {
            v.put(Events.RRULE, rrule);
            v.put(Events.DURATION, it.optString("duration", allDay ? "P1D" : "P0S"));
            v.putNull(Events.DTEND);
            String ex = it.isNull("exdate") ? "" : it.optString("exdate");
            if (ex.isEmpty()) v.putNull(Events.EXDATE); else v.put(Events.EXDATE, ex);
        } else {
            v.putNull(Events.RRULE);
            v.putNull(Events.DURATION);
            v.putNull(Events.EXDATE);
            v.put(Events.DTEND, it.optLong("dtend", it.optLong("dtstart")));
        }
        // The label's colour ("#rrggbb"); none → the calendar's colour.
        String color = it.isNull("color") ? "" : it.optString("color");
        if (color.matches("#[0-9a-fA-F]{6}")) v.put(Events.EVENT_COLOR, 0xFF000000 | Integer.parseInt(color.substring(1), 16));
        else v.putNull(Events.EVENT_COLOR);
        v.put(Events.AVAILABILITY, allDay ? Events.AVAILABILITY_FREE : Events.AVAILABILITY_BUSY);
        return v;
    }

    /** Diagnostics: how many rows carry a colour, and what the provider
     *  reports for one of them (event colour / display colour). */
    String colorCheck(JSONArray items) {
        int n = 0;
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            if (it != null && !it.isNull("color") && !it.optString("color").isEmpty()) n++;
        }
        String seen = "none";
        long cal = findCalendar(FEEDS);
        try (Cursor c = cr.query(Events.CONTENT_URI, new String[]{Events.TITLE, Events.EVENT_COLOR, Events.DISPLAY_COLOR},
                Events.CALENDAR_ID + "=? AND " + Events.DELETED + "=0", new String[]{String.valueOf(cal)}, null)) {
            if (c != null && c.moveToFirst()) {
                seen = c.getString(0) + " event=" + (c.isNull(1) ? "null" : Integer.toHexString(c.getInt(1)))
                        + " display=" + Integer.toHexString(c.getInt(2));
            }
        }
        return n + "/" + items.length() + " with colour; first: " + seen;
    }

    void clear() {
        for (String name : new String[]{OrosAccount.NAME, FEEDS}) {
            long cal = findCalendar(name);
            if (cal >= 0) cr.delete(ContentUris.withAppendedId(sa(Calendars.CONTENT_URI), cal), null, null);
        }
    }

    /**
     * What the person changed in the "orOS" calendar on the phone (rows
     * marked DIRTY by Android: new, edited, deleted, and edited or
     * cancelled occurrences of a series). ref = "r" + row id.
     */
    JSONArray changes() throws Exception {
        JSONArray out = new JSONArray();
        long cal = findCalendar(OrosAccount.NAME);
        if (cal < 0) return out;
        String[] cols = {Events._ID, Events._SYNC_ID, Events.DELETED, Events.TITLE, Events.DESCRIPTION,
                Events.EVENT_LOCATION, Events.ALL_DAY, Events.DTSTART, Events.DTEND, Events.DURATION,
                Events.RRULE, Events.EXDATE, Events.ORIGINAL_SYNC_ID, Events.ORIGINAL_INSTANCE_TIME,
                Events.STATUS, Events.HAS_ALARM};
        try (Cursor c = cr.query(sa(Events.CONTENT_URI), cols,
                Events.CALENDAR_ID + "=? AND " + Events.DIRTY + "!=0", new String[]{String.valueOf(cal)}, null)) {
            while (c != null && c.moveToNext() && out.length() < 500) {
                JSONObject o = new JSONObject();
                long row = c.getLong(0);
                o.put("ref", "r" + row);
                o.put("id", c.isNull(1) ? JSONObject.NULL : c.getString(1));
                o.put("op", c.getInt(2) != 0 ? "delete" : "upsert");
                o.put("title", nz(c.getString(3)));
                o.put("desc", nz(c.getString(4)));
                o.put("loc", nz(c.getString(5)));
                o.put("allDay", c.getInt(6) != 0);
                o.put("dtstart", c.getLong(7));
                o.put("dtend", c.isNull(8) ? 0 : c.getLong(8));
                o.put("duration", nz(c.getString(9)));
                o.put("rrule", nz(c.getString(10)));
                o.put("exdate", nz(c.getString(11)));
                if (!c.isNull(12)) {
                    JSONObject orig = new JSONObject();
                    orig.put("id", c.getString(12));
                    orig.put("at", c.getLong(13));
                    o.put("orig", orig);
                }
                o.put("cancelled", !c.isNull(14) && c.getInt(14) == Events.STATUS_CANCELED);
                o.put("remind", c.getInt(15) != 0 ? reminder(row) : -1);
                out.put(o);
            }
        }
        return out;
    }

    private static String nz(String s) { return s == null ? "" : s; }

    private int reminder(long event) {
        try (Cursor c = cr.query(Reminders.CONTENT_URI, new String[]{Reminders.MINUTES},
                Reminders.EVENT_ID + "=?", new String[]{String.valueOf(event)}, Reminders.MINUTES)) {
            return c != null && c.moveToFirst() ? c.getInt(0) : -1;
        }
    }

    /**
     * The page took these changes. Rows it now owns under an orOS id
     * (new rows, occurrences, deletions) are removed here; the next
     * snapshot writes them back as orOS rows. Edited rows just turn
     * clean, and the snapshot rewrites them.
     */
    void ack(JSONArray refs) throws Exception {
        long cal = findCalendar(OrosAccount.NAME);
        if (cal < 0 || refs == null) return;
        ArrayList<ContentProviderOperation> ops = new ArrayList<>();
        for (int i = 0; i < refs.length(); i++) {
            String ref = refs.optString(i);
            if (!ref.matches("r\\d{1,18}")) continue;
            long row = Long.parseLong(ref.substring(1));
            Uri u = ContentUris.withAppendedId(sa(Events.CONTENT_URI), row);
            boolean keep = false;
            try (Cursor c = cr.query(u, new String[]{Events._SYNC_ID, Events.DELETED, Events.ORIGINAL_SYNC_ID, Events.CALENDAR_ID},
                    null, null, null)) {
                if (c == null || !c.moveToFirst() || c.getLong(3) != cal) continue;
                keep = !c.isNull(0) && c.getInt(1) == 0 && c.isNull(2);
            }
            if (keep) {
                ops.add(ContentProviderOperation.newUpdate(u).withValue(Events.DIRTY, 0).build());
            } else {
                ops.add(ContentProviderOperation.newDelete(u).build());
            }
        }
        if (!ops.isEmpty()) cr.applyBatch(CalendarContract.AUTHORITY, ops);
    }
}
