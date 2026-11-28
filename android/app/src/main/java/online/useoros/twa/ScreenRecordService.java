package online.useoros.twa;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.MediaRecorder;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Records the phone's screen (QS-REC-1 Android) with MediaProjection into
 * an MP4 (H.264, 30 frames a second, the screen scaled to at most 1920 ×
 * 1080, with the microphone only when asked for and allowed). A
 * foreground service with a notification that says it records and has
 * Stop; Android's own projection chip stops it too.
 *
 * The video goes to the phone's Movies/orOS folder (Android 10+, through
 * MediaStore: the gallery and Files show it; Android 7–9: the app's own
 * Movies folder), never anywhere else: no network. When it is saved a
 * notification says so, and a tap opens it.
 */
public class ScreenRecordService extends Service {
    static final String CH = "screenrec";
    private static final int NOTE_REC = 7301, NOTE_DONE = 7302;
    private static final String ACT_START = "start", ACT_STOP = "stop";
    private static final int BPS = 6_000_000, FPS = 30;

    private static volatile boolean running;
    private MediaProjection projection;
    private VirtualDisplay display;
    private MediaRecorder recorder;
    private ParcelFileDescriptor pfd;
    private Uri item;      // MediaStore entry (Android 10+)
    private File file;     // the app's own folder (Android 7–9)
    private boolean stopping;

    static boolean running() { return running; }

    static void start(Context c, int resultCode, Intent data, boolean mic) {
        Intent i = new Intent(c, ScreenRecordService.class).setAction(ACT_START)
                .putExtra("code", resultCode).putExtra("data", data).putExtra("mic", mic);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    static void stop(Context c) {
        if (!running) return;
        c.startService(new Intent(c, ScreenRecordService.class).setAction(ACT_STOP));
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String act = intent != null ? intent.getAction() : null;
        if (ACT_STOP.equals(act)) { finish(); return START_NOT_STICKY; }
        if (!ACT_START.equals(act) || running) { if (!running) stopSelf(); return START_NOT_STICKY; }
        boolean mic = intent.getBooleanExtra("mic", false)
                && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        // Android 14: the service is in the foreground before the projection is taken.
        Notification n = recNote();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                int type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
                if (mic && Build.VERSION.SDK_INT >= 30) type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
                startForeground(NOTE_REC, n, type);
            } else {
                startForeground(NOTE_REC, n);
            }
        } catch (RuntimeException e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        Intent data = intent.getParcelableExtra("data");
        MediaProjectionManager pm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        try {
            projection = pm.getMediaProjection(intent.getIntExtra("code", 0), data);
        } catch (RuntimeException e) {
            projection = null;
        }
        if (projection == null) { cleanUp(false); return START_NOT_STICKY; }
        running = true;
        projection.registerCallback(new MediaProjection.Callback() {
            @Override
            public void onStop() { finish(); }   // Android's own chip, or the screen locked
        }, new Handler(Looper.getMainLooper()));
        if (!begin(mic)) { cleanUp(false); }
        return START_NOT_STICKY;
    }

