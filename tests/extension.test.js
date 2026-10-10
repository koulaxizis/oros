// "Send to orOS" browser add-on (extension/): the pure helpers in
// core.js, the manifest and the two locales. Plain node, no browser.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "extension");
const X = require(path.join(DIR, "core.js"));
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");

test("normBase: https anywhere, http only on localhost, path ends in /", () => {
  assert.equal(X.normBase("useoros.online"), "https://useoros.online/");
  assert.equal(X.normBase(" https://useoros.online/?x=1#y "), "https://useoros.online/");
  assert.equal(X.normBase("https://example.org/oros"), "https://example.org/oros/");
  assert.equal(X.normBase("http://localhost:8080"), "http://localhost:8080/");
  assert.equal(X.normBase("http://127.0.0.1:5500/"), "http://127.0.0.1:5500/");
  assert.equal(X.normBase("http://useoros.online/"), null);
  assert.equal(X.normBase("javascript:alert(1)"), null);
  assert.equal(X.normBase("https://user:pw@example.org/"), null);
  assert.equal(X.normBase(""), null);
  assert.equal(X.normBase(null), null);
});

test("isSavable: web pages only", () => {
  assert.ok(X.isSavable("https://example.org/a?b=1#c"));
  assert.ok(X.isSavable("http://example.org/"));
  ["chrome://settings", "about:newtab", "file:///etc/passwd", "data:text/html,x",
   "javascript:alert(1)", "moz-extension://abc/x.html", "", undefined,
   "https://x.org/" + "a".repeat(3000)].forEach((u) => assert.equal(X.isSavable(u), false, String(u)));
});

test("shareUrl: the parameters shell.js reads, title clipped", () => {
  const u = new URL(X.shareUrl("https://useoros.online/", "https://example.org/a?b=1&c=2", "  A  <b>title</b>\n"));
  assert.equal(u.origin + u.pathname, "https://useoros.online/");
  assert.equal(u.searchParams.get("share-url"), "https://example.org/a?b=1&c=2");
  assert.equal(u.searchParams.get("share-title"), "A <b>title</b>");
  assert.equal(new URL(X.shareUrl("bad base", "https://e.org/", "t")).origin, "https://useoros.online");
  assert.equal(new URL(X.shareUrl(null, "https://e.org/", "x".repeat(400))).searchParams.get("share-title").length, 256);
});

test("searchUrl: ?search= with the words, empty opens orOS", () => {
  assert.equal(new URL(X.searchUrl("https://useoros.online/", " γιάννης  αθήνα ")).searchParams.get("search"), "γιάννης αθήνα");
  assert.equal(X.searchUrl("https://useoros.online/", "   "), "https://useoros.online/");
});

test("manifest: MV3, minimal permissions, files exist", () => {
  const m = JSON.parse(read("manifest.json"));
  assert.equal(m.manifest_version, 3);
  assert.match(m.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(m.permissions.slice().sort(), ["activeTab", "contextMenus", "storage"]);
  assert.equal(m.host_permissions, undefined);
  assert.equal(m.content_scripts, undefined);
  const files = [m.background.service_worker, ...m.background.scripts, m.options_ui.page,
    ...Object.values(m.icons), ...Object.values(m.action.default_icon)];
  files.forEach((f) => assert.ok(fs.existsSync(path.join(DIR, f)), f));
  assert.ok(m.browser_specific_settings.gecko.id);
});

test("locales: en and el have the same keys, every key used exists", () => {
  const en = JSON.parse(read("_locales/en/messages.json"));
  const el = JSON.parse(read("_locales/el/messages.json"));
  assert.deepEqual(Object.keys(el).sort(), Object.keys(en).sort());
  Object.values(en).concat(Object.values(el)).forEach((v) => assert.ok(v.message && v.message.trim()));
  const used = new Set();
  const all = read("manifest.json") + read("background.js") + read("options.html") + read("options.js");
  for (const m of all.matchAll(/__MSG_(\w+)__/g)) used.add(m[1]);
  for (const m of all.matchAll(/(?:msg\(|data-i18n=)"(\w+)"/g)) used.add(m[1]);
  assert.ok(used.size > 10);
  used.forEach((k) => assert.ok(en[k], "missing key " + k));
  assert.ok(en.extDesc.message.length <= 132 && el.extDesc.message.length <= 132);
});
