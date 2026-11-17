// Stock fair till, wave F3b (TILL-1): a helper's phone that opens only
// the till. lock.js keeps the device-local switch "oros-till" and the
// owner's session flag; the shell runs as a single app of Stock; the
// till asks the owner's screen-lock PIN for voids, settings, events,
// price lists and a discount over the device's limit.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const L = require("../lock.js");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

// lock.js in a page without a real DOM: enough for its state machine
// (start, Lock now, the till switch). The lock screen itself is
// checked in the browser (Playwright, see the Bible).
function store(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _m: m
  };
}
function page(local, session, search) {
  const noop = () => {};
  const el = () => ({ setAttribute: noop, appendChild: noop, addEventListener: noop, style: {}, classList: { add: noop, remove: noop } });
  const win = {
    localStorage: store(local), sessionStorage: store(session),
    location: { search: search || "", pathname: "/" },
    document: {
      body: null, documentElement: { getAttribute: () => null },
      addEventListener: noop, createElement: el, querySelectorAll: () => [], visibilityState: "visible"
    },
    addEventListener: noop, setInterval: () => 0, clearInterval: noop, setTimeout: () => 0,
    crypto: { getRandomValues: (b) => b, subtle: {} },
    TextEncoder, btoa: (s) => Buffer.from(s, "binary").toString("base64"), atob: (s) => Buffer.from(s, "base64").toString("binary"),
    Date, JSON, Math, Promise, Uint8Array, String, Number, Array, Object, RegExp, Error
  };
  win.window = win;
  win.globalThis = win;
  vm.createContext(win);
  vm.runInContext(read("lock.js").replace(/typeof module !== "undefined"/, "false"), win, { filename: "lock.js" });
  return win;
}
const CFG = JSON.stringify({ v: 1, kind: "pin", salt: "c2FsdHNhbHRzYWx0c2FsdA==", hash: "aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g=", i: 600000, idle: 5, hidden: false });
const TILL = JSON.stringify({ v: 1, on: 1 });

test("the till switch is read defensively", () => {
  assert.equal(L.TILL_KEY, "oros-till");
  assert.equal(L.parseTill(TILL), true);
  assert.equal(L.parseTill(JSON.stringify({ v: 1, on: true })), false, "only on: 1");
  assert.equal(L.parseTill(JSON.stringify({ v: 2, on: 1 })), false);
  assert.equal(L.parseTill("not json"), false);
  assert.equal(L.parseTill(null), false);
});

test("a till-only device starts on the till with no PIN; without the lock there is no till", () => {
  const w = page({ "oros-lock": CFG, "oros-till": TILL }, {});
  assert.equal(w.orosLock.isOn(), true);
  assert.equal(w.orosLock.isLocked(), false, "no lock screen at start");
  assert.equal(w.orosLock.till.active(), true);
  const off = page({ "oros-till": TILL }, {});
  assert.equal(off.orosLock.till.active(), false, "no lock, no till");
  assert.equal(off.orosLock.till.turn(true), false, "turning it on needs the lock");
});

test("inside a single app (?solo=) the till switch does nothing and the lock asks the PIN", () => {
  const w = page({ "oros-lock": CFG, "oros-till": TILL }, {}, "?solo=notes");
  assert.equal(w.orosLock.till.active(), false);
  assert.equal(w.orosLock.till.turn(true), false);
});

test("the till never locks itself; the owner leaving returns to the till", () => {
  const w = page({ "oros-lock": CFG, "oros-till": TILL }, {});
  assert.equal(w.orosLock.lock(), false, "Lock now on the till: nothing");
  assert.equal(w.orosLock.isLocked(), false);
  // the owner typed the PIN in this tab
  w.sessionStorage.setItem("oros-till-owner", "1");
  assert.equal(w.orosLock.till.active(), false);
  let told = 0;
  w.orosLock.onChange(() => { told++; });
  assert.equal(w.orosLock.lock(), false, "Lock now (or idle) as the owner: back to the till, no lock screen");
  assert.equal(w.orosLock.till.active(), true);
  assert.equal(w.sessionStorage.getItem("oros-till-owner"), null);
  assert.ok(told >= 1, "the shell hears it and starts again as the till");
});

test("a fresh start forgets the owner; a start in the same tab moments later keeps it", () => {
  const w = page({ "oros-lock": CFG, "oros-till": TILL }, { "oros-till-owner": "1" });
  assert.equal(w.orosLock.till.active(), true, "a stale owner flag without a recent visit is dropped");
  const now = Date.now();
  const w2 = page({ "oros-lock": CFG, "oros-till": TILL }, { "oros-till-owner": "1", "oros-lock-seen": String(now - 1000) });
  assert.equal(w2.orosLock.till.active(), false, "an update reload keeps the owner in");
});

test("turning the till on and off writes only the device-local switch", () => {
  const w = page({ "oros-lock": CFG }, { "oros-till-owner": "1" });
  assert.equal(w.orosLock.till.set(), false);
  assert.equal(w.orosLock.till.turn(true), true);
  assert.equal(w.localStorage.getItem("oros-till"), TILL);
  assert.equal(w.orosLock.till.active(), true, "the owner flag goes: the tab becomes the till");
  assert.equal(w.orosLock.till.turn(false), true);
  assert.equal(w.localStorage.getItem("oros-till"), null);
  assert.equal(w.orosLock.till.active(), false);
});

