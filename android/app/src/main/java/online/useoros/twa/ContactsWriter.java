package online.useoros.twa;

import android.accounts.Account;
import android.content.ContentProviderOperation;
import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import android.provider.ContactsContract.CommonDataKinds.Email;
import android.provider.ContactsContract.CommonDataKinds.Event;
import android.provider.ContactsContract.CommonDataKinds.Nickname;
import android.provider.ContactsContract.CommonDataKinds.Note;
import android.provider.ContactsContract.CommonDataKinds.Organization;
import android.provider.ContactsContract.CommonDataKinds.Phone;
import android.provider.ContactsContract.CommonDataKinds.Photo;
import android.provider.ContactsContract.CommonDataKinds.StructuredName;
import android.provider.ContactsContract.CommonDataKinds.StructuredPostal;
import android.provider.ContactsContract.CommonDataKinds.Website;
import android.provider.ContactsContract.Data;
import android.provider.ContactsContract.RawContacts;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

/**
 * Mirrors the page's contact rows (phone.js contactRows) into the
 * "orOS" account: one read-only raw contact per orOS contact,
 * SOURCE_ID = orOS id, SYNC1 = row hash. Unchanged rows are left
 * alone, changed rows get their data rebuilt, rows that left orOS
 * are deleted. Returns {added, updated, removed, kept}.
 */
class ContactsWriter {
    private static final int BATCH = 300;

    private final ContentResolver cr;
    private final Account acc;

    ContactsWriter(Context c) {
        cr = c.getContentResolver();
        acc = OrosAccount.ensure(c);
    }

    int[] apply(JSONArray items) throws Exception {
        Map<String, long[]> rowId = new HashMap<>();      // source id → [raw id]
        Map<String, String> rowHash = new HashMap<>();
        Uri raw = OrosAccount.asSyncAdapter(RawContacts.CONTENT_URI, acc);
        try (Cursor c = cr.query(raw, new String[]{RawContacts._ID, RawContacts.SOURCE_ID, RawContacts.SYNC1},
                RawContacts.ACCOUNT_TYPE + "=? AND " + RawContacts.ACCOUNT_NAME + "=? AND " + RawContacts.DELETED + "=0",
                new String[]{acc.type, acc.name}, null)) {
            while (c != null && c.moveToNext()) {
                String sid = c.getString(1);
                if (sid == null || rowId.containsKey(sid)) {
                    // Stray or duplicate row: removed below.
                    sid = "\u0000" + c.getLong(0);
                }
                rowId.put(sid, new long[]{c.getLong(0)});
                rowHash.put(sid, c.getString(2));
            }
        }

        int added = 0, updated = 0, kept = 0;
        ArrayList<ContentProviderOperation> ops = new ArrayList<>();
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            if (it == null) continue;
            String id = it.optString("id");
            if (id.isEmpty() || id.length() > 64) continue;
            String h = it.optString("h");
            long[] have = rowId.remove(id);
            if (have != null && h.equals(rowHash.get(id))) { kept++; continue; }

            ArrayList<ContentProviderOperation> one = new ArrayList<>();
            if (have == null) {
                one.add(ContentProviderOperation.newInsert(raw)
                        .withValue(RawContacts.ACCOUNT_NAME, acc.name)
                        .withValue(RawContacts.ACCOUNT_TYPE, acc.type)
                        .withValue(RawContacts.SOURCE_ID, id)
                        .withValue(RawContacts.SYNC1, h)
                        .withValue(RawContacts.RAW_CONTACT_IS_READ_ONLY, 1)
                        .withValue(RawContacts.STARRED, it.optBoolean("starred") ? 1 : 0)
                        .build());
                addData(one, it, -1, ops.size());
                added++;
            } else {
                long rid = have[0];
                one.add(ContentProviderOperation.newDelete(OrosAccount.asSyncAdapter(Data.CONTENT_URI, acc))
                        .withSelection(Data.RAW_CONTACT_ID + "=?", new String[]{String.valueOf(rid)})
                        .build());
                one.add(ContentProviderOperation.newUpdate(OrosAccount.asSyncAdapter(
                                android.content.ContentUris.withAppendedId(RawContacts.CONTENT_URI, rid), acc))
                        .withValue(RawContacts.SYNC1, h)
                        .withValue(RawContacts.STARRED, it.optBoolean("starred") ? 1 : 0)
                        .build());
                addData(one, it, rid, 0);
                updated++;
            }
            if (ops.size() + one.size() > BATCH && !ops.isEmpty()) {
                cr.applyBatch(ContactsContract.AUTHORITY, ops);
                ops = new ArrayList<>();
                if (have == null) {   // back references were built for the old batch
                    one.clear();
                    one.add(ContentProviderOperation.newInsert(raw)
                            .withValue(RawContacts.ACCOUNT_NAME, acc.name)
                            .withValue(RawContacts.ACCOUNT_TYPE, acc.type)
                            .withValue(RawContacts.SOURCE_ID, id)
                            .withValue(RawContacts.SYNC1, h)
                            .withValue(RawContacts.RAW_CONTACT_IS_READ_ONLY, 1)
                            .withValue(RawContacts.STARRED, it.optBoolean("starred") ? 1 : 0)
                            .build());
                    addData(one, it, -1, 0);
                }
            }
            ops.addAll(one);
        }

