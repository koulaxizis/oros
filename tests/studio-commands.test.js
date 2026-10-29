// Studio commands for the Assistant (studio/commands.js, AS-EDIT,
// wave ST1): the catalog and its guide, checking, every command on a
// real song project (clip gain, fades, places and lengths, cuts, MIDI
// notes, removing; track volume, pan, mute, solo, colour, name and
// order; new and deleted tracks; tempo with MIDI clips keeping their
// bars, beats in a bar, master, loop; renaming) with newer stamps,
// undo back to the earlier copy, which projects a request is for, the
// preview counts, the outline for the AI; applying in Studio
// (assist.js) with its report; and the wiring in Studio and the
// Assistant (source, card words in EN, EL and DE).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const CMD = require(path.join(ROOT, "studio/commands.js"));
const S = require(path.join(ROOT, "studio/core.js"));
const C = require(path.join(ROOT, "assistant/core.js"));
const J = (x) => JSON.stringify(x);
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const PID = "pabcdef1";
// A song as Studio stores it: drums and keys (instrument tracks with
// MIDI clips) and a vocal take, at 120 BPM in 4/4 (a bar = 2 s), and a
// second, empty project.
function data() {
  return S.mergeStudio({
    projects: [{ id: PID, m: 1, name: "Song", bpm: 120, sig: 4 }, { id: "pother01", m: 2, name: "Demo", bpm: 90, sig: 3 }],
    tracks: [{ id: "tdrums01", m: 1, p: PID, name: "Drums", ord: 0, inst: "drums" }, { id: "tvocal01", m: 1, p: PID, name: "Vocals", ord: 1 },
      { id: "tkeys001", m: 1, p: PID, name: "Keys", ord: 2, inst: "piano", fx: [{ u: "fabcdef1", id: "reverb", s: { 1: 0.3 } }] }],
    sources: [{ id: "svox0001", m: 1, p: PID, name: "Take 1", path: "/internal/Studio/audio/take1.wav", dur: 20 }],
    clips: [{ id: "cvox0001", m: 1, p: PID, t: "tvocal01", s: "svox0001", at: 2, off: 0, len: 8 },
      { id: "ckeys001", m: 1, p: PID, t: "tkeys001", at: 0, off: 0, len: 8, n: [[60, 0, 1, 100], [64, 3, 1, 90]] },
      { id: "cdrum001", m: 1, p: PID, t: "tdrums01", at: 0, off: 0, len: 8, n: [[36, 0, 0.5, 100]] }],
    tombs: {}
  }, null);
}
function run(steps, d) {
  const chk = CMD.check(steps);
  assert.ok(chk.ok, chk.err);
  const w = CMD.work(d || data(), PID);
  let seq = 0, n = 0;
  const env = { notes: [], now: 5000, newId: (k) => k + "new000" + (++seq) };
  chk.steps.forEach((st) => { n += CMD.apply(w, st, env); });
  const f = (key, id) => S.find(w.data, key, id);
  return { w, n, notes: env.notes, env, steps: chk.steps, p: f("projects", PID), tr: (id) => f("tracks", id), c: (id) => f("clips", id) };
}

test("the guide names every command and field; the tool declares every field with one type", () => {
  CMD.ORDER.forEach((op) => {
    assert.match(CMD.GUIDE, new RegExp("\\b" + op + ":"), op);
    Object.keys(CMD.CATALOG[op].args).forEach((k) => assert.match(CMD.GUIDE, new RegExp("\\b" + k + "\\b"), op + "." + k));
  });
  const tool = C.editTool({ studio: CMD });
  const props = tool.params.properties.steps.items.properties;
  CMD.ORDER.forEach((op) => Object.keys(CMD.CATALOG[op].args).forEach((k) => assert.ok(props[k], k)));
  assert.equal(props.tracks.type, "string");
  assert.equal(props.bpm.type, "number");
  assert.match(tool.description, /In Studio the documents are song projects/);
  assert.match(C.readAppTool(["studio"]).description, /for Studio a song project/);
  const midi = read("studio/midi.js");
  assert.equal(J(CMD.INSTS), J(JSON.parse(/var ORDER = (\[[^\]]*\])/.exec(midi)[1])), "the instruments are Studio's own");
});

