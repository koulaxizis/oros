// LOOK-1: the same look on every computer (Chris 2026-11-28, proposals
// 3, 4 and 8 of the sync check). The "look" slice of shell.js carries
// the smart bar, Dock, widgets, menu icon, font, motion, interface
// sounds and Accent from wallpaper between computers, per entry with
// its own stamp, verbatim (FWD-1: what a newer orOS wrote survives).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SHELL = fs.readFileSync(path.join(__dirname, "..", "shell.js"), "utf8");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

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
const block = (re) => { const m = SHELL.match(re); if (!m) throw new Error("missing " + re); return m[0]; };

// One computer: the real look code of shell.js over its own storage.
function computer(opts) {
  opts = opts || {};
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const env = { applied: [], dirty: 0, here: opts.here !== false };
  const src = [
    block(/var LOOK_OFF_KEY = [^;]+;/),
    block(/var LOOK_STAMPS_KEY = [^;]+;/),
    block(/var LOOK_AHEAD_KEY = [^;]+;/),
    block(/var LOOK_PASS_KEY = [^;]+;/),
    block(/var LOOK_ENTRIES = \{[^}]+\};/),
    block(/var LOOK_NAMES = [^;]+;/),
    block(/var LOOK_VMAX = [^;]+;/),
    block(/var LOOK_MAX = [^;]+;/),
    block(/var LOOK_NAME_RE = [^;]+;/),
    block(/var LOOK_SEED = [^;]+;/),
    "var lookReg = true;",
    "var LOOK_HERE = ENV.here;",
    "function lookApply(n) { ENV.applied.push(n.slice()); }",
    "var window = { orosSync: { markDirty: function () { ENV.dirty++; } } };",
    ...["lookOn", "lookActive", "lookHash", "lookSeed", "lookRaw", "lookJson", "lookEntry", "lookSide",
        "lookWins", "lookBuild", "lookMerge", "lookStamps", "lookOwn", "lookSliceGet", "lookSliceSet", "lookPoke"].map((n) => cut(SHELL, n)),
    "return { lookSliceGet, lookSliceSet, lookMerge, lookPoke, lookSide, LOOK_ENTRIES, LOOK_SEED };",
  ].join("\n");
  const api = new Function("localStorage", "ENV", src)(localStorage, env);
  api.store = store;
  api.env = env;
  api.ls = localStorage;
  // What sync.js does at a reconcile: merge(local, cloud), apply, return what goes up.
  api.sync = (cloud) => {
    const local = api.lookSliceGet();
    const merged = cloud ? api.lookMerge(JSON.parse(JSON.stringify(local)), JSON.parse(JSON.stringify(cloud))) : local;
    api.lookSliceSet(JSON.parse(JSON.stringify(merged)));
    const after = api.lookSliceGet();
    return after;
  };
  return api;
}

const realNow = Date.now;
function at(ms, fn) { Date.now = () => ms; try { return fn(); } finally { Date.now = realNow; } }

test("LOOK-1: the slice carries each entry verbatim with its own stamp, sorted", () => {
  const a = computer();
  a.ls.setItem("oros-smartbar", '{"v":1,"list":["event","water"],"look":"glass"}');
  a.ls.setItem("oros-feel", "calm");
  const s = at(1.8e12, () => a.lookSliceGet());
  assert.equal(s.v, 1);
  assert.deepEqual(Object.keys(s.e), Object.keys(a.LOOK_ENTRIES).sort());
  assert.equal(s.e.smartbar.v, '{"v":1,"list":["event","water"],"look":"glass"}');
  assert.equal(s.e.feel.v, "calm");
  assert.equal(s.e.dock.v, null);
  assert.equal(s.e.dock.t, 0, "not set = stamp 0");
  assert.ok(s.e.feel.t > 0 && s.e.feel.t < a.LOOK_SEED, "found the first time = a seed under every real stamp");
});

