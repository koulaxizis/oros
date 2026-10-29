// Montage commands for the Assistant (montage/commands.js, AS-EDIT,
// wave MT1): the catalog and its guide, checking, every command on a
// real project (title texts and styles, clip settings and looks,
// transitions, order and places, new titles, cards and shapes, cuts,
// removing, project settings, renaming) through MontageCore's own
// edits, that the same list twice changes nothing more, which
// projects a request is for, the preview counts, the outline for the
// AI; applying in Montage (assist.js) with its report; and the wiring
// in Montage and the Assistant (source, card words in EN, EL and DE).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const CMD = require(path.join(ROOT, "montage/commands.js"));
const M = require(path.join(ROOT, "montage/core.js"));
const C = require(path.join(ROOT, "assistant/core.js"));
const J = (x) => JSON.stringify(x);
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const V = "a".repeat(64) + ".mp4", P = "b".repeat(64) + ".jpg", S = "c".repeat(64) + ".mp3";
// A project as Montage stores it: a video and a picture on the main
// row, a title on the text row, music and a star on the overlay row.
function data() {
  return M.merge({
    projects: {
      p1: {
        id: "p1", name: "Trip", ar: "16:9", fps: 30, bg: "#000000", m: 1, tombs: {},
        items: {
          v1: { id: "v1", k: "video", tr: "main", o: 1, src: V, len: 10, in: 0, out: 10, m: 1 },
          i1: { id: "i1", k: "image", tr: "main", o: 2, src: P, d: 4, m: 1, tx: { k: "fade", d: 0.5 } },
          t1: { id: "t1", k: "title", tr: "tt", at: 1, d: 3, text: { t: "Summer 2025", sz: 8 }, m: 1 },
          a1: { id: "a1", k: "audio", tr: "a1", at: 0, src: S, len: 30, in: 0, out: 30, m: 1 },
          s1: { id: "s1", k: "shape", tr: "ov", at: 2, d: 2, sh: { k: "star" }, m: 1 }
        }
      },
      p2: { id: "p2", name: "Birthday", ar: "9:16", fps: 30, bg: "#000000", m: 2, tombs: {}, items: {} }
    }
  }, null);
}
function run(steps, d) {
  const chk = CMD.check(steps);
  assert.ok(chk.ok, chk.err);
  const p = (d || data()).projects.p1, w = CMD.work(p);
  let seq = 0, n = 0;
  const env = { notes: [], now: 5000, newId: () => "n" + (++seq) };
  chk.steps.forEach((st) => { n += CMD.apply(w, st, env); });
  return { p: w.data.projects.p1, n, notes: env.notes, w, env, steps: chk.steps };
}

test("the guide names every command and field; the tool declares every field with one type", () => {
  CMD.ORDER.forEach((op) => {
    assert.match(CMD.GUIDE, new RegExp("\\b" + op + ":"), op);
    Object.keys(CMD.CATALOG[op].args).forEach((k) => assert.match(CMD.GUIDE, new RegExp("\\b" + k + "\\b"), op + "." + k));
  });
  const tool = C.editTool({ montage: CMD });
  const props = tool.params.properties.steps.items.properties;
  CMD.ORDER.forEach((op) => Object.keys(CMD.CATALOG[op].args).forEach((k) => assert.ok(props[k], k)));
  assert.equal(props.row.type, "string");
  assert.equal(props.speed.type, "number");
  assert.match(tool.description, /In Montage the documents are video projects/);
  assert.match(C.readAppTool(["montage"]).description, /for Montage a video project/);
  assert.deepEqual(CMD.CATALOG.clip.args.flt.v.slice(1), M.FILTERS, "the looks are Montage's own");
  assert.deepEqual(CMD.CATALOG.transition.args.trans.v.slice(2), M.TRANSITIONS);
  assert.deepEqual(CMD.CATALOG.add.args.shape.v.slice(1), M.SHAPES);
  assert.deepEqual(CMD.CATALOG.project.args.ratio.v.slice(1), M.RATIOS);
});

