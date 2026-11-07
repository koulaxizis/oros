// CH-1: Game Center daily challenges (gamecenter/challenge.js, the
// shell side gamecenter/host.js and the page section).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../gamecenter/challenge.js");
const CORE = require("../gamecenter/core.js");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// A Game Center summary with only the given games played.
function sum(games) {
  const out = { games: {} };
  CORE.GAMES.forEach((g) => { out.games[g] = { p: 0, w: -1, sc: -1 }; });
  Object.keys(games).forEach((g) => { out.games[g] = Object.assign({ p: 0, w: -1, sc: -1 }, games[g]); });
  return out;
}
const DAY = 310;

test("no game played = no goals; goals only from played games, one per game, at most three", () => {
  assert.equal(C.make(sum({}), CORE.GAMES, C.norm(null), DAY, 1000), null);
  const s = sum({ chess: { p: 4, w: 1 }, snake: { p: 9, sc: 120 }, sudoku: { p: 2, w: 2 }, tetris: { p: 1, sc: 900 }, rps: { p: 30, w: 12 } });
  const r = C.make(s, CORE.GAMES, C.norm(null), DAY, 1000);
  assert.equal(r.c.length, 3);
  const games = r.c.map((x) => x[0]);
  assert.equal(new Set(games).size, 3);
  games.forEach((g) => assert.ok(s.games[g].p > 0, g + " was played"));
  r.c.forEach(([g, k, n]) => {
    assert.ok(C.kindsOf(g, C.counters(s.games[g])).includes(k), g + " can get " + k);
    if (k !== "p") assert.equal(n, 1);
  });
  assert.deepEqual(Object.keys(r.b).sort(), games.slice().sort());
  const one = C.make(sum({ chess: { p: 1, w: 0 } }), CORE.GAMES, C.norm(null), DAY, 1);
  assert.equal(one.c.length, 1);
});

test("the same day and the same played games give the same goals on every device", () => {
  const s = sum({ chess: { p: 4, w: 1 }, snake: { p: 9, sc: 120 }, sudoku: { p: 2, w: 2 }, tetris: { p: 1, sc: 900 } });
  const a = C.make(s, CORE.GAMES, C.norm(null), DAY, 5).c;
  const b = C.make(s, CORE.GAMES, C.norm(null), DAY, 99).c;
  assert.deepEqual(a, b);
  let other = 0;
  for (let d = DAY + 1; d < DAY + 15; d++) if (JSON.stringify(C.make(s, CORE.GAMES, C.norm(null), d, 5).c) !== JSON.stringify(a)) other++;
  assert.ok(other >= 10, "other days give other goals (" + other + " of 14)");
});

test("'Not this game' leaves a game out; putting it back brings it in again", () => {
  let d = C.setSkip(C.norm(null), "chess", true, 10);
  assert.deepEqual(C.skipped(d), ["chess"]);
  const s = sum({ chess: { p: 4, w: 1 }, snake: { p: 2, sc: 5 } });
  for (let day = DAY; day < DAY + 10; day++) {
    const r = C.make(s, CORE.GAMES, d, day, 1);
    assert.deepEqual(r.c.map((x) => x[0]), ["snake"]);
  }
  d = C.setSkip(d, "chess", false, 5);          // an older clock still moves the stamp forward
  assert.deepEqual(C.skipped(d), []);
  assert.ok(d.skip.chess[0] > 10);
});

test("progress counts from the baseline; a beaten score and a win count once; done is kept", () => {
  const rec = C.normDay({ at: 1, c: [["snake", "p", 3], ["chess", "w", 1], ["tetris", "s", 1]],
    b: { snake: [9, -1, 120], chess: [4, 1, -1], tetris: [1, -1, 900] }, d: [] });
  let p = C.progress(rec, sum({ snake: { p: 10, sc: 120 }, chess: { p: 5, w: 1 }, tetris: { p: 2, sc: 900 } }));
  assert.deepEqual(p.map((x) => [x.have, x.done]), [[1, false], [0, false], [0, false]]);
  const now = sum({ snake: { p: 14, sc: 130 }, chess: { p: 6, w: 2 }, tetris: { p: 3, sc: 901 } });
  p = C.progress(rec, now);
  assert.deepEqual(p.map((x) => [x.have, x.done]), [[3, true], [1, true], [1, true]]);
  const upd = C.noteDone(rec, now);
  assert.deepEqual(upd.d, [0, 1, 2]);
  assert.equal(C.noteDone(upd, now), null, "nothing new: nothing to write");
  // A game reset (counters lower than the baseline) never shows less than 0, and a noted goal stays done.
  p = C.progress(upd, sum({}));
  assert.ok(p.every((x) => x.have === 0 && x.done));
});

