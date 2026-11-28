// The top bar's island (ISLAND-1, video ideas 2026-11-23 #20): the
// stored switch, when it shows, which cards move into it, the media
// part's model, Music's synced line and the wiring in shell / Settings.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const M = require("../smartbar.js");
const I = require("../smartbar-island.js");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("stored: island kept only as true, off by default", () => {
  assert.deepStrictEqual(M.parse('{"v":1,"list":["event"],"island":true}'), { v: 1, list: ["event"], island: true });
  assert.deepStrictEqual(M.parse('{"v":1,"list":["event"],"island":"yes"}'), { v: 1, list: ["event"] });
  assert.deepStrictEqual(M.parse('{"v":1,"list":["event"],"island":false}'), { v: 1, list: ["event"] });
  assert.strictEqual(M.islandOf(null), false);
  assert.strictEqual(M.islandOf({ v: 1, list: [] }), false);
  assert.strictEqual(M.islandOf({ v: 1, list: [], island: true }), true);
});

test("shown only when on, wide enough and not in the Dock", () => {
  const on = { v: 1, list: [], island: true };
  assert.strictEqual(M.ISLAND_W, 760);
  assert.strictEqual(M.islandShown(on, 760, false), true);
  assert.strictEqual(M.islandShown(on, 759, false), false, "phones and narrow windows keep today's bar");
  assert.strictEqual(M.islandShown(on, 1400, true), false, "cards in the Dock: no island");
  assert.strictEqual(M.islandShown({ v: 1, list: [] }, 1400, false), false, "off by default");
  assert.strictEqual(M.islandShown(on, undefined, false), false);
});

test("split: live pills into the island, Now playing leaves the row", () => {
  const row = ["tmr", "sw", "rec", "event", "playing", "tasks"];
  assert.deepStrictEqual(M.islandSplit(row, false), { row: row, isl: [] });
  assert.deepStrictEqual(M.islandSplit(row, true), { row: ["event", "tasks"], isl: ["tmr", "sw", "rec"] });
  const r2 = M.islandSplit(row, false);
  r2.row.push("x");
  assert.strictEqual(row.length, 6, "the list given is never changed");
});

test("pick: what plays wins, a paused player stays a while, then lets go", () => {
  const a = { id: "music", playing: false, title: "A · B" }, b = { id: "radio", playing: true, title: "R" };
  assert.strictEqual(I.model.pick([a, b], "", 0, 1000, false), b);
  assert.strictEqual(I.model.pick([a, { id: "radio", playing: false }], "music", 1000, 1000 + 29000, false), a);
  assert.strictEqual(I.model.pick([a], "music", 1000, 1000 + 31000, false), null, "paused 30 s: gone");
  assert.strictEqual(I.model.pick([a], "music", 1000, 1000 + 99000, true), a, "kept while open");
  assert.strictEqual(I.model.pick([a], "", 0, 5000, false), null, "a paused player never shown before");
  const c = { id: "podcasts", playing: true };
  assert.strictEqual(I.model.pick([b, c], "podcasts", 0, 1, false), c, "the one shown before wins when several play");
  assert.strictEqual(I.model.pick(null, "", 0, 0, false), null);
  assert.strictEqual(I.model.pick([null, 3, "x"], "", 0, 0, false), null);
});

test("progress and time", () => {
  assert.strictEqual(I.model.fmt(0), "0:00");
  assert.strictEqual(I.model.fmt(62.9), "1:02");
  assert.strictEqual(I.model.fmt(3725), "1:02:05");
  assert.strictEqual(I.model.fmt(-5), "0:00");
  assert.strictEqual(I.model.fmt("x"), "0:00");
  assert.deepStrictEqual(I.model.prog({ pos: 62, dur: 220 }), { pct: 28.2, at: "1:02", left: "-2:38" });
  assert.deepStrictEqual(I.model.prog({ pos: 500, dur: 220 }), { pct: 100, at: "3:40", left: "-0:00" });
  assert.strictEqual(I.model.prog({ pos: 5, dur: 0 }), null);
  assert.strictEqual(I.model.prog({ pos: 5, dur: 100, live: true }), null, "radio: no progress");
  assert.strictEqual(I.model.prog({ pos: 5, dur: Infinity }), null);
  assert.strictEqual(I.model.prog(null), null);
});

