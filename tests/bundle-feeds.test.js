// The .orosfeeds file (Reader): every subscription, folder, saved
// article, tag and rule through the shared kit (recordpkg.js) and
// bundle.js; opening adds only what is missing, with its ids. No
// settings, no read state, no downloaded articles. Plus the app wiring
// (Save, Open, unzipped folder, "Open with" for .orosfeeds and .opml).
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const C = require(path.join(ROOT, "feeds/core.js"));
const P = require(path.join(ROOT, "feeds/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1800000000000;
const clone = (x) => JSON.parse(JSON.stringify(x));

const U1 = "https://example.org/feed.xml", U2 = "https://news.example.com/rss";
const F1 = C.feedId(U1), F2 = C.feedId(U2);
const MAILU = C.mailUrl("acct000001", "Newsletters"), FM = C.feedId(MAILU);

function slice() {
  return C.merge({
    ver: 1,
    feeds: [
      { id: F1, url: U1, title: "Example", site: "https://example.org/", folder: "dtech0001", img: -1, full: 0, m: NOW - 900 },
      { id: F2, url: U2, title: "=News", site: "", folder: "", img: 1, full: 1, m: NOW - 800 },
      { id: FM, url: MAILU, title: "Letters", site: "", folder: "", img: 0, full: 0, m: NOW - 700 }
    ],
    folders: [{ id: "dtech0001", name: "Tech & <b>", ord: 0, m: NOW - 900 }],
    items: [{ id: "isaved0001", feed: F1, title: "Saved [one]", link: "https://example.org/a", date: NOW - 86400000,
              author: "Ann", sum: "summary", star: 1, later: 0, tags: ["tread00001"], m: NOW - 600 }],
    tags: [{ id: "tread00001", name: "read", m: NOW - 650 }],
    rules: [{ id: "rmute00001", name: "mute", q: "sport", in: "title", scope: "", act: "read", tag: "", list: 0, m: NOW - 500 }],
    set: { relay: { v: "https://relay.example.net", m: NOW - 100 }, refresh: { v: 60, m: NOW - 100 } },
    read: { old: NOW - 5 * 86400000, cut: {}, ids: {} },
    tombs: { "f:fgone000001": NOW - 50 }
  }, null);
}

test("feeds: round trip through bundle.js; the file has no tombstones, settings or read state", async () => {
  const o = K.pack(D, slice(), { title: "Reader", lang: "en", now: NOW });
  assert.equal(o.mime, "application/x-oros-feeds");
  assert.equal(o.generator, "orOS Reader");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["feeds", "folders", "items", "rules", "tags", "ver"]);
  const json = JSON.stringify(o.content);
  assert.ok(!json.includes("relay.example.net"), "no settings");
  assert.ok(!json.includes("fgone000001"), "no tombstones");
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-feeds");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-feeds-package");
  assert.deepEqual(r.content.data.feeds, slice().feeds);
  // previews: the app's own OPML (no Mail folder in it) and the saved articles
  const opml = o.preview.find((p) => p.name === "feeds.opml").data;
  assert.deepEqual(C.parseOpml(opml).map((x) => x.url).sort(), [U1, U2].sort());
  assert.match(opml, /<outline text="Tech &amp; &lt;b&gt;"/);
  assert.ok(!opml.includes("oros-mail:"));
  const md = o.preview.find((p) => p.name === "saved.md").data;
  assert.match(md, /^# Saved articles\n\n- \[Saved \\\[one\\\]\]\(<https:\/\/example\.org\/a>\) \(Example · \d{4}-\d{2}-\d{2} · starred, #read\)\n$/);
  // into a device that already follows F2 and has its own settings
  const mine = C.merge({ feeds: [{ id: F2, url: U2, title: "Mine", site: "", folder: "", img: -1, full: 0, m: NOW - 10 }],
    set: { refresh: { v: 15, m: NOW - 5 } }, read: { old: NOW - 1000, cut: {}, ids: {} } }, null);
  const res = K.open(D, mine, r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 6, skipped: 1, updated: 0 });
  assert.deepEqual(res.addedIds.slice().sort(), [F1, FM, "dtech0001", "isaved0001", "rmute00001", "tread00001"].sort());
  assert.equal(C.feedById(res.next, F2).title, "Mine");                      // the device's own copy
  assert.equal(res.next.set.refresh.v, 15);                                   // settings stay
  assert.equal(res.next.set.relay, undefined);
  assert.equal(res.next.read.old, NOW - 1000);                                // read state stays
  assert.deepEqual(C.savedById(res.next, "isaved0001").tags, ["tread00001"]);
  assert.deepEqual(res.next, C.merge(res.next, null));                        // canonical (R26)
  // and again: nothing
  const again = K.open(D, res.next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.deepEqual(again.next, res.next);
});

test("feeds: a clash keeps the local record, a deleted one stays deleted, update takes newer", () => {
  const theirs = slice();
  C.feedById(theirs, F1).title = "Changed later";
  C.feedById(theirs, F1).m = NOW - 1;
  theirs.feeds.push({ id: C.feedId("https://gone.example.net/x"), url: "https://gone.example.net/x", title: "Gone",
                      site: "", folder: "", img: -1, full: 0, m: NOW - 1 });
  theirs.feeds.sort((a, b) => (a.id < b.id ? -1 : 1));
  const goneId = C.feedId("https://gone.example.net/x");
  const mine = slice();
  mine.tombs["f:" + goneId] = NOW - 20;
  const c = K.pack(D, theirs, { now: NOW }).content;
  const res = K.open(D, mine, c, { now: NOW });
  assert.equal(res.report.added, 0);
  assert.equal(C.feedById(res.next, F1).title, "Example");
  assert.equal(C.feedById(res.next, goneId), null);
  assert.equal(res.next.tombs["f:" + goneId], NOW - 20);
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds, [F1]);
  assert.equal(C.feedById(upd.next, F1).title, "Changed later");
  assert.equal(C.feedById(upd.next, goneId), null);
  assert.equal(P.kindOf(F1, res.next), "feed");
  assert.equal(P.kindOf("dtech0001", res.next), "folder");
  assert.equal(P.kindOf("isaved0001", res.next), "item");
  assert.equal(P.kindOf("tread00001", res.next), "tag");
  assert.equal(P.kindOf("rmute00001", res.next), "rule");
  assert.equal(P.kindOf("nope", res.next), "");
  assert.deepEqual(D.tombIds(mine).sort(), ["fgone000001", goneId].sort());
});

