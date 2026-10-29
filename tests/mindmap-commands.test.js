// Mind map commands for the Assistant (mindmap/commands.js, AS-EDIT,
// wave MM1): the catalog and its guide, checking, every command on a
// real map (text, find and replace, new ideas from a list, colours,
// emoji, notes, links, ticks, styles, moving branches, sorting,
// cross-links, boundaries, removing with what is under, layout,
// renaming) with newer stamps, picking by branch and level, undo back
// to the earlier map, which maps a request is for, the preview counts,
// the outline for the AI; applying in Mind map (assist.js) with its
// report; and the wiring in Mind map and the Assistant (source, card
// words in EN, EL and DE).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const CMD = require(path.join(ROOT, "mindmap/commands.js"));
const M = require(path.join(ROOT, "mindmap/mm-core.js"));
const C = require(path.join(ROOT, "assistant/core.js"));
const J = (x) => JSON.stringify(x);
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const MID = "mlaunch";
// A launch plan: the centre, Marketing (with Ads and Press 2025) and
// Budget, a cross-link and a boundary; and a second map with only its
// drawn centre.
function data() {
  return M.merge({
    maps: [{ id: MID, m: 1, sides: "both" }, { id: "mother", m: 2, sides: "both" }],
    nodes: [
      { id: MID + "-r", m: 1, map: MID, parent: "", ord: "", text: "Launch" },
      { id: "mkt", m: 1, map: MID, parent: MID + "-r", ord: "V", text: "Marketing" },
      { id: "bud", m: 1, map: MID, parent: MID + "-r", ord: "k", text: "Budget" },
      { id: "ads", m: 1, map: MID, parent: "mkt", ord: "V", text: "Ads" },
      { id: "prs", m: 1, map: MID, parent: "mkt", ord: "k", text: "Press 2025" }
    ],
    links: [{ id: "lk1", m: 1, map: MID, from: "ads", to: "bud", label: "costs" }],
    frames: [{ id: "fr1", m: 1, map: MID, nodes: ["ads", "prs"], kind: "box", label: "Q1" }],
    tombs: {}
  }, {});
}
function run(steps, d) {
  const chk = CMD.check(steps);
  assert.ok(chk.ok, chk.err);
  const w = CMD.work(d || data(), MID);
  let seq = 0, n = 0;
  const env = { notes: [], now: 5000, newId: () => "new" + (++seq), untitled: "Untitled map" };
  chk.steps.forEach((st) => { n += CMD.apply(w, st, env); });
  const T = M.resolve(w.data, MID);
  return { w, n, notes: env.notes, T, N: (id) => T.N[id] || null };
}

test("the guide names every command and field; the tool declares every field with one type", () => {
  CMD.ORDER.forEach((op) => {
    assert.match(CMD.GUIDE, new RegExp("\\b" + op + ":"), op);
    Object.keys(CMD.CATALOG[op].args).forEach((k) => assert.match(CMD.GUIDE, new RegExp("\\b" + k + "\\b"), op + "." + k));
  });
  const tool = C.editTool({ mindmap: CMD });
  const props = tool.params.properties.steps.items.properties;
  CMD.ORDER.forEach((op) => Object.keys(CMD.CATALOG[op].args).forEach((k) => assert.ok(props[k], k)));
  assert.equal(props.level.type, "number");
  assert.equal(props.branch.type, "string");
  assert.match(tool.description, /In Mind map the documents are maps/);
  assert.match(C.readAppTool(["mindmap"]).description, /for Mind map a map/);
  M.COLOR_KEYS.forEach((k) => assert.ok(CMD.GUIDE.includes(k + " " + M.COLORS[k]), "the guide gives colour " + k));
});

test("check: unknown commands, fields and values go back to the model; removals and frames need a pick", () => {
  assert.match(CMD.check([]).err, /empty/);
  assert.match(CMD.check([{ op: "zap" }]).err, /unknown command "zap"/);
  assert.match(CMD.check([{ op: "node", shape: "star" }]).err, /shape "star" is not allowed/);
  assert.match(CMD.check([{ op: "node", size: 2 }]).err, /size is not a field of node/);
  assert.match(CMD.check([{ op: "node", url: "javascript:alert(1)" }]).err, /url must start with http/);
  assert.match(CMD.check([{ op: "node" }]).err, /give c, emoji, note, url, done/);
  assert.match(CMD.check([{ op: "remove" }]).err, /pick the ideas/);
  assert.match(CMD.check([{ op: "frame", kind: "brace" }]).err, /pick the ideas/);
  assert.match(CMD.check([{ op: "map" }]).err, /give layout or sides/);
  assert.match(CMD.check([{ op: "move", ids: "ads" }]).err, /to is missing/);
  assert.match(CMD.check([{ op: "remove", level: 0 }]).err, /level 0 is not allowed/);
  assert.ok(CMD.check([{ op: "node", url: "none", has: "x" }]).ok, "none removes a link");
});

