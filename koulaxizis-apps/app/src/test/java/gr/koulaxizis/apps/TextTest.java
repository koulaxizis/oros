package gr.koulaxizis.apps;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class TextTest {
    @Test
    public void plainTextKeepsItsParagraphsAndIsEscaped() {
        assertFalse(Text.isHtml("a < b and c > d"));
        assertEquals("One &lt;two&gt; &amp; three.<br><br>Second line", Text.html("One <two> & three.\n\nSecond line\n"));
    }

    @Test
    public void fdroidHtmlKeepsItsTagsWithoutEmptyLinesAroundLists() {
        String d = "Intro.\n\n<b>What it does</b>\n<ul>\n<li>Mixer</li>\n<li>FX</li>\n</ul>\n\nEnd.";
        assertTrue(Text.isHtml(d));
        assertEquals("Intro.<br><br><b>What it does</b><ul><li>Mixer</li><li>FX</li></ul><br>End.", Text.html(d));
    }

    @Test
    public void scriptsImagesAndOtherTagsNeverPass() {
        String d = "<b>Hi</b><script>alert(1)</script><img src=x onerror=y><style>p{}</style>"
            + "<a href=\"javascript:alert(1)\">x</a><iframe>t</iframe>";
        assertEquals("<b>Hi</b>xt", Text.html(d));
        assertEquals("", Text.html(null));
    }
}
