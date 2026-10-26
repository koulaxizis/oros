// Assistant: a CRM customer's history, follow-ups and deals (AS-ADD3,
// wave A2, assistant/additems.js). Records are written in crm/core.js's
// own shape and stamps (the stored copy already equals CRM's norm(), so
// opening CRM rewrites nothing), the customer and deal come from refs
// (never names), stages by any of their names, longer texts refused,
// look-alikes unticked, Undo takes back only untouched records.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../assistant/additems.js");
const C = require("../crm/core.js");
const core = require("../assistant/core.js");

const NOW = 1790000000000;
const T0 = NOW - 86400000;
const CTX = { today: "2026-10-26", lang: "el", crm: C };
const clone = (x) => JSON.parse(JSON.stringify(x));

function crmData() {
  const d = C.empty();
  d.cust.push({ id: "c1aaaaaaaa", m: T0, name: "Acme", kind: "company", st: "active" });
  d.cust.push({ id: "c2bbbbbbbb", m: T0, name: "Beta", kind: "company", st: "lead" });
  d.deals.push({ id: "d1aaaaaaaa", m: T0, cust: "c1aaaaaaaa", title: "Website", val: 150000, stage: "proposal", ct: T0 });
  d.fups.push({ id: "f1aaaaaaaa", m: T0, cust: "c1aaaaaaaa", d: "2026-11-02", text: "Send offer" });
  return C.norm(d);
}
// what assistant.js does with the refs before plan()
function items(app, list) {
  const r = A.normItems({ app, items: list }, CTX);
  assert.equal(r.ok, true, r.err);
  r.items.forEach((o) => {
    o.cust = { r1: "c1aaaaaaaa", r2: "c2bbbbbbbb", r9: "gone000000" }[o.customer];
    if (o.deal) o.dealId = { r3: "d1aaaaaaaa" }[o.deal];
  });
  return r.items;
}

test("crm: arguments are checked, refs required, limits refused, never cut", () => {
  assert.match(A.normItems({ app: "crm_activity", items: [{ customer: "Acme", note: "x" }] }, CTX).err, /customer must be the ref/);
  assert.match(A.normItems({ app: "crm_activity", items: [{ customer: "r1" }] }, CTX).err, /note .* is required/);
  assert.match(A.normItems({ app: "crm_activity", items: [{ customer: "r1", note: "x", channel: "fax" }] }, CTX).err, /channel must be one of/);
  assert.match(A.normItems({ app: "crm_activity", items: [{ customer: "r1", note: "x".repeat(2001) }] }, CTX).err, /2001 characters/);
  assert.match(A.normItems({ app: "crm_activity", items: [{ customer: "r1", note: "x", deal: "Website" }] }, CTX).err, /deal must be the ref/);
  assert.match(A.normItems({ app: "crm_followup", items: [{ customer: "r1", title: "Call" }] }, CTX).err, /date .* is required/);
  assert.match(A.normItems({ app: "crm_followup", items: [{ customer: "r1", title: "x".repeat(301), date: "2026-11-01" }] }, CTX).err, /301 characters/);
  assert.match(A.normItems({ app: "crm_deal", items: [{ customer: "r1" }] }, CTX).err, /title is required/);
  assert.match(A.normItems({ app: "crm_deal", items: [{ customer: "r1", title: "x", amount: "lots" }] }, CTX).err, /amount must be a number/);
  assert.match(A.normItems({ app: "crm_deal", items: [{ customer: "r1", title: "x", probability: 120 }] }, CTX).err, /probability/);
  assert.match(A.normItems({ app: "crm_deal", items: [{ customer: "r1", title: "x".repeat(121) }] }, CTX).err, /121 characters/);
  assert.match(A.plan("crm_deal", crmData(), items("crm_deal", [{ customer: "r9", title: "x" }]), CTX).err, /no longer in CRM/);
  assert.match(A.plan("crm_activity", crmData(), items("crm_activity", [{ customer: "r2", note: "x", deal: "r3" }]), CTX).err, /another customer/);
  assert.match(A.plan("crm_deal", null, items("crm_deal", [{ customer: "r1", title: "x" }]), CTX).err, /has not been opened/);
  assert.match(A.plan("crm_deal", crmData(), items("crm_deal", [{ customer: "r1", title: "x", stage: "Maybe" }]), CTX).err, /no stage named "Maybe".*Νέα/);
});

