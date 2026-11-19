// Files › tags on every file (files/tags-core.js, TAGS v1): which
// file carries which tag, synced in the slice "files-tags", the tag
// list itself being Documents' (files-docs `tags`). Merge laws (R5,
// R17, R26) per file and per tag, R27, hostile input, caps, hash rows
// that follow a file, path rows that move with Files, deletions for
// good, a tag removed from the list, smart folders kept from T1 on.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../files/tags-core.js");

const H1 = "a".repeat(64), H2 = "b".repeat(64);
const J = (o) => JSON.stringify(o);
const seq = (s) => () => { s = (s * 16807) % 2147483647; return s / 2147483647; };

test("empty and hostile input normalise to an empty state", () => {
  assert.deepEqual(T.norm(null), { v: 1, files: [], smart: [], tombs: {} });
  const junk = T.norm({ files: [null, 1, { k: "p:/etc/passwd", p: "/etc/passwd", m: 5, t: { "tg-a": 5 } },
    { k: "p:/internal/../x", m: 5, t: { "tg-a": 5 } }, { k: "p:/internal/.docs/text/d-1.txt", m: 5, t: { "tg-a": 5 } },
    { k: "h:zz", p: "/internal/a", m: 5, t: { "tg-a": 5 } }, { k: "p:/internal/ok.txt", m: -1, t: { "tg-a": 5 } },
    { k: "p:/internal/fine.txt", p: "/elsewhere", m: 7, t: { "tg-a": 9, "bad": 3, "tg-b": "x", "tg-c": 0, "tg-d": -4.7 } }],
    smart: [{ id: "sf-1", m: 3, n: "  ", q: {} }, { id: "nope", m: 3, n: "x" }, { id: "sf-2", m: 4, n: "Recent\u0000 pdf", c: 99, q: { kind: ["pdf", "evil"], days: 30, tg: ["tg-a", "zz"], dir: "/etc" } }],
    tombs: { "sf-9": "no", "bad": 5, "sf-8": 12 } });
  assert.equal(junk.files.length, 1);
  assert.deepEqual(junk.files[0], { k: "p:/internal/fine.txt", p: "/internal/fine.txt", m: 7, t: { "tg-a": 9, "tg-d": -4 } });
  assert.equal(junk.smart.length, 1);
  assert.deepEqual(junk.smart[0], { id: "sf-2", m: 4, n: "Recent pdf", q: { tg: ["tg-a"], kind: ["pdf"], days: 30 } });
  assert.deepEqual(junk.tombs, { "sf-8": 12 });
  assert.equal(J(T.norm(junk)), J(junk));
});

test("tags go on and come off one file; R27 keeps an unchanged edit", () => {
  let s = T.norm(null);
  s = T.setTags(s, "/internal/a.txt", "", ["tg-work"], [], 1000);
  const r = T.rowAt(s, "p:/internal/a.txt");
  assert.deepEqual(T.onIds(r), ["tg-work"]);
  assert.equal(T.setTags(s, "/internal/a.txt", "", ["tg-work"], [], 2000), s, "already on: same state");
  assert.equal(T.setTags(s, "/internal/a.txt", "", [], ["tg-home"], 2000), s, "not on: same state");
  const s2 = T.setTags(s, "/internal/a.txt", "", [], ["tg-work"], 900);   // a clock behind still wins
  assert.ok(T.rowAt(s2, "p:/internal/a.txt").t["tg-work"] < 0);
  assert.equal(-T.rowAt(s2, "p:/internal/a.txt").t["tg-work"], 1001);
  assert.equal(T.hasAny(s2), false);
  assert.equal(T.setTags(s, "/etc/x", "", ["tg-a"], [], 1), s, "outside the disk");
});

test("two devices tagging one file both keep their tags; removal beats a stale add", () => {
  let base = T.setTags(T.norm(null), "/internal/a.txt", "", ["tg-a"], [], 1000);
  const A = T.setTags(base, "/internal/a.txt", "", ["tg-b"], [], 2000);
  const B = T.setTags(base, "/internal/a.txt", "", ["tg-c"], ["tg-a"], 2000);
  const m1 = T.merge(A, B), m2 = T.merge(B, A);
  assert.equal(J(m1), J(m2), "commutative");
  assert.deepEqual(T.onIds(T.rowAt(m1, "p:/internal/a.txt")), ["tg-b", "tg-c"]);
  assert.equal(J(T.merge(m1, m1)), J(m1), "idempotent");
  assert.equal(J(T.merge(T.merge(A, B), base)), J(T.merge(A, T.merge(B, base))), "associative");
  assert.equal(J(T.norm(m1)), J(m1), "canonical");
  // the same stamp on both sides: off wins
  const on = { v: 1, files: [{ k: "p:/internal/x", p: "/internal/x", m: 5, t: { "tg-a": 50 } }] };
  const off = { v: 1, files: [{ k: "p:/internal/x", p: "/internal/x", m: 5, t: { "tg-a": -50 } }] };
  assert.equal(T.merge(on, off).files[0].t["tg-a"], -50);
  assert.equal(T.merge(off, on).files[0].t["tg-a"], -50);
});

