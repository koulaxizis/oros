// Layout commands for the Assistant (layout/commands.js, AS-EDIT for
// Layout): the catalog is Layout's automation steps plus rename,
// checking, applying on a real document, the same list twice changing
// nothing more, which documents a request is for, the preview counts
// (black and white counted before the copies exist), the outline for
// the AI, the Assistant without the text engine (fit later, pages
// without running text on); and the wiring in Layout (assist.js) and
// the Assistant.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const RC = require(path.join(ROOT, "recipes/core.js"));
const S = require(path.join(ROOT, "layout/recipesteps.js"));
const SH = require(path.join(ROOT, "recipes/share.js"));
const CMD = require(path.join(ROOT, "layout/commands.js"));
const AT = require(path.join(ROOT, "atelier/commands.js"));
const C = require(path.join(ROOT, "assistant/core.js"));
const J = (x) => JSON.stringify(x);
const clone = (x) => JSON.parse(J(x));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

const IMG = "a".repeat(64) + ".jpg", IMG2 = "b".repeat(64) + ".png";
// A short book: 2 facing pages, a heading and two body paragraphs on
// page 1, a picture on each page.
function book(name, id) {
  const d = M.newDoc({ name: name || "Book", pages: 2, facing: 1 }, 1000);
  if (id) d.id = id;
  const pg = M.pagesInOrder(d);
  d.stories.push({ id: "st-a", m: 1000, paras: [
    { ps: "ps-h1", runs: [{ t: "Chapter one" }] },
    { ps: "ps-body", runs: [{ t: "The sea was calm that morning." }] },
    { ps: "ps-body", runs: [{ t: "Page " }, { f: "pn" }, { t: " of the sea" }] }
  ] });
  d.items.push({ id: "it-a", m: 1000, t: "text", pg: pg[0].id, x: 40, y: 40, w: 300, h: 400, story: "st-a", seq: 1, z: 1 });
  d.items.push({ id: "it-p1", m: 1000, t: "img", pg: pg[0].id, x: 40, y: 500, w: 100, h: 80, a: IMG, fit: "fill", z: 2 });
  d.items.push({ id: "it-p2", m: 1000, t: "img", pg: pg[1].id, x: 40, y: 40, w: 100, h: 80, a: IMG2, fit: "fill", z: 2 });
  return M.normDoc(d);
}
const steps = (list) => { const r = CMD.check(list); assert.ok(r.ok, r.err); return r.steps; };
function run(d, list, notes, grey) {
  const w = clone(d);
  let n = 0;
  steps(list).forEach((st) => { n += CMD.apply(w, st, { now: 5000, notes: notes || [], grey: grey || {} }); });
  return { doc: M.normDoc(w), n };
}
const texts = (d) => d.stories[0].paras.map((p) => p.runs.map((r) => r.t !== undefined ? r.t : "[" + r.f + "]").join(""));

test("the catalog is Layout's automation steps without preflight and export, plus rename", () => {
  assert.deepEqual(CMD.ORDER, ["text", "pstyle", "style", "master", "margins", "pages", "delpages", "fit", "numbering", "bleed", "grey", "imgfit", "rename"]);
  CMD.ORDER.forEach((op) => { if (op !== "rename") assert.equal(CMD.CATALOG[op], S.CATALOG[op], op); });
  assert.ok(!CMD.CATALOG.export && !CMD.CATALOG.problems, "no export or preflight");
});

test("one field name has one JSON type across Layout, Atelier and the recipe catalogs", () => {
  const type = (s) => s.t === "num" || s.t === "int" ? "number" : s.t === "bool" ? "boolean" : s.t === "enum" ? (typeof s.v[0] === "number" ? "number" : "string") : s.t === "list" ? "array" : "string";
  const seen = {};
  const cats = [CMD.CATALOG, AT.CATALOG].concat(Object.keys(SH.CATALOGS).map((a) => SH.CATALOGS[a]));
  cats.forEach((cat) => Object.keys(cat).forEach((op) => Object.keys(cat[op].args || {}).forEach((k) => {
    if (k === "q") return;
    const ty = type(cat[op].args[k]);
    assert.ok(!seen[k] || seen[k] === ty, "field " + k + " is " + seen[k] + " and " + ty);
    seen[k] = ty;
  })));
});

