package gr.koulaxizis.apps;

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

import java.util.List;

/**
 * The daily check (APPS-M2): once a day, with a network and enough
 * battery, read the repositories and, when there are new updates, show one
 * quiet notification. It never installs anything by itself, and the same
 * updates are announced only once.
 */
public final class UpdateJob extends JobService {
    private static final int JOB = 1;
    private static final long DAY = 24L * 60 * 60 * 1000;
    static final String CHANNEL = "updates";
    private static final int NOTE = 1;

    private volatile Thread running;

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences("settings", Context.MODE_PRIVATE);
    }

    static boolean enabled(Context ctx) {
        return prefs(ctx).getBoolean("daily", true);
    }

    /** Puts the daily check in place, or takes it away when it is off. */
    static void schedule(Context ctx) {
        JobScheduler js = ctx.getSystemService(JobScheduler.class);
        if (js == null) return;
        if (!enabled(ctx)) {
            js.cancel(JOB);
            return;
        }
        if (js.getPendingJob(JOB) != null) return;
        js.schedule(new JobInfo.Builder(JOB, new ComponentName(ctx, UpdateJob.class))
            .setPeriodic(DAY, DAY / 4)
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setRequiresBatteryNotLow(true)
            .setPersisted(true)
            .build());
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        Thread t = new Thread(() -> {
            check(getApplicationContext());
            jobFinished(params, false);
        }, "daily-check");
        running = t;
        t.start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        Thread t = running;
        if (t != null) t.interrupt();
        return false; // tomorrow's run is soon enough
    }

    static void check(Context ctx) {
        Catalog c = new Catalog(ctx);
        c.loadCached();
        c.refresh();
        List<AppInfo> list = Updates.pending(Source.ALL, c.apps, pkg -> Installed.of(ctx.getPackageManager(), pkg));
        AppInfo self = Updates.self(c.self, ctx.getPackageName().equals(Catalog.OWN)
            ? Installed.of(ctx.getPackageManager(), Catalog.OWN) : null);
        announce(ctx, list, self, true);
    }

    /**
     * One notification for a new set of updates; none (and the old one gone)
     * when there are none. With post false (the screen is showing them) the
     * set only counts as told, so it is not announced again later.
     */
    static void announce(Context ctx, List<AppInfo> list, AppInfo self, boolean post) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        int n = list.size() + (self == null ? 0 : 1);
        SharedPreferences p = prefs(ctx);
        String key = Updates.key(list, self);
        if (n == 0) {
            nm.cancel(NOTE);
            p.edit().remove("announced").apply();
            return;
        }
        if (!post) {
            nm.cancel(NOTE);
            p.edit().putString("announced", key).apply();
            return;
        }
        // Off for this app (or not allowed yet): nothing is marked as told.
        if (!nm.areNotificationsEnabled() || key.equals(p.getString("announced", ""))) return;
        nm.createNotificationChannel(new NotificationChannel(CHANNEL,
            ctx.getString(R.string.channel_updates), NotificationManager.IMPORTANCE_LOW));
        StringBuilder names = new StringBuilder();
        if (self != null) names.append(ctx.getString(R.string.app_name));
        for (AppInfo a : list) {
            if (names.length() > 0) names.append(", ");
            names.append(a.name);
        }
        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent tap = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE);
        Notification note = new Notification.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_update)
            .setContentTitle(ctx.getResources().getQuantityString(R.plurals.updates_ready, n, n))
            .setContentText(names)
            .setStyle(new Notification.BigTextStyle().bigText(names))
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build();
        try {
            nm.notify(NOTE, note);
            p.edit().putString("announced", key).apply();
        } catch (SecurityException e) {
            // Not allowed after all: the screen still shows the updates.
        }
    }
}
