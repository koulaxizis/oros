// Assistant: a CRM partner linked to records of other apps (AS-LINK,
// wave A5, assistant/links.js): a Stock supplier or consignment shop,
// a Timesheet client, an Invoices client, a person on Publishing
// titles. The link is CRM's own pt row (crm/core.js linkMove), written
// as CRM's savePt writes it (stored = CRM's norm()); the other apps
// are never changed; a record belongs to one partner (linking moves
// it); Undo puts the rows back only while nobody changed them.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../assistant/links.js");
const C = require("../crm/core.js");
const LK = require("../crm/links.js");
const core = require("../assistant/core.js");

const NOW = 1790000000000;
const T0 = NOW - 86400000;
const clone = (x) => JSON.parse(JSON.stringify(x));
const J = (x) => JSON.stringify(x);

function crmData() {
  const d = C.empty();
  d.cust.push({ id: "c1aaaaaaaa", m: T0, name: "Alpha Books", kind: "company", st: "active" });
  d.cust.push({ id: "c2bbbbbbbb", m: T0, name: "Beta Print", kind: "company", st: "active" });
  d.pt = [{ id: "c2bbbbbbbb", m: T0, roles: ["sup"], ln: ["sup:supprint1"] }];
  return C.norm(d);
}
// what crm/links.js finds on this device (Stock, Timesheet, Invoices, Publishing)
const CANDS = LK.candidates({
  stock: { sups: [{ id: "supprint1", name: "Beta Print" }, { id: "suppaper1", name: "Paper Co" }] },
  ts: { clients: [{ id: "tsclient01", name: "Alpha Books" }] },
  inv: { clients: [{ id: "invcli0001", name: "Alpha Books SA" }, { id: "invcli0002", name: "Linked", crm: "c1aaaaaaaa" }] },
  pub: { titles: [{ id: "t1", t: "Night Sea", ppl: [{ n: "Ann Writer", r: "auth" }] }] }
}, {});
const REFS = {
  r1: { app: "crm", target: { cust: "c1aaaaaaaa" }, title: "Alpha Books" },
  r2: { app: "crm", target: { cust: "c2bbbbbbbb" }, title: "Beta Print" },
  r3: { app: "stock", target: { sup: "supprint1" }, title: "Beta Print" },
  r4: { app: "timesheet", target: { client: "tsclient01" }, title: "Alpha Books" },
  r5: { app: "invoices", target: { client: { id: "invcli0001" } }, title: "Alpha Books SA" },
  r6: { app: "invoices", target: { client: { id: "invcli0002" } }, title: "Linked" },
  r7: { app: "stock", target: { item: "it1" }, title: "Paper" }
};
const refOf = (r) => REFS[r] || null;
function resolve(list, d) { const r = L.resolve(list, refOf, CANDS, C, d || crmData()); assert.ok(r.links, r.err); return r.links; }
function err(list) { const r = L.resolve(list, refOf, CANDS, C, crmData()); assert.ok(r.err); return r.err; }

