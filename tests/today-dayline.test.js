// Today T3 (BR-TODAY-17): the shape of the day (free stretches), the
// evening view of tomorrow, the `eve` field of the synced slice, rows'
// `end`, and the week ahead.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = require("../today/dayline.js");
const A = require("../today/agg.js");

const at = (h, m) => new Date(2026, 10, 8, h, m || 0).getTime();
const ev = (time, end, title) => ({ app: "calendar", kind: "event", time, end: end || null, title });
const task = (o) => Object.assign({ app: "todo", kind: "task", time: null, title: "t" }, o);

test("shape: times in order, free stretches of 30 min or more from now (not before 08:00) to 22:00", () => {
  const groups = { today: [ev("13:00", "14:30", "Lunch"), ev("09:00", null, "Dentist"), task({ time: "10:15" }), ev("10:20", "10:40", "Call")],
    overdue: [task({}), task({})] };
  const s = D.shape(groups, at(6, 30));
  assert.deepEqual(s.items.map((x) => [x.from, x.to, x.row.title]), [
    ["09:00", "10:00", "Dentist"], ["10:15", "10:45", "t"], ["10:20", "10:40", "Call"], ["13:00", "14:30", "Lunch"]]);
  assert.deepEqual(s.gaps.map((g) => [g.from, g.to, g.min]), [["08:00", "09:00", 60], ["10:45", "13:00", 135], ["14:30", "22:00", 450]]);
  assert.equal(s.fit, 2);
  const later = D.shape(groups, at(13, 47));
  assert.deepEqual(later.gaps.map((g) => g.from), ["14:30"], "the past is not free time");
  assert.deepEqual(D.shape({}, at(22, 30)).gaps, []);
  assert.deepEqual(D.shape({ today: [ev("08:00", "21:50")] }, at(7)).gaps, []);
});

test("evening: from the chosen hour to midnight; 0 is off", () => {
  assert.equal(D.evening(at(18, 59), 19), false);
  assert.equal(D.evening(at(19), 19), true);
  assert.equal(D.evening(at(23, 59), 19), true);
  assert.equal(D.evening(at(21), 0), false);
});

test("slice eve: absent until set (old slices keep their bytes), then a normal LWW field", () => {
  const old = A.normData({ on: { v: true, m: 3 } });
  assert.equal("eve" in old, false);
  assert.equal(A.eveOf(old), A.DEFAULT_EVE);
  const set = A.setField(old, "eve", 21, 100);
  assert.deepEqual(set.eve, { v: 21, m: 100 });
  assert.deepEqual(Object.keys(set), ["ver", "on", "hour", "absorb", "eve", "apps"], "canonical order");
  assert.equal(A.eveOf(A.setField(set, "eve", 0, 200)), 0);
  assert.deepEqual(A.setField(old, "eve", 19, 100), old, "the default is not a change");
  assert.deepEqual(A.setField(old, "eve", 12, 100), old, "only 15–23 or off");
  const m1 = A.merge(old, set), m2 = A.merge(set, old);
  assert.deepEqual(m1, m2);
  assert.equal(A.eveOf(m1), 21);
  assert.equal("eve" in A.merge(old, old), false);
});

test("rows: end only after a valid start", () => {
  assert.equal(A.cleanRow({ title: "x", time: "09:00", end: "10:00" }, "a").end, "10:00");
  assert.equal(A.cleanRow({ title: "x", time: "09:00", end: "08:00" }, "a").end, null);
  assert.equal(A.cleanRow({ title: "x", end: "10:00" }, "a").end, null);
});

test("Today app wiring: agenda and evening are read-only, the week comes from host.week", () => {
  const src = read("today/today.js"), host = read("today/host.js"), html = read("today/index.html"), sw = read("sw.js");
  const fn = src.slice(src.indexOf("function agendaWidget"), src.indexOf("// Clock: hours and minutes"));
  assert.doesNotMatch(fn, /innerHTML|localStorage|setSetting/);
  assert.match(src, /H\.week\(7\)/);
  assert.match(host, /function week\(days\)/);
  assert.ok(html.indexOf("dayline.js") > html.indexOf("tips.js") && html.indexOf("dayline.js") < html.indexOf("today.js?"));
  ["today/tips.js", "today/dayline.js"].forEach((f) => assert.ok(sw.indexOf('"' + f + '"') > 0, f + " precached"));
});
