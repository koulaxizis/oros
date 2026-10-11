// Pure logic of the Label Maker (labels/core.js): what the tape can
// print, the stable emboss, label sizes, the A4 print sheet, the
// saved-labels merge (sync slice "labels") and the recent list; plus
// the wiring of the app and of the Label button in Storage.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const C = require(path.join(__dirname, "..", "labels/core.js"));
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const lab = (id, m, extra) => Object.assign({ id, m, text: "BOX " + id.slice(1, 4).toUpperCase(), tape: "red", width: 12, cut: "straight", margin: 1 }, extra || {});
const empty = () => ({ ver: 1, labels: [], tombs: {} });

test("cleanText: capitals without accents, only what the wheel has", () => {
  assert.equal(C.cleanText("kitchen"), "KITCHEN");
  assert.equal(C.cleanText("Κουζίνα ράφι 2"), "ΚΟΥΖΙΝΑ ΡΑΦΙ 2");
  assert.equal(C.cleanText("ψωμί ΐ ΰ Ϊ ς"), "ΨΩΜΙ Ι Υ Ι Σ");
  assert.equal(C.cleanText("café naïve"), "CAFE NAIVE");
  assert.equal(C.cleanText("  a   b \t\n c  "), "A B C");
  assert.equal(C.cleanText("a  ", true), "A ");             // one trailing space while typing
  assert.equal(C.cleanText("~a^b{c}d[e]f%g$h\\"), "ABCDEFGH");
  assert.equal(C.cleanText("I ❤ you ☆ 🙂"), "I ♥ YOU ★ ☺");
  assert.equal(C.cleanText("it’s — fine…"), "IT'S - FINE...");
  assert.equal(C.cleanText("Τι κάνεις;"), "ΤΙ ΚΑΝΕΙΣ?");    // the Greek question mark
  assert.equal(C.cleanText("a;b"), "A,B");
  assert.equal(C.cleanText("a@b.gr 10€ #1 (x)*=+/:!&"), "A@B.GR 10€ #1 (X)*=+/:!&");
  assert.equal(C.cleanText("x".repeat(60)).length, C.MAX_LEN);
  assert.equal(C.cleanText(null), "");
  assert.equal(C.cleanText("日本語"), "");
  C.WHEEL.forEach((c) => assert.equal(C.cleanText(c), c, "wheel letter " + c));
  assert.equal(C.WHEEL.length, new Set(C.WHEEL).size);
});

test("emboss: the same letter in the same place always looks the same", () => {
  const a = C.emboss(3, "K"), b = C.emboss(3, "K");
  assert.deepEqual(a, b);
  assert.notDeepEqual(C.emboss(3, "K"), C.emboss(4, "K"));
  for (let i = 0; i < 40; i++) {
    for (const ch of ["A", "Ω", "7", "♥"]) {
      const e = C.emboss(i, ch);
      assert.ok(Math.abs(e.dx) <= 0.04 && Math.abs(e.dy) <= 0.05 && Math.abs(e.rot) <= 1.5);
      assert.ok(e.sx >= 0.95 && e.sx <= 1.05 && e.white >= 0.8 && e.white <= 1);
    }
  }
});

test("geometry: real size in mm", () => {
  const g = C.geometry({ text: "KITCHEN", width: 12, margin: 1, cut: "straight" });
  assert.equal(g.w, 12);
  assert.equal(g.capH, 6);
  assert.ok(Math.abs(g.len - (7 * 4.68 + 2 * 4.68 * 1.6)) < 0.01);
  assert.ok(Math.abs(g.x0 - 4.68 * 1.6) < 0.01);
  const n9 = C.geometry({ text: "KITCHEN", width: 9, margin: 1 });
  assert.ok(n9.len < g.len && n9.capH === 4.5);
  const narrow = C.geometry({ text: "KITCHEN", width: 12, margin: 0 });
  const wide = C.geometry({ text: "KITCHEN", width: 12, margin: 2 });
  assert.ok(narrow.len < g.len && g.len < wide.len);
  const round = C.geometry({ text: "KITCHEN", width: 12, margin: 0, cut: "round" });
  assert.ok(round.round && round.x0 >= 6);                    // the curve never cuts a letter
  const blank = C.geometry({ text: "", width: 12 });
  assert.equal(blank.len, 30);                                 // an empty tape still shows
  assert.equal(C.geometry({ text: "AB", width: 7, margin: 9 }).w, 12);
});

