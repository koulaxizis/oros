package online.useoros.twa;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

/** Declares the "orOS" account to Contacts (see NoopSyncAdapter). */
public class ContactsSyncService extends Service {
    @Override
    public IBinder onBind(Intent intent) {
        return NoopSyncAdapter.get(this).getSyncAdapterBinder();
    }
}
