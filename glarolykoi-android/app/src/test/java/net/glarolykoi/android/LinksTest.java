package net.glarolykoi.android;

import static net.glarolykoi.android.Links.Target.APP;
import static net.glarolykoi.android.Links.Target.BLOCK;
import static net.glarolykoi.android.Links.Target.BROWSER;
import static net.glarolykoi.android.Links.Target.OTHER_APP;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** GL-LINK: where each kind of link opens. */
public class LinksTest {
    @Test
    public void shopStaysInTheApp() {
        assertEquals(APP, Links.route("https", "glarolykoi.net", true, false));
        assertEquals(APP, Links.route("HTTPS", "WWW.Glarolykoi.NET", true, false));
    }

    @Test
    public void vivaCheckoutStaysInTheApp() {
        assertEquals(APP, Links.route("https", "www.vivapayments.com", true, false));
        assertEquals(APP, Links.route("https", "demo.vivapayments.com", true, false));
        assertEquals(APP, Links.route("https", "viva.com", true, false));
    }

    @Test
    public void tappedLinkToAnotherSiteOpensTheBrowser() {
        assertEquals(BROWSER, Links.route("https", "www.facebook.com", true, false));
        assertEquals(BROWSER, Links.route("https", "accounts.google.com", true, false));
    }

    @Test
    public void redirectsAndUntappedLoadsStay() {
        // A bank's 3-D Secure step and the way back to the shop.
        assertEquals(APP, Links.route("https", "acs.somebank.gr", false, false));
        assertEquals(APP, Links.route("https", "acs.somebank.gr", true, true));
    }

    @Test
    public void lookalikeHostsAreNotTheShop() {
        assertFalse(Links.isSiteHost("glarolykoi.net.evil.example"));
        assertFalse(Links.isSiteHost("evilglarolykoi.net"));
        assertFalse(Links.isAppHost("notviva.com"));
        assertTrue(Links.isSiteHost("shop.glarolykoi.net"));
        assertFalse(Links.isSiteHost(null));
        assertEquals(BROWSER, Links.route("https", "evilglarolykoi.net", true, false));
    }

    @Test
    public void plainHttpNeverLoadsInside() {
        assertEquals(BROWSER, Links.route("http", "glarolykoi.net", false, true));
    }

    @Test
    public void phoneMailAndAppLinksGoToOtherApps() {
        for (String s : new String[] {"tel", "mailto", "sms", "geo", "viber", "whatsapp", "market", "intent"}) {
            assertEquals(s, OTHER_APP, Links.route(s, null, true, false));
        }
    }

    @Test
    public void localAndScriptSchemesAreBlocked() {
        for (String s : new String[] {"file", "content", "javascript", "data", "chrome", null}) {
            assertEquals(String.valueOf(s), BLOCK, Links.route(s, "glarolykoi.net", true, false));
        }
    }
}
