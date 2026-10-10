// Settings app (settings/): pure helpers (core.js), the search
// provider, and the contract with the shell bridge
// (window.orosSettings in shell.js): every name the app sends must
// exist in the shell, and the app must never write storage itself.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "settings", "core.js"));
const P = require(path.join(ROOT, "settings", "search.js"));
const S = require(path.join(ROOT, "search.js"));
const APP = fs.readFileSync(path.join(ROOT, "settings", "settings.js"), "utf8");
const SHELL = fs.readFileSync(path.join(ROOT, "shell.js"), "utf8");

// The shell's bridge section only (9j … 10).
const BRIDGE = SHELL.slice(SHELL.indexOf("// ---------- 9j. Settings app bridge"),
                           SHELL.indexOf("// ---------- 10. App opening"));

test("core: strings exist in both languages", () => {
  const en = Object.keys(C.STRINGS.en).sort();
  const el = Object.keys(C.STRINGS.el).sort();
  assert.deepEqual(el, en);
  en.forEach((k) => {
    assert.ok(C.STRINGS.en[k].trim(), "empty en " + k);
    assert.ok(C.STRINGS.el[k].trim(), "empty el " + k);
  });
});

test("core: every key the app asks for is defined", () => {
  const keys = new Set();
  for (const m of APP.matchAll(/\bt\("([a-zA-Z.\-]+)"/g)) keys.add(m[1]);
  // keys built from parts in the app
  C.SECTIONS.forEach((s) => { keys.add("s." + s); keys.add("d." + s); });
  C.POSITIONS.forEach((p) => keys.add("n.pos." + p));
  C.SOUNDS.forEach((p) => keys.add("n.sound." + p));
  ["off", "daily", "weekly", "monthly"].forEach((v) => keys.add("b.auto." + v));
  ["all", "device"].forEach((v) => { keys.add("scope." + v); keys.add("scope." + v + ".title"); });
  keys.forEach((k) => {
    if (k.endsWith(".")) return;                 // a prefix, completed above
    assert.ok(k in C.STRINGS.en, "missing string " + k);
  });
});

test("core: t() falls back and fills variables", () => {
  assert.equal(C.t("el", "app"), "Ρυθμίσεις");
  assert.equal(C.t("xx", "app"), "Settings");
  assert.equal(C.t("en", "no.such.key"), "no.such.key");
  assert.equal(C.t("en", "y.interval.min", { n: 5 }), "every 5 min");
  assert.equal(C.intervalLabel("el", 0), "Ανενεργός");
  assert.equal(C.intervalLabel("el", 1), "κάθε λεπτό");
  assert.equal(C.intervalLabel("el", 15), "κάθε 15 λεπτά");
  assert.match(C.t("el", "y.pass.hint", { n: 10 }), /10 χαρακτήρες/);
});

test("core: sections and deep-link targets", () => {
  assert.deepEqual(C.SECTIONS, ["appearance", "notifications", "sync", "backup", "language", "system"]);
  assert.equal(C.sectionOf({ section: "sync" }), "sync");
  assert.equal(C.sectionOf("backup"), "backup");
  [null, undefined, {}, { section: "nope" }, { section: 3 }, "__proto__", "constructor"]
    .forEach((v) => assert.equal(C.sectionOf(v), null, String(v)));
});

test("core: where each setting applies matches the shell", () => {
  // Synced shell fields (SHELL_FIELDS) are "all devices".
  const fields = SHELL.match(/var SHELL_FIELDS = \[([^\]]+)\]/)[1];
  ["lang", "theme", "skin", "wallpaper", "syncInterval", "autoexport"].forEach((f) => {
    assert.ok(fields.includes('"' + f + '"'), f + " not in SHELL_FIELDS");
    assert.equal(C.scopeOf(f), "all", f);
  });
  ["folder", "search", "passphrase", "unknown"].forEach((f) => assert.equal(C.scopeOf(f), "device", f));
});

test("core: quiet hours keep the menu's full shape", () => {
  assert.deepEqual(C.quietValue(true, 22, 7),
    { enabled: true, quietHoursStart: 22, quietHoursEnd: 7, from: "22:00", to: "07:00" });
  assert.deepEqual(C.readQuiet(null), { enabled: false, start: 22, end: 8 });
  assert.deepEqual(C.readQuiet({ enabled: 1, quietHoursStart: 30, quietHoursEnd: 6 }),
    { enabled: true, start: 22, end: 6 });
});

test("core: sync state", () => {
  assert.equal(C.syncState(null), "off");
  assert.equal(C.syncState({ available: true, connected: false }), "off");
  assert.equal(C.syncState({ available: true, connected: true, unlocked: false }), "locked");
  assert.equal(C.syncState({ available: true, connected: true, unlocked: true, dirty: true }), "dirty");
  assert.equal(C.syncState({ available: true, connected: true, unlocked: true, dirty: false }), "on");
});

test("search provider: every topic opens a real section, in both languages", async () => {
  P.topics.forEach((tp) => assert.ok(C.isSection(tp[0]), tp[0]));
  const ids = new Set();
  P.search({ lang: "en" }).forEach((h) => { assert.ok(!ids.has(h.id)); ids.add(h.id); });
  async function find(q, lang) {
    const groups = await S.run([P], q, { lang, readJSON: () => null });
    return groups.length ? groups[0].hits.map((h) => h.target.section) : [];
  }
  assert.deepEqual((await find("dark", "en")).slice(0, 1), ["appearance"]);
  assert.deepEqual((await find("σκοτεινό", "el")).slice(0, 1), ["appearance"]);
  assert.deepEqual((await find("συνθηματικο", "el")).slice(0, 1), ["sync"]);
  assert.deepEqual((await find("password", "el")).slice(0, 1), ["sync"]);   // English word, Greek UI
  assert.ok((await find("backup", "en")).includes("backup"));
  assert.deepEqual(await find("zzqx", "en"), []);
});

