package online.useoros.twa;

import android.accounts.AbstractAccountAuthenticator;
import android.accounts.Account;
import android.accounts.AccountAuthenticatorResponse;
import android.accounts.NetworkErrorException;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.IBinder;

/** Stub authenticator for the "orOS" account. The account has no
 *  password or token: it only owns the rows the phone bridge writes. */
public class AuthenticatorService extends Service {
    private Stub stub;

    @Override
    public void onCreate() {
        stub = new Stub(this);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return stub.getIBinder();
    }

    static class Stub extends AbstractAccountAuthenticator {
        Stub(Context c) { super(c); }
        @Override public Bundle editProperties(AccountAuthenticatorResponse r, String t) { throw new UnsupportedOperationException(); }
        @Override public Bundle addAccount(AccountAuthenticatorResponse r, String t, String a, String[] f, Bundle o) { return null; }
        @Override public Bundle confirmCredentials(AccountAuthenticatorResponse r, Account a, Bundle o) { return null; }
        @Override public Bundle getAuthToken(AccountAuthenticatorResponse r, Account a, String t, Bundle o) throws NetworkErrorException { throw new UnsupportedOperationException(); }
        @Override public String getAuthTokenLabel(String t) { throw new UnsupportedOperationException(); }
        @Override public Bundle updateCredentials(AccountAuthenticatorResponse r, Account a, String t, Bundle o) { throw new UnsupportedOperationException(); }
        @Override public Bundle hasFeatures(AccountAuthenticatorResponse r, Account a, String[] f) { throw new UnsupportedOperationException(); }
    }
}
