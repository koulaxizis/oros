// Atelier commands for the Assistant (atelier/commands.js, AS-EDIT,
// wave AC1): the catalog, checking, picking elements, every command
// on a real design (and what survives normalization), the same list
// twice changing nothing more, locked elements, pages, which designs a
// request is for, the preview counts, the outline for the AI; and the
// wiring in Atelier (assist.js) and the Assistant.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const FX = require(path.join(ROOT, "designkit/fx.js"));
const AX = require(path.join(ROOT, "atelier/ax.js"));
const CMD = require(path.join(ROOT, "atelier/commands.js"));
const SH = require(path.join(ROOT, "recipes/share.js"));
const C = require(path.join(ROOT, "assistant/core.js"));
const J = (x) => JSON.stringify(x);
const clone = (x) => JSON.parse(J(x));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

function env(notes) {
  return { now: 5000, newId: M.newId, normItem: M.normItem, notes: notes || [],
           textHeight: (it) => AX.textHeight(M.normItem(it) || it), addBackground: AX.addBackground };
}
// A poster: 2 pages; page 1 a title, a body text, a photo, a shape
// and a locked logo; page 2 a photo.
function poster(unit) {
  const d = AX.newDesign({ name: "Summer poster", w: unit === "mm" ? M.fromUnit(210, "mm") : 1080, h: unit === "mm" ? M.fromUnit(297, "mm") : 1350, unit: unit || "px", pages: 2 }, 1000);
  const [p1, p2] = M.pagesInOrder(d).map((p) => p.id);
  const add = (pg, spec) => AX.addItem(d, pg, spec, 1000);
  const ids = {
    title: add(p1, { k: "text", tx: "Summer sale", size: 96, x: 40, y: 40, w: 800 }).id,
    body: add(p1, { k: "text", tx: "All summer long", size: 32, x: 40, y: 200, w: 600 }).id,
    photo: add(p1, { k: "photo", a: "a".repeat(64) + ".jpg", nm: "beach.jpg", iw: 800, ih: 600, x: 100, y: 400, w: 400, h: 300 }).id,
    shape: add(p1, { k: "shape", shp: "circle", fc: "#ff0000", x: 600, y: 600, w: 200, h: 200 }).id,
    logo: add(p1, { k: "icon", ico: "star", sc: "#ff0000", x: 900, y: 1200, w: 100, h: 100, lock: 1 }).id,
    photo2: add(p2, { k: "photo", a: "b".repeat(64) + ".jpg", nm: "sea.jpg", iw: 800, ih: 800, x: 0, y: 0, w: 500, h: 500 }).id
  };
  return { d: M.normDoc(d), ids, p1, p2 };
}
const steps = (list) => { const r = CMD.check(list); assert.ok(r.ok, r.err); return r.steps; };
function run(d, list, notes) {
  const w = clone(d);
  const e = env(notes);
  let n = 0;
  steps(list).forEach((st) => { n += CMD.apply(w, st, e); });
  return { doc: M.normDoc(w), n };
}
const item = (d, id) => d.items.find((it) => it.id === id);

test("the copies of the lists match designkit and Atelier", () => {
  assert.deepEqual(CMD.FILTERS, FX.FILTERS.map((f) => f.id));
  assert.deepEqual(CMD.SHAPES, FX.SHAPES.map((s) => s.id));
  assert.deepEqual(CMD.EFFECTS, FX.TEXT_FX.map((f) => f.id));
  assert.deepEqual(CMD.ADJ, Object.keys(FX.normAdjust({})));
  const ax = read("atelier/ax.js");
  assert.equal(J(CMD.ANIMS), J(JSON.parse(/var ANIMS = (\[[^\]]*\])/.exec(ax)[1])));
  assert.equal(J(CMD.TRANSITIONS), J(JSON.parse(/var TRANSITIONS = (\[[^\]]*\])/.exec(ax)[1])));
});

