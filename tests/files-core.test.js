// Files wave 3 (files/files-core.js): trash records, synced
// favourites merge, accent-free search + snippets, ZIP build / safe
// extraction plan (read back with atelier/zip.js).
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../files/files-core.js");
const Z = require("../atelier/zip.js");

test("trash ids carry their time; listing pairs folders and records", () => {
  const now = Date.UTC(2026, 9, 14, 12, 0, 0);
  const id = C.trashId(now, "AbC12");
  assert.match(id, /^[0-9a-z]{9}-[0-9a-z]{6}$/);
  assert.equal(C.idTime(id), now);
  assert.equal(C.idTime("nope"), 0);
  assert.equal(C.trashItemDir(id), "/internal/.trash/" + id);
  assert.equal(C.trashMetaPath(id), "/internal/.trash/" + id + ".json");
  const older = C.trashId(now - 1000, "zz");
  const l = C.trashListing([
    { name: id, dir: true }, { name: id + ".json", dir: false },
    { name: older + ".json", dir: false },             // record arrived, item not yet
    { name: "stray", dir: true }, { name: "x.json", dir: false }
  ]);
  assert.deepEqual(l.ids, [id, older]);
  assert.deepEqual(l.metas, { [id]: true, [older]: true });
});

test("trash records: normalised, unsafe paths dropped, expiry after 30 days", () => {
  const id = C.trashId(1000 * C.DAY, "aaaa");
  const m = C.makeMeta("/internal/Docs/a.txt", false, 5);
  assert.deepEqual(m, { v: 1, path: "/internal/Docs/a.txt", name: "a.txt", dir: false, at: 5 });
  assert.deepEqual(C.normMeta(m, id), { path: "/internal/Docs/a.txt", name: "a.txt", dir: false, at: 5 });
  assert.equal(C.normMeta({ path: "/internal/../etc" }, id).path, null);
  assert.equal(C.normMeta({ path: "/internal/.trash/x" }, id).path, null);
  assert.equal(C.normMeta({ path: "/elsewhere/a" }, id).path, null);
  assert.equal(C.normMeta(null, id).at, 1000 * C.DAY);       // age from the id
  assert.equal(C.normMeta({ name: "a/b" }, id).name, null);
  assert.equal(C.restoreParent(C.normMeta(m, id)), "/internal/Docs");
  assert.equal(C.restoreParent(C.normMeta({}, id)), "/internal");
  assert.equal(C.restoreParent(C.normMeta({ path: "/internal/top.txt" }, id)), "/internal");
  assert.equal(C.expired(0, Date.now()), false);
  assert.equal(C.expired(100, 100 + 29 * C.DAY), false);
  assert.equal(C.expired(100, 100 + 30 * C.DAY), true);
  assert.equal(C.isTrashPath("/internal/.trash"), true);
  assert.equal(C.isTrashPath("/internal/.trashy"), false);
});

test("favourites: symmetric, idempotent merge; removal wins a tie; moves carry", () => {
  let a = C.favSet(null, "/internal/Docs", true, true, 100);
  let b = C.favSet(null, "/internal/Pics", true, true, 200);
  b = C.favSet(b, "/internal/Docs", true, false, 100);      // same stamp: removal wins
  const ab = C.mergeFavs(a, b), ba = C.mergeFavs(b, a);
  assert.deepEqual(ab, ba);
  assert.deepEqual(C.mergeFavs(ab, ab), ab);
  assert.equal(JSON.stringify(C.normFavs(ab)), JSON.stringify(ab));
  assert.equal(C.favIs(ab, "/internal/Docs"), false);
  assert.equal(C.favIs(ab, "/internal/Pics"), true);
  // a later pin beats the old removal
  const again = C.favSet(ab, "/internal/Docs", true, true, 50);
  assert.equal(C.favIs(again, "/internal/Docs"), true);
  assert.ok(again.items.find((f) => f.p === "/internal/Docs").m > 100);
  // rename carries the subtree along
  let s = C.favSet(null, "/internal/A/x.txt", false, true, 10);
  s = C.favSet(s, "/internal/A", true, true, 10);
  s = C.favMove(s, "/internal/A", "/internal/B", 20);
  assert.deepEqual(C.favLive(s).map((f) => f.p), ["/internal/B", "/internal/B/x.txt"]);
  s = C.favDrop(s, "/internal/B", 30);
  assert.deepEqual(C.favLive(s), []);
  // garbage in: dropped, never thrown
  assert.deepEqual(C.normFavs({ items: [null, { p: "/x" }, { p: "/internal/.trash/a" }, 5] }), { v: 1, items: [] });
  assert.deepEqual(C.normFavs("junk"), { v: 1, items: [] });
});

test("fold keeps the length; snippets come from the original text", () => {
  const s = "Ημερολόγιο ΤΑΞΙΔΙΟΥ, Café";
  assert.equal(C.fold(s).length, s.length);
  assert.equal(C.fold("Ταξίδι Σ"), "ταξιδι σ");
  assert.equal(C.fold("CAFÉ"), "cafe");
  const sn = C.findSnippet("Lorem ipsum dolor   sit amet, Ημερολόγιο ταξιδιού and more", C.fold("ημερολογιο"), 12);
  assert.equal(sn.match, "Ημερολόγιο");
  assert.equal(sn.count, 1);
  assert.match(sn.before, /^…/);
  assert.equal(C.findSnippet("abc", C.fold("zz")), null);
  assert.equal(C.findSnippet("a a a", "a").count, 3);
  assert.equal(C.plainText("<p>Hi <b>there</b></p><script>bad()</script> &amp; co", "html").replace(/\s+/g, " ").trim(), "Hi there & co");
  assert.equal(C.plainText("<b>x</b>", "txt"), "<b>x</b>");
});

