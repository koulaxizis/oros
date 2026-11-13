// Studio wave A0: forward safety. A newer Studio's fields, lists and
// records survive normalising and merging on this version, bounded, and
// the merge laws still hold (symmetric, idempotent, tombstones).
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../studio/core.js");

const P = (id, m, x) => Object.assign({ id, m, name: "Song", bpm: 120, sig: 4, vol: 0, loop: { on: false, a: 0, b: 0 }, fx: [] }, x || {});
const T = (id, m, x) => Object.assign({ id, m, p: "pproject1", name: "Voice", color: C.COLORS[0], vol: 0, pan: 0, mute: false, solo: false, ord: 0, fx: [] }, x || {});
const S = (id, m, x) => Object.assign({ id, m, p: "pproject1", name: "take", path: "/internal/Studio/audio/a.wav", dur: 5, ch: 1 }, x || {});
const K = (id, m, x) => Object.assign({ id, m, p: "pproject1", t: "ttrack01", s: "ssource1", at: 1, off: 0, len: 4 }, x || {});
const data = (x) => Object.assign(C.emptyData(), x);
const J = (x) => JSON.stringify(x);

test("A0: old data keeps the very same bytes", () => {
  const d = data({
    projects: [P("pproject1", 5)], tracks: [T("ttrack01", 5)],
    sources: [S("ssource1", 5)], clips: [K("cclip001", 5, { gain: 0, fi: 0, fo: 0 })],
    tombs: { cgone0001: 7 }
  });
  const once = C.mergeStudio(d, d);
  assert.equal(J(C.mergeStudio(once, once)), J(once));
  assert.deepEqual(Object.keys(once), ["ver", "projects", "tracks", "sources", "clips", "tombs"]);
  assert.equal(once.ver, 1);
});

test("A0: unknown fields ride along on every kind of row, after the known ones", () => {
  const p = C.normProject(P("pproject1", 5, { kind: "chapter", bk: "bbook0001", zeta: [1, 2], alpha: { a: 1 } }));
  assert.equal(p.kind, "chapter");
  assert.equal(p.bk, "bbook0001");
  const keys = Object.keys(p);
  assert.deepEqual(keys.slice(-4), ["alpha", "bk", "kind", "zeta"]);       // sorted, after the known fields
  assert.equal(C.normTrack(T("ttrack01", 1, { vox: true })).vox, true);
  assert.equal(C.normSource(S("ssource1", 1, { codec: "flac" })).codec, "flac");
  assert.equal(C.normClip(K("cclip001", 1, { tone: 0.5 })).tone, 0.5);
  const midi = C.normClip({ id: "cclip002", m: 1, p: "pproject1", t: "ttrack01", at: 0, off: 0, len: 2, n: [[60, 0, 1, 100]], mk: [{ id: "mmark0001", t: 1, n: "a" }] });
  assert.deepEqual(midi.mk, [{ id: "mmark0001", t: 1, n: "a" }]);
});

test("A0: a known field that fails its check is still dropped, never kept as an extra", () => {
  const t = C.normTrack(T("ttrack01", 1, { inst: "NOT VALID!", smp: 5, br: "x" }));
  assert.equal("inst" in t, false);
  assert.equal("smp" in t, false);
  assert.equal("br" in t, false);
  const s = C.normSource(S("ssource1", 1, { lic: { k: "nope" } }));
  assert.equal("lic" in s, false);
});

test("A0: extras are bounded and hostile keys and values are refused", () => {
  const raw = P("pproject1", 5);
  for (let i = 0; i < 40; i++) raw["x" + i] = i;
  const p = C.normProject(raw);
  assert.equal(Object.keys(p).filter((k) => /^x\d+$/.test(k)).length, 16);
  const big = C.normProject(P("pproject1", 5, { huge: "a".repeat(9000), ok: 1 }));
  assert.equal("huge" in big, false);
  assert.equal(big.ok, 1);
  const bad = JSON.parse('{"id":"pproject1","m":5,"constructor":{"a":1},"_x":1,"Upper":1,"fn":1}');
  bad.fn = function () {};
  bad.nan = NaN;
  bad.deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
  const q = C.normProject(bad);
  ["constructor", "_x", "Upper", "fn", "nan", "deep"].forEach((k) => assert.equal(Object.prototype.hasOwnProperty.call(q, k), false, k));
  const proto = C.normProject(JSON.parse('{"id":"pproject1","m":5,"meta":{"__proto__":{"polluted":1}}}'));
  assert.equal("meta" in proto, false);
  assert.equal({}.polluted, undefined);
});

