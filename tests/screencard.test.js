// Screen time bar card (STC-1, video ideas 2026-11-23 #16): today's total
// from Screen time (ST-1) in the smart top bar; a tap opens a peek with
// the apps, longest first. Names hide under Sensitive work, locked apps
// are never listed, Screen time off = no card.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const M = require(path.join(ROOT, "smartbar.js"));
const A = require(path.join(ROOT, "smartbar-apps.js"));
const EN = { "st.fmt.m": "{m} min", "st.fmt.h": "{h} h", "st.fmt.hm": "{h} h {m} min" };
const t = (k) => EN[k] || k;

test("a known kind, loaded with smartbar-apps.js, with a peek", () => {
  assert.ok(M.KINDS.includes("screen"));
  assert.ok(A.KINDS.includes("screen") && A.OWN.screen);
  assert.equal(A.AGENDA.screen, undefined, "not an agenda card");
});

test("durations in Screen time's own words", () => {
  assert.equal(A.durOf(59, t), "0 min");
  assert.equal(A.durOf(25 * 60, t), "25 min");
  assert.equal(A.durOf(2 * 3600, t), "2 h");
  assert.equal(A.durOf(3600 + 5 * 60 + 30, t), "1 h 5 min");
});

test("peek rows: real apps only, never a locked one, longest first, at most 8", () => {
  const apps = [{ id: "music", name: "Music", secs: 3600 }, { id: "~desk", name: "", secs: 7200 }, { id: "~sens", name: "", secs: 900 },
    { id: "notes", name: "Notes", secs: 1800 }, { id: "diary", name: "Diary", secs: 1200 }, { id: "x", name: "", secs: 30 }];
  const rows = A.screenRows(apps, (id) => id === "diary", 8);
  assert.deepEqual(rows.map((r) => r.id), ["music", "notes"]);
  assert.deepEqual(rows.map((r) => r.pct), [100, 50]);
  const many = Array.from({ length: 12 }, (_, i) => ({ id: "a" + i, name: "A" + i, secs: 6000 - i * 60 }));
  assert.equal(A.screenRows(many, null, 8).length, 8);
  assert.deepEqual(A.screenRows(null), []);
});

test("Screen time gives today's figures without writing (todayUse)", () => {
  const S = read("device/screentime.js");
  assert.match(S, /function todayUse\(\) \{\n    var p = read\(\), t = today\(\);\n    if \(!p\.on\) return \{ on: false, total: 0, apps: \[\] \};/);
  assert.match(S, /todayUse: todayUse,/);
  assert.doesNotMatch(S.slice(S.indexOf("function todayUse"), S.indexOf("function setOn")), /write\(|flush\(/);
});

test("wiring: the card, the peek, Sensitive work and locks", () => {
  const SA = read("smartbar-apps.js"), SB = read("smartbar.js");
  assert.match(SA, /if \(!u \|\| !u\.on \|\| u\.total < 60\) return null;/, "off or empty: no card");
  assert.match(SA, /if \(strict\(\)\) p\.appendChild\(kit\.el\("div", "pk-empty", t\("sb\.screen\.hidden"\)\)\);/);
  assert.match(SA, /screenRows\(u\.apps, appLocked, 8\)/);
  assert.match(SA, /kit\.el\("span", "pk-w", r\.name\)/, "names as text only");
  assert.match(SB, /var APP_PEEK = \{ screen: 1/);
  assert.match(SB, /if \(APP_PEEK\[kind\] && !\(apps && call\(function \(\) \{ return apps\.canPeek\(kind\); \}\)\)\) return false;/);
  assert.match(SB, /peek: function \(k\) \{ return peek\(k, chips\[k\] && chips\[k\]\.btn\); \}/);
  const tr = read("translations.js"), de = read("i18n/de/shell.js");
  for (const k of ["sb.k.screen", "sb.screen.label", "sb.screen.today", "sb.screen.tip", "sb.screen.hidden", "sb.screen.none", "sb.screen.open"]) {
    assert.equal(tr.split('"' + k + '":').length - 1, 2, "EN + EL " + k);
    assert.ok(de.includes('"' + k + '":'), "DE " + k);
  }
  assert.match(read("help/topics/appearance.en.txt"), /- `Screen time`: how long you used orOS today/);
  assert.match(read("help/topics/appearance.el.txt"), /- `Χρόνος οθόνης`: πόση ώρα/);
});
