// Photo Lab commands for the Assistant (photolab/commands.js, AS-EDIT,
// wave PL1): the catalog, checking, picking layers, every document
// command on a real project (and that it survives normalization), the
// pixel and size commands only counting, locked layers, which pictures
// a request is for, the preview counts, the outline for the AI; and
// the wiring in Photo Lab (assist.js) and the Assistant (disk loading,
// card wording).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PC = require(path.join(ROOT, "photolab/core.js"));
const FX = require(path.join(ROOT, "designkit/fx.js"));
const CMD = require(path.join(ROOT, "photolab/commands.js"));
const RS = require(path.join(ROOT, "photolab/recipesteps.js"));
const C = require(path.join(ROOT, "assistant/core.js"));
const J = (x) => JSON.stringify(x);
const clone = (x) => JSON.parse(J(x));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// A picture: a photo background, a second photo (hidden), a title, a
// caption, a locked logo shape, an adjustment layer.
function picture() {
  const d = PC.newDoc({ w: 1200, h: 800, name: "Beach day", now: 1000, layerName: "Background" });
  const L = (o) => PC.normLayer(Object.assign({ id: PC.newLayerId(), vis: 1, op: 100, bl: "normal" }, o));
  const bg = d.layers[0].id;
  const extra = L({ k: "raster", name: "Sky", vis: 0 });
  const title = L({ k: "text", name: "Title", x: 100, y: 80, tx: { s: "Summer sale", f: "sans", z: 96, c: "#ffffff", a: "l", b: 1, i: 0, lh: 120 } });
  const caption = L({ k: "text", name: "Caption", x: 100, y: 600, tx: { s: "All summer long", f: "serif", z: 32, c: "#000000", a: "l", b: 0, i: 0, lh: 120 } });
  const logo = L({ k: "shape", name: "Logo", x: 1000, y: 650, lock: 1, sh: { id: "star", w: 120, h: 120, f: "#ff0000", s: "", sw: 0, r: 0 } });
  const adj = L({ k: "adj", name: "Levels", aj: { id: "levels", p: {} } });
  d.layers.push(extra, title, caption, logo, adj);
  return { d: PC.normDoc(d), ids: { bg, extra: extra.id, title: title.id, caption: caption.id, logo: logo.id, adj: adj.id } };
}
const steps = (list) => { const r = CMD.check(list); assert.ok(r.ok, r.err); return r.steps; };
function run(d, list, notes) {
  const w = clone(d);
  const e = { notes: notes || [], newLayerId: () => PC.newLayerId(), normFx: PC.normFx };
  let n = 0;
  steps(list).forEach((st) => { n += CMD.apply(w, st, e); });
  return { doc: PC.normDoc(w), n, raw: w };
}
const layer = (d, id) => d.layers.find((L) => L.id === id);

test("the copies of the lists match designkit, Photo Lab and the automations", () => {
  assert.deepEqual(CMD.LOOKS, FX.FILTERS.map((f) => f.id).filter((id) => id !== "none"));
  assert.deepEqual(CMD.LOOKS, RS.LOOKS);
  assert.deepEqual(CMD.BLENDS, PC.BLEND_IDS);
  assert.deepEqual(CMD.SHAPES, FX.SHAPES.map((s) => s.id));
  assert.equal(J(CMD.FONTS), J(JSON.parse(/var FONT_IDS = (\[[^\]]*\])/.exec(read("photolab/view.js"))[1])));
  // the photo commands keep the automations' fields, so recipesteps.job runs them
  ["tone", "look", "blur", "sharpen", "noise"].forEach((op) => Object.keys(RS.CATALOG[op].args).forEach((k) => assert.ok(CMD.CATALOG[op].args[k], op + "." + k)));
  assert.deepEqual(RS.job(steps([{ op: "blur", r: 4 }])[0]), { kind: "filter", id: "gauss", p: { r: 4 } });
  assert.ok(PC.ADJ_IDS.length && ["gray", "invert", "bc", "hsl", "photo", "posterize"].every((k) => PC.ADJ_IDS.indexOf(k) >= 0));
});