        int removed = 0;
        for (long[] gone : rowId.values()) {
            ops.add(ContentProviderOperation.newDelete(OrosAccount.asSyncAdapter(
                    android.content.ContentUris.withAppendedId(RawContacts.CONTENT_URI, gone[0]), acc)).build());
            removed++;
            if (ops.size() >= BATCH) {
                cr.applyBatch(ContactsContract.AUTHORITY, ops);
                ops = new ArrayList<>();
            }
        }
        if (!ops.isEmpty()) cr.applyBatch(ContactsContract.AUTHORITY, ops);
        return new int[]{added, updated, removed, kept};
    }

    void clear() {
        cr.delete(OrosAccount.asSyncAdapter(RawContacts.CONTENT_URI, acc),
                RawContacts.ACCOUNT_TYPE + "=? AND " + RawContacts.ACCOUNT_NAME + "=?",
                new String[]{acc.type, acc.name});
    }

    /** Data rows for one contact. rid ≥ 0: existing raw contact; else a
     *  back reference to the insert at index backRef of the batch. */
    private void addData(ArrayList<ContentProviderOperation> out, JSONObject it, long rid, int backRef) {
        Uri data = OrosAccount.asSyncAdapter(Data.CONTENT_URI, acc);
        Row r = new Row(out, data, rid, backRef);

        String given = it.optString("given"), middle = it.optString("middle"), family = it.optString("family");
        String nick = it.optString("nickname"), org = it.optString("org"), title = it.optString("title");
        if (!given.isEmpty() || !middle.isEmpty() || !family.isEmpty()) {
            r.start(StructuredName.CONTENT_ITEM_TYPE)
                    .withValue(StructuredName.GIVEN_NAME, given)
                    .withValue(StructuredName.MIDDLE_NAME, middle)
                    .withValue(StructuredName.FAMILY_NAME, family);
            r.end();
        } else {
            String shown = !nick.isEmpty() ? nick : !org.isEmpty() ? org : firstValue(it.optJSONArray("phones"));
            if (!shown.isEmpty()) {
                r.start(StructuredName.CONTENT_ITEM_TYPE).withValue(StructuredName.DISPLAY_NAME, shown);
                r.end();
            }
        }
        if (!nick.isEmpty()) {
            r.start(Nickname.CONTENT_ITEM_TYPE).withValue(Nickname.NAME, nick);
            r.end();
        }
        if (!org.isEmpty() || !title.isEmpty()) {
            r.start(Organization.CONTENT_ITEM_TYPE).withValue(Organization.COMPANY, org).withValue(Organization.TITLE, title);
            r.end();
        }
        JSONArray phones = it.optJSONArray("phones");
        for (int i = 0; phones != null && i < phones.length(); i++) {
            JSONObject p = phones.optJSONObject(i);
            if (p == null || p.optString("v").isEmpty()) continue;
            r.start(Phone.CONTENT_ITEM_TYPE).withValue(Phone.NUMBER, p.optString("v")).withValue(Phone.TYPE, phoneType(p.optString("t")));
            r.end();
        }
        JSONArray emails = it.optJSONArray("emails");
        for (int i = 0; emails != null && i < emails.length(); i++) {
            JSONObject e = emails.optJSONObject(i);
            if (e == null || e.optString("v").isEmpty()) continue;
            r.start(Email.CONTENT_ITEM_TYPE).withValue(Email.ADDRESS, e.optString("v")).withValue(Email.TYPE, emailType(e.optString("t")));
            r.end();
        }
        JSONArray addrs = it.optJSONArray("addresses");
        for (int i = 0; addrs != null && i < addrs.length(); i++) {
            JSONObject a = addrs.optJSONObject(i);
            if (a == null) continue;
            r.start(StructuredPostal.CONTENT_ITEM_TYPE)
                    .withValue(StructuredPostal.STREET, a.optString("street"))
                    .withValue(StructuredPostal.CITY, a.optString("city"))
                    .withValue(StructuredPostal.REGION, a.optString("region"))
                    .withValue(StructuredPostal.POSTCODE, a.optString("zip"))
                    .withValue(StructuredPostal.COUNTRY, a.optString("country"))
                    .withValue(StructuredPostal.TYPE, postalType(a.optString("t")));
            r.end();
        }
        JSONArray sites = it.optJSONArray("websites");
        for (int i = 0; sites != null && i < sites.length(); i++) {
            String u = sites.optString(i);
            if (u.isEmpty()) continue;
            r.start(Website.CONTENT_ITEM_TYPE).withValue(Website.URL, u).withValue(Website.TYPE, Website.TYPE_OTHER);
            r.end();
        }
        JSONArray events = it.optJSONArray("events");
        for (int i = 0; events != null && i < events.length(); i++) {
            JSONObject e = events.optJSONObject(i);
            if (e == null || e.optString("d").isEmpty()) continue;
            String t = e.optString("t"), label = e.optString("label");
            ContentProviderOperation.Builder b = r.start(Event.CONTENT_ITEM_TYPE).withValue(Event.START_DATE, e.optString("d"));
            if ("birthday".equals(t)) b.withValue(Event.TYPE, Event.TYPE_BIRTHDAY);
            else if ("anniversary".equals(t)) b.withValue(Event.TYPE, Event.TYPE_ANNIVERSARY);
            else if (!label.isEmpty()) b.withValue(Event.TYPE, Event.TYPE_CUSTOM).withValue(Event.LABEL, label);
            else b.withValue(Event.TYPE, Event.TYPE_OTHER);
            r.end();
        }
        String note = it.optString("note");
        if (!note.isEmpty()) {
            r.start(Note.CONTENT_ITEM_TYPE).withValue(Note.NOTE, note);
            r.end();
        }
        String photo = it.optString("photo");
        if (!photo.isEmpty() && !"null".equals(photo)) {
            try {
                byte[] bytes = Base64.decode(photo, Base64.DEFAULT);
                r.start(Photo.CONTENT_ITEM_TYPE).withValue(Photo.PHOTO, bytes);
                r.end();
            } catch (IllegalArgumentException ignored) {
                // Not base64: no photo.
            }
        }
    }

    private static String firstValue(JSONArray a) {
        if (a == null) return "";
        JSONObject o = a.optJSONObject(0);
        return o == null ? "" : o.optString("v");
    }

    private static int phoneType(String t) {
        switch (t) {
            case "mobile": return Phone.TYPE_MOBILE;
            case "home": return Phone.TYPE_HOME;
            case "work": return Phone.TYPE_WORK;
            case "main": return Phone.TYPE_MAIN;
            default: return Phone.TYPE_OTHER;
        }
    }

    private static int emailType(String t) {
        switch (t) {
            case "home": return Email.TYPE_HOME;
            case "work": return Email.TYPE_WORK;
            default: return Email.TYPE_OTHER;
        }
    }

    private static int postalType(String t) {
        switch (t) {
            case "home": return StructuredPostal.TYPE_HOME;
            case "work": return StructuredPostal.TYPE_WORK;
            default: return StructuredPostal.TYPE_OTHER;
        }
    }

    /** Builds one Data insert at a time, tied to its raw contact. */
    private static final class Row {
        private final ArrayList<ContentProviderOperation> out;
        private final Uri uri;
        private final long rid;
        private final int backRef;
        private ContentProviderOperation.Builder b;

        Row(ArrayList<ContentProviderOperation> out, Uri uri, long rid, int backRef) {
            this.out = out;
            this.uri = uri;
            this.rid = rid;
            this.backRef = backRef;
        }

        ContentProviderOperation.Builder start(String mime) {
            b = ContentProviderOperation.newInsert(uri).withValue(Data.MIMETYPE, mime);
            if (rid >= 0) b.withValue(Data.RAW_CONTACT_ID, rid);
            else b.withValueBackReference(Data.RAW_CONTACT_ID, backRef);
            return b;
        }

        void end() {
            out.add(b.build());
        }
    }
}
