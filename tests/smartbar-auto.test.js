// Smart top bar SB2: Automations "N min before an event", "a figure
// reaches a goal", and the steps this device does by itself (pause,
// sound). Core rules, the host's watch and dedupe, the editor, the
// Assistant tool, and the strings in EN, EL and DE.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../automations/core.js");
const A = require("../assistant/core.js");
const SB = require("../smartbar.js");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const all = () => true;
const rule = (o) => C.cleanRule(Object.assign({ m: 1, on: true, name: "R" }, o));

test("cleanWhen: event.soon keeps 1-120 minutes (default 10); goal.* needs an amount", () => {
  assert.deepEqual(C.cleanWhen({ t: "event", ev: "event.soon" }), { t: "event", ev: "event.soon", min: 10 });
  assert.equal(C.cleanWhen({ t: "event", ev: "event.soon", min: 5 }).min, 5);
  assert.equal(C.cleanWhen({ t: "event", ev: "event.soon", min: 500 }).min, 10);
  assert.equal(C.cleanWhen({ t: "event", ev: "goal.sales" }), null);
  assert.equal(C.cleanWhen({ t: "event", ev: "goal.spent", amount: 0 }), null);
  assert.equal(C.cleanWhen({ t: "event", ev: "goal.spent", amount: 30000 }).amount, 30000);
  assert.ok(C.EVENTS.includes("event.soon") && C.EVENTS.includes("goal.sales") && C.EVENTS.includes("goal.spent"));
});

test("matches: minutes left within the rule's window, figures at or over the goal", () => {
  const now = new Date(2026, 10, 16, 10, 0).getTime();
  const soon = rule({ id: "s1", when: { t: "event", ev: "event.soon", min: 5 }, do: [{ a: "pause" }] });
  const sig = (n) => ({ kind: "event", name: "event.soon", key: "soon:cal1:2026-11-16:10:05", text: "", n });
  assert.ok(C.matches(soon, sig(5), now));
  assert.ok(C.matches(soon, sig(0), now));
  assert.equal(C.matches(soon, sig(6), now), null);
  assert.equal(C.matches(soon, sig(-1), now), null);
  assert.equal(C.matches(soon, { kind: "event", name: "event.soon", key: "k", text: "" }, now), null);   // no number, no run
  const goal = rule({ id: "g1", when: { t: "event", ev: "goal.sales", amount: 50000 }, do: [{ a: "sound" }] });
  const g = (n) => ({ kind: "event", name: "goal.sales", key: "sales:2026-11-16", text: "", n });
  assert.equal(C.matches(goal, g(49999), now), null);
  assert.equal(C.matches(goal, g(50000), now), C.matches(goal, g(61000), now));   // one run per day, whatever the figure
});

test("pause and sound are local: no fields, never pending, listed in the notice", () => {
  assert.deepEqual(C.cleanAction({ a: "pause", url: "x" }), { a: "pause" });
  assert.deepEqual(C.cleanAction({ a: "sound" }), { a: "sound" });
  const r = rule({ id: "l1", when: { t: "open" }, do: [{ a: "pause" }, { a: "sound" }, { a: "notify", text: "Hi" }] });
  assert.deepEqual(C.pending(r), []);
  assert.equal(C.call({ a: "pause" }, 0, "en"), null);
  assert.equal(C.notice(r, Date.now(), "en").body, "pause what is playing\nplay a chime\nHi");
});

test("whenText and the ready-made rules", () => {
  assert.equal(C.whenText({ t: "event", ev: "event.soon", min: 5 }, "en"), "5 min before an event of my day");
  assert.equal(C.whenText({ t: "event", ev: "goal.sales", amount: 50050 }, "el"), "Όταν οι σημερινές πωλήσεις του ταμείου φτάσουν το ποσό 500,50");
  assert.equal(C.whenText({ t: "event", ev: "goal.spent" }, "el"), "Όταν τα έξοδα του μήνα ξεπεράσουν το ποσό που ορίζεις");
  const q = C.fromTemplate("meeting-quiet", "el"), g = C.fromTemplate("sales-goal", "en");
  assert.deepEqual(q.when, { t: "event", ev: "event.soon", min: 5 });
  assert.equal(q.do[0].a, "pause");
  assert.equal(q.do[1].text, "Ξεκινά σε λίγο: {text}");
  assert.equal(g.when.amount, 50000);
  assert.equal(g.do[0].a, "sound");
});