test("check: unknown commands, fields and values go back to the model; removals need a pick", () => {
  assert.match(CMD.check([]).err, /empty/);
  assert.match(CMD.check([{ op: "zap" }]).err, /unknown command "zap"/);
  assert.match(CMD.check([{ op: "track", vol: 20 }]).err, /vol 20 is not allowed/);
  assert.match(CMD.check([{ op: "track", track: 2 }]).err, /track is not a field of track/);
  assert.match(CMD.check([{ op: "project", bpm: 500 }]).err, /bpm 500 is not allowed/);
  assert.match(CMD.check([{ op: "project", bars: "five" }]).err, /bars must be like "5-8"/);
  assert.match(CMD.check([{ op: "project" }]).err, /give bpm, sig, vol, loop or bars/);
  assert.match(CMD.check([{ op: "remove" }]).err, /pick the clips/);
  assert.match(CMD.check([{ op: "deltrack" }]).err, /pick the tracks/);
  assert.match(CMD.check([{ op: "split", tracks: "1" }]).err, /give time or bar/);
  assert.match(CMD.check([{ op: "clip", time: 1, bar: 2 }]).err, /time or bar, not both/);
  assert.match(CMD.check([{ op: "notes" }]).err, /give semis or vel/);
  assert.match(CMD.check([{ op: "addtrack", inst: "bass" }]).err, /inst is for a midi track/);
  assert.match(CMD.check([{ op: "clip", ids: "C1!" }]).err, /clip ids from read_in_app/);
  assert.match(CMD.check([{ op: "rename" }]).err, /title is missing/);
  assert.match(CMD.check(new Array(41).fill({ op: "rename", title: "x" })).err, /at most 40/);
});

test("tracks: volume, pan, mute, solo, nearest colour, name; picked by number, name or kind", () => {
  const r = run([{ op: "track", tracks: "vocals", vol: -6, pan: -20, mute: "on", c: "#00ff00", title: "Lead vox" }, { op: "track", what: "midi", solo: "on" }]);
  const v = r.tr("tvocal01");
  assert.deepEqual([v.vol, v.pan, v.mute, v.color, v.name], [-6, -20, true, "#87cf3e", "Lead vox"]);
  assert.deepEqual([r.tr("tdrums01").solo, r.tr("tkeys001").solo, v.solo], [true, true, false]);
  assert.equal(r.n, 3);
  assert.equal(run([{ op: "track", tracks: "1,3", vol: -3 }]).tr("tkeys001").vol, -3, "by number from the top");
  const miss = run([{ op: "track", tracks: "Bass", vol: -3 }]);
  assert.equal(miss.n, 0);
  assert.deepEqual(miss.notes, ["noTrack", "noTracks"]);
});

test("tracks move with after; new tracks at the bottom; deleting a track takes its clips", () => {
  const r = run([{ op: "track", tracks: "keys", after: "start" }, { op: "addtrack", what: "midi", inst: "bass", c: "#4fc4cf" }, { op: "addtrack", title: "Guitar" }]);
  assert.deepEqual(S.tracksOf(r.w.data, PID).map((t) => t.name), ["Keys", "Drums", "Vocals", "bass", "Guitar"]);
  assert.deepEqual([r.tr("tnew0001").inst, r.tr("tnew0001").color, r.tr("tnew0002").inst], ["bass", "#4fc4cf", undefined]);
  const named = CMD.work(data(), PID);
  CMD.apply(named, CMD.check([{ op: "addtrack", what: "midi" }]).steps[0], { now: 5000, newId: (k) => k + "zz00001", trackName: (n, inst) => inst + " #" + n });
  assert.equal(S.find(named.data, "tracks", "tzz00001").name, "piano #4", "Studio names it in the user's language");
  const d = run([{ op: "deltrack", tracks: "drums" }]);
  assert.ok(!d.tr("tdrums01") && !d.c("cdrum001") && d.w.data.tombs.tdrums01 && d.w.data.tombs.cdrum001, "deletions are tombstones, so they sync");
  assert.equal(d.n, 2);
  const full = run(new Array(6).fill({ op: "addtrack" }));
  assert.equal(S.tracksOf(full.w.data, PID).length, S.MAX_TRACKS);
  assert.deepEqual(full.notes, ["maxTracks"]);
});

