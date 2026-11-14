// orOS font collections and notes (FM-2): the synced slice "fonts"
// (designkit/fonts.js 1.2.0 cols: normalize, merge, edits, bind,
// keepOffline) and its use in Settings › Fonts, Layout's Fonts dialog
// and Atelier's font panel (setup.ext.col, strings in every language).
// Run: node --test tests/fonts-collections.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const F = require(path.join(ROOT, "designkit/fonts.js"));
const C = F.cols;
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const j = (x) => JSON.parse(JSON.stringify(x));
const fam = (id, name, fb) => ({ id, name, fb: fb || "serif" });

function base() {
  let d = C.normalize(null);
  const r = C.add(d, "Book", 1000, 0.1, "en");
  d = C.set(r.d, r.id, fam("fs_noto_serif", "Noto Serif"), true, 1000);
  return { d, id: r.id };
}

test("normalize: bad ids, names and records are dropped; the result is stable", () => {
  const d = C.normalize({
    ver: 1,
    cols: { cGood1: { name: "  Book \u0007 one ", m: 5 }, BAD: { name: "x", m: 5 }, cnoname: { name: "  ", m: 5 }, cnom: { name: "y" } },
    mem: {
      "cgood1:fs_noto_serif": { on: 1, name: "Noto Serif", fb: "serif", m: 6 },
      "cgood1:uf_0123456789abcdef": { on: 1, name: "Mine", fb: "weird", m: 6 },
      "cgood1:uf_short": { on: 1, name: "x", m: 6 },
      "cgood1:<script>": { on: 1, name: "x", m: 6 },
      nocolon: { on: 1, m: 6 }
    },
    notes: { fs_noto_serif: { t: "bought\u0000 2025\r\nline", m: 7 }, "bad id": { t: "x", m: 7 } },
    tombs: { cdead1: 9, X: 9, cneg: -1 }
  });
  assert.deepEqual(Object.keys(d.cols), []);          // "cGood1" has a capital: not an id
  assert.deepEqual(Object.keys(d.mem).sort(), ["cgood1:fs_noto_serif", "cgood1:uf_0123456789abcdef"]);
  assert.equal(d.mem["cgood1:uf_0123456789abcdef"].fb, "sans");
  assert.deepEqual(d.notes, { fs_noto_serif: { t: "bought  2025\nline", m: 7 } });
  assert.deepEqual(d.tombs, { cdead1: 9 });
  assert.deepEqual(C.normalize(d), d);
  assert.deepEqual(C.normalize("nonsense"), { ver: 1, cols: {}, mem: {}, notes: {}, tombs: {} });
  const n = C.normalize({ cols: { cbook01: { name: "x".repeat(200), m: 1 } } });
  assert.equal(n.cols.cbook01.name.length, C.LIM.name);
});

test("edits: add (same name ignoring case and accents is the same collection), rename, set, notes", () => {
  let { d, id } = base();
  assert.match(id, C.CID_RE);
  assert.equal(C.add(j(d), "BOOK", 2000, 0.5, "en").id, id);
  assert.equal(C.add(j(d), "   ", 2000).id, "");
  d = C.set(d, id, fam("uf_0123456789abcdef", "My Font", "sans"), true, 1000);
  assert.deepEqual(C.fams(d, id, "en").map((f) => f.name), ["My Font", "Noto Serif"], "by name");
  assert.deepEqual(C.of(d, "fs_noto_serif", "en"), [id]);
  d = C.set(d, id, fam("fs_noto_serif", "Noto Serif"), false, 1000);
  assert.deepEqual(C.fams(d, id).map((f) => f.id), ["uf_0123456789abcdef"]);
  assert.deepEqual(C.of(d, "fs_noto_serif"), []);
  d = C.rename(d, id, "Book two", 1000);
  assert.equal(d.cols[id].name, "Book two");
  d = C.setNote(d, "uf_0123456789abcdef", "bought 2025, 1 seat", 1000);
  assert.equal(C.note(d, "uf_0123456789abcdef"), "bought 2025, 1 seat");
  // every edit gets a stamp after everything there, even with a clock behind
  const ms = [].concat(Object.values(d.cols), Object.values(d.mem), Object.values(d.notes)).map((x) => x.m);
  assert.equal(new Set(ms).size, ms.length);
  // a family outside a collection that does not exist is ignored
  assert.deepEqual(C.set(j(d), "cnothere", fam("fs_x", "X"), true, 1), d);
});