test("A0: an unknown list merges row by row, symmetric and idempotent, tombstones delete", () => {
  const a = data({ books: [{ id: "bbook0001", m: 5, name: "One", ch: ["pproject1"] }, { id: "bbook0002", m: 1, name: "Old" }] });
  const b = data({ books: [{ id: "bbook0001", m: 9, name: "One (newer)", ch: ["pproject1", "pproject2"] }, { id: "bbook0003", m: 2, name: "Three" }],
                   tombs: { bbook0002: 3 } });
  const ab = C.mergeStudio(a, b), ba = C.mergeStudio(b, a);
  assert.equal(J(ab), J(ba));
  assert.equal(J(C.mergeStudio(ab, ab)), J(ab));
  assert.deepEqual(ab.books.map((x) => x.id), ["bbook0001", "bbook0003"]);
  assert.equal(ab.books[0].name, "One (newer)");
  assert.equal(ab.tombs.bbook0002, 3);                                    // a tombstone of an unknown kind of id is kept
  const back = C.mergeStudio(ab, data({ books: [{ id: "bbook0002", m: 4, name: "Back" }] }));
  assert.ok(back.books.some((x) => x.id === "bbook0002"));                // a newer edit comes back (R17)
  assert.ok(!C.mergeStudio(data({ books: [] }), data()).books.length);
});

test("A0: an older device's copy never drops a newer device's data", () => {
  // the newer device wrote a book, a chapter field and a show record; an
  // older copy of the same project without them meets it in a merge
  const newer = data({ projects: [P("pproject1", 9, { bk: "bbook0001", kind: "chapter" })],
                       books: [{ id: "bbook0001", m: 9, name: "Book" }],
                       set: { m: 4, lang: "el" }, ver: 2 });
  const older = data({ projects: [P("pproject1", 9)] });
  const m = C.mergeStudio(older, newer);
  assert.equal(m.projects[0].bk, "bbook0001");                            // same stamp: the copy with more data wins
  assert.equal(m.books.length, 1);
  assert.deepEqual(m.set, { m: 4, lang: "el" });
  assert.equal(m.ver, 2);
  assert.equal(J(C.mergeStudio(newer, older)), J(m));
  // the older device's own merge result, merged again, still has them
  assert.equal(J(C.mergeStudio(m, older)), J(m));
});

test("A0: unknown rows and records are checked and bounded", () => {
  const rows = [];
  for (let i = 0; i < 2100; i++) rows.push({ id: "b" + String(i).padStart(7, "0"), m: 1 });
  rows.push({ id: "BAD", m: 1 }, { id: "bbook9999", m: -1 }, { id: "bbook9998" }, "x", null, { id: "bbook9997", m: 1, s: "a".repeat(17000) });
  const m = C.mergeStudio(data({ books: rows }), data());
  assert.equal(m.books.length, 2000);
  assert.ok(m.books.every((x) => /^b\d{7}$/.test(x.id)));
  const lists = {};
  for (let i = 0; i < 12; i++) lists["list" + String(i).padStart(2, "0")] = [{ id: "xrow00001", m: 1 }];
  const n = C.mergeStudio(data(lists), data());
  assert.equal(Object.keys(n).filter((k) => k.indexOf("list") === 0).length, 8);
  const r = C.mergeStudio(data({ set: { lang: "el" }, cfg: "text", ver: 1000 }), data());
  assert.equal("set" in r, false);                                        // a record needs its stamp
  assert.equal("cfg" in r, false);
  assert.equal(r.ver, 1);
  const tie = C.mergeStudio(data({ set: { m: 2, a: 1 } }), data({ set: { m: 2, a: 1, b: 2 } }));
  assert.deepEqual(tie.set, { m: 2, a: 1, b: 2 });
});

test("A0: data made in another window (the shell's sync) keeps its lists", () => {
  const vm = require("node:vm");
  const other = vm.runInNewContext('JSON.parse(\'{"ver":1,"projects":[],"tracks":[],"sources":[],"clips":[],"tombs":{},"books":[{"id":"bbook0001","m":2,"meta":{"a":1}}],"set":{"m":1}}\')');
  assert.notEqual(Object.getPrototypeOf(other), Object.prototype);
  const m = C.mergeStudio(other, other);
  assert.equal(m.books.length, 1);
  assert.deepEqual(m.books[0].meta, { a: 1 });
  assert.deepEqual(m.set, { m: 1 });
});