test("clips: gain, fades, start by time or bar, length within the recording; split and remove", () => {
  const r = run([{ op: "clip", ids: "cvox0001", gain: 3, fi: 1, fo: 2, bar: 3, secs: 30 }]);
  const c = r.c("cvox0001");
  assert.deepEqual([c.gain, c.fi, c.fo, c.at, c.len], [3, 1, 2, 4, 20]);
  assert.deepEqual(r.notes, ["short"], "audio cannot run past its file");
  assert.equal(run([{ op: "clip", what: "midi", secs: 12 }]).c("ckeys001").len, 12, "a MIDI clip can grow");
  const s = run([{ op: "split", tracks: "keys,vocals", bar: 3 }]);
  assert.deepEqual([s.c("cvox0001").len, s.c("cnew0001").at, s.c("cnew0001").off], [2, 4, 2], "tracks in their order: vocals, then keys");
  assert.deepEqual([s.c("ckeys001").n.length, s.c("cnew0002").n.length], [2, 0], "each half keeps the notes that start in it");
  assert.equal(s.n, 4);
  assert.deepEqual(run([{ op: "split", ids: "cvox0001", time: 30 }]).notes, ["noClips"]);
  const del = run([{ op: "remove", has: "take" }]);
  assert.ok(!del.c("cvox0001") && del.w.data.tombs.cvox0001);
  assert.ok(del.w.data.sources.length, "the recording stays (Studio removes files with the project)");
});

test("notes: transpose and velocity; drum tracks keep their notes", () => {
  const r = run([{ op: "notes", what: "midi", semis: 2, vel: 80 }]);
  assert.deepEqual(r.c("ckeys001").n, [[62, 0, 1, 80], [66, 3, 1, 80]]);
  assert.deepEqual(r.c("cdrum001").n, [[36, 0, 0.5, 80]]);
  assert.deepEqual(r.notes, ["drums"]);
  assert.equal(r.n, 2);
  assert.deepEqual(run([{ op: "notes", tracks: "keys", semis: 24 }, { op: "notes", tracks: "keys", semis: 24 }, { op: "notes", tracks: "keys", semis: 24 }]).notes, ["range"]);
});

test("project: tempo keeps MIDI clips on their bars, audio in time; beats, master, loop by bars; rename", () => {
  const r = run([{ op: "project", bpm: 100, sig: 3, vol: -2, bars: "2-3" }, { op: "rename", title: "Song 2" }]);
  assert.deepEqual([r.p.bpm, r.p.sig, r.p.vol, r.p.name], [100, 3, -2, "Song 2"]);
  assert.deepEqual(r.p.loop, { on: true, a: 1.8, b: 5.4 }, "a bar of 3 beats at 100 BPM is 1.8 s");
  assert.deepEqual([r.c("ckeys001").len, r.c("ckeys001").n[1][1]], [9.6, 3.6]);
  assert.deepEqual([r.c("cvox0001").at, r.c("cvox0001").len], [2, 8]);
  assert.equal(r.n, 4, "the project, two MIDI clips and the name… counted once each");
  assert.equal(run([{ op: "project", loop: "off" }]).n, 0, "already off");
  assert.deepEqual(run([{ op: "project", loop: "on" }]).notes, ["noLoop"]);
});

