// Pure logic of Slides (slides/core.js): order keys, themes, layouts,
// the outline view, templates and the merge of the sync slice "slides"
// (R5, R17, R26, recovered text); and the pure parts of the shared
// slide show player (designkit/show.js): keys, navigation, timings.
// Run: node --test tests/
//
// Both files are evaluated as is in fresh contexts (they attach
// OrosSlidesCore / orosDK.show to their global).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function load(rel) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", rel), "utf8"), ctx);
  return ctx;
}
const C = load("slides/core.js").OrosSlidesCore;
const S = load("designkit/show.js").orosDK.show;
const j = (x) => JSON.parse(JSON.stringify(x));   // out of the vm realm

function ids(prefix) {
  let n = 0;
  return () => prefix + String(++n).padStart(4, "0");
}
function canon(x) { return JSON.stringify(C.mergeSlides(x, x)); }
function texts(d, deckId) {
  return C.deckSlides(d, deckId).map((s) => C.slideTitle(d, s.id));
}
function bodyOf(d, slideId, role) {
  const it = C.placeholder(d, slideId, role || "body");
  return it ? C.itemText(it) : null;
}

// ---------- order keys ----------

test("order keys: always strictly between, never ending in 0", () => {
  let keys = [C.posBetween("", null)];
  // Insert at the front, the back and in the middle many times.
  for (let i = 0; i < 300; i++) {
    const at = i % 3 === 0 ? 0 : (i % 3 === 1 ? keys.length : Math.floor(keys.length / 2));
    const a = at > 0 ? keys[at - 1] : "", b = at < keys.length ? keys[at] : null;
    const k = C.posBetween(a, b);
    assert.ok(k > a, `${k} > ${a}`);
    if (b !== null) assert.ok(k < b, `${k} < ${b}`);
    assert.notEqual(k.slice(-1), "0");
    keys.splice(at, 0, k);
  }
  const sorted = keys.slice().sort();
  assert.deepEqual(keys, sorted);
  assert.equal(new Set(keys).size, keys.length);
  // Bad bounds fall back to an open interval instead of throwing.
  assert.ok(C.posBetween("zz", "a") > "zz");
  assert.ok(C.posBetween("<x>", null).length > 0);
});

// ---------- themes ----------