test("text: settext and replace; renaming writes the centre, also when it was only drawn", () => {
  const r = run([{ op: "replace", find: "2025", repl: "2026" }, { op: "settext", ids: "ads", text: "Online ads" }, { op: "rename", title: "Launch 2026" }]);
  assert.deepEqual([r.N("prs").text, r.N("ads").text, r.T.root.text], ["Press 2026", "Online ads", "Launch 2026"]);
  assert.equal(r.n, 3);
  assert.ok(r.N("prs").m >= 5000, "a newer stamp, so it syncs");
  const w = CMD.work(data(), "mother");
  CMD.apply(w, CMD.check([{ op: "rename", title: "Ideas" }]).steps[0], { now: 5000 });
  const T = M.resolve(w.data, "mother");
  assert.deepEqual([T.root.virtual, T.root.text], [undefined, "Ideas"]);
});

test("add: one idea or a whole list under an idea, at the end, with colour, emoji and note on the top ones", () => {
  const r = run([{ op: "add", to: "budget", text: "- Rent\n- Salaries\n  - Design\n  - Code", c: "#87cf3e", emoji: "💶" }, { op: "add", text: "Risks" }]);
  assert.deepEqual(r.T.kids.bud.map((id) => r.N(id).text), ["Rent", "Salaries"]);
  assert.deepEqual(r.T.kids[r.T.kids.bud[1]].map((id) => r.N(id).text), ["Design", "Code"]);
  assert.deepEqual([r.N(r.T.kids.bud[0]).color, r.N(r.T.kids.bud[0]).emoji, r.N(r.T.kids[r.T.kids.bud[1]][0]).color], ["green", "💶", ""]);
  const tops = r.T.kids[MID + "-r"].map((id) => r.N(id).text);
  assert.deepEqual(tops, ["Marketing", "Budget", "Risks"], "at the end, by order keys");
  assert.equal(r.n, 5);
  assert.deepEqual(run([{ op: "add", to: "nowhere", text: "x" }]).notes, ["noIdea"]);
});

test("node: colours snap to the branch colours; emoji, notes, links, ticks and styles; level and branch pick", () => {
  const r = run([{ op: "node", level: 1, c: "#ff0000", bold: "on", nodesize: "l", shape: "pill" },
    { op: "node", branch: "Marketing", level: 2, done: "on", emoji: "✅", note: "Ask Anna", url: "https://example.com/a" },
    { op: "node", ids: "ads", emoji: "none", fill: "solid", border: "dashed", nodesize: "m" }]);
  assert.deepEqual([r.N("mkt").color, r.N("bud").color, r.N("ads").color], ["red", "red", ""]);
  assert.deepEqual([r.T.sty.mkt.bold, r.T.sty.mkt.size, r.T.sty.mkt.shape], [true, "l", "pill"]);
  assert.deepEqual([r.N("prs").done, r.N("prs").emoji, r.N("prs").note, r.N("prs").url], [true, "✅", "Ask Anna", "https://example.com/a"]);
  assert.deepEqual([r.N("ads").emoji, r.T.sty.ads.fill, r.T.sty.ads.border, r.T.sty.ads.size], ["", "solid", "dashed", ""]);
  assert.equal(CMD.nearestColor("#88ce40"), "green");
});