test("feeds: hostile content is cut down; stamps from the future are clamped", () => {
  const n = D.norm({
    feeds: [
      { id: F1, url: U1, title: "a\u0000b\n<script>", site: "javascript:alert(1)", folder: "../x", img: 7, m: NOW, onclick: "x" },
      { id: "fwrongid0001", url: U2, title: "id is not the address", m: 1 },
      { id: C.feedId("https://u:p@evil.example/x"), url: "https://u:p@evil.example/x", m: 1 },
      { id: "f" + "1".repeat(11), url: "file:///etc/passwd", m: 1 },
      "junk", null
    ],
    folders: [{ id: "dok0000001", name: "x".repeat(500), m: 1 }, { id: "nope", name: "bad", m: 1 }, { id: "dnoname001", name: "  ", m: 1 }],
    items: [{ id: "iok0000001", feed: F1, title: "t", link: "javascript:alert(1)", sum: "s".repeat(5000), star: 1, m: 1, tags: ["tx", 5] },
            { id: "inothing01", feed: F1, title: "not saved", m: 1 }],
    rules: [{ id: "rok0000001", q: "", m: 1 }],
    set: { relay: { v: "https://evil.example", m: NOW } },
    read: { old: NOW, ids: {} }
  });
  assert.equal(n.feeds.length, 1);
  const f = n.feeds[0];
  assert.equal(f.title, "a b <script>");
  assert.deepEqual([f.site, f.folder, f.img, f.onclick], ["", "", -1, undefined]);
  assert.equal(n.folders.length, 1);
  assert.equal(n.folders[0].name.length, 60);
  assert.equal(n.items.length, 1);
  assert.deepEqual([n.items[0].link, n.items[0].sum.length, n.items[0].tags], ["", 2000, []]);
  assert.equal(n.rules.length, 0);
  assert.equal(D.norm("x"), null);
  assert.equal(D.norm([1]), null);
  // through open: no settings, read state or tombstones come in; m clamped
  const evil = { kind: "oros-feeds-package", ver: 1, data: {
    feeds: [{ id: F1, url: U1, title: "x", m: NOW + 10 * 365 * 86400000 }],
    set: { relay: { v: "https://evil.example", m: NOW + 1e12 } },
    read: { old: NOW + 1e12, cut: {}, ids: {} },
    tombs: { ["f:" + F2]: NOW + 1e12 } } };
  const mine = C.merge({ feeds: [{ id: F2, url: U2, title: "Mine", m: NOW - 10 }] }, null);
  const res = K.open(D, mine, evil, { now: NOW });
  assert.deepEqual(res.addedIds, [F1]);
  assert.equal(C.feedById(res.next, F1).m, NOW + K.FUTURE);
  assert.ok(C.feedById(res.next, F2), "a file never deletes");
  assert.deepEqual(res.next.set, {});
  assert.equal(res.next.read.old, 0);
  assert.deepEqual(res.next.tombs, {});
  assert.throws(() => K.open(D, mine, { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.throws(() => K.open(D, mine, { kind: "oros-feeds-package", ver: 9, data: {} }), /newer/);
});

test("feeds: wiring (scripts, buttons, Open with for .orosfeeds and .opml, help, strings, file types)", () => {
  const html = read("feeds/index.html");
  ["../bundle.js?v=2.50.00", "../recordpkg.js?v=2.50.00", "package.js?v=2.50.00", "feeds.js?v=2.50.00"].forEach((s) =>
    assert.ok(html.includes('src="' + s + '"'), s));
  assert.ok(html.indexOf('src="core.js') < html.indexOf('src="package.js'));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="feeds.js'));
  const js = read("feeds/feeds.js");
  assert.match(js, /RP\.ui\(FPK\.DESC,/);
  assert.match(js, /notBundle: function \(file\) \{ return opmlFromFile\(file\); \}/);
  assert.match(js, /if \(f && recFile\) recFile\.openFile\(f\);\n\s*else if \(f\) opmlFromFile\(f\)/);
  assert.match(js, /deleteIds: function \(ids\) \{ recUndo\(ids\); \}/);
  ["set-osave", "set-oopen", "set-ofolder"].forEach((id) => assert.ok(js.includes('"' + id + '"'), id));
  assert.equal((js.match(/window\.__orosOpenAt\s*=/g) || []).length, 1);
  assert.match(js, /__orosTakeTarget\("feeds"\)/);
  assert.match(js, /"set\.osave": "orOS file \(\.orosfeeds\)", "set\.oopen": "Open orOS file…", "set\.ofolder": "Unzipped orOS folder…"/);
  assert.match(js, /"set\.osave": "Αρχείο orOS \(\.orosfeeds\)", "set\.oopen": "Άνοιγμα αρχείου orOS…", "set\.ofolder": "Αποσυμπιεσμένος φάκελος orOS…"/);
  const en = read("feeds/help.en.txt"), el = read("feeds/help.el.txt");
  assert.ok(en.includes("## Save and open an orOS file") && en.includes(".orosfeeds"));
  assert.ok(el.includes("## Αποθήκευση και άνοιγμα αρχείου orOS") && el.includes(".orosfeeds"));
  assert.equal((en.match(/^#+ /gm) || []).length, (el.match(/^#+ /gm) || []).length);
  assert.deepEqual(F.appsFor(".orosfeeds"), ["feeds"]);
  assert.ok(F.appsFor(".opml").includes("feeds"));
  assert.deepEqual(B.TYPES[".orosfeeds"], { app: "feeds", mime: "application/x-oros-feeds" });
});