test("themes: text and muted text readable on every background (WCAG AA)", () => {
  assert.equal(C.THEMES.length, 8);
  C.THEMES.forEach((t) => {
    assert.ok(C.contrast(t.c.fg, t.c.bg) >= 4.5, t.id + " fg/bg");
    assert.ok(C.contrast(t.c.mu, t.c.bg) >= 4.5, t.id + " mu/bg " + C.contrast(t.c.mu, t.c.bg).toFixed(2));
    assert.ok(C.contrast(t.c.fg, t.c.sf) >= 4.5, t.id + " fg/sf");
    ["bg", "fg", "mu", "sf", "a1", "a2", "a3"].forEach((r) => assert.match(t.c[r], /^#[0-9a-f]{6}$/));
    assert.ok(t.name.en && t.name.el);
  });
  assert.equal(C.resolveColor("t:a1", "dark"), "#60a5fa");
  assert.equal(C.resolveColor("#123456", "dark"), "#123456");
  assert.equal(C.themeById("nope").id, "light");
});

// ---------- normalize: nothing unbounded or unknown gets in ----------

test("normalize: unknown fields dropped, values bounded, no markup paths", () => {
  const it = C.normItem({
    id: "item-1", m: 5, s: "slide-1", k: "text", x: 1e9, y: -1e9, w: 0, h: "12", r: 720, z: -3,
    onclick: "alert(1)", html: "<b>x</b>", fill: "red", fc: "t:evil",
    paras: [{ l: 9, ls: "x", r: [{ t: "a\u0000b", b: "yes" }, { t: "c" }, { t: "" }], style: "x" }],
    al: "center", va: "m"
  });
  assert.deepEqual(j(it), {
    id: "item-1", m: 5, s: "slide-1", k: "text", x: 6000, y: -6000, w: 1, h: 12, r: 0, z: 0,
    paras: [{ l: 4, ls: "", r: [{ t: "a bc" }] }],   // equal runs joined (canonical)
    al: "l", va: "m", fs: 32, ff: "", fc: "t:fg", b: 0
  });
  // Rotations wrap into [-180, 180).
  assert.equal(C.normItem({ id: "item-2", m: 1, s: "slide-1", k: "shape", r: -400 }).r, -40);
  assert.equal(C.normItem({ id: "item-2", m: 1, s: "slide-1", k: "shape", r: 270 }).r, -90);
  // Images keep only a content hash, never a URL.
  const im = C.normItem({ id: "img-1", m: 1, s: "slide-1", k: "image", img: { h: "javascript:alert(1)", src: "http://x" } });
  assert.equal(im.img, undefined);
  const ok = C.normItem({ id: "img-2", m: 1, s: "slide-1", k: "image", img: { h: "a".repeat(64), pw: 800, ph: 600, src: "x" } });
  assert.deepEqual(Object.keys(ok.img).sort(), ["alt", "fit", "h", "ox", "oy", "ph", "pw", "zm"]);
  // Bad ids or kinds: dropped.
  assert.equal(C.normItem({ id: "Bad Id", m: 1, s: "slide-1", k: "text" }), null);
  assert.equal(C.normItem({ id: "item-3", m: 1, s: "slide-1", k: "script" }), null);
  assert.equal(C.normSlide({ id: "slide-1", m: 1, d: "deck-1", p: "" }), null);
  // Too much text stops at the limit.
  const long = C.normParas(Array.from({ length: 100 }, () => ({ r: [{ t: "x".repeat(900) }] })));
  assert.ok(long.reduce((n, p) => n + C.paraText(p).length, 0) <= C.LIM.itemText);
});

// ---------- layouts ----------

test("new slides get the layout's placeholders, positioned by aspect", () => {
  const d = C.emptyData(), id = ids("a");
  const deck = C.newDeck(d, { t: "T", as: "4:3" }, 10, id);
  const s = C.addSlide(d, deck.id, "two", null, 10, id);
  const its = C.slideItems(d, s.id);
  assert.deepEqual(j(its.map((i) => i.ph)), ["title", "body", "body2"]);
  const b2 = its[2];
  assert.equal(b2.x, Math.round(0.51 * 1333));
  assert.equal(b2.w, Math.round(0.43 * 1333));
  assert.ok(its.every((i) => C.isEmptyPlaceholder(i)));
});

test("changing layout keeps content: text moves by role, extras become free items", () => {
  const d = C.emptyData(), id = ids("b");
  const deck = C.newDeck(d, {}, 10, id);
  const s = C.addSlide(d, deck.id, "two", null, 10, id);
  const [t, b1, b2] = C.slideItems(d, s.id);
  C.setItemParas(d, t.id, [{ r: [{ t: "Hello" }] }], 20);
  C.setItemParas(d, b1.id, [{ ls: "b", r: [{ t: "left" }] }], 20);
  C.setItemParas(d, b2.id, [{ ls: "b", r: [{ t: "right" }] }], 20);
  C.applyLayout(d, s.id, "content", 30, id);
  const after = C.slideItems(d, s.id);
  assert.equal(C.itemText(C.placeholder(d, s.id, "title")), "Hello");
  assert.equal(C.itemText(C.placeholder(d, s.id, "body")), "left");
  const free = after.filter((i) => !i.ph);
  assert.equal(free.length, 1);
  assert.equal(C.itemText(free[0]), "right");      // nothing lost
  assert.equal(d.slides[s.id].ly, "content");
  // Back to two columns: an empty second column appears.
  C.applyLayout(d, s.id, "two", 40, id);
  assert.equal(C.itemText(C.placeholder(d, s.id, "body2")), "");
  // An empty placeholder without a place goes (with a tombstone).
  C.applyLayout(d, s.id, "content", 50, id);
  assert.equal(C.placeholder(d, s.id, "body2"), null);
  assert.ok(Object.values(d.tombs).includes(50));
});

test("a full-picture layout uses the old title as its caption", () => {
  const d = C.emptyData(), id = ids("c");
  const deck = C.newDeck(d, {}, 10, id);
  const s = C.addSlide(d, deck.id, "section", null, 10, id);
  C.setItemParas(d, C.placeholder(d, s.id, "title").id, [{ r: [{ t: "Day one" }] }], 11);
  C.applyLayout(d, s.id, "photo", 12, id);
  assert.equal(C.itemText(C.placeholder(d, s.id, "cap")), "Day one");
  assert.equal(C.slideTitle(d, s.id), "Day one");
  assert.ok(C.placeholder(d, s.id, "img"));
});

test("aspect change moves items without stretching them", () => {
  const d = C.emptyData(), id = ids("e");
  const deck = C.newDeck(d, {}, 10, id);
  const s = C.addSlide(d, deck.id, "blank", null, 10, id);
  d.items["free-1"] = C.normItem({ id: "free-1", m: 10, s: s.id, k: "shape", x: 1678, y: 100, w: 100, h: 100 });
  C.setAspect(d, deck.id, "4:3", 20);
  const it = d.items["free-1"];
  assert.equal(it.w, 100);
  assert.equal(it.h, 100);
  assert.equal(it.x, Math.round((1678 + 50) * 1333 / 1778 - 50));
  assert.equal(d.decks[deck.id].as, "4:3");
});

// ---------- slide order ----------

test("add, move, duplicate and delete slides keep a stable order", () => {
  const d = C.emptyData(), id = ids("f");
  const deck = C.newDeck(d, {}, 10, id);
  const a = C.addSlide(d, deck.id, "title", null, 10, id);
  const b = C.addSlide(d, deck.id, "content", null, 11, id);
  const c = C.addSlide(d, deck.id, "content", a.id, 12, id);   // between a and b
  assert.deepEqual(j(C.deckSlides(d, deck.id).map((s) => s.id)), [a.id, c.id, b.id]);
  C.moveSlide(d, a.id, b.id, null, 13);                         // to the end
  assert.deepEqual(j(C.deckSlides(d, deck.id).map((s) => s.id)), [c.id, b.id, a.id]);
  const dup = C.duplicateSlide(d, c.id, 14, id);
  const order = j(C.deckSlides(d, deck.id).map((s) => s.id));
  assert.deepEqual(order, [c.id, dup.id, b.id, a.id]);
  assert.equal(C.slideItems(d, dup.id).length, C.slideItems(d, c.id).length);
  assert.ok(C.slideItems(d, dup.id).every((i) => i.s === dup.id));
  C.deleteSlide(d, b.id, 15);
  assert.equal(d.tombs[b.id], 15);
  assert.equal(C.slideItems(d, b.id).length, 0);
});

// ---------- outline ----------

test("outline: parse titles, bullets with levels, numbers, columns and notes", () => {
  const o = C.parseOutline([
    "# First",
    "Subtitle line",
    "",
    "# Points",
    "- one",
    "  - one.a",
    "\t\t- deep",
    "1. step",
    "2) step two",
    "--",
    "* right",
    "> say this",
    "> and this",
    "#hashtag is not a title",
    "#",
  ].join("\r\n"));
  assert.equal(o.length, 3);
  assert.equal(o[0].title, "First");
  assert.ok(o[0].plainOnly);
  const p = o[1];
  assert.deepEqual(j(p.body).map((x) => [x.l, x.ls, x.r[0].t]), [
    [0, "b", "one"], [1, "b", "one.a"], [2, "b", "deep"], [0, "n", "step"], [0, "n", "step two"]
  ]);
  assert.deepEqual(j(p.body2).map((x) => x.r[0].t), ["right", "#hashtag is not a title"]);
  assert.equal(p.notes, "say this\nand this");
  assert.equal(o[2].title, "");
});

test("outline round trip: format -> apply changes nothing, for every template and language", () => {
  C.TEMPLATES.forEach((tp) => {
    ["en", "el"].forEach((lang) => {
      const d = C.emptyData(), id = ids("t");
      const deck = C.fromTemplate(d, tp.id, lang, 1000, id);
      const text = C.formatOutline(d, deck.id);
      const before = JSON.stringify(d);
      const res = C.applyOutline(d, deck.id, text, 2000, id);
      assert.deepEqual(j(res), { added: 0, removed: 0, changed: 0 }, tp.id + "/" + lang);
      assert.equal(JSON.stringify(d), before, tp.id + "/" + lang);
      // The outline is exactly what the template says (album pictures aside).
      assert.equal(C.parseOutline(text).length, C.parseOutline(tp[lang]).length);
    });
  });
});

test("outline: plain lines that look like markup survive a round trip", () => {
  const d = C.emptyData(), id = ids("g");
  const deck = C.newDeck(d, {}, 10, id);
  const s = C.addSlide(d, deck.id, "content", null, 10, id);
  C.setItemParas(d, C.placeholder(d, s.id, "body").id, [
    { r: [{ t: "- not a bullet" }] }, { r: [{ t: "# not a title" }] }, { r: [{ t: "> not a note" }] }, { r: [{ t: "--" }] }
  ], 11);
  const before = JSON.stringify(d);
  const text = C.formatOutline(d, deck.id);
  assert.equal(C.parseOutline(text).length, 1);
  C.applyOutline(d, deck.id, text, 12, id);
  assert.equal(JSON.stringify(d), before);
});

test("outline edits: formatting kept on unchanged lines, layouts adapt, extra slides go", () => {
  const d = C.emptyData(), id = ids("h");
  const deck = C.newDeck(d, {}, 10, id);
  C.applyOutline(d, deck.id, "# Title\nby me\n\n# Points\n- a\n- b\n\n# Gone\n- x", 10, id);
  let sl = C.deckSlides(d, deck.id);
  assert.deepEqual(j(sl.map((s) => s.ly)), ["title", "content", "content"]);
  // Make "a" bold, then edit the outline: "a" stays bold, "b" changes.
  const body = C.placeholder(d, sl[1].id, "body");
  C.setItemParas(d, body.id, [{ ls: "b", r: [{ t: "a", b: true }] }, { ls: "b", r: [{ t: "b" }] }], 20);
  const res = C.applyOutline(d, deck.id, "# Title\nby me\n\n# Points\n- a\n- B!\n--\n- right side", 30, id);
  sl = C.deckSlides(d, deck.id);
  assert.deepEqual(j(res), { added: 0, removed: 1, changed: 1 });
  assert.equal(sl.length, 2);
  assert.equal(sl[1].ly, "two");
  const p = j(C.placeholder(d, sl[1].id, "body").paras);
  assert.deepEqual(p[0], { l: 0, ls: "b", r: [{ t: "a", b: true }] });
  assert.deepEqual(p[1], { l: 0, ls: "b", r: [{ t: "B!" }] });
  assert.equal(bodyOf(d, sl[1].id, "body2"), "right side");
  // Bullets on the title slide turn it into a content slide.
  C.applyOutline(d, deck.id, "# Title\n- now a list\n\n# Points\n- a\n- B!\n--\n- right side", 40, id);
  assert.equal(C.deckSlides(d, deck.id)[0].ly, "content");
  assert.equal(bodyOf(d, C.deckSlides(d, deck.id)[0].id), "now a list");
});

test("templates: every template builds in both languages with titles", () => {
  assert.equal(C.TEMPLATES.length, 6);
  C.TEMPLATES.forEach((tp) => {
    const d = C.emptyData();
    const deck = C.fromTemplate(d, tp.id, "el", 5, ids("p"));
    assert.equal(d.decks[deck.id].t, tp.name.el);
    assert.equal(d.decks[deck.id].th, tp.th);
    const titles = texts(d, deck.id);
    assert.ok(titles.length >= 4);
    assert.ok(titles.every((t) => t.length > 0), tp.id + ": " + titles.join("|"));
    assert.ok(/[α-ω]/i.test(titles.join(" ")));
  });
  assert.equal(C.fromTemplate(C.emptyData(), "nope", "en", 1), null);
});

// ---------- merge ----------

function twoDevices() {
  const base = C.emptyData(), id = ids("m");
  const deck = C.fromTemplate(base, "project", "en", 1000, id);
  return { base, deck, A: j(base), B: j(base), id };
}

test("merge: symmetric, idempotent and canonical (R5, R26)", () => {
  const { A, B, deck, id } = twoDevices();
  const sa = C.deckSlides(A, deck.id), sb = C.deckSlides(B, deck.id);
  C.addSlide(A, deck.id, "quote", sa[1].id, 2000, ids("x"));
  C.setNotes(B, sb[2].id, "remember", 2100);
  C.moveSlide(B, sb[0].id, sb[3].id, sb[4].id, 2200);
  const ab = C.mergeSlides(A, B), ba = C.mergeSlides(B, A);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba));
  assert.equal(JSON.stringify(C.mergeSlides(ab, ab)), JSON.stringify(ab));
  assert.equal(canon(ab), JSON.stringify(ab));
  assert.equal(JSON.stringify(C.mergeSlides(ab, A)), JSON.stringify(ab));
  assert.equal(C.deckSlides(ab, deck.id).length, 6);
  assert.equal(ab.slides[sb[2].id].n, "remember");
  // Three-way: associative.
  const X = j(B);
  C.setNotes(X, sb[1].id, "x", 2300);
  assert.equal(JSON.stringify(C.mergeSlides(C.mergeSlides(A, B), X)), JSON.stringify(C.mergeSlides(A, C.mergeSlides(B, X))));
  void id;
});

