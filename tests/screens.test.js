// Second screen (wave SS1): screens.js picks the other screen and
// places a window on it; the shell moves an app there and never keeps
// two live copies of one app.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const S = require("../screens.js");
const SHELL = fs.readFileSync(path.join(ROOT, "shell.js"), "utf8");

function scr(o) {
  return Object.assign({ left: 0, top: 0, width: 1920, height: 1080, availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1040, devicePixelRatio: 1 }, o);
}

test("pickOther: none with one screen or no details", () => {
  assert.equal(S.pickOther(null), null);
  const a = scr({ isPrimary: true });
  assert.equal(S.pickOther({ screens: [a], currentScreen: a }), null);
});

test("pickOther: the screen this window is not on, an external one first", () => {
  const laptop = scr({ isInternal: true, isPrimary: true, width: 1366, height: 768, availWidth: 1366, availHeight: 728 });
  const tv = scr({ left: 1366, availLeft: 1366, isPrimary: false });
  const mon = scr({ left: -1920, availLeft: -1920, isPrimary: false, isInternal: false });
  assert.equal(S.pickOther({ screens: [laptop, tv], currentScreen: laptop }), tv);
  assert.equal(S.pickOther({ screens: [laptop, tv], currentScreen: tv }), laptop);
  // three screens, on the TV: the external monitor beats the laptop
  assert.equal(S.pickOther({ screens: [laptop, tv, mon], currentScreen: tv }), mon);
  // a current screen given as another object with the same box is still "here"
  assert.equal(S.pickOther({ screens: [laptop, tv], currentScreen: Object.assign({}, tv) }), laptop);
});

test("rectOf / features: the working area, else a window on this screen", () => {
  const tv = scr({ left: 1920, availLeft: 1920, availTop: 0, availWidth: 1920, availHeight: 1040 });
  assert.deepEqual(S.rectOf(tv), { left: 1920, top: 0, width: 1920, height: 1040 });
  assert.equal(S.features(tv), "popup=yes,left=1920,top=0,width=1920,height=1040");
  assert.equal(S.features(null), "popup=yes,width=1100,height=720");
  assert.equal(S.rectOf({ width: 10, height: 10 }), null);
  assert.equal(S.rectOf({ availWidth: "x", width: 1280, height: 720 }).width, 1280);
});

function fakeWin(details, state) {
  const opened = [];
  const w = {
    screen: { isExtended: details.screens.length > 1 },
    navigator: { permissions: { query: () => Promise.resolve({ state: state || "granted" }) } },
    getScreenDetails: () => Promise.resolve(details),
    open(url, name, feat) {
      const pop = { url, name, feat, closed: false, moves: [], moveTo(x, y) { this.moves.push(["move", x, y]); }, resizeTo(x, y) { this.moves.push(["size", x, y]); } };
      opened.push(pop);
      return pop;
    }
  };
  return { w, opened };
}

test("open: first time the window opens here, then moves to the other screen", async () => {
  S._reset();
  const here = scr({ isPrimary: true }), tv = scr({ left: 1920, availLeft: 1920 });
  const { w, opened } = fakeWin({ screens: [here, tv], currentScreen: here });
  assert.equal(S.available(w), true);
  const pop = S.open("/?open=notes", "oros-screen-notes", w);
  assert.equal(pop.feat, "popup=yes,width=1100,height=720");
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(pop.moves, [["move", 1920, 0], ["size", 1920, 1040]]);
  // known now: the next one opens straight there
  const pop2 = S.open("/?open=todo", "oros-screen-todo", w);
  assert.equal(pop2.feat, "popup=yes,left=1920,top=0,width=1920,height=1040");
  assert.equal(opened.length, 2);
  S._reset();
});

test("open: refused permission keeps the window where it opened", async () => {
  S._reset();
  const here = scr({}), tv = scr({ left: 1920, availLeft: 1920 });
  const { w } = fakeWin({ screens: [here, tv], currentScreen: here });
  w.getScreenDetails = () => Promise.reject(new Error("NotAllowedError"));
  const pop = S.open("/x", "n", w);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(pop.moves, []);
  S._reset();
});

test("available: false without the API or with one screen", async () => {
  S._reset();
  assert.equal(S.available({ screen: { isExtended: true } }), false);
  const one = scr({});
  const { w } = fakeWin({ screens: [one], currentScreen: one });
  assert.equal(S.available(w), false);   // isExtended false
  assert.equal(await S.permission({}), "unsupported");
  S._reset();
});

test("list: labels, pixels, which one is here", async () => {
  S._reset();
  const here = scr({ label: "Built-in", isInternal: true, isPrimary: true, devicePixelRatio: 1.5, width: 1280, height: 800 });
  const tv = scr({ left: 1280, availLeft: 1280, label: "TV" });
  const { w } = fakeWin({ screens: [here, tv], currentScreen: here });
  const l = await S.list(w);
  assert.deepEqual(l[0], { label: "Built-in", w: 1920, h: 1200, primary: true, current: true, internal: true });
  assert.equal(l[1].current, false);
  S._reset();
});

test("shell: Ctrl+Alt+Shift+B moves the app (stable id 'screen'), openApp asks the other screen first", () => {
  assert.match(SHELL, /\{ id: "screen", key: "b", label: "sc\.desc\.screen", fn: function\(\) \{ scrMove\(\); \} \}/);
  const keys = (SHELL.match(/\{ (?:id: "[a-z]+", )?key: "([a-z])"/g) || []).map((m) => m.slice(-2, -1));
  assert.equal(new Set(keys).size, keys.length, "a letter is used twice in SC_DEFS");
  const open = SHELL.slice(SHELL.indexOf("function openApp(app, at) {"));
  assert.ok(open.indexOf("scrElsewhere(app)") > 0 && open.indexOf("scrElsewhere(app)") < open.indexOf("davBgStop(app.id)"));
  // moving never leaves the app open here too
  const mv = SHELL.slice(SHELL.indexOf("function scrMove("), SHELL.indexOf("function scrLeave("));
  assert.match(mv, /scrWins\[app\.id\] = w;\s*scrLeave\(app\.id\);/);
});

test("translations: the second-screen strings exist in English, Greek and German", () => {
  const T = fs.readFileSync(path.join(ROOT, "translations.js"), "utf8");
  const DE = fs.readFileSync(path.join(ROOT, "i18n/de/shell.js"), "utf8");
  ["sc.desc.screen", "scr.move", "scr.none", "scr.noapp", "scr.blocked", "scr.moved", "scr.there", "scr.back"].forEach((k) => {
    assert.equal((T.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length, 2, k);
    assert.ok(DE.includes('"' + k + '":'), k + " (de)");
  });
});