test("the guide names every command and field; the tool declares every field", () => {
  CMD.ORDER.forEach((op) => {
    assert.match(CMD.GUIDE, new RegExp("\\b" + op + ":"), op);
    Object.keys(CMD.CATALOG[op].args).forEach((k) => {
      if (["ids", "what", "has"].indexOf(k) >= 0) return;
      assert.match(CMD.GUIDE, new RegExp("\\b" + k + "\\b"), op + "." + k);
    });
  });
  const tool = C.editTool({ photolab: CMD });
  const props = tool.params.properties.steps.items.properties;
  CMD.ORDER.forEach((op) => Object.keys(CMD.CATALOG[op].args).forEach((k) => assert.ok(props[k], k)));
  assert.equal(props.deg.type, "number");
  assert.equal(props.mono.type, "boolean");
  assert.match(tool.description, /Photo Lab commands/);
  assert.deepEqual(tool.params.properties.app.enum, ["photolab"]);
});

test("check: unknown commands, fields and values go back to the model; picks and sliders are needed", () => {
  assert.match(CMD.check([{ op: "paint" }]).err, /unknown command "paint"/);
  assert.match(CMD.check([{ op: "blur", r: 500 }]).err, /r 500 is not allowed/);
  assert.match(CMD.check([{ op: "look", id: "plain" }]).err, /id "plain" is not allowed/);
  assert.match(CMD.check([{ op: "look" }]).err, /id is missing/);
  assert.match(CMD.check([{ op: "remove" }]).err, /pick the layers/);
  assert.match(CMD.check([{ op: "dup" }]).err, /pick the layers/);
  assert.match(CMD.check([{ op: "tone" }]).err, /at least one slider/);
  assert.match(CMD.check([{ op: "crop", w: 100 }]).err, /ratio, or w and h/);
  assert.match(CMD.check([{ op: "rotate", deg: 0 }]).err, /must not be 0/);
  assert.match(CMD.check([{ op: "layer", ids: "x" }]).err, /give opacity/);
  assert.match(CMD.check([{ op: "add", what: "text" }]).err, /needs text/);
  assert.match(CMD.check([{ op: "gray", pages: "1" }]).err, /pages is not a field of gray/);
  assert.ok(CMD.check([{ op: "gray" }, { op: "export", fmt: "png" }]).ok);
  assert.match(CMD.check(new Array(41).fill({ op: "gray" })).err, /at most 40/);
});

test("picking: what, has, ids; the photo commands take visible, unlocked photo layers", () => {
  const { d, ids } = picture();
  const pick = (st) => CMD.pick(d, steps([st])[0]).map((L) => L.id);
  assert.deepEqual(pick({ op: "remove", what: "text" }), [ids.title, ids.caption]);
  assert.deepEqual(pick({ op: "remove", has: "summer" }), [ids.title, ids.caption]);
  assert.deepEqual(pick({ op: "remove", has: "logo" }), [ids.logo]);
  assert.deepEqual(pick({ op: "remove", ids: ids.adj + ", " + ids.bg }), [ids.bg, ids.adj]);
  // gray with no pick: the visible photo layers only (Sky is hidden)
  assert.deepEqual(pick({ op: "gray" }), [ids.bg]);
  // named by id, a hidden photo layer counts too; a text never does
  assert.deepEqual(pick({ op: "gray", ids: ids.extra + "," + ids.title }), [ids.extra]);
});

