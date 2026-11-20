package gr.koulaxizis.apps;

import android.app.Activity;
import android.Manifest;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.text.format.DateFormat;
import android.text.format.Formatter;
import android.view.LayoutInflater;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Date;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The one screen: every project with its apps, each with Install, Update
 * or Open (APPS-M1). Lists come from the repositories' signed indexes,
 * first from the copy on the phone, then fresh from the network.
 * "Update all" updates one app after the other; the manager's own update
 * shows in its own bar (APPS-M2). Every install is watched while the
 * screen is in front ({@link Watch}): Android's question is shown only then,
 * shown again or offered again when an overlay took it away, and an app
 * never stays on "Working" (APPS-M2 fix 1.2.2).
 */
public final class MainActivity extends Activity implements InstallReceiver.Listener {
    private final ExecutorService work = Executors.newSingleThreadExecutor();
    /** One install the screen waits for (main thread only). */
    private static final class Job {
        final AppInfo app;
        /** PackageInstaller's session, -1 while the APK is still downloading. */
        int session = -1;
        /** Android's question, while it waits for a yes. */
        Intent confirm;
        boolean shown;
        /** When the phase last changed (elapsedRealtime). */
        long since = SystemClock.elapsedRealtime();

        Job(AppInfo app) { this.app = app; }
    }