test("merge: two reorders on two devices both land", () => {
  const { A, B, deck } = twoDevices();
  const s = C.deckSlides(A, deck.id).map((x) => x.id);   // 0 1 2 3 4
  C.moveSlide(A, s[0], s[4], null, 2000);                  // A: first to the end
  C.moveSlide(B, s[3], null, s[0], 2000);                  // B: fourth to the front
  const m = C.mergeSlides(A, B);
  assert.deepEqual(j(C.deckSlides(m, deck.id).map((x) => x.id)), [s[3], s[1], s[2], s[4], s[0]]);
});

test("merge: a newer edit inside a deleted deck brings back the deck and the edit (R17)", () => {
  const { A, B, deck } = twoDevices();
  C.deleteDeck(A, deck.id, 3000);
  // B edits a slide's body after the delete: deck, slide and that box
  // come back; what A deleted and B did not touch stays deleted.
  const s1 = C.deckSlides(B, deck.id)[1];
  const body = C.placeholder(B, s1.id, "body");
  C.setItemParas(B, body.id, [{ r: [{ t: "edited later" }] }], 4000);
  const m = C.mergeSlides(A, B);
  assert.ok(m.decks[deck.id]);
  assert.deepEqual(j(C.deckSlides(m, deck.id).map((s) => s.id)), [s1.id]);
  assert.deepEqual(j(Object.keys(m.items)), [body.id]);
  assert.equal(C.itemText(m.items[body.id]), "edited later");
  assert.equal(JSON.stringify(m), JSON.stringify(C.mergeSlides(B, A)));
  assert.equal(JSON.stringify(C.mergeSlides(m, m)), JSON.stringify(m));
  assert.equal(JSON.stringify(C.mergeSlides(m, A)), JSON.stringify(m));
  // Theme changed on one device, a slide edited on the other: both kept.
  const t = twoDevices();
  t.A.decks[t.deck.id].th = "ocean"; t.A.decks[t.deck.id].m = 5000;
  C.setNotes(t.B, C.deckSlides(t.B, t.deck.id)[0].id, "hi", 6000);
  const m3 = C.mergeSlides(t.A, t.B);
  assert.equal(m3.decks[t.deck.id].th, "ocean");
  assert.equal(C.deckSlides(m3, t.deck.id)[0].n, "hi");
  // An edit older than the delete does not resurrect anything.
  const { A: A2, B: B2, deck: d2 } = twoDevices();
  C.deleteDeck(A2, d2.id, 3000);
  const b2 = C.placeholder(B2, C.deckSlides(B2, d2.id)[1].id, "body");
  C.setItemParas(B2, b2.id, [{ r: [{ t: "older" }] }], 2500);
  const m2 = C.mergeSlides(A2, B2);
  assert.deepEqual(j(Object.keys(m2.decks)), []);
  assert.deepEqual(j(Object.keys(m2.slides)), []);
  assert.deepEqual(j(Object.keys(m2.items)), []);
});

