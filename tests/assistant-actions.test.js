// Assistant wave A6: do_action (AS-DO: a timer, an alarm, open, play,
// directions, each on the user's press through what the app already
// takes) and the change history (AS-HIST: device-local, 30 days, Undo
// later, change_history for "what did you change yesterday?").
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../assistant/core.js");

const ROOT = path.join(__dirname, "..");
const NOW = new Date(2026, 9, 26, 15, 0).getTime();
const DAY = 86400000;
const REFS = {
  r1: { ref: "r1", app: "music", target: { track: "k1" }, title: "So What" },
  r2: { ref: "r2", app: "radio", target: "uuid-jazz", title: "Jazz FM" },
  r3: { ref: "r3", app: "podcasts", target: { show: "s1", ep: "e1" }, title: "Episode 1" },
  r4: { ref: "r4", app: "notes", target: { page: "p1" }, title: "Plan" },
  r5: { ref: "r5", app: "podcasts", target: { show: "s1" }, title: "A show" }
};
const ALL = () => true;
const act = (args, has) => C.normAction(args, { has: has || ALL, refOf: (r) => REFS[r] || null });

test("do_action timer and alarm: Time's own command targets", () => {
  const a = act({ kind: "timer", minutes: 25, label: "Focus" });
  assert.equal(a.ok, true);
  assert.deepEqual(a.call, { fn: "openAt", args: ["time", { timer: { sec: 1500, label: "Focus" } }] });
  assert.deepEqual(a.view.fields, [["duration", "25:00"]]);
  assert.deepEqual(act({ kind: "timer", minutes: 1.5, seconds: 5 }).call.args[1].timer.sec, 95);
  assert.equal(act({ kind: "timer", minutes: 90 }).view.fields[0][1], "1:30:00");
  assert.match(act({ kind: "timer" }).err, /minutes or seconds/);
  assert.match(act({ kind: "timer", minutes: -1 }).err, /0 or more/);
  assert.match(act({ kind: "timer", minutes: 6001 }).err, /100 hours/);
  const al = act({ kind: "alarm", at: "7:05", daily: true, label: "Up" });
  assert.deepEqual(al.call.args, ["time", { alarm: { at: "07:05", label: "Up", daily: true } }]);
  assert.match(act({ kind: "alarm", at: "24:00" }).err, /HH:MM/);
  assert.match(act({ kind: "timer", minutes: 5 }, (id) => id !== "time").err, /Time app is not installed/);
});

test("do_action open and play: refs only, the right kind of item, Podcasts plays on play", () => {
  assert.deepEqual(act({ kind: "play", ref: "r1" }).call, { fn: "assistOpen", args: ["music", { track: "k1" }] });
  assert.deepEqual(act({ kind: "play", ref: "oros:r2" }).call, { fn: "assistOpen", args: ["radio", "uuid-jazz"] });
  assert.deepEqual(act({ kind: "play", ref: "r3" }).call.args[1], { show: "s1", ep: "e1", play: true });
  assert.equal(REFS.r3.target.play, undefined, "the conversation's ref stays as it was");
  assert.match(act({ kind: "play", ref: "r4" }).err, /Music track, a Radio station or a Podcasts episode/);
  assert.match(act({ kind: "play", ref: "r5" }).err, /Podcasts episode/);
  assert.match(act({ kind: "play", ref: "r9" }).err, /needs the ref/);
  const o = act({ kind: "open", ref: "r4" });
  assert.deepEqual(o.call, { fn: "assistOpen", args: ["notes", { page: "p1" }] });
  assert.equal(o.view.title, "Plan");
  assert.deepEqual(act({ kind: "open", app: "calendar" }).call, { fn: "openAt", args: ["calendar", null] });
  assert.match(act({ kind: "open", app: "nope" }, (id) => id !== "nope").err, /no app nope/);
  assert.match(act({ kind: "open" }).err, /ref .* or app/);
  assert.match(act({ kind: "wave" }).err, /Unknown kind/);
});

test("do_action directions: Maps' routeTo from the user's location", () => {
  assert.deepEqual(act({ kind: "directions", to: "Ermou 10, Athens", mode: "foot" }).call,
    { fn: "openAt", args: ["maps", { routeTo: { name: "Ermou 10, Athens", query: "Ermou 10, Athens" }, mode: "foot" }] });
  assert.deepEqual(act({ kind: "directions", lat: 37.97, lon: 23.72 }).call.args[1], { routeTo: { lat: 37.97, lon: 23.72 } });
  assert.match(act({ kind: "directions" }).err, /needs to/);
  assert.match(act({ kind: "directions", lat: 99, lon: 1 }).err, /real coordinates/);
  assert.match(act({ kind: "directions", to: "x", mode: "plane" }).err, /car, bike or foot/);
});

test("do_action and change_history are offered as the prompt says", () => {
  const tools = C.toolsFor({ data: true, actions: ["open", "timer"], history: true });
  const d = tools.find((x) => x.name === "do_action");
  assert.deepEqual(d.params.properties.kind.enum, ["timer", "open"]);
  assert.ok(tools.find((x) => x.name === "change_history"));
  assert.equal(C.toolsFor({ data: true }).find((x) => x.name === "do_action" || x.name === "change_history"), undefined);
  const sp = C.systemPrompt({ lang: "el", now: NOW, apps: ["Notes (notes)"], actions: ["timer"], history: true });
  assert.match(sp, /call do_action/);
  assert.match(sp, /change_history/);
  assert.doesNotMatch(C.systemPrompt({ lang: "el", now: NOW, apps: [] }), /do_action|change_history/);
});