test("check: unknown commands, fields and values go back to the model; remove needs a pick", () => {
  assert.match(CMD.check([]).err, /empty/);
  assert.match(CMD.check([{ op: "zap" }]).err, /unknown command "zap"/);
  assert.match(CMD.check([{ op: "clip", flt: "bw" }]).err, /flt "bw" is not allowed/);
  assert.match(CMD.check([{ op: "clip", rot: 45 }]).err, /rot must be 0, 90, 180 or 270/);
  assert.match(CMD.check([{ op: "clip", speed: 9 }]).err, /speed 9 is not allowed/);
  assert.match(CMD.check([{ op: "clip", track: "main" }]).err, /track is not a field of clip/);
  assert.match(CMD.check([{ op: "project", fps: 45 }]).err, /fps must be 30 or 60/);
  assert.match(CMD.check([{ op: "project" }]).err, /give ratio, fps, back or duck/);
  assert.match(CMD.check([{ op: "transition", secs: 3 }]).err, /secs of a transition is 0\.1-2/);
  assert.match(CMD.check([{ op: "transition" }]).err, /give trans or secs/);
  assert.match(CMD.check([{ op: "remove" }]).err, /pick the clips/);
  assert.match(CMD.check([{ op: "add", what: "title" }]).err, /needs text/);
  assert.match(CMD.check([{ op: "move", ids: "v1" }]).err, /give after, time/);
  assert.match(CMD.check([{ op: "split" }]).err, /time is missing/);
  assert.match(CMD.check([{ op: "clip", ids: "V1!" }]).err, /clip ids from read_in_app/);
  assert.match(CMD.check([{ op: "textstyle", c: "red" }]).err, /c "red" is not allowed/);
  assert.match(CMD.check(new Array(41).fill({ op: "rename", title: "x" })).err, /at most 40/);
  assert.ok(CMD.check([{ op: "add", what: "shape" }]).ok, "a shape needs no text");
});

test("titles: replace, settext and textstyle; a shape takes fill and outline", () => {
  const r = run([{ op: "replace", find: "2025", repl: "2026" }, { op: "textstyle", what: "title", font: "serif", size: 10, c: "#FF0000", stroke: "#000000", fill: "#ffffff", align: "l", anim: "rise" },
    { op: "textstyle", what: "shape", fill: "#00ff00", stroke: "#0000ff" }]);
  const t = r.p.items.t1.text;
  assert.equal(t.t, "Summer 2026");
  assert.deepEqual([t.f, t.sz, t.col, t.ol, t.bx, t.al, t.an], ["serif", 10, "#ff0000", "#000000", "#ffffff", "l", "rise"]);
  assert.deepEqual([r.p.items.s1.sh.col, r.p.items.s1.sh.ol, r.p.items.s1.sh.ow], ["#00ff00", "#0000ff", 4]);
  assert.equal(r.n, 3);
  assert.equal(run([{ op: "settext", has: "summer", text: "Day one" }]).p.items.t1.text.t, "Day one");
  assert.equal(run([{ op: "replace", find: "summer", repl: "x", cs: true }]).n, 0, "match case");
});

test("clip: speed, sound, fades, look, length; only where a clip has them", () => {
  const r = run([{ op: "clip", ids: "v1", speed: 2, vol: 50, mute: "on", fi: 1, fo: 1.5, opacity: 80, flt: "vivid", fit: "fill", rot: 90, flip: "h", bright: 20, warmth: -10 },
    { op: "clip", what: "image", secs: 6 }, { op: "clip", row: "music", secs: 12, opacity: 50, flt: "mono" }]);
  const v = r.p.items.v1;
  assert.deepEqual([v.sp, v.vol, v.mu, v.fi, v.fo, v.op, v.flt, v.fit, v.rot, v.fl, v.lk.b, v.lk.t], [2, 50, true, 1, 1.5, 80, "vivid", "fill", 90, true, 20, -10]);
  assert.equal(M.placeOf(r.p, "v1").end, 5, "twice as fast is half as long");
  assert.equal(r.p.items.i1.d, 6);
  assert.equal(r.p.items.a1.out, 12, "sound is cut at the end");
  assert.equal(r.p.items.a1.op, undefined, "sound has no opacity or look");
  assert.equal(run([{ op: "clip", what: "title", speed: 2 }]).n, 0, "a title has no speed");
});