test("merge: a deleted slide stays deleted unless edited after; a delete at the same ms wins", () => {
  const { A, B, deck } = twoDevices();
  const s = C.deckSlides(A, deck.id)[2];
  C.deleteSlide(A, s.id, 3000);
  const m = C.mergeSlides(A, B);
  assert.equal(m.slides[s.id], undefined);
  C.setNotes(B, s.id, "same ms", 3000);
  assert.equal(C.mergeSlides(A, B).slides[s.id], undefined);
  C.setNotes(B, s.id, "later", 3001);
  assert.equal(C.mergeSlides(A, B).slides[s.id].n, "later");
});

test("merge: text edited on two devices offline -> newer wins, older offered as recovered", () => {
  const { A, B, deck } = twoDevices();
  const s = C.deckSlides(A, deck.id)[1];
  const body = C.placeholder(A, s.id, "body");
  C.setItemParas(A, body.id, [{ r: [{ t: "from A" }] }], 5000);
  C.setItemParas(B, body.id, [{ r: [{ t: "from B" }] }], 6000);
  const got = [], got2 = [];
  const m = C.mergeSlides(A, B, (r) => got.push(j(r)));
  C.mergeSlides(B, A, (r) => got2.push(j(r)));
  assert.equal(C.itemText(m.items[body.id]), "from B");
  assert.deepEqual(got, [{ id: "r-" + body.id + "-" + (5000).toString(36), m: 5000, d: deck.id, s: s.id, w: "text", x: "from A" }]);
  assert.deepEqual(got2, got);
  assert.equal(m.rec, undefined);                        // device-local, never synced
  // The device-local list: one per id, newest first, bounded, validated.
  let list = C.pushRecovered([], got[0]);
  list = C.pushRecovered(list, got[0]);
  list = C.pushRecovered(list, { id: "<img>", m: 1, d: deck.id, s: s.id, w: "text", x: "x" });
  assert.equal(list.length, 1);
  assert.equal(C.deckRecovered(list, deck.id).length, 1);
  assert.equal(C.dropRecovered(list, got[0].id).length, 0);
  for (let i = 0; i < 80; i++) list = C.pushRecovered(list, { id: "r-item-" + i + "-a", m: 10000 + i, d: deck.id, s: s.id, w: "text", x: "t" + i });
  assert.equal(list.length, C.LIM.recovered);
  assert.equal(list[0].x, "t79");
  // A plain sequential edit (built on A's version) recovers nothing.
  const seq = j(A), none = [];
  C.setItemParas(seq, body.id, [{ r: [{ t: "A then more" }] }], 8000);
  C.mergeSlides(A, seq, (r) => none.push(r));
  assert.equal(none.length, 0);
  // Deleted after both edits: nothing to recover.
  const del = j(B), gone = [];
  C.deleteSlide(del, s.id, 9000);
  C.mergeSlides(C.mergeSlides(A, B), del, (r) => gone.push(r));
  assert.equal(gone.length, 0);

});

