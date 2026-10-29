// Slides commands for the Assistant (slides/commands.js, AS-EDIT,
// wave SL1): the catalog and its guide, checking, picking objects,
// every command on a real presentation (and that the result survives
// normalization and a merge), locked objects, where new slides go,
// which presentations a request is for, the preview counts, the
// outline for the AI; and the wiring in Slides (assist.js, putDeck)
// and the Assistant (source, card words in EN, EL and DE).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SC = require(path.join(ROOT, "slides/core.js")).OrosSlidesCore;
const CMD = require(path.join(ROOT, "slides/commands.js"));
const C = require(path.join(ROOT, "assistant/core.js"));
const J = (x) => JSON.stringify(x);
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// A presentation: a title slide, a content slide with notes and a
// photo, a slide with a table and a locked logo.
function deck() {
  let n = 0;
  const nid = () => "id" + String(++n).padStart(4, "0");
  const d = SC.emptyData();
  const dk = SC.newDeck(d, { t: "Sales 2025" }, 100, nid);
  SC.applyOutline(d, dk.id, "# Sales 2025\nThe year in review\n# Results\n- Revenue up in 2025\n- Costs flat\n> Say 2025 twice\n# Table\n", 101, nid);
  const s = SC.deckSlides(d, dk.id);
  SC.applyLayout(d, s[0].id, "title", 102, nid);
  // "Costs flat" with flat in bold: two runs
  const body = SC.slideItems(d, s[1].id).filter((x) => x.ph === "body")[0];
  SC.setItemParas(d, body.id, [body.paras[0], { l: 0, ls: "b", r: [{ t: "Costs " }, { t: "flat", b: true }] }], 102);
  d.items.pic01 = SC.normItem({ id: "pic01", m: 103, s: s[1].id, k: "image", x: 1200, y: 300, w: 400, h: 300, z: 5, img: { a: "a".repeat(64) + ".jpg", pw: 800, ph: 600, alt: "a chart of 2025" } });
  d.items.tab01 = SC.normItem({ id: "tab01", m: 103, s: s[2].id, k: "table", x: 100, y: 300, w: 900, h: 300, z: 5, tb: { rows: [["Year", "Total"], ["2025", "10"]] } });
  d.items.logo1 = SC.normItem({ id: "logo1", m: 103, s: s[2].id, k: "shape", x: 1600, y: 850, w: 100, h: 100, z: 6, lk: true });
  return { d: SC.canonical(d), id: dk.id, nid };
}
function run(steps, opt) {
  const t = deck(), chk = CMD.check(steps);
  assert.ok(chk.ok, chk.err);
  const w = CMD.part(t.d, t.id), notes = [];
  let k = 0;
  chk.steps.forEach((st) => { k += CMD.apply(w, t.id, st, { now: 500, newId: t.nid, notes }); });
  return Object.assign(t, { w, k, notes, steps: chk.steps, slides: SC.deckSlides(w, t.id), opt });
}
const textOf = (w, id) => SC.itemText(w.items[id]);
const titleOf = (w, s) => SC.slideItems(w, s.id).filter((x) => x.ph === "title")[0];

test("the catalog, its lists and the guide", () => {
  assert.deepEqual(CMD.ORDER, ["replace", "settext", "textstyle", "colors", "photo", "place", "align", "arrange", "remove", "animate", "add",
    "pages", "delpages", "movepage", "slide", "bg", "notes", "deck", "rename"]);
  CMD.ORDER.forEach((op) => {
    assert.match(CMD.GUIDE, new RegExp("\\b" + op + ":"), op);
    Object.keys(CMD.CATALOG[op].args).forEach((k) => assert.match(CMD.GUIDE, new RegExp("\\b" + k + "\\b"), op + "." + k));
  });
  assert.deepEqual(CMD.CATALOG.slide.args.layout.v.slice(1), SC.LAYOUT_IDS);
  assert.deepEqual(CMD.CATALOG.deck.args.theme.v.slice(1), SC.THEME_IDS);
  assert.deepEqual(CMD.CATALOG.slide.args.trans.v.slice(1), SC.TRANSITIONS);
  const tool = C.editTool({ slides: CMD });
  const props = tool.params.properties.steps.items.properties;
  CMD.ORDER.forEach((op) => Object.keys(CMD.CATALOG[op].args).forEach((k) => assert.ok(props[k], k)));
  assert.match(tool.description, /Slides commands/);
});