test("the same list twice changes nothing more; every edit is stamped newer; undo restores the copy", () => {
  const steps = [{ op: "track", tracks: "vocals", vol: -6, mute: "on" }, { op: "clip", ids: "cvox0001", gain: 2, time: 4 }, { op: "notes", tracks: "keys", vel: 70 },
    { op: "project", vol: -1, loop: "on", bars: "1-2" }, { op: "rename", title: "Again" }, { op: "remove", tracks: "drums" }];
  const r = run(steps);
  assert.ok(r.n > 0);
  let again = 0;
  r.steps.forEach((st) => { again += CMD.apply(r.w, st, r.env); });
  assert.equal(again, 0);
  assert.ok(r.tr("tvocal01").m > 1 && r.p.m > 1, "stamped, so sync takes them");
  const before = data(), after = S.mergeStudio(before, r.w.data);
  assert.equal(S.find(after, "clips", "cvox0001").gain, 2, "merging into the app's data keeps the change");
  const back = CMD.restore(after, PID, CMD.snapshot(before, PID), 9000);
  const strip = (x) => JSON.stringify(CMD.snapshot(x, PID), (k, v) => (k === "m" ? undefined : v));
  assert.equal(strip(back), strip(before));
  assert.ok(S.find(back, "clips", "cdrum001").m > after.tombs.cdrum001, "a removed clip comes back newer than its tombstone");
  assert.equal(S.find(S.mergeStudio(after, back), "projects", PID).name, "Song", "and wins a merge with the changed copy");
});

test("view, targets, preview and the outline for the AI", () => {
  const vw = CMD.view(data());
  assert.deepEqual(vw.docs.map((d) => d.name), ["Demo", "Song"], "newest first");
  assert.equal(CMD.view(null).docs.length, 0);
  assert.deepEqual(CMD.targets(vw, null, PID, "open").docs, [{ id: PID, name: "Song" }]);
  assert.deepEqual(CMD.targets(vw, null, "", "open").docs.map((d) => d.id), ["pother01"], "Studio opens the newest when none was open");
  assert.match(CMD.targets(vw, null, "pgone001", "open").err, /no project is open/);
  assert.deepEqual(CMD.targets(vw, null, "", "named", "song").docs.map((d) => d.id), [PID]);
  assert.match(CMD.targets(vw, null, "", "named", "zzz").err, /no project is called "zzz"; projects: "Demo", "Song"/);
  assert.equal(CMD.targets(vw, null, "", "all").docs.length, 2);
  assert.match(CMD.targets(vw, null, "", "new").err, /made in Studio itself/);
  const pv = CMD.preview(vw, [PID, "pother01"], CMD.check([{ op: "addtrack" }, { op: "rename", title: "X" }]).steps);
  assert.deepEqual([pv.n, pv.d, pv.per.map((x) => x.n)], [4, 2, [2, 2]]);
  assert.equal(vw.docs[1].store.tracks.length, 3, "the preview works on copies");
  const o = CMD.outline(vw.docs[1]);
  assert.deepEqual([o.name, o.bpm, o.sig, o.length, o.barSecs], ["Song", 120, 4, 10, 2]);
  assert.deepEqual(o.tracks.map((t) => t.n + ":" + t.name + ":" + t.kind), ["1:Drums:midi", "2:Vocals:audio", "3:Keys:midi"]);
  assert.deepEqual(o.tracks[2].effects, ["reverb"]);
  assert.deepEqual(o.clips[1], { id: "cvox0001", track: 2, kind: "audio", name: "Take 1", start: 2, end: 10, bar: 2 });
  assert.deepEqual([o.clips[2].notes, o.clips[2].range], [2, "C4-E4"]);
});

