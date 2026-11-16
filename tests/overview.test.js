// Overview and system monitor (OV-1 / OV-2, gap list 2026-11-15
// items 7 + 9): shell.js section 10e, window.orosMonitor, Settings ›
// System › Overview and Settings › Device › Running now.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const SHELL = read("shell.js");
const SEC = SHELL.slice(SHELL.indexOf("// ---------- 10e. Overview"), SHELL.indexOf("// ---------- 11. Menu open/close"));

// The pure helpers of 10e, run on their own.
function helpers() {
  const pick = (name) => {
    const i = SEC.indexOf("  function " + name + "(");
    assert.ok(i >= 0, name);
    const j = SEC.indexOf("\n  }\n", i);
    return SEC.slice(i, j + 4);
  };
  const ctx = {};
  vm.runInNewContext(pick("ovRecentsFrom") + pick("ovSyncState") + pick("ovPlaces") +
    "this.r = ovRecentsFrom; this.s = ovSyncState; this.p = ovPlaces;", ctx);
  // plain values of this realm (deepEqual checks prototypes)
  const plain = (fn) => (...a) => JSON.parse(JSON.stringify(fn(...a)));
  return { r: plain(ctx.r), s: plain(ctx.s), p: ctx.p };
}

test("10e sits after the switcher and before the menu section", () => {
  assert.ok(SEC.length > 1000);
  assert.ok(SHELL.indexOf("// ---------- 10c. App switcher") < SHELL.indexOf("// ---------- 10e. Overview"));
});

test("Ctrl+Alt+Shift+E opens the overview (SC_DEFS, stable id)", () => {
  assert.match(SHELL, /\{ id: "overview",\s+key: "e", label: "sc\.desc\.overview",\s+fn: function\(\) \{ ovOpen\(\); \} \}/);
  const defs = SHELL.slice(SHELL.indexOf("var SC_DEFS = ["), SHELL.indexOf("];", SHELL.indexOf("var SC_DEFS = [")));
  const keys = [...defs.matchAll(/key:\s*"([a-z])"/g)].map((m) => m[1]);
  assert.equal(keys.filter((k) => k === "e").length, 1, "one shortcut per letter");
  assert.ok(!keys.includes("v"), "V belongs to the clipboard history");
});

test("recent files: Files' journal, only real disk paths, newest first, capped", () => {
  const { r } = helpers();
  const raw = JSON.stringify([
    { p: "/internal/Docs/a.txt", at: 3 },
    { p: "/internal/Docs/a.txt", at: 2 },            // duplicate
    { p: "/internal/.trash/x/b.txt", at: 2 },         // Trash
    { p: "/internal/../etc/passwd", at: 2 },          // escape
    { p: "/elsewhere/c.txt", at: 2 },
    { p: 42 }, null,
    { p: "/internal/top.md" },
    { p: "/internal/Photos/d.jpg/", at: 1 }
  ]);
  const out = r(raw, 8);
  assert.deepEqual(out.map((f) => f.path), ["/internal/Docs/a.txt", "/internal/top.md", "/internal/Photos/d.jpg"]);
  assert.equal(out[0].name, "a.txt");
  assert.equal(out[0].dir, "/internal/Docs");
  assert.equal(out[1].dir, "/internal");
  assert.equal(out[1].at, 0);
  assert.equal(r(raw, 1).length, 1);
  assert.deepEqual(r("not json", 8), []);
  assert.deepEqual(r(null, 8), []);
  assert.deepEqual(r("{}", 8), []);
});

test("sync tile: one honest line for every state", () => {
  const { s } = helpers();
  assert.equal(s(null).key, "ov.sys.sync.off");
  assert.equal(s({ connected: false, dirty: true }).key, "ov.sys.sync.off");
  assert.deepEqual(s({ connected: true, dirty: false, deferred: 0, files: null }), { key: "ov.sys.sync.ok", n: 0, level: "" });
  assert.equal(s({ connected: true, dirty: true, deferred: 0, files: null }).key, "ov.sys.sync.dirty");
  assert.deepEqual(s({ connected: true, dirty: true, files: { queued: 3 } }), { key: "ov.sys.sync.files", n: 3, level: "busy" });
  assert.equal(s({ connected: true, files: { queued: 3, busy: true } }).key, "ov.sys.sync.busy");
  assert.equal(s({ connected: true, files: { queued: 0, lastError: "x" } }).level, "warn");
  assert.deepEqual(s({ connected: true, dirty: false, deferred: 2, files: { queued: 0 } }), { key: "ov.sys.sync.merge", n: 2, level: "busy" });
});

test("places: heavy apps count twice", () => {
  const { p } = helpers();
  assert.equal(p([{ weight: 1 }, { weight: 2 }, {}]), 4);
  assert.equal(p([]), 0);
  assert.equal(p(null), 0);
});

