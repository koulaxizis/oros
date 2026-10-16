// The .orospodcasts file (Podcasts): every subscription with its
// settings, floor and episode progress through the shared kit
// (recordpkg.js) and bundle.js; opening adds only what is missing,
// with its ids. Plus the app wiring (Save, Open, unzipped folder,
// "Open with" for both .orospodcasts and .opml).
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const C = require(path.join(ROOT, "podcasts/core.js")).OrosPodcastsCore;
const P = require(path.join(ROOT, "podcasts/package.js"));
const FC = require(path.join(ROOT, "feeds/core.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = Date.now();
const clone = (x) => JSON.parse(JSON.stringify(x));

const U1 = "https://one.example/feed.xml", U2 = "https://two.example/rss", U3 = "https://gone.example/rss";
const S1 = C.showId(U1), S2 = C.showId(U2), S3 = C.showId(U3);
const E1 = "e" + "a1b2c3d4e5f6g", E2 = "e" + "z9y8x7w6v5u4t", E3 = "e" + "q1q2q3q4q5q6q";

function slice() {
  let d = C.emptyData();
  d = C.subscribe(d, { url: U1, title: "=One & <b>" }, NOW - 9000);
  d = C.subscribe(d, { url: U2, title: "Two" }, NOW - 8000);
  d = C.editShow(d, S2, { spd: 1.5, ntf: 1 }, NOW - 7000);
  d = C.setProgress(d, { id: E1, s: S1, pd: NOW - 86400000 * 3 }, 120, 1800, undefined, NOW - 6000);
  d = C.setProgress(d, { id: E2, s: S2, pd: NOW - 86400000 * 2 }, 0, 900, 1, NOW - 5000);
  d = C.setPref(d, "spd", 2, NOW - 4000);
  d = C.queueAdd(d, { id: E1, s: S1 }, "end", NOW - 3000);
  d = C.subscribe(d, { url: U3, title: "Gone" }, NOW - 2900);
  d = C.unsubscribe(d, S3, NOW - 2000);
  d = clone(d);
  d.floors[S1] = NOW - 86400000 * 40;
  return C.mergePodcasts(d, null);
}
function flat(next) {                     // what the app's set hook stores
  const x = P.fold(next);
  return C.mergePodcasts(Object.assign(clone(next), { shows: x.shows, eps: x.eps, floors: x.floors }), null);
}

test("podcasts: round trip through bundle.js; no tombstones, queue, prefs or device data in the file", async () => {
  const o = K.pack(D, slice(), { title: "Podcasts", lang: "en", now: NOW });
  assert.equal(o.mime, "application/x-oros-podcasts");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["shows", "ver"]);
  const txt = JSON.stringify(o.content.data);
  assert.ok(!/tombs|queue|prefs|gpodder|pass|audio/.test(txt), txt);
  assert.deepEqual(o.content.data.shows.map((s) => s.id).sort(), [S1, S2].sort());
  const s1 = o.content.data.shows.find((s) => s.id === S1);
  assert.equal(s1.fl, NOW - 86400000 * 40);
  assert.deepEqual(s1.eps.map((e) => e.id), [E1]);
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-podcasts");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-podcasts-package");
  // preview: OPML that the Reader's own parser reads back, escaped
  const opml = o.preview.find((p) => p.name === "podcasts.opml").data;
  assert.match(opml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<opml version="2.0">/);
  assert.match(opml, /text="=One &amp; &lt;b&gt;"/);
  const back = FC.parseOpml(opml);
  assert.deepEqual(back.map((f) => f.url).sort(), [U1, U2].sort());
  // into an empty device
  const empty = C.emptyData();
  const res = K.open(D, P.nest(empty, true), r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 4, skipped: 0, updated: 0 });     // 2 shows + 2 progress rows
  assert.deepEqual(res.addedIds.slice().sort(), [E1, E2, S1, S2].sort());
  const got = flat(res.next);
  const want = slice();
  assert.deepEqual(got.shows, want.shows);
  assert.deepEqual(got.eps, want.eps);
  assert.deepEqual(got.floors, want.floors);
  assert.deepEqual(got.queue, empty.queue);                               // the device's own queue, prefs
  assert.deepEqual(got.prefs, {});
  // and again: nothing
  const again = K.open(D, P.nest(got, true), r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.equal(again.report.updated, 0);
  assert.deepEqual(flat(again.next), got);
});