test("merge: an editing session base keeps a concurrent edit made in between", () => {
  const { A, B, deck } = twoDevices();
  const s = C.deckSlides(A, deck.id)[1];
  const body = C.placeholder(A, s.id, "body");
  const base = A.items[body.id].m;
  C.setItemParas(A, body.id, [{ r: [{ t: "A1" }] }], 5000, base);
  C.setItemParas(B, body.id, [{ r: [{ t: "B" }] }], 5500);
  C.setItemParas(A, body.id, [{ r: [{ t: "A2" }] }], 6000, base);   // same session on A
  const got = [];
  const m = C.mergeSlides(A, B, (r) => got.push(r.x));
  assert.equal(C.itemText(m.items[body.id]), "A2");
  assert.deepEqual(j(got), ["B"]);
  void deck;

});

test("merge: speaker notes edited on two devices keep both", () => {
  const { A, B, deck } = twoDevices();
  const s = C.deckSlides(A, deck.id)[0];
  C.setNotes(A, s.id, "notes A", 5000);
  C.setNotes(B, s.id, "notes B", 5100);
  const got = [];
  const m = C.mergeSlides(A, B, (r) => got.push([r.w, r.x, r.d]));
  assert.equal(m.slides[s.id].n, "notes B");
  assert.deepEqual(j(got), [["notes", "notes A", deck.id]]);
  // A layout change on A and new notes on B: both land (separate parts).
  const t = twoDevices();
  const s2 = C.deckSlides(t.A, t.deck.id)[1];
  C.setNotes(t.B, s2.id, "B's notes", 5000);
  C.applyLayout(t.A, s2.id, "two", 6000, ids("q"));
  const m2 = C.mergeSlides(t.A, t.B);
  assert.equal(m2.slides[s2.id].n, "B's notes");
  assert.equal(m2.slides[s2.id].ly, "two");

});