test("a hash row follows its file: the moved path wins by m, relocate finds it", () => {
  let s = T.setTags(T.norm(null), "/internal/a.jpg", H1, ["tg-a"], [], 1000);
  assert.equal(s.files[0].k, "h:" + H1);
  const moved = T.carry(s, "/internal/a.jpg", "/internal/Pics/a.jpg", 2000);
  assert.equal(moved.files[0].p, "/internal/Pics/a.jpg");
  assert.equal(T.merge(s, moved).files[0].p, "/internal/Pics/a.jpg");
  // moved by another device: relocate by the vault's entries
  const r = T.relocate(s, [{ p: "/internal/Elsewhere/a.jpg", h: H1 }, { p: "/internal/b.jpg", h: H2 }], 3000);
  assert.equal(r.moved, 1);
  assert.equal(r.state.files[0].p, "/internal/Elsewhere/a.jpg");
  assert.equal(T.relocate(r.state, [{ p: "/internal/Elsewhere/a.jpg", h: H1 }], 4000).moved, 0);
});

test("tagsAt: a hash row belongs to its last path while that is here, then to the content", () => {
  let s = T.setTags(T.norm(null), "/internal/a.jpg", H1, ["tg-a"], [], 1000);
  s = T.setTags(s, "/internal/a.jpg", H1, ["tg-b"], [], 1100);
  const ix = T.index(s);
  const here = (p) => p === "/internal/a.jpg";
  assert.deepEqual(T.tagsAt(ix, "/internal/a.jpg", H1, here), ["tg-a", "tg-b"]);
  assert.deepEqual(T.tagsAt(ix, "/internal/copy.jpg", H1, here), [], "a copy does not take the tags");
  assert.deepEqual(T.tagsAt(ix, "/internal/copy.jpg", H1, () => false), ["tg-a", "tg-b"], "the original is gone");
  assert.deepEqual(T.tagsAt(ix, "/internal/other.jpg", H2, here), []);
});

test("a path row folds into the hash row once the hash is known", () => {
  let s = T.setTags(T.norm(null), "/internal/a.jpg", "", ["tg-a", "tg-b"], [], 1000);
  s = T.setTags(s, "/internal/a.jpg", H1, ["tg-c"], ["tg-b"], 2000);
  assert.deepEqual(T.onIds(T.rowAt(s, "h:" + H1)), ["tg-a", "tg-c"]);
  assert.deepEqual(T.onIds(T.rowAt(s, "p:/internal/a.jpg")), []);
  assert.deepEqual(T.tagsAt(T.index(s), "/internal/a.jpg", H1, () => true), ["tg-a", "tg-c"]);
});

test("carry moves path rows of a folder; dropPath and stripTag take tags off", () => {
  let s = T.setTags(T.norm(null), "/internal/Old/a.txt", "", ["tg-a"], [], 1000);
  s = T.setTags(s, "/internal/Old", "", ["tg-b"], [], 1000);
  s = T.setTags(s, "/internal/Older.txt", "", ["tg-c"], [], 1000);
  const c = T.carry(s, "/internal/Old", "/internal/New", 2000);
  assert.deepEqual(T.onIds(T.rowAt(c, "p:/internal/New/a.txt")), ["tg-a"]);
  assert.deepEqual(T.onIds(T.rowAt(c, "p:/internal/New")), ["tg-b"]);
  assert.deepEqual(T.onIds(T.rowAt(c, "p:/internal/Old/a.txt")), []);
  assert.deepEqual(T.onIds(T.rowAt(c, "p:/internal/Older.txt")), ["tg-c"], "a sibling with the same prefix stays");
  // the other device still has the old copy: after the merge the file is only at its new path
  const m = T.merge(s, c);
  assert.deepEqual(T.withTag(m, "tg-a").map((x) => x.p), ["/internal/New/a.txt"]);
  assert.equal(T.carry(c, "/internal/Nothing", "/internal/X", 3000), c);
  const d = T.dropPath(c, "/internal/New", 3000);
  assert.deepEqual(T.counts(d), { "tg-c": 1 });
  const st = T.stripTag(c, "tg-c", 3000);
  assert.equal(T.counts(st)["tg-c"], undefined);
  assert.equal(T.stripTag(st, "tg-c", 4000), st);
});

test("the Trash keeps the tags: carry into it and back", () => {
  let s = T.setTags(T.norm(null), "/internal/a.txt", "", ["tg-a"], [], 1000);
  s = T.carry(s, "/internal/a.txt", "/internal/.trash/t1/a.txt", 2000);
  assert.deepEqual(T.withTag(s, "tg-a").map((x) => x.p), ["/internal/.trash/t1/a.txt"]);
  s = T.carry(s, "/internal/.trash/t1/a.txt", "/internal/a.txt", 3000);
  assert.deepEqual(T.withTag(s, "tg-a").map((x) => x.p), ["/internal/a.txt"]);
});

