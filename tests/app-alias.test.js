// APP-ALIAS (app merges, 2026-11-12): an app folded into another one
// keeps its id in apps.json "aliases". These checks keep every alias
// openable the same way everywhere (shell, launcher, Gate, Assistant)
// and its data where it was.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const APPS = JSON.parse(read("apps.json"));
const ALIASES = APPS.aliases || [];
const INTERNAL = new Set(APPS.apps.filter((a) => a.type === "internal").map((a) => a.id));

test("aliases: well formed, never an app themselves, pointing at an internal app", () => {
  const seen = new Set();
  for (const a of ALIASES) {
    assert.match(a.id, /^[a-z0-9][a-z0-9_-]{0,47}$/, a.id);
    assert.ok(!seen.has(a.id), "duplicate alias " + a.id);
    seen.add(a.id);
    assert.ok(!APPS.apps.some((x) => x.id === a.id), a.id + " is still an app");
    assert.ok(INTERNAL.has(a.to), a.id + " → " + a.to + " is not an internal app");
    assert.equal(typeof a.name, "string", a.id + " keeps its old English name (menu search)");
    if (a.target !== undefined) assert.ok(a.target && typeof a.target === "object" && !Array.isArray(a.target), a.id + " target");
    assert.deepEqual(Object.keys(a).filter((k) => !["id", "name", "to", "target"].includes(k)), [], a.id + " has only known keys");
  }
});

test("aliases: the old name stays translated (menu search, command bar) in EN and EL", () => {
  global.window = {};
  const src = read("translations.js");
  for (const a of ALIASES) {
    const n = (src.match(new RegExp('"app\\.' + a.id + '":', "g")) || []).length;
    assert.ok(n >= 2, "app." + a.id + " in en and el");
  }
});

test("aliases: the old folder only forwards (no app page left behind)", () => {
  for (const a of ALIASES) {
    const page = path.join(ROOT, a.id, "index.html");
    if (!fs.existsSync(page)) continue;
    const html = fs.readFileSync(page, "utf8");
    assert.ok(html.includes('"../?open=' + a.id + '"'), a.id + "/index.html forwards through the alias");
    assert.ok(!/<script src=/.test(html), a.id + "/index.html loads no app code");
    assert.ok(!fs.existsSync(path.join(ROOT, a.id, "solo.html")) ||
      fs.readFileSync(path.join(ROOT, a.id, "solo.html"), "utf8").includes(a.to), a.id + "/solo.html forwards");
  }
});

test("shell: every way of opening an app resolves aliases", () => {
  const sh = read("shell.js");
  assert.ok(/state\.aliases = appAliasesFrom\(data, state\.apps\)/.test(sh), "loaded with apps.json");
  const openAt = sh.slice(sh.indexOf("window.__orosOpenAt = function (appId, target)"));
  assert.ok(openAt.slice(0, 300).includes("var al = appAlias(appId);") && openAt.slice(0, 400).includes("if (al) { appId = al.to; target = aliasTarget(al, target); }"),
    "__orosOpenAt (Gate, Assistant, apps, notifications) forwards");
  const byId = sh.slice(sh.indexOf("function openAppById(id) {"));
  assert.ok(byId.slice(0, 120).includes("if (appAlias(id)) { window.__orosOpenAt(id, null); return; }"), "openAppById (command bar, taskbar) forwards");
  const launch = sh.slice(sh.indexOf("function openFromLaunchParam() {"));
  assert.ok(launch.slice(0, 900).includes("if (appAlias(id)) {"), "?open=<old id> forwards");
  assert.ok(sh.includes("aliasHost: aliasHost,") && sh.includes("openAlias: function (id)"), "launcher gets the alias host");
  assert.ok(sh.includes("}).concat(state.aliases.map(function (al) {"), "command bar knows the old names");
  assert.ok(sh.includes("if (app && app._alias) { window.__orosOpenAt(app._alias, null); return; }"), "menu search row of an alias");
});

test("launcher: a shortcut of an alias shows its new home and opens at the old place", () => {
  const L = read("launcher.js");
  assert.ok(L.includes('return (host && typeof host.aliasHost === "function" && host.aliasHost(id)) || null;'));
  assert.ok(L.includes("if (app.id !== id && host.openAlias && host.openAlias(id)) return;"));
});

test("aliasTarget semantics: the alias target under the caller's keys", () => {
  // Same code as shell.js aliasTarget (kept in step by the check below).
  const sh = read("shell.js");
  const src = sh.slice(sh.indexOf("  function aliasTarget(al, target) {"), sh.indexOf("  // The host app of an alias"));
  const aliasTarget = new Function(src + "; return aliasTarget;")();
  assert.deepEqual(aliasTarget({ target: { group: "case" } }, null), { group: "case" });
  assert.deepEqual(aliasTarget({ target: { group: "case" } }, { text: "x" }), { group: "case", text: "x" });
  assert.deepEqual(aliasTarget({ target: { group: "case" } }, { group: "lines" }), { group: "lines" });
  assert.deepEqual(aliasTarget({ target: null }, "junk"), null);
  assert.deepEqual(aliasTarget({ target: null }, [1]), null);
});