test("layer, arrange, place, remove: properties, order, positions; locked layers stay unless named", () => {
  const { d, ids } = picture();
  let r = run(d, [{ op: "layer", what: "text", opacity: 50, blend: "multiply" }]);
  assert.equal(r.n, 2);
  assert.equal(layer(r.doc, ids.title).op, 50);
  assert.equal(layer(r.doc, ids.caption).bl, "multiply");
  r = run(d, [{ op: "layer", what: "shape", hide: "on" }]);
  assert.equal(r.n, 0, "the locked logo is not touched without its id");
  r = run(d, [{ op: "layer", ids: ids.logo, hide: "on", lock: "off" }]);
  assert.equal(layer(r.doc, ids.logo).vis, 0);
  assert.equal(layer(r.doc, ids.logo).lock, 0);
  r = run(d, [{ op: "layer", ids: ids.title, title: "Headline" }]);
  assert.equal(layer(r.doc, ids.title).name, "Headline");
  r = run(d, [{ op: "arrange", ids: ids.title, order: "back" }]);
  assert.equal(r.doc.layers[0].id, ids.title);
  r = run(d, [{ op: "arrange", ids: ids.caption, order: "forward" }]);
  assert.deepEqual(r.doc.layers.slice(3, 5).map((L) => L.id), [ids.logo, ids.caption]);
  r = run(d, [{ op: "arrange", ids: ids.adj, order: "front" }]);
  assert.equal(r.n, 0, "already on top");
  r = run(d, [{ op: "place", what: "text", dx: 10, dy: -5 }]);
  assert.equal(r.n, 2);
  assert.deepEqual([layer(r.doc, ids.title).x, layer(r.doc, ids.title).y], [110, 75]);
  r = run(d, [{ op: "place", ids: ids.caption, x: 0, y: 0 }]);
  assert.deepEqual([layer(r.doc, ids.caption).x, layer(r.doc, ids.caption).y], [0, 0]);
  r = run(d, [{ op: "remove", what: "shape" }]);
  assert.equal(r.n, 0);
  r = run(d, [{ op: "remove", what: "text" }]);
  assert.equal(r.n, 2);
  assert.equal(r.doc.layers.length, 4);
  const notes = [];
  r = run(d, [{ op: "remove", ids: r.doc.layers.map((L) => L.id).join(",") + "," + ids.title + "," + ids.caption }], notes);
  assert.equal(r.doc.layers.length, 1, "the last layer stays");
  assert.ok(notes.indexOf("lastLayer") >= 0);
});

test("texts: replace, settext, textstyle survive normalization", () => {
  const { d, ids } = picture();
  let r = run(d, [{ op: "replace", find: "SUMMER", repl: "Winter" }]);
  assert.equal(r.n, 2);
  assert.equal(layer(r.doc, ids.title).tx.s, "Winter sale");
  r = run(d, [{ op: "replace", find: "SUMMER", repl: "Winter", cs: true }]);
  assert.equal(r.n, 0);
  r = run(d, [{ op: "settext", ids: ids.caption, text: "Two lines\nhere" }]);
  assert.equal(layer(r.doc, ids.caption).tx.s, "Two lines\nhere");
  r = run(d, [{ op: "textstyle", what: "text", font: "display", size: 120, c: "#FF8800", align: "c", bold: "off", ital: "on", lh: 140 }]);
  const tx = layer(r.doc, ids.title).tx;
  assert.deepEqual([tx.f, tx.z, tx.c, tx.a, tx.b, tx.i, tx.lh], ["display", 120, "#ff8800", "c", 0, 1, 140]);
  assert.equal(r.n, 2);
});

test("style and adjustment layers: layer styles merge, none removes them; adjustment layers go on top", () => {
  const { d, ids } = picture();
  let r = run(d, [{ op: "style", ids: ids.title, effect: "shadow", c: "#112233", size: 12, opacity: 40 }, { op: "style", ids: ids.title, effect: "stroke", size: 4 }]);
  const fx = layer(r.doc, ids.title).fx;
  assert.deepEqual([fx.sh.c, fx.sh.d, fx.sh.s, fx.sh.op, fx.st.w], ["#112233", 12, 12, 40, 4]);
  r = run(r.doc, [{ op: "style", ids: ids.title, effect: "none" }]);
  assert.equal(layer(r.doc, ids.title).fx, undefined);
  assert.equal(r.n, 1);
  r = run(d, [{ op: "style", what: "adj", effect: "glow" }]);
  assert.equal(r.n, 0, "adjustment layers have no styles");
  r = run(d, [{ op: "adjlayer", kind: "bc", bright: 20, contrast: -10 }, { op: "adjlayer", kind: "hsl", sat: -100 }, { op: "adjlayer", kind: "photo", c: "#00aaff", dens: 40 }]);
  assert.equal(r.n, 3);
  const top = r.doc.layers.slice(-3).map((L) => L.aj);
  assert.deepEqual(top, [{ id: "bc", p: { b: 30, c: -10 } }, { id: "hsl", p: { h: 0, s: -100, l: 0 } }, { id: "photo", p: { c: "#00aaff", d: 40 } }]);
});