test("crm_activity: history entries in normAct's shape, today by default, a deal by ref, look-alikes unticked, Undo", () => {
  const d0 = crmData();
  d0.acts.push({ id: "a1aaaaaaaa", m: T0, cust: "c1aaaaaaaa", k: "call", at: T0, text: "Talked about the site" });
  const d = C.norm(d0);
  const its = items("crm_activity", [
    { customer: "r1", channel: "call", note: "talked about the site" },
    { customer: "r1", channel: "meet", note: "Kick-off\nwith the team", date: "2026-10-20", start: "10:30", who: "Maria", deal: "r3" },
    { customer: "r2", note: "Sent brochure" }
  ]);
  const p = A.plan("crm_activity", d, its, CTX);
  assert.equal(p.ok, true, p.err);
  assert.deepEqual(p.rows[0].dup, { id: "a1aaaaaaaa", title: "Talked about the site", target: { act: "a1aaaaaaaa" } });
  assert.deepEqual(p.rows[1].fields, [["customer", "Acme"], ["channel", "meet"], ["date", "2026-10-20 10:30"], ["who", "Maria"], ["deal", "Website"]]);
  const r = A.apply("crm_activity", d, its, NOW, { 0: true }, CTX);
  assert.equal(r.ok, true, r.err);
  assert.equal(r.made.length, 2);
  assert.deepEqual(C.norm(clone(r.data)), r.data, "the stored copy is CRM's own normal form");
  const a = r.data.acts.find((x) => x.id === r.made[0].id);
  assert.deepEqual(Object.keys(a).sort(), ["at", "cust", "deal", "id", "k", "m", "text", "who"]);
  assert.equal(a.text, "Kick-off\nwith the team");
  assert.equal(a.at, new Date(2026, 9, 20, 10, 30).getTime());
  assert.equal(a.m, NOW);
  assert.deepEqual(r.made[0].target, { act: a.id });
  const b = r.data.acts.find((x) => x.id === r.made[1].id);
  assert.equal(b.k, "note");
  assert.equal(b.at, NOW, "no date = now");
  // merge with an older copy keeps them
  assert.equal(C.merge(r.data, d).acts.length, 3);
  // Undo: the untouched one goes, with a tombstone; a changed one stops it
  const u = A.undo("crm_activity", r.data, r.undo, NOW + 1000);
  assert.equal(u.ok, true, u.err);
  assert.equal(C.norm(u.data).acts.length, 1);
  assert.ok(u.data.tombs[a.id] > NOW);
  const ch = clone(r.data);
  ch.acts.find((x) => x.id === a.id).m = NOW + 5;
  assert.match(A.undo("crm_activity", ch, r.undo, NOW + 1000).err, /changed since/);
});

test("crm_followup: follow-ups in normFup's shape, an open one on the same day is a look-alike, Undo", () => {
  const d = crmData();
  const its = items("crm_followup", [
    { customer: "r1", title: "send offer", date: "2026-11-02" },
    { customer: "r1", title: "Call back", date: "2026-11-03", start: "09:15", deal: "r3" }
  ]);
  const p = A.plan("crm_followup", d, its, CTX);
  assert.equal(p.ok, true, p.err);
  assert.equal(p.rows[0].dup.id, "f1aaaaaaaa");
  assert.equal(p.rows[1].dup, null);
  const r = A.apply("crm_followup", d, its, NOW, { 0: true }, CTX);
  assert.equal(r.ok, true, r.err);
  assert.deepEqual(C.norm(clone(r.data)), r.data);
  const f = r.data.fups.find((x) => x.id === r.made[0].id);
  assert.deepEqual(f, { id: f.id, m: NOW, cust: "c1aaaaaaaa", d: "2026-11-03", text: "Call back", t: "09:15", deal: "d1aaaaaaaa" });
  assert.deepEqual(r.made[0].target, { fup: f.id });
  const u = A.undo("crm_followup", r.data, r.undo, NOW + 1);
  assert.equal(u.ok, true, u.err);
  assert.equal(C.norm(u.data).fups.length, 1);
});