test("check: unknown commands, fields, values and slide lists go back to the model", () => {
  assert.match(CMD.check([{ op: "explode" }]).err, /unknown command/);
  assert.match(CMD.check([{ op: "slide", pages: "all", grad: "#000000" }]).err, /grad is not a field of slide/);
  assert.match(CMD.check([{ op: "deck", theme: "neon" }]).err, /theme "neon" is not allowed/);
  assert.match(CMD.check([{ op: "bg", pages: "2-x", fill: "#000000" }]).err, /not a slide list/);
  assert.match(CMD.check([{ op: "remove" }]).err, /pick the objects/);
  assert.match(CMD.check([{ op: "slide", pages: "1" }]).err, /give layout, trans, secs or hide/);
  assert.match(CMD.check([{ op: "add", what: "text" }]).err, /needs text/);
  assert.match(CMD.check(new Array(41).fill({ op: "rename", title: "x" })).err, /at most 40/);
  assert.ok(CMD.check([{ op: "textstyle", what: "title", c: "#FF0000", bold: "on" }]).ok);
});

test("replace: texts, tables, a picture's description stays, speaker notes; across formatting runs", () => {
  const r = run([{ op: "replace", find: "2025", repl: "2026" }]);
  const s = r.slides;
  assert.equal(textOf(r.w, titleOf(r.w, s[0]).id), "Sales 2026");
  assert.match(SC.slideItems(r.w, s[1].id).map((x) => SC.itemText(x)).join("|"), /Revenue up in 2026/);
  assert.deepEqual(r.w.items.tab01.tb.rows[1], ["2026", "10"]);
  assert.equal(r.w.slides[s[1].id].n, "Say 2026 twice");
  assert.equal(r.w.items.pic01.img.alt, "a chart of 2025", "descriptions are not text");
  // a match across two runs ("Costs flat" with flat bold): one run in the first look
  const r2 = run([{ op: "replace", find: "Costs flat", repl: "Costs down" }]);
  const body = SC.slideItems(r2.w, r2.slides[1].id).filter((x) => x.ph === "body")[0];
  assert.equal(SC.itemText(body).split("\n")[1], "Costs down");
  // whole words, match case
  const r3 = run([{ op: "replace", find: "sales", repl: "x", cs: true }]);
  assert.equal(r3.k, 0);
  assert.deepEqual(r3.notes, []);
});

test("textstyle, colors, settext, photo on what they pick", () => {
  const r = run([{ op: "textstyle", what: "title", c: "#ff0000", bold: "on", size: 90, font: "serif", align: "c", valign: "m" },
                 { op: "colors", what: "shape", fill: "#00ff00", stroke: "#000000", sw: 3, ids: "logo1" },
                 { op: "photo", what: "photo", fit: "fit", round: 50, alt: "Revenue chart" }]);
  r.slides.forEach((s) => {
    const tt = titleOf(r.w, s);
    assert.equal(tt.fc, "#ff0000"); assert.equal(tt.fs, 90); assert.equal(tt.ff, "serif"); assert.equal(tt.al, "c"); assert.equal(tt.va, "m");
    tt.paras.forEach((p) => p.r.forEach((x) => assert.equal(x.b, true)));
  });
  assert.equal(r.w.items.logo1.fill, "#00ff00");
  assert.equal(r.w.items.logo1.st, "#000000"); assert.equal(r.w.items.logo1.sw, 3);
  assert.equal(r.w.items.pic01.img.fit, "fit"); assert.equal(r.w.items.pic01.rad, 75); assert.equal(r.w.items.pic01.img.alt, "Revenue chart");
  assert.equal(r.k, 3 + 1 + 1);
  const r2 = run([{ op: "settext", ids: titleOf(deck().d, SC.deckSlides(deck().d, deck().id)[1]).id, text: "Results\nand more" }]);
  assert.equal(SC.itemText(titleOf(r2.w, r2.slides[1])), "Results\nand more");
});

