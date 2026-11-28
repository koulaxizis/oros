// GL-1 (2026-11-21): a device where Layout never ran has no index of its
// own; the Gate reads the synced document files from the orOS disk.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "assistant/assistant.js"), "utf8");
const a = src.indexOf("  var DISK_DIRS = {"), b = src.indexOf("  // Reads the doc.json of the given projects");
assert.ok(a > 0 && b > a, "GL-1 block found");

function box(files, store) {
  const ls = (dir) => Promise.resolve(dir === "/internal/Layout" ? Object.keys(files).map((n) => ({ name: n, mtime: 5 })) : []);
  const read = (p) => Promise.resolve({ size: files[p.slice(17)].length, text: () => Promise.resolve(files[p.slice(17)]) });
  const ctx = {
    EDIT_SRC: { layout: { data: "oros-layout-index", legacy: "oros-layout-data", list: "docs", pkg: 1, max: 1e6, disk: 1 } },
    diskDocs: {}, DISK_MAX: 1e6, Date, Promise, JSON, RegExp, Array, String,
    readStore: (k) => (k in store ? store[k] : null),
    shell: () => ({ orosFS: { ls, read } })
  };
  vm.createContext(ctx);
  vm.runInContext(src.slice(a, b) + "\nthis.diskScan = diskScan; this.idxOf = idxOf;", ctx);
  return ctx;
}
const pkg = (id, name, kind) => JSON.stringify({ kind: kind || "oros-layout-package", ver: 1, doc: { id, name, pages: [{}, {}] } });

test("GL-1: no index of its own → documents from the disk files", async () => {
  const files = {
    "Στην καρδιά του βυθού · ly-abc123.oroslayout": pkg("ly-abc123", "Στην καρδιά του βυθού"),
    "Other · ly-zz9.oroslayout": pkg("ly-zz9", "Other", "oros-atelier-package"),   // wrong kind
    "Broken · ly-x1.oroslayout": "{not json",
    "Copy · ly-abc123 (conflict 21-11).oroslayout": pkg("ly-abc123", "Copy"),          // conflict copy skipped
    "notes.txt": "x"
  };
  const c = box(files, {});
  assert.equal(c.idxOf("layout"), null);
  await c.diskScan("layout");
  const idx = c.idxOf("layout");
  assert.equal(JSON.stringify(idx.docs.map((d) => [d.id, d.name, d.pages])), JSON.stringify([["ly-abc123", "Στην καρδιά του βυθού", 2]]));
  assert.equal(c.diskDocs["layout/ly-abc123"].m, idx.docs[0].m);
  assert.match(idx.docs[0].path, /^\/internal\/Layout\/Στην καρδιά/);
});

test("GL-1: a device with its own index never scans", async () => {
  const own = { ver: 1, docs: [{ id: "ly-own1", m: 3, name: "Own" }] };
  const c = box({ "A · ly-abc123.oroslayout": pkg("ly-abc123", "A") }, { "oros-layout-index": own });
  await c.diskScan("layout");
  assert.equal(c.idxOf("layout"), own);
  assert.equal(Object.keys(c.diskDocs).length, 0);
});

test("GL-1: editLoadFor scans before picking the documents", () => {
  assert.match(src, /return diskScan\(app\)\.then\(function \(\) \{\n      var src = editSource\(app\)/);
  assert.match(src, /var idx = idxOf\(app\);\n    var fold/);
});

// GL-3 (book item 24): a file that cannot be read skips its step, not the batch
function timeoutBox() {
  const b = proBox((w) => { w.orosLocal = { read: () => Promise.reject({ why: "timeout" }) }; });
  return b.pro;
}
function proBox(tweak) {
  const applied = [];
  const win = {
    LY: { M: {}, now: () => 1, data: () => ({ docs: [] }) },
    LayoutPro: { natSort: (x) => x, PIC: /\.(jpe?g|png)$/i, normPath: (x) => x },
    LayoutCommands: { apply: (doc, st) => { if (doc.tag === "real") applied.push(st.op); return 1; } },
    orosDK: { assets: {} },
    orosLocal: { read: () => Promise.reject({ why: "notAllowedRoot" }) },
    localStorage: { getItem: () => null }
  };
  win.window = win; win.parent = win;
  if (tweak) tweak(win);
  const ctx = vm.createContext(Object.assign(win, { Promise, JSON, Object, Array, String, RegExp, Math, Blob: function () {}, File: function () {} }));
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "layout/proassist.js"), "utf8"), ctx);
  return { pro: win.LY.pro, applied };
}