test("move, sort, cross-links, boundaries and the layout", () => {
  const m = run([{ op: "move", ids: "prs", to: "Budget" }, { op: "move", ids: "mkt", to: "Ads" }]);
  assert.equal(m.T.par.prs, "bud");
  assert.equal(m.T.par.mkt, MID + "-r", "a branch never goes inside itself");
  assert.deepEqual(m.notes, ["loop"]);
  const s = run([{ op: "add", to: "Marketing", text: "- Blog\n- Events" }, { op: "sort", branch: "Marketing", level: 1 }]);
  assert.deepEqual(s.T.kids.mkt.map((id) => s.N(id).text), ["Ads", "Blog", "Events", "Press 2025"]);
  const z = run([{ op: "sort" }]);
  assert.deepEqual(z.T.kids[MID + "-r"].map((id) => z.N(id).text), ["Budget", "Marketing"], "the centre's ideas A-Z");
  assert.deepEqual(run([{ op: "sort", branch: "Marketing", level: 1, desc: true }]).T.kids.mkt.map((id) => id), ["prs", "ads"], "Z-A");
  const l = run([{ op: "link", from: "Press", to: "Budget", text: "pays" }, { op: "frame", branch: "Marketing", kind: "brace", text: "Team", c: "#6d4aff" },
    { op: "map", layout: "org", sides: "right" }]);
  const lk = l.T.links.filter((x) => x.id === "new1")[0];
  assert.deepEqual([lk.from, lk.to, lk.label], ["prs", "bud", "pays"]);
  const fr = l.T.frames.filter((x) => x.id === "new2")[0];
  assert.deepEqual([fr.kind, fr.label, fr.color, fr.nodes], ["brace", "Team", "violet", ["ads", "mkt", "prs"]]);
  assert.deepEqual([l.T.kind, l.T.map.sides], ["org", "right"]);
  assert.equal(run([{ op: "map", layout: "map" }]).n, 1, "back around the centre writes a default row");
});

test("remove takes what is under, the links and a boundary left empty; the centre stays", () => {
  const r = run([{ op: "remove", branch: "Marketing" }]);
  ["mkt", "ads", "prs"].forEach((id) => { assert.equal(r.N(id), null, id); assert.ok(r.w.data.tombs[id] >= 5000, id); });
  assert.equal(r.T.links.length, 0);
  assert.equal(r.T.frames.length, 0);
  assert.equal(r.n, 5);
  const c = run([{ op: "remove", has: "Launch" }]);
  assert.deepEqual([c.n, c.notes], [0, ["centre"]]);
});

test("undo brings the map back as new edits", () => {
  const d = data();
  const before = CMD.snapshot(d, MID);
  const r = run([{ op: "remove", has: "Ads" }, { op: "add", text: "x" }, { op: "node", ids: "bud", bold: "on" }, { op: "map", layout: "tree" }, { op: "rename", title: "Z" }], d);
  const merged = M.merge(d, r.w.data);
  const back = CMD.restore(merged, MID, before, 9000);
  const T = M.resolve(back, MID), T0 = M.resolve(d, MID);
  const flat = (t) => J(Object.keys(t.N).sort().map((id) => [id, t.N[id].text, t.par[id] || "", t.N[id].ord]));
  assert.equal(flat(T), flat(T0));
  assert.deepEqual([T.kind, Object.keys(T.sty).length, T.links.length, T.frames.length], ["", 0, 1, 1]);
  assert.ok(T.N.ads.m >= 9000, "brought back with a newer stamp");
});

test("view, targets, preview and the outline for the AI", () => {
  const vw = CMD.view(data());
  assert.deepEqual(vw.docs.map((x) => x.id), ["mother", MID], "newest first");
  assert.equal(vw.docs.find((x) => x.id === MID).name, "Launch");
  assert.equal(CMD.targets(vw, null, MID, "open").docs[0].name, "Launch");
  assert.match(CMD.targets(vw, null, "", "open").err, /no map is open/);
  assert.equal(CMD.targets(vw, null, "", "named", "launch").docs[0].id, MID);
  assert.match(CMD.targets(vw, null, "", "named", "x").err, /no map is called/);
  assert.match(CMD.targets(vw, null, "", "new").err, /made in Mind map itself/);
  const pv = CMD.preview(vw, [MID, "mother"], CMD.check([{ op: "add", text: "a" }, { op: "rename", title: "X" }]).steps);
  assert.deepEqual([pv.n, pv.d], [5, 2]);
  assert.equal(vw.data.nodes.length, 5, "the preview works on copies");
  const o = CMD.outline(vw.docs.find((x) => x.id === MID));
  assert.deepEqual([o.title, o.layout, o.sides, o.centre], ["Launch", "map", "both", MID + "-r"]);
  assert.deepEqual(o.ideas.map((x) => x.id + ":" + x.level), [MID + "-r:0", "mkt:1", "ads:2", "prs:2", "bud:1"]);
  assert.deepEqual(o.ideas[3], { id: "prs", level: 2, text: "Press 2025", parent: "mkt" });
  assert.deepEqual(o.links, [{ id: "lk1", from: "ads", to: "bud", text: "costs" }]);
  assert.deepEqual(o.frames, [{ id: "fr1", kind: "box", text: "Q1", ideas: ["ads", "prs"] }]);
});