function entry(id, at, o) {
  return C.histEntry(Object.assign({ id: id, at: at, app: "todo", name: "To-Do", kind: "add", items: ["Milk"], undo: { app: "todo", key: "k", cr: {}, via: "add" } }, o || {}));
}
test("change history: 30 days, at most 500, newest first; the model hears titles, never the undo data", () => {
  const list = [entry("a", NOW - 2 * DAY), entry("b", NOW - 31 * DAY), entry("c", NOW - DAY, { app: "crm", kind: "link" }),
                entry("d", NOW - 1000, { kind: "change", act: "delete", title: "Old task" })];
  const pr = C.histPrune(list, NOW);
  assert.deepEqual(pr.keep.map((e) => e.id), ["d", "c", "a"]);
  assert.deepEqual(pr.drop, ["b"]);
  const many = Array.from({ length: 510 }, (_, i) => entry("x" + i, NOW - i * 1000));
  assert.equal(C.histPrune(many, NOW).keep.length, C.HIST_MAX);
  // yesterday, only apps still allowed
  const y = C.ymd(NOW - DAY);
  const q = C.histQuery(list, { from: y, to: y }, NOW, () => true);
  assert.deepEqual(q.list.map((e) => e.id), ["c"]);
  assert.deepEqual(C.histQuery(list, {}, NOW, (id) => id !== "crm").list.map((e) => e.id), ["d", "a"]);
  assert.deepEqual(C.histQuery(list, { app: "crm" }, NOW, null).list.map((e) => e.id), ["c"]);
  assert.match(C.histQuery(list, { from: "2026-02-30" }, NOW).err, /real date/);
  assert.match(C.histQuery(list, { from: "2026-10-26", to: "2026-10-01" }, NOW).err, /after/);
  const fm = C.histForModel(C.histQuery(list, {}, NOW).list, NOW);
  assert.deepEqual(fm[0], { when: C.ymd(NOW - 1000) + " " + "14:59", app: "todo", what: "delete", items: ["Milk"], title: "Old task", can_undo: true });
  assert.ok(!JSON.stringify(fm).includes("\"undo\""), "no undo data for the model");
  const un = Object.assign(entry("u", NOW - 5), { st: "undone" });
  assert.deepEqual(C.histForModel([un], NOW)[0].undone, true);
  assert.equal(C.canUndo(un, NOW), false);
  assert.equal(C.canUndo(entry("o", NOW - 31 * DAY), NOW), false);
  // long lists are cut to 50 titles, the count stays
  const big = entry("g", NOW, { items: Array.from({ length: 80 }, (_, i) => "T" + i) });
  assert.equal(big.items.length, 50);
  assert.equal(big.n, 80);
  assert.equal(C.histForModel([big], NOW)[0].more_items, 30);
});

test("assistant.js: the log is device-local, every write is remembered, Undo through the app's own undo", () => {
  const src = fs.readFileSync(path.join(ROOT, "assistant/assistant.js"), "utf8");
  assert.match(src, /indexedDB\.open\(DB_NAME, 2\)/);
  assert.match(src, /\["keys", "creds", "chats", "log"\]/);
  // every undoMem write goes through remember()
  assert.equal((src.match(/undoMem\[uid\] = /g) || []).length, 1);
  assert.equal((src.match(/remember\(uid, \{/g) || []).length, 6);
  // the log never goes into the synced slice or the conversation files
  const sync = src.slice(src.indexOf("// ---------- 7b."), src.indexOf("// ---------- 8."));
  assert.doesNotMatch(sync, /"log"|histList/);
  // do_action: the card's press runs it; nothing at the tool call
  const da = src.slice(src.indexOf("function doAction("), src.indexOf("function drawDo("));
  assert.doesNotMatch(da, /runEntry|orosAssistOpen/);
  assert.match(src, /e\.call\.fn === "assistOpen"/);
  const html = fs.readFileSync(path.join(ROOT, "assistant/index.html"), "utf8");
  assert.match(html, /id="side-hist"/);
});

test("Podcasts plays { show, ep, play }; Maps routes to { routeTo, mode }", () => {
  const pc = fs.readFileSync(path.join(ROOT, "podcasts/podcasts.js"), "utf8");
  assert.match(pc, /if \(t\.play === true\) \{ if \(!H\.getState\(\)\.playing \|\| H\.getState\(\)\.cur\.id !== t\.ep\) playEp\(t\.ep\); return; \}/);
  const mp = fs.readFileSync(path.join(ROOT, "maps/maps.js"), "utf8");
  assert.match(mp, /else if \(target && target\.routeTo\) routeToTarget\(target\.routeTo, target\.mode\);/);
  assert.match(mp, /else if \(pt && pt\.routeTo\) \{ mapsHost\.pendingTarget = null; routeToTarget\(pt\.routeTo, pt\.mode\); \}/);
  assert.match(mp, /function routeToTarget\(x, mode\)[\s\S]*startRouteTo\(/);
});
