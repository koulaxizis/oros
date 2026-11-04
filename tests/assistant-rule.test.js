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