test("Studio applies the commands, merges them into its data and reports to the card", async () => {
  const ctx = { window: {}, console, JSON, Promise, Math, Date, Uint8Array, document: { querySelector: () => null } };
  ctx.window.window = ctx.window;
  ctx.window.parent = { orosAssistAtt: { rb: {} } };
  vm.createContext(ctx);
  ["recipes/core.js", "studio/core.js", "studio/commands.js"].forEach((x) => vm.runInContext(read(x), ctx, { filename: x }));
  let state = data(), pid = PID, undoPushed = 0, busy = false;
  const toasts = [];
  ctx.window.StudioAssistHost = {
    t: (k, v) => k + (v ? J(v) : ""), toast: (s) => toasts.push(s), undoToast: (s) => toasts.push("undo:" + s),
    data: () => state, pid: () => pid, busy: () => busy, open: (id) => { pid = id; },
    set: (next, withUndo) => { if (withUndo) undoPushed++; state = next; }
  };
  ctx.indexedDB = { open() { throw new Error("no IndexedDB here"); } };
  vm.runInContext(read("studio/assist.js"), ctx, { filename: "studio/assist.js" });
  const A = ctx.window.StudioAssist;
  A.edit({ key: "k1", docs: [PID, "nope"], steps: [{ op: "track", tracks: "vocals", vol: -6 }, { op: "addtrack", what: "midi" }, { op: "remove", tracks: "drums" }] });
  await new Promise((r) => setTimeout(r, 20));
  const rep = ctx.window.parent.orosAssistAtt.rb.k1;
  assert.deepEqual([rep.ok, rep.n, rep.d, rep.per[0].name], [1, 3, 1, "Song"]);
  assert.match(rep.tok, /^st-[0-9a-f]{18}$/);
  assert.equal(S.find(state, "tracks", "tvocal01").vol, -6);
  const added = S.tracksOf(state, PID)[3];
  assert.match(added.id, /^t[a-z0-9]{12}$/);
  assert.equal(added.name, "snd.piano", "named in the user's language");
  assert.ok(!S.find(state, "clips", "cdrum001") && state.tombs.cdrum001);
  assert.equal(undoPushed, 1, "the open project's change is one step of Studio's Undo");
  assert.deepEqual(toasts, ['undo:as.done1{"n":3}']);
  A.edit({ key: "k2", docs: [PID], steps: [{ op: "zap" }] });
  assert.equal(J(ctx.window.parent.orosAssistAtt.rb.k2), J({ failed: 1, why: "bad" }));
  busy = true;
  A.edit({ key: "k3", docs: [PID], steps: [{ op: "rename", title: "X" }] });
  assert.equal(J(ctx.window.parent.orosAssistAtt.rb.k3), J({ failed: 1, why: "busy" }), "never while recording or dragging");
  busy = false;
  A.edit({ key: "k4", docs: ["pother01"], steps: [{ op: "rename", title: "Party" }] });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(S.find(state, "projects", "pother01").name, "Party");
  assert.equal(pid, "pother01", "the changed project opens");
  assert.equal(undoPushed, 1);
  await A.undo({ key: "k5", tok: "st-00" });
  assert.equal(J(ctx.window.parent.orosAssistAtt.rb.k5), J({ failed: 1, why: "gone" }));
});