test("place, align, arrange and remove spare a locked object unless it is named by id", () => {
  const r = run([{ op: "place", pages: "3", dx: 10 }]);
  assert.equal(r.w.items.logo1.x, 1600);
  assert.equal(r.w.items.tab01.x, 110);
  assert.deepEqual(r.notes, ["locked"]);
  const r2 = run([{ op: "place", ids: "logo1", pos: "br", gap: 20 }]);
  assert.equal(r2.w.items.logo1.x, 1778 - 20 - 100); assert.equal(r2.w.items.logo1.y, 1000 - 20 - 100);
  const r3 = run([{ op: "remove", pages: "3" }]);
  assert.ok(r3.w.items.logo1 && !r3.w.items.tab01 && r3.w.tombs.tab01 === 500);
  const r4 = run([{ op: "arrange", ids: "tab01", order: "front" }, { op: "arrange", ids: "logo1", lock: "off" }]);
  assert.ok(r4.w.items.tab01.z > r4.w.items.logo1.z);
  assert.ok(!r4.w.items.logo1.lk);
  const r5 = run([{ op: "align", pages: "3", edge: "l", rel: "page" }]);
  assert.equal(r5.w.items.tab01.x, 0);
  assert.equal(r5.w.items.logo1.x, 1600);
  const r6 = run([{ op: "place", what: "table", pct: 50, rot: 30, opacity: 40 }]);
  assert.deepEqual([r6.w.items.tab01.w, r6.w.items.tab01.h, r6.w.items.tab01.x, r6.w.items.tab01.r, r6.w.items.tab01.op], [450, 150, 325, 0, 40]);
});

test("animate: entrance in the slide show, fly direction and start; none takes it away", () => {
  const r = run([{ op: "animate", what: "title", anim: "fly", side: "l", start: "a" }]);
  r.slides.forEach((s) => assert.deepEqual(Object.assign({}, titleOf(r.w, s).an, { o: "" }), { e: "fly", o: "", d: "l", w: "a" }));
  const t = deck(), w = CMD.part(t.d, t.id);
  CMD.check([{ op: "animate", what: "title", anim: "fade" }, { op: "animate", what: "title", anim: "none" }]).steps.forEach((st) => CMD.apply(w, t.id, st, { now: 9 }));
  SC.deckSlides(w, t.id).forEach((s) => assert.ok(!titleOf(w, s).an));
});

test("slides: added at the end, before or after a slide, as copies; removed and moved", () => {
  const base = deck(), names = (r) => r.slides.map((s) => SC.slideTitle(r.w, s.id) || "·" + s.ly);
  assert.deepEqual(names(run([{ op: "pages", n: 2, layout: "blank" }])), ["Sales 2025", "Results", "Table", "·blank", "·blank"]);
  assert.deepEqual(names(run([{ op: "pages", n: 2, at: "before", page: 1, layout: "section" }])), ["·section", "·section", "Sales 2025", "Results", "Table"]);
  assert.deepEqual(names(run([{ op: "pages", n: 1, at: "after", page: 1, layout: "quote" }])), ["Sales 2025", "·quote", "Results", "Table"]);
  const dup = run([{ op: "pages", n: 2, at: "after", page: 2, dup: true }]);
  assert.deepEqual(names(dup), ["Sales 2025", "Results", "Results", "Results", "Table"]);
  assert.equal(dup.w.slides[dup.slides[2].id].n, "Say 2025 twice");
  assert.deepEqual(names(run([{ op: "delpages", first: 2, last: 3 }])), ["Sales 2025"]);
  const all = run([{ op: "delpages", first: 1, last: 9 }]);
  assert.deepEqual(names(all), ["Table"]);
  assert.deepEqual(all.notes, ["lastSlide"]);
  assert.deepEqual(names(run([{ op: "movepage", page: 1, dest: 3 }])), ["Results", "Table", "Sales 2025"]);
  assert.equal(run([{ op: "movepage", page: 2, dest: 2 }]).k, 0);
  assert.ok(base);
});