test("merge: garbage in, valid data out", () => {
  const { A, deck } = twoDevices();
  const junk = {
    decks: [{ id: "x" }, null, 5, { id: "deck-9", m: -1 }],
    slides: { a: { id: "slide-x", m: 1, d: "nope", p: "1" } },     // orphan: dropped
    items: "nope", ghosts: { slides: [null, { id: "slide-y", m: 1, d: "nope", p: "1" }] }, tombs: { "BAD ID": 5, ok1: "x" }
  };
  const m = C.mergeSlides(A, junk);
  assert.equal(JSON.stringify(m), JSON.stringify(C.mergeSlides(A, {})));
  assert.equal(JSON.stringify(C.mergeSlides(null, undefined)), JSON.stringify(C.emptyData()));
  assert.ok(m.decks[deck.id]);
});

// ---------- show.js (pure parts) ----------

test("show keys: clickers, arrows, letters by code (Greek layout too)", () => {
  assert.equal(S.keyAction("PageDown", "PageDown"), "next");
  assert.equal(S.keyAction("PageUp", "PageUp"), "prev");
  assert.equal(S.keyAction(" ", "Space"), "next");
  assert.equal(S.keyAction("Enter", "Enter"), "enter");
  assert.equal(S.keyAction("β", "KeyB"), "black");      // Greek layout: e.key is a Greek letter
  assert.equal(S.keyAction(".", "Period"), "black");
  assert.equal(S.keyAction("ς", "KeyW"), "white");
  assert.equal(S.keyAction("7", "Digit7"), "digit:7");
  assert.equal(S.keyAction("Escape", "Escape"), "end");
  assert.equal(S.keyAction("x", "KeyX"), null);
});