test("the guide names every command and field; the tool declares every field", () => {
  CMD.ORDER.forEach((op) => {
    assert.match(CMD.GUIDE, new RegExp("\\b" + op + ":"), op);
    Object.keys(CMD.CATALOG[op].args).forEach((k) => assert.match(CMD.GUIDE, new RegExp("\\b" + k + "\\b"), op + "." + k));
  });
  const tool = C.editTool({ atelier: AT, layout: CMD });
  const props = tool.params.properties.steps.items.properties;
  CMD.ORDER.forEach((op) => Object.keys(CMD.CATALOG[op].args).forEach((k) => assert.ok(props[k], k)));
  assert.deepEqual(tool.params.properties.app.enum, ["atelier", "layout"]);
  assert.match(tool.description, /Layout commands/);
});

test("check: unknown commands, fields, values and page lists go back to the model", () => {
  assert.match(CMD.check([]).err, /steps is empty/);
  assert.match(CMD.check(new Array(41).fill({ op: "fit" })).err, /at most 40/);
  assert.match(CMD.check([{ op: "export" }]).err, /unknown command "export"/);
  assert.match(CMD.check([{ op: "style", name: "Body", ids: "x" }]).err, /ids is not a field of style/);
  assert.match(CMD.check([{ op: "style", name: "Body", brk: "nowhere" }]).err, /brk "nowhere" is not allowed/);
  assert.match(CMD.check([{ op: "bleed", mm: 40 }]).err, /mm 40 is not allowed/);
  assert.match(CMD.check([{ op: "margins", t: 10, b: 10, i: 10 }]).err, /o is missing/);
  assert.match(CMD.check([{ op: "grey", pages: "the first one" }]).err, /not a page list/);
  assert.match(CMD.check([{ op: "rename" }]).err, /title is missing/);
  const ok = CMD.check([{ op: "style", name: "Body", size: 11, brk: null }, { op: "grey", pages: "odd" }, { op: "fit" }]);
  assert.ok(ok.ok, ok.err);
  assert.equal(ok.steps.length, 3);
});

test("apply: every command on a real document, and the same list twice changes nothing more", () => {
  const d = book();
  const list = [
    { op: "text", find: "sea", repl: "ocean", word: true },
    { op: "style", name: "Body", size: 11, fi: 12, brk: "", hyph: "on" },
    { op: "margins", t: 20, b: 25, i: 18, o: 15 },
    { op: "numbering", mode: "set", n: 7 },
    { op: "bleed", mm: 5 },
    { op: "imgfit", mode: "fit", pages: "even" },
    { op: "rename", title: "The ocean" }
  ];
  const a = run(d, list);
  assert.ok(a.n >= 7, "changed " + a.n);
  assert.deepEqual(texts(a.doc), ["Chapter one", "The ocean was calm that morning.", "Page [pn] of the ocean"]);
  const body = a.doc.pstyles.find((p) => p.id === "ps-body");
  assert.equal(body.size, 11); assert.equal(body.fi, 12); assert.equal(body.ext.hyph, 1);
  assert.equal(M.firstNumber(a.doc), 7);
  assert.equal(a.doc.name, "The ocean");
  assert.equal(a.doc.items.find((it) => it.id === "it-p2").fit, "fit");
  assert.equal(a.doc.items.find((it) => it.id === "it-p1").fit, "fill", "odd pages left as they were");
  const b = run(a.doc, list.filter((s) => s.op !== "text"));
  assert.equal(b.n, 0, "twice changes nothing more");
});