test("podcasts: a clash keeps the local record; unsubscribed here stays out; new progress joins a show here", () => {
  const theirs = clone(slice());
  theirs.shows = theirs.shows.map((s) => s.id === S2 ? Object.assign({}, s, { title: "Theirs", spd: 3, m: NOW - 100 }) : s);
  theirs.eps.push({ id: E3, m: NOW - 50, s: S2, p: 33, d: 600, x: 0, pd: NOW - 86400000 });
  // a show this device unsubscribed, subscribed (older) in the file
  theirs.shows.push({ id: S3, m: NOW - 2500, url: U3, title: "Gone", at: NOW - 2500 });
  delete theirs.tombs[S3];
  const c = K.pack(D, C.mergePodcasts(theirs, null), { now: NOW }).content;
  const mine = slice();
  const res = K.open(D, P.nest(mine, true), c, { now: NOW });
  assert.deepEqual(res.addedIds, [E3]);
  assert.equal(res.report.skipped >= 4, true);                             // S1, E1, S2, E2, S3
  const got = flat(res.next);
  const s2 = got.shows.find((s) => s.id === S2);
  assert.equal(s2.title, "Two");
  assert.equal(s2.spd, 1.5);
  assert.ok(!got.shows.some((s) => s.id === S3));
  assert.ok(got.tombs[S3]);
  assert.ok(got.eps.some((e) => e.id === E3 && e.s === S2));
  const upd = K.open(D, P.nest(mine, true), c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds, [S2]);
  const g2 = flat(upd.next);
  assert.equal(g2.shows.find((s) => s.id === S2).title, "Theirs");
  assert.ok(g2.eps.some((e) => e.id === E2));                              // its progress stays
  assert.equal(P.kindOf(S2, upd.next), "show");
  assert.equal(P.kindOf(E3, upd.next), "ep");
  assert.equal(P.kindOf(E2, g2), "ep");
  assert.equal(P.kindOf("nope", g2), "");
});

