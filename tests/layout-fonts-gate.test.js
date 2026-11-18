// Fonts through Claude (Chris 2026-11-18): addfont puts a Fontsource
// family or a local font file into the owner's collection and the
// document; defstyle font takes a family by the name list_fonts shows
// (built-in, the document's, or found by Layout before the run).
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PRO = require(path.join(ROOT, "layout/pro.js"));
const CMD = require(path.join(ROOT, "layout/commands.js"));
const T = require(path.join(ROOT, "designkit/text.js"));

function steps(list) { const c = CMD.check(list); assert.ok(c.ok, c.err); return c.steps; }
function book() { return PRO.makeDoc(steps([{ op: "create", title: "Στην καρδιά του βυθού", w: 180, h: 250, n: 10, mm: 3 }])[0], 10); }
const CARLITO = { id: "fs_carlito", name: "Carlito", fb: "sans" };

test("addfont: checked", () => {
  assert.ok(CMD.check([{ op: "addfont", family: "Carlito" }]).ok);
  assert.ok(CMD.check([{ op: "addfont", family: "Carlito", styles: ["regular", "700", "italic", "bold italic"] }]).ok);
  assert.match(CMD.check([{ op: "addfont", source: "free" }]).err, /needs family/);
  assert.match(CMD.check([{ op: "addfont", family: "X", styles: ["heavy"] }]).err, /styles/);
  assert.ok(CMD.check([{ op: "addfont", source: "local", path: "local:Fonts/Carlito-Regular.ttf" }]).ok);
  assert.match(CMD.check([{ op: "addfont", source: "local", path: "/internal/Fonts/a.ttf" }]).err, /local:<root>/);
  assert.match(CMD.check([{ op: "addfont", source: "local", path: "local:Fonts/readme.txt" }]).err, /local:<root>/);
  assert.deepEqual(CMD.fontVars(["Bold", "400", "700i", "bold"]), ["b", "r", "bi"]);
  assert.match(CMD.GUIDE, /addfont: /);
});

test("addfont: the document lists the family Layout found, once", () => {
  const d = book(), st = steps([{ op: "addfont", family: "Carlito" }])[0];
  assert.equal(CMD.apply(d, st, {}), 1, "before Layout looked it counts as a change (the card's preview)");
  assert.equal(CMD.apply(d, st, { prepared: 1 }), 0, "nothing found, nothing changed");
  assert.equal(CMD.apply(d, st, { prepared: 1, font: CARLITO }), 1);
  assert.deepEqual(d.setup.ext.fonts, [CARLITO]);
  assert.equal(CMD.apply(d, st, { prepared: 1, font: CARLITO }), 0, "a second time changes nothing");
});

test("defstyle font: built-in, the document's family, a family found before the run", () => {
  const d = book(), notes = [];
  const def = (font, env) => CMD.apply(d, steps([{ op: "defstyle", name: "Σώμα", font: font, size: 11 }])[0], Object.assign({ now: 20, notes: notes, prepared: 1 }, env || {}));
  def("Noto Serif");
  let ps = PRO.styleNamed(d.pstyles, "Σώμα");
  assert.equal(ps.font, "serif");
  assert.ok(!(ps.ext && ps.ext.fam));
  // Fontsource by name, found by Layout (proassist.js, fonts.js match)
  assert.equal(def("Carlito", { fonts: { carlito: CARLITO } }), 1);
  ps = PRO.styleNamed(d.pstyles, "Σώμα");
  assert.equal(ps.font, "sans", "the built-in stand-in");
  assert.equal(ps.ext.fam, "fs_carlito");
  assert.ok(d.setup.ext.fonts.some((e) => e.id === "fs_carlito"), "the document lists it");
  // the text engine takes the family for the style
  const r = T.resolvePs ? T.resolvePs({ "ps-b": ps }, "ps-b") : null;
  if (r) assert.equal(r.fam, "fs_carlito");
  // now on the list, by name in any case, with nothing found before
  assert.equal(def("carlito"), 0, "as it is");
  // back to a built-in clears the family
  assert.equal(def("mono"), 1);
  ps = PRO.styleNamed(d.pstyles, "Σώμα");
  assert.equal(ps.font, "mono");
  assert.ok(!ps.ext.fam);
  // a name nobody has: a note, the style keeps its font
  def("No Such Font 77");
  assert.equal(PRO.styleNamed(d.pstyles, "Σώμα").font, "mono");
  assert.ok(notes.includes("noFont: No Such Font 77"), notes.join("|"));
});

