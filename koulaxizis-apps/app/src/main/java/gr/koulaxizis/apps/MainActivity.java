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
import android.text.Editable;
import android.text.Html;
import android.text.TextWatcher;
import android.text.format.DateFormat;
import android.text.format.Formatter;
import android.view.GestureDetector;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.LinearLayout;
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
 * never stays on "Working" (APPS-M2 fix 1.2.2). A search bar on top
 * filters the list, and a tap on a card opens the app's own page with its
 * whole description and screenshots (APPS-M5); the home screen itself is
 * unchanged. Updates go without Android's question where it allows it
 * ({@link Quiet}), "Update all" ends with one line on what it did, the menu
 * has automatic updates and Shizuku (both off by default) and the Help
 * (APPS-M6).
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
        /** Android asked for a yes at least once (for the "Update all" line). */
        boolean asked;
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
    /** Every row (the home screen), and the rows on screen (the search's, or all). */
    private List<Rows.Row> all = new ArrayList<>();
    private List<Rows.Row> rows = new ArrayList<>();
    private List<String> words = new ArrayList<>();
    private EditText search;
    private View home, detail, clear;
    private TextView noMatch;
    private ListView list;
    /** The app whose page is open, or null; the page to open again after a restart. */
    private AppInfo open;
    private String reopen;
    /** Android 13+: takes Back while a page is open or a search is typed. */
    private Object backCallback;
    /** Updates waiting their turn after "Update all" (main thread only). */
    private final Deque<AppInfo> queue = new ArrayDeque<>();
    /** What the running "Update all" did, or null when none runs. */
    private Quiet.Tally tally;
    /** Shizuku's answer to our permission request. */
    private final rikka.shizuku.Shizuku.OnRequestPermissionResultListener shizukuAnswer = (code, result) -> {
        if (code != Silent.REQUEST) return;
        runOnUiThread(() -> {
            boolean yes = result == PackageManager.PERMISSION_GRANTED;
            Silent.set(this, yes);
            invalidateOptionsMenu();
            Toast.makeText(this, yes ? R.string.shizuku_on : R.string.shizuku_refused, Toast.LENGTH_LONG).show();
        });
    };
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
        list = findViewById(R.id.list);
        adapter = new Adapter();
        list.setAdapter(adapter);
        home = findViewById(R.id.home);
        detail = findViewById(R.id.detail);
        noMatch = findViewById(R.id.no_match);
        clear = findViewById(R.id.search_clear);
        search = findViewById(R.id.search);
        clear.setOnClickListener(v -> search.setText(""));
        search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence t, int a, int b, int c) {}
            @Override public void onTextChanged(CharSequence t, int a, int b, int c) {}
            @Override public void afterTextChanged(Editable e) {
                List<String> w = Search.words(e.toString());
                clear.setVisibility(e.length() > 0 ? View.VISIBLE : View.GONE);
                if (w.equals(words)) return;
                words = w;
                applyFilter();
                list.setSelection(0);
            }
        });
        search.setOnEditorActionListener((v, action, ev) -> {
            if (action == EditorInfo.IME_ACTION_SEARCH) {
                hideKeyboard();
                return true;
            }
            return false;
        });
        findViewById(R.id.d_web).setOnClickListener(v -> { if (open != null) browse(open.details.webSite); });
        findViewById(R.id.d_source).setOnClickListener(v -> { if (open != null) browse(open.details.sourceCode); });
        if (state != null) reopen = state.getString("open");
        catalog = new Catalog(this);
        icons = new Icons(this);
        // Set for the screen's whole life: results arrive while Android's
        // own question is on top and this screen is paused.
        InstallReceiver.listener = this;
        try {
            rikka.shizuku.Shizuku.addRequestPermissionResultListener(shizukuAnswer);
        } catch (Throwable t) {
            // Shizuku's part is optional; the app works without it.
        }
        UpdateJob.schedule(this);
        askNotificationsOnce();
        refresh(true);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (open != null) out.putString("open", open.pkg);
    }

    @Override
    protected void onResume() {
        super.onResume();
        frontAt = SystemClock.elapsedRealtime();
        schedule();
        updateBars(); // installed versions may have changed
        updateNotesBar(); // notices may have been turned on in Android's settings
        changed();
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
        try {
            rikka.shizuku.Shizuku.removeRequestPermissionResultListener(shizukuAnswer);
        } catch (Throwable t) {
            // Never added.
        }
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
        menu.findItem(R.id.auto).setChecked(UpdateJob.auto(this));
        menu.findItem(R.id.shizuku).setChecked(Silent.on(this));
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == android.R.id.home) {
            closeDetail();
            return true;
        }
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
            invalidateOptionsMenu(); // automatic updates follow the daily check
            return true;
        }
        if (item.getItemId() == R.id.auto) {
            boolean on = !item.isChecked();
            // Automatic updates run in the daily check, so turning them on turns it on.
            UpdateJob.prefs(this).edit().putBoolean("auto", on).apply();
            if (on) UpdateJob.prefs(this).edit().putBoolean("daily", true).apply();
            UpdateJob.schedule(this);
            if (on) askNotificationsOnce();
            updateNotesBar();
            invalidateOptionsMenu();
            Toast.makeText(this, on ? R.string.auto_on : R.string.auto_off, Toast.LENGTH_LONG).show();
            return true;
        }
        if (item.getItemId() == R.id.shizuku) {
            if (item.isChecked()) {
                Silent.set(this, false);
                invalidateOptionsMenu();
            } else {
                turnOnShizuku();
            }
            return true;
        }
        if (item.getItemId() == R.id.help) {
            showHelp();
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
        all = next;
        self = me;
        applyFilter();
        updateBars();
        // The open page shows the fresh listing; one to open again after a restart opens now.
        String want = open != null ? open.pkg : reopen;
        if (want != null) {
            AppInfo a = find(want);
            if (a != null) {
                reopen = null;
                openDetail(a);
            }
        }
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
        for (Rows.Row r : all) if (r.app != null) offers.add(r.app);
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
        tally = queue.isEmpty() ? null : new Quiet.Tally();
        next();
    }

    /** Starts the next queued update; each waits for the one before it to finish. */
    private void next() {
        AppInfo a = queue.poll();
        if (a != null) act(a, Installed.UPDATE);
        updateBars();
        if (a == null && tally != null && busy.isEmpty()) {
            Quiet.Tally t = tally;
            tally = null;
            if (t.total() > 0) {
                String line = t.allQuiet()
                    ? getResources().getQuantityString(R.plurals.update_all_quiet, t.quiet, t.quiet)
                    : getString(R.string.update_all_done, t.done(), t.total(), t.asked);
                Toast.makeText(this, line, Toast.LENGTH_LONG).show();
            }
        }
    }

    /** Shizuku must run and allow us; otherwise the Help says how to set it up. */
    private void turnOnShizuku() {
        if (!Silent.running()) {
            new AlertDialog.Builder(this).setTitle(R.string.shizuku).setMessage(R.string.shizuku_missing)
                .setPositiveButton(R.string.help, (d, w) -> showHelp())
                .setNegativeButton(android.R.string.cancel, null).show();
            return;
        }
        if (Silent.allowed()) {
            Silent.set(this, true);
            invalidateOptionsMenu();
            Toast.makeText(this, R.string.shizuku_on, Toast.LENGTH_LONG).show();
            return;
        }
        try {
            rikka.shizuku.Shizuku.requestPermission(Silent.REQUEST);
        } catch (Throwable t) {
            Toast.makeText(this, R.string.shizuku_missing, Toast.LENGTH_LONG).show();
        }
    }

    /** Which questions stay and why, automatic updates, Shizuku and Play Protect (APPS-M6). */
    private void showHelp() {
        TextView t = new TextView(this);
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        t.setPadding(pad, pad / 2, pad, pad);
        t.setTextIsSelectable(true);
        t.setText(Html.fromHtml(getString(R.string.help_text), Html.FROM_HTML_MODE_LEGACY));
        android.widget.ScrollView sv = new android.widget.ScrollView(this);
        sv.addView(t);
        new AlertDialog.Builder(this).setTitle(R.string.help).setView(sv)
            .setPositiveButton(android.R.string.ok, null).show();
    }

    private boolean mayInstall() {
        if (Silent.ready(this)) return true; // Shizuku needs no "install unknown apps" switch
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
            tally = null;
            return;
        }
        Job job = new Job(app);
        busy.put(app.pkg, job);
        updateBars();
        changed();
        work.execute(() -> {
            String err = null;
            int id = -1;
            try {
                id = Installer.install(this, app, false);
            } catch (RepoException e) {
                err = e.code;
            }
            String code = err;
            int session = id;
            runOnUiThread(() -> {
                if (busy.get(app.pkg) != job) return;
                if (code != null) {
                    done(job, false, getString(R.string.install_failed, app.name, note(code)));
                } else if (session == Installer.SILENT) {
                    done(job, true, null); // Shizuku installed it, no question
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
        job.asked = true;
        job.confirm = confirm;
        job.shown = false;
        job.since = SystemClock.elapsedRealtime();
        changed();
        // Shown by look() once the screen has been in front for a moment, so
        // an overlay that is still on top (a security scan) cannot take it.
        schedule();
    }

    @Override
    public void onInstallResult(String pkg, int session, boolean ok, String message) {
        Job job = busy.get(pkg);
        if (job == null) {
            changed();
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
        if (tally != null) tally.add(ok, job.asked);
        if (askingFor == job && asking != null) asking.dismiss();
        changed();
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

    /** The list and the open page show the installs' state again. */
    private void changed() {
        adapter.notifyDataSetChanged();
        if (open != null) bindDetail(open, true);
    }

    private AppInfo find(String pkg) {
        for (Rows.Row r : all) if (r.app != null && r.app.pkg.equals(pkg)) return r.app;
        return null;
    }

    /** The search's rows, or every row while nothing is typed (APPS-M5). */
    private void applyFilter() {
        rows = Search.filter(all, words, a -> categories(a));
        boolean none = !words.isEmpty() && rows.isEmpty() && !all.isEmpty();
        noMatch.setVisibility(none ? View.VISIBLE : View.GONE);
        if (none) noMatch.setText(getString(R.string.no_match, search.getText().toString().trim()));
        adapter.notifyDataSetChanged();
        updateBack();
    }

    private void hideKeyboard() {
        InputMethodManager im = getSystemService(InputMethodManager.class);
        if (im != null) im.hideSoftInputFromWindow(search.getWindowToken(), 0);
        search.clearFocus();
    }

    /** Opens an https link of a store listing in the browser. */
    private void browse(String url) {
        if (url == null) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (android.content.ActivityNotFoundException e) {
            Toast.makeText(this, url, Toast.LENGTH_LONG).show();
        }
    }

    /** F-Droid's category names in the phone's language; unknown ones as the repository wrote them. */
    private String category(String c) {
        int id;
        switch (c) {
            case "Connectivity": id = R.string.cat_connectivity; break;
            case "Development": id = R.string.cat_development; break;
            case "Games": id = R.string.cat_games; break;
            case "Graphics": id = R.string.cat_graphics; break;
            case "Internet": id = R.string.cat_internet; break;
            case "Money": id = R.string.cat_money; break;
            case "Multimedia": id = R.string.cat_multimedia; break;
            case "Navigation": id = R.string.cat_navigation; break;
            case "Office": id = R.string.cat_office; break;
            case "Phone & SMS": id = R.string.cat_phone; break;
            case "Reading": id = R.string.cat_reading; break;
            case "Science & Education": id = R.string.cat_science; break;
            case "Security": id = R.string.cat_security; break;
            case "Sports & Health": id = R.string.cat_health; break;
            case "System": id = R.string.cat_system; break;
            case "Theming": id = R.string.cat_theming; break;
            case "Time": id = R.string.cat_time; break;
            case "Writing": id = R.string.cat_writing; break;
            default: return c;
        }
        return getString(id);
    }

    private String categories(AppInfo a) {
        StringBuilder b = new StringBuilder();
        for (String c : a.details.categories) {
            if (b.length() > 0) b.append(", ");
            b.append(category(c));
        }
        return b.toString();
    }

    // ---- The app's own page (APPS-M5) ----

    private void openDetail(AppInfo app) {
        boolean same = open != null && open.pkg.equals(app.pkg) && detail.getVisibility() == View.VISIBLE;
        open = app;
        bindDetail(app, same);
        if (!same) {
            hideKeyboard();
            home.setVisibility(View.GONE);
            detail.setVisibility(View.VISIBLE);
            detail.scrollTo(0, 0);
            if (getActionBar() != null) getActionBar().setDisplayHomeAsUpEnabled(true);
            setTitle(app.name);
        }
        updateBack();
    }

    private void closeDetail() {
        if (open == null) return;
        open = null;
        detail.setVisibility(View.GONE);
        home.setVisibility(View.VISIBLE);
        if (getActionBar() != null) getActionBar().setDisplayHomeAsUpEnabled(false);
        setTitle(R.string.app_name);
        ((LinearLayout) findViewById(R.id.d_shots)).removeAllViews();
        updateBack();
    }

    /** Back closes the page, then empties the search, then leaves (Android 16 sends no onBackPressed). */
    private void updateBack() {
        if (android.os.Build.VERSION.SDK_INT < 33) return;
        boolean want = open != null || search.length() > 0;
        android.window.OnBackInvokedDispatcher d = getOnBackInvokedDispatcher();
        if (want && backCallback == null) {
            android.window.OnBackInvokedCallback cb = this::back;
            d.registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, cb);
            backCallback = cb;
        } else if (!want && backCallback != null) {
            d.unregisterOnBackInvokedCallback((android.window.OnBackInvokedCallback) backCallback);
            backCallback = null;
        }
    }

    private void back() {
        if (open != null) closeDetail();
        else search.setText("");
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (open != null || search.length() > 0) back();
        else super.onBackPressed();
    }

    private void bindDetail(AppInfo app, boolean same) {
        Source src = null;
        for (Rows.Row r : all) if (r.app == app) src = r.source;
        icons.show((ImageView) findViewById(R.id.d_icon), app);
        ((TextView) findViewById(R.id.d_name)).setText(app.name);
        String by = src == null ? "" : src.title;
        if (app.details.author != null && !app.details.author.equalsIgnoreCase(by)) {
            by = by.isEmpty() ? app.details.author : by + " · " + app.details.author;
        }
        TextView byView = findViewById(R.id.d_by);
        byView.setText(by);
        byView.setVisibility(by.isEmpty() ? View.GONE : View.VISIBLE);
        String meta = metaLine(app);
        if (app.details.added > 0) {
            meta += " · " + DateFormat.getMediumDateFormat(this).format(new Date(app.details.added));
        }
        ((TextView) findViewById(R.id.d_meta)).setText(meta);
        action((Button) findViewById(R.id.d_action), app);
        TextView sum = findViewById(R.id.d_summary);
        sum.setText(app.summary == null ? "" : app.summary);
        sum.setVisibility(app.summary == null ? View.GONE : View.VISIBLE);
        if (!same) bindShots(app);
        TextView newTitle = findViewById(R.id.d_new_title), news = findViewById(R.id.d_new);
        boolean hasNew = app.whatsNew != null;
        newTitle.setVisibility(hasNew ? View.VISIBLE : View.GONE);
        news.setVisibility(hasNew ? View.VISIBLE : View.GONE);
        if (hasNew) {
            newTitle.setText(getString(R.string.whats_new, app.versionName));
            news.setText(Html.fromHtml(Text.html(app.whatsNew), Html.FROM_HTML_MODE_COMPACT));
        }
        TextView about = findViewById(R.id.d_description);
        boolean hasAbout = app.details.description != null;
        about.setVisibility(hasAbout ? View.VISIBLE : View.GONE);
        findViewById(R.id.d_about_title).setVisibility(hasAbout ? View.VISIBLE : View.GONE);
        if (hasAbout) about.setText(Html.fromHtml(Text.html(app.details.description), Html.FROM_HTML_MODE_COMPACT));
        StringBuilder info = new StringBuilder();
        if (!app.details.categories.isEmpty()) info.append(getString(R.string.info_category, categories(app))).append('\n');
        if (app.details.license != null) info.append(getString(R.string.info_license, app.details.license)).append('\n');
        info.append(getString(R.string.info_package, app.pkg));
        ((TextView) findViewById(R.id.d_info)).setText(info);
        findViewById(R.id.d_web).setVisibility(app.details.webSite == null ? View.GONE : View.VISIBLE);
        findViewById(R.id.d_source).setVisibility(app.details.sourceCode == null ? View.GONE : View.VISIBLE);
    }

    /** The screenshots in a row that scrolls sideways; a tap shows one on the whole screen. */
    private void bindShots(AppInfo app) {
        LinearLayout box = findViewById(R.id.d_shots);
        box.removeAllViews();
        List<AppInfo.Shot> shots = app.details.screenshots;
        View scroller = findViewById(R.id.d_shots_box);
        scroller.setVisibility(shots.isEmpty() ? View.GONE : View.VISIBLE);
        scroller.scrollTo(0, 0);
        float dp = getResources().getDisplayMetrics().density;
        int h = Math.round(320 * dp);
        int[] shown = {0, 0};
        for (int i = 0; i < shots.size(); i++) {
            ImageView iv = new ImageView(this);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, h);
            lp.setMarginEnd(Math.round(8 * dp));
            iv.setLayoutParams(lp);
            iv.setAdjustViewBounds(true);
            iv.setScaleType(ImageView.ScaleType.FIT_CENTER);
            iv.setMinimumWidth(Math.round(180 * dp)); // a phone screenshot's width while it loads
            iv.setBackgroundResource(R.color.shot_bg);
            iv.setContentDescription(getString(R.string.screenshot_n, i + 1, shots.size()));
            int at = i;
            iv.setOnClickListener(v -> viewShots(app, at));
            box.addView(iv);
            icons.shot(iv, shots.get(i), 0, h, ok -> {
                if (open == null || !open.pkg.equals(app.pkg)) return;
                if (ok) {
                    iv.setMinimumWidth(0);
                    iv.setBackground(null);
                } else {
                    iv.setVisibility(View.GONE);
                    if (++shown[1] == shots.size()) scroller.setVisibility(View.GONE);
                }
            });
        }
    }

    /** One screenshot on the whole screen; swipe for the next one, tap or Back to close. */
    private void viewShots(AppInfo app, int first) {
        List<AppInfo.Shot> shots = app.details.screenshots;
        android.app.Dialog d = new android.app.Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        android.widget.FrameLayout root = new android.widget.FrameLayout(this);
        ImageView iv = new ImageView(this);
        iv.setScaleType(ImageView.ScaleType.FIT_CENTER);
        root.addView(iv, new android.widget.FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT));
        TextView count = new TextView(this);
        count.setTextColor(0xFFFFFFFF);
        count.setPadding(0, 0, 0, Math.round(24 * getResources().getDisplayMetrics().density));
        root.addView(count, new android.widget.FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT, android.view.Gravity.BOTTOM | android.view.Gravity.CENTER_HORIZONTAL));
        int w = getResources().getDisplayMetrics().widthPixels, h = getResources().getDisplayMetrics().heightPixels;
        int[] at = {first};
        Runnable load = () -> {
            iv.setContentDescription(getString(R.string.screenshot_n, at[0] + 1, shots.size()));
            count.setText((at[0] + 1) + " / " + shots.size());
            icons.shot(iv, shots.get(at[0]), w / 2, h / 2, ok -> {});
        };
        GestureDetector g = new GestureDetector(this, new GestureDetector.SimpleOnGestureListener() {
            @Override public boolean onDown(MotionEvent e) { return true; }
            @Override public boolean onSingleTapUp(MotionEvent e) {
                d.dismiss();
                return true;
            }
            @Override public boolean onFling(MotionEvent a, MotionEvent b, float vx, float vy) {
                if (Math.abs(vx) < Math.abs(vy)) return false;
                int next = at[0] + (vx < 0 ? 1 : -1);
                if (next < 0 || next >= shots.size()) return false;
                at[0] = next;
                load.run();
                return true;
            }
        });
        root.setOnTouchListener((v, e) -> g.onTouchEvent(e));
        d.setContentView(root);
        load.run();
        d.show();
    }

    private String metaLine(AppInfo app) {
        String size = Formatter.formatShortFileSize(this, app.apkSize);
        String line = app.beta ? getString(R.string.version_beta, app.versionName, size)
            : getString(R.string.version_size, app.versionName, size);
        Installed have = Installed.of(getPackageManager(), app.pkg);
        int state = Installed.state(have, app);
        if (state == Installed.UPDATE) {
            line += " · " + getString(R.string.installed_version, have.versionName);
            // Installed by another app: Android asks this once more (APPS-M6).
            if (!Silent.ready(this) && Installer.quiet(this, app.pkg) == Quiet.ONCE_MORE) line += " · " + getString(R.string.asks_once);
        }
        if (state == Installed.OTHER_KEY) line += " · " + getString(R.string.other_key);
        return line;
    }

    /** Install, Update, Open, Why?, Confirm or Working, the same on a card and on the app's page. */
    private void action(Button b, AppInfo app) {
        PackageManager pm = getPackageManager();
        int state = Installed.state(Installed.of(pm, app.pkg), app);
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

    private final class Adapter extends BaseAdapter {
        @Override public int getCount() { return rows.size(); }
        @Override public Object getItem(int i) { return rows.get(i); }
        @Override public long getItemId(int i) { return i; }
        @Override public int getViewTypeCount() { return 4; }
        @Override public int getItemViewType(int i) { return rows.get(i).kind; }
        @Override public boolean isEnabled(int i) { return rows.get(i).kind == Rows.APP; }

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
            ((TextView) v.findViewById(R.id.name)).setText(app.name);
            TextView sum = v.findViewById(R.id.summary);
            sum.setText(app.summary == null ? "" : app.summary);
            sum.setVisibility(app.summary == null ? View.GONE : View.VISIBLE);
            ((TextView) v.findViewById(R.id.meta)).setText(metaLine(app));
            icons.show((ImageView) v.findViewById(R.id.icon), app);
            action((Button) v.findViewById(R.id.action), app);
            // The whole card opens the app's page (APPS-M5); its button keeps its own job.
            v.setOnClickListener(x -> openDetail(app));
        }
    }
}