test("caps: 20 tags on one file, oldest untagged rows go first", () => {
  let s = T.norm(null);
  const ids = Array.from({ length: 20 }, (_, i) => "tg-" + String(i).padStart(2, "0"));
  s = T.setTags(s, "/internal/a", "", ids, [], 1000);
  assert.equal(T.onIds(T.rowAt(s, "p:/internal/a")).length, 20);
  assert.equal(T.setTags(s, "/internal/a", "", ["tg-zz"], [], 2000), s, "a 21st tag is refused");
  const t = {};
  for (let i = 0; i < 30; i++) t["tg-x" + i] = 100 + i;
  assert.equal(T.onIds(T.norm({ files: [{ k: "p:/internal/b", m: 1, t }] }).files[0]).length, 20);
  const dead = [];
  for (let i = 0; i < 2100; i++) dead.push({ k: "p:/internal/d" + i, m: 1, t: { "tg-a": -(10 + i) } });
  const n = T.norm({ files: dead });
  assert.equal(n.files.length, 2000);
  assert.ok(!n.files.some((r) => r.k === "p:/internal/d0"), "the oldest went");
});

test("smart folders: put, edit, remove; a tomb hides an older copy, a newer edit comes back", () => {
  let s = T.norm(null);
  const r = T.putSmart(s, { n: "PDFs this month", c: 3, q: { kind: ["pdf"], days: 30 } }, 1000, seq(5));
  assert.ok(/^sf-/.test(r.id));
  s = r.state;
  assert.equal(T.putSmart(s, { id: r.id, n: "PDFs this month", c: 3, q: { kind: ["pdf"], days: 30 } }, 2000).state, s, "unchanged");
  const ed = T.putSmart(s, { id: r.id, n: "PDFs", c: 3, q: { kind: ["pdf"], days: 30 } }, 1500).state;
  assert.equal(T.findSmart(ed, r.id).n, "PDFs");
  const gone = T.dropSmart(ed, r.id, 3000);
  assert.equal(gone.smart.length, 0);
  assert.equal(T.merge(gone, s).smart.length, 0, "the old copy stays hidden");
  const back = T.putSmart(T.merge(gone, s), { id: r.id, n: "PDFs again", q: {} }, 3500);
  assert.equal(back.id === r.id || back.id !== "", true);
  assert.equal(T.merge(gone, back.state).smart.length, 1);
});

test("a later Files' query fields are kept verbatim; dates and sizes are checked", () => {
  const q = T.normQuery({ x: { future: [1, 2] }, from: "2026-01-01", to: "nope", min: 10, max: -1, name: "  inv ", all: true, tg: ["tg-a", "tg-b"] });
  assert.deepEqual(q, { tg: ["tg-a", "tg-b"], all: true, from: "2026-01-01", name: "inv", min: 10, x: { future: [1, 2] } });
  assert.deepEqual(T.normQuery({ days: 7, from: "2026-01-01" }), { days: 7 });
  assert.deepEqual(T.normQuery({ x: { big: "y".repeat(3000) } }), {});
});

test("wiring: tags load with Documents, sync their own slice, draw with textContent", () => {
  const fs = require("fs");
  const path = require("path");
  const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  const files = read("files/files.js");
  assert.match(files, /DOCS_SCRIPTS = \[[^\]]*"docs\.js", "tags-core\.js", "tags\.js"\]/, "after docs.js: the list is Documents'");
  assert.ok(!/tags(-core)?\.js/.test(read("files/index.html")), "not in the first open (budget)");
  assert.match(files, /oros-files-tags/, "a device with tags loads them at boot");
  assert.match(files, /tagsCarry\(from, to\)/, "moves carry the tags");
  assert.match(files, /tagsCarry\(path, CORE\.trashItemDir/, "the Trash keeps them");
  assert.match(files, /tagsDrop\(CORE\.trashItemDir\(id\)\)/, "gone for good takes them off");
  const v = read("files/tags.js");
  assert.match(v, /registerSlice\(CORE\.SLICE/);
  assert.match(v, /, CORE\.KEY, CORE\.merge\)/, "merge-capable slice with its storage key");
  (v.match(/innerHTML\s*=\s*[^;]+;/g) || []).forEach((a) => {
    assert.match(a, /innerHTML\s*=\s*(""|ICON\.\w+);$/, "only constant icons through innerHTML: " + a);
  });
  const d = read("files/docs.js");
  assert.match(d, /setDocTags: function/, "a document's tags are set on the document");
  assert.match(read("files/photos.js"), /tagsChanged: tagsChanged/);
  ["files/help.en.txt", "files/help.el.txt", "i18n/de/help/files.txt"].forEach((p) => assert.match(read(p), /^### (Tags|Ετικέτες|Schlagwörter)$/m, p));
});