test("podcasts: hostile content is cut down by core's own checks", () => {
  const far = Date.now() + 10 * 365 * 86400000;
  const n = D.norm({
    shows: [
      { id: S1, m: 5, url: U1, title: "a\u0000b".padEnd(900, "x"), img: "javascript:alert(1)", spd: 99, ntf: "yes", at: far, fl: far, evil: "<script>",
        eps: [{ id: E1, m: 6, s: S1, p: -5, d: "x", x: 7 }, { id: "bad id", m: 1, s: S1 }, { id: E2, m: 1, s: S2 }] },
      { id: "s" + "0000000000000", m: 1, url: "https://not.the.id/feed" },  // id must be the url's hash
      { id: S2, m: 1, url: "file:///etc/passwd" },
      "junk", null
    ],
    floors: { [S1]: 4, __proto__: 1 }, tombs: { [S2]: 9 }, queue: { m: 1, ids: [E1] }, prefs: { spd: [3, 1] }, gpodder: { pass: "x" }
  });
  assert.equal(n.shows.length, 1);
  const s = n.shows[0];
  assert.equal(s.title.length, 200);
  assert.ok(!/\u0000/.test(s.title));
  assert.equal(s.img, "");
  assert.equal(s.spd, 0);
  assert.equal(s.ntf, 0);
  assert.equal(s.evil, undefined);
  assert.ok(s.at <= Date.now() + K.FUTURE);
  assert.ok(s.fl <= Date.now() + K.FUTURE);
  assert.deepEqual(s.eps, [{ id: E1, m: 6, s: S1, p: 0, d: 0, x: 0, pd: 0 }]);
  assert.deepEqual(Object.keys(n).sort(), ["shows", "tombs", "ver"]);
  assert.equal(D.norm("x"), null);
  // through open: the tombstone in the file is ignored, nothing else leaks
  const res = K.open(D, P.nest(C.emptyData(), true), { kind: "oros-podcasts-package", ver: 1, data: {
    shows: [{ id: S1, m: far, url: U1, title: "x", eps: [{ id: E1, m: far, s: S1, p: 1, d: 0, x: 0, pd: 0 }] }],
    tombs: { [S2]: 1 }, prefs: { spd: [3, far] }, queue: { m: far, ids: [E1] } } }, { now: NOW });
  const got = flat(res.next);
  assert.ok(got.shows[0].m <= NOW + K.FUTURE);
  assert.ok(got.eps[0].m <= NOW + K.FUTURE);
  assert.deepEqual(got.prefs, {});
  assert.deepEqual(got.queue.ids, []);
  assert.deepEqual(got.tombs, {});
  assert.throws(() => K.open(D, null, { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
});

test("podcasts: wiring (scripts, buttons, Open with for .orospodcasts and .opml, help, file types)", () => {
  const html = read("podcasts/index.html");
  ["../bundle.js?v=2.50.00", "../recordpkg.js?v=2.50.00", "package.js?v=2.50.00"].forEach((s) =>
    assert.ok(html.includes('src="' + s + '"'), s));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="package.js') && html.indexOf('src="package.js') < html.indexOf('src="podcasts.js'));
  assert.ok(html.indexOf('src="core.js') < html.indexOf('src="package.js'));
  const js = read("podcasts/podcasts.js");
  assert.match(js, /RP\.ui\(PK\.DESC,/);
  assert.match(js, /get: function \(\) \{ return PK\.nest\(D\(\), true\); \}/);
  assert.match(js, /if \(f && recFile\) recFile\.openFile\(f\);\n\s+else if \(f\) opmlFromFile\(f\);/);
  assert.match(js, /notBundle: function \(f\) \{ opmlFromFile\(f\); return true; \}/);
  assert.match(js, /C\.unsubscribe\(d, id, n \|\| now0\)/);
  assert.match(js, /PK\.opml\(shows, "orOS Podcasts", now\(\)\)/);
  ["file.save", "file.open", "file.folder", "file.hint"].forEach((k) =>
    assert.equal((js.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k));
  assert.ok(js.includes("\"file.save\": \"orOS file (.orospodcasts)\""));
  assert.ok(js.includes("\"file.save\": \"Αρχείο orOS (.orospodcasts)\""));
  assert.ok(!/gpodder|GKEY|loadPass/.test(read("podcasts/package.js").replace(/^\/\/.*$/gm, "")));
  for (const f of ["podcasts/help.en.txt", "podcasts/help.el.txt"]) assert.ok(read(f).includes(".orospodcasts"), f);
  assert.deepEqual(F.appsFor(".orospodcasts"), ["podcasts"]);
  assert.ok(F.appsFor(".opml").includes("podcasts"));
  assert.deepEqual(B.TYPES[".orospodcasts"], { app: "podcasts", mime: "application/x-oros-podcasts" });
});

test("podcasts: OPML export is pure and escapes", () => {
  const t = P.opml([{ url: U1, title: "A \"q\" & <x>" }, { url: "javascript:x" }, null], "T&", 0);
  assert.match(t, /<title>T&amp;<\/title>/);
  assert.match(t, /title="A &quot;q&quot; &amp; &lt;x&gt;" xmlUrl="https:\/\/one\.example\/feed\.xml"/);
  assert.ok(!t.includes("javascript"));
  assert.deepEqual(FC.parseOpml(t).map((f) => f.url), [U1]);
});
