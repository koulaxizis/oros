// Device Info helpers (device/core.js): who owns a storage key, sizes
// per app, byte formatting, user-agent parsing, feature impact and
// the plain-text report. Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "device");
const C = require(path.join(DIR, "core.js"));
const APPS = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "apps.json"), "utf8"))
  .apps.map((a) => a.id);
const IDS = ["weather", "time", "calendar", "petworld", "wallpaper", "todo", "notes",
             "g2048", "wordle", "maps", "dice"];

test("keyOwner: app ids, prefixes and the longest match", () => {
  assert.equal(C.keyOwner("oros-todo-data", IDS), "todo");
  assert.equal(C.keyOwner("oros-todo", IDS), "todo");
  assert.equal(C.keyOwner("oros-g2048-session", IDS), "g2048");
  assert.equal(C.keyOwner("oros-wordle-data-broken", IDS), "wordle");
  // "notes" must not swallow a longer id, nor a lookalike prefix.
  assert.equal(C.keyOwner("oros-notesx-data", IDS), "_shell");
  assert.equal(C.keyOwner("oros-dice-data", IDS.concat(["dicex"])), "dice");
});

test("keyOwner: aliases, shell keys and foreign keys", () => {
  assert.equal(C.keyOwner("oros-wx-cache", IDS), "weather");
  assert.equal(C.keyOwner("oros-weatherapp-data", IDS), "weather");
  assert.equal(C.keyOwner("oros-cal-reminders-fired", IDS), "calendar");
  assert.equal(C.keyOwner("oros-petgarden-data", IDS), "petworld");
  assert.equal(C.keyOwner("oros-alarms", IDS), "time");
  assert.equal(C.keyOwner("oros-pet-data", IDS), "_pet");
  assert.equal(C.keyOwner("oros-sync-dirty", IDS), "_shell");
  assert.equal(C.keyOwner("oros-lang", IDS), "_shell");
  // The desktop wallpaper travels in the shell slice, the app's own keys do not.
  assert.equal(C.keyOwner("oros-wallpaper", IDS), "_shell");
  assert.equal(C.keyOwner("oros-wallpaper-art", IDS), "_shell");
  assert.equal(C.keyOwner("oros-wallpaper-prefs", IDS), "wallpaper");
  assert.equal(C.keyOwner("something-else", IDS), "_other");
  assert.equal(C.keyOwner("", IDS), "_other");
  // An alias to an app that is not installed falls back to the shell.
  assert.equal(C.keyOwner("oros-wx-cache", ["todo"]), "_shell");
});

test("keyOwner: the sync slice registry wins for a registered key", () => {
  const slices = { todo: "oros-todo-data", radio: "oros-radio-data", shell: "oros-shell" };
  assert.equal(C.keyOwner("oros-radio-data", ["todo", "radio"], slices), "radio");
  assert.equal(C.keyOwner("oros-todo-data", ["todo"], slices), "todo");
  assert.equal(C.keyOwner("oros-odd-store", ["odd"], { odd: "oros-odd-store" }), "odd");
});

test("keyOwner: every app in apps.json owns its own data key", () => {
  APPS.forEach((id) => {
    assert.equal(C.keyOwner("oros-" + id + "-data", APPS), id, id);
    assert.equal(C.keyOwner("oros-" + id + "-prefs", APPS), id, id);
  });
});

test("sizeByOwner: UTF-16 bytes of key + value, grouped and sorted", () => {
  const rows = C.sizeByOwner([
    { key: "oros-todo-data", len: 100 },
    { key: "oros-todo-prefs", len: 10 },
    { key: "oros-notes-data", len: 500 },
    { key: "oros-lang", len: 2 },
    { key: "foreign", len: 0 }
  ], IDS);
  assert.deepEqual(rows.map((r) => r.owner), ["notes", "todo", "_shell", "_other"]);
  assert.equal(rows[0].bytes, ("oros-notes-data".length + 500) * 2);
  assert.equal(rows[1].bytes, ("oros-todo-data".length + 100 + "oros-todo-prefs".length + 10) * 2);
  assert.equal(rows[1].keys, 2);
  assert.equal(C.totalBytes(rows), rows.reduce((n, r) => n + r.bytes, 0));
  assert.deepEqual(C.sizeByOwner([], IDS), []);
  assert.deepEqual(C.sizeByOwner(null, IDS), []);
});

test("sizeByOwner: equal sizes keep a stable order", () => {
  const a = C.sizeByOwner([{ key: "oros-dice-x", len: 1 }, { key: "oros-maps-x", len: 1 }], IDS);
  const b = C.sizeByOwner([{ key: "oros-maps-x", len: 1 }, { key: "oros-dice-x", len: 1 }], IDS);
  assert.deepEqual(a, b);
});

