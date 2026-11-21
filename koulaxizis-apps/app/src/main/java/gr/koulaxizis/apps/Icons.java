package gr.koulaxizis.apps;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;
import android.widget.ImageView;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Pictures from the repositories, hash-checked like everything else: app
 * icons (kept in the app's files) and the screenshots of an app's page
 * (APPS-M5, kept in the cache folder, which Android may empty). A picture
 * whose SHA-256 differs from the signed index is never shown or kept.
 */
final class Icons {
    private final File dir, shots;
    private final Map<String, Bitmap> mem = new HashMap<>();
    /** Decoded screenshots by hash and size, at most an eighth of the app's memory. */
    private final LruCache<String, Bitmap> big = new LruCache<String, Bitmap>(
        (int) Math.min(Integer.MAX_VALUE, Runtime.getRuntime().maxMemory() / 8)) {
        @Override protected int sizeOf(String k, Bitmap b) { return b.getByteCount(); }
    };
    private final Set<String> failed = new HashSet<>();
    private final ExecutorService pool = Executors.newFixedThreadPool(3);
    private final Handler main = new Handler(Looper.getMainLooper());

    Icons(Context ctx) {
        dir = new File(ctx.getFilesDir(), "icons");
        dir.mkdirs();
        shots = new File(ctx.getCacheDir(), "shots");
        shots.mkdirs();
    }

    void show(ImageView view, AppInfo app) {
        String key = app.iconSha256;
        view.setTag(key);
        Bitmap b = key == null ? null : mem.get(key);
        view.setImageBitmap(b);
        if (b != null || key == null || failed.contains(key)) {
            if (b == null) view.setImageResource(R.drawable.ic_app_placeholder);
            return;
        }
        view.setImageResource(R.drawable.ic_app_placeholder);
        pool.execute(() -> {
            Bitmap got = decode(fetch(new File(dir, key + ".png"), app.iconUrl, key, 1024 * 1024), 0, 0);
            main.post(() -> {
                if (got == null) failed.add(key); else mem.put(key, got);
                if (key.equals(view.getTag()) && got != null) view.setImageBitmap(got);
            });
        });
    }

    /**
     * A screenshot, decoded to about {@code w}×{@code h} pixels (0 = any);
     * {@code done} runs on the main thread with true once it shows, false
     * when it could not be had.
     */
    void shot(ImageView view, AppInfo.Shot s, int w, int h, java.util.function.Consumer<Boolean> done) {
        String key = s.sha256 + "@" + w + "x" + h;
        view.setTag(key);
        Bitmap b = big.get(key);
        if (b != null) {
            view.setImageBitmap(b);
            done.accept(true);
            return;
        }
        view.setImageDrawable(null);
        if (failed.contains(s.sha256)) {
            done.accept(false);
            return;
        }
        pool.execute(() -> {
            Bitmap got = decode(fetch(new File(shots, s.sha256), s.url, s.sha256, s.size), w, h);
            main.post(() -> {
                if (got == null) failed.add(s.sha256); else big.put(key, got);
                if (key.equals(view.getTag())) {
                    if (got != null) view.setImageBitmap(got);
                    done.accept(got != null);
                }
            });
        });
    }

    /** The file's bytes from the phone or the repository; null unless they have the index's SHA-256. */
    private static byte[] fetch(File f, String url, String sha256, long max) {
        try {
            if (f.exists()) {
                byte[] data = Files.readAllBytes(f.toPath());
                if (Hashes.sha256(data).equals(sha256)) return data;
                f.delete();
            }
            if (url == null) return null;
            byte[] data = Net.bytes(url, max);
            if (!Hashes.sha256(data).equals(sha256)) return null;
            File tmp = new File(f.getPath() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(data);
            }
            if (!tmp.renameTo(f)) tmp.delete();
            return data;
        } catch (IOException | RepoException e) {
            return null;
        }
    }

    /** Decodes, scaled down by powers of two while still at least w×h (0 = full size). */
    private static Bitmap decode(byte[] data, int w, int h) {
        if (data == null) return null;
        BitmapFactory.Options o = new BitmapFactory.Options();
        if (w > 0 || h > 0) {
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(data, 0, data.length, o);
            int sample = 1;
            while ((w <= 0 || o.outWidth / (sample * 2) >= w) && (h <= 0 || o.outHeight / (sample * 2) >= h)
                && sample < 64) sample *= 2;
            o = new BitmapFactory.Options();
            o.inSampleSize = sample;
        }
        try {
            return BitmapFactory.decodeByteArray(data, 0, data.length, o);
        } catch (OutOfMemoryError e) {
            return null;
        }
    }
}
