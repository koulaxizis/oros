// Layout: Start here (LY-N1): the twelve starter books of
// layout/starters.js fit any trim (margins, type sizes, frames worked
// out from the page), open their first chapter on a right-hand page
// whatever first pages are asked for, carry their type pair's families,
// running heads and a contents page that Update contents can write
// again; orOS Gate's create takes `starter` and `pair`; the wizard,
// hints and Learn tab are wired (layout/startui.js), with every string
// in English, Greek and German.
// Run: node --test tests/layout-start.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const S = require(path.join(ROOT, "layout/starters.js"));
const A = require(path.join(ROOT, "layout/autolay.js"));
const CMD = require(path.join(ROOT, "layout/commands.js"));
const PRO = require(path.join(ROOT, "layout/pro.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const MM = 72 / 25.4;

// Layout's English and Greek strings, read from layout.js
const LYJS = read("layout/layout.js");
const EL_AT = LYJS.indexOf('"home.new": "Νέο έγγραφο"');
function table(part) {
  const out = {}, re = /"([a-z][a-zA-Z0-9.]*)": "((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(part))) if (!(m[1] in out)) out[m[1]] = JSON.parse('"' + m[2] + '"');
  return out;
}
const EN = table(LYJS.slice(0, EL_AT)), EL = table(LYJS.slice(EL_AT));
const DE = table(read("i18n/de/layout.js"));
const tEn = (k) => EN[k] || k;
const names = (k) => ({ en: EN[k] || k, el: EL[k] || k });
const build = (o) => S.build(Object.assign({ now: 5, t: tEn, names }, o));

test("start: twelve kinds, each builds a facing book whose text fits", () => {
  assert.equal(S.KINDS.length, 12);
  S.KINDS.forEach((k) => {
    const d = build({ kind: k.id, front: { half: 1, title: 1, copy: 1, ded: 1, toc: 1 } });
    assert.ok(d, k.id);
    assert.equal(d.setup.facing, 1, k.id);
    assert.deepEqual(d.setup.ext.start, { v: 1, k: k.id, title: "ps-chap" });
    assert.ok(Math.abs(d.setup.w - k.trim[0] * MM) < 0.01 && Math.abs(d.setup.h - k.trim[1] * MM) < 0.01, k.id);
    const L = R.computeLayout(d);
    const over = Object.keys(L.overset).filter((s) => L.overset[s]);
    assert.deepEqual(over, [], k.id + " has text that does not fit");
    // every item sits on a page or a master, inside the bleed
    const owners = new Set(d.pages.map((p) => p.id).concat(d.masters.map((m) => m.id)));
    const b = d.setup.bleed + 0.01;
    d.items.forEach((it) => {
      assert.ok(owners.has(it.pg), k.id + " item owner");
      assert.ok(it.x >= -b && it.y >= -b && it.x + it.w <= d.setup.w + b && it.y + it.h <= d.setup.h + b, k.id + " item inside the bleed");
    });
  });
  assert.equal(S.build({ kind: "nope" }), null);
});

test("start: margins and type follow the trim", () => {
  assert.equal(S.bodySize("novel", 120 * MM), 10);
  assert.equal(S.bodySize("novel", 140 * MM), 10.5);
  assert.equal(S.bodySize("novel", 170 * MM), 11);
  assert.ok(S.bodySize("children", 215 * MM) > S.bodySize("novel", 215 * MM));
  const a = S.marginsFor("novel", 120 * MM, 190 * MM, "normal"), b = S.marginsFor("novel", 170 * MM, 240 * MM, "normal");
  ["t", "b", "i", "o"].forEach((k) => assert.ok(b[k] > a[k], k));
  assert.ok(a.o > a.i && a.b > a.t, "a book's outside and foot are the wider margins");
  const tight = S.marginsFor("novel", 140 * MM, 210 * MM, "tight"), wide = S.marginsFor("novel", 140 * MM, 210 * MM, "wide");
  assert.ok(tight.i < a.i * 1.2 && wide.i > tight.i);
  // a custom trim: the book is built for it
  const d = build({ kind: "novel", w: 150 * MM, h: 230 * MM });
  assert.ok(Math.abs(d.setup.w - 150 * MM) < 0.01);
  assert.equal(d.setup.preset, "custom");
  assert.equal(build({ kind: "novel", w: 140 * MM, h: 210 * MM }).setup.preset, "bk140x210");
  const base = M.find(d.pstyles, "ps-base");
  assert.equal(base.size, S.bodySize("novel", 150 * MM));
});

test("start: the first chapter opens on a right-hand page, whatever first pages are asked for", () => {
  ["novel", "essay", "cookbook"].forEach((kind) => {
    for (let n = 0; n < 32; n++) {
      const front = {};
      S.FRONT.forEach((k, i) => { if (n & (1 << i)) front[k] = 1; });
      const d = build({ kind, front });
      const order = M.pagesInOrder(d), at = order.findIndex((p) => p.ms === "ms-o");
      assert.ok(at >= 0, kind);
      assert.equal(M.sideOf(d, at), "R", kind + " " + JSON.stringify(front));
      // the pages before it carry no master (no page numbers on the first pages)
      order.slice(0, at).forEach((p) => assert.equal(p.ms, ""));
    }
  });
  // the copyright page sits on the back of the title page
  const d = build({ kind: "novel", front: { title: 1, copy: 1 } });
  const order = M.pagesInOrder(d), texts = (p) => d.items.filter((i) => i.pg === p.id && i.t === "text").map((i) => M.find(d.stories, i.story).paras.map((q) => q.runs.map((r) => r.t || "").join("")).join("|")).join("#");
  assert.match(texts(order[0]), /Title of the book/);
  assert.match(texts(order[1]), /All rights reserved/);
  assert.equal(M.sideOf(d, 1), "L");
});

test("start: the book's details go onto its first pages", () => {
  const d = build({ kind: "essay", front: { half: 1, title: 1, copy: 1 }, meta: { title: "Salt", author: "A. Writer", publisher: "Gull Press", year: "2027", isbn: "978-618-00-0000-0" } });
  const all = d.stories.map((s) => s.paras.map((p) => p.runs.map((r) => r.t || "").join("")).join("\n")).join("\n");
  ["Salt", "A. Writer", "Gull Press", "© 2027 A. Writer", "ISBN 978-618-00-0000-0"].forEach((w) => assert.ok(all.includes(w), w));
  assert.equal(d.name, "Salt");
  assert.ok(!all.includes("Title of the book"));
});

test("start: running heads, page numbers and the chapter title style", () => {
  const d = build({ kind: "novel" });
  assert.deepEqual(d.masters.map((m) => m.id), ["ms-a", "ms-o"]);
  const heads = d.items.filter((i) => i.pg === "ms-a" && i.ext && i.ext.rh);
  assert.equal(heads.length, 2);
  const right = heads.find((i) => i.side === "R"), left = heads.find((i) => i.side === "L");
  assert.equal(M.find(d.stories, right.story).paras[0].runs[0].ext.fld, "sec");
  assert.equal(M.find(d.stories, left.story).paras[0].runs[0].t, "Title of the book");
  const pn = d.items.filter((i) => i.pg === "ms-o" && M.find(d.stories, i.story).paras[0].runs[0].f === "pn");
  assert.equal(pn.length, 2, "opening pages keep their numbers, without running heads");
  const chap = M.find(d.pstyles, "ps-chap");
  assert.equal(chap.ext.sec, 1);
  assert.equal(chap.ext.brk, "odd");
  assert.ok(chap.ext.sink > 0);
  // poetry: no running heads, a poem per page
  const p = build({ kind: "poetry" });
  assert.equal(p.items.filter((i) => i.ext && i.ext.rh).length, 0);
  assert.equal(M.find(p.pstyles, "ps-chap").ext.brk, "page");
  // picture books: numbers on the outside
  const c = build({ kind: "children" });
  assert.ok(M.find(c.pstyles, "ps-folior") && M.find(c.pstyles, "ps-foliol"));
});

test("start: the type pair's families are listed and named by the styles", () => {
  const n = build({ kind: "novel", pair: "noto" });
  assert.equal(n.setup.ext.fonts, undefined);
  assert.ok(n.pstyles.every((s) => !(s.ext && s.ext.fam)));
  const g = build({ kind: "novel", pair: "garamond" });
  assert.deepEqual(g.setup.ext.fonts.map((f) => f.id), ["fs_eb_garamond", "fs_fira_sans"]);
  assert.equal(M.find(g.pstyles, "ps-base").ext.fam, "fs_eb_garamond");
  assert.equal(M.find(g.pstyles, "ps-base").font, "serif");
  assert.equal(M.find(g.pstyles, "ps-h2").ext.fam, "fs_fira_sans");
  const s = build({ kind: "workbook", pair: "sans" });
  assert.deepEqual(s.setup.ext.fonts.map((f) => f.id), ["fs_fira_sans"]);
  // an unknown pair is the built-in one
  assert.equal(build({ kind: "novel", pair: "zzz" }).setup.ext.fonts, undefined);
});

test("start: the contents page points at the first chapter and Update contents writes it again", () => {
  const d = build({ kind: "essay", front: { half: 1, title: 1, copy: 1, toc: 1 } });
  const toc = d.stories.find((s) => s.ext && s.ext.hs === "toc");
  assert.ok(toc);
  const labels = M.pageLabels(d), opener = M.pagesInOrder(d).find((p) => p.ms === "ms-o");
  const no = labels.find((l) => l.id === opener.id).label;
  assert.equal(toc.paras[1].runs[0].t, "Chapter One\t" + no);
  // a second chapter typed in: Update contents (autolay.toc) finds both
  const body = d.stories.find((s) => s.paras.some((p) => p.ps === "ps-chap"));
  body.paras.push({ ps: "ps-chap", runs: [{ t: "Chapter Two" }] }, { ps: "ps-sfirst", runs: [{ t: "More." }] });
  const pages = M.pagesInOrder(d);
  const extra = [{ id: M.newId("pg"), m: 6, pos: (pages.length + 1) * 1024, ms: "ms-a" }, { id: M.newId("pg"), m: 6, pos: (pages.length + 2) * 1024, ms: "ms-a" }];
  d.pages.push(...extra);
  const last = M.chain(d, body.id).slice(-1)[0];
  extra.forEach((p, i) => d.items.push(Object.assign({}, last, { id: M.newId("it"), pg: p.id, seq: last.seq + 1024 * (i + 1), z: last.z + i + 1 })));
  const n = A.toc(M.normDoc(d));
  assert.ok(n >= 2, "entries " + n);
});

test("start: orOS Gate's create builds a starter for the trim, with the margins asked for", () => {
  const chk = CMD.check([{ op: "create", title: "Night Sea", w: 135, h: 210, starter: "novel", pair: "garamond", i: 20 }]);
  assert.equal(chk.ok, true, chk.err);
  const st = chk.steps[0];
  assert.equal(st.starter, "novel");
  const d = PRO.makeDoc(st, 7);
  assert.equal(d.setup.ext.start.k, "novel");
  assert.equal(d.name, "Night Sea");
  assert.ok(Math.abs(d.setup.w - 135 * MM) < 0.01);
  assert.ok(Math.abs(d.setup.mi - 20 * MM) < 0.01, "the inside margin asked for");
  assert.equal(d.setup.ext.fonts[0].id, "fs_eb_garamond");
  assert.ok(d.pages.length > 4);
  // without a starter: as before, a blank document
  const plain = PRO.makeDoc(CMD.check([{ op: "create", w: 210, h: 297, n: 2 }]).steps[0], 7);
  assert.equal(plain.pages.length, 2);
  assert.equal(plain.setup.ext && plain.setup.ext.start, undefined);
  assert.match(CMD.check([{ op: "create", w: 100, h: 100, starter: "opera" }]).err || "", /starter/);
});

test("start: every string in English, Greek and German", () => {
  const keys = new Set();
  [read("layout/starters.js"), read("layout/startui.js")].forEach((src) => {
    (src.match(/"(s[kx]\.[a-z0-9.]+|start\.[a-zA-Z0-9.]+|hint\.[a-z]+|learn\.[a-zA-Z.]+)"(?! \+)/g) || []).forEach((m) => {
      const k = m.slice(1, -1);
      if (!/\.$/.test(k)) keys.add(k);
    });
  });
  S.KINDS.forEach((k) => { keys.add("sk." + k.id); keys.add("sk.d." + k.id); });
  S.PAIRS.forEach((p) => keys.add("start.pair." + p.id));
  S.FRONT.forEach((f) => keys.add("start.fr." + f));
  ["start.s1", "start.s2", "start.s3", "start.s4", "sx.ingr1", "sx.ingr2", "sx.ingr3", "sk.sw.acc", "sk.sw.tint", "tab.learn", "home.book",
    "hint.start", "hint.editor", "hint.master", "learn.text.d", "learn.styles.d", "learn.pages.d", "learn.pics.d", "learn.toc.d", "learn.check.d", "learn.export.d"].forEach((k) => keys.add(k));
  keys.forEach((k) => {
    assert.ok(EN[k], "EN " + k);
    assert.ok(EL[k], "EL " + k);
    assert.ok(DE[k], "DE " + k);
  });
  assert.ok(keys.size > 150, "keys " + keys.size);
});

test("start: wiring (home buttons, New document, Learn tab, hints, scripts, precache)", () => {
  const idx = read("layout/index.html"), sw = read("sw.js"), pn = read("layout/panels.js"), ly = read("layout/layout.js"), ui = read("layout/startui.js");
  assert.match(idx, /id="btn-book"/);
  assert.match(idx, /id="btn-book2"/);
  const at = (s) => idx.indexOf('src="' + s);
  assert.ok(at("starters.js") > at("panels.js") && at("startui.js") > at("starters.js") && at("pro.js") > at("starters.js"), "script order");
  assert.match(sw, /"layout\/starters\.js",/);
  assert.match(sw, /"layout\/startui\.js",/);
  assert.match(pn, /var TABS = \["props", "pages", "styles", "colors", "learn"\]/);
  assert.match(pn, /LY\.startUI\.learn\(body\)/);
  assert.match(pn, /t\("start\.open"\)/);
  // dismissed hints are kept in the prefs, only as known-looking keys set to 1
  assert.match(ly, /p\.hints\[k\] === 1/);
  assert.match(ui, /LY\.prefs\.hints = h;/);
  assert.match(ui, /LY\.on\("open"/);
  // a starter book's contents can be updated like a house style's
  assert.match(read("layout/houseui.js"), /doc\.setup\.ext && doc\.setup\.ext\.start/);
});
