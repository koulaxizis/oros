// Reduce motion and Reduce transparency (A11Y-FX W2): the matchMedia
// wrapper of i18n.js, the shell's marks and CSS, Settings and strings.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const I18N = read("i18n.js");
const SHIM = I18N.slice(0, I18N.indexOf("// i18n-inline-ok"));

// A window with a real-looking matchMedia (system: no reduced motion
// unless sysReduce), localStorage and "storage" listeners.
function fakeWin(sysReduce, stored) {
  const store = new Map(stored ? [["oros-a11y", JSON.stringify(stored)]] : []);
  const sysLs = [];
  const storageLs = [];
  const w = {
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    matchMedia(q) {
      const s = String(q).replace(/\s+/g, "");
      const matches = s === "(prefers-reduced-motion:reduce)" ? sysReduce : s === "(prefers-reduced-motion:no-preference)" ? !sysReduce : s === "(min-width:1px)";
      return { media: q, matches, addEventListener: (t, f) => sysLs.push(f), addListener: (f) => sysLs.push(f) };
    },
    addEventListener(t, f) { if (t === "storage") storageLs.push(f); },
    _write(v) { store.set("oros-a11y", JSON.stringify(v)); storageLs.forEach((f) => f({ key: "oros-a11y" })); }
  };
  vm.runInContext(SHIM, vm.createContext({ window: w, JSON, String, Object }));
  return w;
}

test("the switch makes the reduced-motion query match; other queries are untouched", () => {
  const off = fakeWin(false, { motion: false });
  assert.equal(off.matchMedia("(prefers-reduced-motion: reduce)").matches, false);
  const on = fakeWin(false, { motion: true });
  assert.equal(on.matchMedia("(prefers-reduced-motion: reduce)").matches, true);
  assert.equal(on.matchMedia("(prefers-reduced-motion:reduce)").matches, true);
  assert.equal(on.matchMedia("(prefers-reduced-motion: no-preference)").matches, false);
  assert.equal(on.matchMedia("(min-width: 1px)").matches, true);
  assert.equal(on.__orosMotion.on(), true);
  // the system's own request always wins
  const sys = fakeWin(true, { motion: false });
  assert.equal(sys.matchMedia("(prefers-reduced-motion: reduce)").matches, true);
  // nothing stored, or a broken value: the system decides
  assert.equal(fakeWin(false, null).matchMedia("(prefers-reduced-motion: reduce)").matches, false);
});

test("a list asked for earlier gets a change event when the switch flips, once", () => {
  const w = fakeWin(false, { motion: false });
  const mq = w.matchMedia("(prefers-reduced-motion: reduce)");
  const seen = [];
  mq.addEventListener("change", (e) => seen.push(e.matches));
  mq.onchange = (e) => seen.push("on:" + e.matches);
  w._write({ motion: true });                       // another document wrote it
  w.__orosMotion.refresh();                         // and the shell calls refresh too
  assert.equal(mq.matches, true);
  assert.deepEqual(seen, ["on:true", true]);
  w._write({ motion: false });
  assert.deepEqual(seen, ["on:true", true, "on:false", false]);
  const legacy = w.matchMedia("(prefers-reduced-motion: reduce)");
  let n = 0;
  legacy.addListener(() => n++);
  w._write({ motion: true });
  assert.equal(n, 1);
});

test("installed once per window; the shell can install it in a frame", () => {
  const w = fakeWin(false, { motion: true });
  const mm = w.matchMedia;
  vm.runInContext(SHIM, vm.createContext({ window: w, JSON, String, Object }));
  assert.equal(w.matchMedia, mm);
  assert.equal(typeof w.__orosMotionShim, "function");
  assert.equal(typeof w.__orosRealMatchMedia, "function");
  assert.ok(I18N.indexOf("motionShim(root);") < I18N.indexOf("if (window.orosI18n) return;"), "before the early return");
});

test("shell: fields, setters, marks, CSS, orosMotion, snapshot", () => {
  const s = read("shell.js");
  assert.match(s, /motion: v\.motion === true,\s+transp: v\.transp === true/);
  assert.match(s, /case "reduceMotion":\s+case "reduceTransparency":\s+case "keepGlass": a11ySetUser\(name, value\); return;/);
  assert.match(s, /a11yAttr\(r, "data-oros-motion", a11y\.motion \? "reduce" : null\);/);
  assert.match(s, /a11yAttr\(r, "data-oros-transparency", a11yLessTransp\(\) \? "reduce" : null\);/);
  assert.match(s, /if \(w && !w\.__orosMotion && window\.__orosMotionShim\)/);
  assert.match(s, /window\.orosMotion = \{ reduced: a11yLessMotion \};/);
  assert.match(s, /motion: a11y\.motion, motionSys: a11ySysMotion\(\),/);
  assert.match(s, /html\[data-oros-motion\] \*, html\[data-oros-motion\] \*::before/);
  assert.match(s, /animation-duration: 0\.01ms !important;/);
  assert.match(s, /html\[data-oros-transparency\] \*,[^"]*"\s*\+\s*" -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }/);
  const css = read("style.css");
  assert.match(css, /html\[data-oros-transparency\] #oros-bar,/);
  assert.match(css, /html\[data-oros-transparency\] #ld-dock \.ld-bar,/);
});

test("Settings card and strings in EN, EL and DE", () => {
  const st = read("settings/settings.js");
  assert.match(st, /if \("motion" in a\) \{/);
  assert.match(st, /set\("reduceMotion", v\)/);
  assert.match(st, /set\("reduceTransparency", v\)/);
  const core = require("../settings/core.js");
  assert.ok(core.findItem("motion") && core.findItem("transp"));
  const cs = read("settings/core.js"), de = read("i18n/de/settings.js");
  for (const k of ["ac.motion", "ac.motion.hint", "ac.motion.sys", "ac.transp", "ac.transp.hint", "ac.transp.sys", "ac.glass", "ac.glass.hint", "w.motion", "w.transp"]) {
    assert.equal(cs.split('"' + k + '":').length - 1, 2, k + " EN + EL");
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  }
});

test("GLASS-KEEP: the system's less transparency can be overruled, only through the shell's attribute", () => {
  const s = read("shell.js");
  assert.match(s, /transp: v\.transp === true,\s+glass: v\.glass === true/);
  assert.match(s, /function a11yLessTransp\(\) \{ return a11y\.transp \|\| \(!a11y\.glass && a11yMq\("\(prefers-reduced-transparency: reduce\)"\)\); \}/);
  assert.match(s, /name === "keepGlass"/);
  assert.match(s, /glass: a11y\.glass/);
  assert.match(read("settings/settings.js"), /if \(a\.transpSys && "glass" in a\)[\s\S]{0,200}set\("keepGlass", v\)/);
  // No CSS may follow the system query directly, or "Keep the glass" could not win.
  for (const f of ["style.css", "smartbar.js", "launcher.js", "widgets.js", "iconpacks.css"]) {
    assert.ok(!/prefers-reduced-transparency/.test(read(f)), f);
  }
});