function fakeShell(apps, extra) {
  const store = {}, inbox = [], emitted = [];
  const win = Object.assign({
    OrosAutoCore: C,
    orosSync: { registerSlice: () => {}, markDirty: () => {} },
    orosTodayEnv: { apps: () => apps.map((id) => ({ id, name: id })), lang: () => "en" },
    orosNotifs: {
      emit: (c) => { if (inbox.some((x) => x.dedupKey === c.ns + ":" + c.key)) return null;
        inbox.push({ dedupKey: c.ns + ":" + c.key }); emitted.push(c); return "id" + emitted.length; },
      getSlice: () => ({ items: inbox })
    }
  }, extra || {});
  global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; } };
  new Function("window", read("automations/host.js"))(win);
  return { win, H: win.orosAutomations, emitted, store, inbox };
}

test("host: a local step runs once per signal on this device, even when another device posted the notice", () => {
  let paused = 0;
  const { H, emitted, inbox, store } = fakeShell(["automations", "stock"], { __orosPauseAll: () => { paused++; return 1; } });
  try {
    H.save(C.put(C.empty(), rule({ id: "q1", when: { t: "event", ev: "event.soon", min: 5 }, do: [{ a: "pause" }, { a: "notify", text: "Soon: {text}" }] }), 1).data);
    assert.equal(H.signal("event", "event.soon", "soon:a:2026-11-16:10:05", "Review · 10:05", null, 9), 0);   // too early
    assert.equal(paused, 0);
    assert.equal(H.signal("event", "event.soon", "soon:a:2026-11-16:10:05", "Review · 10:05", null, 4), 1);
    assert.equal(paused, 1);
    assert.equal(emitted[0].body, "pause what is playing\nSoon: Review · 10:05");
    assert.equal(H.signal("event", "event.soon", "soon:a:2026-11-16:10:05", "Review · 10:05", null, 3), 0);   // the same row
    assert.equal(paused, 1);
    // another row: the notice came from another device first, the pause still happens here
    inbox.push({ dedupKey: "automations:" + C.matches(H.rules().rules[0], { kind: "event", name: "event.soon", key: "soon:b:2026-11-16:11:00", text: "", n: 2 }, Date.now()) });
    assert.equal(H.signal("event", "event.soon", "soon:b:2026-11-16:11:00", "", null, 2), 0);
    assert.equal(paused, 2);
    assert.ok(JSON.parse(store["oros-automations-local"]).lk.q1);
    // a tap on "Try it" runs one local step
    assert.equal(H.runAction({ a: "pause" }, Date.now(), "", "manual"), true);
    assert.equal(paused, 3);
  } finally { delete global.localStorage; }
});

test("host watch: this month's spending passes the goal once (from Budget's data)", () => {
  const now = new Date(), ym = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const { H, emitted, store } = fakeShell(["automations", "budget"], { orosSmartBar: { model: SB } });
  try {
    store["oros-budget-data"] = JSON.stringify({ set: { cur: "EUR" }, tx: [{ id: "a", m: 1, d: ym + "-01", a: 20000, k: "o" }] });
    H.save(C.put(C.empty(), rule({ id: "b1", when: { t: "event", ev: "goal.spent", amount: 30000 }, do: [{ a: "notify", text: "Spent {text}" }] }), 1).data);
    H.tick();
    assert.equal(emitted.length, 0);
    store["oros-budget-data"] = JSON.stringify({ set: { cur: "EUR" }, tx: [{ id: "a", m: 1, d: ym + "-01", a: 20000, k: "o" }, { id: "b", m: 2, d: ym + "-01", a: 15000, k: "o" }] });
    H.tick();
    assert.equal(emitted.length, 1);
    assert.match(emitted[0].body, /^Spent €350/);
    H.tick();
    assert.equal(emitted.length, 1);
  } finally { delete global.localStorage; }
});

test("host watch: event.soon skips sensitive apps and hides titles under Sensitive work", async () => {
  const d = new Date(Date.now() + 3 * 60000);
  if (d.getDate() !== new Date().getDate()) return;   // too close to midnight to test
  const hh = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  let strict = 0;
  const today = C.ymdOf(Date.now());
  const res = { today, apps: [{ id: "health", sensitive: true }, { id: "calendar" }],
    groups: { today: [{ key: "h1", app: "health", time: hh, title: "Doctor", kind: "event" },
                      { key: "c1", app: "calendar", time: hh, title: "Review", kind: "event" }] } };
  const { H, emitted } = fakeShell(["automations", "calendar"], {
    orosToday: { build: () => Promise.resolve(res) }, orosStrict: { level: () => strict } });
  try {
    H.save(C.put(C.empty(), rule({ id: "w1", when: { t: "event", ev: "event.soon", min: 5 }, do: [{ a: "notify", text: "[{text}]" }] }), 1).data);
    strict = 1;
    H.tick();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].body, "[]");
  } finally { delete global.localStorage; }
});