    /** The apps being installed, by package. */
    private final Map<String, Job> busy = new LinkedHashMap<>();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable tick = this::look;
    /** Since when the screen is in front (elapsedRealtime), -1 while it is not. */
    private long frontAt = -1;
    /** Our own "the question closed" dialog, at most one. */
    private AlertDialog asking;
    private Job askingFor;
    private List<Rows.Row> rows = new ArrayList<>();
    /** Updates waiting their turn after "Update all" (main thread only). */
    private final Deque<AppInfo> queue = new ArrayDeque<>();
    private List<AppInfo> pending = new ArrayList<>();
    /** The manager as the repositories offer it, and that offer when it is newer than this copy. */
    private AppInfo self, mine;
    private Button updateAll;
    private View selfBar, notesBar;
    private Catalog catalog;
    private Icons icons;
    private TextView status;
    private Adapter adapter;
    private boolean refreshing;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.main);
        status = findViewById(R.id.status);
        updateAll = findViewById(R.id.update_all);
        updateAll.setOnClickListener(v -> updateAll());
        selfBar = findViewById(R.id.self_bar);
        notesBar = findViewById(R.id.notes_bar);
        findViewById(R.id.notes_on).setOnClickListener(v -> openNoticeSettings());
        findViewById(R.id.self_update).setOnClickListener(v -> {
            if (mine != null) act(mine, Installed.UPDATE);
        });
        ListView list = findViewById(R.id.list);
        adapter = new Adapter();
        list.setAdapter(adapter);
        catalog = new Catalog(this);
        icons = new Icons(this);
        // Set for the screen's whole life: results arrive while Android's
        // own question is on top and this screen is paused.
        InstallReceiver.listener = this;
        UpdateJob.schedule(this);
        askNotificationsOnce();
        refresh(true);
    }

    @Override
    protected void onResume() {
        super.onResume();
        frontAt = SystemClock.elapsedRealtime();
        schedule();
        updateBars(); // installed versions may have changed
        updateNotesBar(); // notices may have been turned on in Android's settings
        adapter.notifyDataSetChanged();
    }

    @Override
    protected void onPause() {
        frontAt = -1;
        ui.removeCallbacks(tick);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        if (asking != null) asking.dismiss();
        if (InstallReceiver.listener == this) InstallReceiver.listener = null;
        work.shutdown();
        super.onDestroy();
    }

    /** Shown while the daily check is on but its notices cannot appear. */
    private void updateNotesBar() {
        notesBar.setVisibility(UpdateJob.enabled(this) && !UpdateJob.canNotify(this) ? View.VISIBLE : View.GONE);
    }

    /** Android's notification page of this app (its own switch and the updates channel). */
    private void openNoticeSettings() {
        Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
        try {
            startActivity(i);
        } catch (android.content.ActivityNotFoundException e) {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        updateNotesBar();
    }

    /** Android 13+: asked once, for the daily check's notice; a no is kept. */
    private void askNotificationsOnce() {
        if (android.os.Build.VERSION.SDK_INT < 33 || !UpdateJob.enabled(this)) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        if (UpdateJob.prefs(this).getBoolean("asked_notes", false)) return;
        UpdateJob.prefs(this).edit().putBoolean("asked_notes", true).apply();
        requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, 1);
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.main, menu);
        menu.findItem(R.id.daily).setChecked(UpdateJob.enabled(this));
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == R.id.refresh) {
            refresh(false);
            return true;
        }
        if (item.getItemId() == R.id.daily) {
            boolean on = !item.isChecked();
            item.setChecked(on);
            UpdateJob.prefs(this).edit().putBoolean("daily", on).apply();
            UpdateJob.schedule(this);
            if (on) askNotificationsOnce();
            updateNotesBar();
            return true;
        }
        if (item.getItemId() == R.id.support) {
            // SUP-1: the shared support page of all the projects (merch, a
            // one-time donation, services), a plain link in the browser.
            // The page speaks Greek and English.
            String url = "https://koulaxizis.gr/support/?lang="
                    + ("el".equals(Locale.getDefault().getLanguage()) ? "el" : "en");
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (android.content.ActivityNotFoundException e) {
                Toast.makeText(this, url, Toast.LENGTH_LONG).show();
            }
            return true;
        }
        return super.onOptionsItemSelected(item);
    }

    private void refresh(boolean first) {
        if (refreshing) return;
        refreshing = true;
        status.setText(R.string.checking);
        work.execute(() -> {
            // The catalog is only touched on this thread; the screen gets copies.
            if (first) {
                catalog.loadCached();
                List<Rows.Row> cached = build();
                long at = catalog.checkedAt;
                AppInfo me = catalog.self;
                runOnUiThread(() -> show(cached, at, me));
            }
            catalog.refresh();
            List<Rows.Row> fresh = build();
            long at = catalog.checkedAt;
            AppInfo me = catalog.self;
            runOnUiThread(() -> {
                refreshing = false;
                show(fresh, at, me);
                // What the screen shows counts as told: no notice for it later.
                UpdateJob.announce(this, pending, mine, false);
            });
        });
    }

    private List<Rows.Row> build() {
        return Rows.build(Source.ALL, catalog.apps, catalog.errors, Locale.getDefault());
    }

    private void show(List<Rows.Row> next, long checkedAt, AppInfo me) {
        rows = next;
        self = me;
        updateBars();
        adapter.notifyDataSetChanged();
        if (refreshing) {
            status.setText(R.string.checking);
        } else if (checkedAt > 0) {
            String when = DateFormat.getMediumDateFormat(this).format(new Date(checkedAt)) + " "
                + DateFormat.getTimeFormat(this).format(new Date(checkedAt));
            status.setText(getString(R.string.repos_from, when));
        } else {
            status.setText(R.string.no_list);
        }
    }

    /** The "Update all" button and the manager's own bar, from what the phone has now. */
    private void updateBars() {
        List<AppInfo> offers = new ArrayList<>();
        for (Rows.Row r : rows) if (r.app != null) offers.add(r.app);
        pending = Updates.pending(offers, pkg -> Installed.of(getPackageManager(), pkg));
        int waiting = 0;
        for (AppInfo a : pending) if (!busy.containsKey(a.pkg)) waiting++;
        if (pending.size() >= 2) {
            updateAll.setVisibility(View.VISIBLE);
            updateAll.setText(getResources().getQuantityString(R.plurals.update_all, pending.size(), pending.size()));
            updateAll.setEnabled(waiting > 0 && queue.isEmpty());
        } else {
            updateAll.setVisibility(View.GONE);
        }
        mine = Updates.self(self, getPackageName().equals(Catalog.OWN)
            ? Installed.of(getPackageManager(), Catalog.OWN) : null);
        selfBar.setVisibility(mine == null ? View.GONE : View.VISIBLE);
        if (mine != null) {
            ((TextView) findViewById(R.id.self_text)).setText(getString(R.string.self_update, mine.versionName));
            Button b = findViewById(R.id.self_update);
            b.setEnabled(!busy.containsKey(mine.pkg));
            b.setText(busy.containsKey(mine.pkg) ? R.string.working : R.string.update);
        }
    }

    private void updateAll() {
        if (!mayInstall()) return;
        queue.clear();
        for (AppInfo a : pending) if (!busy.containsKey(a.pkg)) queue.add(a);
        next();
    }

    /** Starts the next queued update; each waits for the one before it to finish. */
    private void next() {
        AppInfo a = queue.poll();
        if (a != null) act(a, Installed.UPDATE);
        updateBars();
    }

    private boolean mayInstall() {
        if (getPackageManager().canRequestPackageInstalls()) return true;
        new AlertDialog.Builder(this).setTitle(R.string.allow_title).setMessage(R.string.allow_text)
            .setPositiveButton(R.string.allow_open, (d, w) -> startActivity(new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()))))
            .setNegativeButton(android.R.string.cancel, null).show();
        return false;
    }

    private void act(AppInfo app, int state) {
        if (state == Installed.CURRENT || state == Installed.NEWER) {
            Intent open = getPackageManager().getLaunchIntentForPackage(app.pkg);
            if (open != null) startActivity(open);
            return;
        }
        if (state == Installed.OTHER_KEY) {
            new AlertDialog.Builder(this).setTitle(app.name).setMessage(R.string.other_key_long)
                .setPositiveButton(android.R.string.ok, null).show();
            return;
        }
        if (busy.containsKey(app.pkg)) return;
        if (!mayInstall()) {
            queue.clear();
            return;
        }
        Job job = new Job(app);
        busy.put(app.pkg, job);
        updateBars();
        adapter.notifyDataSetChanged();
        work.execute(() -> {
            String err = null;
            int id = -1;
            try {
                id = Installer.install(this, app);
            } catch (RepoException e) {
                err = e.code;
            }
            String code = err;
            int session = id;
            runOnUiThread(() -> {
                if (busy.get(app.pkg) != job) return;
                if (code != null) {
                    done(job, false, getString(R.string.install_failed, app.name, note(code)));
                } else if (job.session < 0) {
                    // Android's question may have come first and named the session already.
                    job.session = session;
                    job.since = SystemClock.elapsedRealtime();
                    schedule();
                }
            });
        });
    }

    @Override
    public void onInstallConfirm(String pkg, int session, Intent confirm) {
        Job job = busy.get(pkg);
        if (job == null) {
            // Not started from this screen (it was closed in between): ask at once.
            try {
                startActivity(confirm);
            } catch (RuntimeException e) {
                // The next "Update" asks again.
            }
            return;
        }
        if (session >= 0) job.session = session;
        job.confirm = confirm;
        job.shown = false;
        job.since = SystemClock.elapsedRealtime();
        adapter.notifyDataSetChanged();
        // Shown by look() once the screen has been in front for a moment, so
        // an overlay that is still on top (a security scan) cannot take it.
        schedule();
    }

    @Override
    public void onInstallResult(String pkg, int session, boolean ok, String message) {
        Job job = busy.get(pkg);
        if (job == null) {
            adapter.notifyDataSetChanged();
            return;
        }
        // An answer for a session given up before belongs to no one now.
        if (session >= 0 && job.session >= 0 && session != job.session) return;
        String toast = null;
        if (!ok && message != null) toast = getString(R.string.install_failed, job.app.name, message);
        done(job, ok, toast);
    }

    /** One install has ended (done, refused, lost or given up); the next one starts. */
    private void done(Job job, boolean ok, String toast) {
        if (busy.get(job.app.pkg) != job) return;
        busy.remove(job.app.pkg);
        if (askingFor == job && asking != null) asking.dismiss();
        adapter.notifyDataSetChanged();
        if (toast != null) Toast.makeText(this, toast, Toast.LENGTH_LONG).show();
        next(); // a "no" to one update does not stop the others
        if (queue.isEmpty()) UpdateJob.announce(this, pending, mine, false); // takes a done notice away
    }

    private void schedule() {
        ui.removeCallbacks(tick);
        if (frontAt >= 0 && !busy.isEmpty()) ui.postDelayed(tick, 500);
    }

    /** Looks at every install while the screen is in front ({@link Watch}). */
    private void look() {
        if (frontAt < 0 || isFinishing()) return;
        long now = SystemClock.elapsedRealtime();
        for (Job job : new ArrayList<>(busy.values())) {
            if (job.session < 0 && job.confirm == null) continue; // still downloading (Net has its own timeouts)
            float progress = job.session >= 0 ? Installer.progress(this, job.session) : 0;
            int s = Installed.state(Installed.of(getPackageManager(), job.app.pkg), job.app);
            boolean installed = s == Installed.CURRENT || s == Installed.NEWER;
            int what = Watch.look(installed, progress >= 0, job.confirm != null, job.shown,
                Math.max(progress, 0), now - frontAt, job.since, now);
            if (what == Watch.DONE) {
                done(job, true, null);
            } else if (what == Watch.LOST) {
                done(job, false, getString(R.string.not_updated, job.app.name));
            } else if (what == Watch.GIVE_UP) {
                Installer.abandon(this, job.session);
                done(job, false, getString(R.string.not_updated, job.app.name));
            } else if (what == Watch.PROMPT && asking == null) {
                showConfirm(job);
                return; // the screen goes behind Android's question
            } else if (what == Watch.ASK && asking == null) {
                askAgain(job);
            }
        }
        schedule();
    }

    /** Puts Android's question for this app on screen. */
    private void showConfirm(Job job) {
        if (job.confirm == null) return;
        job.shown = true;
        job.since = SystemClock.elapsedRealtime();
        try {
            startActivity(job.confirm);
        } catch (RuntimeException e) {
            Installer.abandon(this, job.session);
            done(job, false, getString(R.string.not_updated, job.app.name));
        }
    }

    /** Android's question went away without an answer: show it again, or skip this app. */
    private void askAgain(Job job) {
        askingFor = job;
        asking = new AlertDialog.Builder(this).setTitle(job.app.name)
            .setMessage(getString(R.string.lost_text, job.app.name))
            .setCancelable(false)
            .setPositiveButton(R.string.show_again, (d, w) -> showConfirm(job))
            .setNegativeButton(R.string.skip, (d, w) -> {
                Installer.abandon(this, job.session);
                done(job, false, null);
            })
            .create();
        asking.setOnDismissListener(d -> {
            asking = null;
            askingFor = null;
        });
        asking.show();
    }

    private String note(String code) {
        switch (code) {
            case RepoException.NETWORK: return getString(R.string.err_network);
            case RepoException.SIGNATURE: return getString(R.string.err_signature);
            case RepoException.HASH: return getString(R.string.err_hash);
            case RepoException.OLDER: return getString(R.string.err_older);
            case "empty": return getString(R.string.err_empty);
            default: return getString(R.string.err_format);
        }
    }

    private final class Adapter extends BaseAdapter {
        @Override public int getCount() { return rows.size(); }
        @Override public Object getItem(int i) { return rows.get(i); }
        @Override public long getItemId(int i) { return i; }
        @Override public int getViewTypeCount() { return 4; }
        @Override public int getItemViewType(int i) { return rows.get(i).kind; }
        @Override public boolean isEnabled(int i) { return false; }

        @Override
        public View getView(int i, View v, ViewGroup parent) {
            Rows.Row r = rows.get(i);
            LayoutInflater inf = getLayoutInflater();
            switch (r.kind) {
                case Rows.HEADER:
                    if (v == null) v = inf.inflate(R.layout.row_header, parent, false);
                    ((TextView) v).setText(r.source.title);
                    return v;
                case Rows.SUB:
                    if (v == null) v = inf.inflate(R.layout.row_sub, parent, false);
                    ((TextView) v).setText(R.string.more_apps);
                    return v;
                case Rows.NOTE:
                    if (v == null) v = inf.inflate(R.layout.row_note, parent, false);
                    String n = note(r.note);
                    ((TextView) v).setText(n.isEmpty() ? n : n.substring(0, 1).toUpperCase(Locale.getDefault()) + n.substring(1));
                    return v;
                default:
                    if (v == null) v = inf.inflate(R.layout.row_app, parent, false);
                    bind(v, r.app);
                    return v;
            }
        }

        private void bind(View v, AppInfo app) {
            PackageManager pm = getPackageManager();
            Installed have = Installed.of(pm, app.pkg);
            int state = Installed.state(have, app);
            ((TextView) v.findViewById(R.id.name)).setText(app.name);
            TextView sum = v.findViewById(R.id.summary);
            sum.setText(app.summary == null ? "" : app.summary);
            sum.setVisibility(app.summary == null ? View.GONE : View.VISIBLE);
            String size = Formatter.formatShortFileSize(MainActivity.this, app.apkSize);
            String line = app.beta ? getString(R.string.version_beta, app.versionName, size)
                : getString(R.string.version_size, app.versionName, size);
            if (state == Installed.UPDATE) line += " · " + getString(R.string.installed_version, have.versionName);
            if (state == Installed.OTHER_KEY) line += " · " + getString(R.string.other_key);
            ((TextView) v.findViewById(R.id.meta)).setText(line);
            icons.show((ImageView) v.findViewById(R.id.icon), app);
            Button b = v.findViewById(R.id.action);
            b.setOnClickListener(x -> act(app, state));
            b.setEnabled(true);
            Job job = busy.get(app.pkg);
            if (job != null && job.confirm != null) {
                // Android waits for a yes: one tap shows its question again.
                b.setText(R.string.confirm);
                b.setOnClickListener(x -> showConfirm(job));
            } else if (job != null) {
                b.setText(R.string.working);
                b.setEnabled(false);
            } else if (state == Installed.NONE) {
                b.setText(R.string.install);
            } else if (state == Installed.UPDATE) {
                b.setText(R.string.update);
            } else if (state == Installed.OTHER_KEY) {
                b.setText(R.string.why);
            } else {
                b.setText(R.string.open);
                b.setEnabled(pm.getLaunchIntentForPackage(app.pkg) != null);
            }
            b.setContentDescription(b.getText() + " " + app.name);
        }
    }
}
