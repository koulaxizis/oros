// Whiteboard commands for the Assistant (whiteboard/commands.js,
// AS-EDIT, wave WB1): the catalog and its guide, checking, every
// command on a real board (text, find and replace, colours, shapes,
// arrow heads, pen width, moving, resizing, order, grids, new notes,
// texts, shapes and frames, arrows between objects, removing,
// renaming) with newer stamps, picking by frame, undo back to the
// earlier board, which boards a request is for, the preview counts,
// the outline for the AI; applying in Whiteboard (assist.js) with its
// report; and the wiring in Whiteboard and the Assistant (source, card
// words in EN, EL and DE).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const CMD = require(path.join(ROOT, "whiteboard/commands.js"));
const W = require(path.join(ROOT, "whiteboard/core.js"));
const C = require(path.join(ROOT, "assistant/core.js"));
const J = (x) => JSON.stringify(x);
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const BID = "bplan01";
// A planning board: a frame "Ideas" with two notes, a shape and a free
// text outside it, an arrow between the notes, a drawing; and a second,
// empty board.
function data() {
  return W.normalize({
    ver: 1,
    boards: [{ id: BID, name: "Plan", m: 1 }, { id: "bother1", name: "Retro", m: 2 }],
    objs: [
      { id: "fr1", b: BID, k: "frame", x: 0, y: 0, w: 600, h: 400, tx: "Ideas", z: -1, m: 1, c: "gray" },
      { id: "n1", b: BID, k: "note", x: 40, y: 40, w: 200, h: 200, tx: "Launch in 2025", z: 1, m: 1, c: "yellow" },
      { id: "n2", b: BID, k: "note", x: 300, y: 40, w: 200, h: 200, tx: "Hire a designer", z: 2, m: 1, c: "pink" },
      { id: "s1", b: BID, k: "shape", x: 800, y: 40, w: 200, h: 120, tx: "Budget 2025", shp: "rect", f: "soft", z: 3, m: 1, c: "blue" },
      { id: "t1", b: BID, k: "text", x: 800, y: 300, w: 280, h: 30, tx: "Notes", fs: 24, z: 4, m: 1, c: "ink" },
      { id: "a1", b: BID, k: "arrow", ax: 0, ay: 0, bx: 0, by: 0, ao: "n1", bo: "n2", hd: "end", ds: false, tx: "", z: 5, m: 1, c: "ink" },
      { id: "p1", b: BID, k: "pen", x: 900, y: 500, w: 10, h: 10, pts: [0, 0, 10, 10], sw: 3, z: 6, m: 1, c: "ink" }
    ],
    tombs: {}
  });
}
function run(steps, d) {
  const chk = CMD.check(steps);
  assert.ok(chk.ok, chk.err);
  const w = CMD.work(d || data(), BID);
  let seq = 0, n = 0;
  const env = { notes: [], now: 5000, newId: () => "new" + (++seq) };
  chk.steps.forEach((st) => { n += CMD.apply(w, st, env); });
  const o = (id) => w.data.objs.filter((x) => x.id === id)[0] || null;
  return { w, n, notes: env.notes, o, board: W.board(w.data, BID) };
}

test("the guide names every command and field; the tool declares every field with one type", () => {
  CMD.ORDER.forEach((op) => {
    assert.match(CMD.GUIDE, new RegExp("\\b" + op + ":"), op);
    Object.keys(CMD.CATALOG[op].args).forEach((k) => assert.match(CMD.GUIDE, new RegExp("\\b" + k + "\\b"), op + "." + k));
  });
  const tool = C.editTool({ whiteboard: CMD });
  const props = tool.params.properties.steps.items.properties;
  CMD.ORDER.forEach((op) => Object.keys(CMD.CATALOG[op].args).forEach((k) => assert.ok(props[k], k)));
  assert.equal(props.frame.type, "string");
  assert.equal(props.dx.type, "number");
  assert.match(tool.description, /In Whiteboard the documents are boards/);
  assert.match(C.readAppTool(["whiteboard"]).description, /for Whiteboard a board/);
  W.COLOR_KEYS.forEach((k) => assert.ok(CMD.GUIDE.includes(k + " " + W.COLORS[k][0]), "the guide gives colour " + k));
});