test("wiring: Studio loads the catalog on the first request and writes through its own state", () => {
  const app = read("studio/studio.js");
  assert.match(app, /if \(tg\.edit \|\| tg\.editUndo\) \{ assistRun\(tg\); return; \}/);
  assert.match(app, /then\(function \(\) \{ return load\("commands\.js"\); \}\)\.then\(function \(\) \{ return load\("assist\.js"\); \}\)/);
  assert.match(app, /window\.StudioAssistHost = \{/);
  assert.match(app, /if \(withUndo\) \{\n\s+undoStack\.push\(snapshot\(\)\);/, "the change is one step of Studio's Undo");
  const as = read("studio/assist.js");
  assert.match(as, /K\.check\(rq && rq\.steps\)/, "Studio checks the commands again");
  assert.match(as, /fp\(stateOf\(rec\)\) !== rec\.fp/, "a changed project is not undone");
  assert.match(as, /K\.restore\(next, x\.id, x\.before, now\)/);
  const sw = read("sw.js");
  ["studio/commands.js", "studio/assist.js"].forEach((x) => assert.ok(sw.includes('"' + x + '"'), x));
  assert.ok(!read("studio/index.html").includes("commands.js"), "loaded on first use");
  const de = read("i18n/de/studio.js");
  ["as.done", "as.done1", "as.done0", "as.bad", "as.undone", "as.changed", "as.gone"].forEach((k) => {
    assert.equal((app.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k);
    assert.ok(de.includes('"' + k + '":'), k);
  });
});

test("wiring: the Assistant reads Studio, and the card speaks of tracks and clips in EN, EL and DE", () => {
  assert.ok(!read("assistant/index.html").includes("../studio/"), "loaded on first use");
  const as = read("assistant/assistant.js");
  assert.match(as, /studio: \["\.\.\/studio\/core\.js", "\.\.\/studio\/commands\.js"\]/);
  assert.match(as, /studio: \{ mod: "StudioCommands", data: "oros-studio-data", prefs: "oros-studio-prefs", open: "cur", view: 1 \}/);
  assert.match(as, /s\.op === "remove" \|\| s\.op === "delpages" \|\| s\.op === "deltrack"/, "deleting tracks asks once more");
  assert.equal(C.EDIT_APP.studio.noun, "project");
  const de = read("i18n/de/assistant.js");
  const has = (k) => (as.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length === 2;
  const keys = ["ed.will.studio", "ed.did.studio", "ed.sureDel.studio"];
  ["noTrack", "noTracks", "maxTracks", "noClips", "maxClips", "short", "drums", "range", "noLoop"].forEach((n) => keys.push("ed.note." + n));
  CMD.ORDER.forEach((op) => keys.push(has("ed.op." + op + ".studio") ? "ed.op." + op + ".studio" : "ed.op." + op));
  CMD.ORDER.forEach((op) => Object.keys(CMD.CATALOG[op].args).forEach((k) => {
    if (op === "addtrack" && k === "what") return;     // the kind of a new track reads without a label
    keys.push(has("ed.f." + k + ".studio") ? "ed.f." + k + ".studio" : "ed.f." + k);
  }));
  Object.keys(CMD.CATALOG).forEach((op) => Object.keys(CMD.CATALOG[op].args).forEach((k) => {
    const spec = CMD.CATALOG[op].args[k];
    if (spec.t !== "enum") return;
    const pre = op === "addtrack" && k === "what" ? "ed.v.add." : "ed.v." + k + ".";
    spec.v.filter(Boolean).forEach((x) => keys.push(has(pre + x + ".studio") ? pre + x + ".studio" : pre + x));
  }));
  keys.forEach((k) => {
    assert.ok(has(k), "EN + EL " + k);
    assert.ok(de.includes('"' + k + '":'), "DE " + k);
  });
  assert.match(as, /\|mute\|solo\|loop\|inst[a-z|]*\)\$\/\.test\(k\)\) return edT\(app, "ed\.v\."/, "the card names these values");
  assert.match(as, /\(\(st\.op === "add" \|\| st\.op === "addtrack"\) && k === "what"\)/);
});

test("the catalog runs where the Assistant loads it (browser globals, no Node)", () => {
  const ctx = { window: {}, console };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  ["recipes/core.js", "studio/core.js", "studio/commands.js"].forEach((x) => vm.runInContext(read(x), ctx, { filename: x }));
  const K = ctx.window.StudioCommands;
  assert.ok(K && typeof K.preview === "function");
  assert.equal(K.preview(K.view(data()), [PID], K.check([{ op: "rename", title: "Y" }]).steps).n, 1);
});

test("search: Studio's projects are found by name and track names, and open as a project", () => {
  const P = require(path.join(ROOT, "studio/search.js"));
  const d = data();
  d.projects.push({ id: "pgone0001", m: 3, name: "Gone", bpm: 120, sig: 4 });
  d.tombs.pgone0001 = 4;
  const hits = P.search({ readJSON: (k) => (k === "oros-studio-data" ? d : null), lang: "en" });
  assert.deepEqual(hits.map((h) => h.title).sort(), ["Demo", "Song"], "deleted projects are not found");
  const song = hits.find((h) => h.id === PID);
  assert.equal(song.text, "Drums · Vocals · Keys");
  assert.deepEqual(song.target, { project: PID });
  const apps = JSON.parse(read("apps.json")).apps.find((a) => a.id === "studio");
  assert.equal(apps.search, "search.js", "so the Assistant can be allowed to read Studio");
  assert.match(read("studio/studio.js"), /if \(typeof tg\.project === "string"\)/);
  assert.ok(read("sw.js").includes('"studio/search.js"'));
});