test("crm_deal: deals in normDeal's shape, stages by any name, won/lost get the day, Undo spares a deal with history", () => {
  const d = crmData();
  const its = items("crm_deal", [
    { customer: "r1", title: "website" },
    { customer: "r2", title: "Logo", amount: 450.5, stage: "Πρόταση", date: "2026-12-01", probability: 60, note: "Two drafts" },
    { customer: "r2", title: "Flyer", amount: "90", stage: "lost", reason: "Too expensive" }
  ]);
  const p = A.plan("crm_deal", d, its, CTX);
  assert.equal(p.ok, true, p.err);
  assert.equal(p.rows[0].dup.id, "d1aaaaaaaa", "an open deal of the same title is a look-alike");
  assert.deepEqual(p.rows[1].fields, [["customer", "Beta"], ["stage", "Πρόταση"], ["amount", "450.50 EUR"], ["close", "2026-12-01"], ["probability", "60%"], ["note", "Two drafts"]]);
  assert.deepEqual(p.rows[2].fields, [["customer", "Beta"], ["stage", "Χάθηκε"], ["amount", "90.00 EUR"], ["reason", "Too expensive"]]);
  const r = A.apply("crm_deal", d, its, NOW, { 0: true }, CTX);
  assert.equal(r.ok, true, r.err);
  assert.deepEqual(C.norm(clone(r.data)), r.data);
  const logo = r.data.deals.find((x) => x.id === r.made[0].id);
  assert.deepEqual(logo, { id: logo.id, m: NOW, cust: "c2bbbbbbbb", title: "Logo", val: 45050, stage: "proposal", prob: 60, close: "2026-12-01", note: "Two drafts", ct: NOW });
  const flyer = r.data.deals.find((x) => x.id === r.made[1].id);
  assert.equal(flyer.stage, "lost");
  assert.equal(flyer.cd, "2026-10-26");
  assert.equal(flyer.why, "Too expensive");
  // the first open stage by default
  const r2 = A.apply("crm_deal", d, items("crm_deal", [{ customer: "r2", title: "Card" }]), NOW, {}, CTX);
  assert.equal(r2.data.deals.find((x) => x.title === "Card").stage, "new");
  // Undo refuses while a new deal has history since
  const withAct = clone(r.data);
  withAct.acts.push({ id: "a9aaaaaaaa", m: NOW + 1, cust: "c2bbbbbbbb", k: "note", at: NOW, text: "x", deal: logo.id });
  assert.match(A.undo("crm_deal", withAct, r.undo, NOW + 2).err, /history or follow-ups/);
  const u = A.undo("crm_deal", r.data, r.undo, NOW + 2);
  assert.equal(u.ok, true, u.err);
  assert.deepEqual(C.norm(u.data).deals.map((x) => x.id), ["d1aaaaaaaa"]);
});

test("crm: tool and prompt list history, follow-ups and deals only when CRM is allowed", () => {
  const tool = (creates) => core.toolsFor({ creates }).find((x) => x.name === "create_items");
  const t = tool(["crm", "crm_activity", "crm_followup", "crm_deal"]);
  assert.deepEqual(t.params.properties.app.enum, ["crm", "crm_activity", "crm_followup", "crm_deal"]);
  ["customer", "deal", "channel", "who", "stage", "probability", "reason", "amount", "start"].forEach((f) => assert.ok(t.params.properties.items.items.properties[f], f));
  const t2 = tool(["todo"]);
  assert.equal(t2.params.properties.items.items.properties.customer, undefined);
  assert.equal(t2.params.properties.items.items.properties.stage, undefined);
  assert.match(core.systemPrompt({ data: true, creates: ["crm", "crm_activity", "crm_followup", "crm_deal"] }), /To add new CRM customers or partners, CRM history entries .*, CRM follow-ups, CRM deals, call create_items.*give its ref as customer/);
  assert.doesNotMatch(core.systemPrompt({ data: true, creates: ["todo"] }), /give its ref as customer/);
});

