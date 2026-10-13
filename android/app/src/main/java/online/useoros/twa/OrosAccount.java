package online.useoros.twa;

import android.accounts.Account;
import android.accounts.AccountManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.provider.CalendarContract;
import android.provider.ContactsContract;

/** The single "orOS" account that owns the mirrored rows. */
final class OrosAccount {
    static final String NAME = "orOS";

    private OrosAccount() {}

    static Account get(Context c) {
        return new Account(NAME, c.getString(R.string.account_type));
    }

    /**
     * Creates the account once, then (every time, so a setup that was
     * cut short heals itself) marks it syncable and its contacts visible.
     * Without the visibility row most Contacts apps hide the account.
     */
    static synchronized Account ensure(Context c) {
        Account acc = get(c);
        AccountManager am = AccountManager.get(c);
        boolean have = false;
        for (Account a : am.getAccountsByType(acc.type)) {
            if (a.name.equals(acc.name)) { have = true; break; }
        }
        if (!have) am.addAccountExplicitly(acc, null, null);
        try {
            ContentResolver.setIsSyncable(acc, ContactsContract.AUTHORITY, 1);
            ContentResolver.setIsSyncable(acc, CalendarContract.AUTHORITY, 1);
            ContentResolver.setSyncAutomatically(acc, ContactsContract.AUTHORITY, false);
            ContentResolver.setSyncAutomatically(acc, CalendarContract.AUTHORITY, false);
        } catch (RuntimeException ignored) {
            // Sync settings are a nicety; the mirrored rows work without them.
        }
        try {
            Uri uri = asSyncAdapter(ContactsContract.Settings.CONTENT_URI, acc);
            ContentValues v = new ContentValues();
            v.put(ContactsContract.Settings.UNGROUPED_VISIBLE, 1);
            v.put(ContactsContract.Settings.SHOULD_SYNC, 0);
            String where = ContactsContract.Settings.ACCOUNT_NAME + "=? AND " + ContactsContract.Settings.ACCOUNT_TYPE + "=?";
            if (c.getContentResolver().update(uri, v, where, new String[]{acc.name, acc.type}) == 0) {
                v.put(ContactsContract.Settings.ACCOUNT_NAME, acc.name);
                v.put(ContactsContract.Settings.ACCOUNT_TYPE, acc.type);
                c.getContentResolver().insert(uri, v);
            }
        } catch (RuntimeException ignored) {
            // Contacts permission not granted yet: visibility is set on the first write.
        }
        return acc;
    }

    static Uri asSyncAdapter(Uri uri, Account acc) {
        return uri.buildUpon()
                .appendQueryParameter(ContactsContract.CALLER_IS_SYNCADAPTER, "true")
                .appendQueryParameter(ContactsContract.RawContacts.ACCOUNT_NAME, acc.name)
                .appendQueryParameter(ContactsContract.RawContacts.ACCOUNT_TYPE, acc.type)
                .build();
    }

    static Uri asCalendarSyncAdapter(Uri uri, Account acc) {
        return uri.buildUpon()
                .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
                .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME, acc.name)
                .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE, acc.type)
                .build();
    }
}
