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

// ---------- Wave A2: rules that follow what happens (BR-EV) ----------
test("A2: notice and event triggers are cleaned; Passwords and the rules' own notices never", () => {
  assert.deepEqual(C.cleanWhen({ t: "notice", app: "mail", word: "  Urgent \n" }), { t: "notice", app: "mail", word: "Urgent" });
  assert.deepEqual(C.cleanWhen({ t: "notice", app: "" }), { t: "notice", app: "" });
  assert.equal(C.cleanWhen({ t: "notice", app: "passwords" }), null);
  assert.equal(C.cleanWhen({ t: "notice", app: "automations" }), null);
  assert.deepEqual(C.cleanWhen({ t: "event", ev: "habits.done" }), { t: "event", ev: "habits.done" });
  assert.equal(C.cleanWhen({ t: "event", ev: "passwords.open" }), null);
  const r = C.cleanRule({ id: "s", m: 1, when: { t: "event", ev: "todo.done" }, "if": { wd: [1, 2], from: "09:00", to: "17:00" },
    do: [{ a: "notify", text: "{text}" }] });
  assert.deepEqual(r["if"], { wd: [1, 2], from: "09:00", to: "17:00" });
  // a time rule keeps no condition; an empty condition is dropped
  assert.equal(C.cleanRule({ id: "t", m: 1, when: { t: "day", at: "09:00" }, "if": { wd: [1] }, do: [{ a: "notify", text: "x" }] })["if"], undefined);
  assert.equal(C.cleanRule({ id: "u", m: 1, when: { t: "event", ev: "todo.done" }, "if": { wd: [0, 1, 2, 3, 4, 5, 6], from: "9" },
    do: [{ a: "notify", text: "x" }] })["if"], undefined);
  assert.equal(C.nextAt(r.when, T0), 0);
  assert.equal(C.due(r, T0, "", T0), null);
});

test("A2: matching is by app or event, folded word and the day/hour window; the key comes from the signal", () => {
  const r = C.cleanRule({ id: "m1", m: 1, on: true, when: { t: "notice", app: "mail", word: "επειγον" },
    "if": { wd: [3], from: "07:00", to: "09:00" }, do: [{ a: "todo", items: ["{text}"] }] });
  const sig = { kind: "notice", name: "mail", key: "mail:abc", text: "Νίκος: ΕΠΕΊΓΟΝ συμβόλαιο" };
  const k = C.matches(r, sig, T0);                            // Wed 08:00
  assert.match(k, /^m1@s[0-9a-z]+$/);
  assert.equal(C.matches(r, sig, T0), k);                     // same signal, same run
  assert.notEqual(C.matches(r, Object.assign({}, sig, { key: "mail:def" }), T0), k);
  assert.equal(C.matches(r, Object.assign({}, sig, { name: "feeds" }), T0), null);
  assert.equal(C.matches(r, Object.assign({}, sig, { text: "hello" }), T0), null);
  assert.equal(C.matches(r, sig, T0 + 2 * 3600000), null);    // 10:00, outside the hours
  assert.equal(C.matches(r, sig, T0 + 86400000), null);       // Thursday
  assert.equal(C.matches(Object.assign({}, r, { on: false }), sig, T0), null);
  const any = C.cleanRule({ id: "m2", m: 1, on: true, when: { t: "notice", app: "" }, do: [{ a: "notify", text: "x" }] });
  assert.ok(C.matches(any, { kind: "notice", name: "calendar", key: "c1", text: "" }, T0));
  assert.equal(C.matches(any, { kind: "notice", name: "automations", key: "a1", text: "" }, T0), null);
  assert.equal(C.matches(any, { kind: "notice", name: "passwords", key: "p1", text: "" }, T0), null);
  assert.equal(C.matches(any, { kind: "event", name: "todo.done", key: "t1", text: "" }, T0), null);
  // a window over midnight
  assert.equal(C.inWindow({ from: "22:00", to: "06:00" }, new Date(2026, 10, 4, 23, 0).getTime()), true);
  assert.equal(C.inWindow({ from: "22:00", to: "06:00" }, new Date(2026, 10, 4, 12, 0).getTime()), false);
  // {text} fills notices and steps
  assert.equal(C.notice(r, T0, "en", null, "Buy milk").body, "Tap to continue: add 1 to To-Do");
  assert.deepEqual(C.call(r["do"][0], T0, "en", "x", "Contract").arg.addItems.items, [{ text: "Contract" }]);
  assert.equal(C.whenText(r.when, "el", () => "Mail"), "Όταν έρχεται ειδοποίηση από: Mail με «επειγον»");
});

function fakeShell(apps) {
  const store = {};
  const inbox = [], emitted = [], opened = [];
  const win = {
    OrosAutoCore: C,
    orosSync: { registerSlice: () => {}, markDirty: () => {} },
    orosTodayEnv: { apps: () => apps.map((id) => ({ id, name: id })), lang: () => "en" },
    orosNotifs: {
      emit: (c) => { if (inbox.some((x) => x.dedupKey === c.ns + ":" + c.key)) return null;
        inbox.push({ dedupKey: c.ns + ":" + c.key }); emitted.push(c); return "id" + emitted.length; },
      getSlice: () => ({ items: inbox })
    },
    __orosOpenAt: (app, arg) => opened.push([app, arg])
  };
  global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; } };
  new Function("window", fs.readFileSync(path.join(__dirname, "..", "automations", "host.js"), "utf8"))(win);
  return { win, H: win.orosAutomations, emitted, opened, store };
}

