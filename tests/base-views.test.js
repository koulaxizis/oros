// orOS Base wave B3a: kanban and calendar views (base/core.js stacks,
// monthGrid; OROS_BIBLE.md Part VI "Base", B3a).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../base/core.js");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const NAMES = { field: "Name", grid: "Grid", cards: "Cards" };
function seed() {
  let d = C.addBase(C.empty(), "Books", 100, "b1");
  d = C.addTable(d, "b1", "Titles", 110, NAMES, { t: "t1", f: "fname", v1: "v1", v2: "v2" });
  d = C.addField(d, "t1", "Status", "select", { ch: [{ id: "o1", n: "Idea", c: "gray" }, { id: "o2", n: "Published", c: "green" }] }, 120, "fstat");
  d = C.addField(d, "t1", "Stage", "select", { ch: [{ id: "s1", n: "Draft", c: "red" }] }, 121, "fstage");
  d = C.addField(d, "t1", "Out", "date", {}, 122, "fdate");
  d = C.addField(d, "t1", "Due", "date", {}, 123, "fdue");
  d = C.addRecord(d, "t1", { fname: "A", fstat: "o2", fdate: "2026-03-01", fdue: "2026-04-10" }, 200, "r1").data;
  d = C.addRecord(d, "t1", { fname: "B", fstat: "o1", fdate: "2026-03-31" }, 210, "r2").data;
  d = C.addRecord(d, "t1", { fname: "C", fdate: "2026-03-01" }, 220, "r3").data;
  d = C.addRecord(d, "t1", { fname: "D", fstat: "gone" }, 230, "r4").data;
  return d;
}
function view(d, kind, cfg) {
  return C.putRow(d, "views", { id: "vk", tb: "t1", name: kind, kind: kind, ord: 2, cfg: cfg || {} }, 300);
}
const recsOf = (d) => d.recs.filter((r) => r.t === "t1");
const ids = (list) => list.map((r) => r.id);

test("views keep the kanban and calendar kinds and cfg.by; bad kinds become grid", () => {
  let d = view(seed(), "kanban", { by: "fstage" });
  const v = d.views.find((x) => x.id === "vk");
  assert.equal(v.kind, "kanban");
  assert.equal(v.cfg.by, "fstage");
  d = C.normalize(Object.assign({}, d, { views: d.views.concat([{ id: "vx", tb: "t1", name: "x", kind: "<b>", m: 1, cfg: { by: "a b" } }]) }));
  const vx = d.views.find((x) => x.id === "vx");
  assert.equal(vx.kind, "grid");
  assert.equal(vx.cfg.by, undefined);
  assert.deepEqual(Object.keys(C.VIEW_KINDS).sort(), ["calendar", "cards", "grid", "kanban"]);
});

test("kanban stacks by the first single choice, no value first, gone choices count as no value", () => {
  const d = view(seed(), "kanban");
  const ix = C.index(d), v = ix.views.vk;
  const st = C.stacks(ix, v, recsOf(d));
  assert.equal(st.f.id, "fstat");
  assert.deepEqual(st.cols.map((c) => c.id), ["", "o1", "o2"]);
  assert.deepEqual(st.cols.map((c) => ids(c.recs)), [["r3", "r4"], ["r2"], ["r1"]]);
  assert.equal(st.cols[2].name, "Published");
  assert.equal(st.cols[2].c, "green");
});

test("kanban follows cfg.by, and falls back when it names a field that is not a choice", () => {
  let d = view(seed(), "kanban", { by: "fstage" });
  let ix = C.index(d);
  assert.equal(C.stacks(ix, ix.views.vk, recsOf(d)).f.id, "fstage");
  d = view(seed(), "kanban", { by: "fdate" });
  ix = C.index(d);
  assert.equal(C.stackField(ix, ix.views.vk).id, "fstat");
  let e = C.addBase(C.empty(), "X", 1, "b1");
  e = C.addTable(e, "b1", "T", 2, NAMES, { t: "t1", f: "fname", v1: "v1", v2: "v2" });
  e = view(e, "kanban");
  ix = C.index(e);
  assert.equal(C.stacks(ix, ix.views.vk, []), null);
});

test("a kanban move is one field change (setValues), and syncs like any edit", () => {
  const d = seed();
  const moved = C.setValues(d, "r3", { fstat: "o1" }, 400);
  const ix = C.index(view(moved, "kanban"));
  const st = C.stacks(ix, ix.views.vk, recsOf(moved));
  assert.deepEqual(ids(st.cols[1].recs), ["r2", "r3"]);
  const back = C.merge(d, moved);
  assert.equal(C.serialize(back), C.serialize(C.merge(moved, d)));
});