test("crm: assistant.js offers the CRM records with CRM and turns refs into ids", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "assistant", "assistant.js"), "utf8");
  assert.match(src, /var CRM_ADD = \["crm_activity", "crm_followup", "crm_deal"\]/);
  assert.match(src, /if \(crm\) CRM_ADD\.forEach/);
  assert.match(src, /o\.cust = rc\.target\.cust/);
  assert.match(src, /o\.dealId = rd\.target\.deal/);
  assert.match(src, /addRef\(c, app\.of \|\| app\.id/);
});

// ---------- change_item: roles, deals, follow-ups (assistant/edits.js) ----------
const E = require("../assistant/edits.js");
function change(d, target, args, now) {
  const ch = E.normArgs(Object.assign({ ref: "r1" }, args));
  assert.equal(ch.ok, true, ch.err);
  const p = E.plan("crm", d, target, ch, now);
  if (!p.ok) return p;
  const r = E.apply("crm", d, target, ch, now, p.before);
  assert.equal(r.ok, true, r.err);
  return Object.assign(r, { plan: p });
}

test("change crm roles: the pt row as rolesRow keeps it (links stay), canonical, Undo", () => {
  const d0 = crmData();
  const r = change(d0, { cust: "c1aaaaaaaa" }, { action: "update", roles: ["customer", "supplier"] }, NOW);
  assert.deepEqual(r.plan.rows, [{ f: "roles", b: "cust", a: "cust,sup" }]);
  assert.deepEqual(r.data.pt, [{ id: "c1aaaaaaaa", m: NOW, roles: ["cust", "sup"] }]);
  assert.deepEqual(JSON.stringify(C.norm(clone(r.data))), JSON.stringify(r.data), "same bytes as CRM's norm (pt where CRM puts it)");
  assert.equal(C.hasRole(r.data, { id: "c1aaaaaaaa" }, "sup"), true);
  // links stay; back to customer only keeps an emptied row
  const withLn = clone(r.data);
  withLn.pt[0].ln = ["sup:abc"];
  const r2 = change(withLn, { cust: "c1aaaaaaaa" }, { action: "update", roles: ["customer"] }, NOW + 10);
  assert.deepEqual(r2.data.pt, [{ id: "c1aaaaaaaa", m: NOW + 10, ln: ["sup:abc"] }]);
  assert.deepEqual(C.norm(clone(r2.data)), r2.data);
  // roles + a detail in one update
  const r3 = change(d0, { cust: "c2bbbbbbbb" }, { action: "update", roles: ["author"], job_title: "Translator" }, NOW);
  assert.deepEqual(r3.plan.rows.map((x) => x.f), ["roles", "job"]);
  assert.equal(r3.data.cust.find((c) => c.id === "c2bbbbbbbb").job, "Translator");
  assert.equal(C.norm(clone(r3.data)).pt[0].roles[0], "auth");
  const u = E.undo("crm", r3.data, r3.undo, NOW + 20);
  assert.equal(u.ok, true, u.err);
  assert.equal(u.data.cust.find((c) => c.id === "c2bbbbbbbb").job, undefined);
  assert.equal(C.rolesOf(u.data, { id: "c2bbbbbbbb" }).join(), "cust");
  assert.deepEqual(C.norm(clone(u.data)), u.data);
  assert.match(change(d0, { cust: "c1aaaaaaaa" }, { action: "update", roles: ["customer"] }, NOW).err, /already has these roles/);
  assert.match(E.normArgs({ ref: "r1", action: "update", roles: ["boss"] }).err, /roles must be from/);
});