test("sheetLayout: labels on A4 at real size", () => {
  const g = C.geometry({ text: "KITCHEN", width: 12, margin: 1 });     // ~47.7 x 12 mm
  const pages = C.sheetLayout(Array(60).fill(g));
  // 190 mm usable: 3 per row (3*47.7 + 2*4 = 151); 277 mm: 17 rows (17*12 + 16*4 = 268)
  assert.equal(pages[0].length, 51);
  assert.equal(pages.length, 2);
  assert.equal(pages[1].length, 9);
  pages[0].forEach((p) => {
    assert.ok(p.x >= 10 && p.x + p.w <= 200.001);
    assert.ok(p.y >= 10 && p.y + p.h <= 287.001);
  });
  assert.deepEqual(pages[0].slice(0, 3).map((p) => p.i), [0, 1, 2]);
  assert.equal(pages[0][3].x, 10);                            // second row starts at the margin
  // a 40-letter 12 mm label is longer than the sheet is wide: it stands upright
  const long = C.geometry({ text: "X".repeat(40), width: 12, margin: 2, cut: "round" });
  const lp = C.sheetLayout([long, g]);
  assert.equal(lp[0][0].rot, true);
  assert.equal(lp[0][0].w, 12);
  assert.ok(lp[0][0].h > 190);
  assert.equal(lp[0][1].rot, false);
  assert.equal(C.sheetLayout(Array(5).fill(C.geometry({ text: "AB", width: 9, margin: 0 })))[0].length, 5);
  assert.deepEqual(C.sheetLayout([]), []);
});

test("mergeLabels: LWW per label, laws hold", () => {
  const A = { labels: [lab("laaaaaa1", 5), lab("lbbbbbb1", 9, { text: "OLD" })], tombs: {} };
  const B = { labels: [lab("lbbbbbb1", 12, { text: "NEW", tape: "blue" }), lab("lcccccc1", 3)], tombs: {} };
  const ab = C.mergeLabels(A, B), ba = C.mergeLabels(B, A);
  assert.deepEqual(ab, ba);                                                    // commutative
  assert.deepEqual(C.mergeLabels(ab, ab), ab);                                 // idempotent
  const D = { labels: [lab("ldddddd1", 1)], tombs: { laaaaaa1: 2 } };
  assert.deepEqual(C.mergeLabels(C.mergeLabels(A, B), D), C.mergeLabels(A, C.mergeLabels(B, D)));   // associative
  assert.equal(C.findLabel(ab, "lbbbbbb1").text, "NEW");
  assert.equal(C.findLabel(ab, "lbbbbbb1").tape, "blue");
  assert.deepEqual(ab.labels.map((l) => l.id), ["laaaaaa1", "lbbbbbb1", "lcccccc1"]);
  // equal m: the larger canonical copy wins on both sides
  const t1 = C.mergeLabels({ labels: [lab("leeeeee1", 7, { text: "A" })] }, { labels: [lab("leeeeee1", 7, { text: "B" })] });
  const t2 = C.mergeLabels({ labels: [lab("leeeeee1", 7, { text: "B" })] }, { labels: [lab("leeeeee1", 7, { text: "A" })] });
  assert.deepEqual(t1, t2);
});