test("LOOK-1: a change on one computer reaches the other, nothing else moves", () => {
  const pc = computer(), usb = computer();
  pc.ls.setItem("oros-smartbar", '{"v":1,"list":["event"],"look":"glass"}');
  let cloud = at(1.8e12, () => pc.sync(null));
  cloud = at(1.8e12 + 1000, () => usb.sync(cloud));
  assert.equal(usb.ls.getItem("oros-smartbar"), '{"v":1,"list":["event"],"look":"glass"}');
  assert.deepEqual(usb.env.applied, [["smartbar"]]);
  // a later change on the USB wins on the PC
  usb.ls.setItem("oros-feel", "bouncy");
  cloud = at(1.8e12 + 5000, () => usb.sync(cloud));
  cloud = at(1.8e12 + 6000, () => pc.sync(cloud));
  assert.equal(pc.ls.getItem("oros-feel"), "bouncy");
  // both agree now and another round changes nothing (no endless uploads)
  const again = at(1.8e12 + 9000, () => pc.sync(cloud));
  assert.deepEqual(again, cloud);
  assert.deepEqual(at(1.8e12 + 9500, () => usb.sync(cloud)), cloud);
});

test("LOOK-1: per entry, the newer change wins; a reset to the default travels too", () => {
  const a = computer(), b = computer();
  a.ls.setItem("oros-menuicon", "leaf");
  let cloud = at(1.8e12, () => a.sync(null));
  cloud = at(1.8e12 + 10, () => b.sync(cloud));
  assert.equal(b.ls.getItem("oros-menuicon"), "leaf");
  b.ls.removeItem("oros-menuicon");                        // back to the default grid
  a.ls.setItem("oros-feel", "calm");                       // something else on A at the same time
  cloud = at(1.8e12 + 100, () => b.sync(cloud));
  cloud = at(1.8e12 + 200, () => a.sync(cloud));
  assert.equal(a.ls.getItem("oros-menuicon"), null, "the reset reached A");
  cloud = at(1.8e12 + 300, () => b.sync(cloud));
  assert.equal(b.ls.getItem("oros-feel"), "calm", "A's other change reached B");
});

test("LOOK-1: the computer that had the look first keeps it; a newly joined one takes it", () => {
  const pc = computer(), usb = computer();
  pc.ls.setItem("oros-widgets", '{"v":1,"list":["clock","media"]}');
  usb.ls.setItem("oros-widgets", '{"v":1,"list":["start","clock","calendar","today","weather"]}');   // its first-run defaults
  let cloud = at(Date.parse("2026-11-28T10:00:00Z"), () => pc.sync(null));
  cloud = at(Date.parse("2026-11-29T18:00:00Z"), () => usb.sync(cloud));
  assert.equal(usb.ls.getItem("oros-widgets"), '{"v":1,"list":["clock","media"]}', "the USB took the PC's widgets although its own text is larger");
  cloud = at(Date.parse("2026-11-29T18:01:00Z"), () => pc.sync(cloud));
  assert.equal(pc.ls.getItem("oros-widgets"), '{"v":1,"list":["clock","media"]}');
});

test("LOOK-1 FWD-1: a value and an entry of a newer orOS survive an older one", () => {
  const newer = computer(), older = computer();
  // a Dock style this orOS may not know, and an entry it surely does not
  newer.ls.setItem("oros-launcher-prefs", '{"on":true,"style":"aurora","size":"l"}');
  let cloud = at(1.8e12, () => newer.sync(null));
  cloud.e.ribbon = { v: '{"v":2}', t: 1.8e12 };
  cloud = at(1.8e12 + 50, () => older.sync(cloud));
  assert.equal(older.ls.getItem("oros-launcher-prefs"), '{"on":true,"style":"aurora","size":"l"}', "stored verbatim");
  assert.equal(older.ls.getItem("ribbon"), null, "an unknown entry is never written to its own key");
  assert.deepEqual(JSON.parse(older.ls.getItem("oros-look-ahead")).ribbon, { v: '{"v":2}', t: 1.8e12 });
  // the older one sends both on unchanged: nothing differs from the cloud
  const up = at(1.8e12 + 60, () => older.lookSliceGet());
  assert.deepEqual(up, cloud);
  // a change the older one makes to another entry keeps the newer entry
  older.ls.setItem("oros-feel", "calm");
  cloud = at(1.8e12 + 70, () => older.sync(cloud));
  assert.equal(cloud.e.ribbon.v, '{"v":2}');
  assert.equal(cloud.e.dock.v, '{"on":true,"style":"aurora","size":"l"}');
});

