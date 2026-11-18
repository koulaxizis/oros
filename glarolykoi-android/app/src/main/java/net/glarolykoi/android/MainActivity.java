package net.glarolykoi.android;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedDispatcher;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.Toast;

/**
 * glarolykoi.net in our own WebView (GL-1). No Google libraries, no
 * analytics, no account with anyone: the site works exactly as in a
 * browser, cookies and cart included. See README.md for the rules.
 */
public class MainActivity extends Activity {
    private static final int PICK_FILE = 1;
    private static final int ASK_NOTIFY = 2;
    private static final String SHARE_SHIM =
        "(function(){if(navigator.share)return;navigator.share=function(d){d=d||{};"
        + "GlarolykoiApp.share(String(d.title||''),String(d.text||''),String(d.url||location.href));"
        + "return Promise.resolve();};})();";

    private WebView web;
    private View offline;
    private ProgressBar progress;
    private ValueCallback<Uri[]> pendingFiles;
    /** The page that failed to load, retried by the offline screen. */
    private String failedUrl;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.main);
        fitSystemBars(findViewById(R.id.root));
        web = findViewById(R.id.web);
        offline = findViewById(R.id.offline);
        progress = findViewById(R.id.progress);
        ((Button) findViewById(R.id.retry)).setOnClickListener(v -> retry());

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);   // target=_blank opens here, then routed
        s.setMediaPlaybackRequiresUserGesture(true);
        // Lets the site tell the app from a browser (G3 notice, stats).
        s.setUserAgentString(s.getUserAgentString() + " GlarolykoiApp/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);  // Viva.com checkout

        web.addJavascriptInterface(new Bridge(this, this::onSite), "GlarolykoiApp");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, ua, disposition, mime, length) -> download(url, ua, disposition, mime));

        // Android 13+ (and always from targetSdk 36) send Back here, not
        // to onBackPressed.
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
        }

        ReleaseJob.schedule(this);

        if (state != null && web.restoreState(state) != null) return;
        String start = startUrl(getIntent());
        cacheModeForNetwork();
        web.loadUrl(start);
    }

    /**
     * Android 15+ draws apps edge to edge: keep the page clear of the
     * status bar, the navigation bar and the keyboard.
     */
    private static void fitSystemBars(View root) {
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int l, t, r, b;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                l = i.left; t = i.top; r = i.right; b = i.bottom;
            } else {
                l = insets.getSystemWindowInsetLeft(); t = insets.getSystemWindowInsetTop();
                r = insets.getSystemWindowInsetRight(); b = insets.getSystemWindowInsetBottom();
            }
            v.setPadding(l, t, r, b);
            return insets;
        });
    }

    /** A glarolykoi.net link handed to the app, else the home page. */
    private static String startUrl(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data != null && "https".equals(data.getScheme()) && Links.isSiteHost(data.getHost())) {
            return data.toString();
        }
        return Links.HOME;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent.getData() != null) web.loadUrl(startUrl(intent));
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();  // keep the cart and the sign-in
    }

    @Override
    public void onBackPressed() {
        back();
    }

    /** Back walks the site's history, then leaves the app. */
    private void back() {
        if (web.canGoBack()) {
            showOffline(false);
            web.goBack();
        } else {
            finish();
        }
    }

    @Override
    protected void onDestroy() {
        if (pendingFiles != null) pendingFiles.onReceiveValue(null);
        web.destroy();
        super.onDestroy();
    }

    private boolean onSite() {
        String url = web.getUrl();
        return url != null && Links.isSiteHost(Uri.parse(url).getHost());
    }

    private boolean online() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return true;
        NetworkCapabilities caps = cm.getNetworkCapabilities(cm.getActiveNetwork());
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    /** Offline, pages already seen come from the cache (GL-OFF). */
    private void cacheModeForNetwork() {
        web.getSettings().setCacheMode(online() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
    }

    private void showOffline(boolean show) {
        offline.setVisibility(show ? View.VISIBLE : View.GONE);
        web.setVisibility(show ? View.INVISIBLE : View.VISIBLE);
    }

    private void retry() {
        cacheModeForNetwork();
        showOffline(false);
        String url = failedUrl != null ? failedUrl : Links.HOME;
        failedUrl = null;
        web.loadUrl(url);
    }

    private void openOutside(Uri uri) {
        Intent view = new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE);
        try {
            startActivity(view);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_app, Toast.LENGTH_SHORT).show();
        }
    }

    /** intent: links name another app; open it only if it is installed. */
    private void openIntentLink(String url) {
        try {
            Intent i = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
            // Never let a page start one of our own screens or pass grants.
            i.setComponent(null);
            i.setSelector(null);
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.setFlags(i.getFlags() & ~(Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                    | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION));
            if (getPackageName().equals(i.getPackage())) return;
            startActivity(i);
        } catch (Exception e) {
            Toast.makeText(this, R.string.no_app, Toast.LENGTH_SHORT).show();
        }
    }

    /** Files (e-books, PDFs) go to Downloads through the system (GL-DL). */
    private void download(String url, String ua, String disposition, String mime) {
        Uri uri = Uri.parse(url);
        if (!"https".equals(uri.getScheme())) return;
        // Android 7-9 need a storage permission for public Downloads; the
        // browser has it, so the file goes there.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            openOutside(uri);
            return;
        }
        String name = URLUtil.guessFileName(url, disposition, mime);
        DownloadManager.Request r = new DownloadManager.Request(uri)
                .setMimeType(mime)
                .addRequestHeader("User-Agent", ua)
                .setTitle(name)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
        // Only the shop's own cookies, so a bought e-book downloads signed in.
        if (Links.isSiteHost(uri.getHost())) {
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) r.addRequestHeader("Cookie", cookies);
        }
        DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null) {
            openOutside(uri);
            return;
        }
        dm.enqueue(r);
        Toast.makeText(this, getString(R.string.downloading, name), Toast.LENGTH_SHORT).show();
    }

    /**
     * GL-NEW is off until the person says yes, asked once after the first
     * page has loaded. Android's own app settings turn it off again.
     */
    private void askNotifyOnce() {
        android.content.SharedPreferences p = ReleaseJob.prefs(this);
        if (p.getBoolean(ReleaseJob.KEY_ASKED, false) || isFinishing()) return;
        p.edit().putBoolean(ReleaseJob.KEY_ASKED, true).apply();
        new AlertDialog.Builder(this)
                .setTitle(R.string.ask_title)
                .setMessage(R.string.ask_text)
                .setPositiveButton(R.string.ask_yes, (d, w) -> enableNotify())
                .setNegativeButton(R.string.ask_no, null)
                .show();
    }

    private void enableNotify() {
        ReleaseJob.prefs(this).edit().putBoolean(ReleaseJob.KEY_ON, true).apply();
        ReleaseJob.schedule(this);
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {android.Manifest.permission.POST_NOTIFICATIONS}, ASK_NOTIFY);
        }
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] perms, int[] results) {
        if (request == ASK_NOTIFY && (results.length == 0 || results[0] != android.content.pm.PackageManager.PERMISSION_GRANTED)) {
            // Said no to Android's question: stop checking.
            ReleaseJob.prefs(this).edit().putBoolean(ReleaseJob.KEY_ON, false).apply();
            ReleaseJob.schedule(this);
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request == PICK_FILE && pendingFiles != null) {
            pendingFiles.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            pendingFiles = null;
            return;
        }
        super.onActivityResult(request, result, data);
    }

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri uri = req.getUrl();
            switch (Links.route(uri.getScheme(), uri.getHost(), req.hasGesture(), req.isRedirect())) {
                case APP:
                    return false;
                case BROWSER:
                    openOutside(uri);
                    return true;
                case OTHER_APP:
                    if ("intent".equalsIgnoreCase(uri.getScheme())) openIntentLink(uri.toString());
                    else openOutside(uri);
                    return true;
                default:
                    return true;
            }
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            progress.setVisibility(View.VISIBLE);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            progress.setVisibility(View.GONE);
            if (url != null && Links.isSiteHost(Uri.parse(url).getHost())) {
                view.evaluateJavascript(SHARE_SHIM, null);
                askNotifyOnce();
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (!req.isForMainFrame()) return;
            failedUrl = req.getUrl().toString();
            progress.setVisibility(View.GONE);
            showOffline(true);
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int pct) {
            progress.setProgress(pct);
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> files, FileChooserParams params) {
            // Forms on the site (manuscripts, returns) can attach files.
            if (pendingFiles != null) pendingFiles.onReceiveValue(null);
            pendingFiles = files;
            try {
                startActivityForResult(params.createIntent(), PICK_FILE);
            } catch (ActivityNotFoundException e) {
                pendingFiles = null;
                files.onReceiveValue(null);
                Toast.makeText(MainActivity.this, R.string.no_app, Toast.LENGTH_SHORT).show();
            }
            return true;
        }
    }
}