test("add: a text and a shape on top, centred when x, y are left out", () => {
  const { d } = picture();
  let r = run(d, [{ op: "add", what: "text", text: "Hello", size: 100, c: "#ffffff", bold: "on" }]);
  const t = r.doc.layers[r.doc.layers.length - 1];
  assert.equal(t.k, "text");
  assert.deepEqual([t.tx.s, t.tx.z, t.tx.c, t.tx.b], ["Hello", 100, "#ffffff", 1]);
  assert.ok(t.x > 300 && t.x < 600 && t.y > 250 && t.y < 400, "about centred: " + t.x + "," + t.y);
  r = run(d, [{ op: "add", what: "shape", shape: "heart", fill: "#ff0000", w: 200, h: 100, x: 10, y: 20 }]);
  const s = r.doc.layers[r.doc.layers.length - 1];
  assert.deepEqual([s.k, s.sh.id, s.sh.f, s.sh.w, s.sh.h, s.x, s.y], ["shape", "heart", "#ff0000", 200, 100, 10, 20]);
});

test("pixel and size commands only count here; the size carries over to later commands", () => {
  const { d, ids } = picture();
  const notes = [];
  let r = run(d, [{ op: "gray" }, { op: "tone", bright: 10 }, { op: "blur", ids: ids.bg + "," + ids.extra }], notes);
  assert.equal(r.n, 1 + 1 + 2);
  assert.equal(J(r.doc.layers), J(d.layers), "pixels change only in the app");
  r = run(d, [{ op: "crop", ratio: "1:1" }]);
  assert.deepEqual([r.doc.w, r.doc.h, r.n], [800, 800, 1]);
  r = run(d, [{ op: "crop", ratio: "3:2" }]);
  assert.equal(r.n, 0, "already 3:2");
  r = run(d, [{ op: "resize", mode: "long", v: 600 }, { op: "rotate", deg: 90 }, { op: "crop", ratio: "16:9" }]);
  assert.deepEqual([r.doc.w, r.doc.h], [400, 225]);
  r = run(d, [{ op: "resize", mode: "pct", v: 200 }]);
  assert.equal(r.n, 0, "never larger unless up");
  r = run(d, [{ op: "resize", mode: "pct", v: 200, up: true }]);
  assert.deepEqual([r.doc.w, r.doc.h], [2400, 1600]);
  r = run(d, [{ op: "canvas", w: 1300, h: 900 }, { op: "flip", dir: "v" }, { op: "watermark", text: "© me" }, { op: "dup", what: "text" }]);
  assert.equal(r.n, 1 + 1 + 1 + 2);
  const n2 = [];
  r = run(d, [{ op: "gray", what: "text" }], n2);
  assert.equal(r.n, 0);
  assert.ok(n2.indexOf("noPhoto") >= 0);
});

test("the same commands twice change nothing more", () => {
  const { d, ids } = picture();
  const list = [{ op: "layer", what: "text", opacity: 70 }, { op: "textstyle", ids: ids.title, c: "#00ff00" }, { op: "replace", find: "sale", repl: "deal" },
    { op: "place", ids: ids.caption, x: 5, y: 6 }, { op: "style", ids: ids.caption, effect: "glow", size: 8 }, { op: "rename", title: "Beach" }];
  const once = run(d, list);
  assert.ok(once.n >= 6);
  const twice = run(once.doc, list);
  assert.equal(twice.n, 0);
});