test("formatBytes", () => {
  assert.equal(C.formatBytes(0), "0 B");
  assert.equal(C.formatBytes(1023), "1023 B");
  assert.equal(C.formatBytes(1024), "1.0 KB");
  assert.equal(C.formatBytes(1536), "1.5 KB");
  assert.equal(C.formatBytes(1536, ","), "1,5 KB");
  assert.equal(C.formatBytes(10 * 1024), "10 KB");
  assert.equal(C.formatBytes(1024 * 1024 - 1), "1.0 MB");
  assert.equal(C.formatBytes(5 * 1024 * 1024 * 1024), "5.0 GB");
  assert.equal(C.formatBytes(-5), "0 B");
  assert.equal(C.formatBytes("x"), "0 B");
});

test("percent is clamped and safe with no total", () => {
  assert.equal(C.percent(1, 4), 25);
  assert.equal(C.percent(5, 4), 100);
  assert.equal(C.percent(1, 0), 0);
  assert.equal(C.percent(-1, 4), 0);
});

test("cacheOwner", () => {
  assert.equal(C.cacheOwner("oros-map-tiles"), "maps");
  assert.equal(C.cacheOwner("oros-television-api"), "television");
  assert.equal(C.cacheOwner("oros-shell-oros-v0.46.00"), "_offline");
  assert.equal(C.cacheOwner("oros-runtime-oros-v0.46.00"), "_offline");
  assert.equal(C.cacheOwner("workbox-x"), "_other");
});

test("parseUA: common browsers and systems", () => {
  const cases = [
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      { browser: "Chrome", version: "129", os: "Windows", osVersion: "10/11" }],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
      { browser: "Edge", version: "129", os: "Windows", osVersion: "10/11" }],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
      { browser: "Chrome", version: "129", os: "Android", osVersion: "14" }],
    ["Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
      { browser: "Samsung Internet", version: "25", os: "Android", osVersion: "13" }],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
      { browser: "Safari", version: "17", os: "iOS", osVersion: "17.6" }],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1",
      { browser: "Chrome", version: "129", os: "iOS", osVersion: "17.6" }],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      { browser: "Safari", version: "18", os: "macOS", osVersion: "" }],
    ["Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
      { browser: "Firefox", version: "131", os: "Linux", osVersion: "" }],
    ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      { browser: "Chrome", version: "129", os: "ChromeOS", osVersion: "" }],
    ["", { browser: "", version: "", os: "", osVersion: "" }]
  ];
  cases.forEach(([ua, want]) => assert.deepEqual(C.parseUA(ua), want, ua));
  const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";
  assert.equal(C.parseUA(ipad, "touch-mac").os, "iPadOS");
});

test("featureImpact: only installed apps, shell always", () => {
  assert.deepEqual(C.featureImpact("geolocation", ["weather", "todo"]), ["weather"]);
  assert.deepEqual(C.featureImpact("folder", []), ["_shell"]);
  assert.deepEqual(C.featureImpact("nope", APPS), []);
  C.FEATURES.forEach((f) => C.featureImpact(f, APPS).forEach((id) => {
    assert.ok(id.charAt(0) === "_" || APPS.includes(id), f + " " + id);
  }));
});

test("buildReport: headers, rows, one trailing newline", () => {
  const r = C.buildReport("Report", [
    { title: "A", rows: [["x", "1"], ["y", "2"]] },
    { title: "B", rows: [] }
  ]);
  assert.equal(r, "Report\n\n## A\n- x: 1\n- y: 2\n\n## B\n");
});

test("the app never writes another app's key and never reads values into the DOM", () => {
  const src = fs.readFileSync(path.join(DIR, "device.js"), "utf8").replace(/\/\/.*$/gm, "");
  const writes = src.match(/localStorage\.(setItem|removeItem|clear)\([^)]*\)/g) || [];
  writes.forEach((w) => assert.match(w, /^localStorage\.setItem\(PREFS_KEY,/, w));
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(src), "no HTML injection");
  assert.ok(!/\bfetch\((?!"\.\.\/apps\.json")/.test(src), "only apps.json is fetched");
  assert.ok(!/XMLHttpRequest|sendBeacon|WebSocket/.test(src), "nothing is sent");
});

test("every string exists in both languages", () => {
  const src = fs.readFileSync(path.join(DIR, "device.js"), "utf8");
  const block = (lang) => {
    const m = src.match(new RegExp("\\n    " + lang + ": \\{([\\s\\S]*?)\\n    \\}"));
    return new Set([...m[1].matchAll(/"([a-zA-Z._]+)":/g)].map((x) => x[1]));
  };
  const en = block("en"), el = block("el");
  assert.ok(en.size > 50);
  assert.deepEqual([...en].filter((k) => !el.has(k)), []);
  assert.deepEqual([...el].filter((k) => !en.has(k)), []);
});