test("apply: black and white needs the copies Layout makes; pages and delpages", () => {
  const d = book();
  const G = "c".repeat(64) + ".jpg";
  assert.equal(run(d, [{ op: "grey", pages: "1" }]).n, 0, "no copy, no change");
  const g = run(d, [{ op: "grey", pages: "1" }], [], { [IMG]: G });
  assert.equal(g.n, 1);
  assert.equal(g.doc.items.find((it) => it.id === "it-p1").a, G);
  const p = run(d, [{ op: "pages", n: 3, at: "end", flow: false }]);
  assert.equal(M.pagesInOrder(p.doc).length, 5);
  const del = run(p.doc, [{ op: "delpages", first: 4, last: 5 }]);
  assert.equal(M.pagesInOrder(del.doc).length, 3);
});

test("targets: the open document, by name, all; folders and unknown names are refused", () => {
  const data = { docs: [book("Summer stories", "dc-a"), book("Winter stories", "dc-b"), book("Poems", "dc-c")] };
  assert.deepEqual(CMD.targets(data, [], "dc-b", "open").docs, [{ id: "dc-b", name: "Winter stories" }]);
  assert.match(CMD.targets(data, [], "", "open").err, /no document is open/);
  assert.deepEqual(CMD.targets(data, [], "", "named", "poems").docs.map((x) => x.id), ["dc-c"]);
  assert.match(CMD.targets(data, [], "", "named", "stories").err, /several documents match/);
  assert.match(CMD.targets(data, [], "", "named", "Autumn").err, /no document is called "Autumn"/);
  assert.equal(CMD.targets(data, [], "", "all").docs.length, 3);
  assert.match(CMD.targets(data, [], "", "folder").err, /Layout has no folders/);
  assert.match(CMD.targets({ docs: [] }, [], "", "all").err, /no documents in Layout yet/);
});

test("preview counts on copies, black and white before the copies exist, and leaves the data as it is", () => {
  const data = { docs: [book("A", "dc-a"), book("B", "dc-b")] };
  const before = J(data);
  const pv = CMD.preview(data, ["dc-a", "dc-b", "dc-gone"], steps([{ op: "grey", pages: "" }, { op: "rename", title: "X" }]));
  assert.deepEqual([pv.n, pv.d, pv.cut], [6, 2, 0]);
  assert.deepEqual(pv.per.map((x) => x.n), [3, 3]);
  assert.equal(J(data), before, "the stored documents are not changed");
});

test("the outline for the AI: size and margins in mm, styles in use, masters, pages with their texts", () => {
  const o = CMD.outline(book("Sea book"));
  assert.equal(o.name, "Sea book");
  assert.equal(o.pages, 2);
  assert.equal(o.facing, true);
  assert.match(o.size_mm, /^\d+(\.\d)? × \d+(\.\d)?$/);
  const body = o.paragraph_styles.find((s) => s.name === "Body");
  assert.equal(body.paragraphs, 2);
  assert.deepEqual(o.page_list[0].text_starts, ["Chapter one The sea was calm that morning. Page of the sea"]);
  assert.equal(o.page_list[0].pictures, 1);
  assert.equal(o.page_list[1].text_starts, undefined, "a story is listed once, on its first page");
  assert.ok(J(o).indexOf(IMG) < 0, "no asset data");
});

test("the Assistant without the text engine: fit is counted and done by Layout, pages do not run text on", () => {
  const sb = { console };
  sb.window = sb;
  sb.orosRecipes = RC; sb.LayoutRecipes = S; sb.orosRecipeShare = SH; sb.orosDK = { model: M };
  vm.runInNewContext(read("layout/commands.js"), sb);
  const L = sb.LayoutCommands;
  assert.ok(L && L.check, "loads in a page with only the model");
  const notes = [];
  const w = clone(book());
  assert.equal(L.apply(w, L.check([{ op: "fit" }]).steps[0], { now: 5000, notes }), 1);
  assert.deepEqual(notes, ["fitLater"]);
  assert.equal(L.apply(w, L.check([{ op: "pages", n: 2 }]).steps[0], { now: 5000, notes }), 2);
  assert.equal(M.pagesInOrder(M.normDoc(w)).length, 4);
  const pv = L.preview({ docs: [book("A", "dc-a")] }, ["dc-a"], L.check([{ op: "fit" }]).steps);
  assert.equal(J([pv.n, pv.notes]), J([1, ["fitLater"]]), "a fit-only request still makes a card");
});

