// HELPER-1: who helps with the owner's data (Settings › Connected
// services): "both", "assistant" (orOS Gate off on every device) or
// "claude" (the Assistant leaves the menu and its ways in open Claude).
// Synced as slice "aihelper" (localStorage "oros-ai-helper" { v, m }).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const G = require(path.join(ROOT, "gate/gate.js"));
const C = require(path.join(ROOT, "settings/core.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("helper: anything unknown or missing is both", () => {
  assert.deepEqual(G.helperClean(null), { v: "both", m: 0 });
  assert.deepEqual(G.helperClean({ v: "gemini", m: 5 }), { v: "both", m: 5 });
  assert.deepEqual(G.helperClean({ v: "claude", m: -1 }), { v: "claude", m: 0 });
  assert.deepEqual(G.helperClean({ v: "assistant", m: "7" }), { v: "assistant", m: 0 });
  assert.deepEqual(G.HELPERS, ["both", "assistant", "claude"]);
  assert.deepEqual(C.HELPER_OPTS, G.HELPERS);
});

test("helper: the later choice wins, ties agree on every device", () => {
  const a = { v: "assistant", m: 10 }, b = { v: "claude", m: 20 };
  assert.deepEqual(G.helperMerge(a, b), b);
  assert.deepEqual(G.helperMerge(b, a), b);
  const x = { v: "both", m: 30 }, y = { v: "assistant", m: 30 };
  assert.deepEqual(G.helperMerge(x, y), G.helperMerge(y, x));
  assert.deepEqual(G.helperMerge(null, { v: "claude", m: 1 }), { v: "claude", m: 1 });
});

test("helper: Assistant only keeps orOS Gate off and refuses to turn it on", () => {
  const src = read("gate/gate.js");
  assert.match(src, /registerSlice\("aihelper"/);
  assert.match(src, /enable: function \(\) \{\n\s+var p = pref\(\);\n\s+if \(helperRead\(\)\.v === "assistant"\) return helperOff\(\);/);
  assert.match(src, /if \(helperRead\(\)\.v === "assistant"\) return helperOff\(\);\n\s+if \(!\/\^\[ABCDEFGHJKMNPQRSTUVWXYZ23456789\]\{8\}\$\/\.test\(jc\)\)/);   // join
  assert.match(src, /if \(helperRead\(\)\.v === "assistant"\) return Promise\.resolve\(false\);   \/\/ HELPER-1/);  // sit
  assert.match(src, /function connect\(\) \{[\s\S]{0,200}helperRead\(\)\.v === "assistant"\) \{ helperApply\(\); return; \}/);
  assert.match(src, /function helperApply\(\) \{[\s\S]{0,200}api\.disable\(\)/);
  assert.match(src, /tr\("gate\.ask\.helper"\)/);
});

test("helper: Claude only sends every way into the Assistant to Claude", () => {
  const sh = read("shell.js");
  assert.match(sh, /window\.__orosOpenAt = function \(appId, target\) \{[\s\S]{0,400}appId === "assistant" && aiHelper\(\) === "claude"/);
  assert.match(sh, /function openApp\(app, at\) \{[\s\S]{0,1200}app\.id === "assistant" && aiHelper\(\) === "claude"\) \{ claudeInstead\(""\); return; \}/);
  assert.match(sh, /function openAssistant\(q\) \{\n\s+if \(!hasApp\("assistant"\)\) return;\n\s+if \(aiHelper\(\) === "claude"\) \{ claudeInstead\(q\); return; \}/);
  assert.match(sh, /if \(claudeOnly && app\.id === "assistant"\) return;/);
  // A question goes to the clipboard, never into claude.ai's address.
  const fn = /function claudeInstead\(q\) \{[\s\S]*?\n  \}/.exec(sh)[0];
  assert.match(fn, /clipboard\.writeText\(text\)/);
  assert.match(fn, /window\.open\("https:\/\/claude\.ai\/new", "_blank", "noopener"\)/);
  assert.doesNotMatch(fn, /\?q=|encodeURIComponent/);
  assert.match(fn, /"oros-claude", \{ detail: "open" \}/);
  assert.match(read("quickmenu.js"), /H\.mode\(\) === "claude"\) \{\n\s+H\.claude\(/);
});

test("helper: strings in EN, EL and DE", () => {
  const de = read("i18n/de/settings.js"), tr = read("translations.js"), deSh = read("i18n/de/shell.js");
  ["hp.title", "hp.hint", "hp.both", "hp.assistant", "hp.claude", "hp.now.both", "hp.now.assistant", "hp.now.claude",
   "hp.sure", "hp.sure.yes", "hp.sure.no", "gt.helper", "w.helper"].forEach((k) => {
    assert.ok(C.t("en", k) !== k, "en " + k);
    assert.ok(C.t("el", k) !== k, "el " + k);
    assert.ok(de.includes('"' + k + '":'), "de " + k);
  });
  ["gate.ask.helper", "search.askClaude", "helper.copied"].forEach((k) => {
    assert.equal(tr.split('"' + k + '":').length - 1, 2, "translations " + k);
    assert.ok(deSh.includes('"' + k + '":'), "de shell " + k);
  });
  assert.ok(C.findItem("helper"));
});
