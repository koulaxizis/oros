package net.glarolykoi.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.text.Html;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * New in the shop (GL-NEW), without Firebase or any push service: once a
 * day, when there is a network, the phone asks the shop's public
 * WooCommerce Store API for its newest items and shows one notification
 * for what is new. Only when the person said yes in the app; nothing is
 * sent about them, the request is the same for everyone.
 */
public class ReleaseJob extends JobService {
    static final String PREFS = "glarolykoi";
    static final String KEY_ON = "notify";
    static final String KEY_ASKED = "notifyAsked";
    static final String KEY_LAST = "lastSeen";
    private static final int JOB_ID = 1;
    private static final String CHANNEL = "new";
    /** Only the house's own titles (brand «glarolykoi»), not other publishers or goods (1.0.1). */
    private static final String FEED = Links.HOME
        + "wp-json/wc/store/v1/products?orderby=date&order=desc&per_page=10&brand=glarolykoi&_fields=id,name,permalink";
    private static final String SHOP_NEWEST = Links.HOME + "brand/glarolykoi/?orderby=date";
    private static final int MAX_BYTES = 512 * 1024;

    private volatile Thread worker;

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Daily check on, if the person said yes; safe to call every start. */
    static void schedule(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js == null) return;
        if (!prefs(c).getBoolean(KEY_ON, false)) {
            js.cancel(JOB_ID);
            return;
        }
        if (js.getPendingJob(JOB_ID) != null) return;
        js.schedule(new JobInfo.Builder(JOB_ID, new ComponentName(c, ReleaseJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(24L * 60 * 60 * 1000)
                .setPersisted(true)
                .build());
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        worker = new Thread(() -> {
            try {
                check(this);
            } catch (Exception e) {
                // No network or a bad answer: the next day tries again.
            }
            jobFinished(params, false);
        }, "glarolykoi-new");
        worker.start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        Thread t = worker;
        if (t != null) t.interrupt();
        return false;
    }

    static void check(Context c) throws Exception {
        SharedPreferences p = prefs(c);
        if (!p.getBoolean(KEY_ON, false)) return;
        List<Releases.Item> items = parse(fetch(FEED));
        long last = p.getLong(KEY_LAST, Releases.NONE);
        List<Releases.Item> fresh = Releases.fresh(items, last);
        p.edit().putLong(KEY_LAST, Releases.newest(items, last)).apply();
        if (!fresh.isEmpty()) notify(c, fresh);
    }

    private static String fetch(String url) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        try {
            h.setConnectTimeout(15000);
            h.setReadTimeout(15000);
            h.setInstanceFollowRedirects(false);
            h.setRequestProperty("Accept", "application/json");
            h.setRequestProperty("User-Agent", "GlarolykoiApp/" + BuildConfig.VERSION_NAME);
            if (h.getResponseCode() != 200) throw new Exception("HTTP " + h.getResponseCode());
            try (InputStream in = h.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    if (out.size() > MAX_BYTES) throw new Exception("too large");
                }
                return out.toString("UTF-8");
            }
        } finally {
            h.disconnect();
        }
    }

    private static List<Releases.Item> parse(String json) throws Exception {
        JSONArray a = new JSONArray(json);
        List<Releases.Item> out = new ArrayList<>();
        for (int i = 0; i < a.length() && i < 50; i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null) continue;
            long id = o.optLong("id", -1);
            String url = o.optString("permalink", null);
            String name = Html.fromHtml(o.optString("name", ""), Html.FROM_HTML_MODE_LEGACY).toString().trim();
            if (id <= 0 || !Releases.safeUrl(url)) continue;
            if (name.length() > 120) name = name.substring(0, 120) + "…";
            out.add(new Releases.Item(id, name, url));
        }
        return out;
    }

    private static void notify(Context c, List<Releases.Item> fresh) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || !nm.areNotificationsEnabled()) return;
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL,
                    c.getString(R.string.channel_new), NotificationManager.IMPORTANCE_DEFAULT));
        }
        boolean one = fresh.size() == 1;
        String title = one ? c.getString(R.string.new_one) : c.getString(R.string.new_many, fresh.size());
        StringBuilder text = new StringBuilder();
        for (int i = 0; i < fresh.size() && i < 5; i++) {
            if (i > 0) text.append(" · ");
            text.append(fresh.get(i).name);
        }
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(one ? fresh.get(0).url : SHOP_NEWEST),
                c, MainActivity.class);
        PendingIntent tap = PendingIntent.getActivity(c, 0, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setContentIntent(tap)
                .setAutoCancel(true);
        nm.notify(1, b.build());
    }
}
