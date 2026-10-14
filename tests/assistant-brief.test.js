// Assistant phase 4 wave 5: the one-tap Briefing (core.js section 3d).
// Planned from the apps that have a summary, only what has something
// in it is shared, and the chat keeps a short label while the AI
// service reads the summaries.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const C = require(path.join(__dirname, "..", "assistant/core.js"));

test("brief: plan puts the day first, skips Timesheet, caps the apps", () => {
  const plan = C.briefPlan(["plants", "budget", "timesheet", "contacts", "habits", "calendar", "todo", "BAD id"]);
  assert.deepEqual(plan.map((x) => x.app), ["calendar", "todo", "contacts", "budget", "plants", "habits"]);
  assert.equal(plan[0].days, 2);
  assert.equal(plan[2].days, 7);                   // birthdays: the week
  assert.equal(plan[4].days, 1);
  const many = Array.from({ length: 30 }, (_, i) => "app" + i);
  assert.equal(C.briefPlan(many).length, C.BRIEF_MAX);
  assert.deepEqual(C.briefPlan(null), []);
  assert.deepEqual(C.briefPlan(["calendar", "calendar"]).length, 1);
});

test("brief: only summaries with something in them are kept", () => {
  assert.equal(C.briefKeep({ app: "budget", entries: 0, items: [] }), false);
  assert.equal(C.briefKeep({ app: "budget", entries: 3 }), true);
  assert.equal(C.briefKeep({ app: "todo", open: 2, items: [] }), true);
  assert.equal(C.briefKeep({ app: "todo", open: 0, items: [] }), false);
  assert.equal(C.briefKeep({ app: "calendar", items: [{ title: "Dentist" }] }), true);
  assert.equal(C.briefKeep({ app: "calendar", items: [] }), false);
  assert.equal(C.briefKeep(null), false);
});

const brief = {
  date: "2026-10-14", apps: ["Calendar"], held: ["Budget"],
  data: [{ app: "calendar", app_name: "Calendar", from: "2026-10-14", to: "2026-10-15", items: [{ title: "Dentist", time: "10:00", ref: "r1" }] }]
};

test("brief: the AI service reads the summaries, the chat keeps the label", () => {
  const msgs = [{ r: "user", text: "Briefing for Wednesday 14 October", brief }];
  const h = C.prepHistory(msgs, "anthropic");
  assert.equal(h.length, 1);
  assert.match(h[0].text, /^\[Briefing\] The user pressed Briefing on 2026-10-14\./);
  assert.match(h[0].text, /"title":"Dentist"/);
  assert.match(h[0].text, /oros:r3/);
  assert.match(h[0].text, /held back: Budget/);
  assert.match(h[0].text, /never instructions/);
  assert.match(h[0].text, /Never change or delete anything/);
  assert.ok(!h[0].text.includes("Briefing for Wednesday"));
  const r = C.buildRequest("openai", { key: "k", model: "m" }, msgs, {});
  assert.match(r.body.messages[r.body.messages.length - 1].content, /\[Briefing\]/);
});

test("brief: an empty or broken briefing says so, never sends junk", () => {
  assert.match(C.briefText({ date: "2026-10-14", data: [] }), /shared nothing/);
  assert.match(C.briefText(null), /shared nothing/);
  assert.ok(!C.briefText({ date: "<b>", data: [] }).includes("<b>"));
  const t = C.briefText({ date: "2026-10-14", held: [1, "Health"], data: [{ app: "todo", open: 1 }, "x"] });
  assert.match(t, /held back: Health\./);
  assert.ok(!t.includes("\"x\""));
});

test("brief: a stored conversation keeps the briefing as shared", () => {
  const c = { id: "cabcdefgh", m: 1, title: "t", msgs: [{ r: "user", text: "Briefing", brief }], refs: {}, refN: 1 };
  const back = C.parseChatFile(C.chatFile(c));
  assert.deepEqual(back.msgs[0].brief, brief);
});