test("GL-3: an unreadable placepage is skipped, the text steps around it apply", async () => {
  const { pro } = proBox(), notes = [];
  const steps = [{ op: "retext" }, { op: "placepage", path: "local:Vythos/a.pdf" }, { op: "retext" }];
  const r = await pro.prepare({ tag: "scratch" }, steps, {}, notes, {});
  assert.equal(r.skipped, 1);
  assert.equal(JSON.stringify(r.envs.map((e) => !!e.skip)), "[false,true,false]");
  assert.match(notes[0], /^skipped step 2 \(placepage\): notAllowedRoot: local:Vythos\/a\.pdf/);
});

test("GL-3: after a failed images step the later steps are skipped, earlier ones kept", async () => {
  const { pro } = proBox(), notes = [];
  const steps = [{ op: "retext" }, { op: "images", paths: ["local:Vythos/b.jpg"], sort: "given" }, { op: "retext" }, { op: "framemod" }];
  const r = await pro.prepare({ tag: "scratch" }, steps, {}, notes, {});
  assert.equal(r.stopped, 1);
  assert.equal(JSON.stringify(r.envs.map((e) => !!e.skip)), "[false,true,true,true]");
  assert.match(notes.join("\n"), /skipped steps 3-4/);
});

test("GL-3: a timeout still stops the whole run", async () => {
  const notes = [];
  const steps = [{ op: "retext" }, { op: "placepage", path: "local:Vythos/a.pdf" }];
  // the bridge answers timeout: not a file to skip, the run stops
  await assert.rejects(timeoutBox().prepare({}, steps, {}, notes, {}), (e) => e.why === "timeout");
});

test("GL-3: assist.js leaves skipped steps out and reports them; the gate names them", () => {
  const as = fs.readFileSync(path.join(__dirname, "..", "layout/assist.js"), "utf8");
  assert.match(as, /if \(skipAt\(i\)\) return; var e = envAt\(i, nw\)/);
  assert.match(as, /if \(rep\.ok && skippedN\) rep\.skipped = skippedN;/);
  assert.match(src, /out\.skipped_steps = \+rep\.skipped;/);
});

test("GL-2: Layout's proofs and PDFs are readable with Layout allowed", () => {
  assert.match(src, /var LY_OUT = \["\/internal\/Layout\/Proofs", "\/internal\/Layout\/PDF"\];/);
  assert.match(src, /var lyOnly = !app && !write && !!appOf\(apps, "layout"\);/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "gate/gate.js"), "utf8"), /if \(id === "layout"\) t = t\.concat\(FILE_READ\);/);
});

test("GL-5: gate_tools lists every tool now, gate_call is not in its own list", async () => {
  const R = await import("../relay/gate.js");
  const all = JSON.parse(R.gateToolsText(R.TOOLS));
  assert.ok(all.tools.some((t) => t.name === "claude_folders_request"));
  assert.ok(!all.tools.some((t) => R.META_TOOLS.indexOf(t.name) >= 0));
  const one = JSON.parse(R.gateToolsText(R.TOOLS, "claude_folders_request"));
  assert.equal(one.name, "claude_folders_request");
  assert.ok(one.inputSchema && one.inputSchema.properties);
  assert.equal(R.gateToolsText(R.TOOLS, "nope"), "");
  const rel = fs.readFileSync(path.join(__dirname, "..", "relay/gate.js"), "utf8");
  assert.match(rel, /p = \{ name: a0\.tool, arguments: a0\.args \|\| \{\} \};\n    \}\n    if \(p\.name === "gate_tools"\)/);
});

test("GL-4: Layout reports an edit once its save is done", () => {
  const as = fs.readFileSync(path.join(__dirname, "..", "layout/assist.js"), "utf8"), ly = fs.readFileSync(path.join(__dirname, "..", "layout/layout.js"), "utf8");
  assert.match(as, /var settled = snaps\.length && LY\.settled \? LY\.settled\(20000\) : Promise\.resolve\(\);/);
  assert.match(ly, /LY\.settled = function \(ms\)/);
});

test("GL-6: the newest orOS answers first, then the screen, then the last to connect", async () => {
  const R = await import("../relay/gate.js");
  const s = (n, att) => ({ n, __g: att });
  const old = s("old 8.01 on screen", { v: 1, at: 9 }), phone = s("8.14 hidden", { v: 0, ver: R.verNum("8.14.00"), at: 1 }), pc = s("8.14 on screen", { v: 1, ver: 81400, at: 2 });
  assert.deepEqual(R.pickOrder([old, phone, pc]).map((x) => x.n), ["8.14 on screen", "8.14 hidden", "old 8.01 on screen"]);
  assert.equal(R.verNum("8.13.00"), 81300);
  assert.equal(R.verNum("8.13"), 0);
  const g = fs.readFileSync(path.join(__dirname, "..", "gate/gate.js"), "utf8"), rel = fs.readFileSync(path.join(__dirname, "..", "relay/gate.js"), "utf8");
  assert.match(g, /sock\.send\("ver:" \+ av\)/);
  assert.match(rel, /msg\.indexOf\("ver:"\) === 0/);
});
