package online.useoros.twa;

import android.accounts.Account;
import android.content.AbstractThreadedSyncAdapter;
import android.content.ContentProviderClient;
import android.content.Context;
import android.content.SyncResult;
import android.os.Bundle;

/**
 * Contacts and Calendar list an account's data only when the account
 * has a sync adapter for them. There is nothing to sync from here: the
 * data lives encrypted in orOS and only the open page can read it, so
 * PhoneBridge writes whenever the page sends a snapshot.
 */
class NoopSyncAdapter extends AbstractThreadedSyncAdapter {
    private static NoopSyncAdapter instance;

    static synchronized NoopSyncAdapter get(Context c) {
        if (instance == null) instance = new NoopSyncAdapter(c.getApplicationContext());
        return instance;
    }

    private NoopSyncAdapter(Context c) {
        super(c, true);
    }

    @Override
    public void onPerformSync(Account account, Bundle extras, String authority,
            ContentProviderClient provider, SyncResult syncResult) {
        // Nothing to pull: see the class comment.
    }
}