test("link_items: refs and names become CRM's own link keys", () => {
  const ls = resolve([{ customer: "r1", item: "r4" }, { customer: "r1", item: "r5" }, { customer: "r1", person: "ann writer" }, { customer: "r1", item: "r3" }]);
  assert.deepEqual(ls.map((l) => l.key), ["tsc:tsclient01", "inv:invcli0001", "pub:ann writer", "sup:supprint1"]);
  const p = L.plan(C, crmData(), ls);
  assert.equal(p.rows[3].from, "Beta Print", "the supplier is Beta Print's now: linking moves it");
  assert.equal(p.rows[0].same, false);
  assert.equal(L.plan(C, crmData(), resolve([{ customer: "r2", item: "r3" }])).rows[0].same, true, "linked already");
});
test("link_items: refusals (no names for customers, the wrong kind of ref, gone, Invoices' own link, two at once)", () => {
  assert.match(err([{ customer: "Alpha", item: "r4" }]), /CRM customer's ref/);
  assert.match(err([{ customer: "r1", item: "r7" }]), /Stock supplier, a Timesheet client or an Invoices client/);
  assert.match(err([{ customer: "r1", item: "r6" }]), /linked to CRM in Invoices itself/);
  assert.match(err([{ customer: "r1", item: "r4", person: "Ann Writer" }]), /exactly one/);
  assert.match(err([{ customer: "r1", person: "Nobody" }]), /no person on Publishing titles is named "Nobody"\. There are: Ann Writer/);
  assert.match(err([{ customer: "r1", shop: "Corner Books" }]), /none on this device/);
  assert.match(err([{ customer: "r1", item: "r4" }, { customer: "r2", item: "r4" }]), /same record/);
  assert.match(err([{ customer: "r1", item: "r3", unlink: true }]), /not linked/);
  assert.match(err(Array.from({ length: 51 }, () => ({ customer: "r1", item: "r4" }))), /At most 50/);
});
test("link_items: written as CRM's savePt (stored = norm), a move, unticked links, Undo", () => {
  const d = crmData();
  const ls = resolve([{ customer: "r1", item: "r4" }, { customer: "r1", item: "r3" }, { customer: "r1", person: "Ann Writer" }], d);
  const r = L.apply(C, d, ls, NOW, { 2: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.done, [0, 1]);
  assert.deepEqual(C.byId(r.data.pt, "c1aaaaaaaa"), { id: "c1aaaaaaaa", m: NOW, ln: ["sup:supprint1", "tsc:tsclient01"] });
  assert.deepEqual(C.byId(r.data.pt, "c2bbbbbbbb"), { id: "c2bbbbbbbb", m: NOW, roles: ["sup"] }, "moved away; its role stays");
  assert.equal(J(C.norm(clone(r.data))), J(r.data), "stored = what CRM's norm makes of it");
  assert.equal(r.data.cust.length, 2, "nothing else changes");
  // unlink
  const un = L.apply(C, r.data, resolve([{ customer: "r1", item: "r4", unlink: true }], r.data), NOW + 1, {});
  assert.deepEqual(C.byId(un.data.pt, "c1aaaaaaaa").ln, ["sup:supprint1"]);
  // Undo: back as it was, newer stamps; refused when changed since
  const changed = clone(r.data);
  C.byId(changed.pt, "c1aaaaaaaa").ln = ["sup:supprint1"];
  assert.match(L.undo(C, changed, r.undo, NOW + 2).err, /changed since/);
  const u = L.undo(C, r.data, r.undo, NOW + 2);
  assert.equal(u.ok, true);
  assert.deepEqual(C.byId(u.data.pt, "c2bbbbbbbb"), { id: "c2bbbbbbbb", m: NOW + 2, roles: ["sup"], ln: ["sup:supprint1"] });
  assert.deepEqual(C.byId(u.data.pt, "c1aaaaaaaa"), { id: "c1aaaaaaaa", m: NOW + 2 }, "an emptied row stays, so the undo syncs");
  assert.equal(J(C.norm(clone(u.data))), J(u.data));
});
test("link_items is offered with CRM, and the prompt tells calendar meetings go to CRM follow-ups", () => {
  const tools = core.toolsFor({ data: true, creates: ["crm"], links: true, partnerLinks: true });
  const t = tools.find((x) => x.name === "link_items");
  assert.ok(t);
  assert.deepEqual(Object.keys(t.params.properties.links.items.properties).sort(), ["customer", "item", "person", "shop", "unlink"]);
  assert.equal(core.toolsFor({ data: true, creates: ["todo"] }).find((x) => x.name === "link_items"), undefined);
  const sp = core.systemPrompt({ lang: "en", now: NOW, apps: ["CRM (crm)", "Stock (stock)"], creates: ["crm", "crm_followup"], partnerLinks: true });
  assert.match(sp, /link_items/);
  assert.match(sp, /Calendar events have no link to a customer/);
});