test("Mind map applies the commands, merges them into its data and reports to the card", async () => {
  const ctx = { window: {}, console, JSON, Promise, Math, Date, Uint8Array, document: { querySelector: () => null } };
  ctx.window.window = ctx.window;
  ctx.window.parent = { orosAssistAtt: { rb: {} } };
  vm.createContext(ctx);
  ["recipes/core.js", "mindmap/mm-core.js"].forEach((x) => vm.runInContext(read(x), ctx, { filename: x }));
  ctx.window.MMCore = ctx.MMCore;   // mm-core.js attaches to `this`, the page's window in a browser
  vm.runInContext(read("mindmap/commands.js"), ctx, { filename: "mindmap/commands.js" });
  let state = data(), mid = MID, undoPushed = 0, busy = false, seq = 0;
  const toasts = [];
  ctx.window.MindmapAssistHost = {
    t: (k, v) => k + (v ? J(v) : ""), toast: (s) => toasts.push(s), undoToast: (s) => toasts.push("undo:" + s), newId: () => "id" + (++seq),
    data: () => state, pid: () => mid, busy: () => busy, open: (id) => { mid = id; },
    set: (next, withUndo) => { if (withUndo) undoPushed++; state = next; }
  };
  ctx.indexedDB = { open() { throw new Error("no IndexedDB here"); } };
  vm.runInContext(read("mindmap/assist.js"), ctx, { filename: "mindmap/assist.js" });
  const A = ctx.window.MindmapAssist;
  A.edit({ key: "k1", docs: [MID, "nope"], steps: [{ op: "add", to: "Budget", text: "Rent" }, { op: "node", ids: "bud", c: "#e06c75" }, { op: "remove", ids: "ads" }] });
  await new Promise((r) => setTimeout(r, 20));
  const rep = ctx.window.parent.orosAssistAtt.rb.k1;
  assert.deepEqual([rep.ok, rep.d, rep.per[0].name], [1, 1, "Launch"]);
  assert.match(rep.tok, /^mm-[0-9a-f]{18}$/);
  const T = M.resolve(state, MID);
  assert.deepEqual([T.N.id1.text, T.par.id1, T.N.bud.color, !!T.N.ads], ["Rent", "bud", "red", false]);
  assert.equal(undoPushed, 1, "the open map's change is one step of its Undo");
  assert.equal(toasts.length, 1);
  A.edit({ key: "k2", docs: [MID], steps: [{ op: "zap" }] });
  assert.equal(J(ctx.window.parent.orosAssistAtt.rb.k2), J({ failed: 1, why: "bad" }));
  busy = true;
  A.edit({ key: "k3", docs: [MID], steps: [{ op: "rename", title: "X" }] });
  assert.equal(J(ctx.window.parent.orosAssistAtt.rb.k3), J({ failed: 1, why: "busy" }), "never while typing or dragging");
  busy = false;
  A.edit({ key: "k4", docs: ["mother"], steps: [{ op: "rename", title: "Party" }] });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(M.resolve(state, "mother").root.text, "Party");
  assert.equal(mid, "mother", "the changed map opens");
  assert.equal(undoPushed, 1);
  await A.undo({ key: "k5", tok: "mm-00" });
  assert.equal(J(ctx.window.parent.orosAssistAtt.rb.k5), J({ failed: 1, why: "gone" }));
});

