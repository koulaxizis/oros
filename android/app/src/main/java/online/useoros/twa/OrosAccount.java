package online.useoros.twa;

import android.accounts.Account;
import android.accounts.AccountManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.provider.CalendarContract;
import android.provider.ContactsContract;

/** The single "orOS" account that owns the mirrored rows. */
final class OrosAccount {
    static final String NAME = "orOS";
    private static final String PREFS = "oros-account";
    private static final String SYNC_ON_SET = "sync-on-set";

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
            // Contacts and Calendar each have a switch in Settings ›
            // Accounts › orOS. They start on once (earlier versions set
            // them off), after that they are the person's choice.
            SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (!sp.getBoolean(SYNC_ON_SET, false)) {
                ContentResolver.setSyncAutomatically(acc, ContactsContract.AUTHORITY, true);
                ContentResolver.setSyncAutomatically(acc, CalendarContract.AUTHORITY, true);
                sp.edit().putBoolean(SYNC_ON_SET, true).apply();
            }
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

    /** Whether the person left this kind's switch on in Settings › Accounts › orOS. */
    static boolean syncOn(Context c, String authority) {
        Account acc = ensure(c);
        try {
            return ContentResolver.getSyncAutomatically(acc, authority);
        } catch (RuntimeException e) {
            return true;
        }
    }

    /**
     * After a write: a short sync run, so Settings › Accounts › orOS
     * shows "Last synced" for this kind like any other account does.
     */
    static void synced(Context c, String authority) {
        Bundle b = new Bundle();
        b.putBoolean(ContentResolver.SYNC_EXTRAS_MANUAL, true);
        b.putBoolean(ContentResolver.SYNC_EXTRAS_EXPEDITED, true);
        try {
            ContentResolver.requestSync(get(c), authority, b);
        } catch (RuntimeException ignored) {
            // Only the time shown in Settings is lost.
        }
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