test("which pictures: the open one, by name, all; folders and new are refused", () => {
  const data = { docs: [{ id: "pabcdef1", name: "Beach day" }, { id: "pabcdef2", name: "Beach night" }, { id: "pabcdef3", name: "Portrait" }] };
  assert.deepEqual(CMD.targets(data, null, "pabcdef3", "open", "").docs.map((x) => x.id), ["pabcdef3"]);
  assert.match(CMD.targets(data, null, "", "open", "").err, /no picture is open/);
  assert.deepEqual(CMD.targets(data, null, "", "named", "beach day").docs.map((x) => x.id), ["pabcdef1"]);
  assert.match(CMD.targets(data, null, "", "named", "beach").err, /several pictures match/);
  assert.match(CMD.targets(data, null, "", "named", "dog").err, /no picture is called "dog"/);
  assert.equal(CMD.targets(data, null, "", "all", "").docs.length, 3);
  assert.match(CMD.targets(data, null, "", "folder", "x").err, /no folders/);
  assert.match(CMD.targets(data, null, "", "new", "x").err, /no new pictures/);
  assert.match(CMD.targets({ docs: [] }, null, "", "all", "").err, /no pictures/);
  assert.equal(CMD.docPath("pabcdef1"), "/internal/Photo Lab/pabcdef1/doc.json");
});

test("preview counts on copies, per picture, and files apart", () => {
  const a = picture(), b = picture();
  b.d.id = "pzzzzzz9";
  const before = J(a.d);
  const pv = CMD.preview({ docs: [a.d, b.d] }, [a.d.id, b.d.id, "pmissing1"], steps([{ op: "replace", find: "summer", repl: "winter" }, { op: "export", fmt: "png" }]), {});
  assert.deepEqual([pv.n, pv.d, pv.files, pv.made, pv.cut], [4, 2, 2, 0, 0]);
  assert.deepEqual(pv.per.map((x) => x.n), [2, 2]);
  assert.equal(J(a.d), before);
});

test("the outline for the AI: size, layers bottom to top with ids, texts and styles, never tiles", () => {
  const { d, ids } = picture();
  const o = CMD.outline(run(d, [{ op: "style", ids: ids.title, effect: "shadow" }]).doc);
  assert.deepEqual([o.w, o.h, o.unit, o.order], [1200, 800, "px", "bottom to top"]);
  assert.deepEqual(o.layers.map((L) => L.kind), ["photo", "photo", "text", "text", "shape", "adj"]);
  const t = o.layers.find((L) => L.id === ids.title);
  assert.deepEqual([t.text, t.font, t.size, t.c, t.bold, t.styles[0]], ["Summer sale", "sans", 96, "#ffffff", true, "shadow"]);
  assert.equal(o.layers[1].hidden, true);
  assert.equal(o.layers[4].locked, true);
  assert.ok(!/"t":/.test(J(o)), "no tile names");
});

test("the Assistant: Photo Lab is an edit app; normEdit and read_in_app take it", () => {
  assert.equal(C.EDIT_APP.photolab.noun, "picture");
  const n = C.normEdit({ app: "photolab", designs: "all", steps: [{ op: "gray" }] }, { photolab: CMD });
  assert.ok(n.ok, n.err);
  assert.equal(n.steps[0].op, "gray");
  assert.match(C.normEdit({ app: "photolab", steps: [{ op: "paint" }] }, { photolab: CMD }).err, /unknown command/);
  assert.ok(C.normReadApp({ app: "photolab", designs: "named", name: "Beach" }, { photolab: CMD }).ok);
  const tools = C.toolsFor({ data: true, edits: { atelier: require(path.join(ROOT, "atelier/commands.js")), photolab: CMD } });
  const ed = tools.find((x) => x.name === "edit_in_app");
  assert.deepEqual(ed.params.properties.app.enum, ["atelier", "photolab"]);
  assert.match(ed.description, /Atelier commands/);
  assert.match(ed.description, /Photo Lab commands/);
});