test("content kinds and caps", () => {
  assert.equal(C.contentKind("a.md", 10), "text");
  assert.equal(C.contentKind("README", 10), "text");
  assert.equal(C.contentKind("a.pdf", 10), "pdf");
  assert.equal(C.contentKind("a.pdf", C.PDF_MAX + 1), "");
  assert.equal(C.contentKind("a.csv", C.TEXT_MAX + 1), "");
  assert.equal(C.contentKind("a.png", 10), "");
  assert.equal(C.looksBinary("ab\u0000c"), true);
  assert.equal(C.thumbKind("a.JPG", 10), "image");
  assert.equal(C.thumbKind("a.pdf", null), "pdf");
  assert.equal(C.thumbKind("a.png", C.THUMB_MAX + 1), "");
});

test("zip: build stored + deflated entries, read back with atelier/zip.js", async () => {
  const enc = new TextEncoder();
  const raw = enc.encode("Γεια σου κόσμε ".repeat(200));
  const def = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  assert.ok(def.length < raw.length);
  const small = enc.encode("hello");
  const parts = C.zipBuild([
    { name: "docs/", size: 0, crc: 0, data: new Uint8Array(0), method: 0, date: new Date(2026, 9, 14, 10, 30) },
    { name: "docs/γράμμα.txt", size: raw.length, crc: C.crc32(raw), data: def, method: 8, date: Date.now() },
    { name: "hello.txt", size: small.length, crc: C.crc32(small), data: small, method: 0 }
  ]);
  const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
  const z = Z.open(bytes);
  assert.deepEqual(z.names, ["docs/γράμμα.txt", "hello.txt"]);
  assert.equal(z.size("docs/γράμμα.txt"), raw.length);
  assert.equal(await z.text("docs/γράμμα.txt"), "Γεια σου κόσμε ".repeat(200));
  assert.equal(await z.text("hello.txt"), "hello");
  assert.equal(C.crc32(small), Z.crc32(small));
  assert.equal(C.crc32(enc.encode("lo"), C.crc32(enc.encode("hel"))), C.crc32(small));
});

test("zip names: archive name, stored kinds", () => {
  assert.equal(C.zipNameFor(["report.pdf"], [false]), "report.zip");
  assert.equal(C.zipNameFor(["My.Folder"], [true]), "My.Folder.zip");
  assert.equal(C.zipNameFor(["a", "b"], [false, false]), null);
  assert.equal(C.shouldStore("x.JPG"), true);
  assert.equal(C.shouldStore("x.txt"), false);
});

test("zip extraction plan: no escape, clean names, clashes renamed, caps", () => {
  assert.equal(C.zipSafePath("../evil.txt"), null);
  assert.equal(C.zipSafePath("a/../../evil.txt"), null);
  assert.deepEqual(C.zipSafePath("/abs/path.txt"), ["abs", "path.txt"]);
  assert.deepEqual(C.zipSafePath("C:\\win\\file.txt"), ["win", "file.txt"]);
  assert.deepEqual(C.zipSafePath("a/b:c?.txt"), ["a", "b_c_.txt"]);
  assert.deepEqual(C.zipSafePath("./x/./y"), ["x", "y"]);
  assert.equal(C.zipSafePath("__MACOSX/._a"), null);
  assert.equal(C.zipSafePath("a/.DS_Store"), null);
  assert.deepEqual(C.zipSafePath("dots.../x"), ["dots", "x"]);
  const sizes = { "a": 1, "a/b.txt": 2, "x?.txt": 3, "x_.txt": 4, "../bad": 5 };
  const p = C.extractPlan(Object.keys(sizes), (n) => sizes[n]);
  assert.equal(p.skipped, 1);
  assert.deepEqual(p.items.map((i) => i.rel), ["a (1)", "a/b.txt", "x_.txt", "x_ (1).txt"]);
  assert.equal(p.total, 10);
  assert.equal(p.tooBig, false);
  assert.equal(p.top, null);
  assert.equal(C.extractPlan(["Docs/a.txt", "Docs/Sub/b.txt"], () => 1).top, "Docs");
  assert.equal(C.extractPlan(["Docs/a.txt", "x.txt"], () => 1).top, null);
  const big = C.extractPlan(["a", "b"], () => 10, { files: 1, total: 15 });
  assert.equal(big.tooMany, true);
  assert.equal(big.tooBig, true);
});

test("safe paths and unique names", () => {
  assert.equal(C.safePath("/internal/a/b"), true);
  assert.equal(C.safePath("/internal"), false);
  assert.equal(C.safePath("/internal//a"), false);
  assert.equal(C.safePath("/internal/a/.."), false);
  assert.equal(C.uniqueName("a.txt", ["a.txt", "a (1).txt"]), "a (2).txt");
  assert.equal(C.uniqueName("b", []), "b");
});