test("slide settings, backgrounds, notes, the deck and its name", () => {
  const r = run([{ op: "slide", pages: "2-3", layout: "two", trans: "wipe", secs: 0.8, hide: "on" },
                 { op: "bg", pages: "first", fill: "#112233" },
                 { op: "notes", pages: "1", text: "Welcome" }, { op: "notes", pages: "2", text: "Then the chart", append: true },
                 { op: "deck", theme: "dark", aspect: "4:3", footer: "ACME", num: "on" }, { op: "rename", title: "Sales 2026" }]);
  const s = r.slides;
  assert.deepEqual([s[1].ly, s[1].tr, s[1].td, s[1].hid, s[2].ly], ["two", "wipe", 800, true, "two"]);
  assert.equal(s[0].bg, "#112233");
  assert.equal(s[0].n, "Welcome");
  assert.equal(s[1].n, "Say 2025 twice\nThen the chart");
  const d = r.w.decks[r.id];
  assert.deepEqual([d.th, d.as, d.ft.x, d.ft.n, d.t], ["dark", "4:3", "ACME", true, "Sales 2026"]);
  assert.equal(r.k, 2 + 1 + 2 + 3 + 1);
});

test("add: a text, a shape and a line on a slide", () => {
  const r = run([{ op: "add", what: "text", page: 2, text: "Thank you", size: 60, bold: "on", c: "#ff0000" },
                 { op: "add", what: "shape", page: 2, shape: "ellipse", fill: "#00ff00", x: 10, y: 10, w: 100, h: 100 },
                 { op: "add", what: "line", page: 9 }]);
  const items = SC.slideItems(r.w, r.slides[1].id), last = items.slice(-2);
  assert.equal(SC.itemText(last[0]), "Thank you"); assert.equal(last[0].fs, 60); assert.equal(last[0].fc, "#ff0000");
  assert.deepEqual([last[1].sh, last[1].fill, last[1].x, last[1].w], ["ellipse", "#00ff00", 10, 100]);
  assert.ok(SC.slideItems(r.w, r.slides[2].id).some((x) => x.k === "line"), "page past the end: the last slide");
  assert.equal(r.k, 3);
});

test("the result survives normalization and a merge with the stored data, and twice changes nothing more", () => {
  const steps = [{ op: "replace", find: "2025", repl: "2026" }, { op: "textstyle", what: "title", c: "#ff0000" }, { op: "slide", pages: "all", trans: "fade" },
                 { op: "deck", theme: "ocean" }, { op: "place", what: "photo", x: 100 }];
  const r = run(steps);
  const merged = SC.mergeSlides(r.d, r.w);
  assert.deepEqual(SC.canonical(r.w), r.w, "already canonical");
  assert.equal(merged.decks[r.id].th, "ocean");
  assert.equal(merged.items.pic01.x, 100);
  const w2 = CMD.part(r.w, r.id);
  let k = 0;
  r.steps.forEach((st) => { k += CMD.apply(w2, r.id, st, { now: 600 }); });
  assert.equal(k, 0);
});

test("targets, preview and outline", () => {
  const t = deck(), v = CMD.view(t.d);
  assert.deepEqual(v.docs.map((d) => d.name), ["Sales 2025"]);
  assert.match(CMD.targets(v, null, "", "open", "").err, /no presentation is open/);
  assert.equal(CMD.targets(v, null, t.id, "open", "").docs[0].id, t.id);
  assert.equal(CMD.targets(v, null, "", "named", "sales").docs[0].id, t.id);
  assert.match(CMD.targets(v, null, "", "named", "budget").err, /presentations: "Sales 2025"/);
  assert.match(CMD.targets(v, null, "", "folder", "x").err, /no folders/);
  assert.match(CMD.targets(CMD.view(null), null, "", "all", "").err, /no presentations/);
  const chk = CMD.check([{ op: "replace", find: "2025", repl: "2026" }, { op: "pages", n: 1, dup: true, page: 1 }, { op: "textstyle", what: "title", c: "#ff0000" }]);
  const pv = CMD.preview(v, [t.id], chk.steps);
  const w = CMD.part(t.d, t.id);
  let k = 0;
  chk.steps.forEach((st) => { k += CMD.apply(w, t.id, st, { now: 5 }); });
  assert.equal(pv.n, k);
  assert.equal(pv.n, 4 + 1 + 4, "the copy's title counts too");
  assert.equal(J(t.d), J(deck().d), "preview works on copies");
  const o = CMD.outline(v.docs[0]);
  assert.equal(o.slides.length, 3);
  assert.equal(o.slides[1].notes, "Say 2025 twice");
  assert.ok(o.slides[2].objects.some((x) => x.id === "logo1" && x.locked));
  assert.ok(o.slides[1].objects.some((x) => x.kind === "photo" && x.alt === "a chart of 2025"));
  assert.ok(!J(o).includes("a".repeat(64)), "no picture data");
});