test("streak and total count the days where every goal was done", () => {
  const full = (at) => ({ at, c: [["snake", "p", 2]], b: { snake: [0, -1, -1] }, d: [0] });
  const d = C.norm({ days: { 300: full(1), 301: full(2), 302: full(3), 303: { at: 4, c: [["snake", "p", 2]], b: { snake: [0, -1, -1] }, d: [] } } });
  assert.equal(C.streak(d, 303), 3, "today not finished yet: counts from yesterday");
  assert.equal(C.streak(d, 305), 0);
  assert.equal(C.doneCount(d), 3);
});

test("merge is symmetric and canonical; the first-made goals win; baselines take the lowest value", () => {
  const phone = C.norm({ days: { 310: { at: 100, c: [["snake", "p", 2]], b: { snake: [5, -1, 40] }, d: [] } },
    skip: { chess: [10, 1] }, hide: [3, 0] });
  const pc = C.norm({ days: { 310: { at: 200, c: [["chess", "w", 1]], b: { chess: [4, 1, -1] }, d: [0] },
    309: { at: 50, c: [["snake", "p", 3]], b: { snake: [1, -1, 1] }, d: [0] } },
    skip: { chess: [20, 0], snake: [5, 1] }, hide: [4, 1] });
  const ab = C.merge(phone, pc), ba = C.merge(pc, phone);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba), "R5");
  assert.equal(JSON.stringify(C.merge(ab, ab)), JSON.stringify(ab), "R26 idempotent");
  assert.equal(JSON.stringify(C.norm(JSON.parse(JSON.stringify(ab)))), JSON.stringify(ab), "R26 canonical");
  assert.deepEqual(ab.days[310].c, [["snake", "p", 2]], "made first wins");
  assert.deepEqual(ab.days[310].d, [], "the other side's done list belongs to other goals");
  assert.deepEqual(ab.days[309].d, [0]);
  assert.deepEqual(ab.skip, { chess: [20, 0], snake: [5, 1] });
  assert.deepEqual(ab.hide, [4, 1]);
  // Same goals on both sides (the usual case): lowest baseline, union of done.
  const x = C.norm({ days: { 310: { at: 100, c: [["snake", "p", 2], ["chess", "w", 1]], b: { snake: [5, -1, 40], chess: [4, 2, -1] }, d: [1] } } });
  const y = C.norm({ days: { 310: { at: 150, c: [["snake", "p", 2], ["chess", "w", 1]], b: { snake: [3, -1, 50], chess: [6, 1, -1] }, d: [0] } } });
  const m = C.merge(x, y);
  assert.deepEqual(m.days[310].b, { chess: [4, 1, -1], snake: [3, -1, 40] });
  assert.deepEqual(m.days[310].d, [0, 1]);
  assert.equal(m.days[310].at, 100);
  assert.equal(JSON.stringify(C.merge(y, x)), JSON.stringify(m));
});

test("norm drops bad input and keeps only the last KEEP days", () => {
  const days = {};
  for (let d = 0; d < 80; d++) days[d] = { at: d, c: [["snake", "p", 2]], b: { snake: [0, -1, -1] }, d: [] };
  days.x = { at: 1, c: [["snake", "p", 2]] };
  days[90] = { at: -1, c: [] };
  days[91] = { at: 5, c: [["<b>", "p", 2], ["snake", "q", 1], ["snake", "p", 99]] };
  const n = C.norm({ days, skip: { "Bad Id": [1, 1], chess: "x" }, hide: "no" });
  const keys = Object.keys(n.days).map(Number);
  assert.equal(keys.length, C.KEEP, "days 20..79 kept (the bad 90 and 91 are dropped first)");
  assert.equal(Math.min(...keys), 20);
  assert.deepEqual(n.skip, {});
  assert.deepEqual(n.hide, [0, 0]);
  assert.deepEqual(C.norm("garbage"), { v: 1, days: {}, skip: {}, hide: [0, 0], st: [0, 0] });
});