test("check: unknown commands, fields and values go back to the model; removals need a pick", () => {
  assert.match(CMD.check([]).err, /empty/);
  assert.match(CMD.check([{ op: "zap" }]).err, /unknown command "zap"/);
  assert.match(CMD.check([{ op: "style", shape: "star" }]).err, /shape "star" is not allowed/);
  assert.match(CMD.check([{ op: "style", track: 2 }]).err, /track is not a field of style/);
  assert.match(CMD.check([{ op: "style" }]).err, /give c, shape, fill, size, ends, dash or sw/);
  assert.match(CMD.check([{ op: "move" }]).err, /give dx, dy, x, y, w, h or order/);
  assert.match(CMD.check([{ op: "remove" }]).err, /pick the objects/);
  assert.match(CMD.check([{ op: "add", what: "note" }]).err, /a note needs text/);
  assert.match(CMD.check([{ op: "connect", from: "n1" }]).err, /to is missing/);
  assert.match(CMD.check([{ op: "remove", ids: "n1;drop" }]).err, /ids must be object ids/);
  assert.ok(CMD.check([{ op: "add", what: "shape" }]).ok, "a shape needs no text");
  assert.match(CMD.check(new Array(41).fill({ op: "rename", title: "x" })).err, /at most 40/);
});

test("text: settext, replace (case, whole words) and a text's height follows its lines", () => {
  const r = run([{ op: "replace", find: "2025", repl: "2026" }, { op: "settext", ids: "t1", text: "One\nTwo\nThree" }]);
  assert.equal(r.o("n1").tx, "Launch in 2026");
  assert.equal(r.o("s1").tx, "Budget 2026");
  assert.equal(r.o("t1").h, 90, "three lines of 24 px");
  assert.equal(r.n, 3);
  assert.ok(r.o("n1").m >= 5000, "a newer stamp, so it syncs");
  const w = run([{ op: "replace", find: "launch", repl: "Ship", cs: true }]);
  assert.equal(w.n, 0, "match case");
  assert.equal(run([{ op: "replace", find: "a", repl: "A", word: true, what: "note" }]).o("n2").tx, "Hire A designer");
});

test("style: colours snap to the board's own, shapes, fills, font size, arrow heads, dashes and pen width", () => {
  const r = run([{ op: "style", what: "note", c: "#2f9e44" }, { op: "style", ids: "s1", shape: "ellipse", fill: "solid", c: "#ff0000" },
    { op: "style", what: "text", size: 40 }, { op: "style", what: "arrow", ends: "both", dash: "on" }, { op: "style", what: "pen", sw: 8 }]);
  assert.deepEqual([r.o("n1").c, r.o("n2").c], ["green", "green"]);
  assert.deepEqual([r.o("s1").shp, r.o("s1").f, r.o("s1").c], ["ellipse", "solid", "red"]);
  assert.deepEqual([r.o("t1").fs, r.o("t1").h], [40, 50]);
  assert.deepEqual([r.o("a1").hd, r.o("a1").ds], ["both", true]);
  assert.equal(r.o("p1").sw, 8);
  assert.equal(r.o("fr1").c, "gray", "unpicked objects stay");
  assert.equal(CMD.nearestColor("#fff1a8"), "yellow", "a soft shade counts too");
});

test("frame picks what lies inside it; move, resize, order and grids", () => {
  const f = run([{ op: "move", frame: "ideas", dx: 100, dy: 50 }]);
  assert.deepEqual([f.o("n1").x, f.o("n1").y, f.o("n2").x], [140, 90, 400]);
  assert.equal(f.o("fr1").x, 0, "the frame itself is not picked");
  assert.equal(f.o("s1").x, 800, "outside the frame");
  assert.equal(f.o("a1").ao, "n1", "a stuck arrow stays stuck");
  assert.deepEqual(run([{ op: "move", frame: "nope", dx: 1 }]).notes, ["noFrame"]);
  const m = run([{ op: "move", ids: "n2,s1", x: 0, y: 500, w: 100, order: "front" }]);
  assert.deepEqual([m.o("n2").x, m.o("n2").y, m.o("s1").x, m.o("s1").y], [0, 500, 500, 500], "the others keep their place next to the first");
  assert.deepEqual([m.o("n2").w, m.o("s1").w], [100, 100]);
  assert.ok(m.o("n2").z > 6 && m.o("s1").z > m.o("n2").z, "brought to the front in their order");
  const g = run([{ op: "arrange", what: "note", n: 1, gap: 10, x: 0, y: 0 }]);
  assert.deepEqual([g.o("n1").x, g.o("n1").y, g.o("n2").x, g.o("n2").y], [0, 0, 0, 210]);
  const sq = run([{ op: "arrange", ids: "n1,n2,s1,t1", gap: 20 }]);
  assert.deepEqual([sq.o("n2").x, sq.o("s1").x, sq.o("s1").y, sq.o("t1").y], [340, 40, 260, 260], "about square: 2 columns as wide as the widest");
});

