package gr.koulaxizis.apps;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
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

import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The one screen: every project with its apps, each with Install, Update
 * or Open (APPS-M1). Lists come from the repositories' signed indexes,
 * first from the copy on the phone, then fresh from the network.
 */
public final class MainActivity extends Activity implements InstallReceiver.Listener {
    private final ExecutorService work = Executors.newSingleThreadExecutor();
    private final Set<String> busy = new HashSet<>();
    private List<Rows.Row> rows = new ArrayList<>();
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
        ListView list = findViewById(R.id.list);
        adapter = new Adapter();
        list.setAdapter(adapter);
        catalog = new Catalog(this);
        icons = new Icons(this);
        refresh(true);
    }

    @Override
    protected void onResume() {
        super.onResume();
        InstallReceiver.listener = this;
        adapter.notifyDataSetChanged(); // installed versions may have changed
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (InstallReceiver.listener == this) InstallReceiver.listener = null;
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.main, menu);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == R.id.refresh) {
            refresh(false);
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
                runOnUiThread(() -> show(cached, at));
            }
            catalog.refresh();
            List<Rows.Row> fresh = build();
            long at = catalog.checkedAt;
            runOnUiThread(() -> {
                refreshing = false;
                show(fresh, at);
            });
        });
    }

    private List<Rows.Row> build() {
        return Rows.build(Source.ALL, catalog.apps, catalog.errors, Locale.getDefault());
    }

    private void show(List<Rows.Row> next, long checkedAt) {
        rows = next;
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
        if (!getPackageManager().canRequestPackageInstalls()) {
            new AlertDialog.Builder(this).setTitle(R.string.allow_title).setMessage(R.string.allow_text)
                .setPositiveButton(R.string.allow_open, (d, w) -> startActivity(new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()))))
                .setNegativeButton(android.R.string.cancel, null).show();
            return;
        }
        busy.add(app.pkg);
        adapter.notifyDataSetChanged();
        work.execute(() -> {
            String err = null;
            try {
                Installer.install(this, app);
            } catch (RepoException e) {
                err = e.code;
            }
            String code = err;
            runOnUiThread(() -> {
                if (code != null) {
                    busy.remove(app.pkg);
                    adapter.notifyDataSetChanged();
                    Toast.makeText(this, getString(R.string.install_failed, app.name, note(code)), Toast.LENGTH_LONG).show();
                }
            });
        });
    }

    @Override
    public void onInstallResult(String pkg, boolean ok, String message) {
        busy.remove(pkg);
        adapter.notifyDataSetChanged();
        if (ok) return;
        String name = pkg;
        for (Rows.Row r : rows) if (r.app != null && r.app.pkg.equals(pkg)) name = r.app.name;
        if (message != null) Toast.makeText(this, getString(R.string.install_failed, name, message), Toast.LENGTH_LONG).show();
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
            if (busy.contains(app.pkg)) {
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