test("defstyle font in the card's preview: counted, no note", () => {
  const d = book(), notes = [];
  assert.equal(CMD.apply(d, steps([{ op: "defstyle", name: "Τίτλος", font: "Carlito" }])[0], { now: 5, notes: notes }), 1);
  assert.deepEqual(notes, []);
});

test("Layout looks the font up before the run (wiring)", () => {
  const fs = require("fs");
  const pa = fs.readFileSync(path.join(ROOT, "layout/proassist.js"), "utf8"), as = fs.readFileSync(path.join(ROOT, "layout/assist.js"), "utf8");
  assert.match(pa, /st\.op === "addfont"/);
  assert.match(pa, /LY\.F\.match\(st\.font/);
  assert.match(pa, /keepOffline/);
  assert.match(pa, /F\.importFile/);
  assert.match(as, /addfont: 1/);
  assert.match(as, /slowStep/);
  assert.match(fs.readFileSync(path.join(ROOT, "layout/fontpick.js"), "utf8"), /cols: CB/);
});

test("busy (Chris 2026-11-18): cancel goes alone and changes nothing; the gate names the holder and keeps jobs", () => {
  const fs = require("fs");
  assert.ok(CMD.check([{ op: "cancel" }]).ok);
  assert.match(CMD.check([{ op: "cancel" }, { op: "rename", title: "x" }]).err, /cancel goes alone/);
  const d = book();
  assert.equal(CMD.apply(d, steps([{ op: "cancel" }])[0], {}), 0);
  assert.equal(CMD.preview({ docs: [d] }, [d.id], steps([{ op: "cancel" }])).ctl, 1);
  const as = fs.readFileSync(path.join(ROOT, "layout/assist.js"), "utf8"), a = fs.readFileSync(path.join(ROOT, "assistant/assistant.js"), "utf8");
  assert.match(as, /no\.holder = holder\(\)/);
  assert.match(as, /op === "cancel"/);
  assert.match(as, /t\("btn\.stop"\)/);
  assert.match(a, /function busyText/);
  assert.match(a, /out\.edit_jobs = jobs/);
  assert.match(a, /!p\.pv\.ctl/);
});

test("framemod (Chris 2026-11-18, P0): one frame moved, resized, restyled; one removed; a chain keeps its text", () => {
  const d = book();
  const idf = ((n) => (p) => p + "-fm" + (++n))(0);
  const add = (page) => PRO.addFrame(d, steps([{ op: "frame", page: page, lines: ["Ένα κείμενο."] }])[0], 30, idf);
  const a = add(2), b = add(3);
  // b continues a's story (a chain of two)
  const fb = d.items.find((it) => it.id === b.id);
  const sb = fb.story; fb.story = a.story; fb.seq = 2; d.items.find((it) => it.id === a.id).seq = 1;
  d.stories = d.stories.filter((s) => s.id !== sb);
  const MM = 72 / 25.4;
  assert.equal(CMD.apply(d, steps([{ op: "framemod", frame: a.id, x: 20, y: 30, w: 100, h: 50, va: "m", ncol: 2, ins: 2, fill: "#eeeeee", opacity: 80 }])[0], { now: 40 }), 1);
  const fa = d.items.find((it) => it.id === a.id);
  assert.ok(Math.abs(fa.x - 20 * MM) < 0.01 && Math.abs(fa.w - 100 * MM) < 0.01 && fa.va === "c" && fa.cols === 2 && fa.op === 80 && fa.fill);
  assert.equal(CMD.apply(d, steps([{ op: "framemod", frame: a.id, x: 20 }])[0], { now: 41 }), 0, "as it is: nothing");
  assert.equal(CMD.apply(d, steps([{ op: "framemod", frame: a.id, nofill: true, opacity: 100 }])[0], { now: 42 }), 1);
  assert.ok(!fa.fill && fa.op === undefined);
  assert.equal(CMD.apply(d, steps([{ op: "framemod", frame: a.id, del: true }])[0], { now: 43 }), 1);
  assert.ok(!d.items.some((it) => it.id === a.id) && d.tombs[a.id] === 43);
  assert.ok(d.stories.some((s) => s.id === a.story), "the story stays with the other frame of its chain");
  assert.equal(CMD.apply(d, steps([{ op: "framemod", frame: b.id + ", nope", del: true }])[0], { now: 44 }), 1);
  assert.ok(!d.stories.some((s) => s.id === a.story) && d.tombs[a.story] === 44, "with its last frame the story goes");
  assert.match(CMD.check([{ op: "framemod" }]).err, /frame is missing/);
});

test("masterfield (P1): page numbers outside on both sides, a running head, hidden on chosen pages, set again in place", () => {
  const d = book(), ms = d.masters[0], name = "A-Master";
  let notes = [];
  const run = (o) => CMD.apply(d, steps([Object.assign({ op: "masterfield", master: name }, o)])[0], { now: 50, notes: notes, idf: ((n) => (p) => p + "-mf" + (++n))(Math.floor(Math.random() * 1e6)) });
  assert.ok(run({ pos: "bo", size: 10 }) > 0);
  const pn = d.items.filter((it) => it.pg === ms.id && it.ext && it.ext.mfk === "pn");
  assert.equal(pn.length, 2, "one per side");
  const L = pn.find((it) => it.side === "L"), R = pn.find((it) => it.side === "R");
  const psOf = (it) => d.pstyles.find((p) => p.id === d.stories.find((s) => s.id === it.story).paras[0].ps);
  assert.equal(psOf(L).align, "l"); assert.equal(psOf(R).align, "r");
  assert.deepEqual(d.stories.find((s) => s.id === R.story).paras[0].runs, [{ f: "pn" }]);
  assert.ok(R.y > d.setup.h / 2, "at the bottom");
  // a second call changes it in place
  assert.ok(run({ pos: "bc", size: 9 }) > 0);
  assert.equal(d.items.filter((it) => it.pg === ms.id && it.ext && it.ext.mfk === "pn").length, 2);
  assert.equal(psOf(L).align, "c");
  // the running head with the title, at the top
  run({ kind: "runhead", text: "{title}", pos: "tc" });
  const rh = d.items.filter((it) => it.pg === ms.id && it.ext && it.ext.mfk === "rh");
  assert.equal(rh.length, 2);
  assert.equal(d.stories.find((s) => s.id === rh[0].story).paras[0].runs[0].t, "Στην καρδιά του βυθού");
  assert.ok(rh[0].y < d.setup.h / 2);
  // hidden on pages 1-3, shown again on 2
  run({ hide: "1-3" });
  const M = require(path.join(ROOT, "designkit/model.js"));
  const order = M.pagesInOrder(d);
  const shows = (i) => M.masterItems(d, order[i], d.setup.facing ? M.sideOf(d, i) : undefined).some((it) => it.ext && it.ext.mfk === "pn");
  assert.ok(!shows(0) && !shows(1) && !shows(2) && shows(3), "hidden on 1-3 only");
  run({ show: "2" });
  assert.ok(shows(1) && !shows(0));
  assert.match(CMD.check([{ op: "masterfield", master: "A", hide: "front" }]).err, /page lists/);
  // remove
  assert.ok(run({ remove: true }) > 0);
  assert.equal(d.items.filter((it) => it.pg === ms.id && it.ext && it.ext.mfk === "pn").length, 0);
  assert.ok(!d.items.some((it) => it.ext && it.ext.mfh === "pn"), "the hidden copies go too");
  run({ master: "No such" }); assert.ok(notes.includes("noMaster"));
});

test("colormode (P1), full read-back, flow report wiring", () => {
  const d = book();
  assert.equal(CMD.apply(d, steps([{ op: "colormode", color: "cmyk" }])[0], { now: 60 }), 1);
  assert.equal(d.setup.ext.cm, "cmyk"); assert.equal(d.setup.ext.icc, "fogra39");
  assert.equal(CMD.apply(d, steps([{ op: "colormode", color: "cmyk" }])[0], { now: 61 }), 0);
  assert.equal(CMD.apply(d, steps([{ op: "colormode", color: "rgb" }])[0], { now: 62 }), 1);
  assert.ok(!d.setup.ext.cm);
  const long = "Λέξη ".repeat(200);
  CMD.apply(d, steps([{ op: "frame", page: 2, lines: [long] }])[0], { now: 63, idf: ((n) => (p) => p + "-cm" + (++n))(0) });
  const cut = CMD.outline(d, null, {}), whole = CMD.outline(d, null, { full: true, livePf: { problems: [] } });
  const tx = (o) => o.stories.map((s) => s.paragraphs.map((p) => p.text).join("")).join("");
  assert.ok(tx(cut).length < long.length && /…$/.test(tx(cut)));
  assert.equal(tx(whole), long);
  assert.deepEqual(whole.preflight_now, { problems: [] });
  const fs = require("fs");
  assert.match(fs.readFileSync(path.join(ROOT, "layout/assist.js"), "utf8"), /pagesNote\(before, now2, notes\)/);
  assert.match(fs.readFileSync(path.join(ROOT, "layout/editor.js"), "utf8"), /oros-layout-pf/);
  assert.match(fs.readFileSync(path.join(ROOT, "assistant/core.js"), "utf8"), /full: a\.full === true/);
});