test("merge: symmetric, idempotent, and two devices adding to one collection keep both", () => {
  const { d, id } = base();
  const a = C.set(j(d), id, fam("fs_gfs_didot", "GFS Didot"), true, 5000);
  const b = C.set(j(d), id, fam("fs_alegreya", "Alegreya"), true, 5000);
  const ab = C.merge(a, b), ba = C.merge(b, a);
  assert.deepEqual(ab, ba);
  assert.deepEqual(C.merge(ab, ab), ab);
  assert.deepEqual(C.merge(ab, a), ab);
  assert.deepEqual(C.fams(ab, id).map((f) => f.id).sort(), ["fs_alegreya", "fs_gfs_didot", "fs_noto_serif"]);
  // a rename and an add at once: both survive
  const r = C.rename(j(d), id, "Travel book", 6000);
  const m = C.merge(r, a);
  assert.equal(m.cols[id].name, "Travel book");
  assert.equal(C.fams(m, id).length, 2);
  // the newer of two renames wins on both sides; equal stamps settle the same way everywhere
  const x = C.normalize({ cols: { [id]: { name: "Aaa", m: 9e12 } } }), y = C.normalize({ cols: { [id]: { name: "Zzz", m: 9e12 } } });
  assert.deepEqual(C.merge(x, y), C.merge(y, x));
  assert.equal(C.merge(x, y).cols[id].name, "Zzz");
});

test("merge: a deleted collection stays deleted with its fonts; a removed note travels", () => {
  const { d, id } = base();
  const del = C.remove(j(d), id, 7000);
  assert.deepEqual(del.cols, {});
  assert.ok(del.tombs[id] > 0);
  const other = C.set(j(d), id, fam("fs_gfs_didot", "GFS Didot"), true, 6000);   // older than the deletion
  const m = C.merge(other, del);
  assert.deepEqual(m.cols, {});
  assert.deepEqual(Object.keys(m.mem), []);
  assert.deepEqual(C.fams(m, id), []);
  const n1 = C.setNote(j(d), "fs_noto_serif", "keep for covers", 8000);
  const n2 = C.setNote(j(n1), "fs_noto_serif", "", 9000);
  assert.equal(C.note(C.merge(n1, n2), "fs_noto_serif"), "");
  assert.equal(C.note(C.merge(n2, n1), "fs_noto_serif"), "");
});

test("docCol: only a collection id that exists", () => {
  const { d, id } = base();
  assert.equal(C.docCol({ setup: { ext: { col: id } } }, d), id);
  assert.equal(C.docCol({ setup: { ext: { col: id } } }), id);
  assert.equal(C.docCol({ setup: { ext: { col: "cgone12" } } }, d), "");
  assert.equal(C.docCol({ setup: { ext: { col: "<b>" } } }), "");
  assert.equal(C.docCol({ setup: {} }, d), "");
  assert.equal(C.docCol(null, d), "");
});

function fakeWin() {
  const store = {}, listeners = {}, reg = [];
  let dirty = 0;
  const sync = { registerSlice: (...a) => reg.push(a), markDirty: () => { dirty++; } };
  const win = {
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    parent: { orosSync: sync }
  };
  return { win, store, reg, listeners, dirty: () => dirty };
}

