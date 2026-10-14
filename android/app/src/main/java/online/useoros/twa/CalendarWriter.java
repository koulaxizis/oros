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
 * Mirrors the page's event rows (phone.js eventRows) into one
 * read-only "orOS" calendar of the account: _SYNC_ID = orOS id,
 * SYNC_DATA1 = row hash. Same diff as ContactsWriter.
 * Returns {added, updated, removed, kept}.
 */
class CalendarWriter {
    private static final int BATCH = 300;
    private static final int COLOR = 0xFFD4AF37;

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

    private long findCalendar() {
        try (Cursor c = cr.query(Calendars.CONTENT_URI, new String[]{Calendars._ID},
                Calendars.ACCOUNT_TYPE + "=? AND " + Calendars.ACCOUNT_NAME + "=?",
                new String[]{acc.type, acc.name}, Calendars._ID)) {
            return c != null && c.moveToFirst() ? c.getLong(0) : -1;
        }
    }

    private long ensureCalendar() {
        long id = findCalendar();
        if (id >= 0) return id;
        ContentValues v = new ContentValues();
        v.put(Calendars.ACCOUNT_NAME, acc.name);
        v.put(Calendars.ACCOUNT_TYPE, acc.type);
        v.put(Calendars.NAME, OrosAccount.NAME);
        v.put(Calendars.CALENDAR_DISPLAY_NAME, ctx.getString(R.string.calendar_name));
        v.put(Calendars.CALENDAR_COLOR, COLOR);
        v.put(Calendars.CALENDAR_ACCESS_LEVEL, Calendars.CAL_ACCESS_READ);
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
        long cal = ensureCalendar();
        Map<String, Long> rowId = new HashMap<>();
        Map<String, String> rowHash = new HashMap<>();
        try (Cursor c = cr.query(sa(Events.CONTENT_URI), new String[]{Events._ID, Events._SYNC_ID, Events.SYNC_DATA1},
                Events.CALENDAR_ID + "=? AND " + Events.DELETED + "=0", new String[]{String.valueOf(cal)}, null)) {
            while (c != null && c.moveToNext()) {
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

    void clear() {
        long cal = findCalendar();
        if (cal >= 0) cr.delete(ContentUris.withAppendedId(sa(Calendars.CONTENT_URI), cal), null, null);
    }
}
