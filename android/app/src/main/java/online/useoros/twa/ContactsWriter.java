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
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * Mirrors the page's contact rows (phone.js contactRows) into the
 * "orOS" account: one raw contact per orOS contact, SOURCE_ID = orOS
 * id, SYNC1 = row hash. Unchanged rows are left alone, changed rows
 * get their data rebuilt, rows that left orOS are deleted. Returns
 * {added, updated, removed, kept}.
 *
 * v2: the rows are editable on the phone. Rows Android marked DIRTY
 * (edited, deleted, or new in the orOS account) are left alone by
 * apply() until the page has taken them (changes() → ack()).
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
        Set<String> pending = new HashSet<>();            // edited on the phone, not yet taken
        Uri raw = OrosAccount.asSyncAdapter(RawContacts.CONTENT_URI, acc);
        try (Cursor c = cr.query(raw, new String[]{RawContacts._ID, RawContacts.SOURCE_ID, RawContacts.SYNC1,
                        RawContacts.DIRTY, RawContacts.DELETED},
                RawContacts.ACCOUNT_TYPE + "=? AND " + RawContacts.ACCOUNT_NAME + "=?",
                new String[]{acc.type, acc.name}, null)) {
            while (c != null && c.moveToNext()) {
                String sid = c.getString(1);
                if (c.getInt(3) != 0) {
                    if (sid != null) pending.add(sid);
                    continue;
                }
                if (c.getInt(4) != 0) continue;
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
            if (pending.contains(id)) { rowId.remove(id); kept++; continue; }
            long[] have = rowId.remove(id);
            if (have != null && h.equals(rowHash.get(id))) { kept++; continue; }

            ArrayList<ContentProviderOperation> one = new ArrayList<>();
            if (have == null) {
                one.add(ContentProviderOperation.newInsert(raw)
                        .withValue(RawContacts.ACCOUNT_NAME, acc.name)
                        .withValue(RawContacts.ACCOUNT_TYPE, acc.type)
                        .withValue(RawContacts.SOURCE_ID, id)
                        .withValue(RawContacts.SYNC1, h)
                        .withValue(RawContacts.RAW_CONTACT_IS_READ_ONLY, 0)
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
                        .withValue(RawContacts.RAW_CONTACT_IS_READ_ONLY, 0)
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
                            .withValue(RawContacts.RAW_CONTACT_IS_READ_ONLY, 0)
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

    /**
     * What the person changed in the orOS account on the phone: raw
     * contacts Android marked DIRTY (edited, deleted, or new), as rows
     * in the page's contactRows format plus ref = "r" + row id + "v" +
     * version, id = SOURCE_ID (null for a new contact) and op.
     */
    JSONArray changes() throws Exception {
        JSONArray out = new JSONArray();
        Uri raw = OrosAccount.asSyncAdapter(RawContacts.CONTENT_URI, acc);
        try (Cursor c = cr.query(raw, new String[]{RawContacts._ID, RawContacts.SOURCE_ID, RawContacts.DELETED,
                        RawContacts.STARRED, RawContacts.VERSION},
                RawContacts.ACCOUNT_TYPE + "=? AND " + RawContacts.ACCOUNT_NAME + "=? AND " + RawContacts.DIRTY + "!=0",
                new String[]{acc.type, acc.name}, null)) {
            while (c != null && c.moveToNext() && out.length() < 200) {
                long rid = c.getLong(0);
                JSONObject o = new JSONObject();
                o.put("ref", "r" + rid + "v" + c.getLong(4));
                o.put("id", c.isNull(1) ? JSONObject.NULL : c.getString(1));
                if (c.getInt(2) != 0) {
                    o.put("op", "delete");
                } else {
                    o.put("op", "upsert");
                    o.put("starred", c.getInt(3) != 0);
                    readData(rid, o);
                }
                out.put(o);
            }
        }
        return out;
    }

    private void readData(long rid, JSONObject o) throws Exception {
        String[] cols = {Data.MIMETYPE, Data.DATA1, Data.DATA2, Data.DATA3, Data.DATA4, Data.DATA5,
                Data.DATA7, Data.DATA8, Data.DATA9, Data.DATA10, Data.DATA15};
        JSONArray phones = new JSONArray(), emails = new JSONArray(), addrs = new JSONArray(),
                sites = new JSONArray(), events = new JSONArray();
        String given = "", middle = "", family = "", display = "", nick = "", org = "", title = "", note = "", photo = null;
        try (Cursor d = cr.query(OrosAccount.asSyncAdapter(Data.CONTENT_URI, acc), cols,
                Data.RAW_CONTACT_ID + "=?", new String[]{String.valueOf(rid)}, Data._ID)) {
            while (d != null && d.moveToNext()) {
                String mime = d.getString(0);
                if (mime == null) continue;
                switch (mime) {
                    case StructuredName.CONTENT_ITEM_TYPE:
                        display = nz(d.getString(1));
                        given = nz(d.getString(2));
                        family = nz(d.getString(3));
                        middle = nz(d.getString(5));
                        break;
                    case Nickname.CONTENT_ITEM_TYPE:
                        if (nick.isEmpty()) nick = nz(d.getString(1));
                        break;
                    case Organization.CONTENT_ITEM_TYPE:
                        if (org.isEmpty() && title.isEmpty()) { org = nz(d.getString(1)); title = nz(d.getString(4)); }
                        break;
                    case Phone.CONTENT_ITEM_TYPE:
                        if (!nz(d.getString(1)).isEmpty())
                            phones.put(new JSONObject().put("v", d.getString(1)).put("t", phoneName(d.getInt(2))));
                        break;
                    case Email.CONTENT_ITEM_TYPE:
                        if (!nz(d.getString(1)).isEmpty())
                            emails.put(new JSONObject().put("v", d.getString(1)).put("t", emailName(d.getInt(2))));
                        break;
                    case StructuredPostal.CONTENT_ITEM_TYPE: {
                        JSONObject a = new JSONObject();
                        String street = nz(d.getString(4)), city = nz(d.getString(6)), region = nz(d.getString(7)),
                                zip = nz(d.getString(8)), country = nz(d.getString(9));
                        // Typed as one line only: keep it as the street.
                        if ((street + city + region + zip + country).isEmpty()) street = nz(d.getString(1));
                        a.put("street", street).put("city", city).put("region", region).put("zip", zip)
                                .put("country", country).put("t", postalName(d.getInt(2)));
                        addrs.put(a);
                        break;
                    }
                    case Website.CONTENT_ITEM_TYPE:
                        if (!nz(d.getString(1)).isEmpty()) sites.put(d.getString(1));
                        break;
                    case Event.CONTENT_ITEM_TYPE: {
                        int type = d.getInt(2);
                        String t = type == Event.TYPE_BIRTHDAY ? "birthday" : type == Event.TYPE_ANNIVERSARY ? "anniversary" : "other";
                        events.put(new JSONObject().put("t", t).put("d", nz(d.getString(1)))
                                .put("label", type == Event.TYPE_CUSTOM ? nz(d.getString(3)) : ""));
                        break;
                    }
                    case Note.CONTENT_ITEM_TYPE:
                        if (note.isEmpty()) note = nz(d.getString(1));
                        break;
                    case Photo.CONTENT_ITEM_TYPE: {
                        byte[] b = d.getBlob(10);
                        if (b != null && b.length > 0 && b.length <= 37000) photo = Base64.encodeToString(b, Base64.NO_WRAP);
                        break;
                    }
                    default:
                }
            }
        }
        // A name typed as one line, not split by the provider.
        if (given.isEmpty() && middle.isEmpty() && family.isEmpty() && !display.isEmpty()) given = display;
        o.put("given", given).put("middle", middle).put("family", family).put("nickname", nick)
                .put("org", org).put("title", title).put("note", note)
                .put("phones", phones).put("emails", emails).put("addresses", addrs)
                .put("websites", sites).put("events", events)
                .put("photo", photo == null ? JSONObject.NULL : photo);
    }

    /**
     * The page took these changes. ids maps the ref of a new contact
     * to the orOS id it got, which becomes its SOURCE_ID. Rows deleted
     * on the phone are removed for good; the others turn clean with no
     * hash, so the next snapshot rewrites them as orOS stores them. A
     * row edited again since changes() (other version) stays dirty and
     * is sent again.
     */
    void ack(JSONArray refs, JSONObject ids) throws Exception {
        if (refs == null) return;
        ArrayList<ContentProviderOperation> ops = new ArrayList<>();
        for (int i = 0; i < refs.length(); i++) {
            String ref = refs.optString(i);
            if (!ref.matches("r\\d{1,18}v\\d{1,18}")) continue;
            int v = ref.indexOf('v');
            long rid = Long.parseLong(ref.substring(1, v));
            long ver = Long.parseLong(ref.substring(v + 1));
            Uri u = OrosAccount.asSyncAdapter(android.content.ContentUris.withAppendedId(RawContacts.CONTENT_URI, rid), acc);
            String newId = ids == null ? "" : ids.optString(ref);
            if (newId.length() > 64) newId = "";
            try (Cursor c = cr.query(u, new String[]{RawContacts.SOURCE_ID, RawContacts.DELETED, RawContacts.VERSION,
                    RawContacts.ACCOUNT_TYPE, RawContacts.ACCOUNT_NAME}, null, null, null)) {
                if (c == null || !c.moveToFirst() || !acc.type.equals(c.getString(3)) || !acc.name.equals(c.getString(4))) continue;
                boolean same = c.getLong(2) == ver;
                if (c.getInt(1) != 0) {
                    if (same) ops.add(ContentProviderOperation.newDelete(u).build());
                    continue;
                }
                ContentProviderOperation.Builder b = ContentProviderOperation.newUpdate(u);
                if (c.isNull(0) && !newId.isEmpty()) b.withValue(RawContacts.SOURCE_ID, newId);
                else if (!same) continue;
                if (same) b.withValue(RawContacts.DIRTY, 0).withValue(RawContacts.SYNC1, null);
                ops.add(b.build());
            }
        }
        if (!ops.isEmpty()) cr.applyBatch(ContactsContract.AUTHORITY, ops);
    }

    private static String nz(String s) { return s == null ? "" : s; }

    private static String phoneName(int t) {
        switch (t) {
            case Phone.TYPE_MOBILE: return "mobile";
            case Phone.TYPE_HOME: return "home";
            case Phone.TYPE_WORK: case Phone.TYPE_WORK_MOBILE: return "work";
            case Phone.TYPE_MAIN: return "main";
            default: return "other";
        }
    }

    private static String emailName(int t) {
        return t == Email.TYPE_HOME ? "home" : t == Email.TYPE_WORK ? "work" : "other";
    }

    private static String postalName(int t) {
        return t == StructuredPostal.TYPE_HOME ? "home" : t == StructuredPostal.TYPE_WORK ? "work" : "other";
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