test("show navigation: hidden slides skipped, numbers among visible, end screen", () => {
  const n = new S.Nav(6, [false, true, false, false, true, false], 1);
  assert.deepEqual(Array.from(n.order), [0, 2, 3, 5]);
  assert.equal(n.index(), 2);            // start on a hidden slide -> next visible
  assert.equal(n.nextIndex(), 3);
  assert.ok(n.goNumber(4));
  assert.equal(n.index(), 5);
  assert.equal(n.nextIndex(), -1);
  assert.ok(n.next());
  assert.ok(n.atEnd());
  assert.equal(n.index(), -1);
  assert.equal(n.next(), false);
  assert.ok(n.prev());
  assert.equal(n.index(), 5);
  assert.equal(n.goNumber(9), false);
  assert.ok(n.first());
  assert.equal(n.prev(), false);
  assert.ok(n.goIndex(4));               // hidden -> following visible
  assert.equal(n.index(), 5);
  assert.ok(n.last() === false);
  const empty = new S.Nav(0, [], 0);
  assert.ok(empty.atEnd());
});

test("show timings: elapsed and clock formats, per-slide summary", () => {
  assert.equal(S.fmtElapsed(0), "0:00");
  assert.equal(S.fmtElapsed(65000), "1:05");
  assert.equal(S.fmtElapsed(3725000), "1:02:05");
  assert.equal(S.fmtClock(new Date(2026, 0, 1, 9, 5)), "09:05");
  assert.deepEqual(j(S.summary({ 3: 1000, 0: 500 }, 1600)), { total: 1600, per: [{ index: 0, ms: 500 }, { index: 3, ms: 1000 }] });
});