test("bind: registers slice fonts with its key and merge, writes and marks dirty, takes pulls quietly", () => {
  const w = fakeWin();
  let changed = 0;
  const cb = C.bind(w.win, () => { changed++; });
  assert.equal(w.reg.length, 1);
  const [name, get, set, key, merge] = w.reg[0];
  assert.equal(name, "fonts");
  assert.equal(key, "oros-fonts-data");
  assert.equal(merge, C.merge);
  let id = "";
  assert.ok(cb.edit((d) => { const r = C.add(d, "Covers", 1000, 0.2); id = r.id; return r.d; }));
  assert.equal(w.dirty(), 1);
  assert.equal(JSON.parse(w.store["oros-fonts-data"]).cols[id].name, "Covers");
  assert.equal(cb.edit((d) => d), false, "no change, no write");
  assert.equal(w.dirty(), 1);
  // a pull
  const remote = C.set(j(get()), id, fam("fs_gfs_didot", "GFS Didot"), true, 2000);
  set(remote);
  assert.equal(w.dirty(), 1, "a pull never marks dirty");
  assert.equal(changed, 1);
  assert.equal(C.fams(cb.get(), id).length, 1);
  // another window wrote meanwhile: an edit keeps its work
  const other = C.setNote(j(cb.get()), "fs_gfs_didot", "other window", 3000);
  w.store["oros-fonts-data"] = JSON.stringify(other);
  cb.edit((d) => C.rename(d, id, "Covers 2026", 4000));
  const now = cb.get();
  assert.equal(now.cols[id].name, "Covers 2026");
  assert.equal(C.note(now, "fs_gfs_didot"), "other window");
  // and its storage event merges too
  const third = C.setNote(j(now), "fs_noto_serif", "third", 5000);
  w.listeners.storage.forEach((fn) => fn({ key: "oros-fonts-data", newValue: JSON.stringify(third) }));
  assert.equal(C.note(cb.get(), "fs_noto_serif"), "third");
  assert.equal(changed, 2);
  // a page without sync still works on its own storage
  const lone = C.bind({ localStorage: w.win.localStorage, addEventListener() {} }, null);
  assert.equal(lone.get().cols[id].name, "Covers 2026");
});

test("keepOffline: fetches every file of the free fonts it is given, never an own font", async () => {
  const seen = [];
  const old = global.fetch;
  global.fetch = (u) => { seen.push(u); return Promise.resolve({ ok: !/fail/.test(u), status: /fail/.test(u) ? 500 : 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }); };
  try {
    const prog = [];
    const res = await C.keepOffline([{ id: "fs_gfs_didot", vars: ["r", "b"] }, { id: "uf_0123456789abcdef" }, { id: "fs_alegreya" }, { id: "nonsense" }], (d, t) => prog.push([d, t]));
    assert.equal(res.total, 4 * 2 + 4 * 4);
    assert.equal(res.ok, 24);
    assert.equal(seen.length, 24);
    assert.ok(seen.every((u) => /^https:\/\/cdn\.jsdelivr\.net\/fontsource\/fonts\/(gfs-didot|alegreya)@latest\//.test(u)));
    assert.deepEqual(prog[0], [0, 24]);
    assert.deepEqual(prog[prog.length - 1], [24, 24]);
  } finally { global.fetch = old; }
});

test("wiring: Settings, Layout and Atelier use the slice; strings in English, Greek and German", () => {
  const page = read("settings/fonts.js"), lp = read("layout/fontpick.js"), at = read("atelier/fonts.js");
  assert.match(page, /DK\.cols\.bind\(window/);
  assert.match(page, /\["cols", "fm\.tab\.cols"\]/);
  assert.match(lp, /C\.bind\(window, null\)/);
  assert.match(lp, /C\.docCol\(LY\.doc, d\)/);
  assert.match(lp, /s\.ext\.col = cid/);
  assert.match(lp, /\.woff2,/, "Layout takes .woff2 since 1.1.0");
  assert.match(at, /C\.bind\(window/);
  assert.match(at, /C\.docCol\(AT\.doc, d\)/);
  assert.match(at, /DKF\.withEntry\(AX\.docFonts\(doc\), e\)/);
  // the font files' text never becomes markup in the new parts
  assert.ok(!/innerHTML/.test(page));
  const ly = read("layout/layout.js"), dl = read("i18n/de/layout.js");
  for (const k of ["fp.cols", "fp.docCol", "fp.docCol.none", "fp.notHere"]) {
    assert.equal(ly.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
    assert.ok(dl.includes('"' + k + '":'), k + " in DE");
  }
  const ac = read("atelier/core.js"), da = read("i18n/de/atelier.js");
  for (const k of ["fn.cols", "fn.docCol", "fn.docCol.none", "fn.notHere"]) {
    assert.equal(ac.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
    assert.ok(da.includes('"' + k + '":'), k + " in DE");
  }
  for (const m of at.match(/t\("fn\.[a-zA-Z.]+"\)/g)) assert.ok(ac.includes(m.slice(2, -1) + ":"), m);
});