test("wiring: Photo Lab applies and undoes through assist.js; the Assistant loads projects from the disk", () => {
  const app = read("photolab/app.js"), as = read("photolab/assist.js"), html = read("photolab/index.html");
  // loaded on the first request (Photo Lab's first-open budget)
  assert.match(app, /if \(target\.edit \|\| target\.editUndo\) \{\n\s+assist\(\)\.then\(function \(A\) \{ if \(target\.edit\) A\.edit\(target\.edit\); else A\.undo\(target\.editUndo\); \}/);
  assert.match(app, /load\("commands\.js"\)\.then\(function \(\) \{ return load\("assist\.js"\); \}\)/);
  assert.match(app, /PL\.prefs\.doc = st\.doc\.id/);
  assert.match(app, /PL\.putIndex = function/);
  assert.ok(html.indexOf('src="assist.js') < 0 && html.indexOf('src="commands.js') < 0, "not loaded at first open");
  // every command is one editor step; Undo checks doc.m and the tiles
  assert.match(as, /PL\.docChange\(label\(s\.op\)/);
  assert.match(as, /PL\.ops\.applyAdjust\(tg, j\.id, j\.p/);
  assert.match(as, /if \(!d \|\| d\.m !== s\.m\) \{ why = "changed"/);
  assert.match(as, /tilesThere\(fs, s\.before\)/);
  assert.match(as, /orosAssistAtt/);
  // the editor's rotate and flip hand back their promise
  const ops = read("photolab/ops.js");
  assert.match(ops, /return eachRaster\(t\("step\.flip"\)/);
  assert.match(ops, /if \(deg % 90 === 0\) return rotateImage/);
  assert.match(read("photolab/recipes.js"), /watermark: watermarkLayer/);
  // the Assistant: Photo Lab's source is the disk, loaded before the card counts
  const asst = read("assistant/assistant.js");
  assert.match(asst, /photolab: \{ mod: "PhotoLabCommands", data: "oros-photolab-data", prefs: "oros-photolab-prefs", disk: 1 \}/);
  assert.match(asst, /return editLoadFor\(app, args\)\.then\(function \(\) \{ return proposeEditNow/);
  assert.match(read("assistant/index.html"), /<script src="\.\.\/photolab\/commands\.js/);
  assert.ok(read("sw.js").indexOf('"photolab/commands.js"') > 0 && read("sw.js").indexOf('"photolab/assist.js"') > 0);
});

test("every card word and Photo Lab string is in EN, EL and DE", () => {
  const asst = read("assistant/assistant.js"), de = read("i18n/de/assistant.js");
  const keys = ["ed.counting", "ed.will.photolab", "ed.op.adjlayer", "ed.op.resize.photolab", "ed.f.levels", "ed.v.kind.hsl", "ed.bl.luminosity", "ed.fx.overlay", "ed.v.what.adj", "ed.note.noPhoto"];
  keys.forEach((k) => {
    assert.equal(asst.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
    assert.ok(de.indexOf('"' + k + '":') > 0, k + " in DE");
  });
  CMD.BLENDS.forEach((b) => assert.ok(asst.indexOf('"ed.bl.' + b + '":') > 0, b));
  CMD.ORDER.forEach((op) => assert.ok(asst.indexOf('"ed.op.' + op + '":') > 0, "ed.op." + op));
  global.window = {};
  require(path.join(ROOT, "photolab/strings.js"));
  const S = global.window.PL_STRINGS, pde = read("i18n/de/photolab.js");
  Object.keys(S.en).filter((k) => k.indexOf("as.") === 0).forEach((k) => {
    assert.ok(S.el[k], k + " in EL");
    assert.ok(pde.indexOf('"' + k + '":') > 0, k + " in DE");
  });
  delete global.window;
});