test("merge fuzz: three devices converge whatever the sync order", () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let round = 0; round < 150; round++) {
    const { base, deck } = twoDevices();
    const devs = [j(base), j(base), j(base)];
    let clock = 2000;
    devs.forEach((d, di) => {
      const id = ids("d" + di + "r" + round + "-");
      for (let k = 0; k < 6; k++) {
        clock += 1 + Math.floor(rnd() * 3);
        const sl = C.deckSlides(d, deck.id);
        if (!d.decks[deck.id]) break;
        const s = sl[Math.floor(rnd() * sl.length)];
        const op = Math.floor(rnd() * 8);
        if (!s) { C.addSlide(d, deck.id, "content", null, clock, id); continue; }
        if (op === 0) C.addSlide(d, deck.id, "content", s.id, clock, id);
        else if (op === 1) C.deleteSlide(d, s.id, clock);
        else if (op === 2) C.moveSlide(d, s.id, null, sl[0].id, clock);
        else if (op === 3) C.setNotes(d, s.id, "n" + di + "-" + k, clock);
        else if (op === 4) C.applyLayout(d, s.id, C.LAYOUT_IDS[Math.floor(rnd() * C.LAYOUT_IDS.length)], clock, id);
        else if (op === 5 && rnd() < 0.3) C.deleteDeck(d, deck.id, clock);
        else {
          const t = C.slideItems(d, s.id).filter((i) => i.k === "text")[0];
          if (t) C.setItemParas(d, t.id, [{ r: [{ t: "t" + di + "-" + k }] }], clock);
        }
      }
    });
    const [A, B, X] = devs;
    const M = (a, b) => C.mergeSlides(a, b);
    const str = (x) => JSON.stringify(x);
    // Pairwise: symmetric and idempotent.
    [[A, B], [B, X], [A, X]].forEach(([p, q]) => {
      assert.equal(str(M(p, q)), str(M(q, p)), "round " + round);
      const m = M(p, q);
      assert.equal(str(M(m, m)), str(m), "round " + round);
    });
    // Sync to a fixpoint in two different orders: same data everywhere.
    function settle(order) {
      const st = order.map(j);
      for (let pass = 0; pass < 4; pass++) {
        for (let a = 0; a < st.length; a++) for (let b = 0; b < st.length; b++) {
          if (a === b) continue;
          const m = M(st[a], st[b]);
          st[a] = m; st[b] = j(m);
        }
      }
      st.forEach((x) => assert.equal(str(x), str(st[0]), "round " + round));
      return str(st[0]);
    }
    const f1 = settle([A, B, X]), f2 = settle([X, A, B]);
    assert.equal(f1, f2, "round " + round);
    assert.equal(str(M(JSON.parse(f1), JSON.parse(f1))), f1);
  }
});

test("canonical form is stable after every kind of change (R26)", () => {
  const d = C.emptyData(), id = ids("k");
  const deck = C.fromTemplate(d, "report", "en", 10, id);
  const sl = C.deckSlides(d, deck.id);
  C.applyLayout(d, sl[1].id, "imgtext", 20, id);
  C.applyLayout(d, sl[1].id, "blank", 21, id);
  C.moveSlide(d, sl[0].id, sl[2].id, sl[3].id, 22);
  C.duplicateSlide(d, sl[3].id, 23, id);
  C.setAspect(d, deck.id, "4:3", 24);
  C.deleteSlide(d, sl[4].id, 25);
  C.setNotes(d, sl[2].id, "x", 26);
  const c = C.canonical(d);
  assert.equal(JSON.stringify(C.canonical(c)), JSON.stringify(c));
  assert.equal(JSON.stringify(C.mergeSlides(c, d)), JSON.stringify(c));
  // Nothing visible changes in the canonical form.
  assert.equal(C.formatOutline(c, deck.id), C.formatOutline(d, deck.id));
  assert.ok(c.ghosts.slides[sl[4].id]);
  assert.equal(c.ghosts.slides[sl[4].id].n, "");
});