test("LOOK-1: junk from the cloud is dropped, a merge is symmetric and deterministic", () => {
  const a = computer();
  const junk = { v: 1, e: { feel: { v: 7, t: 5 }, menuicon: { v: "leaf", t: -1 }, "Bad-Name": { v: "x", t: 9 },
    zoom: { v: "0", t: 3 }, smartbar: { v: "x".repeat(20000), t: 9 } } };
  assert.deepEqual(a.lookSide(junk), { zoom: { v: "0", t: 3 } });
  const x = { v: 1, e: { feel: { v: "calm", t: 10 }, dock: { v: "a", t: 4 } } };
  const y = { v: 1, e: { feel: { v: "bouncy", t: 10 }, dock: { v: "b", t: 5 }, zoom: { v: null, t: 2 } } };
  assert.deepEqual(a.lookMerge(x, y), a.lookMerge(y, x));
  assert.deepEqual(a.lookMerge(x, y).e, { dock: { v: "b", t: 5 }, feel: { v: "calm", t: 10 }, zoom: { v: null, t: 2 } });
});

test("LOOK-1: switched off, this computer hands back the cloud copy and applies nothing", () => {
  const a = computer();
  a.ls.setItem("oros-feel", "calm");
  a.ls.setItem("oros-look", "0");
  const cloud = { v: 1, e: { feel: { v: "bouncy", t: 1.9e12 } } };
  a.lookSliceSet(cloud);
  assert.equal(a.ls.getItem("oros-feel"), "calm");
  assert.deepEqual(a.lookSliceGet(), cloud);
  assert.deepEqual(a.env.applied, []);
});

test("LOOK-1: a change made here is stamped and asks for an upload once", () => {
  const a = computer();
  at(1.8e12, () => a.lookSliceGet());
  a.ls.setItem("oros-uisounds", '{"on":true,"pack":"keys","vol":40}');
  at(1.8e12 + 1, () => a.lookPoke());
  at(1.8e12 + 2, () => a.lookPoke());
  assert.equal(a.env.dirty, 1);
  assert.equal(at(1.8e12 + 3, () => a.lookSliceGet()).e.uisounds.t, 1.8e12 + 1);
});

test("LOOK-1: wiring: computers only, switch in Settings, scope labels, What syncs, EN/EL/DE", () => {
  assert.match(SHELL, /registerLookSlice\(\);\s+\/\/ LOOK-1/);
  assert.match(SHELL, /registerSlice\("look", lookSliceGet, lookSliceSet, null, lookMerge\)/);
  assert.match(SHELL, /if \(lookReg \|\| !lookActive\(\)/, "not registered on a phone or while off");
  assert.match(SHELL, /\(hover: hover\) and \(pointer: fine\)"\)\.matches\) &&\s+Math\.max\(sc\.width \|\| 0, sc\.height \|\| 0\) >= 1024/);
  assert.match(SHELL, /case "look":\s+lookSetUser\(!!value\)/);
  assert.match(read("smartbar.js"), /reload: function \(\)/);
  const C = require("../settings/core.js");
  ["smartbar", "dock", "widgets", "menuicon", "wpaccent", "zoom", "uisounds", "sb-island"].forEach((k) => assert.equal(C.scopeOf(k), "computers", k));
  ["theme", "wallpaper", "icons"].forEach((k) => assert.equal(C.scopeOf(k), "all", k));
  const set = read("settings/settings.js");
  assert.match(set, /if \(scope === "computers" && !\(lookNow && lookNow\.active\)\) scope = "device";/);
  assert.match(set, /set\("look", v\)/);
  assert.match(set, /secWhatSyncs\(host, s\)/);
  const de = read("i18n/de/settings.js");
  const keys = ["scope.computers", "scope.computers.title", "a.look", "a.look.on", "a.look.hint", "a.look.off", "w.look",
    "ws.title", "ws.open", "ws.hint", "ws.all", "ws.pc", "ws.dev", "ws.pc.on", "ws.pc.off", "ws.pc.phone"];
  const groups = set.match(/var WS_GROUPS = (\[[^;]+\]);/)[1];
  JSON.parse(groups).forEach(([g, n]) => { for (let i = 1; i <= n; i++) keys.push("ws." + g + "." + i); });
  keys.forEach((k) => {
    assert.ok(C.STRINGS.en[k], "en " + k);
    assert.ok(C.STRINGS.el[k], "el " + k);
    assert.ok(de.includes(JSON.stringify(k) + ":"), "de " + k);
  });
});