test("the thin line: lyric, else title; Sensitive work shows only the app", () => {
  const m = { id: "music", name: "Music", title: "Song · Artist" };
  assert.strictEqual(I.model.line(m, "We sing", false), "We sing");
  assert.strictEqual(I.model.line(m, "", false), "♪", "between lines");
  assert.strictEqual(I.model.line(m, null, false), "Song · Artist");
  assert.strictEqual(I.model.line(m, "We sing", true), "Music");
  assert.strictEqual(I.model.line({ id: "x", name: "Mixer", title: "" }, null, false), "Mixer");
  assert.strictEqual(I.model.line(null, "x", false), "");
  assert.deepStrictEqual(I.model.parts(m), { what: "Song", sub: "Artist" });
});

test("Music: the synced line now, from memory or this device's LRCLIB copy", () => {
  const src = read("music/host.js"), mu = read("music/music.js");
  assert.match(src, /lyrics: function \(k, lines\) \{/);
  assert.match(src, /lyricNow: function \(\) \{/);
  assert.match(src, /JSON\.parse\(localStorage\.getItem\("oros-music-lyrics"\)/, "same cache as music.js");
  assert.ok(!/lyricNow[\s\S]{0,900}fetch\(/.test(src), "never fetched from the bar");
  assert.match(mu, /var LY_KEY = "oros-music-lyrics"/);
  assert.match(mu, /lines = r\.lines;\n\s+if \(H && typeof H\.lyrics === "function"\) \{ try \{ H\.lyrics\(c\.k, lines\); \} catch \(e\) \{\} \}/);
  // The line at a time, as lyricNow reads it (core.js parseLrc + lrcAt).
  const vm = require("vm");
  const w = { console };
  w.window = w;
  vm.runInContext(read("music/core.js"), vm.createContext(w));
  const C = w.OrosMusicCore;
  assert.ok(C && typeof C.parseLrc === "function");
  const lines = C.parseLrc("[00:05.00]first\n[00:10.00]second\n[00:20.00]third").lines;
  assert.strictEqual(lines[C.lrcAt(lines, 12)].s, "second");
});

test("shell: cover and lyric reach the bar, never from a locked Music", () => {
  const sh = read("shell.js");
  assert.match(sh, /art: function \(title\) \{ return wgMediaArt\(title\); \},/);
  assert.match(sh, /if \(id !== "music" \|\| appLockSet\("music"\)\) return null;/);
  assert.match(sh, /return mu && typeof mu\.lyricNow === "function" \? mu\.lyricNow\(\) : null;/);
  assert.match(sh, /if \(name === "smartbar-island"\) \{[\s\S]{0,200}window\.orosSmartBar\.setIsland\(!!value\)/);
  assert.match(read("sw.js"), /"\.\/smartbar-island\.js",/, "precached");
});

test("bar: island holder, its file loaded only when on, no island in the bar window", () => {
  const src = read("smartbar.js");
  assert.match(src, /var islOn = islandShown\(stored\(\), root\.innerWidth, !!slot \|\| barWin\(\)\);/);
  assert.match(src, /if \(islOn\) \{ zs\.r = zs\.c\.concat\(zs\.r\); zs\.c = \[\]; \}/, "the island holds the centre");
  assert.match(src, /script\("smartbar-island\.js"/);
  assert.match(src, /setIsland: function \(on\) \{/);
  assert.match(src, /island: islandOf\(st\), islandW: ISLAND_W/);
  assert.match(src, /var lk = locked\(\);/, "nothing in the island while locked");
  const isl = read("smartbar-island.js");
  assert.deepStrictEqual(isl.match(/innerHTML\s*=[^;]*;/g), ["innerHTML = icon;"], "data only through textContent; icons are static");
  assert.ok(!/localStorage/.test(isl), "nothing stored");
  assert.match(isl, /if \(!m \|\| strict\(\)\) return null;/, "no lyric under Sensitive work");
  assert.match(isl, /if \(!m \|\| strict\(\)\) return "";/, "no cover under Sensitive work");
});

test("strings: Settings EN/EL/DE, shell EN/EL/DE, search words", () => {
  const set = read("settings/settings.js"), core = read("settings/core.js"), de = read("i18n/de/settings.js");
  assert.match(set, /switchBtn\(s\.smartbar\.island, "smartbar-island", function \(v\) \{ set\("smartbar-island", v\); \}/);
  assert.match(core, /\["sb-island", "appearance", "sb\.island", "sb\.title", null, "smartbar"\]/);
  ["sb.island", "sb.island.hint", "w.sb-island"].forEach((k) => {
    assert.strictEqual(core.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '":'), k + " in DE");
  });
  const tr = read("translations.js"), dsh = read("i18n/de/shell.js");
  ["sbi.label", "sbi.pos"].forEach((k) => {
    assert.strictEqual(tr.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
    assert.ok(dsh.includes('"' + k + '":'), k + " in DE");
  });
});