test("host watch: event.soon counts real minutes the nights the clocks change (Athens)", async () => {
  const tz = process.env.TZ, now0 = Date.now;
  process.env.TZ = "Europe/Athens";
  try {
    // [now, the event's HH:MM, minutes left]: 03:02 does not exist in March (it is 04:02);
    // in October 03:00-03:59 comes twice and its second pass counts too
    for (const [at, hh, left] of [["2027-03-28T02:59:00+02:00", "04:02", 3], ["2027-10-31T03:59:00+03:00", "03:02", 3],
                                  ["2027-10-31T03:30:00+03:00", "03:35", 5], ["2027-03-27T02:59:00+02:00", "03:02", 3]]) {
      Date.now = () => Date.parse(at);
      const today = C.ymdOf(Date.now());
      const res = { today, apps: [{ id: "calendar" }], groups: { today: [{ key: "c1", app: "calendar", time: hh, title: "Review", kind: "event" }] } };
      const { H, emitted } = fakeShell(["automations", "calendar"], { orosToday: { build: () => Promise.resolve(res) } });
      try {
        H.save(C.put(C.empty(), rule({ id: "w1", when: { t: "event", ev: "event.soon", min: left }, do: [{ a: "notify", text: "[{text}]" }] }), 1).data);
        H.tick();
        await new Promise((r) => setTimeout(r, 10));
        assert.equal(emitted.length, 1, at + " " + hh);
      } finally { delete global.localStorage; }
    }
  } finally {
    Date.now = now0;
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  }
});

test("editor: minutes and amount rows, steps without fields, strings EN/EL/DE", () => {
  const html = read("automations/index.html"), app = read("automations/app.js"), de = read("i18n/de/automations.js");
  assert.match(html, /id="min-row" hidden/);
  assert.match(html, /id="amount-row" hidden/);
  assert.match(app, /\$\("f-ev"\)\.addEventListener\("change", showWhen\)/);
  assert.match(app, /if \(ev === "event\.soon"\) when\.min =/);
  assert.match(app, /if \(C\.GOALS\[ev\]\) when\.amount = Math\.round/);
  ["a.pause", "a.sound", "ev.soonPick", "f.min", "f.amount", "h.local", "btn.now", "run.local", "err.amount", "err.min"].forEach((k) => {
    assert.equal(app.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '":'), k + " in DE");
  });
  ["ev.event.soon", "ev.goal.sales", "ev.goal.spent", "amt.some", "act.pause", "act.sound", "tpl.meeting-quiet", "tpl.meeting-quiet.text", "tpl.sales-goal", "tpl.sales-goal.text"].forEach((k) => {
    assert.ok(C.STRINGS.en[k] && C.STRINGS.el[k], k + " in EN and EL");
    assert.ok(de.includes('"' + k + '":'), k + " in DE");
  });
  assert.match(read("shell.js"), /window\.__orosPauseAll = function \(\) \{/);
});

test("Assistant and Gate: propose_rule knows the new events and steps", () => {
  const r = A.normRule({ name: "Quiet", when: { type: "event", event: "event.soon", minutes_before: 5 }, steps: [{ do: "pause" }, { do: "notify", text: "{text}" }] }, all);
  assert.ok(r.ok, r.err);
  assert.deepEqual(r.rule.when, { t: "event", ev: "event.soon", min: 5 });
  assert.deepEqual(r.rule.do[0], { a: "pause" });
  const g = A.normRule({ when: { type: "event", event: "goal.sales", goal: 500 }, steps: [{ do: "sound" }] }, all);
  assert.ok(g.ok, g.err);
  assert.equal(g.rule.when.amount, 50000);
  assert.match(A.normRule({ when: { type: "event", event: "goal.spent" }, steps: [{ do: "sound" }] }, all).err, /goal/);
  const tool = A.toolsFor({ rules: true }).find((t) => t.name === "propose_rule");
  assert.ok(tool.params.properties.when.properties.event.enum.includes("goal.spent"));
  assert.ok(tool.params.properties.steps.items.properties.do.enum.includes("sound"));
});
