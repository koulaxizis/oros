// Wave A6: the Assistant writes Automations rules (propose_rule).
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const C = require("../assistant/core.js");
const AC = require("../automations/core.js");

const all = () => true;

test("propose_rule is offered only when Automations is on", () => {
  assert.ok(C.toolsFor({ rules: true }).some((t) => t.name === "propose_rule"));
  assert.ok(!C.toolsFor({}).some((t) => t.name === "propose_rule"));
  assert.match(C.systemPrompt({ lang: "en", now: Date.now(), rules: true, apps: [] }), /propose_rule/);
});

test("a schedule rule comes out as the Automations app's own rule", () => {
  const r = C.normRule({ name: "Bins", when: { type: "day", at: "08:00", weekdays: [1] },
    steps: [{ do: "notify", text: "Bins out" }, { do: "budget", amount: 12.5, note: "bags" }, { do: "timer", minutes: 10, label: "x" }] }, all);
  assert.ok(r.ok);
  assert.deepStrictEqual(r.rule.when, { t: "day", at: "08:00", wd: [1] });
  assert.deepStrictEqual(r.rule.do[1], { a: "budget", k: "o", amount: 1250, note: "bags" });
  assert.deepStrictEqual(AC.cleanRule(r.rule), Object.assign({ m: 0 }, r.rule));
});

test("notice and event rules keep their word and hours", () => {
  const r = C.normRule({ when: { type: "notice", app: "mail", word: "urgent", from: "09:00", to: "17:00", only_days: [1, 2, 3, 4, 5] },
    steps: [{ do: "todo", items: ["{text}"] }] }, all);
  assert.ok(r.ok);
  assert.deepStrictEqual(r.rule.when, { t: "notice", app: "mail", word: "urgent" });
  assert.deepStrictEqual(r.rule.if, { wd: [1, 2, 3, 4, 5], from: "09:00", to: "17:00" });
  const e = C.normRule({ when: { type: "event", event: "fitness.done" }, steps: [{ do: "open", app: "water" }] }, all);
  assert.ok(e.ok);
  assert.strictEqual(e.rule.if, undefined);
});

test("Passwords is never a source or a target (AUTO-4)", () => {
  assert.match(C.normRule({ when: { type: "notice", app: "passwords" }, steps: [{ do: "notify", text: "x" }] }, all).err, /Passwords/);
  assert.match(C.normRule({ when: { type: "open" }, steps: [{ do: "open", app: "Passwords" }] }, all).err, /Passwords/);
});

test("the model hears what to fix", () => {
  assert.ok(!C.normRule({ when: { type: "event", event: "nope" }, steps: [{ do: "notify", text: "x" }] }, all).ok);
  assert.match(C.normRule({ when: { type: "open" }, steps: [{ do: "todo", items: [] }] }, all).err, /step 1/);
  assert.match(C.normRule({ when: { type: "open" }, steps: [] }, all).err, /at least one/);
  const noCal = (id) => id !== "calendar";
  assert.match(C.normRule({ when: { type: "open" }, steps: [{ do: "event", title: "x" }] }, noCal).err, /calendar/);
  assert.match(C.normRule({ when: { type: "open" }, steps: [{ do: "notify", text: "x" }] }, (id) => id !== "automations").err, /not installed/);
});

const S = require("../assistant/summary.js");

test("the Automations summary explains runs and never carries what a notice said", () => {
  let d = AC.empty();
  d = AC.put(d, { name: "Urgent mail", on: true, when: { t: "notice", app: "mail", word: "urgent" }, do: [{ a: "todo", items: ["{text}"] }] }, 1000).data;
  d = AC.put(d, { name: "", on: false, when: { t: "day", at: "08:00", wd: [1] }, do: [{ a: "notify", text: "Bins" }] }, 1001).data;
  const id = d.rules.find((r) => r.name === "Urgent mail").id;
  const at = new Date(2026, 10, 4, 9, 5).getTime();
  const log = [{ r: id, n: "Urgent mail", k: id + "@sabc", at, t: at, w: "sent" }, { r: "gone1", n: "Old", k: "gone1@x", at, t: at, w: "skip" }];
  const sum = S.automationsRules(AC, d, log, { lang: "en", appName: (x) => x === "mail" ? "Mail" : x });
  assert.strictEqual(sum.rules_total, 2);
  assert.strictEqual(sum.rules_on, 1);
  assert.deepStrictEqual(sum.items.map((x) => x.target.rule).sort(), d.rules.map((r) => r.id).sort());
  assert.strictEqual(sum.runs[0].kind, "something happened");
  assert.strictEqual(sum.runs[0].time, "09:05");
  assert.match(sum.runs[0].result, /notice shown/);
  assert.ok(sum.runs[1].gone);
  assert.ok(!/said/.test(JSON.stringify(sum)));
  const pv = S.preview(sum, "el");
  assert.ok(pv.some((l) => /09:05 · Urgent mail · εμφανίστηκε ειδοποίηση/.test(l)));
  assert.ok(pv.some((l) => /\(ανενεργός\)/.test(l)));
  assert.strictEqual(S.OWN.automations, "rules");
});

test("A5: the Assistant cannot write a push or webhook step, and never sees their addresses", () => {
  assert.ok(!C.normRule({ when: { type: "open" }, steps: [{ do: "push", text: "x" }] }, all).ok);
  let d = AC.put(AC.empty(), { name: "P", on: true, when: { t: "open" }, do: [{ a: "hook", url: "https://ha.example/api/webhook/SECRET", ok: "https://ha.example/api/webhook/SECRET", text: "x" }] }, 5).data;
  const sum = S.automationsRules(AC, d, [], { lang: "en" });
  assert.match(JSON.stringify(sum), /ha\.example/);
  assert.ok(!/SECRET/.test(JSON.stringify(sum)));
});