test("transitions go into main clips after the first; none removes them", () => {
  const r = run([{ op: "transition", row: "main", trans: "wipe", secs: 1 }]);
  assert.equal(r.p.items.v1.tx, null, "the first clip has nothing before it");
  assert.deepEqual(r.p.items.i1.tx, { k: "wipe", d: 1 });
  assert.equal(r.n, 1);
  assert.equal(run([{ op: "transition", ids: "i1", trans: "none" }]).p.items.i1.tx, null);
  assert.deepEqual(run([{ op: "transition", ids: "i1", secs: 2 }]).p.items.i1.tx, { k: "fade", d: 2 }, "secs alone keeps the kind");
});

test("move: main order, start times, places in % of the frame", () => {
  const r = run([{ op: "move", ids: "i1", after: "start" }, { op: "move", ids: "t1", time: 4, y: 10, w: 50 }, { op: "move", ids: "v1", x: 20 }]);
  assert.deepEqual(M.trackItems(r.p, "main").map((x) => x.id), ["i1", "v1"]);
  assert.equal(r.p.items.t1.at, 4);
  assert.deepEqual([r.p.items.t1.box.y, r.p.items.t1.box.w], [0.1, 0.5]);
  assert.equal(r.p.items.v1.box, undefined, "a main clip fills the frame");
  assert.equal(r.n, 2);
  const back = run([{ op: "move", ids: "i1", after: "v1" }]);
  assert.equal(back.n, 0, "already there");
});

test("add makes titles, cards and shapes; split cuts; remove deletes", () => {
  const r = run([{ op: "add", what: "title", text: "Hello", time: 2, secs: 2, font: "display", size: 12 }, { op: "add", what: "card", text: "The end", back: "#112233" },
    { op: "add", what: "card", text: "Intro", after: "start" }, { op: "add", what: "shape", shape: "heart", fill: "#ff0000", time: 1 }]);
  assert.deepEqual([r.p.items.n1.tr, r.p.items.n1.at, r.p.items.n1.d, r.p.items.n1.text.f, r.p.items.n1.text.sz], ["tt", 2, 2, "display", 12]);
  assert.deepEqual([r.p.items.n2.tr, r.p.items.n2.bg, r.p.items.n2.text.t], ["main", "#112233", "The end"]);
  assert.deepEqual(M.trackItems(r.p, "main").map((x) => x.id), ["n3", "v1", "i1", "n2"]);
  assert.deepEqual([r.p.items.n4.tr, r.p.items.n4.sh.k, r.p.items.n4.sh.col], ["ov", "heart", "#ff0000"]);
  assert.equal(r.n, 4);
  const s = run([{ op: "split", ids: "a1,v1", time: 5 }]);
  assert.deepEqual([s.p.items.v1.out, s.p.items.n1.in, s.p.items.n1.tr], [5, 5, "main"], "picked in timeline order: the main row first");
  assert.deepEqual([s.p.items.a1.out, s.p.items.n2.in, s.p.items.n2.at], [5, 5, 5]);
  assert.equal(s.n, 4);
  const edge = run([{ op: "split", ids: "a1", time: 0 }]);
  assert.equal(edge.n, 0);
  assert.deepEqual(edge.notes, ["noClips"]);
  const del = run([{ op: "remove", what: "shape" }, { op: "remove", has: "summer" }]);
  assert.deepEqual(Object.keys(del.p.items).sort(), ["a1", "i1", "v1"]);
  assert.ok(del.p.tombs.s1 && del.p.tombs.t1, "deletions are tombstones, so they sync");
});