test("change crm deal: stage by any name, won/lost get the day, reason only when lost, Undo", () => {
  const d0 = crmData();
  const r = change(d0, { deal: "d1aaaaaaaa" }, { action: "update", stage: "Κερδήθηκε", amount: 1800, probability: 90 }, NOW);
  assert.deepEqual(r.plan.rows, [{ f: "stage", b: "stg:proposal", a: "stg:won" }, { f: "amount", b: "1500.00 EUR", a: "1800.00 EUR" },
                                 { f: "probability", b: "", a: "90%" }]);
  const x = r.data.deals[0];
  assert.deepEqual(x, { id: "d1aaaaaaaa", m: NOW, cust: "c1aaaaaaaa", title: "Website", val: 180000, stage: "won", prob: 90, cd: x.cd, ct: T0 });
  assert.match(x.cd, /^\d{4}-\d\d-\d\d$/);
  assert.deepEqual(C.norm(clone(r.data)), r.data);
  const back = change(r.data, { deal: "d1aaaaaaaa" }, { action: "update", stage: "nego" }, NOW + 5);
  assert.equal(back.data.deals[0].cd, undefined, "an open stage has no close day");
  assert.match(change(d0, { deal: "d1aaaaaaaa" }, { action: "update", reason: "Price" }, NOW).err, /only for a lost deal/);
  const lost = change(d0, { deal: "d1aaaaaaaa" }, { action: "update", stage: "lost", reason: "Price" }, NOW);
  assert.equal(lost.data.deals[0].why, "Price");
  assert.match(change(d0, { deal: "d1aaaaaaaa" }, { action: "update", stage: "Later" }, NOW).err, /no stage named "Later".*Proposal/);
  const rs = change(d0, { deal: "d1aaaaaaaa" }, { action: "reschedule", date: "2026-12-15" }, NOW);
  assert.equal(rs.data.deals[0].close, "2026-12-15");
  assert.match(change(d0, { deal: "d1aaaaaaaa" }, { action: "complete" }, NOW).err, /takes update/);
  const u = E.undo("crm", r.data, r.undo, NOW + 9);
  assert.equal(u.ok, true, u.err);
  assert.equal(u.data.deals[0].stage, "proposal");
  assert.equal(u.data.deals[0].m, NOW + 9);
  assert.deepEqual(C.norm(clone(u.data)), u.data);
  const moved = clone(r.data);
  moved.deals[0].m = NOW + 3;
  assert.match(E.undo("crm", moved, r.undo, NOW + 9).err, /changed in CRM since/);
});

test("change crm follow-up: complete, reopen, reschedule, update; canonical", () => {
  const d0 = crmData();
  const c1 = change(d0, { fup: "f1aaaaaaaa" }, { action: "complete" }, NOW);
  assert.match(c1.data.fups[0].done, /^\d{4}-\d\d-\d\d$/);
  assert.deepEqual(c1.plan.rows, [{ f: "done", b: false, a: true }]);
  assert.deepEqual(C.norm(clone(c1.data)), c1.data);
  assert.match(change(c1.data, { fup: "f1aaaaaaaa" }, { action: "complete" }, NOW + 1).err, /already done/);
  const ro = change(c1.data, { fup: "f1aaaaaaaa" }, { action: "reopen" }, NOW + 1);
  assert.equal(ro.data.fups[0].done, undefined);
  const rs = change(d0, { fup: "f1aaaaaaaa" }, { action: "reschedule", date: "2026-11-09", start: "16:00" }, NOW);
  assert.deepEqual(rs.data.fups[0], { id: "f1aaaaaaaa", m: NOW, cust: "c1aaaaaaaa", d: "2026-11-09", text: "Send offer", t: "16:00" });
  assert.deepEqual(C.norm(clone(rs.data)), rs.data);
  const up = change(d0, { fup: "f1aaaaaaaa" }, { action: "update", title: "Send the new offer" }, NOW);
  assert.equal(up.data.fups[0].text, "Send the new offer");
  assert.match(change(d0, { fup: "f1aaaaaaaa" }, { action: "update", note: "x" }, NOW).err, /has no note/);
  const u = E.undo("crm", c1.data, c1.undo, NOW + 2);
  assert.equal(u.ok, true, u.err);
  assert.equal(u.data.fups[0].done, undefined);
  // a customer still only takes update; an activity can't be changed
  assert.match(change(d0, { cust: "c1aaaaaaaa" }, { action: "complete" }, NOW).err, /can only be updated/);
  assert.match(change(d0, { act: "x" }, { action: "update", title: "x" }, NOW).err, /not a history entry/);
});
