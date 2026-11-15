// Editable keyboard shortcuts (SC-EDIT, DEF-APPS D2): SC_DEFS ids, the
// person's keys (synced shell field "keys"), conflicts, swap, reset,
// the one combo Ctrl+Alt+Shift (plain Ctrl+K retired 2026-11-15).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const SHELL = read("shell.js");
const C = require("../settings/core.js");

function cut(src, name) {
  const i = src.indexOf("  function " + name + "(");
  if (i < 0) throw new Error("missing function " + name);
  let depth = 0, j = src.indexOf("{", i);
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) break;
  }
  return src.slice(i, j + 1);
}

const DEFS_SRC = SHELL.slice(SHELL.indexOf("var SC_DEFS = ["), SHELL.indexOf("];", SHELL.indexOf("var SC_DEFS = [")) + 2);
const RE_SRC = SHELL.match(/var SC_CODE_RE = [^\n]+\n/)[0];

// A small world: the real functions over a fake localStorage.
function world(usb) {
  const store = {};
  const calls = { note: 0, notify: 0, fired: [] };
  const src =
    "var localStorage = { getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; }," +
    " setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } };\n" +
    "var state = { pcFiles: usb ? { fixed: true } : null }; var TILL = false;\n" +
    "var navigator = { platform: 'Linux' }; var attrs = {};\n" +
    "var document = { documentElement: { setAttribute: function (k, v) { attrs[k] = v; } } };\n" +
    "function noteLocalChange() { calls.note++; } function settingsNotify() { calls.notify++; }\n" +
    ["scForcePush", "scForcePull", "scBackupNow", "scExportDb", "showInfoModal", "scCheckUpdates", "scToggleLang", "scReconnect",
     "openAppById", "openMenuSearch", "openHelp", "scTimesheetToggle", "openAssistant", "scNewSticky", "openCmdBar", "mtSwitcher"]
      .map((n) => "function " + n + "(a) { calls.fired.push('" + n + "' + (a ? ':' + a : '')); }").join("\n") + "\n" +
    DEFS_SRC.replace("var SC_DEFS", "var SC_DEFS") + "\nvar SC_KEYS_KEY = \"oros-shortcuts\";\n" + RE_SRC +
    ["keysCanon", "keysRead", "keysWrite", "scDefault", "scUsbHere", "scTable", "scCodeOf", "scKeyLabel", "scPrefix", "scCombo",
     "scMirror", "scSetKey", "scResetAll", "scRewrite", "handleShortcutEvent"].map((n) => cut(SHELL, n)).join("\n") +
    "\nvar SC_KEY_LABEL = { Period: '.' };\n" +
    "return { SC_DEFS: SC_DEFS, keysCanon: keysCanon, keysRead: keysRead, scTable: scTable, scCodeOf: scCodeOf, scSetKey: scSetKey," +
    " scResetAll: scResetAll, scRewrite: scRewrite, handle: handleShortcutEvent, scCombo: scCombo, attrs: attrs };";
  const w = new Function("store", "calls", "usb", src)(store, calls, usb);
  w.store = store; w.calls = calls;
  return w;
}
const ev = (code, mods) => Object.assign({ ctrlKey: true, altKey: true, shiftKey: true, code, target: null, preventDefault() {} }, mods || {});

test("SC_DEFS: every entry has a stable unique id and a valid default key", () => {
  const w = world(false);
  const ids = w.SC_DEFS.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
  ["push", "pull", "snapshot", "export", "info", "updates", "lang", "reconnect", "calculator", "search", "help", "timer",
   "assistant", "today", "stickies", "cmdbar", "switcher", "quickask", "qs", "usb-shot", "usb-reader", "usb-display"]
    .forEach((id) => assert.ok(ids.includes(id), id));
  const defaults = w.scTable({}).map((x) => x.code);
  assert.equal(new Set(defaults).size, defaults.length, "no two defaults share a key");
  w.SC_DEFS.forEach((d) => assert.ok(/^[a-z][a-z0-9-]{0,23}$/.test(d.id), d.id));
  w.SC_DEFS.filter((d) => d.usb).forEach((d) => assert.equal(d.fn, undefined, d.id + " is the USB extension's"));
});

test("keys: canonical by shape only (R26)", () => {
  const w = world(false);
  assert.deepEqual(w.keysCanon({ search: "KeyB", help: "", zz: "Digit3", future: "Period" }),
    { future: "Period", help: "", search: "KeyB", zz: "Digit3" });
  assert.deepEqual(w.keysCanon({ Search: "KeyB", help: "keyb", x: "F1", y: 3, "a b": "KeyA" }), {});
  [null, undefined, "x", [], 3].forEach((v) => assert.equal(w.keysCanon(v), undefined, String(v)));
  const once = w.keysCanon({ b: "KeyB", a: "KeyA" });
  assert.equal(JSON.stringify(w.keysCanon(once)), JSON.stringify(once));
});

test("matching: defaults, a moved key, off, digits, editable targets, USB entries never fire", () => {
  const w = world(true);
  assert.equal(w.handle(ev("KeyH")), true);
  assert.deepEqual(w.calls.fired, ["openHelp"]);
  assert.equal(w.handle(ev("KeyH", { shiftKey: false })), false);
  assert.equal(w.handle(ev("KeyG")), false, "usb-shot is the extension's");
  assert.equal(w.handle(ev("KeyH", { target: { tagName: "INPUT" } })), false);
  assert.equal(w.scSetKey("help", "Digit1"), true);
  assert.equal(w.handle(ev("KeyH")), false);
  assert.equal(w.handle(ev("Digit1")), true);
  assert.equal(w.calls.fired.slice(-1)[0], "openHelp");
  assert.equal(w.scSetKey("calculator", ""), true);
  assert.equal(w.handle(ev("KeyC")), false, "off frees the key for the app");
  assert.deepEqual(JSON.parse(w.store["oros-shortcuts"]), { calculator: "", help: "Digit1" });
  assert.ok(w.calls.note >= 2 && w.calls.notify >= 2);
});