test("A2 host: an app event posts one notice, its text reaches the tap; unknown events and the day cap", () => {
  const { win, H, emitted, opened, store } = fakeShell(["automations", "todo", "habits"]);
  try {
    const r1 = rule({ id: "e1", name: "Cheer", when: { t: "event", ev: "habits.done" }, do: [{ a: "notify", text: "Well done: {text}" }] });
    const r2 = rule({ id: "e2", name: "Next", when: { t: "event", ev: "habits.done", word: "run" }, do: [{ a: "todo", items: ["Stretch after {text}"] }] });
    H.save(C.put(C.put(C.empty(), r1, 1000).data, r2, 1001).data);
    assert.equal(win.orosEvents.emit("habits.done", "habits:h1:2026-11-04", "Read"), 1);
    assert.equal(emitted[0].body, "Well done: Read");
    assert.equal(win.orosEvents.emit("habits.done", "habits:h1:2026-11-04", "Read"), 0);   // the same signal again
    assert.equal(win.orosEvents.emit("habits.done", "habits:h2:2026-11-04", "Morning run"), 2);
    const tap = emitted[2];
    assert.match(tap.deepLink, /^automations:run:e2@s/);
    H.openRun(tap.deepLink.split(":")[2]);
    assert.deepEqual(opened[0], ["todo", { addItems: { from: "Automations", items: [{ text: "Stretch after Morning run" }] } }]);
    assert.equal(win.orosEvents.emit("passwords.open", "x", "y"), 0);
    assert.equal(win.orosEvents.emit("todo.done", "t1", "x"), 0);                 // no rule for it
    for (let i = 0; i < 30; i++) win.orosEvents.emit("habits.done", "habits:n" + i, "Walk");
    assert.equal(JSON.parse(store["oros-automations-local"]).cnt.e1, 20);           // 20 a day per rule
    // a notice from Passwords never runs a rule, even an "any app" one
    H.save(C.put(H.rules(), rule({ id: "n1", when: { t: "notice", app: "" }, do: [{ a: "notify", text: "x" }] }), 2000).data);
    assert.equal(H.notice("passwords", "pw:1", "secret"), 0);
    assert.equal(H.notice("automations", "automations:x", "loop"), 0);
    assert.equal(H.notice("calendar", "calendar:ev1", "Dentist"), 1);
  } finally { delete global.localStorage; }
});

test("A2 wiring: Notifications hands its own notices over; the apps send their events", () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const n = src("notifications.js");
  assert.match(n, /A\.notice\(item\.ns, item\.dedupKey, item\.title \+ ' ' \+ item\.body\)/);
  assert.match(n, /item\.ns !== 'automations' && item\.ns !== 'passwords'/);
  for (const [f, ev] of [["todo/todo.js", "todo.done"], ["habits/habits.js", "habits.done"], ["water/water.js", "water.goal"], ["fitness/fitness.js", "fitness.done"]]) {
    const s = src(f);
    assert.ok(s.includes('orosEvent("' + ev + '"'), f + " sends " + ev);
    assert.match(s, /p\.orosEvents\.emit\(name, key, text\)/);
    assert.ok(C.EVENTS.includes(ev));
  }
  assert.doesNotMatch(src("passwords/passwords.js"), /orosEvents|orosEvent\(/);
});

// ---------- Wave A5: push and webhook steps ----------
test("A5: push and webhook steps send only to an address the person allowed", () => {
  const C = require("../automations/core.js");
  const rule = { name: "Done", when: { t: "open" }, do: [] };
  const push = { a: "push", url: "https://ntfy.sh/secret-topic", text: "On {date}" };
  assert.strictEqual(C.outbound(push, rule, 0, "en"), null);                     // not allowed yet
  assert.strictEqual(C.cleanAction(Object.assign({}, push, { ok: "https://other.example/x" })).ok, undefined);
  const ok = C.cleanAction(Object.assign({}, push, { ok: push.url }));
  assert.strictEqual(ok.ok, push.url);
  const at = new Date(2026, 10, 4, 9, 0).getTime();
  const q = C.outbound(ok, rule, at, "en");
  assert.strictEqual(q.url, "https://ntfy.sh/secret-topic?title=Done");
  assert.strictEqual(q.body, "On 4/11/2026");
  assert.strictEqual(q.headers["Content-Type"], "text/plain");
  const g = C.outbound({ a: "push", svc: "gotify", url: "https://g.example/message?token=abc", ok: "https://g.example/message?token=abc", text: "{text}" }, rule, at, "en", "Hello");
  assert.deepStrictEqual(JSON.parse(g.body), { title: "Done", message: "Hello", priority: 5 });
  const h = C.outbound({ a: "hook", url: "https://ha.example/api/webhook/x", ok: "https://ha.example/api/webhook/x", text: "{text}" }, rule, at, "en", "Hi");
  assert.deepStrictEqual(JSON.parse(h.body), { source: "orOS", rule: "Done", at: new Date(at).toISOString(), text: "Hi" });
  ["http://ntfy.sh/x", "https://u:p@ntfy.sh/x", "https://ntfy.sh/x#y", "javascript:alert(1)", "https:///x"].forEach((u) => assert.strictEqual(C.cleanUrl(u), "", u));
});

test("A5: outside steps are never tap steps, and the notice names only the host", () => {
  const C = require("../automations/core.js");
  const r = C.cleanRule({ id: "a", name: "", when: { t: "open" }, do: [{ a: "push", url: "https://ntfy.sh/secret-topic", text: "x" }, { a: "todo", items: ["y"] }] });
  assert.deepStrictEqual(C.pending(r).map((a) => a.a), ["todo"]);
  assert.strictEqual(C.call(r.do[0], 0, "en", "x"), null);
  const n = C.notice(r, 0, "en");
  assert.match(n.body, /ntfy\.sh/);
  assert.ok(!/secret-topic/.test(n.body));
  assert.deepStrictEqual(C.outSteps(r).map((a) => a.a), ["push"]);
});
