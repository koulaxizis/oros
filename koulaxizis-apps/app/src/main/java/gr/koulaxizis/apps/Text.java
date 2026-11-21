package gr.koulaxizis.apps;

import java.util.regex.Pattern;

/**
 * A store description as the app's page shows it (APPS-M5). F-Droid
 * descriptions are plain text with blank lines between paragraphs, or the
 * small HTML F-Droid allows (b, i, ul, li, p, a). Both become HTML for
 * {@code Html.fromHtml}: plain text is escaped, every line break is kept
 * except next to a block tag (so a list does not get empty lines). Only
 * text tags stay: links keep their words but not their address (the page
 * has its own Website and Source code buttons), and images, scripts and
 * styles are taken out here; fromHtml gets no image loader.
 */
final class Text {
    private Text() {}

    private static final Pattern TAG = Pattern.compile("</?(b|i|u|em|strong|ul|ol|li|p|br|tt|big|small)(\\s[^<>]*)?/?>",
        Pattern.CASE_INSENSITIVE);
    private static final Pattern DROP = Pattern.compile("<(script|style)[^>]*>.*?</\\1\\s*>|<[^<>]*>",
        Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern BLOCK_END = Pattern.compile("</?(ul|ol|li|p)(\\s[^<>]*)?>\\s*$", Pattern.CASE_INSENSITIVE);
    private static final Pattern BLOCK_START = Pattern.compile("^\\s*</?(ul|ol|li|p)(\\s[^<>]*)?>", Pattern.CASE_INSENSITIVE);

    static boolean isHtml(String s) {
        return s != null && TAG.matcher(s).find();
    }

    static String html(String description) {
        if (description == null) return "";
        String s = description.replace("\r\n", "\n").replace('\r', '\n').trim();
        if (isHtml(s)) {
            s = keepTags(s);
        } else {
            s = escape(s);
        }
        String[] lines = s.split("\n", -1);
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < lines.length; i++) {
            if (i > 0 && !BLOCK_END.matcher(lines[i - 1]).find() && !BLOCK_START.matcher(lines[i]).find()) {
                out.append("<br>");
            }
            out.append(lines[i]);
        }
        return out.toString();
    }

    /** Only F-Droid's few tags stay; any other tag goes (its text stays, a script's or style's does not). */
    private static String keepTags(String s) {
        StringBuilder out = new StringBuilder();
        java.util.regex.Matcher m = DROP.matcher(s);
        int at = 0;
        while (m.find()) {
            out.append(s, at, m.start());
            String tag = m.group();
            if (TAG.matcher(tag).matches() && tag.indexOf('=') < 0) out.append(tag);
            at = m.end();
        }
        out.append(s.substring(at));
        return out.toString();
    }

    static String escape(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
