// FWD-1: values and fields of a newer orOS survive the shell slice of
// an older one (Chris 2026-11-28: the theme never reached orOS USB,
// whose orOS predates the Light show wallpaper, and the two devices
// uploaded their versions in turn).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SHELL = fs.readFileSync(path.join(__dirname, "..", "shell.js"), "utf8");

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
const line = (re) => { const m = SHELL.match(re); if (!m) throw new Error("missing " + re); return m[0]; };

// One "device": the real merge code of shell.js, with shellCanon cut
// down to what the test needs. `knows` = the wallpapers this orOS has.
function device(knows) {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const env = { vals: null, stamps: null, promoted: 0 };
  const src = [
    line(/var SHELL_FIELDS = \[[^\]]+\];/),
    line(/var TOMB_GRACE_MS = [^;]+;/),
    line(/var SHELL_AHEAD_KEY = [^;]+;/),
    line(/var AHEAD_MAX = [^;]+;/),
    line(/var AHEAD_VMAX = [^;]+;/),
    line(/var AHEAD_NAME_RE = [^;]+;/),
    line(/var SHELL_RESERVED = [^;]+;/),
    `function shellDefault(n) { return { lang: "en", theme: "dark", skin: "oros", wallpaper: "dusk", syncInterval: 3, autoexport: "off", wpart: null, wpland: null, wpviz: null, icons: "classic", fopen: {}, keys: {} }[n] || { on: false, auto: false, lat: null, lon: null, label: "" }; }`,
    `function shellCanon(n, v) {
       if (n === "wallpaper") return (typeof v === "string" && KNOWS.indexOf(v) >= 0) ? v : undefined;
       if (n === "weather") return (v && typeof v === "object") ? { on: !!v.on, auto: !!v.auto, lat: null, lon: null, label: "" } : undefined;
       if (n === "fopen" || n === "keys") return (v && typeof v === "object" && !Array.isArray(v)) ? v : undefined;
       if (n === "wpart" || n === "wpland" || n === "wpviz") return v === null ? null : undefined;
       if (n === "syncInterval") return typeof v === "number" ? v : undefined;
       return typeof v === "string" ? v : undefined;
     }`,
    "function shellNow() { return JSON.parse(JSON.stringify(ENV.vals)); }",
    "function shellStampsRefresh() { return JSON.parse(JSON.stringify(ENV.stamps)); }",
    "function alarmsRead() { return []; }",
    "function alarmTombsRead() { return {}; }",
    "function aheadPromote() { ENV.promoted++; }",
    ...["aheadOwn", "aheadName", "aheadVal", "aheadWins", "aheadRead", "aheadWrite",
        "alarmCanon", "alarmBetter", "alarmTombsClean", "alarmTombsLive", "alarmIsTimer", "alarmsCanonical",
        "shellSide", "shellBuild", "shellSliceGet", "shellMerge"].map((n) => cut(SHELL, n)),
    "return { shellSide, shellBuild, shellSliceGet, shellMerge, aheadRead, aheadWrite, SHELL_FIELDS };",
  ].join("\n");
  const api = new Function("localStorage", "KNOWS", "ENV", src)(localStorage, knows, env);
  const defaults = { lang: "en", theme: "dark", skin: "oros", wallpaper: "dusk", syncInterval: 3, autoexport: "off",
    weather: { on: false, auto: false, lat: null, lon: null, label: "" }, wpart: null, wpland: null, wpviz: null,
    icons: "classic", fopen: {}, keys: {} };
  env.vals = JSON.parse(JSON.stringify(defaults));
  env.stamps = Object.fromEntries(Object.keys(defaults).map((k) => [k, 0]));
  // What shellSliceSet does with a pulled (merged) slice, reduced to
  // the parts FWD-1 touches: known values applied with their stamps,
  // the rest kept in oros-shell-ahead.
  api.set = (data) => {
    const side = api.shellSide(data, Date.now());
    const ah = {};
    for (const n of api.SHELL_FIELDS) {
      if (side.f[n].ahead) { ah[n] = { v: side.f[n].v, t: side.f[n].t }; continue; }
      if (side.f[n].t > 0 || data[n] !== undefined) { env.vals[n] = side.f[n].v; env.stamps[n] = side.f[n].t; }
    }
    Object.assign(ah, side.ex);
    api.aheadWrite(ah);
  };
  api.env = env;
  api.store = store;
  return api;
}

const ALL = ["dusk", "mono", "viz"];
const OLD = ["dusk", "mono"];          // an orOS from before the Light show

// One pull on a device: merge local with the cloud, store, and say
// whether the device would upload (merge result differs from the cloud).
function pull(dev, cloud) {
  const local = dev.shellSliceGet();
  const merged = dev.shellMerge(JSON.parse(JSON.stringify(local)), JSON.parse(JSON.stringify(cloud)));
  dev.set(merged);
  const after = dev.shellSliceGet();
  return { stale: JSON.stringify(after) !== JSON.stringify(cloud), up: after };
}