test("wiring: Mind map loads the catalog on the first request and writes through its own Undo", () => {
  const app = read("mindmap/mindmap.js");
  assert.match(app, /if \(t && \(t\.edit \|\| t\.editUndo\)\) \{ assistRun\(t\); return; \}/);
  assert.match(app, /then\(function \(\) \{ return load\("commands\.js"\); \}\)\.then\(function \(\) \{ return load\("assist\.js"\); \}\)/);
  assert.match(app, /window\.MindmapAssistHost = \{/);
  assert.match(app, /begin\(""\);\n[^]*?touch\(ROW_KIND\[key\] \+ ":" \+ x\.id\)[^]*?adopt\(next\);[^]*?if \(tx\) commit\(\);/, "the change is one step of the map's Undo");
  const as = read("mindmap/assist.js");
  assert.match(as, /K\.check\(rq && rq\.steps\)/, "Mind map checks the commands again");
  assert.match(as, /fp\(stateOf\(rec\)\) !== rec\.fp/, "a changed map is not undone");
  assert.match(as, /K\.restore\(next, x\.id, x\.before, now\)/);
  const sw = read("sw.js");
  ["mindmap/commands.js", "mindmap/assist.js"].forEach((x) => assert.ok(sw.includes('"' + x + '"'), x));
  assert.ok(!read("mindmap/index.html").includes("commands.js"), "loaded on first use");
  const de = read("i18n/de/mindmap.js");
  ["as.done", "as.done1", "as.done0", "as.bad", "as.undone", "as.changed", "as.gone"].forEach((k) => {
    assert.equal((app.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k);
    assert.ok(de.includes('"' + k + '":'), k);
  });
});

test("wiring: the Assistant reads Mind map, and the card speaks of ideas in EN, EL and DE", () => {
  assert.ok(!read("assistant/index.html").includes("../mindmap/"), "loaded on first use");
  const as = read("assistant/assistant.js");
  assert.match(as, /mindmap: \["\.\.\/mindmap\/mm-core\.js", "\.\.\/mindmap\/commands\.js"\]/);
  assert.match(as, /mindmap: \{ mod: "MindmapCommands", data: "oros-mindmap-data", prefs: "oros-mindmap-prefs", open: "map", view: 1 \}/);
  assert.equal(C.EDIT_APP.mindmap.noun, "map");
  assert.equal(JSON.parse(read("apps.json")).apps.find((a) => a.id === "mindmap").search, "search.js", "so the Assistant can be allowed to read Mind map");
  const de = read("i18n/de/assistant.js");
  const has = (k) => (as.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length === 2;
  const keys = ["ed.will.mindmap", "ed.did.mindmap", "ed.sureDel.mindmap"];
  ["noIdea", "loop", "centre", "mapFull", "frameMax"].forEach((n) => keys.push("ed.note." + n));
  CMD.ORDER.forEach((op) => keys.push(has("ed.op." + op + ".mindmap") ? "ed.op." + op + ".mindmap" : "ed.op." + op));
  CMD.ORDER.forEach((op) => Object.keys(CMD.CATALOG[op].args).forEach((k) => {
    keys.push(has("ed.f." + op + "." + k) ? "ed.f." + op + "." + k : has("ed.f." + k + ".mindmap") ? "ed.f." + k + ".mindmap" : "ed.f." + k);
  }));
  Object.keys(CMD.CATALOG).forEach((op) => Object.keys(CMD.CATALOG[op].args).forEach((k) => {
    const spec = CMD.CATALOG[op].args[k];
    if (spec.t !== "enum") return;
    const pre = k === "shape" ? "ed.shp." : "ed.v." + k + ".";
    spec.v.filter(Boolean).forEach((x) => keys.push(has(pre + x + ".mindmap") ? pre + x + ".mindmap" : pre + x));
  }));
  keys.forEach((k) => {
    assert.ok(has(k), "EN + EL " + k);
    assert.ok(de.includes('"' + k + '":'), "DE " + k);
  });
  assert.match(as, /\|done\|nodesize\|sides\)\$\/\.test\(k\)\) return edT\(app, "ed\.v\."/, "the card names these values");
  assert.match(as, /\(k === "kind" && app === "mindmap"\)\) return edT\(app, "ed\.v\." \+ k \+ "\." \+ v\);/);
});

test("the catalog runs where the Assistant loads it (browser globals, no Node)", () => {
  const ctx = { window: {}, console };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  ["recipes/core.js", "mindmap/mm-core.js"].forEach((x) => vm.runInContext(read(x), ctx, { filename: x }));
  ctx.window.MMCore = ctx.MMCore;   // mm-core.js attaches to `this`, the page's window in a browser
  vm.runInContext(read("mindmap/commands.js"), ctx, { filename: "mindmap/commands.js" });
  const K = ctx.window.MindmapCommands;
  assert.ok(K && typeof K.preview === "function");
  assert.equal(K.preview(K.view(data()), [MID], K.check([{ op: "rename", title: "Y" }]).steps).n, 1);
});
