// Today T2 (BR-TODAY-16): tips of the day — the rules across apps,
// the providers' facts, the device-local choices, and the Today app's
// wiring (textContent, actions through host.act).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const req = (p) => require(path.join(ROOT, p));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const T = req("today/tips.js");
const A = req("today/agg.js");
globalThis.orosWaterCore = req("water/core.js");

const TODAY = "2026-11-08";
const at = (h, m) => new Date(2026, 10, 8, h, m || 0).getTime();
const row = (o) => Object.assign({ kind: "task", time: null, text: "", acts: [] }, o);
const ev = (time, title, place) => row({ app: "calendar", kind: "event", time, title, text: place || "", due: TODAY,
  acts: place ? [{ k: "route", app: "maps", target: { routeTo: { query: place, name: title } }, via: "at" }] : [] });
const make = (o) => T.make(Object.assign({ today: TODAY, now: at(9), lang: "en", apps: [], groups: {}, facts: {} }, o));

test("rain + an appointment with a place still to come", () => {
  const groups = { today: [ev("08:00", "Gym", "Club"), ev("18:00", "Dentist", "Center")] };
  const [t] = make({ groups, facts: { weather: { max: 18, min: 10, pop: 70 } } });
  assert.equal(t.rule, "rain");
  assert.equal(t.text, "Rain is likely today (70%): take an umbrella for 18:00 Dentist.");
  assert.deepEqual(t.acts.map((a) => a.k), ["route"]);
  assert.equal(make({ groups, facts: { weather: { pop: 30 } } }).length, 0, "30% is not a tip");
  assert.equal(make({ groups, now: at(19), facts: { weather: { pop: 90 } } }).filter((x) => x.rule === "rain").length, 0, "after it");
  assert.equal(make({ groups: { today: [ev("18:00", "Call")] }, facts: { weather: { pop: 90 } } }).filter((x) => x.rule === "rain").length, 0, "no place");
});

test("heat, with plants due, and a cold night; °F when Weather uses it", () => {
  let tips = make({ facts: { weather: { max: 35, min: 22 }, water: { total: 0, goal: 2000 } } });
  assert.equal(tips[0].rule, "heat");
  assert.match(tips[0].text, /\(35°\)/);
  assert.deepEqual(tips[0].acts.map((a) => a.k), ["sip"]);
  tips = make({ groups: { today: [row({ app: "plants", title: "Fern: water" })] }, facts: { weather: { max: 33, min: 20, imp: true } } });
  assert.match(tips[0].text, /plants/);
  assert.match(tips[0].text, /\(91°\)/);
  tips = make({ facts: { weather: { max: 6, min: -2 } } });
  assert.equal(tips[0].rule, "cold");
  assert.match(tips[0].text, /\(-2°\)/);
});

test("late tasks: three or more, the old ones counted, To-Do opens on the list", () => {
  const groups = { overdue: [
    row({ app: "todo", due: "2026-10-20", target: { list: "l1", item: "a" } }),
    row({ app: "todo", due: "2026-11-06", target: { list: "l1", item: "b" } }),
    row({ app: "kanban", due: "2026-10-01" })] };
  const [t] = make({ groups });
  assert.equal(t.text, "3 tasks are late, 2 of them by more than a week: give them new dates, or drop what no longer matters.");
  assert.deepEqual(t.acts, [{ k: "open", app: "todo", target: { list: "l1" } }]);
  assert.equal(make({ groups: { overdue: groups.overdue.slice(0, 2) } }).filter((x) => x.rule === "late").length, 0);
  assert.match(make({ groups: { overdue: groups.overdue.map((r) => Object.assign({}, r, { due: "2026-11-07" })) } })[0].text, /^3 tasks are late: start/);
});

test("busy day, water in the afternoon, a quiet day; at most five", () => {
  const groups = { today: ["09:00", "11:30", "14:00", "18:00"].map((t, i) => ev(t, "E" + i)) };
  assert.match(make({ groups })[0].text, /4 things with a time, the first at 09:00 and the last at 18:00/);
  const w = { water: { total: 500, goal: 2000 } };
  assert.equal(make({ facts: w, now: at(10) }).filter((x) => x.rule === "water").length, 0, "morning: not yet");
  assert.match(make({ facts: w, now: at(15) })[0].text, /Only 500 ml of 2 L/);
  assert.equal(make({ facts: w, now: at(15), lang: "el" })[0].text, "Μόνο 500 ml από 2 L νερό ως τώρα: ένα ποτήρι τώρα βοηθά.");
  const q = make({ apps: ["habits"] });
  assert.equal(q[0].rule, "quiet");
  assert.deepEqual(q[0].acts, [{ k: "open", app: "habits", target: {} }]);
  const many = make({ now: at(15), groups: { today: groups.today.concat([ev("19:00", "Dentist", "Center")]),
    overdue: [1, 2, 3].map(() => row({ app: "kanban", due: "2026-10-01" })) },
    facts: { weather: { max: 34, min: 0, pop: 80 }, water: { total: 0, goal: 2000 } } });
  assert.equal(many.length, T.MAX);
  assert.deepEqual(many.map((x) => x.rule), ["rain", "heat", "cold", "late", "busy"]);
  assert.ok(many.every((x) => x.id === x.rule + ":" + TODAY));
});