test("conflicts: refused without swap, swapped with it, default drops the override", () => {
  const w = world(false);
  assert.equal(w.scSetKey("help", "KeyF"), false, "Search has F");
  assert.equal(w.scCodeOf("help"), "KeyH");
  assert.equal(w.scSetKey("help", "KeyF", true), true);
  assert.equal(w.scCodeOf("help"), "KeyF");
  assert.equal(w.scCodeOf("search"), "KeyH");
  // back to the default by swap: both overrides go
  assert.equal(w.scSetKey("help", "KeyH", true), true);
  assert.equal(w.store["oros-shortcuts"], undefined);
  assert.equal(w.scSetKey("nope", "KeyB"), false);
  assert.equal(w.scSetKey("help", "F1"), false);
  assert.equal(w.scSetKey("help", "KeyH"), false, "no change");
});

test("two entries on one key after a sync: the first in table order keeps it", () => {
  const w = world(false);
  const tab = w.scTable({ search: "KeyP" });
  assert.equal(tab.find((x) => x.def.id === "push").code, "KeyP");
  assert.equal(tab.find((x) => x.def.id === "search").code, "");
});

test("reset all, USB mirror on <html>, tooltips follow a moved key", () => {
  const w = world(true);
  w.scSetKey("usb-shot", "KeyB");
  assert.equal(w.attrs["data-oros-sc-usb-shot"], "KeyB");
  assert.equal(w.attrs["data-oros-sc-usb-reader"], "KeyJ");
  w.scSetKey("usb-display", "");
  assert.equal(w.attrs["data-oros-sc-usb-display"], "");
  w.scSetKey("help", "Digit7");
  assert.equal(w.scRewrite("Help for this app (Ctrl+Alt+Shift+H)"), "Help for this app (Ctrl+Alt+Shift+7)");
  assert.equal(w.scRewrite("Open apps (Ctrl+Alt+Shift+W)"), "Open apps (Ctrl+Alt+Shift+W)");
  w.scResetAll();
  assert.equal(w.store["oros-shortcuts"], undefined);
  assert.equal(w.attrs["data-oros-sc-usb-shot"], "KeyG");
  assert.equal(w.scRewrite("x (Ctrl+Alt+Shift+H)"), "x (Ctrl+Alt+Shift+H)");
  assert.equal(w.scCombo("KeyB"), "Ctrl+Alt+Shift+B");
});

test("shell wiring: synced field keys, pulled without a push, Settings set, plain Ctrl+K retired", () => {
  assert.match(SHELL, /var SHELL_FIELDS = \[[^\]]*"keys"[^\]]*\];/);
  assert.match(cut(SHELL, "shellCanon"), /case "keys":\s+return keysCanon\(v\);/);
  assert.match(cut(SHELL, "shellNow"), /keys: keysRead\(\)/);
  assert.match(cut(SHELL, "shellBuild"), /keys:\s+vals\.keys/);
  const set = cut(SHELL, "shellSliceSet");
  const at = set.indexOf("keysCanon(data.keys)");
  assert.ok(at > 0);
  assert.doesNotMatch(set.slice(at, at + 160), /noteLocalChange|markDirty/);
  const ss = cut(SHELL, "settingsSet");
  assert.match(ss, /case "shortcut":[\s\S]*scSetKey\(String\(value\.id \|\| ""\), value\.code, !!value\.swap\)/);
  assert.match(ss, /case "shortcutsReset": scResetAll\(\); return;/);
  assert.doesNotMatch(SHELL, /function cmdIsCtrlK|CMD_OWN_CTRLK/);
  assert.match(SHELL, /window\.orosShortcuts = \{ handle: handleShortcutEvent, code: scCodeOf,/);
  assert.match(read("commands/bar.js"), /S\.code\("cmdbar"\)/);
  assert.doesNotMatch(read("translations.js"), /Ctrl\+K/);
});

test("settings: editable list, capture, conflict, strings in EN/EL/DE", () => {
  const src = read("settings/settings.js");
  assert.match(src, /if \(s\.shortcuts && s\.shortcuts\.length\) secShortcuts\(host, s\);/);
  const sec = cut(src, "secShortcuts");
  assert.match(sec, /card\(t\("x\.shortcuts"\), "keys"\)/);
  assert.match(sec, /set\("shortcut", \{ id: k\.id, code: c\.code, swap: true \}\)/);
  assert.match(sec, /set\("shortcutsReset", true\)/);
  const cap = cut(src, "scCapture");
  assert.match(cap, /\^\(Key\[A-Z\]\|Digit\[0-9\]\)\$/);
  assert.match(cut(src, "wireKeyboard"), /document\.addEventListener\("keydown", scCapture, true\);/);
  assert.equal(C.scopeOf("keys"), "all");
  const de = read("i18n/de/settings.js");
  ["sc.hint", "sc.change", "sc.turnoff", "sc.default", "sc.cancel", "sc.swap", "sc.off", "sc.press", "sc.taken", "sc.resetAll"].forEach((k) => {
    assert.ok(C.STRINGS.en[k] && C.STRINGS.el[k], k);
    assert.ok(de.includes('"' + k + '":'), "de " + k);
  });
  const tr = read("translations.js"), dsh = read("i18n/de/shell.js");
  ["sc.desc.usbshot", "sc.desc.usbreader", "sc.desc.usbdisplay"].forEach((k) => {
    assert.equal((tr.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length, 2, k);
    assert.ok(dsh.includes('"' + k + '":'), "de " + k);
  });
});