test("wiring: Slides loads the catalog on the first request and writes through putDeck", () => {
  const app = read("slides/app.js");
  assert.match(app, /tg\.edit \|\| tg\.editUndo/);
  assert.match(app, /load\("commands\.js"\)/);
  assert.match(app, /SL\.putDeck = function/);
  assert.match(app, /SL\.deckState = function/);
  const as = read("slides/assist.js");
  assert.match(as, /K\.check\(rq && rq\.steps\)/, "Slides checks the commands again");
  assert.match(as, /fp\(st\) !== s\.fp/, "a changed presentation is not undone");
  const sw = read("sw.js");
  ["slides/commands.js", "slides/assist.js"].forEach((f) => assert.ok(sw.includes('"' + f + '"'), f));
  // the strings Slides shows, in every language
  const de = read("i18n/de/slides.js");
  ["as.done", "as.done1", "as.done0", "as.bad", "as.undone", "as.changed", "as.gone"].forEach((k) => {
    assert.equal((app.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k);
    assert.ok(de.includes('"' + k + '":'), k);
  });
});

test("wiring: the Assistant reads Slides, and the card speaks of presentations and slides in EN, EL and DE", () => {
  const html = read("assistant/index.html");
  assert.ok(!html.includes("../slides/"), "loaded on first use, not on the first open");
  const as = read("assistant/assistant.js");
  assert.match(as, /EDIT_LAZY = \{ slides: \["\.\.\/slides\/core\.js", "\.\.\/slides\/commands\.js"\] \}/);
  assert.match(as, /slides: \{ mod: "SlidesCommands", data: "oros-slides-data", prefs: "oros-slides-prefs", open: "deck", view: 1 \}/);
  assert.equal(C.EDIT_APP ? C.EDIT_APP.slides.noun : "presentation", "presentation");
  const de = read("i18n/de/assistant.js");
  const keys = ["ed.will.slides", "ed.did.slides", "ed.op.slide", "ed.op.notes", "ed.op.deck", "ed.f.pages.slides", "ed.note.noObjects", "ed.note.lastSlide", "ed.note.maxSlides"];
  CMD.ORDER.forEach((op) => keys.push(as.includes('"ed.op.' + op + '.slides"') ? "ed.op." + op + ".slides" : "ed.op." + op));
  CMD.ORDER.forEach((op) => Object.keys(CMD.CATALOG[op].args).forEach((k) => { if (k !== "what" || op !== "add") keys.push("ed.f." + k); }));
  ["valign", "side", "start", "layout", "theme", "num", "date"].forEach((k) => {
    const spec = Object.values(CMD.CATALOG).map((c) => c.args[k]).filter(Boolean)[0];
    spec.v.filter(Boolean).forEach((v) => keys.push("ed.v." + k + "." + v));
  });
  ["appear", "fly", "zoom"].forEach((v) => keys.push("ed.v.anim." + v));
  keys.push("ed.v.trans.wipe", "ed.v.what.title");
  keys.forEach((k) => {
    assert.equal((as.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length, 2, "EN + EL " + k);
    assert.ok(de.includes('"' + k + '":'), "DE " + k);
  });
});

test("the catalog runs where the Assistant loads it (browser globals, no Node)", () => {
  const ctx = { window: {}, console };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  ["recipes/core.js", "slides/core.js", "slides/commands.js"].forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  const K = ctx.window.SlidesCommands;
  assert.ok(K && typeof K.preview === "function");
  const t = deck(), v = K.view(JSON.parse(J(t.d)));
  assert.equal(K.preview(v, [t.id], K.check([{ op: "deck", theme: "dark" }]).steps).n, 1);
});
