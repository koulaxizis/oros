// Today wave 48 (today/layout.js): the widget layout — normalising
// what is stored, the editing operations, and which rows each widget
// shows (a row goes to one widget only). Plus static checks on the
// Today app: the layout is device-local, never in the synced slice.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const L = require("../today/layout.js");

test("norm: the default is the layout Today always had", () => {
  assert.deepEqual(L.defaults().items.map((x) => x.id), ["top", "overdue", "today", "soon"]);
  assert.deepEqual(L.norm(null), L.defaults());
  assert.deepEqual(L.norm({}), L.defaults());
  assert.deepEqual(L.norm({ items: "x" }), L.defaults());
  assert.deepEqual(L.parse("{not json"), L.defaults());
  assert.equal(L.isDefault(L.defaults()), true);
});

test("norm: unknown widgets, doubles and bad sizes are cleaned; an empty screen is kept", () => {
  const n = L.norm({ v: 7, items: [{ id: "clock", size: "huge" }, "todos", { id: "todos", size: "wide" },
                                   { id: "radar" }, { id: "__proto__" }, { id: "top", size: "small" }, null, 5] });
  assert.deepEqual(n, { v: 1, items: [{ id: "clock", size: "small" }, { id: "todos", size: "small" }, { id: "top", size: "wide" }] });
  assert.deepEqual(L.norm({ items: [] }).items, []);
  assert.deepEqual(L.parse(JSON.stringify({ v: 1, items: [{ id: "events", size: "small" }] })).items, [{ id: "events", size: "small" }]);
  // every widget has a valid default size
  L.ORDER.forEach((id) => assert.ok(L.WIDGETS[id].sizes.includes(L.WIDGETS[id].def), id));
});

test("editing: move, move by id, reorder (lossless), add, remove, size", () => {
  let l = L.defaults();
  l = L.move(l, 3, 0);
  assert.deepEqual(L.ids(l), ["soon", "top", "overdue", "today"]);
  assert.deepEqual(L.ids(L.move(l, 0, 99)), ["top", "overdue", "today", "soon"]);
  assert.deepEqual(L.ids(L.moveId(l, "soon", -1)), L.ids(l));           // already first
  assert.deepEqual(L.ids(L.moveId(l, "top", -1)), ["top", "soon", "overdue", "today"]);
  // a drop that lost some ids keeps them, at the end
  assert.deepEqual(L.ids(L.reorder(l, ["today", "bogus", "top"])), ["today", "top", "soon", "overdue"]);
  l = L.add(l, "clock");
  l = L.add(l, "clock");                                                   // no doubles
  l = L.add(l, "weather", 0);
  l = L.add(l, "nope");
  assert.deepEqual(L.ids(l), ["weather", "soon", "top", "overdue", "today", "clock"]);
  assert.deepEqual(L.hidden(l), ["water", "habits", "events", "todos", "together"]);
  l = L.remove(l, "top");
  assert.ok(!L.ids(l).includes("top"));
  l = L.setSize(l, "clock", "wide");
  l = L.setSize(l, "weather", "enormous");
  assert.equal(l.items.find((x) => x.id === "clock").size, "wide");
  assert.equal(l.items.find((x) => x.id === "weather").size, "small");
  assert.equal(L.nextSize("clock", "wide"), "small");
  assert.equal(L.nextSize("top", "wide"), "wide");                        // only one size
  // operations never change their input
  const d = L.defaults(), before = JSON.stringify(d);
  L.move(d, 0, 2); L.add(d, "todos"); L.remove(d, "top"); L.setSize(d, "today", "wide");
  assert.equal(JSON.stringify(d), before);
});

function groups() {
  const row = (app, kind, title, due) => ({ app, kind, title, due: due || null, time: null, text: "" });
  return {
    info: [row("weather", "info", "Athens 18°"), row("water", "info", "3 of 8 glasses"), row("calendar", "info", "Name day: Nikos")],
    overdue: [row("todo", "task", "Pay rent", "2026-10-12"), row("plants", "task", "Water fern", "2026-10-13")],
    overdueMore: { todo: 2 },
    today: [row("habits", "task", "Read"), row("calendar", "event", "Dentist"), row("todo", "task", "Call"), row("health", "task", "BP")],
    todayMore: {},
    soon: [{ day: "2026-10-15", rows: [row("calendar", "event", "Gym", "2026-10-15"), row("todo", "task", "Report", "2026-10-15"),
                                       row("habits", "task", "Run", "2026-10-15")], more: {} }]
  };
}
const titles = (parts) => parts.map((p) => p.rows.map((r) => r.title));