test("an older orOS keeps a wallpaper it does not know, and uploads nothing", () => {
  const pc = device(ALL);
  pc.env.vals.wallpaper = "viz"; pc.env.stamps.wallpaper = 1795457471400;
  pc.env.vals.skin = "tux"; pc.env.stamps.skin = 1794416811867;
  const cloud = pc.shellSliceGet();

  const usb = device(OLD);
  const r = pull(usb, cloud);
  assert.equal(r.stale, false, "the USB's slice equals the cloud: no upload, no ping-pong");
  assert.equal(r.up.wallpaper, "viz");
  assert.equal(r.up.sm.wallpaper, 1795457471400);
  assert.equal(usb.env.vals.wallpaper, "dusk", "never applied here: this orOS cannot show it");
  assert.equal(usb.env.vals.skin, "tux", "known values are applied as before");
  assert.deepEqual(usb.aheadRead(), { wallpaper: { v: "viz", t: 1795457471400 } });

  // and the PC, pulling the USB's copy back, has nothing to do either
  const back = pull(pc, r.up);
  assert.equal(back.stale, false);
  assert.equal(pc.env.vals.wallpaper, "viz");
});

test("a newer choice on the older device wins and clears what was kept", () => {
  const pc = device(ALL);
  pc.env.vals.wallpaper = "viz"; pc.env.stamps.wallpaper = 1000;
  const usb = device(OLD);
  pull(usb, pc.shellSliceGet());
  usb.env.vals.wallpaper = "mono"; usb.env.stamps.wallpaper = 2000;     // picked on the USB later
  const up = usb.shellSliceGet();
  assert.equal(up.wallpaper, "mono");
  assert.equal(up.sm.wallpaper, 2000);
  assert.deepEqual(usb.aheadRead(), {}, "the losing value is forgotten");
  const r = pull(pc, up);
  assert.equal(pc.env.vals.wallpaper, "mono", "and it reaches the newer device");
  assert.equal(r.stale, false);
});

test("an older device's own newer stamp beats it in the merge too, both orders alike", () => {
  const usb = device(OLD);
  const a = { wallpaper: "viz", ver: 2, sm: { wallpaper: 1000 }, alarms: [], alarmTombs: {} };
  const b = { wallpaper: "mono", ver: 2, sm: { wallpaper: 2000 }, alarms: [], alarmTombs: {} };
  const ab = usb.shellMerge(a, b), ba = usb.shellMerge(b, a);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba));
  assert.equal(ab.wallpaper, "mono");
  const c = { wallpaper: "viz", ver: 2, sm: { wallpaper: 3000 }, alarms: [], alarmTombs: {} };
  assert.equal(usb.shellMerge(b, c).wallpaper, "viz");
  assert.equal(JSON.stringify(usb.shellMerge(b, c)), JSON.stringify(usb.shellMerge(c, b)));
});

test("fields a newer orOS added travel through an older one unchanged", () => {
  const usb = device(ALL);
  const cloud = usb.shellSliceGet();
  cloud.dock = { size: "l", style: "3d" };
  cloud.sm.dock = 1500;
  const r = pull(usb, cloud);
  assert.deepEqual(r.up.dock, { size: "l", style: "3d" });
  assert.equal(r.up.sm.dock, 1500);
  assert.equal(r.stale, false, "kept, so nothing is uploaded");
  // merge of two copies with different versions of the field: newer stamp
  const older = JSON.parse(JSON.stringify(cloud)); older.dock = { size: "s" }; older.sm.dock = 900;
  const m1 = usb.shellMerge(older, cloud), m2 = usb.shellMerge(cloud, older);
  assert.equal(JSON.stringify(m1), JSON.stringify(m2));
  assert.deepEqual(m1.dock, { size: "l", style: "3d" });
});

test("without anything from a newer orOS the slice is exactly what it was", () => {
  const d = device(ALL);
  const s = d.shellSliceGet();
  assert.deepEqual(Object.keys(s), ["lang", "theme", "skin", "wallpaper", "syncInterval", "autoexport", "alarms",
    "weather", "wpart", "wpland", "wpviz", "icons", "fopen", "keys", "ver", "sm", "alarmTombs"]);
  assert.deepEqual(Object.keys(s.sm), d.SHELL_FIELDS);
  assert.equal(d.store.has("oros-shell-ahead"), false);
});

test("reserved, odd or oversized fields are not carried", () => {
  const d = device(ALL);
  const x = d.shellSliceGet();
  x.__proto__x = 1; x["Bad"] = 1; x.big = "x".repeat(9000); x.fn = { ok: 1 };
  x.sm.fn = 5;
  const side = d.shellSide(x, Date.now());
  assert.deepEqual(Object.keys(side.ex), ["fn"]);
  assert.equal(side.ex.fn.t, 5);
});

test("once this orOS knows the value it is applied (promotion is asked for)", () => {
  const usb = device(OLD);
  usb.aheadWrite({ wallpaper: { v: "viz", t: 1000 } });
  usb.shellSliceGet();
  assert.equal(usb.env.promoted, 0, "still unknown: only carried");
  const updated = device(ALL);
  updated.aheadWrite({ wallpaper: { v: "viz", t: 1000 } });
  const s = updated.shellSliceGet();
  assert.equal(s.wallpaper, "viz");
  assert.equal(updated.env.promoted, 1);
});

test("shell.js: the pull keeps what is ahead, the getter and the merge carry it", () => {
  assert.match(cut(SHELL, "shellSliceSet"), /aheadWrite\(ahNew\)/);
  assert.match(cut(SHELL, "shellSliceGet"), /aheadRead\(\)/);
  assert.match(cut(SHELL, "shellMerge"), /, tombs, extras\);/);
  assert.match(cut(SHELL, "aheadPromote"), /shellSliceSet\(shellSliceGet\(\)\)/);
});
