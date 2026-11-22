// ST-IMP (Chris 2026-11-21, dogfooding the podcast «Πλανόδιο»): Gate's
// studio_import and montage_import open a project file from Claude's
// folders as a NEW project. They are edit_in_app's create (studio and
// montage commands.js): only an /internal/ path of the app's own file,
// only as the one command, designs new; preview counts one made project;
// Studio's restore() takes a made project away again (Undo). Nothing
// here publishes: no feed, episode or export is reachable.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
global.window = global.window || {};
const SK = require("../studio/commands.js");
const MK = require("../montage/commands.js");
const S = require("../studio/core.js");
const AC = require("../assistant/core.js");
let R;
test.before(async () => { R = await import("../relay/gate.js"); });

test("create: only an /internal/ path of the app's own file, as the one command", () => {
  for (const [K, ext, other] of [[SK, ".orosstudio", ".orosmontage"], [MK, ".orosmontage", ".orosstudio"]]) {
    const ok = K.check([{ op: "create", from: "/internal/Claude/Planodio/Planodio-protypo" + ext, title: "Πλανόδιο" }]);
    assert.ok(ok.ok, ext);
    assert.deepEqual(ok.steps, [{ op: "create", from: "/internal/Claude/Planodio/Planodio-protypo" + ext, title: "Πλανόδιο" }]);
    assert.ok(K.check([{ op: "create", from: "/internal/a" + ext.toUpperCase() }]).ok, "the extension in any case");
    for (const bad of ["", "/internal/x" + other, "/other/x" + ext, "C:\\x" + ext, "/internal/../x" + ext, "/internal/a/../../b" + ext,
                       "/internal/a/./b" + ext, "/internal/a\\b" + ext, "/internal/a\nb" + ext, "local:Docs/x" + ext]) {
      assert.equal(K.check([{ op: "create", from: bad }]).ok, false, JSON.stringify(bad));
    }
    assert.equal(K.check([{ op: "create" }]).ok, false, "from is required");
    assert.equal(K.check([{ op: "create", from: 5 }]).ok, false);
    const two = K.check([{ op: "create", from: "/internal/a" + ext }, { op: "rename", title: "x" }]);
    assert.equal(two.ok, false);
    assert.match(two.err, /only command/);
    assert.equal(K.check([{ op: "rename", title: "x" }, { op: "create", from: "/internal/a" + ext }]).ok, false);
    assert.equal(K.CATALOG.create.kind, "new");
    assert.match(K.GUIDE, /create: open a \.oros(studio|montage) file/);
    assert.match(K.GUIDE, /nothing is published/);
  }
});

test("designs new picks nothing that exists; preview counts one new project", () => {
  for (const K of [SK, MK]) {
    assert.deepEqual(K.targets({ docs: [] }, null, "", "new", "Πλανόδιο"), { ok: true, docs: [{ id: "", name: "Πλανόδιο" }], fresh: 1 });
    const pv = K.preview({ docs: [] }, [""], [{ op: "create", from: "/internal/a.x", title: "" }]);
    assert.equal(pv.made, 1);
    assert.equal(pv.n, 0);
    assert.equal(pv.d, 0);
  }
  // edit_in_app's own check makes it designs new, named after the title
  const n = AC.normEdit({ app: "studio", steps: [{ op: "create", from: "/internal/Claude/p.orosstudio", title: "Νέο" }] }, { studio: SK });
  assert.equal(n.ok, true);
  assert.equal(n.designs, "new");
  assert.equal(n.name, "Νέο");
  assert.equal(AC.normEdit({ app: "montage", designs: "new", steps: [{ op: "rename", title: "x" }] }, { montage: MK }).ok, false);
});

test("Studio's Undo of a create takes the new project, its tracks, sources and clips away", () => {
  const now = Date.UTC(2026, 10, 21);
  let seed = 7;
  const id = (k) => S.newId(k, () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; });
  const pn = id("p"), po = id("p"), tn = id("t"), sn = id("s"), cn = id("c");
  const part = S.emptyData();
  part.projects = [S.normProject({ id: pn, m: now - 10, name: "Πλανόδιο" }), S.normProject({ id: po, m: now - 50, name: "Old" })];
  part.tracks = [S.normTrack({ id: tn, m: now - 10, p: pn, name: "Φωνή" })];
  part.sources = [S.normSource({ id: sn, m: now - 10, p: pn, name: "v", path: S.sourcePath(sn, "v", "flac"), dur: 10, ch: 1 })];
  part.clips = [S.normClip({ id: cn, m: now - 10, p: pn, t: tn, s: sn, at: 0, len: 10 })];
  const d = S.mergeStudio(S.emptyData(), part);
  assert.ok(S.find(d, "projects", pn) && S.find(d, "clips", cn) && S.find(d, "sources", sn) && S.find(d, "tracks", tn));
  const back = SK.restore(d, pn, { project: null, tracks: [], sources: [], clips: [] }, now);
  [["projects", pn], ["tracks", tn], ["sources", sn], ["clips", cn]].forEach(([k, x]) => assert.equal(S.find(back, k, x), null, k));
  assert.ok(S.find(back, "projects", po), "the other project stays");
  assert.ok(back.tombs[pn] >= now - 10);
});