test("project settings and rename go through MontageCore", () => {
  const r = run([{ op: "project", ratio: "9:16", fps: 60, back: "#222222", duck: 30 }, { op: "rename", title: "Trip 2026" }]);
  assert.deepEqual([r.p.ar, r.p.fps, r.p.bg, r.p.dk, r.p.name], ["9:16", 60, "#222222", 30, "Trip 2026"]);
  assert.equal(r.n, 2);
  assert.equal(run([{ op: "project", ratio: "16:9" }]).n, 0, "already so");
});

test("the same list twice changes nothing more; every edit is stamped newer", () => {
  const steps = [{ op: "replace", find: "2025", repl: "2026" }, { op: "textstyle", what: "title", size: 12 }, { op: "clip", ids: "v1", speed: 2, flt: "noir" },
    { op: "transition", ids: "i1", trans: "zoom" }, { op: "move", ids: "i1", after: "start" }, { op: "project", duck: 20 }, { op: "rename", title: "Again" }, { op: "remove", what: "shape" }];
  const r = run(steps);
  assert.ok(r.n > 0);
  let again = 0;
  r.steps.forEach((st) => { again += CMD.apply(r.w, st, r.env); });
  assert.equal(again, 0);
  assert.ok(r.p.items.v1.m > 1 && r.p.m > 1, "stamped, so sync takes them");
  assert.equal(M.merge(data(), r.w.data).projects.p1.items.v1.flt, "noir", "merging into the app's data keeps the change");
});

test("view, targets, preview and the outline for the AI", () => {
  const vw = CMD.view(data());
  assert.deepEqual(vw.docs.map((d) => d.name), ["Birthday", "Trip"], "newest first");
  assert.equal(CMD.view(null).docs.length, 0);
  assert.deepEqual(CMD.targets(vw, null, "p1", "open").docs, [{ id: "p1", name: "Trip" }]);
  assert.match(CMD.targets(vw, null, "", "open").err, /no project is open/);
  assert.deepEqual(CMD.targets(vw, null, "", "named", "trip").docs.map((d) => d.id), ["p1"]);
  assert.match(CMD.targets(vw, null, "", "named", "zzz").err, /no project is called "zzz"; projects: "Birthday", "Trip"/);
  assert.equal(CMD.targets(vw, null, "", "all").docs.length, 2);
  assert.match(CMD.targets(vw, null, "", "new").err, /made in Montage itself/);
  assert.match(CMD.targets(vw, null, "", "folder").err, /no folders/);
  const pv = CMD.preview(vw, ["p1", "p2"], CMD.check([{ op: "add", what: "title", text: "Hi" }, { op: "rename", title: "X" }]).steps);
  assert.deepEqual([pv.n, pv.d, pv.per.map((x) => x.n)], [4, 2, [2, 2]]);
  assert.equal(vw.docs[1].store.items.n1, undefined, "the preview works on copies");
  const o = CMD.outline(vw.docs[1]);
  assert.deepEqual([o.name, o.ratio, o.fps, o.length], ["Trip", "16:9", 30, 30]);
  assert.deepEqual(o.clips.map((c) => c.id + ":" + c.row), ["v1:main", "i1:main", "s1:overlay", "t1:text", "a1:music"]);
  assert.deepEqual(o.clips[1], { id: "i1", kind: "image", row: "main", start: 9.5, end: 13.5, fit: "fit", transition: { trans: "fade", secs: 0.5 } });
  assert.deepEqual([o.clips[3].text, o.clips[3].size, o.clips[3].box], ["Summer 2025", 8, { x: 5, y: 72, w: 90, h: 20 }]);
  assert.deepEqual([o.clips[2].shape, o.clips[2].fill], ["star", "#f8d14a"]);
});