test("a calendar month runs Monday first and covers whole weeks", () => {
  const d = view(seed(), "calendar");
  const ix = C.index(d);
  const mg = C.monthGrid(ix, ix.views.vk, recsOf(d), "2026-03");
  assert.equal(mg.f.id, "fdate");
  assert.equal(mg.editable, true);
  assert.equal(mg.weeks[0][0].day, "2026-02-23");            // 1 March 2026 is a Sunday
  assert.equal(mg.weeks[0][6].day, "2026-03-01");
  assert.equal(mg.weeks.length, 6);
  const last = mg.weeks[mg.weeks.length - 1];
  assert.equal(last[1].day, "2026-03-31");
  assert.equal(last[1].inMonth, true);
  assert.equal(last[2].inMonth, false);
  assert.deepEqual(ids(mg.weeks[0][6].recs), ["r1", "r3"]);
  assert.deepEqual(ids(last[1].recs), ["r2"]);
  assert.equal(mg.none, 1);
  mg.weeks.forEach((w) => assert.equal(w.length, 7));
});

test("a calendar month with no spill week stops at 4 or 5 weeks", () => {
  const d = view(seed(), "calendar");
  const ix = C.index(d);
  const feb = C.monthGrid(ix, ix.views.vk, [], "2027-02");      // 1 Feb 2027 is a Monday, 28 days
  assert.equal(feb.weeks.length, 4);
  assert.equal(feb.weeks[0][0].day, "2027-02-01");
});

test("a calendar follows cfg.by; a created-time field is a date but not editable", () => {
  let d = view(seed(), "calendar", { by: "fdue" });
  let ix = C.index(d);
  let mg = C.monthGrid(ix, ix.views.vk, recsOf(d), "2026-04");
  assert.equal(mg.f.id, "fdue");
  assert.equal(mg.none, 3);
  d = C.addField(seed(), "t1", "Made", "ctime", {}, 130, "fmade");
  d = view(d, "calendar", { by: "fmade" });
  ix = C.index(d);
  mg = C.monthGrid(ix, ix.views.vk, recsOf(d), "2026-03");
  assert.equal(mg.f.id, "fmade");
  assert.equal(mg.editable, false);
  let e = C.addBase(C.empty(), "X", 1, "b1");
  e = C.addTable(e, "b1", "T", 2, NAMES, { t: "t1", f: "fname", v1: "v1", v2: "v2" });
  e = view(e, "calendar");
  ix = C.index(e);
  assert.equal(C.monthGrid(ix, ix.views.vk, [], "2026-03"), null);
});

test("the app offers the four kinds and draws kanban and calendar with textContent only", () => {
  const app = read("base/app.js");
  assert.match(app, /\["grid", "cards", "kanban", "calendar"\]/);
  assert.match(app, /function renderKanban\(v\)/);
  assert.match(app, /function renderCalendar\(v\)/);
  const sec = app.slice(app.indexOf("6b. Kanban and calendar"), app.indexOf("7. Record dialog"));
  assert.doesNotMatch(sec, /innerHTML|insertAdjacentHTML|outerHTML/);
  for (const k of ["kind.kanban", "kind.calendar", "kb.by", "cal.by", "cal.add"]) {
    assert.ok(read("i18n/de/base.js").includes('"' + k + '"'), "de " + k);
  }
});

test("a device before B3a cannot undo a kanban or calendar view by syncing it back at the same time", () => {
  // what a 7.04.00 device keeps of the view: kind grid, no cfg.by, same m
  for (const kind of ["kanban", "calendar"]) {
    const d = view(seed(), kind, { by: kind === "kanban" ? "fstage" : "fdue" });
    const v = d.views.find((x) => x.id === "vk");
    const old = C.normalize(Object.assign({}, d, { views: d.views.map((x) => x.id === "vk" ? Object.assign({}, x, { kind: "grid", cfg: Object.assign({}, x.cfg, { by: undefined }) }) : x) }));
    assert.equal(old.views.find((x) => x.id === "vk").m, v.m);
    for (const m of [C.merge(d, old), C.merge(old, d)]) {
      const w = m.views.find((x) => x.id === "vk");
      assert.equal(w.kind, kind);
      assert.ok(w.cfg.by);
    }
    // a real later change on the old device still wins (it was edited there)
    const edited = C.putRow(old, "views", Object.assign({}, old.views.find((x) => x.id === "vk"), { name: "Renamed" }), v.m + 5);
    assert.equal(C.merge(d, edited).views.find((x) => x.id === "vk").kind, "grid");
  }
});
