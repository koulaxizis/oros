// Link previews (Open Graph + Twitter/X card + canonical) on the public
// pages. A link to useoros.online pasted into a chat or a social post
// shows the title, the description and icons/og-image.png (1200x630).
// Crawlers do not run JS, so the tags must be in the static <head>.
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE = "https://useoros.online";
const IMG = SITE + "/icons/og-image.png";

const PAGES = {
  "index.html": SITE + "/",
  "download/index.html": SITE + "/download/",
  "privacy.html": SITE + "/privacy.html",
  "help/index.html": SITE + "/help/",
};

function head(file) {
  const html = fs.readFileSync(path.join(ROOT, file), "utf8");
  return html.slice(0, html.indexOf("</head>"));
}
function meta(h, attr, name) {
  const re = new RegExp("<meta " + attr + '="' + name.replace(/[:.]/g, "\\$&") + '" content="([^"]*)">', "g");
  return [...h.matchAll(re)].map((m) => m[1]);
}

for (const [file, url] of Object.entries(PAGES)) {
  test("link preview tags: " + file, () => {
    const h = head(file);
    const canon = [...h.matchAll(/<link rel="canonical" href="([^"]*)">/g)].map((m) => m[1]);
    assert.deepStrictEqual(canon, [url], "one canonical link to " + url);
    assert.deepStrictEqual(meta(h, "property", "og:url"), [url]);
    assert.deepStrictEqual(meta(h, "property", "og:image"), [IMG]);
    assert.deepStrictEqual(meta(h, "property", "og:image:width"), ["1200"]);
    assert.deepStrictEqual(meta(h, "property", "og:image:height"), ["630"]);
    assert.deepStrictEqual(meta(h, "name", "twitter:card"), ["summary_large_image"]);
    assert.deepStrictEqual(meta(h, "name", "twitter:image"), [IMG]);
    for (const [attr, name] of [["property", "og:title"], ["property", "og:description"], ["property", "og:image:alt"],
      ["name", "twitter:title"], ["name", "twitter:description"], ["name", "description"]]) {
      const v = meta(h, attr, name);
      assert.strictEqual(v.length, 1, file + ": one " + name);
      assert.ok(v[0].trim().length > 5, file + ": " + name + " has text");
    }
    // The CSP meta stays first after <meta charset> (Q6): a CSP meta only covers what follows it.
    assert.ok(h.indexOf("Content-Security-Policy") < h.indexOf("og:title"), file + ": CSP before the preview tags");
  });
}

test("link preview image: a 1200x630 PNG under 1 MB", () => {
  const png = fs.readFileSync(path.join(ROOT, "icons/og-image.png"));
  assert.strictEqual(png.toString("ascii", 1, 4), "PNG");
  assert.strictEqual(png.readUInt32BE(16), 1200);
  assert.strictEqual(png.readUInt32BE(20), 630);
  assert.ok(png.length < 1024 * 1024, "size " + png.length);
});
