// Wallpaper search, Random and From a folder (WPDIR-1, video ideas
// 2026-11-23 #7): a Files folder gives this device a new picture every
// day or at each start, in name order; nothing syncs; a pick by hand
// ends it. Random picks a drawn wallpaper other than the one on now.
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
const SEC = SHELL.slice(SHELL.indexOf("// ---------- 5b-dir. WPDIR-1"), SHELL.indexOf("// Another screen size (rotation"));

function helpers() {
  const pick = (name) => {
    const i = SEC.indexOf("  function " + name + "(");
    assert.ok(i >= 0, name);
    return SEC.slice(i, SEC.indexOf("\n  }\n", i) + 4);
  };
  const ctx = {};
  const head = SEC.slice(SEC.indexOf("  var WPDIR_KEY"), SEC.indexOf("  var wpdirMsg"));
  const walls = SHELL.slice(SHELL.indexOf("  var WALLPAPERS = ["), SHELL.indexOf("  ];", SHELL.indexOf("  var WALLPAPERS = [")) + 5);
  vm.runInNewContext(head + walls + pick("wpdirDir") + pick("wpdirParse") + pick("wpdirNext") + pick("wpdirDue") + pick("wpRandomId") +
    "this.dir = wpdirDir; this.parse = wpdirParse; this.next = wpdirNext; this.due = wpdirDue; this.rand = wpRandomId;", ctx);
  return ctx;
}

test("the record: off by default, the folder Pictures/Wallpapers, odd values fall back", () => {
  const h = helpers();
  const p = (raw) => JSON.parse(JSON.stringify(h.parse(raw)));
  assert.deepEqual(p(null), { mode: "", dir: "Pictures/Wallpapers", day: "", last: "" });
  assert.deepEqual(p("not json"), { mode: "", dir: "Pictures/Wallpapers", day: "", last: "" });
  assert.deepEqual(p(JSON.stringify({ mode: "day", dir: "Pictures/Sea", day: "2026-11-23", last: "a.jpg" })),
    { mode: "day", dir: "Pictures/Sea", day: "2026-11-23", last: "a.jpg" });
  assert.deepEqual(p(JSON.stringify({ mode: "hourly", dir: "../secret", day: "today", last: "x/y.jpg" })),
    { mode: "", dir: "Pictures/Wallpapers", day: "", last: "" });
});

test("a folder name stays inside the Files disk", () => {
  const { dir } = helpers();
  assert.equal(dir("Pictures/Wallpapers"), "Pictures/Wallpapers");
  assert.equal(dir("/internal/Pictures/Sea/"), "Pictures/Sea");
  assert.equal(dir("Pictures\\Sea"), "Pictures/Sea");
  assert.equal(dir("Εικόνες//Θάλασσα"), "Εικόνες/Θάλασσα");
  for (const bad of ["", "..", "Pictures/../..", "a/./b", " / ", "a\u0000b", "x".repeat(201), null]) assert.equal(dir(bad), null, String(bad));
});

test("pictures take turns by name and wrap round; other files and folders are skipped", () => {
  const { next } = helpers();
  const ls = [{ name: "b.png" }, { name: "notes.txt" }, { name: "a.JPG" }, { name: "c.webp" }, { name: "Old", dir: true }, { name: ".hidden.jpg" }, { name: "d.avif" }];
  assert.equal(next(ls, ""), "a.JPG");
  assert.equal(next(ls, "a.JPG"), "b.png");
  assert.equal(next(ls, "c.webp"), "d.avif");
  assert.equal(next(ls, "d.avif"), "a.JPG", "wraps round");
  assert.equal(next(ls, "gone.jpg"), "a.JPG", "a removed picture: the next by name");
  assert.equal(next([{ name: "x.txt" }, { name: "y", dir: true }], ""), null);
  assert.equal(next(null, ""), null);
});

test("due: every day once a day, at each start once per start, off never", () => {
  const { due } = helpers();
  assert.equal(due({ mode: "day", day: "2026-11-22" }, "2026-11-23", true), true);
  assert.equal(due({ mode: "day", day: "2026-11-23" }, "2026-11-23", false), false);
  assert.equal(due({ mode: "start", day: "2026-11-23" }, "2026-11-23", false), true);
  assert.equal(due({ mode: "start", day: "" }, "2026-11-23", true), false);
  assert.equal(due({ mode: "", day: "" }, "2026-11-23", false), false);
});

test("Random: a drawn wallpaper, never Mine, Living land, Light show, None or the one on now", () => {
  const { rand } = helpers();
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(rand("dusk", () => i / 200));
  assert.ok(!seen.has("dusk"));
  for (const no of ["custom", "land", "viz", "clear"]) assert.ok(!seen.has(no), no);
  assert.ok(seen.has("midnight") && seen.has("dots"));
  assert.equal(rand("dusk", () => 0.999999), "dots");
});

test("wiring: the folder runs through setImage (this device only); a pick by hand ends it", () => {
  // WPPIC-1: `true` = this device only (setImage local: no disk copy, the synced choice waits)
  assert.match(SEC, /sendWallpaper\(\{ path: dir \+ "\/" \+ name, max: WP_PIC_MAX \}, true\)/);
  assert.match(SEC, /if \(wpdirBusy \|\| SOLO\) return/);
  assert.match(SHELL, /case "wallpaper":[\s\S]{0,200}wpdirOff\(\);[\s\S]{0,120}setWallpaperUser\(value\)/);
  assert.match(SHELL, /case "wallpaper:random":[\s\S]{0,200}wpRandomId\(/);
  assert.match(SHELL, /case "wpdir:mode": wpdirSet\("mode"/);
  assert.match(SHELL, /wpdir: wpdirSnapshot\(\)/);
});

test("Settings: find, Random and From a folder, strings in EN, EL and DE", () => {
  const S = read("settings/settings.js");
  assert.match(S, /"wall:find"/);
  assert.match(S, /set\("wallpaper:random", 1\)/);
  assert.match(S, /function secWpDir\(c, d\)/);
  const core = require(path.join(ROOT, "settings/core.js"));
  const de = read("i18n/de/settings.js");
  const keys = ["a.wallpaper.find", "a.wallpaper.find.none", "a.wallpaper.random", "a.wpdir", "a.wpdir.when", "a.wpdir.mode.off",
    "a.wpdir.mode.day", "a.wpdir.mode.start", "a.wpdir.folder", "a.wpdir.next", "a.wpdir.msg.ok", "a.wpdir.msg.empty",
    "a.wpdir.msg.nofolder", "a.wpdir.msg.big", "a.wpdir.msg.fail", "a.wpdir.hint"];
  for (const k of keys) {
    for (const L of ["en", "el"]) assert.notEqual(core.t(L, k), k, L + " " + k);
    assert.ok(de.includes('"' + k + '"'), "de " + k);
  }
  assert.ok(core.findItem("wpdir"));
});
