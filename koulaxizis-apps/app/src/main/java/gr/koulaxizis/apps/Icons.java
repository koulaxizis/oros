package gr.koulaxizis.apps;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
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

/** App icons from the repositories, hash-checked like everything else and kept on the phone. */
final class Icons {
    private final File dir;
    private final Map<String, Bitmap> mem = new HashMap<>();
    private final Set<String> failed = new HashSet<>();
    private final ExecutorService pool = Executors.newFixedThreadPool(3);
    private final Handler main = new Handler(Looper.getMainLooper());

    Icons(Context ctx) {
        dir = new File(ctx.getFilesDir(), "icons");
        dir.mkdirs();
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
            Bitmap got = load(app);
            main.post(() -> {
                if (got == null) failed.add(key); else mem.put(key, got);
                if (key.equals(view.getTag()) && got != null) view.setImageBitmap(got);
            });
        });
    }

    private Bitmap load(AppInfo app) {
        File f = new File(dir, app.iconSha256 + ".png");
        try {
            byte[] data;
            if (f.exists()) {
                data = Files.readAllBytes(f.toPath());
            } else {
                data = Net.bytes(app.iconUrl, 1024 * 1024);
                if (!Hashes.sha256(data).equals(app.iconSha256)) return null;
                try (FileOutputStream out = new FileOutputStream(f)) {
                    out.write(data);
                }
            }
            return BitmapFactory.decodeByteArray(data, 0, data.length);
        } catch (IOException | RepoException e) {
            return null;
        }
    }
}