test("add notes, texts, shapes and frames; connect objects with arrows; remove; rename", () => {
  const r = run([{ op: "add", what: "note", text: "New idea" }, { op: "add", what: "shape", x: 10, y: 20, shape: "diamond", c: "#e03131" },
    { op: "add", what: "frame", text: "Later", x: 0, y: 800 }, { op: "add", what: "text", text: "Hello", size: 32 },
    { op: "connect", from: "launch", to: "Budget", text: "costs", dash: "on" }, { op: "connect", from: "n1", to: "nothing" },
    { op: "remove", ids: "p1" }, { op: "rename", title: "Plan B" }]);
  const nw = r.o("new1");
  assert.deepEqual([nw.k, nw.tx, nw.c, nw.x, nw.y, nw.w], ["note", "New idea", "yellow", 1120, -24, 200], "placed right of everything, level with its top (a frame's name)");
  assert.deepEqual([r.o("new2").shp, r.o("new2").c, r.o("new2").f, r.o("new2").x], ["diamond", "red", "soft", 10]);
  assert.ok(r.o("new3").z < 0, "a frame goes under the rest");
  assert.deepEqual([r.o("new4").k, r.o("new4").fs, r.o("new4").h], ["text", 32, 40]);
  const ar = r.o("new5");
  assert.deepEqual([ar.k, ar.ao, ar.bo, ar.tx, ar.ds, ar.hd], ["arrow", "n1", "s1", "costs", true, "end"]);
  assert.deepEqual(r.notes, ["noEnd"]);
  assert.equal(r.o("p1"), null);
  assert.ok(r.w.data.tombs.p1 >= 5000);
  assert.equal(r.board.name, "Plan B");
  assert.equal(r.n, 7, "4 added, 1 arrow, 1 removed, the name");
});

test("a full board takes no more; undo brings the board back as new edits", () => {
  const d = data();
  const many = [];
  for (let k = 0; k < 1993; k++) many.push({ id: "x" + k, b: BID, k: "note", x: k, y: 0, w: 10, h: 10, tx: "", z: 10, m: 1, c: "yellow" });
  const full = run([{ op: "add", what: "note", text: "one too many" }], W.normalize(Object.assign({}, d, { objs: d.objs.concat(many) })));
  assert.deepEqual([full.n, full.notes], [0, ["full"]]);
  const before = CMD.snapshot(d, BID);
  const r = run([{ op: "remove", what: "note" }, { op: "add", what: "note", text: "x" }, { op: "rename", title: "Z" }], d);
  const merged = W.merge(d, r.w.data);
  const back = CMD.restore(merged, BID, before, 9000);
  const strip = (s) => JSON.stringify(s.objs.map((o) => Object.assign({}, o, { m: 0 })).sort((a, b) => (a.id < b.id ? -1 : 1)));
  assert.equal(strip(CMD.snapshot(back, BID)), strip(before));
  assert.equal(W.board(back, BID).name, "Plan");
  assert.ok(W.objsOf(back, BID).filter((o) => o.id === "n1")[0].m >= 9000, "brought back with a newer stamp");
});

test("view, targets, preview and the outline for the AI", () => {
  const vw = CMD.view(data());
  assert.deepEqual(vw.docs.map((x) => x.name), ["Retro", "Plan"], "newest first");
  assert.equal(CMD.targets(vw, null, BID, "open").docs[0].name, "Plan");
  assert.equal(CMD.targets(vw, null, "", "open").docs[0].name, "Retro", "Whiteboard opens the newest board");
  assert.match(CMD.targets(vw, null, "gone", "open").err, /no board is open/);
  assert.equal(CMD.targets(vw, null, "", "named", "plan").docs[0].id, BID);
  assert.match(CMD.targets(vw, null, "", "named", "x").err, /no board is called/);
  assert.match(CMD.targets(vw, null, "", "new").err, /made in Whiteboard itself/);
  assert.match(CMD.targets(CMD.view({ boards: [], objs: [] }), null, "", "all").err, /no boards/);
  const pv = CMD.preview(vw, [BID, "bother1"], CMD.check([{ op: "add", what: "note", text: "a" }, { op: "rename", title: "X" }]).steps);
  assert.deepEqual([pv.n, pv.d, pv.per.map((x) => x.n)], [4, 2, [2, 2]]);
  assert.equal(vw.docs[1].store.objs.length, 7, "the preview works on copies");
  const o = CMD.outline(vw.docs[1]);
  assert.equal(o.name, "Plan");
  assert.deepEqual(o.objects.map((x) => x.id), ["fr1", "n1", "n2", "s1", "t1", "a1", "p1"]);
  assert.deepEqual(o.objects[1], { id: "n1", kind: "note", c: "yellow", x: 40, y: 40, w: 200, h: 200, text: "Launch in 2025", frame: "Ideas" });
  assert.deepEqual(o.objects[5], { id: "a1", kind: "arrow", c: "ink", from: "n1", to: "n2", frame: "Ideas" });
  assert.deepEqual([o.objects[3].shape, o.objects[3].fill, o.objects[4].size, o.objects[6].sw], ["rect", "soft", 24, 3]);
});

