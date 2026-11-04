// Automations (wave A1): the rules' model, schedule and bridges.
// Run: node --test tests/automations.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../automations/core.js");

const T0 = new Date(2026, 10, 4, 8, 0).getTime();     // Wed 4 Nov 2026 08:00 local
const rule = (o) => Object.assign({ name: "R", on: true, when: { t: "day", at: "09:00", wd: [] },
  do: [{ a: "notify", text: "Hi" }] }, o);
const A = () => C.put(C.put(C.empty(), rule({ id: "a" }), 100).data, rule({ id: "b", name: "B" }), 110).data;
const B = () => C.remove(C.put(A(), rule({ id: "a", name: "A2" }), 200).data, "b", 210);

test("merge is symmetric, idempotent and canonical (R5/R26)", () => {
  const ab = C.serialize(C.merge(A(), B())), ba = C.serialize(C.merge(B(), A()));
  assert.equal(ab, ba);
  assert.equal(C.serialize(C.merge(JSON.parse(ab), JSON.parse(ab))), ab);
  assert.equal(C.serialize(C.merge(JSON.parse(ab), B())), ab);
  const d = JSON.parse(ab);
  assert.deepEqual(d.rules.map((r) => r.id), ["a"]);
  assert.equal(d.rules[0].name, "A2");
});

test("a delete wins a tie, a newer edit brings the rule back (R17)", () => {
  const del = C.remove(A(), "a", 500);
  assert.equal(C.find(C.merge(A(), del), "a"), null);
  const later = C.put(A(), rule({ id: "a", name: "back" }), 900).data;
  assert.equal(C.find(C.merge(del, later), "a").name, "back");
  // put after a delete stamps past the tombstone
  const again = C.put(del, rule({ id: "a", name: "new" }), 400).data;
  assert.equal(C.find(again, "a").name, "new");
});

test("bad rules and actions are dropped, never repaired", () => {
  const d = C.normalize({ rules: [
    { id: "x", m: 1, when: { t: "day", at: "9" }, do: [{ a: "notify", text: "ok" }] },
    { id: "y", m: 1, when: { t: "nope" }, do: [{ a: "notify", text: "ok" }] },
    { id: "z", m: 1, when: { t: "day", at: "10:00" }, do: [{ a: "eval", code: "x" }] },
    { id: "w", m: 1, when: { t: "day", at: "10:00" }, do: [{ a: "open", app: "passwords" }, { a: "notify", text: "n" }] },
    { id: "bad id!", m: 1, when: { t: "open" }, do: [{ a: "notify", text: "n" }] },
    null
  ] });
  assert.deepEqual(d.rules.map((r) => r.id), ["w", "x"]);
  assert.equal(d.rules[1].when.at, "09:00");
  assert.deepEqual(d.rules[0].do, [{ a: "notify", text: "n" }]);   // Passwords never (AUTO-4)
  assert.equal(C.cleanAction({ a: "open", app: "automations" }), null);
  assert.equal(C.cleanAction({ a: "budget", amount: 0 }), null);
  assert.equal(C.cleanAction({ a: "mail", to: "not an address", subject: "s" }).to, undefined);
});

