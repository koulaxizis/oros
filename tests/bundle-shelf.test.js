// The .orosshelf file (Media Shelf): every title, its history and the
// yearly goals through the shared kit (recordpkg.js) and bundle.js;
// opening adds only what is missing, with its ids. Plus the app wiring
// (Save, Open, unzipped folder, "Open with") and the package's
// normalisers kept in step with shelf.js.
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const P = require(path.join(ROOT, "shelf/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1800000000000;

// shelf.js sections 1-3, cut out as tests/shelf.test.js does
const src = read("shelf/shelf.js");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const S = new Function("crypto",
  "var LANG = 'en';\n" +
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr(", "  // BOOT MARKER") +
  block("  // ---------- 2. Model", "  // ---------- 4. Derived") +
  "\nreturn { normItem, normSess, normGoal, mergeShelf };")(webcrypto);

const I1 = "item000001", I2 = "item000002", I3 = "item000003";
function item(id, m, over) {
  return Object.assign({ id, m, a: m, type: "book", title: "Title " + id, by: "", year: 0, size: 0,
    fmt: "p", plat: "", st: "want", prio: 0, rate: 0, fav: 0, tags: [], rev: "", src: "", col: 0 }, over || {});
}
function sess(id, m, it, k, d, v) {
  const s = { id, m, it, k, d };
  if (k === "p") s.v = v;
  return s;
}
function slice() {
  return S.mergeShelf({
    ver: 1,
    items: [
      item(I1, NOW - 900, { title: "Dune", by: "Frank Herbert", year: 1965, size: 600, st: "done", rate: 9, fav: 1,
        tags: ["sf"], rev: "Great.\nReally.", lib: "b0123456789abcdef", cov: "https://upload.wikimedia.org/x/dune.jpg" }),
      item(I2, NOW - 800, { type: "film", title: "=HYPERLINK(\"x\")", fmt: "", st: "want" }),
      item("itemgone01", NOW - 700, { title: "Gone" })
    ],
    sess: [sess("sess000001", NOW - 900, I1, "s", "2026-01-02"), sess("sess000002", NOW - 900, I1, "p", "2026-01-05", 300),
           sess("sess000003", NOW - 900, I1, "d", "2026-01-10")],
    goals: { "2026-book": { m: NOW - 500, n: 24 } },
    tombs: { itemgone01: NOW - 100 }
  }, {});
}
function empty() { return { ver: 1, items: [], sess: [], goals: {}, tombs: {} }; }

test("shelf: round trip through bundle.js; no tombstones in the file; previews", async () => {
  const st = slice();
  const o = K.pack(D, st, { title: "Media Shelf", lang: "en", now: NOW });
  assert.equal(o.mime, "application/x-oros-shelf");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["goals", "items", "sess", "ver"]);
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-shelf");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-shelf-package");
  assert.deepEqual(r.content.data.items, st.items);
  assert.deepEqual(r.content.data.sess, st.sess);
  assert.equal(r.content.data.items[0].lib, "b0123456789abcdef");   // the Library link rides along
  const md = o.preview.find((p) => p.name === "shelf.md").data;
  assert.match(md, /^# Media Shelf\n\n## Books\n\n- ♥ \*\*Dune\*\* · Frank Herbert \(Done, 1965, 4\.5★, 2026-01-10\)\n  > Great\. Really\./);
  assert.match(md, /## Goals\n\n- 2026 · Books: 24/);
  const csv = o.preview.find((p) => p.name === "shelf.csv").data;
  assert.match(csv, /^type,title,by,year,status,rating,favourite,tags,started,finished,review\r\n/);
  assert.match(csv, /\r\nbook,Dune,Frank Herbert,1965,done,4\.5,yes,sf,2026-01-02,2026-01-10,"Great\.\nReally\."\r\n/);
  assert.match(csv, /\r\nfilm,"'=HYPERLINK\(""x""\)",,,want,/);       // formula guard
  const pel = K.pack(D, st, { lang: "el", now: NOW }).preview.find((p) => p.name === "shelf.md").data;
  assert.match(pel, /^# Το ράφι μου\n\n## Βιβλία/);

  // into a device with other data
  const mine = S.mergeShelf({ ver: 1, items: [item(I3, NOW - 50, { title: "Mine" })], sess: [], goals: {}, tombs: { x00000000: 5 } }, {});
  const res = K.open(D, mine, r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 6, skipped: 0, updated: 0 });   // 2 items, 3 entries, 1 goal
  assert.deepEqual(res.addedIds.slice().sort(), ["2026-book", I1, I2, "sess000001", "sess000002", "sess000003"].sort());
  const next = S.mergeShelf(res.next, res.next);                          // what saveNow stores
  assert.deepEqual(next.items.map((i) => i.id), [I1, I2, I3]);
  assert.deepEqual(next.tombs, mine.tombs);
  assert.deepEqual(next.goals, { "2026-book": { m: NOW - 500, n: 24 } });
  // and again: nothing
  const again = K.open(D, next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.deepEqual(S.mergeShelf(again.next, again.next), next);
});

test("shelf: a clash keeps the local record; deleted here stays deleted; update takes newer", () => {
  const theirs = slice();
  theirs.items[0].title = "Dune (their copy)";
  theirs.items[0].m = NOW - 10;
  theirs.goals["2026-book"] = { m: NOW - 10, n: 50 };
  theirs.items.push(item("itemdead01", NOW - 10, { title: "Deleted here" }));
  theirs.sess.push(sess("sess000009", NOW - 10, "itemdead01", "s", "2026-02-01"));
  const mine = slice();
  mine.tombs.itemdead01 = NOW - 20;                                        // older than their copy, still deleted here
  mine.tombs.sess000009 = NOW - 20;
  const c = K.pack(D, theirs, { now: NOW }).content;
  const res = K.open(D, mine, c, { now: NOW });
  assert.deepEqual(res.addedIds, []);
  assert.equal(res.next.items.find((i) => i.id === I1).title, "Dune");
  assert.equal(res.next.goals["2026-book"].n, 24);
  assert.ok(!res.next.items.some((i) => i.id === "itemdead01"));
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds.sort(), ["2026-book", I1]);
  assert.equal(upd.next.items.find((i) => i.id === I1).title, "Dune (their copy)");
  assert.deepEqual(upd.next.tombs, mine.tombs);
  assert.equal(P.kindOf(I1, res.next), "item");
  assert.equal(P.kindOf("sess000001", res.next), "sess");
  assert.equal(P.kindOf("2026-book", res.next), "goal");
  assert.equal(P.kindOf("nope", res.next), "");
});

test("shelf: hostile content is cut down; stamps clamped; file tombstones and orphans dropped", () => {
  const bad = {
    kind: "oros-shelf-package", ver: 1,
    data: {
      items: [
        item("evilitem01", NOW + 9e9, { title: "<img src=x onerror=alert(1)>\u0000" + "x".repeat(500), rate: 99, col: -3,
          tags: ["a", "A", 5, "b,c"], cov: "javascript:alert(1)", onclick: { x: 1 }, __proto__x: 1, big: "y".repeat(600), type: "book" }),
        item("BADID", 1), item("short", 1), { id: "item000777", m: 1, title: "no type" }, "junk", null,
        item("tombitem01", NOW - 5)
      ],
      sess: [sess("sess000100", 1, "evilitem01", "p", "2026-02-30", 5), sess("sess000101", 1, "evilitem01", "p", "2026-02-03", -1),
             sess("sess000102", 1, "nosuchitem", "s", "2026-02-03"), sess("sess000103", 1, "evilitem01", "z", "2026-02-03"),
             sess("sess000104", 1, "evilitem01", "s", "2026-02-03")],
      goals: { "2026-book": { m: 1, n: 1e9 }, "evil": { m: 1, n: 1 }, "2026-car": { m: 1, n: 1 }, "2027-game": "x" },
      tombs: { tombitem01: NOW }
    }
  };
  const res = K.open(D, slice(), bad, { now: NOW });
  const it = res.next.items.find((i) => i.id === "evilitem01");
  assert.equal(it.m, NOW + 5 * 60 * 1000);
  assert.equal(it.title.length, 200);
  assert.ok(!/\u0000/.test(it.title));
  assert.deepEqual([it.rate, it.col, it.cov, it.onclick, it.big], [0, 0, undefined, undefined, undefined]);
  assert.deepEqual(it.tags, ["a", "bc"]);
  assert.deepEqual(res.addedIds.sort(), ["evilitem01", "sess000104"]);
  assert.equal(res.next.goals["2026-book"].n, 24);                          // the local goal stays
  assert.ok(!res.next.items.some((i) => i.id === "tombitem01"));
  // an empty device gets the goal, an out-of-range count reset to 0 (as shelf.js does)
  const fresh = K.open(D, empty(), bad, { now: NOW });
  assert.deepEqual(fresh.next.goals, { "2026-book": { m: 1, n: 0 } });
  assert.equal(D.norm("x"), null);
  assert.throws(() => K.open(D, empty(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
});

test("shelf: package.js normalisers match shelf.js", () => {
  const cases = [
    item(I1, 5, { title: "  a\tb  ", tags: ["x", "X", "y,z"], rev: "a\r\n\n\n\nb", fmt: "q", rel: "2026-02-29", wd: "Q42", tmdb: "movie/1",
      cov: "https://image.tmdb.org/t/p/x.jpg", cvby: "me", cvlc: "CC", cvpg: "https://commons.wikimedia.org/wiki/F", lib: "b0123456789abcdef", zz: { o: 1 } }),
    item(I2, 7, { type: "game", plat: "PC\u0007", size: 1e9, year: -1, a: "x", st: "?" }),
    item("short", 1), { id: I3, m: -1, title: "x", type: "book" }, null, "x"
  ];
  cases.forEach((c) => assert.deepEqual(P.normItem(c), S.normItem(c)));
  [sess("sess000001", 1, I1, "p", "2026-01-01", 3), sess("sess000001", 1, I1, "p", "2026-01-01", -3),
   sess("sess000001", 1, I1, "x", "2026-13-01"), sess("sess000001", 1, I1, "d", "2026-01-01")]
    .forEach((c) => assert.deepEqual(P.normSess(c), S.normSess(c)));
  [{ m: 1, n: 5 }, { m: 1, n: 5000 }, { m: -1, n: 1 }, null].forEach((c) => assert.deepEqual(P.normGoal(c), S.normGoal(c)));
});

test("shelf: wiring (scripts, menu items, Open with, Undo, help, file types)", () => {
  const html = read("shelf/index.html");
  ["../bundle.js?v=", "../recordpkg.js?v=", "package.js?v=", "shelf.js?v="].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="shelf.js'));
  assert.ok(html.indexOf('src="package.js') < html.indexOf('src="shelf.js'));
  const js = read("shelf/shelf.js");
  assert.match(js, /RP\.ui\(SPK\.DESC,/);
  assert.match(js, /if \(t && t\.openFile\) \{ if \(recFile\) recFile\.openTarget\(t\.openFile\); return; \}/);
  ["openFile", "__orosTakeFile(", "window.__orosOpenAt =", '__orosTakeTarget("shelf")', "deleteIds:"].forEach((s) => assert.ok(js.includes(s), s));
  assert.equal(js.split("window.__orosOpenAt =").length, 2);
  ["sh-osave", "sh-oopen", "sh-ofolder"].forEach((id) => assert.ok(js.includes('"' + id + '"'), id));
  assert.ok(js.includes('"menu.osave": "orOS file (.orosshelf)"'));
  assert.ok(js.includes('"menu.oopen": "Open orOS file…"'));
  assert.ok(js.includes('"menu.ofolder": "Unzipped orOS folder…"'));
  assert.ok(js.includes('"menu.osave": "Αρχείο orOS (.orosshelf)"'));
  assert.ok(js.includes('"menu.oopen": "Άνοιγμα αρχείου orOS…"'));
  assert.ok(js.includes('"menu.ofolder": "Αποσυμπιεσμένος φάκελος orOS…"'));
  // no device keys in the file: prefs, reminder and the TMDB key are other keys
  assert.ok(!/TMDB_KEY|REM_KEY|PREFS_KEY/.test(read("shelf/package.js")));
  for (const f of ["shelf/help.en.txt", "shelf/help.el.txt"]) assert.ok(read(f).includes(".orosshelf"), f);
  assert.deepEqual(F.appsFor(".orosshelf"), ["shelf"]);
  assert.deepEqual(B.TYPES[".orosshelf"], { app: "shelf", mime: "application/x-oros-shelf" });
});