test("Whiteboard applies the commands, merges them into its data and reports to the card", async () => {
  const ctx = { window: {}, console, JSON, Promise, Math, Date, Uint8Array, document: { querySelector: () => null } };
  ctx.window.window = ctx.window;
  ctx.window.parent = { orosAssistAtt: { rb: {} } };
  vm.createContext(ctx);
  ["recipes/core.js", "whiteboard/core.js", "whiteboard/commands.js"].forEach((x) => vm.runInContext(read(x), ctx, { filename: x }));
  let state = data(), bid = BID, undoPushed = 0, busy = false;
  const toasts = [];
  ctx.window.WhiteboardAssistHost = {
    t: (k, v) => k + (v ? J(v) : ""), toast: (s) => toasts.push(s), undoToast: (s) => toasts.push("undo:" + s),
    data: () => state, pid: () => bid, busy: () => busy, open: (id) => { bid = id; },
    set: (next, withUndo) => { if (withUndo) undoPushed++; state = next; }
  };
  ctx.indexedDB = { open() { throw new Error("no IndexedDB here"); } };
  vm.runInContext(read("whiteboard/assist.js"), ctx, { filename: "whiteboard/assist.js" });
  const A = ctx.window.WhiteboardAssist;
  A.edit({ key: "k1", docs: [BID, "nope"], steps: [{ op: "style", what: "note", c: "#1c7ed6" }, { op: "add", what: "note", text: "Hi" }, { op: "remove", ids: "p1" }] });
  await new Promise((r) => setTimeout(r, 20));
  const rep = ctx.window.parent.orosAssistAtt.rb.k1;
  assert.deepEqual([rep.ok, rep.n, rep.d, rep.per[0].name], [1, 4, 1, "Plan"]);
  assert.match(rep.tok, /^wb-[0-9a-f]{18}$/);
  assert.equal(W.objsOf(state, BID).filter((o) => o.id === "n1")[0].c, "blue");
  assert.equal(W.objsOf(state, BID).filter((o) => o.tx === "Hi").length, 1);
  assert.ok(state.tombs.p1);
  assert.equal(undoPushed, 1, "the open board's change is one step of its Undo");
  assert.deepEqual(toasts, ['undo:as.done1{"n":4}']);
  A.edit({ key: "k2", docs: [BID], steps: [{ op: "zap" }] });
  assert.equal(J(ctx.window.parent.orosAssistAtt.rb.k2), J({ failed: 1, why: "bad" }));
  busy = true;
  A.edit({ key: "k3", docs: [BID], steps: [{ op: "rename", title: "X" }] });
  assert.equal(J(ctx.window.parent.orosAssistAtt.rb.k3), J({ failed: 1, why: "busy" }), "never while drawing or typing");
  busy = false;
  A.edit({ key: "k4", docs: ["bother1"], steps: [{ op: "rename", title: "Party" }] });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(W.board(state, "bother1").name, "Party");
  assert.equal(bid, "bother1", "the changed board opens");
  assert.equal(undoPushed, 1);
  await A.undo({ key: "k5", tok: "wb-00" });
  assert.equal(J(ctx.window.parent.orosAssistAtt.rb.k5), J({ failed: 1, why: "gone" }));
});