test("the relay runs studio_import / montage_import as edit_in_app's create, and never publishes", () => {
  const names = R.TOOLS.map((t) => t.name);
  ["studio_import", "montage_import"].forEach((n) => {
    const t = R.TOOLS.find((x) => x.name === n);
    assert.ok(t, n);
    assert.deepEqual(t.inputSchema.required, ["path"]);
    assert.deepEqual(Object.keys(t.inputSchema.properties).sort(), ["path", "title"]);
    assert.equal(t.annotations.readOnlyHint, false);
    assert.match(t.description, /NEW/);
    assert.match(t.description, /undo/);
    assert.match(t.description, /never publishes/);
    assert.ok(names.indexOf(n) >= 0);
  });
  assert.deepEqual(R.importCall({ name: "studio_import", arguments: { path: " /internal/Claude/P.orosstudio ", title: "Πλανόδιο" } }),
    { name: "edit_in_app", arguments: { app: "studio", designs: "new", steps: [{ op: "create", from: "/internal/Claude/P.orosstudio", title: "Πλανόδιο" }] } });
  assert.deepEqual(R.importCall({ name: "montage_import", arguments: { path: "/internal/Claude/v.orosmontage" } }),
    { name: "edit_in_app", arguments: { app: "montage", designs: "new", steps: [{ op: "create", from: "/internal/Claude/v.orosmontage" }] } });
  assert.match(R.importCall({ name: "studio_import", arguments: { path: "/internal/x.orosmontage" } }).err, /Nothing was opened/);
  assert.match(R.importCall({ name: "montage_import", arguments: {} }).err, /needs path/);
  ["/internal/../x.orosstudio", "/internal/a/./x.orosstudio", "/internal/a\\x.orosstudio", "/internal/a\u0001x.orosstudio"].forEach((bad) =>
    assert.match(R.importCall({ name: "studio_import", arguments: { path: bad } }).err, /Nothing was opened/, JSON.stringify(bad)));
  assert.match(R.importCall({ name: "studio_import", arguments: { path: "/internal/x.orosstudio", title: 3 } }).err, /title/);
  assert.equal(R.importCall({ name: "edit_in_app", arguments: {} }), null);
  assert.equal(R.importCall(null), null);
  // the alias is resolved before the tool check, also inside gate_call
  const src = fs.readFileSync(path.join(__dirname, "../relay/gate.js"), "utf8");
  const at = src.indexOf("const imp = importCall(p);");
  assert.ok(at > src.indexOf('if (p.name === "gate_call")') && at < src.indexOf("TOOL_NAMES.indexOf(p.name) < 0 &&"));
  // edit_in_app's screen hold and the owner's write switch apply to it
  assert.equal(R.isScreenTool("edit_in_app", R.importCall({ name: "studio_import", arguments: { path: "/internal/a.orosstudio" } }).arguments), true);
  assert.match(R.screenRefusal("edit_in_app", { app: "studio" }, { studio: "read" }, 0, 1, "now"), /may not change studio|lets Claude change no app/);
});

test("the apps open the file through their own import, and the files of an undone create go", () => {
  const sa = fs.readFileSync(path.join(__dirname, "../studio/assist.js"), "utf8");
  const ma = fs.readFileSync(path.join(__dirname, "../montage/assist.js"), "utf8");
  const ss = fs.readFileSync(path.join(__dirname, "../studio/studio.js"), "utf8");
  const ms = fs.readFileSync(path.join(__dirname, "../montage/montage.js"), "utf8");
  [sa, ma].forEach((s) => {
    assert.match(s, /if \(chk\.ok && chk\.steps\[0\]\.op === "create"\) \{ create\(key, chk\.steps\[0\]\); return; \}/);
    assert.match(s, /made: 1, notes: \[\], tok: rec\.tok/);
    assert.doesNotMatch(s, /\bpublish\w*\(|feedXml|ghPublish|\.pub\b/i, "no publishing call");
  });
  assert.match(sa, /H\.rm\(rec\.files\)/);
  assert.match(ma, /x\.made \? C\.delProject\(next, x\.id, now\)/);
  assert.match(ss, /importFile: importPath,/);
  assert.match(ss, /function importPath\(path, title\) \{/);
  assert.match(ms, /importFile: function \(path, title\) \{/);
  ["as.made1"].forEach((k) => { assert.ok(ss.split('"' + k + '"').length >= 3, k); assert.ok(ms.split('"' + k + '"').length >= 3, k); });
});