test("schedule: days, weekdays, months, last day, years, once", () => {
  const at = (w, now) => C.lastAt(C.cleanWhen(w), now);
  const d = (y, m, dd, h, mi) => new Date(y, m, dd, h, mi).getTime();
  assert.equal(at({ t: "day", at: "07:30" }, T0), d(2026, 10, 4, 7, 30));
  assert.equal(at({ t: "day", at: "09:00" }, T0), d(2026, 10, 3, 9, 0));
  assert.equal(at({ t: "day", at: "09:00", wd: [1] }, T0), d(2026, 10, 2, 9, 0));        // last Monday
  assert.equal(C.nextAt(C.cleanWhen({ t: "day", at: "09:00", wd: [1] }), T0), d(2026, 10, 9, 9, 0));
  assert.equal(at({ t: "month", at: "09:00", md: 31 }, d(2026, 11, 1, 10, 0)), d(2026, 10, 30, 9, 0)); // 31st → 30 Nov
  assert.equal(at({ t: "month", at: "09:00", md: -1 }, d(2026, 2, 1, 10, 0)), d(2026, 1, 28, 9, 0));   // last day of Feb
  assert.equal(at({ t: "year", at: "09:00", date: "02-29" }, d(2027, 2, 1, 0, 0)), d(2027, 1, 28, 9, 0));
  assert.equal(at({ t: "once", at: "09:00", date: "2026-11-05" }, T0), 0);
  assert.equal(C.nextAt(C.cleanWhen({ t: "once", at: "09:00", date: "2026-11-05" }), T0), d(2026, 10, 5, 9, 0));
  assert.equal(C.cleanWhen({ t: "year", at: "09:00", date: "02-30" }), null);
  assert.equal(C.cleanWhen({ t: "month", md: 0 }), null);
  assert.deepEqual(C.cleanWhen({ t: "day", at: "09:00", wd: [0, 1, 2, 3, 4, 5, 6] }).wd, []);
});

test("due: once per run, catch-up under 36 h, never before the rule existed", () => {
  const r = C.cleanRule(Object.assign(rule({ id: "r1", when: { t: "day", at: "07:30" } }), { m: T0 - 86400000 }));
  const d1 = C.due(r, T0, "", T0);
  assert.equal(d1.key, "r1@202611040730");
  assert.equal(d1.late, true);                                   // 30 min after
  assert.equal(C.due(r, T0, d1.key, T0), null);                  // handled
  const fresh = Object.assign({}, r, { m: T0 });                 // made at 08:00
  assert.equal(C.due(fresh, T0, "", T0), null);
  const old = Object.assign({}, r, { when: C.cleanWhen({ t: "once", at: "07:30", date: "2026-11-02" }), m: 1 });
  assert.equal(C.due(old, T0, "", T0), null);                    // 48 h old: skipped
  assert.equal(C.due(Object.assign({}, r, { on: false }), T0, "", T0), null);
  const open = C.cleanRule({ id: "o", m: 1, on: true, when: { t: "open" }, do: [{ a: "notify", text: "x" }] });
  const od = C.due(open, T0, "", T0);
  assert.equal(od.key, "o@20261104");
  assert.equal(C.due(open, T0 + 3600000, od.key, T0), null);     // once a day
});

test("actions map onto the existing bridges as prefills", () => {
  const at = new Date(2026, 10, 1, 9, 0).getTime();
  assert.deepEqual(C.call({ a: "todo", items: ["Rent", " ", "Water"], newList: "Bills {month}" }, at, "en", "Automations"),
    { fn: "openAt", app: "todo", arg: { addItems: { from: "Automations", newList: "Bills November",
      items: [{ text: "Rent" }, { text: "Water" }] } } });
  assert.deepEqual(C.call({ a: "event", title: "Dentist", off: 2, start: "10:30" }, at, "en", "x"),
    { fn: "calendarNew", app: "calendar", arg: { date: "2026-11-03", title: "Dentist", start: "10:30" } });
  assert.deepEqual(C.call({ a: "budget", k: "o", amount: 1250, note: "Gym {month}" }, at, "el", "x"),
    { fn: "budgetNew", app: "budget", arg: { k: "o", a: 1250, d: "2026-11-01", n: "Gym Νοέμβριος", src: "automations" } });
  assert.deepEqual(C.call({ a: "timer", min: 50, label: "Focus" }, at, "en", "x").arg, { timer: { sec: 3000, label: "Focus" } });
  assert.deepEqual(C.call({ a: "mail", to: "a@b.gr", subject: "Hi {weekday}", body: "" }, at, "el", "x").arg,
    { compose: { subject: "Hi Κυριακή", body: "", to: "a@b.gr" } });
  assert.equal(C.call({ a: "notify", text: "x" }, at, "en", "x"), null);
  assert.equal(C.call({ a: "open", app: "passwords" }, at, "en", "x"), null);
});