test("one field name has one JSON type in every catalog the Assistant declares", () => {
  const type = (s) => s.t === "num" || s.t === "int" ? "number" : s.t === "bool" ? "boolean" : s.t === "enum" ? (typeof s.v[0] === "number" ? "number" : "string") : s.t === "list" ? "array" : "string";
  const seen = {};
  const cats = [CMD.CATALOG, require(path.join(ROOT, "photolab/commands.js")).CATALOG, require(path.join(ROOT, "slides/commands.js")).CATALOG, require(path.join(ROOT, "writer/commands.js")).CATALOG, require(path.join(ROOT, "spreadsheet/commands.js")).CATALOG, require(path.join(ROOT, "montage/commands.js")).CATALOG, require(path.join(ROOT, "studio/commands.js")).CATALOG, require(path.join(ROOT, "whiteboard/commands.js")).CATALOG].concat(Object.keys(SH.CATALOGS).map((a) => SH.CATALOGS[a]));
  cats.forEach((cat) => Object.keys(cat).forEach((op) => Object.keys(cat[op].args || {}).forEach((k) => {
    const ty = type(cat[op].args[k]);
    // recipes' q is already two types (layout print/screen, photolab quality), described on the tool
    if (k === "q") return;
    assert.ok(!seen[k] || seen[k] === ty, "field " + k + " is " + seen[k] + " and " + ty);
    seen[k] = ty;
  })));
  assert.ok(!seen.op, "no command has a field called op");
});