test("never while locked, in a single app or on a till; corner off by default, no Super key", () => {
  assert.match(SEC, /function ovAllowed\(\) \{\s+if \(SOLO \|\| TILL\) return false;[\s\S]{0,200}isLocked\(\)\) return false;/);
  assert.match(SEC, /function ovOpen\(\) \{[\s\S]{0,120}if \(!ovAllowed\(\)\) return;/);
  assert.match(SEC, /function ovPref\(key\) \{\s+try \{ return localStorage\.getItem\(key\) === "1"; \}/);
  assert.match(SEC, /if \(!ovPref\(OV_CORNER_KEY\) \|\| ov\) return;/);
  // no Super key (Chris 2026-11-16: one Ctrl+Alt+Shift combo for all)
  assert.doesNotMatch(SHELL, /oros-ov-super|ovWireFrame|overview:super/);
  assert.match(SHELL, /a11yWireFrame\(f\);\s+return f;/);
});

test("recent file names: text only, hidden during sensitive work", () => {
  assert.match(SEC, /if \(strictLevelNow\(\)\) \{ note\("ov\.files\.hidden"\); return; \}/);
  assert.match(SEC, /querySelector\("\.ov-fname"\)\.textContent = f\.name;/);
  assert.doesNotMatch(SEC, /innerHTML[^;\n]*(f\.name|f\.path|f\.dir|it\.app\.name)/);
  assert.match(SEC, /OV_RECENTS_KEY = "oros-files-recents";/);
  assert.match(read("files/files.js"), /var RECENTS_KEY = "oros-files-recents";/);
  // Files takes "All recent files"
  assert.match(read("files/files.js"), /if \(t && t\.view === "recent"\) \{\s+if \(isAvailable\(\)\) openView\("recent"\);/);
});

test("typing hands over to the menu search (no second search engine)", () => {
  assert.match(SEC, /inp\.addEventListener\("input", function \(\) \{ if \(inp\.value\) ovToMenu\(inp\.value\); \}\);/);
  assert.match(SEC, /function ovToMenu\(text\) \{\s+ovClose\(\);\s+openMenuSearch\(\);/);
  assert.doesNotMatch(SEC, /orosSearch\.run\(/);
});

test("window.orosMonitor: snapshot, close, onChange with unsubscribe", () => {
  assert.match(SEC, /window\.orosMonitor = \{\s+snapshot: monSnapshot,/);
  assert.match(SEC, /close: function \(id\) \{/);
  assert.match(SEC, /onChange: function \(fn\) \{[\s\S]{0,300}return function \(\) \{/);
  // the switcher's repaint feeds it
  assert.match(SHELL, /if \(ov\) ovRenderApps\(\);\s+\/\/ 10e overview\s+monChanged\(\);/);
});

test("Settings: Overview card (device only) and Running now in Device", () => {
  const core = read("settings/core.js");
  const set = read("settings/settings.js");
  assert.match(core, /\["overview", "system", "ov\.corner", "ov\.title", null, "overview"\]/);
  assert.match(core, /\["dv-running", "device", "dv\.running"\]/);
  assert.match(set, /switchBtn\(!!s\.overview\.corner, "overview:corner"/);
  assert.doesNotMatch(set, /superKey/);
  assert.match(SHELL, /case "overview:corner":/);
  const dv = read("device/view.js");
  assert.match(dv, /var CARDS = \["running", /);
  assert.match(dv, /monOff = M\.onChange\(/);
  assert.match(dv, /if \(monOff\) \{ monOff\(\); monOff = null; \}/);
  assert.match(dv, /if \(a\.id !== "settings"\) \{/);
});

test("strings: EN, EL and DE for every new key", () => {
  const tr = read("translations.js");
  const de = read("i18n/de/shell.js");
  const keys = [...SEC.matchAll(/window\.t\("((?:ov)\.[a-z.]+)"\)/g)].map((m) => m[1]);
  ["ov.sys.sync.off", "ov.sys.sync.err", "ov.sys.sync.busy", "ov.sys.sync.files", "ov.sys.sync.dirty",
   "ov.sys.sync.merge", "ov.sys.sync.ok", "sc.desc.overview"].forEach((k) => keys.push(k));
  const uniq = [...new Set(keys)];
  assert.ok(uniq.length >= 15, uniq.length);
  uniq.forEach((k) => {
    const n = tr.split('"' + k + '":').length - 1;
    assert.equal(n, 2, "translations.js EN + EL: " + k);
    assert.ok(de.includes('"' + k + '":'), "i18n/de/shell.js: " + k);
  });
  const dv = read("device/view.js");
  const dde = read("i18n/de/device.js");
  ["c.running", "r.front", "r.close", "r.closeOthers", "r.hint", "y.files", "y.merge"].forEach((k) => {
    assert.equal(dv.split('"' + k + '":').length - 1, 2, "device/view.js EN + EL: " + k);
    assert.ok(dde.includes('"' + k + '":'), "i18n/de/device.js: " + k);
  });
});