test("the shell loads the challenges in the late bundle and ticks them; the slice is registered", () => {
  const page = read("index.html");
  const late = [...page.matchAll(/<template data-oros-late>([\s\S]*?)<\/template>/g)].map((m) => m[1]).join("\n");
  const order = ["gamekit/daily.js", "gamecenter/core.js", "gamecenter/challenge.js", "gamecenter/host.js"]
    .map((f) => late.indexOf('src="' + f + "?v="));
  order.forEach((i) => assert.ok(i >= 0));
  assert.deepEqual(order.slice().sort((a, b) => a - b), order, "cores before the host");
  const shell = read("shell.js");
  assert.match(shell, /tickSafe\("challengesTick", challengesTickThrottled\);/);
  const host = read("gamecenter/host.js");
  assert.match(host, /registerSlice\("gamechal", sliceGet, sliceSet, null, C\.merge\)/);
  assert.match(host, /ns: NS,\n\s*key: "chal-" \+ DK\.dateStr\(day\)/);
  assert.match(host, /var NOTICE_HOUR = 18;/);
  assert.ok(/'gamecenter'[,\]]/.test(read("notifications.js")), "the Game Center switch is in Settings › Notifications");
});

test("the page section: mute, hide and 'Not this game' go through the shell side; text only through textContent", () => {
  const js = read("gamecenter/gamecenter.js");
  for (const k of ["H.skip(g.g, true)", "H.skip(id, false)", "H.mute(!st.muted)", "H.hide(true)", "H.hide(false)"])
    assert.ok(js.includes(k), k);
  const fn = js.slice(js.indexOf("function renderChal()"), js.indexOf("function wireChal()"));
  assert.ok(!/innerHTML = (?!UI_ICONS\.)/.test(fn), "only static icons through innerHTML");
  const html = read("gamecenter/index.html");
  for (const id of ["chal-block", "chal-grid", "chal-mute", "chal-hide", "chal-show", "chal-left"])
    assert.ok(html.includes('id="' + id + '"'), id);
});

test("C3: best streak and full days only grow, survive pruning, and merge by max", () => {
  const full = (at) => ({ at, c: [["snake", "p", 2]], b: { snake: [0, -1, -1] }, d: [0] });
  const days = {};
  for (let d = 100; d < 108; d++) days[d] = full(d);
  days[110] = full(110);
  let x = C.norm({ days });
  assert.equal(C.bestRun(x), 8);
  assert.deepEqual(C.records(x), { best: 8, days: 9 });
  x = C.withRecords(x);
  assert.deepEqual(x.st, [8, 9]);
  assert.equal(C.withRecords(x), null, "current: nothing to write");
  // 200 days later the old days are pruned, the records stay.
  const later = C.withDay(x, 300, C.normDay(full(300)));
  assert.equal(Object.keys(later.days).length, 1);
  assert.deepEqual(C.records(later), { best: 8, days: 9 });
  const m = C.merge({ st: [3, 40] }, { st: [9, 2] });
  assert.deepEqual(m.st, [9, 40]);
  assert.equal(JSON.stringify(C.merge({ st: [9, 2] }, { st: [3, 40] })), JSON.stringify(m));
});

test("C3: two challenge achievements; the Today provider only reads", () => {
  const s = CORE.summarize(() => null, 310);
  const a0 = CORE.achievements(s);
  assert.equal(a0.find((a) => a.id === "chal7").have, 0);
  const a1 = CORE.achievements(s, { best: 7, days: 12 });
  assert.equal(a1.find((a) => a.id === "chal7").done, true);
  assert.deepEqual([a1.find((a) => a.id === "chal30").have, a1.find((a) => a.id === "chal30").done], [12, false]);
  const P = require("../gamecenter/today.js");
  assert.equal(P.id, "gamecenter");
  assert.deepEqual(P.collect({ lang: "en" }), [], "no shell side: nothing");
  global.orosChallenges = { peek: () => ({ goals: [{}, {}, {}], open: 2, streak: 0 }) };
  try {
    assert.deepEqual(P.collect({ lang: "el" }), [{ id: "chal", kind: "info", title: "Προκλήσεις παιχνιδιών: 1 από 3 έγιναν" }]);
    global.orosChallenges = { peek: () => ({ goals: [{}, {}], open: 0, streak: 1 }) };
    assert.equal(P.collect({ lang: "en" })[0].title, "Game challenges: All done");
  } finally { delete global.orosChallenges; }
  const host = read("gamecenter/host.js");
  const peek = host.slice(host.indexOf("function peek()"), host.indexOf("function skip("));
  assert.ok(!/save\(|write\(|make\(/.test(peek), "peek never writes or makes goals");
  const apps = JSON.parse(read("apps.json"));
  const gc = (Array.isArray(apps) ? apps : apps.apps).find((a) => a.id === "gamecenter");
  assert.equal(gc.today, "today.js");
});