    /** The recorder on a virtual display the size of the screen (scaled). */
    private boolean begin(boolean mic) {
        DisplayMetrics dm = new DisplayMetrics();
        WindowManager wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        wm.getDefaultDisplay().getRealMetrics(dm);
        int[] wh = fit(dm.widthPixels, dm.heightPixels);
        try {
            recorder = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(this) : new MediaRecorder();
            if (mic) recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264);
            if (mic) {
                recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                recorder.setAudioEncodingBitRate(128_000);
                recorder.setAudioSamplingRate(44_100);
            }
            recorder.setVideoSize(wh[0], wh[1]);
            recorder.setVideoFrameRate(FPS);
            recorder.setVideoEncodingBitRate(BPS);
            if (!openOutput()) return false;
            if (pfd != null) recorder.setOutputFile(pfd.getFileDescriptor());
            else recorder.setOutputFile(file.getAbsolutePath());
            recorder.prepare();
            display = projection.createVirtualDisplay("orOS screen recording", wh[0], wh[1], dm.densityDpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, recorder.getSurface(), null, null);
            recorder.start();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** At most 1920 × 1080 (either way round), even sizes for the encoder. */
    static int[] fit(int w, int h) {
        double s = Math.min(1.0, Math.min(1920.0 / Math.max(w, h), 1080.0 / Math.max(1, Math.min(w, h))));
        int ow = ((int) Math.round(w * s)) & ~1, oh = ((int) Math.round(h * s)) & ~1;
        return new int[]{Math.max(2, ow), Math.max(2, oh)};
    }

    static String fileName(Date d) {
        return "orOS screen recording " + new SimpleDateFormat("yyyy-MM-dd HH-mm-ss", Locale.ROOT).format(d) + ".mp4";
    }

    private boolean openOutput() {
        String name = fileName(new Date());
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Video.Media.DISPLAY_NAME, name);
                v.put(MediaStore.Video.Media.MIME_TYPE, "video/mp4");
                v.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/orOS");
                v.put(MediaStore.Video.Media.IS_PENDING, 1);
                ContentResolver cr = getContentResolver();
                item = cr.insert(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
                if (item == null) return false;
                pfd = cr.openFileDescriptor(item, "w");
                return pfd != null;
            }
            File dir = getExternalFilesDir(Environment.DIRECTORY_MOVIES);
            if (dir == null) return false;
            dir.mkdirs();
            file = new File(dir, name);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Stop and keep the video (Stop, the chip, or orOS's button again). */
    private void finish() {
        if (stopping) return;
        stopping = true;
        boolean ok = false;
        if (recorder != null) {
            try { recorder.stop(); ok = true; } catch (RuntimeException e) { ok = false; }   // nothing recorded yet
        }
        cleanUp(ok);
    }

    private void cleanUp(boolean keep) {
        running = false;
        if (recorder != null) { try { recorder.release(); } catch (RuntimeException ignored) { } recorder = null; }
        if (display != null) { display.release(); display = null; }
        if (projection != null) { try { projection.stop(); } catch (RuntimeException ignored) { } projection = null; }
        if (pfd != null) { try { pfd.close(); } catch (Exception ignored) { } pfd = null; }
        Uri open = null;
        if (item != null) {
            ContentResolver cr = getContentResolver();
            if (keep) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Video.Media.IS_PENDING, 0);
                cr.update(item, v, null, null);
                open = item;
            } else {
                try { cr.delete(item, null, null); } catch (RuntimeException ignored) { }
            }
            item = null;
        } else if (file != null) {
            if (keep) {
                try { open = androidx.core.content.FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", file); }
                catch (RuntimeException ignored) { }
            } else file.delete();
            file = null;
        }
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        if (open != null) doneNote(open);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (running) finish();
        super.onDestroy();
    }

    private void channel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CH) != null) return;
        nm.createNotificationChannel(new NotificationChannel(CH, getString(R.string.channel_screenrec), NotificationManager.IMPORTANCE_LOW));
    }

    private Notification.Builder builder() {
        channel();
        return Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH) : new Notification.Builder(this);
    }

    private Notification recNote() {
        int f = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent stop = PendingIntent.getService(this, 1,
                new Intent(this, ScreenRecordService.class).setAction(ACT_STOP), f);
        return builder()
                .setSmallIcon(R.drawable.ic_stat_oros)
                .setContentTitle(getString(R.string.rec_running))
                .setContentText(getString(R.string.rec_running_text))
                .setOngoing(true)
                .setUsesChronometer(true)
                .setWhen(System.currentTimeMillis())
                .setContentIntent(stop)
                .addAction(new Notification.Action.Builder(null, getString(R.string.rec_stop), stop).build())
                .build();
    }

    private void doneNote(Uri video) {
        Intent view = new Intent(Intent.ACTION_VIEW).setDataAndType(video, "video/mp4")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(this, 2, view, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = builder()
                .setSmallIcon(R.drawable.ic_stat_oros)
                .setContentTitle(getString(R.string.rec_saved))
                .setContentText(getString(R.string.rec_saved_text))
                .setAutoCancel(true)
                .setContentIntent(pi)
                .build();
        try {
            ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(NOTE_DONE, n);
        } catch (SecurityException ignored) { }
    }
}
