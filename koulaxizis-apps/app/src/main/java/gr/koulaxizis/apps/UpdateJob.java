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
import android.net.ConnectivityManager;
import android.os.Build;
import android.os.SystemClock;

import java.util.ArrayList;
import java.util.List;

/**
 * The daily check (APPS-M2): about twice a day, with a network and enough
 * battery, read the repositories and, when updates wait, show one quiet
 * notification. A new set of updates is announced at once; the same set
 * again only after {@link Updates#AGAIN}, so a person who saw them on the
 * screen and left them is reminded, not nagged. With automatic updates
 * (APPS-M6, off by default, menu) it first installs, on Wi-Fi or another
 * unmetered network, the updates that need no question ({@link Quiet#auto});
 * the rest stay in the notice. The manager never updates itself this way.
 */
public final class UpdateJob extends JobService {
    private static final int JOB = 1;
    private static final long HOUR = 60L * 60 * 1000;
    static final long PERIOD = 12 * HOUR;
    static final String CHANNEL = "updates";
    private static final int NOTE = 1;

    private volatile Thread running;

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences("settings", Context.MODE_PRIVATE);
    }

    static boolean enabled(Context ctx) {
        return prefs(ctx).getBoolean("daily", true);
    }

    /** Automatic updates (APPS-M6): off until the person turns them on; they need the daily check. */
    static boolean auto(Context ctx) {
        return enabled(ctx) && prefs(ctx).getBoolean("auto", false);
    }

    /** How long the daily check waits for one automatic update. */
    private static final long AUTO_WAIT = 3L * 60 * 1000;

    /** Puts the daily check in place, or takes it away when it is off. */
    static void schedule(Context ctx) {
        JobScheduler js = ctx.getSystemService(JobScheduler.class);
        if (js == null) return;
        if (!enabled(ctx)) {
            js.cancel(JOB);
            return;
        }
        channel(ctx); // listed in Android's settings from the first start
        JobInfo old = js.getPendingJob(JOB);
        if (old != null && old.getIntervalMillis() == PERIOD) return;
        try {
            schedule(ctx, js);
        } catch (RuntimeException e) {
            // Refused by this Android: the screen and the manual check still work.
        }
    }

    private static void schedule(Context ctx, JobScheduler js) {
        js.schedule(new JobInfo.Builder(JOB, new ComponentName(ctx, UpdateJob.class))
            .setPeriodic(PERIOD, 4 * HOUR)
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
        return false; // the next run is soon enough
    }

    static void check(Context ctx) {
        Catalog c = new Catalog(ctx);
        c.loadCached();
        c.refresh();
        List<AppInfo> list = Updates.pending(Source.ALL, c.apps, pkg -> Installed.of(ctx.getPackageManager(), pkg));
        if (!list.isEmpty() && auto(ctx) && !metered(ctx)) {
            autoUpdate(ctx, list);
            list = Updates.pending(Source.ALL, c.apps, pkg -> Installed.of(ctx.getPackageManager(), pkg));
        }
        AppInfo self = Updates.self(c.self, ctx.getPackageName().equals(Catalog.OWN)
            ? Installed.of(ctx.getPackageManager(), Catalog.OWN) : null);
        announce(ctx, list, self, true);
    }

    private static boolean metered(Context ctx) {
        ConnectivityManager cm = ctx.getSystemService(ConnectivityManager.class);
        return cm == null || cm.isActiveNetworkMetered();
    }

    /** One update after the other, each only when no question can come; stops when the job is stopped. */
    private static void autoUpdate(Context ctx, List<AppInfo> list) {
        boolean may = Build.VERSION.SDK_INT >= 31 && ctx.getPackageManager().canRequestPackageInstalls();
        for (AppInfo a : new ArrayList<>(list)) {
            if (Thread.currentThread().isInterrupted()) return;
            boolean shizuku = Silent.ready(ctx);
            if (!Quiet.auto(Installer.quiet(ctx, a.pkg), shizuku, may)) continue;
            int session;
            try {
                session = Installer.install(ctx, a, true);
            } catch (RepoException e) {
                continue; // the notice still names it
            }
            if (session == Installer.SILENT) continue;
            long until = SystemClock.elapsedRealtime() + AUTO_WAIT;
            while (SystemClock.elapsedRealtime() < until) {
                int s = Installed.state(Installed.of(ctx.getPackageManager(), a.pkg), a);
                if (s == Installed.CURRENT || s == Installed.NEWER) break;
                if (Installer.progress(ctx, session) < 0) break; // Android finished or dropped it
                try {
                    Thread.sleep(2000);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
            int s = Installed.state(Installed.of(ctx.getPackageManager(), a.pkg), a);
            if (s != Installed.CURRENT && s != Installed.NEWER) Installer.abandon(ctx, session); // left for the notice
        }
    }

    /** The quiet channel of the notice (created once, kept by Android). */
    static void channel(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        nm.createNotificationChannel(new NotificationChannel(CHANNEL,
            ctx.getString(R.string.channel_updates), NotificationManager.IMPORTANCE_LOW));
    }

    /** False when this app's notices, or its updates channel, are turned off. */
    static boolean canNotify(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || !nm.areNotificationsEnabled()) return false;
        NotificationChannel ch = nm.getNotificationChannel(CHANNEL);
        return ch == null || ch.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    /**
     * One notification for the updates that wait; none (and the old one
     * gone) when there are none. With post false (the screen is showing
     * them) only the notice goes away: the screen does not count as told,
     * so the daily check still reminds about updates that were left
     * (Chris 2026-11-19: no notices at all while he opened the app often).
     */
    static void announce(Context ctx, List<AppInfo> list, AppInfo self, boolean post) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        int n = list.size() + (self == null ? 0 : 1);
        SharedPreferences p = prefs(ctx);
        String key = Updates.key(list, self);
        if (n == 0) {
            nm.cancel(NOTE);
            p.edit().remove("announced").remove("announced_at").apply();
            return;
        }
        if (!post) {
            nm.cancel(NOTE);
            return;
        }
        if (!Updates.due(key, p.getString("announced", ""), p.getLong("announced_at", 0), System.currentTimeMillis())) return;
        // Off for this app (or not allowed yet): nothing is marked as told.
        if (!canNotify(ctx)) return;
        channel(ctx);
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
            p.edit().putString("announced", key).putLong("announced_at", System.currentTimeMillis()).apply();
        } catch (SecurityException e) {
            // Not allowed after all: the screen still shows the updates.
        }
    }
}
