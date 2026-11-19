package net.glarolykoi.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.List;
import org.junit.Test;

/** GL-NEW: what counts as new in the shop. */
public class ReleasesTest {
    private static Releases.Item item(long id) {
        return new Releases.Item(id, "Book " + id, "https://glarolykoi.net/product/b" + id + "/");
    }

    @Test
    public void firstCheckAnnouncesNothing() {
        List<Releases.Item> items = Arrays.asList(item(5), item(9));
        assertTrue(Releases.fresh(items, Releases.NONE).isEmpty());
        assertEquals(9, Releases.newest(items, Releases.NONE));
    }

    @Test
    public void onlyNewerItemsNewestFirst() {
        List<Releases.Item> fresh = Releases.fresh(Arrays.asList(item(8), item(12), item(10), item(3)), 9);
        assertEquals(2, fresh.size());
        assertEquals(12, fresh.get(0).id);
        assertEquals(10, fresh.get(1).id);
    }

    @Test
    public void newestNeverGoesBack() {
        assertEquals(20, Releases.newest(Arrays.asList(item(4)), 20));
        assertEquals(20, Releases.newest(Arrays.asList(), 20));
    }

    @Test
    public void itemsWithoutNameOrLinkAreSkipped() {
        List<Releases.Item> items = Arrays.asList(new Releases.Item(30, "", "https://glarolykoi.net/x/"),
                new Releases.Item(31, "A", null));
        assertTrue(Releases.fresh(items, 1).isEmpty());
    }

    @Test
    public void notificationsOpenOnlyShopLinks() {
        assertTrue(Releases.safeUrl("https://glarolykoi.net/product/mario/"));
        assertTrue(Releases.safeUrl("https://www.glarolykoi.net/shop/?orderby=date"));
        assertFalse(Releases.safeUrl("http://glarolykoi.net/product/mario/"));
        assertFalse(Releases.safeUrl("https://glarolykoi.net.evil.example/"));
        assertFalse(Releases.safeUrl("https://evil.example@glarolykoi.net/"));
        assertFalse(Releases.safeUrl("https://glarolykoi.net:8443/"));
        assertFalse(Releases.safeUrl("javascript:alert(1)"));
        assertFalse(Releases.safeUrl(null));
    }
}