test("distribute: with the default layout every row stays where it always was", () => {
  const g = groups(), p = L.distribute(g, L.ids(L.defaults()));
  assert.deepEqual(titles(p.top), [["Athens 18°", "3 of 8 glasses", "Name day: Nikos"]]);
  assert.deepEqual(titles(p.overdue), [["Pay rent", "Water fern"]]);
  assert.deepEqual(p.overdue[0].more, { todo: 2 });
  assert.equal(p.overdue[0].late, true);
  assert.deepEqual(titles(p.today), [["Read", "Dentist", "Call", "BP"]]);
  assert.deepEqual(titles(p.soon), [["Gym", "Report", "Run"]]);
  assert.equal(p.soon[0].day, "2026-10-15");
  ["clock", "weather", "water", "habits", "events", "todos", "together"].forEach((id) => assert.deepEqual(p[id], []));
});

test("distribute: dedicated widgets take their rows, each row in one widget only", () => {
  const g = groups();
  const p = L.distribute(g, ["top", "overdue", "today", "soon", "weather", "water", "habits", "events", "todos"]);
  assert.deepEqual(titles(p.top), [["Name day: Nikos"]]);
  assert.deepEqual(titles(p.weather), [["Athens 18°"]]);
  assert.deepEqual(titles(p.water), [["3 of 8 glasses"]]);
  assert.deepEqual(titles(p.overdue), [["Water fern"]]);
  assert.deepEqual(p.overdue[0].more, {});                                // To-Do's "and 2 more" moved too
  assert.deepEqual(titles(p.today), [["BP"]]);
  assert.deepEqual(titles(p.habits), [["Read"]]);
  assert.deepEqual(titles(p.todos), [["Pay rent"], ["Call"], ["Report"]]);
  assert.deepEqual(p.todos.map((x) => !!x.late), [true, false, false]);
  assert.deepEqual(p.todos[0].more, { todo: 2 });
  assert.deepEqual(titles(p.events), [["Dentist"], ["Gym"]]);
  assert.deepEqual(titles(p.soon), [["Run"]]);                            // a later habit is not due: it stays
  // nothing lost, nothing doubled
  const all = [].concat(...Object.keys(p).map((k) => p[k].map((x) => x.rows))).flat().map((r) => r.title).sort();
  const src = [].concat(g.info, g.overdue, g.today, g.soon[0].rows).map((r) => r.title).sort();
  assert.deepEqual(all, src);
});

test("distribute: a widget that is not on the screen claims nothing; empty parts are left out", () => {
  const p = L.distribute(groups(), ["today", "todos"]);
  assert.deepEqual(titles(p.today), [["Read", "Dentist", "BP"]]);
  assert.equal(p.top[0].rows.length, 3);                // no Weather / Water widget: their lines stay on top
  assert.deepEqual(titles(p.todos), [["Pay rent"], ["Call"], ["Report"]]);
  assert.deepEqual(L.distribute({}, ["top", "todos"]).todos, []);
  assert.deepEqual(L.distribute(null, null).top, []);
});

test("Today app: the layout stays on this device and is drawn with textContent only", () => {
  const src = fs.readFileSync(path.join(ROOT, "today/today.js"), "utf8");
  assert.match(src, /var LAYOUT_KEY = "oros-today-layout";/);
  assert.match(src, /localStorage\.setItem\(LAYOUT_KEY/);
  const host = fs.readFileSync(path.join(ROOT, "today/host.js"), "utf8");
  assert.doesNotMatch(host, /oros-today-layout/);                          // never in the synced slice
  (src.match(/\.innerHTML\s*=\s*[^;]+;/g) || []).forEach((u) => {
    assert.match(u, /\.innerHTML\s*=\s*(SVG\.|s \|\| SVG\.dot|svg|editing \? SVG)/, u);
  });
  const html = fs.readFileSync(path.join(ROOT, "today/index.html"), "utf8");
  assert.ok(html.indexOf("layout.js") > 0 && html.indexOf("layout.js") < html.indexOf("today.js?"));
});