test("the Assistant: Layout in edit_in_app and read_in_app, its words for the card", () => {
  const cats = { atelier: AT, layout: CMD };
  const ok = C.normEdit({ app: "layout", designs: "named", name: "Book", steps: [{ op: "grey", pages: "odd" }] }, cats);
  assert.deepEqual([ok.ok, ok.app, ok.steps.length], [true, "layout", 1]);
  assert.match(C.normEdit({ app: "layout", steps: [{ op: "remove", what: "photo" }] }, cats).err, /unknown command/);
  assert.equal(C.EDIT_APP.layout.what, "documents");
  const a = read("assistant/assistant.js");
  assert.match(a, /layout: \{ mod: "LayoutCommands", data: "oros-layout-data", folders: "", prefs: "oros-layout-prefs" \}/);
  const de = read("i18n/de/assistant.js");
  const words = [];
  CMD.ORDER.forEach((op) => {
    words.push("ed.op." + op);
    Object.keys(CMD.CATALOG[op].args).forEach((k) => {
      const spec = CMD.CATALOG[op].args[k];
      words.push(k === "n" && op === "numbering" ? "ed.f.numbering.n" : "ed.f." + k);
      if (spec.t === "enum") spec.v.forEach((v) => { if (v !== "") words.push((k === "font" ? "ed.v.font." : "ed.v." + k + ".") + v); });
    });
  });
  words.push("ed.note.fitLater");
  const en = a.slice(0, a.indexOf('"ed.head": "Αλλαγή'));
  const el = a.slice(a.indexOf('"ed.head": "Αλλαγή'));
  words.forEach((w) => {
    assert.ok(en.indexOf('"' + w + '":') > 0, "EN " + w);
    assert.ok(el.indexOf('"' + w + '":') > 0, "EL " + w);
    assert.ok(de.indexOf('"' + w + '":') > 0, "DE " + w);
  });
});

test("wiring: Layout applies and undoes through assist.js; the Assistant loads the commands", () => {
  const ly = read("layout/layout.js"), as = read("layout/assist.js"), idx = read("layout/index.html");
  assert.match(ly, /tg\.edit/);
  assert.match(ly, /tg\.editUndo/);
  assert.match(as, /var chk = C\.check\(rq && rq\.steps\)/, "Layout checks the commands again");
  assert.match(as, /LY\.recipeGrey\(cur, /, "the black and white copies come from recipes.js");
  assert.match(as, /LY\.op\(function \(w, now\)/, "the open document keeps an undo step");
  assert.match(as, /LY\.putDoc\(work\)/);
  assert.match(as, /LY\.restoreDoc\(s\.before\)/);
  assert.match(as, /fp\(d\) !== s\.fp/, "a document changed since is not undone");
  assert.match(as, /indexedDB\.open\(DB, 1\)/);
  assert.match(read("layout/recipes.js"), /LY\.recipeGrey = greyCopies;/);
  assert.ok(idx.indexOf("commands.js") > idx.indexOf("recipes.js") && idx.indexOf("assist.js") > idx.indexOf("commands.js"));
  const ai = read("assistant/index.html");
  assert.ok(ai.indexOf("../designkit/model.js") > 0 && ai.indexOf("../layout/recipesteps.js") > 0 && ai.indexOf("../layout/commands.js") > ai.indexOf("../layout/recipesteps.js"));
  assert.ok(ai.indexOf("../designkit/render.js") < 0, "the Assistant does not load the text engine");
  const sw = read("sw.js");
  assert.ok(sw.indexOf('"layout/commands.js"') > 0 && sw.indexOf('"layout/assist.js"') > 0);
});
