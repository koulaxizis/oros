// CH-2: weekly app suggestion (discover/core.js, discover/host.js,
// the Today card, the shell hooks).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const D = require("../discover/core.js");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const IDS = ["notes", "todo", "chess", "settings", "help", "mail", "plants", "snake", "today"];

test("weeks start on Monday", () => {
  assert.equal(D.weekOf(-3), 0, "Mon 29 Dec 2025");
  assert.equal(D.weekOf(3), 0, "Sun 4 Jan 2026");
  assert.equal(D.weekOf(4), 1, "Mon 5 Jan 2026");
  assert.equal(D.weekStart(1), 4);
  assert.equal(D.weekStart(D.weekOf(310)) <= 310, true);
});

test("candidates: never opened before the week, not system, not account-only, not 'Not for me'", () => {
  let d = D.norm(null);
  assert.deepEqual(D.candidates(IDS, d, 45), ["chess", "notes", "plants", "snake", "todo"]);
  d = D.addSeen(d, [{ id: "notes", day: 100 }, { id: "chess", day: D.weekStart(45) + 2 }]);
  assert.deepEqual(D.candidates(IDS, d, 45), ["chess", "plants", "snake", "todo"], "opened during the week stays in the week's pool");
  assert.deepEqual(D.candidates(IDS, d, 46), ["plants", "snake", "todo"]);
  d = D.setNo(d, "snake", true, 5);
  assert.deepEqual(D.candidates(IDS, d, 46), ["plants", "todo"]);
  d = D.setNo(d, "snake", false, 1);
  assert.deepEqual(D.candidates(IDS, d, 46), ["plants", "snake", "todo"], "taken back; an older clock still moves the stamp on");
  assert.equal(D.pick([], d, 46), "");
  assert.equal(D.pick(["settings", "help"], d, 46), "");
});

test("the pick is the same on every device and stays all week", () => {
  const d = D.norm(null);
  const a = D.pick(IDS, d, 45);
  assert.equal(D.pick(IDS.slice().reverse(), d, 45), a, "order of the app list does not matter");
  const opened = D.addSeen(d, [{ id: a, day: D.weekStart(45) + 1 }]);
  assert.equal(D.pick(IDS, opened, 45), a, "opening it this week keeps the pick");
  const picks = new Set();
  for (let w = 40; w < 60; w++) picks.add(D.pick(IDS, d, w));
  assert.ok(picks.size >= 3, "weeks differ (" + picks.size + ")");
});

test("addSeen writes only real news; merge is symmetric and canonical", () => {
  let d = D.addSeen(D.norm(null), [{ id: "notes", day: 50 }]);
  assert.equal(D.addSeen(d, [{ id: "notes", day: 60 }]), null, "a later open of a known app writes nothing");
  assert.deepEqual(D.addSeen(d, [{ id: "notes", day: 40 }]).seen, { notes: 40 });
  assert.equal(D.addSeen(d, [{ id: "<x>", day: 1 }]), null);
  const a = D.norm({ seen: { notes: 50, chess: 12 }, no: { snake: [10, 1] } });
  const b = D.norm({ seen: { notes: 30, todo: 70 }, no: { snake: [20, 0], plants: [3, 1] } });
  const ab = D.merge(a, b), ba = D.merge(b, a);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba), "R5");
  assert.equal(JSON.stringify(D.merge(ab, ab)), JSON.stringify(ab), "R26");
  assert.deepEqual(ab.seen, { chess: 12, notes: 30, todo: 70 });
  assert.deepEqual(ab.no, { plants: [3, 1], snake: [20, 0] });
  assert.deepEqual(D.norm({ seen: { "Bad": 1, ok: "x", fine: 5 }, no: { a: "x" } }), { v: 1, seen: { fine: 5 }, no: {} });
});

test("the shell notes first opens, ticks the weekly notice, and Settings names the switch", () => {
  const shell = read("shell.js");
  assert.match(shell, /gameLastNote\(app, false\);   \/\/ GR-1\n\s*if \(window\.orosDiscover\) \{ try \{ window\.orosDiscover\.seen\(app\.id\); \} catch \(e\) \{\} \}/);
  assert.match(shell, /tickSafe\("discoverTick", discoverTickThrottled\);/);
  const page = read("index.html");
  const late = [...page.matchAll(/<template data-oros-late>([\s\S]*?)<\/template>/g)].map((m) => m[1]).join("\n");
  const i = ["gamekit/daily.js", "discover/core.js", "discover/host.js"].map((f) => late.indexOf('src="' + f + "?v="));
  assert.ok(i[0] >= 0 && i[0] < i[1] && i[1] < i[2], "daily.js, then the core, then the host");
  const host = read("discover/host.js");
  assert.match(host, /registerSlice\("discover", sliceGet, sliceSet, null, C\.merge\)/);
  assert.match(host, /key: "week-" \+ week,/);
  assert.match(host, /var NOTICE_HOUR = 10;/);
  assert.ok(read("notifications.js").includes("'gamecenter', 'discover'];"));
  assert.ok(read("settings/settings.js").includes('id === "discover" ? t("n.discover")'));
});

test("the Today card: Try it, Not for me, Mute; text only through textContent", () => {
  const js = read("today/today.js");
  const fn = js.slice(js.indexOf("function discCard()"), js.indexOf("function refresh()"));
  for (const k of ["D.notForMe(d.id)", "D.mute(true)", "p.__orosOpenApp(d.id)"]) assert.ok(fn.includes(k), k);
  assert.ok(!/innerHTML/.test(fn), "no innerHTML in the card (the icon comes from iconFor)");
});
