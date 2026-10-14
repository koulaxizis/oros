package online.useoros.twa;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.CalendarContract;
import android.provider.ContactsContract;
import android.provider.ContactsContract.CommonDataKinds;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * "Add to orOS" from other apps (BR-PHONE v2): Android's "add event"
 * (calendar INSERT), "add contact" (contacts INSERT / INSERT_OR_EDIT,
 * e.g. after a call or from a messenger) and opening a .ics / .vcf.
 * Turns the request into /?phone-add=<json> and opens orOS there
 * (phone.js hands it to Calendar or Contacts, which ask before saving).
 * Shows nothing of its own.
 */
public class AddActivity extends Activity {
    private static final int MAX_TEXT = 200_000;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        JSONObject add = null;
        try {
            add = read(getIntent());
        } catch (Exception ignored) {
        }
        if (add == null) {
            Toast.makeText(this, R.string.add_failed, Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        Uri url = Uri.parse(getString(R.string.launchUrl)).buildUpon()
                .appendQueryParameter("phone-add", add.toString()).build();
        Intent open = new Intent(this, LauncherActivity.class);
        open.setAction(Intent.ACTION_VIEW);
        open.setData(url);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(open);
        finish();
    }

    private JSONObject read(Intent in) throws Exception {
        String action = in.getAction();
        String type = in.getType();
        if (type == null && in.getData() != null) type = getContentResolver().getType(in.getData());
        type = type == null ? "" : type.toLowerCase(Locale.ROOT);
        if (Intent.ACTION_VIEW.equals(action) && in.getData() != null) {
            boolean ics = type.contains("calendar") || type.equals("application/ics");
            String text = readText(in.getData());
            if (text == null) return null;
            JSONObject o = new JSONObject();
            o.put("k", ics ? "ics" : "vcf");
            o.put("name", ics ? "event.ics" : "contact.vcf");
            o.put("text", text);
            return o;
        }
        if (type.endsWith("/event")) return event(in);
        return contact(in);
    }

    private String readText(Uri uri) throws Exception {
        try (InputStream is = getContentResolver().openInputStream(uri)) {
            if (is == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > MAX_TEXT) return null;
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    /** Calendar INSERT extras → a new event in the phone's zone. */
    private JSONObject event(Intent in) throws Exception {
        long begin = in.getLongExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, System.currentTimeMillis());
        long end = in.getLongExtra(CalendarContract.EXTRA_EVENT_END_TIME, 0);
        boolean allDay = in.getBooleanExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, false);
        JSONObject o = new JSONObject();
        o.put("k", "event");
        o.put("title", str(in, CalendarContract.Events.TITLE));
        o.put("location", str(in, CalendarContract.Events.EVENT_LOCATION));
        o.put("note", str(in, CalendarContract.Events.DESCRIPTION));
        if (allDay) {
            // All-day times are UTC midnights by contract; some apps send
            // local midnights instead.
            TimeZone tz = utcMidnight(begin) ? TimeZone.getTimeZone("UTC") : TimeZone.getDefault();
            o.put("date", fmt("yyyy-MM-dd", begin, tz));
            if (end > begin + 86_400_000L) o.put("dateEnd", fmt("yyyy-MM-dd", end - 86_400_000L, tz));
        } else {
            TimeZone tz = TimeZone.getDefault();
            o.put("date", fmt("yyyy-MM-dd", begin, tz));
            o.put("start", fmt("HH:mm", begin, tz));
            if (end > begin) {
                String endDay = fmt("yyyy-MM-dd", end, tz);
                o.put("end", fmt("HH:mm", end, tz));
                if (!endDay.equals(o.getString("date"))) o.put("dateEnd", endDay);
            }
        }
        return o;
    }

    private static boolean utcMidnight(long ms) { return ms % 86_400_000L == 0; }

    private static String fmt(String pattern, long ms, TimeZone tz) {
        SimpleDateFormat f = new SimpleDateFormat(pattern, Locale.ROOT);
        f.setTimeZone(tz);
        return f.format(new Date(ms));
    }

    private static String str(Intent in, String key) {
        CharSequence s = in.getCharSequenceExtra(key);
        return s == null ? "" : s.toString().trim();
    }

    /** Contacts INSERT / INSERT_OR_EDIT extras → a one-contact vCard. */
    private JSONObject contact(Intent in) throws Exception {
        String name = str(in, ContactsContract.Intents.Insert.NAME);
        String org = str(in, ContactsContract.Intents.Insert.COMPANY);
        String title = str(in, ContactsContract.Intents.Insert.JOB_TITLE);
        String note = str(in, ContactsContract.Intents.Insert.NOTES);
        String postal = str(in, ContactsContract.Intents.Insert.POSTAL);
        ArrayList<String> phones = new ArrayList<>(), emails = new ArrayList<>();
        for (String k : new String[]{ContactsContract.Intents.Insert.PHONE, ContactsContract.Intents.Insert.SECONDARY_PHONE,
                ContactsContract.Intents.Insert.TERTIARY_PHONE}) {
            String v = str(in, k);
            if (!v.isEmpty()) phones.add(v);
        }
        for (String k : new String[]{ContactsContract.Intents.Insert.EMAIL, ContactsContract.Intents.Insert.SECONDARY_EMAIL,
                ContactsContract.Intents.Insert.TERTIARY_EMAIL}) {
            String v = str(in, k);
            if (!v.isEmpty()) emails.add(v);
        }
        // Insert.DATA: rows as ContentValues (some apps send only these).
        ArrayList<ContentValues> data = in.getParcelableArrayListExtra(ContactsContract.Intents.Insert.DATA);
        if (data != null) {
            for (ContentValues v : data) {
                String mime = v.getAsString(ContactsContract.Data.MIMETYPE);
                if (CommonDataKinds.Phone.CONTENT_ITEM_TYPE.equals(mime)) add(phones, v.getAsString(CommonDataKinds.Phone.NUMBER));
                else if (CommonDataKinds.Email.CONTENT_ITEM_TYPE.equals(mime)) add(emails, v.getAsString(CommonDataKinds.Email.ADDRESS));
                else if (CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE.equals(mime) && name.isEmpty()) {
                    String d = v.getAsString(CommonDataKinds.StructuredName.DISPLAY_NAME);
                    if (d != null) name = d.trim();
                } else if (CommonDataKinds.Organization.CONTENT_ITEM_TYPE.equals(mime) && org.isEmpty()) {
                    String d = v.getAsString(CommonDataKinds.Organization.COMPANY);
                    if (d != null) org = d.trim();
                }
            }
        }
        // INSERT_OR_EDIT from a dialer often carries the number as data.
        Uri u = in.getData();
        if (u != null && "tel".equals(u.getScheme())) add(phones, u.getSchemeSpecificPart());
        if (u != null && "mailto".equals(u.getScheme())) add(emails, u.getSchemeSpecificPart());
        if (name.isEmpty() && org.isEmpty() && phones.isEmpty() && emails.isEmpty()) return null;

        StringBuilder v = new StringBuilder("BEGIN:VCARD\r\nVERSION:3.0\r\n");
        String fn = !name.isEmpty() ? name : !org.isEmpty() ? org : !phones.isEmpty() ? phones.get(0) : emails.get(0);
        v.append("FN:").append(esc(fn)).append("\r\n");
        if (!name.isEmpty()) {
            int sp = name.lastIndexOf(' ');
            String given = sp > 0 ? name.substring(0, sp) : name, family = sp > 0 ? name.substring(sp + 1) : "";
            v.append("N:").append(esc(family)).append(';').append(esc(given)).append(";;;\r\n");
        }
        if (!org.isEmpty()) v.append("ORG:").append(esc(org)).append("\r\n");
        if (!title.isEmpty()) v.append("TITLE:").append(esc(title)).append("\r\n");
        for (String p : phones) v.append("TEL;TYPE=CELL:").append(esc(p)).append("\r\n");
        for (String e : emails) v.append("EMAIL;TYPE=HOME:").append(esc(e)).append("\r\n");
        if (!postal.isEmpty()) v.append("ADR;TYPE=HOME:;;").append(esc(postal)).append(";;;;\r\n");
        if (!note.isEmpty()) v.append("NOTE:").append(esc(note)).append("\r\n");
        v.append("END:VCARD\r\n");
        JSONObject o = new JSONObject();
        o.put("k", "vcf");
        o.put("name", "contact.vcf");
        o.put("text", v.toString());
        return o;
    }

    private static void add(ArrayList<String> list, String v) {
        if (v != null && !v.trim().isEmpty() && !list.contains(v.trim())) list.add(v.trim());
    }

    private static String esc(String s) {
        return s.replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n").replace("\r", "");
    }
}
