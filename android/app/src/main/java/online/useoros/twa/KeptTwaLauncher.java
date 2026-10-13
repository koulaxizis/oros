package online.useoros.twa;

import android.content.Context;

import androidx.annotation.Nullable;
import androidx.browser.customtabs.CustomTabsSession;
import androidx.browser.trusted.TokenStore;

import com.google.androidbrowserhelper.trusted.TwaLauncher;

import java.lang.reflect.Field;

/**
 * A TwaLauncher whose destroy() (called when LauncherActivity finishes)
 * keeps the Custom Tabs service binding, so the TWA session stays usable
 * for postMessage. PhoneBridge really destroys it when a newer launch
 * replaces it.
 */
class KeptTwaLauncher extends TwaLauncher {
    KeptTwaLauncher(Context context, @Nullable String providerPackage, @Nullable Integer sessionId,
            TokenStore tokenStore) {
        super(context, providerPackage, sessionId, tokenStore);
    }

    @Override
    public void destroy() {
        // Kept on purpose; see reallyDestroy().
    }

    void reallyDestroy() {
        super.destroy();
    }

    /** The browser package serving the TWA (for diagnostics). */
    @Nullable
    String provider() {
        try {
            Field f = TwaLauncher.class.getDeclaredField("mProviderPackage");
            f.setAccessible(true);
            return (String) f.get(this);
        } catch (ReflectiveOperationException | ClassCastException e) {
            return null;
        }
    }

    /** The session TwaLauncher created (private there; the field name is
     *  kept by proguard-rules.pro). Null until the service connected. */
    @Nullable
    CustomTabsSession session() {
        try {
            Field f = TwaLauncher.class.getDeclaredField("mSession");
            f.setAccessible(true);
            return (CustomTabsSession) f.get(this);
        } catch (ReflectiveOperationException | ClassCastException e) {
            return null;
        }
    }
}