test("Montage applies the commands, merges them into its data and reports to the card", async () => {
  const ctx = { window: {}, console, JSON, Promise, Math, Date, Uint8Array, document: { querySelector: () => null } };
  ctx.window.window = ctx.window;
  ctx.window.parent = { orosAssistAtt: { rb: {} } };
  vm.createContext(ctx);
  ["recipes/core.js", "montage/core.js", "montage/commands.js"].forEach((x) => vm.runInContext(read(x), ctx, { filename: x }));
  let state = data(), pid = "p1", undoPushed = 0, seq = 0;
  const toasts = [];
  ctx.window.MontageAssistHost = {
    t: (k, v) => k + (v ? J(v) : ""), uid: () => "x" + (++seq), toast: (s) => toasts.push(s), undoToast: (s) => toasts.push("undo:" + s),
    data: () => state, pid: () => pid, open: (id) => { pid = id; },
    set: (next, withUndo) => { if (withUndo) undoPushed++; state = next; }
  };
  ctx.indexedDB = { open() { throw new Error("no IndexedDB here"); } };
  vm.runInContext(read("montage/assist.js"), ctx, { filename: "montage/assist.js" });
  const A = ctx.window.MontageAssist;
  A.edit({ key: "k1", docs: ["p1", "nope"], steps: [{ op: "replace", find: "2025", repl: "2026" }, { op: "add", what: "card", text: "End" }, { op: "remove", what: "shape" }] });
  await new Promise((r) => setTimeout(r, 20));
  const rep = ctx.window.parent.orosAssistAtt.rb.k1;
  assert.deepEqual([rep.ok, rep.n, rep.d, rep.per[0].name], [1, 3, 1, "Trip"]);
  assert.match(rep.tok, /^mt-[0-9a-f]{18}$/);
  assert.equal(state.projects.p1.items.t1.text.t, "Summer 2026");
  assert.equal(state.projects.p1.items.x1.text.t, "End", "new clips get the app's own ids");
  assert.ok(!state.projects.p1.items.s1 && state.projects.p1.tombs.s1);
  assert.equal(undoPushed, 1, "the open project's change is one step of Montage's Undo");
  assert.deepEqual(toasts, ['undo:as.done1{"n":3}']);
  A.edit({ key: "k2", docs: ["p1"], steps: [{ op: "zap" }] });
  assert.deepEqual(J(ctx.window.parent.orosAssistAtt.rb.k2), J({ failed: 1, why: "bad" }));
  A.edit({ key: "k3", docs: ["p2"], steps: [{ op: "rename", title: "Party" }] });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(state.projects.p2.name, "Party");
  assert.equal(pid, "p2", "the changed project opens");
  assert.equal(undoPushed, 1, "another project's change is not on the open one's Undo");
  await A.undo({ key: "k4", tok: "mt-00" });
  assert.deepEqual(J(ctx.window.parent.orosAssistAtt.rb.k4), J({ failed: 1, why: "gone" }));
});

test("undo puts the project back with MontageCore.restoreProject, newer than the change", () => {
  const before = data(), r = run([{ op: "remove", what: "shape" }, { op: "rename", title: "X" }, { op: "add", what: "title", text: "New" }]);
  const after = M.merge(before, r.w.data);
  const back = M.restoreProject(after, "p1", before.projects.p1, 9000);
  const p = back.projects.p1;
  assert.equal(p.name, "Trip");
  assert.ok(p.items.s1 && !p.items.n1, "the shape is back, the new title gone");
  assert.equal(M.merge(after, back).projects.p1.items.s1.sh.k, "star", "and it wins a merge with the changed copy");
});