test("runnable needs every app; the notice says what a tap does", () => {
  const r = C.cleanRule({ id: "n", m: 1, name: "Bills", on: true, when: { t: "month", at: "09:00", md: 1 },
    do: [{ a: "notify", text: "Pay {month}" }, { a: "todo", items: ["Rent"] }] });
  assert.equal(C.runnable(r, ["todo"]), true);
  assert.equal(C.runnable(r, ["notes"]), false);
  const n = C.notice(r, new Date(2026, 10, 1, 9, 0).getTime(), "en");
  assert.equal(n.title, "Bills");
  assert.equal(n.body, "Pay November\nTap to continue: add 1 to To-Do");
  assert.equal(C.whenText(r.when, "el"), "Κάθε 1η του μήνα στις 09:00");
});

test("every template is a valid rule in both languages", () => {
  for (const lang of ["en", "el"]) {
    const list = C.templates(lang);
    assert.ok(list.length >= 8);
    list.forEach((tp) => {
      const res = C.put(C.empty(), tp.rule, T0);
      assert.ok(res.rule, tp.id + " " + lang);
      assert.equal(res.rule.do.length, tp.rule.do.length, tp.id);
    });
  }
  assert.equal(C.fromTemplate("bills", "el").do[0].newList, "Λογαριασμοί {month}");
});

test("the search provider skips deleted rules", () => {
  const P = require("../automations/search.js");
  const d = JSON.parse(C.serialize(C.merge(A(), B())));
  assert.deepEqual(P.search({ readJSON: () => d }).map((h) => h.target.rule), ["a"]);
});

test("host: a due rule posts one notice and runs once on every device", () => {
  const store = {};
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
               removeItem: (k) => { delete store[k]; } };
  const emitted = [], opened = [];
  const inbox = [];
  const win = {
    OrosAutoCore: C,
    orosSync: { registerSlice: (...a) => { win._reg = a; }, markDirty: () => { win._dirty = (win._dirty || 0) + 1; } },
    orosTodayEnv: { apps: () => ["automations", "todo"].map((id) => ({ id, name: id })), lang: () => "en" },
    orosNotifs: {
      emit: (c) => { if (inbox.some((x) => x.dedupKey === c.ns + ":" + c.key)) return null;
        inbox.push({ dedupKey: c.ns + ":" + c.key }); emitted.push(c); return "id" + emitted.length; },
      getSlice: () => ({ items: inbox })
    },
    __orosOpenAt: (app, arg) => opened.push([app, arg])
  };
  const src = fs.readFileSync(path.join(__dirname, "..", "automations", "host.js"), "utf8");
  global.localStorage = ls;
  try {
    new Function("window", src)(win);
    const H = win.orosAutomations;
    assert.equal(win._reg.length, 5);                                // 5-argument registerSlice
    const r = rule({ id: "t1", name: "Bills", when: { t: "day", at: "00:00" }, do: [{ a: "todo", items: ["Rent"] }] });
    const d0 = C.put(C.empty(), r, 1000).data;
    assert.equal(H.save(d0), true);
    H.tick();
    assert.equal(emitted.length, 1);
    assert.match(emitted[0].deepLink, /^automations:run:t1@\d{12}$/);
    H.tick();
    assert.equal(emitted.length, 1);                                 // once
    // a second device with the same synced inbox does not post it again
    store["oros-automations-local"] = "{}";
    H.tick();
    assert.equal(emitted.length, 1);
    H.openRun(emitted[0].deepLink.split(":")[2]);
    assert.equal(opened[0][0], "todo");
    assert.deepEqual(opened[0][1].addItems.items, [{ text: "Rent" }]);
    assert.ok(H.log().length >= 2);
  } finally { delete global.localStorage; }
});