test("bridge: every set() and act() name the app uses exists in the shell", () => {
  assert.ok(BRIDGE.length > 1000, "bridge section found");
  assert.match(BRIDGE, /window\.orosSettings = \{/);
  const sets = new Set([...APP.matchAll(/\bset\("([a-zA-Z:]+)"/g)].map((m) => m[1]));
  const acts = new Set([...APP.matchAll(/\bact\("([a-zA-Z.]+)"/g)].map((m) => m[1]));
  assert.ok(sets.size >= 7 && acts.size >= 15, "found the calls");
  sets.forEach((n) => {
    if (n.endsWith(":")) return;                 // "search:" + id, checked below
    if (/^dock:/.test(n)) {                      // matched by one pattern in the shell
      assert.match(BRIDGE, /\^dock:\(on\|size\|magnify\|autohide\|over\)\$/);
      assert.match(n, /^dock:(on|size|magnify|autohide|over)$/, n);
      return;
    }
    assert.ok(BRIDGE.includes('case "' + n + '":'), "set " + n);
  });
  // set("search:<id>") is matched by prefix in the shell
  assert.match(APP, /set\("search:" \+ a\.id/);
  assert.match(BRIDGE, /\/\^search:\//);
  acts.forEach((n) => assert.ok(BRIDGE.includes('case "' + n + '":'), "act " + n));
});

test("bridge: changes go through the shell's own setters (same stamps, same dirty)", () => {
  // The named setters the menu used are what the bridge calls.
  ["setSkinUser", "setThemeUser", "setWallpaperUser", "setSyncIntervalUser",
   "setAutoexportUser", "syncUnlock", "syncPushNow", "syncForgetHere",
   "syncDisconnectUser", "importBackupFile"].forEach((fn) => {
    assert.equal(SHELL.split("function " + fn + "(").length - 1, 1, fn + " defined once");
    assert.ok(BRIDGE.includes(fn + "("), fn + " used by the bridge");
  });
  // No storage writes and no slice in the bridge itself: it only calls setters.
  assert.doesNotMatch(BRIDGE, /localStorage\.setItem|registerSlice|markDirty/);
  // Every setter compares before it writes (R27: same value → no stamp, no upload).
  ["setSkinUser", "setThemeUser", "setWallpaperUser", "setSyncIntervalUser", "setAutoexportUser"]
    .forEach((fn) => {
      const body = SHELL.slice(SHELL.indexOf("function " + fn + "("), SHELL.indexOf("function " + fn + "(") + 500);
      assert.match(body, /=== (state\.|v |m |getSafeInterval)|state\.\w+ === \w+\)? *\) *return|=== getSafeInterval\(\)/, fn);
    });
});

test("app: owns no data, palette contract, safe DOM", () => {
  assert.doesNotMatch(APP, /localStorage\.setItem|localStorage\.removeItem|registerSlice/);
  assert.ok(APP.includes("inheritPalette") && APP.includes("watchPalette"), "G3 palette contract");
  // innerHTML only ever receives the app's static icons or "".
  for (const m of APP.matchAll(/innerHTML\s*=\s*([^;]+);/g)) {
    assert.match(m[1].trim(), /^(""|ICON\.\w+|ICON\[id\]|pass\.shown \? ICON\.eyeOff : ICON\.eye)/, m[0]);
  }
  // Inline style only from the shell's own palette / wallpaper CSS.
  for (const m of APP.matchAll(/\.style\.(\w+)\s*=\s*([^;]+);/g)) {
    assert.match(m[2].trim(), /^(k\.color|w\.css|"cover"|"center")$/, m[0]);
  }
});

test("app: index.html loads core before the app, versioned", () => {
  const html = fs.readFileSync(path.join(ROOT, "settings", "index.html"), "utf8");
  const a = html.indexOf('src="core.js?v='), b = html.indexOf('src="settings.js?v=');
  assert.ok(a > 0 && b > a);
  assert.match(html, /href="settings\.css\?v=/);
});

test("release: the menu hosts no settings sections; ways in lead to Settings", () => {
  ["renderSkinSwatches", "renderWallpaperSection", "renderPetSection", "renderSyncSection",
   "renderNotifsSection", "renderSearchSection"].forEach((fn) => {
    assert.ok(!SHELL.includes(fn + "("), fn + " is gone");
  });
  const menu = SHELL.slice(SHELL.indexOf("  function renderMenu() {"),
                           SHELL.indexOf("settingsNotify();            // the Settings app repaints too"));
  assert.match(menu, /openAppById\("settings"\)/);
  // The Dock section stays in the menu only for a launcher without the prefs API.
  assert.match(menu, /typeof window\.orosLauncher\.setPref !== "function"/);
  const dot = SHELL.slice(SHELL.indexOf("  function syncNowFromDot() {"), SHELL.indexOf("  function syncNowFromDot() {") + 600);
  assert.match(dot, /orosSettings\.open\("sync"\)/);
  const reset = SHELL.slice(SHELL.indexOf("  function wireResetButton(ov) {"), SHELL.indexOf("  function wireResetButton(ov) {") + 900);
  assert.match(reset, /orosSettings\.open\("system"\)/);
  assert.doesNotMatch(reset, /scFactoryReset/);
});