test("the actions are kinds a row may have, and survive the same cleaning", () => {
  const all = make({ now: at(15), apps: ["habits"], groups: { today: [ev("19:00", "Dentist", "Center")],
    overdue: [1, 2, 3].map(() => row({ app: "todo", due: "2026-10-01", target: { list: "l1", item: "x" } })) },
    facts: { weather: { max: 34, pop: 80 }, water: { total: 0, goal: 2000 } } }).concat(make({ apps: ["habits"] }));
  all.forEach((t) => t.acts.forEach((a) => assert.ok(A.cleanAct(a, a.app), t.rule + " " + a.k)));
});

test("choices: Not today lasts the day, a muted kind stays muted, unmute brings all back", () => {
  const tips = [{ id: "rain:" + TODAY, rule: "rain" }, { id: "heat:" + TODAY, rule: "heat" }];
  let s = T.hide(null, "rain:" + TODAY, TODAY);
  assert.deepEqual(T.visible(tips, s, TODAY).map((x) => x.rule), ["heat"]);
  assert.deepEqual(T.norm(s, "2026-11-09").hid, [], "a new day shows it again");
  s = T.mute(s, "heat", TODAY);
  s = T.mute(s, "heat", TODAY);
  s = T.mute(s, "bogus", TODAY);
  assert.deepEqual(s.mute, ["heat"]);
  assert.deepEqual(T.visible(tips, T.norm(s, "2026-11-09"), "2026-11-09").map((x) => x.rule), ["rain"]);
  assert.deepEqual(T.unmute(s, TODAY).mute, []);
  assert.deepEqual(T.norm({ d: 5, hid: "x", mute: [1, "rain"] }, TODAY), { d: TODAY, hid: [], mute: ["rain"] });
});

test("facts: Weather's today numbers and Water's total, read-only and small", () => {
  const W = req("weather/today.js"), Wa = req("water/today.js");
  const now = Date.now(), today = A.ymdOf(new Date(now));
  const store = {
    "oros-weatherapp-data": { cities: [{ id: "c1", lat: 40, lon: 22, label: "Th" }], active: "c1", units: "metric" },
    "oros-weatherapp-cache": { c1: { at: now, daily: [{ date: today, max: 31.26, min: 12, pop: 60 }] } },
    "oros-water-data": JSON.stringify({ ver: 1, sips: [{ id: "sip0001", ts: now, ml: 300, m: now }], goals: [] })
  };
  const ctx = { today, now, lang: "en", readJSON: (k) => (k in store ? (typeof store[k] === "string" ? JSON.parse(store[k]) : store[k]) : null),
    readRaw: (k) => (k in store ? (typeof store[k] === "string" ? store[k] : JSON.stringify(store[k])) : null) };
  assert.deepEqual(W.facts(ctx), { max: 31.3, min: 12, pop: 60, imp: false });
  assert.equal(Wa.facts(ctx).total, 300);
  const f = A.collectFacts([W, Wa, { id: "bad", facts: () => { throw new Error("x"); } }, { id: "big", facts: () => ({ s: "z".repeat(600) }) }], ctx,
    (id) => id !== "water");
  assert.deepEqual(Object.keys(f), ["weather"], "switched-off apps, throwing and oversized facts are left out");
});

test("Today app: the Tips widget is drawn with textContent, its buttons go through host.act, choices stay on this device", () => {
  const src = read("today/today.js"), html = read("today/index.html"), host = read("today/host.js");
  const fn = src.slice(src.indexOf("function tipsWidget"), src.indexOf("// Clock: hours and minutes"));
  assert.doesNotMatch(fn, /innerHTML\s*=\s*(?!\s|SVG\.|svg)/);
  assert.match(fn, /H\.act\(a\)/);
  assert.match(src, /localStorage\.setItem\(T\.STATE_KEY/);
  assert.doesNotMatch(host, /oros-today-tips/, "never in the synced slice");
  assert.ok(html.indexOf("tips.js") > html.indexOf("layout.js") && html.indexOf("tips.js") < html.indexOf("today.js?"));
  const de = read("i18n/de/today.js");
  Object.keys(T.W.en).forEach((k) => {
    assert.ok(T.W.el[k], k + " EL");
    assert.ok(de.indexOf('"' + k + '":') > 0, k + " DE");
  });
});