test("mergeLabels: tombstones, undo, junk", () => {
  const base = { labels: [lab("laaaaaa1", 5)], tombs: {} };
  const del = C.mergeLabels(base, { labels: [], tombs: { laaaaaa1: 5 } });
  assert.equal(del.labels.length, 0);                                          // delete wins ties
  assert.equal(del.tombs.laaaaaa1, 5);
  const undo = C.mergeLabels(del, { labels: [lab("laaaaaa1", 6)], tombs: {} });
  assert.equal(undo.labels.length, 1);                                         // a newer edit resurrects (R17)
  const stale = C.mergeLabels(del, { labels: [lab("laaaaaa1", 4)] });
  assert.equal(stale.labels.length, 0);
  const junk = C.mergeLabels({
    labels: [null, 5, { id: "bad", m: 1, text: "X" }, { id: "lffffff1", m: -1, text: "X" },
             { id: "lggggggg1", m: 1.5, text: "X" }, { id: "lhhhhhh1", m: 2, text: "日本" },
             { id: "liiiiii1", m: 3, text: "ok", tape: "pink", width: 19, cut: "zigzag", margin: 7, extra: 1 }],
    tombs: { bad: 1, ljjjjjj1: -3, lkkkkkk1: "x", lllllll1: 4 }
  }, null);
  assert.deepEqual(junk.labels, [{ id: "liiiiii1", m: 3, text: "OK", tape: "red", width: 12, cut: "straight", margin: 1 }]);
  assert.deepEqual(junk.tombs, { lllllll1: 4 });
  assert.deepEqual(C.mergeLabels(null, undefined), empty());
});

test("pushRecent: newest first, no doubles, one entry while typing", () => {
  let r = [];
  r = C.pushRecent(r, { text: "HEL" }, true);
  r = C.pushRecent(r, { text: "HELLO" }, true);
  assert.deepEqual(r.map((x) => x.text), ["HELLO"]);
  r = C.pushRecent(r, { text: "BOX" }, false);
  r = C.pushRecent(r, { text: "HELLO" }, false);
  assert.deepEqual(r.map((x) => x.text), ["HELLO", "BOX"]);
  r = C.pushRecent(r, { text: "HELLO", tape: "blue" }, false);                // another colour is another label
  assert.equal(r.length, 3);
  for (let i = 0; i < 20; i++) r = C.pushRecent(r, { text: "L" + i }, false);
  assert.equal(r.length, C.MAX_RECENT);
  assert.equal(r[0].text, "L19");
  assert.deepEqual(C.pushRecent(r, { text: "  " }, false), r);
  assert.deepEqual(C.pushRecent("junk", { text: "a" }, false), [{ text: "A", tape: "red", width: 12, cut: "straight", margin: 1 }]);
});

test("wheel, ids, names", () => {
  assert.equal(C.wheelStep(0, -1), C.WHEEL.length - 1);
  assert.equal(C.wheelStep(C.WHEEL.length - 1, 1), 0);
  assert.equal(C.wheelStep(25, 1, 26), 0);
  assert.equal(C.wheelStep(3, -5, 26), 24);
  assert.equal(C.WHEEL[C.wheelIndex("Ω")], "Ω");
  assert.equal(C.wheelIndex("~"), 0);
  assert.ok(C.ID_RE.test(C.newId(Math.random)));
  assert.equal(C.fileName("Κουζίνα / ράφι 2"), "ΚΟΥΖΙΝΑ-ΡΑΦΙ-2.png");
  assert.equal(C.fileName("..."), "label.png");
  assert.equal(C.fileName(""), "label.png");
});

test("wiring: app, palette, sync, deep link, Storage button", () => {
  const js = read("labels/labels.js"), html = read("labels/index.html");
  assert.ok(js.includes("inheritPalette") && js.includes("watchPalette"));            // guard G3
  assert.ok(/registerSlice\("labels", sliceGet, sliceSet, STORAGE_KEY, C\.mergeLabels\)/.test(js));
  assert.ok(js.includes('"oros-labels-data"') && js.includes('"oros-labels-prefs"'));
  assert.equal((js.match(/window\.__orosOpenAt\s*=/g) || []).length, 1);
  assert.ok(js.includes('__orosTakeTarget("labels")'));
  assert.ok(html.indexOf("core.js") < html.indexOf("labels.js"));
  for (const f of ["help.en.txt", "help.el.txt"]) assert.ok(fs.existsSync(path.join(__dirname, "..", "labels", f)));
  const st = read("storage/storage.js");
  assert.ok(/__orosOpenAt\("labels", \{ text: /.test(st));
  assert.equal((st.match(/window\.__orosOpenAt\s*=/g) || []).length, 1);
});