test("wiring: Whiteboard loads the catalog on the first request and writes through its own save", () => {
  const app = read("whiteboard/app.js");
  assert.match(app, /if \(target && \(target\.edit \|\| target\.editUndo\)\) \{ assistRun\(target\); return; \}/);
  assert.match(app, /loadScript\("commands\.js"\); \}\)\.then\(function \(\) \{ return loadScript\("assist\.js"\); \}\)/);
  assert.match(app, /window\.WhiteboardAssistHost = \{/);
  assert.match(app, /if \(!save\(next\)\) return;\n\s+if \(step\) \{\n\s+var h = H\(\);\n\s+h\.u\.push\(step\);/, "the change is one step of the board's Undo");
  const as = read("whiteboard/assist.js");
  assert.match(as, /K\.check\(rq && rq\.steps\)/, "Whiteboard checks the commands again");
  assert.match(as, /fp\(stateOf\(rec\)\) !== rec\.fp/, "a changed board is not undone");
  assert.match(as, /K\.restore\(next, x\.id, x\.before, now\)/);
  const sw = read("sw.js");
  ["whiteboard/commands.js", "whiteboard/assist.js"].forEach((x) => assert.ok(sw.includes('"' + x + '"'), x));
  assert.ok(!read("whiteboard/index.html").includes("commands.js"), "loaded on first use");
  const de = read("i18n/de/whiteboard.js");
  ["as.done", "as.done1", "as.done0", "as.bad", "as.undone", "as.changed", "as.gone"].forEach((k) => {
    assert.equal((app.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k);
    assert.ok(de.includes('"' + k + '":'), k);
  });
});

test("wiring: the Assistant reads Whiteboard, and the card speaks of objects in EN, EL and DE", () => {
  assert.ok(!read("assistant/index.html").includes("../whiteboard/"), "loaded on first use");
  const as = read("assistant/assistant.js");
  assert.match(as, /whiteboard: \["\.\.\/whiteboard\/core\.js", "\.\.\/whiteboard\/commands\.js"\]/);
  assert.match(as, /whiteboard: \{ mod: "WhiteboardCommands", data: "oros-whiteboard-data", prefs: "oros-whiteboard-prefs", open: "board", view: 1 \}/);
  assert.equal(C.EDIT_APP.whiteboard.noun, "board");
  assert.equal(JSON.parse(read("apps.json")).apps.find((a) => a.id === "whiteboard").search, "search.js", "so the Assistant can be allowed to read Whiteboard");
  const de = read("i18n/de/assistant.js");
  const has = (k) => (as.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length === 2;
  const keys = ["ed.will.whiteboard", "ed.did.whiteboard", "ed.sureDel.whiteboard"];
  ["full", "noEnd", "noFrame"].forEach((n) => keys.push("ed.note." + n));
  CMD.ORDER.forEach((op) => keys.push(has("ed.op." + op + ".whiteboard") ? "ed.op." + op + ".whiteboard" : "ed.op." + op));
  CMD.ORDER.forEach((op) => Object.keys(CMD.CATALOG[op].args).forEach((k) => {
    if (op === "add" && k === "what") return;     // the kind of a new object reads without a label
    keys.push(has("ed.f." + k + ".whiteboard") ? "ed.f." + k + ".whiteboard" : "ed.f." + k);
  }));
  Object.keys(CMD.CATALOG).forEach((op) => Object.keys(CMD.CATALOG[op].args).forEach((k) => {
    const spec = CMD.CATALOG[op].args[k];
    if (spec.t !== "enum") return;
    const pre = op === "add" && k === "what" ? "ed.v.add." : k === "shape" ? "ed.shp." : "ed.v." + k + ".";
    spec.v.filter(Boolean).forEach((x) => keys.push(has(pre + x + ".whiteboard") ? pre + x + ".whiteboard" : pre + x));
  }));
  keys.forEach((k) => {
    assert.ok(has(k), "EN + EL " + k);
    assert.ok(de.includes('"' + k + '":'), "DE " + k);
  });
  assert.match(as, /\|ends\|dash\)\$\/\.test\(k\)\) return edT\(app, "ed\.v\."/, "the card names these values");
  assert.match(as, /if \(k === "fill" && app === "whiteboard"\) return edT\(app, "ed\.v\.fill\." \+ v\);/, "a shape's fill reads as a word");
});

test("the catalog runs where the Assistant loads it (browser globals, no Node)", () => {
  const ctx = { window: {}, console };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  ["recipes/core.js", "whiteboard/core.js", "whiteboard/commands.js"].forEach((x) => vm.runInContext(read(x), ctx, { filename: x }));
  const K = ctx.window.WhiteboardCommands;
  assert.ok(K && typeof K.preview === "function");
  assert.equal(K.preview(K.view(data()), [BID], K.check([{ op: "rename", title: "Y" }]).steps).n, 1);
});