test("the guide names every command and field; the tool declares every field", () => {
  CMD.ORDER.forEach((op) => {
    assert.match(CMD.GUIDE, new RegExp("\\b" + op + ":"), op);
    Object.keys(CMD.CATALOG[op].args).forEach((k) => {
      if (["ids", "pages", "what", "has"].indexOf(k) >= 0) return;
      assert.match(CMD.GUIDE, new RegExp("\\b" + k + "\\b"), op + "." + k);
    });
  });
  const tool = C.editTool({ atelier: CMD });
  const props = tool.params.properties.steps.items.properties;
  CMD.ORDER.forEach((op) => Object.keys(CMD.CATALOG[op].args).forEach((k) => assert.ok(props[k], k)));
  assert.equal(props.size.type, "number");
  assert.equal(props.dup.type, "boolean");
  assert.equal(props.pos.type, "string");
  assert.match(tool.description, /ids \(element ids from read_in_app/);
});

test("check: unknown commands, fields and values go back to the model; remove needs a pick", () => {
  assert.match(CMD.check([]).err, /empty/);
  assert.match(CMD.check([{ op: "zap" }]).err, /unknown command "zap"/);
  assert.match(CMD.check([{ op: "photo", flt: "bw" }]).err, /flt "bw" is not allowed/);
  assert.match(CMD.check([{ op: "photo", colour: "#000000" }]).err, /colour is not a field of photo/);
  assert.match(CMD.check([{ op: "textstyle", size: 9000 }]).err, /size 9000 is not allowed/);
  assert.match(CMD.check([{ op: "textstyle", c: "red" }]).err, /c "red" is not allowed/);
  assert.match(CMD.check([{ op: "place", pages: "the first" }]).err, /not a page list/);
  assert.match(CMD.check([{ op: "settext" }]).err, /text is missing/);
  assert.match(CMD.check([{ op: "remove" }]).err, /pick the elements/);
  assert.match(CMD.check([{ op: "align", rel: "page" }]).err, /give edge or dist/);
  assert.match(CMD.check([{ op: "bg", pages: "odd" }]).err, /give fill or grad/);
  assert.match(CMD.check(new Array(41).fill({ op: "rename", title: "x" })).err, /at most 40/);
  const ok = CMD.check([{ op: "photo", what: "photo", flt: "mono", pages: "2-4, 6" }, { op: "remove", what: "shape" }]);
  assert.ok(ok.ok);
  assert.equal(ok.steps[0].bright, null, "unset sliders stay unset");
  assert.equal(ok.steps[0].fit, "");
});

test("pages: all, odd, even, first, last and ranges", () => {
  const keys = (s, n) => Object.keys(CMD.pageSet(s, n)).map(Number);
  assert.deepEqual(keys("", 4), [0, 1, 2, 3]);
  assert.deepEqual(keys("odd", 5), [0, 2, 4]);
  assert.deepEqual(keys("even", 5), [1, 3]);
  assert.deepEqual(keys("first", 3), [0]);
  assert.deepEqual(keys("last", 3), [2]);
  assert.deepEqual(keys("2-3, 5, 9-12", 6), [1, 2, 4]);
  assert.equal(CMD.pageSet("page two", 3), null);
});

test("picking: what, pages, has, ids; page backgrounds only when asked", () => {
  const { d, ids } = poster();
  const pick = (o) => CMD.pick(d, Object.assign({ ids: "", pages: "", what: "", has: "" }, o)).map((it) => it.id);
  assert.deepEqual(pick({ what: "photo" }), [ids.photo, ids.photo2]);
  assert.deepEqual(pick({ what: "photo", pages: "2" }), [ids.photo2]);
  assert.deepEqual(pick({ what: "text", has: "SALE" }), [ids.title]);
  assert.deepEqual(pick({ has: "beach" }), [ids.photo]);
  assert.deepEqual(pick({ ids: ids.body + ", " + ids.shape }), [ids.body, ids.shape]);
  assert.equal(pick({}).length, 6);
  assert.equal(pick({ what: "bg" }).length, 2);
});

test("textstyle, replace and settext change the texts and survive normalization", () => {
  const { d, ids } = poster();
  const r = run(d, [
    { op: "textstyle", what: "text", font: "serif", size: 40, c: "#112233", bold: "on", align: "c", lh: 140, track: 50, effect: "shadow", curve: 20 },
    { op: "replace", find: "summer", repl: "autumn", word: true },
    { op: "settext", ids: ids.body, text: "Now 30% off" }
  ]);
  const t = item(r.doc, ids.title).ax, b = item(r.doc, ids.body).ax;
  assert.equal(t.tx, "autumn sale");
  assert.equal(b.tx, "Now 30% off");
  assert.deepEqual([t.font, t.size, t.fc, t.b, t.al, t.lh, t.tr, t.tfx.type, t.cv], ["serif", 40, "#112233", 1, "c", 140, 50, "shadow", 20]);
  assert.ok(item(r.doc, ids.title).h > 0, "text height re-measured");
  const off = run(r.doc, [{ op: "textstyle", ids: ids.title, bold: "off", align: "l", effect: "none", curve: 0 }]).doc;
  const t2 = item(off, ids.title).ax;
  assert.ok(!t2.b && !t2.al && !t2.tfx && !t2.cv, "defaults are omitted again");
});

test("photo: black and white, sliders, masks, flips; cutout only counts here", () => {
  const { d, ids } = poster();
  const r = run(d, [{ op: "photo", what: "photo", flt: "mono", contrast: 20, sepia: 10, shape: "circle", round: 50, flip: "h", fit: "fit" }]);
  [ids.photo, ids.photo2].forEach((id) => {
    const it = item(r.doc, id);
    assert.equal(it.ax.flt, "mono");
    assert.equal(it.ax.adj.contrast, 20);
    assert.equal(it.ax.adj.sepia, 10);
    assert.equal(it.ax.shp, "circle");
    assert.equal(it.ax.rd, 50);
    assert.equal(it.ax.flh, 1);
    assert.equal(it.fit, "fit");
  });
  assert.equal(r.n, 2);
  const back = run(r.doc, [{ op: "photo", what: "photo", flt: "none", contrast: 0, sepia: 0, flip: "none" }]).doc;
  assert.ok(!item(back, ids.photo).ax.flt && !item(back, ids.photo).ax.adj && !item(back, ids.photo).ax.flh);
  assert.equal(CMD.apply(clone(d), steps([{ op: "cutout", what: "photo" }])[0], env()), 2);
});

test("colours: recolor everywhere, fills, gradients, outlines; page backgrounds", () => {
  const { d, ids, p1, p2 } = poster();
  const r = run(d, [
    { op: "recolor", from: "#ff0000", to: "#00aa00" },
    { op: "colors", ids: ids.shape, fill: "#000000", grad: "#ffffff", ang: 45, stroke: "#123456", sw: 3 },
    { op: "bg", pages: "2", fill: "#fafafa" }
  ]);
  assert.equal(item(r.doc, ids.logo).ax.sc, "#00aa00");
  const s = item(r.doc, ids.shape);
  assert.deepEqual(s.ax.g, { a: "#000000", b: "#ffffff", ang: 45 });
  assert.equal(s.ax.sc, "#123456");
  assert.equal(s.sw, 3);
  assert.equal(AX.background(r.doc, p2).ax.fc, "#fafafa");
  assert.equal(AX.background(r.doc, p1).ax.fc, AX.background(d, p1).ax.fc);
});

test("place and align: positions in the design's unit, page anchors, locked elements stay", () => {
  const { d, ids } = poster();
  const r = run(d, [
    { op: "place", ids: ids.photo, w: 200 },
    { op: "place", ids: ids.shape, pos: "br", gap: 20 },
    { op: "place", what: "text", dx: 10, opacity: 80, rot: 5 },
    { op: "place", what: "icon", x: 0 }
  ]);
  const ph = item(r.doc, ids.photo);
  assert.deepEqual([ph.w, ph.h], [200, 150], "a photo keeps its proportions");
  const sh = item(r.doc, ids.shape);
  assert.deepEqual([sh.x, sh.y], [1080 - 200 - 20, 1350 - 200 - 20]);
  assert.equal(item(r.doc, ids.title).x, 50);
  assert.equal(item(r.doc, ids.title).op, 80);
  assert.equal(item(r.doc, ids.logo).x, 900, "a locked element is moved only when named by id");
  assert.equal(item(run(d, [{ op: "place", ids: ids.logo, x: 0 }]).doc, ids.logo).x, 0);
  const mm = poster("mm");
  const m = run(mm.d, [{ op: "place", ids: mm.ids.shape, x: 10, y: 20 }]).doc;
  assert.ok(Math.abs(item(m, mm.ids.shape).x - M.fromUnit(10, "mm")) < 0.01, "print designs take mm");
  const a = run(d, [{ op: "align", ids: ids.title + "," + ids.body + "," + ids.photo, edge: "l" }]).doc;
  assert.deepEqual([ids.title, ids.body, ids.photo].map((id) => item(a, id).x), [40, 40, 40]);
  const c = run(d, [{ op: "align", ids: ids.shape, edge: "c", rel: "page" }]).doc;
  assert.equal(item(c, ids.shape).x, (1080 - 200) / 2);
});

test("arrange: front, back, lock and hide; remove keeps locked elements and leaves tombstones", () => {
  const { d, ids, p1 } = poster();
  const f = run(d, [{ op: "arrange", ids: ids.title, order: "front" }, { op: "arrange", ids: ids.body, order: "back", lock: "on", hide: "on" }]).doc;
  const z = f.items.filter((it) => it.pg === p1 && !it.ax.bg).sort((a, b) => a.z - b.z).map((it) => it.id);
  assert.equal(z[z.length - 1], ids.title);
  assert.equal(z[0], ids.body);
  assert.ok(AX.background(f, p1).z < item(f, ids.body).z, "the background stays at the bottom");
  assert.equal(item(f, ids.body).lock, 1);
  assert.equal(item(f, ids.body).hide, 1);
  const notes = [];
  const r = run(d, [{ op: "remove", pages: "1" }], notes);
  assert.equal(r.n, 4);
  assert.ok(item(r.doc, ids.logo), "the locked logo stays");
  assert.ok(r.doc.tombs[ids.title]);
  assert.deepEqual(notes, ["locked"]);
});

test("pages: add blank or copies, remove (one always stays), move; bleed and rename", () => {
  const { d, ids, p1, p2 } = poster();
  const add = run(d, [{ op: "pages", n: 2, at: "after", page: 1, dup: true }]).doc;
  const order = M.pagesInOrder(add).map((p) => p.id);
  assert.equal(order.length, 4);
  assert.deepEqual([order[0], order[3]], [p1, p2]);
  assert.equal(add.items.filter((it) => it.pg === order[1]).length, d.items.filter((it) => it.pg === p1).length, "copies of page 1");
  const blank = run(d, [{ op: "pages", n: 1 }]).doc;
  const last = M.pagesInOrder(blank).pop().id;
  assert.equal(blank.items.filter((it) => it.pg === last).length, 1, "a blank page has its background");
  const notes = [];
  const all = run(d, [{ op: "delpages", first: 1, last: 2 }], notes);
  assert.equal(all.n, 0);
  assert.deepEqual(notes, ["lastPage"]);
  const one = run(d, [{ op: "delpages", first: 2 }]).doc;
  assert.deepEqual(one.pages.map((p) => p.id), [p1]);
  assert.ok(!item(one, ids.photo2));
  const mv = run(d, [{ op: "movepage", page: 2, dest: 1 }]).doc;
  assert.deepEqual(M.pagesInOrder(mv).map((p) => p.id), [p2, p1]);
  const pr = poster("mm");
  const b = run(pr.d, [{ op: "bleed", mm: 5 }, { op: "rename", title: "Print" }]).doc;
  assert.ok(Math.abs(b.setup.bleed - M.fromUnit(5, "mm")) < 0.01);
  assert.equal(b.name, "Print");
  const sn = [];
  assert.equal(run(d, [{ op: "bleed", mm: 3 }], sn).n, 0);
  assert.deepEqual(sn, ["screenBleed"]);
});

test("the same commands twice change nothing more", () => {
  const { d, ids } = poster();
  const list = [
    { op: "textstyle", what: "text", font: "mono", size: 30, italic: undefined, ital: "on" },
    { op: "photo", what: "photo", flt: "noir", bright: 10 },
    { op: "recolor", from: "#ff0000", to: "#0000ff" },
    { op: "colors", ids: ids.shape, fill: "#222222" },
    { op: "place", ids: ids.shape, x: 10, y: 10, w: 50, h: 50 },
    { op: "arrange", ids: ids.title, lock: "on" },
    { op: "bg", fill: "#eeeeee" },
    { op: "rename", title: "Again" }
  ];
  const once = run(d, list).doc;
  assert.equal(run(once, list).n, 0);
});

test("which designs: the open one, by name, a folder, all; clear refusals", () => {
  const a = poster().d, b = clone(poster().d);
  b.id = "doc-other0000000"; b.name = "Autumn flyer";
  const data = { docs: [a, b] };
  const folders = { folders: [{ id: "af-x", nm: "Shop" }], place: { [b.id]: { f: "af-x" } } };
  assert.deepEqual(CMD.targets(data, folders, a.id, "open").docs, [{ id: a.id, name: "Summer poster" }]);
  assert.match(CMD.targets(data, folders, "", "open").err, /no design is open/);
  assert.deepEqual(CMD.targets(data, folders, "", "named", "autumn FLYER").docs.map((x) => x.id), [b.id]);
  assert.deepEqual(CMD.targets(data, folders, "", "named", "flyer").docs.map((x) => x.id), [b.id]);
  assert.match(CMD.targets(data, folders, "", "named", "menu").err, /no design is called "menu"; designs: "Summer poster", "Autumn flyer"/);
  assert.deepEqual(CMD.targets(data, folders, "", "folder", "shop").docs.map((x) => x.id), [b.id]);
  assert.equal(CMD.targets(data, folders, "", "all").docs.length, 2);
  assert.match(CMD.targets({ docs: [] }, null, "", "all").err, /no designs/);
  const twin = clone(b); twin.id = "doc-twin00000000"; twin.name = "Autumn flyer B";
  assert.match(CMD.targets({ docs: [a, b, twin] }, null, "", "named", "autumn").err, /several designs match/);
});

test("preview counts on copies and leaves the stored designs as they are", () => {
  const { d } = poster();
  const data = { docs: [d] }, before = J(data);
  const pv = CMD.preview(data, [d.id], steps([{ op: "photo", what: "photo", flt: "mono" }, { op: "cutout", what: "photo" }, { op: "bleed", mm: 3 }]));
  assert.deepEqual([pv.n, pv.d, pv.cut], [2, 1, 2]);
  assert.deepEqual(pv.per, [{ id: d.id, name: "Summer poster", n: 2 }]);
  assert.deepEqual(pv.notes, ["screenBleed"]);
  assert.equal(J(data), before);
});

test("the outline for the AI: pages, ids, texts, sizes in the design's unit, never asset data", () => {
  const { d, ids } = poster("mm");
  const o = CMD.outline(d);
  assert.equal(o.name, "Summer poster");
  assert.equal(o.size, "210 × 297 mm");
  assert.equal(o.pages.length, 2);
  const els = o.pages[0].elements;
  assert.deepEqual(els.map((e) => e.what), ["text", "text", "photo", "shape", "icon"]);
  assert.equal(els[0].id, ids.title);
  assert.equal(els[0].text, "Summer sale");
  assert.equal(els[4].locked, true);
  assert.equal(els[2].file, "beach.jpg");
  assert.doesNotMatch(J(o), /aaaaaaaa/, "no asset ids");
});

test("the Assistant: normEdit, read_in_app, tools only with data, the prompt line", () => {
  const cats = { atelier: CMD };
  assert.match(C.normEdit({ app: "layout", steps: [] }, cats).err, /app must be one of: atelier/);
  assert.match(C.normEdit({ app: "atelier", designs: "named", steps: [{ op: "rename", title: "x" }] }, cats).err, /give the design's name/);
  assert.match(C.normEdit({ app: "atelier", designs: "all", steps: [{ op: "rename", title: "x" }] }, cats).err, /rename works on one design/);
  assert.match(C.normEdit({ app: "atelier", steps: [{ op: "zap" }] }, cats).err, /unknown command/);
  const ok = C.normEdit({ app: "atelier", steps: [{ op: "photo", what: "photo", flt: "mono" }] }, cats);
  assert.deepEqual([ok.ok, ok.designs, ok.steps.length], [true, "open", 1]);
  assert.match(C.normReadApp({ app: "atelier", designs: "all" }, cats).err, /open or named/);
  assert.deepEqual(C.toolsFor({ data: true, edits: cats }).map((x) => x.name).slice(-2), ["read_in_app", "edit_in_app"]);
  assert.ok(!C.toolsFor({ data: false, edits: cats }).some((x) => x.name === "edit_in_app"), "only when an app may be read");
  assert.match(C.systemPrompt({ lang: "en", now: 0, edits: ["Atelier (atelier)"], apps: ["Atelier (atelier)"] }), /read the document with read_in_app and change it with edit_in_app/);
});

test("wiring: Atelier applies and undoes through assist.js; the Assistant's card, report and change history", () => {
  const core = read("atelier/core.js"), as = read("atelier/assist.js"), idx = read("atelier/index.html");
  assert.match(core, /tg\.edit \|\| tg\.editUndo/);
  assert.match(as, /var chk = C\.check\(rq && rq\.steps\)/, "Atelier checks the commands again");
  assert.match(as, /AT\.putDoc\(o\.w\)/);
  assert.match(as, /if \(s\.made\) AT\.dropDoc\(s\.id\); else AT\.restoreDoc\(s\.id, s\.before\)/, "Undo removes copies and new designs, restores the rest");
  assert.match(as, /fp\(d\) !== s\.fp/, "a design changed since is not undone");
  assert.match(as, /indexedDB\.open\(DB, 1\)/);
  assert.ok(idx.indexOf("commands.js") > idx.indexOf("../recipes/core.js") && idx.indexOf("assist.js") > idx.indexOf("recipes.js"));
  const a = read("assistant/assistant.js");
  assert.match(a, /__orosOpenAt\(p\.app, \{ edit: \{ key: ui\.key, chat: c\.id, docs: /);
  assert.match(a, /__orosOpenAt\(mem\.app, \{ editUndo: \{ key: key, tok: mem\.tok \} \}\)/);
  assert.match(a, /if \(mem\.edit\) return editUndo\(mem\.edit\);/);
  assert.match(a, /remember\(uid, \{ edit: \{ app: app, tok: rep\.tok \} \}/);
  assert.match(a, /app\.perm === "always" \? Promise\.resolve\(true\) : askRead\(title/, "read_in_app asks first unless always");
  assert.ok(read("assistant/index.html").indexOf("../atelier/commands.js") > 0);
  const sw = read("sw.js");
  assert.ok(sw.indexOf('"atelier/commands.js"') > 0 && sw.indexOf('"atelier/assist.js"') > 0);
});

// ---------- wave AC2 ----------
test("AC2 check: animation, page timing, new elements, brand kit and create need what they need", () => {
  assert.match(CMD.check([{ op: "animate", what: "text" }]).err, /animate: give anim/);
  assert.match(CMD.check([{ op: "pagetime" }]).err, /pagetime: give secs or trans/);
  assert.match(CMD.check([{ op: "add", what: "text" }]).err, /a text needs text/);
  assert.match(CMD.check([{ op: "add", what: "icon" }]).err, /icon needs icon/);
  assert.match(CMD.check([{ op: "brand", fonts: false, palette: false }]).err, /both false/);
  assert.match(CMD.check([{ op: "rename", title: "x" }, { op: "create", w: 100, h: 100 }]).err, /create can only be the first/);
  assert.match(CMD.check([{ op: "resize", sizes: [] }]).err, /resize/);
  assert.ok(CMD.check([{ op: "resize", sizes: [{ w: 1080, h: 1920 }, { w: 210, h: 297, u: "mm" }] }]).ok);
  assert.ok(!CMD.picks("add") && !CMD.picks("pagetime") && CMD.picks("animate"), "add picks nothing");
});

test("AC2 animate and pagetime: entrances on elements, seconds and transitions on page backgrounds", () => {
  const { d, ids } = poster();
  let r = run(d, [{ op: "animate", what: "text", anim: "rise" }]);
  assert.equal(r.n, 2);
  assert.equal(item(r.doc, ids.title).ax.an, "rise");
  r = run(r.doc, [{ op: "animate", ids: ids.photo + "," + ids.title, anim: "type" }]);
  assert.equal(item(r.doc, ids.photo).ax.an, undefined, "type is for texts only");
  assert.equal(item(r.doc, ids.title).ax.an, "type");
  r = run(r.doc, [{ op: "animate", what: "text", anim: "none" }]);
  assert.equal(item(r.doc, ids.title).ax.an, undefined);
  r = run(d, [{ op: "pagetime", secs: 3, trans: "slide" }]);
  assert.equal(r.n, 2);
  const bgs = r.doc.items.filter((it) => it.ax && it.ax.bg);
  assert.ok(bgs.every((b) => b.ax.dur === 3 && b.ax.ptr === "slide"));
  assert.equal(run(r.doc, [{ op: "pagetime", secs: 3, trans: "slide" }]).n, 0, "the same again changes nothing");
  const o = CMD.outline(r.doc);
  assert.equal(o.pages[0].secs, 3);
  assert.equal(o.pages[0].transition, "slide");
});

test("AC2 add: a text, a shape, an icon and a line, centred and sized when left out", () => {
  const { d, p2 } = poster();
  const e = Object.assign(env(), { addItem: AX.addItem, findIcon: (w) => (w === "heart" ? "heart" : "star") });
  const w = clone(d);
  const n = steps([{ op: "add", what: "text", text: "Opening day", size: 60, c: "#112233", align: "c", bold: "on", anim: "rise" },
    { op: "add", what: "shape", shape: "circle", fill: "#00ff00", page: 2, x: 10, y: 20, w: 100 },
    { op: "add", what: "icon", icon: "heart", c: "#ff0000" },
    { op: "add", what: "line" }]).reduce((k, st) => k + CMD.apply(w, st, e), 0);
  assert.equal(n, 4);
  const doc = M.normDoc(w), added = doc.items.filter((it) => !d.items.some((x) => x.id === it.id));
  assert.equal(added.length, 4);
  const tx = added.find((it) => it.ax.k === "text");
  assert.equal(tx.ax.tx, "Opening day");
  assert.equal(tx.ax.size, 60);
  assert.equal(tx.ax.an, "rise");
  assert.equal(tx.ax.b, 1);
  assert.ok(Math.abs(tx.x - (doc.setup.w - tx.w) / 2) < 1, "centred");
  const sh = added.find((it) => it.ax.k === "shape");
  assert.equal(sh.pg, p2);
  assert.equal(sh.ax.shp, "circle");
  assert.deepEqual([sh.x, sh.y, sh.w, sh.h], [10, 20, 100, 100]);
  assert.equal(added.find((it) => it.ax.k === "icon").ax.ico, "heart");
});

test("AC2 brand: titles get the heading font, the rest the body font; the main colours become the kit's", () => {
  const { d, ids } = poster();
  const kit = { fonts: { h: { f: "serif", b: 1 }, t: { f: "mono", b: 0 } }, colors: [{ c: "#0055AA" }] };
  const notes = [];
  const w = clone(d);
  item(w, ids.title).ext = { fam: "uf_0123456789abcdef", kern: 1 };   // an own font (AC3) gives way to the kit's
  const n = CMD.apply(w, steps([{ op: "brand" }])[0], Object.assign(env(notes), { brand: kit }));
  assert.deepEqual(item(w, ids.title).ext, { kern: 1 });
  assert.ok(n >= 3);
  assert.equal(item(w, ids.title).ax.font, "serif");
  assert.equal(item(w, ids.title).ax.b, 1);
  assert.equal(item(w, ids.body).ax.font, "mono");
  assert.equal(item(w, ids.shape).ax.fc, "#0055aa", "the most used colour (red) becomes the kit's first");
  assert.equal(item(w, ids.logo).ax.sc, "#0055aa");
  const none = [];
  assert.equal(CMD.apply(clone(d), steps([{ op: "brand" }])[0], env(none)), 0);
  assert.deepEqual(none, ["noBrand"]);
});

test("AC2 resize, export and create: copies, files and new designs are counted apart from changes", () => {
  const { d } = poster();
  const data = { docs: [d] };
  let pv = CMD.preview(data, [d.id], steps([{ op: "resize", sizes: [{ w: 1080, h: 1920 }, { w: 1200, h: 628 }] }, { op: "export", fmt: "pdf" }]));
  assert.deepEqual([pv.n, pv.made, pv.files], [0, 2, 1]);
  const w = clone(d);
  const relaid = (doc, ww, hh, unit) => ({ setup: Object.assign({}, doc.setup, { w: ww, h: hh, unit }), items: doc.items });
  assert.equal(CMD.apply(w, steps([{ op: "resize", sizes: [{ w: 210, h: 297, u: "mm" }], copies: false }])[0], Object.assign(env(), { relaid })), 1);
  assert.equal(w.setup.unit, "mm");
  assert.ok(Math.abs(w.setup.w - 595.28) < 0.01);
  pv = CMD.preview(data, [""], steps([{ op: "create", title: "Bakery opening", w: 1080, h: 1350, n: 2, fill: "#fff0e0" },
    { op: "add", what: "text", text: "Grand opening", page: 1 }, { op: "pagetime", secs: 4 }]));
  assert.equal(pv.made, 1);
  assert.equal(pv.n, 3);
  assert.equal(pv.per[0].name, "Bakery opening");
  const nd = CMD.makeNew(steps([{ op: "create", title: "A4", w: 210, h: 297, u: "mm", n: 3 }])[0], env());
  assert.equal(nd.pages.length, 3);
  assert.equal(nd.setup.unit, "mm");
  assert.deepEqual(CMD.targets({ docs: [] }, null, "", "new", "A4"), { ok: true, docs: [{ id: "", name: "A4" }], fresh: 1 });
});

test("AC2 Assistant: designs new goes with create; sizes is an array of objects in the schema", () => {
  const cats = { atelier: CMD };
  const n = C.normEdit({ app: "atelier", steps: [{ op: "create", title: "Menu", w: 210, h: 297, u: "mm" }, { op: "add", what: "text", text: "Menu" }] }, cats);
  assert.equal(n.designs, "new");
  assert.equal(n.name, "Menu");
  assert.match(C.normEdit({ app: "atelier", designs: "new", steps: [{ op: "rename", title: "x" }] }, cats).err, /designs new needs create/);
  const props = C.editTool(cats).params.properties;
  assert.ok(props.designs.enum.includes("new"));
  const sizes = props.steps.items.properties.sizes;
  assert.equal(sizes.type, "array");
  assert.deepEqual(Object.keys(sizes.items.properties), ["w", "h", "u"]);
  assert.deepEqual(sizes.items.required, ["w", "h"]);
  assert.equal(props.steps.items.properties.scale.type, "number");
  assert.equal(props.steps.items.properties.anim.type, "string");
});