test("the owner's PIN check counts tries like the lock screen", () => {
  const src = read("lock.js");
  assert.match(src, /check: function \(secret\) \{[\s\S]{0,400}if \(!d \|\| typeof hooks\.duress !== "function"\) return checkCurrent\(s\);/);
  assert.match(src, /if \(ok\) \{ clearTries\(\); bioTyped\(\); if \(tillActive\(\)\) setOwner\(true\); unlock\(\); return; \}/, "the PIN on the lock screen lets the owner in");
  assert.match(src, /cfg && r && !tillActive\(\) && bioLinked\(\)/, "no fingerprint on the till: the helper's finger is not the owner's");
  assert.match(src, /lk-till-back/, "the lock screen has a way back to the till");
});

test("the shell runs a till-only device as a single app of Stock and refuses every other app", () => {
  const sh = read("shell.js");
  assert.match(sh, /var TILL = !SOLO && !!\(window\.orosLock && window\.orosLock\.till && window\.orosLock\.till\.active\(\)\);/);
  assert.match(sh, /if \(TILL\) \{ SOLO = "stock"; document\.body\.classList\.add\("till-mode"\); \}/);
  assert.match(sh, /if \(TILL && app && app\.id !== "stock"\) \{ window\.orosLock\.till\.ask\(\); return; \}/, "openApp gate");
  assert.match(sh, /if \(TILL\) return false;   \/\/ TILL-1: no shell shortcuts/);
  assert.match(sh, /TILL \? \[\["till\.owner", function \(\) \{ window\.orosLock\.till\.ask\(\); \}\]\]/, "the bar menu has only the owner's way in");
  assert.match(sh, /kind = \(window\.orosSolo\.APPS\[SOLO\] \|\| \{\}\)\.badge/, "Stock is not in the single-apps table");
  const css = read("style.css");
  ["#help-btn", "#oros-taskbar-bell", "#qs-btn"].forEach((id) => assert.ok(css.includes("body.till-mode " + id), id + " hidden on the till"));
});

test("the till asks the owner for voids, settings, events, price lists and a discount over the limit", () => {
  const js = read("stock/pos.js");
  assert.match(js, /owner\(function \(\) \{ evDialog\(/);
  assert.match(js, /owner\(function \(\) \{ plDialog\(/);
  assert.match(js, /owner\(setupDialog\)/);
  assert.match(js, /owner\(function \(\) \{ api\.voidSale\(saved\.id\); paint\(\); \}\)/, "the undo after a sale is a void");
  assert.match(js, /owner\(function \(\) \{ api\.confirm\(t\("voidQ"/, "void in the Z");
  assert.match(js, /if \(isTill\(\)\) \{ owner\(function \(\) \{ capOk = true; charge\(true\); capOk = false; \}, t\("ownDisc"/);
  assert.match(js, /api\.budgetReady\(\) && !isTill\(\)/, "no Budget from the till (another app)");
  assert.match(js, /if \(!till\) tools\.appendChild\(btn\(t\("close"\)/, "the till has no Close");
  assert.match(js, /if \(r && r\.ok\) \{ dlg\.close\(\); fn\(\); return; \}/, "only an accepted PIN runs the action");
  assert.deepEqual((js.match(/innerHTML\s*=\s*[^;]+;/g) || []).filter((x) => !/innerHTML\s*=\s*"";/.test(x)), [], "innerHTML only ever cleared");
  const st = read("stock/stock.js");
  assert.match(st, /if \(tillActive\(\)\) \{ document\.body\.classList\.add\("till-only"\); openPos\(\); \}/);
  assert.match(read("stock/stock.css"), /body\.till-only > :not\(dialog\):not\(#toast\) \{ visibility: hidden; \}/, "Stock's own screens (costs) stay hidden");
});

test("every new string is in English, Greek and German", () => {
  const js = read("stock/pos.js");
  const keys = ["ownT", "ownTPass", "ownHint", "ownHintPass", "ownOk", "ownWrong", "ownWait", "ownOff", "ownDisc",
    "tillT", "tillHint", "tillGo", "tillStop", "tillIs", "tillNeedLock", "tillLock", "tillQ", "tillStopped"];
  const en = js.slice(js.indexOf("en: {"), js.indexOf("el: {"));
  const el = js.slice(js.indexOf("el: {"));
  const de = read("i18n/de/stock.js");
  keys.forEach((k) => {
    assert.match(en, new RegExp("\\b" + k + ": \""), "en " + k);
    assert.match(el, new RegExp("\\b" + k + ": \""), "el " + k);
    assert.match(de, new RegExp("\"" + k + "\": \""), "de " + k);
  });
  const tr = read("translations.js"), dsh = read("i18n/de/shell.js");
  ["lock.till.hint", "lock.till.back", "till.owner"].forEach((k) => {
    assert.equal((tr.match(new RegExp("\"" + k.replace(/\./g, "\\.") + "\":")) || []).length >= 1, true, k);
    assert.equal(tr.split("\"" + k + "\":").length - 1, 2, k + " in en and el");
    assert.ok(dsh.includes("\"" + k + "\":"), "de " + k);
  });
});

test("Sensitive work wins on a till-only device: Hardcore asks at start, the duress PIN works at the till", () => {
  const src = read("lock.js");
  assert.match(src, /else if \(tillOn\(\) && strictLevel\(\) !== "hard"\) setOwner\(false\);/, "Hardcore: a fresh start still asks");
  const check = src.slice(src.indexOf("      check: function (secret) {"), src.indexOf("      ask: function () { return lock(\"owner\"); }"));
  assert.match(check, /duressLive\(\)/, "the till's owner check knows the duress secret");
  assert.match(check, /hooks\.duress\(!!\(r && r\.cloud\)\)/, "and starts the same wipe as the lock screen");
  assert.match(check, /if \(waitMs\(\)\) return Promise\.resolve\(\{ ok: false, code: "wait"/, "the wait after wrong tries holds first");
});