test("wiring: Montage loads the catalog on the first request and keeps the open project for the Assistant", () => {
  const app = read("montage/montage.js");
  assert.match(app, /if \(target\.edit \|\| target\.editUndo\) \{ assistRun\(target\); return; \}/);
  assert.match(app, /then\(function \(\) \{ return load\("commands\.js"\); \}\)\.then\(function \(\) \{ return load\("assist\.js"\); \}\)/);
  assert.match(app, /window\.MontageAssistHost = \{/);
  assert.match(app, /pid = id; sel = null; undoStack = \[\]; redoStack = \[\]; tNow = 0;\n\s+noteOpen\(id\);/);
  assert.match(app, /view = "home"; pid = null;[^\n]*\n\s+noteOpen\(null\);/);
  const as = read("montage/assist.js");
  assert.match(as, /K\.check\(rq && rq\.steps\)/, "Montage checks the commands again");
  assert.match(as, /fp\(stateOf\(rec\)\) !== rec\.fp/, "a changed project is not undone");
  assert.match(as, /C\.restoreProject\(next, x\.id, x\.before, now\)/);
  const sw = read("sw.js");
  ["montage/commands.js", "montage/assist.js"].forEach((x) => assert.ok(sw.includes('"' + x + '"'), x));
  assert.ok(!read("montage/index.html").includes("commands.js"), "loaded on first use");
  const de = read("i18n/de/montage.js");
  ["as.done", "as.done1", "as.done0", "as.bad", "as.undone", "as.changed", "as.gone"].forEach((k) => {
    assert.equal((app.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k);
    assert.ok(de.includes('"' + k + '":'), k);
  });
});

test("wiring: the Assistant reads Montage, and the card speaks of clips in EN, EL and DE", () => {
  assert.ok(!read("assistant/index.html").includes("../montage/"), "loaded on first use");
  const as = read("assistant/assistant.js");
  assert.match(as, /montage: \["\.\.\/montage\/core\.js", "\.\.\/montage\/commands\.js"\]/);
  assert.match(as, /montage: \{ mod: "MontageCommands", data: "oros-montage", prefs: "oros-montage-prefs", open: "open", view: 1 \}/);
  assert.equal(C.EDIT_APP.montage.noun, "project");
  const de = read("i18n/de/assistant.js");
  const has = (k) => (as.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length === 2;
  const keys = ["ed.will.montage", "ed.did.montage", "ed.sureDel.montage", "ed.v.fit.fit.montage", "ed.v.trans.wipe.montage", "ed.f.after.start"];
  ["noClips", "maxClips", "ramp"].forEach((n) => keys.push("ed.note." + n));
  CMD.ORDER.forEach((op) => keys.push(has("ed.op." + op + ".montage") ? "ed.op." + op + ".montage" : "ed.op." + op));
  CMD.ORDER.forEach((op) => Object.keys(CMD.CATALOG[op].args).forEach((k) => {
    if (op === "add" && k === "what") return;          // add's kind reads without a label
    keys.push(has("ed.f." + k + ".montage") ? "ed.f." + k + ".montage" : "ed.f." + k);
  }));
  Object.keys(CMD.CATALOG).forEach((op) => Object.keys(CMD.CATALOG[op].args).forEach((k) => {
    const spec = CMD.CATALOG[op].args[k];
    if (spec.t !== "enum" || k === "ratio") return;   // ratios read as they are (16:9)
    const pre = k === "font" ? "ed.v.font." : k === "flt" ? "ed.flt." : k === "shape" ? "ed.shp." : op === "add" && k === "what" ? "ed.v.add." : "ed.v." + k + ".";
    spec.v.filter(Boolean).forEach((x) => keys.push(pre + x));
  }));
  keys.forEach((k) => {
    assert.ok(has(k), "EN + EL " + k);
    assert.ok(de.includes('"' + k + '":'), "DE " + k);
  });
  assert.match(as, /\|each\|row\|mute\)\$\/\.test\(k\)\) return edT\(app, "ed\.v\."/, "the card names these values, in the app's own words");
});

test("the catalog runs where the Assistant loads it (browser globals, no Node)", () => {
  const ctx = { window: {}, console };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  ["recipes/core.js", "montage/core.js", "montage/commands.js"].forEach((x) => vm.runInContext(read(x), ctx, { filename: x }));
  const K = ctx.window.MontageCommands;
  assert.ok(K && typeof K.preview === "function");
  const vw = K.view(data());
  assert.equal(K.preview(vw, ["p1"], K.check([{ op: "rename", title: "Y" }]).steps).n, 1);
});
