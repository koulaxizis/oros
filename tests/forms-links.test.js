// Forms W4 (FORMS-4): answers to Contacts / CRM, Assistant drafts, search.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const E = require("../forms/engine.js");
const L = require("../forms/links.js");
const SP = require("../forms/search.js");

const FORM = { id: "f1", title: "Workshop", qs: [
  { id: "city", t: "text", label: "City" },
  { id: "nm", t: "text", label: "Your full name" },
  { id: "em", t: "email", label: "E-mail" },
  { id: "ph", t: "phone", label: "Mobile" },
  { id: "c", t: "choice", label: "Day", opts: [{ id: "a", label: "Mon" }] }
] };

test("person: the name question by its label, then e-mail and phone", () => {
  const p = L.person(FORM, { a: { city: "Patra", nm: " Maria K. ", em: "m@x.gr", ph: "+30 690 000" } });
  assert.deepEqual(p, { name: "Maria K.", email: "m@x.gr", phone: "+30 690 000" });
  // no "name" label: the first short text before the e-mail
  const f2 = { id: "f2", qs: [{ id: "a", t: "text", label: "Who are you?" }, { id: "e", t: "email", label: "Mail" }, { id: "b", t: "text", label: "Notes" }] };
  assert.equal(L.person(f2, { a: { a: "Nikos", b: "later", e: "n@x.gr" } }).name, "Nikos");
  // Greek and German labels, accents and final sigma folded
  assert.equal(L.person({ id: "g", qs: [{ id: "a", t: "text", label: "Πόλη" }, { id: "b", t: "text", label: "Ονοματεπώνυμο" }] }, { a: { a: "Αθήνα", b: "Μαρία" } }).name, "Μαρία");
  assert.equal(L.person({ id: "d", qs: [{ id: "a", t: "text", label: "Vorname" }] }, { a: { a: "Jan" } }).name, "Jan");
  // an invalid e-mail is not an e-mail; nothing at all → null
  assert.equal(L.person(FORM, { a: { em: "nope" } }), null);
  assert.equal(L.person(FORM, { a: {} }), null);
  assert.equal(L.person(FORM, null), null);
});

test("toContact / toCrm: the apps' own New contact and New customer prefill", () => {
  const p = { name: "Maria K.", email: "m@x.gr", phone: "" };
  assert.deepEqual(L.toContact(p, "Workshop"), { asNew: { name: "Maria K.", emails: ["m@x.gr"], phones: [], from: "Workshop" } });
  assert.deepEqual(L.toCrm(p, "Workshop"), { asNew: { name: "Maria K.", email: "m@x.gr", from: "Workshop" } });
  assert.equal(L.toContact({ name: "", email: "a@b.cc" }, "x"), null);
  assert.equal(L.toCrm(null, "x"), null);
});

test("fromDraft: simple words become a form the engine keeps as it is", () => {
  const d = L.fromDraft({ title: "Sign-up", desc: "For the fair", questions: [
    "Your name",
    { label: "E-mail", type: "email", required: true },
    { label: "Day", type: "one", options: ["Sat", { label: "Sun" }] },
    { label: "Extras", type: "checkboxes", options: [] },          // no options → short text
    { label: "How likely", type: "scale", low: 0, high: 10 },
    { label: "Rate", type: "rating", high: 99 },
    { label: "Grid", type: "grid", options: ["Good", "Bad"], rows: ["Food"] },
    { label: "", type: "text" },                                   // no label → left out
    { label: "Odd", type: "upload" }                               // unknown → short text
  ] });
  const f = E.normForm(Object.assign({ id: "f9" }, d));
  assert.deepEqual(f.qs.map((q) => q.t), ["text", "email", "choice", "text", "scale", "stars", "matrix", "text"]);
  assert.equal(f.qs[1].req, 1);
  assert.deepEqual(f.qs[2].opts.map((o) => o.label), ["Sat", "Sun"]);
  assert.deepEqual([f.qs[4].lo, f.qs[4].hi, f.qs[5].hi], [0, 10, 5]);
  assert.equal(new Set(f.qs.map((q) => q.id)).size, f.qs.length);
  assert.equal(f.title, "Sign-up");
  assert.equal(L.fromDraft({ questions: [] }), null);
  assert.equal(L.fromDraft("x"), null);
  const many = L.fromDraft({ title: "t", questions: Array.from({ length: 150 }, (_, i) => "Q" + i) });
  assert.equal(many.qs.length, L.MAX_DRAFT);
});

test("search: one hit per live form with its questions, deep link { form }", () => {
  const data = { ver: 1, forms: [
    { id: "f1", m: 5, title: "Workshop", desc: "May", qs: [{ id: "a", t: "text", label: "Name" }, { id: "p", t: "page", label: "" }] },
    { id: "f2", m: 6, del: 1 },
    { id: "f3", m: 7, title: "", qs: [] }
  ] };
  const hits = SP.search({ readJSON: () => data, lang: "en" });
  assert.deepEqual(hits.map((h) => h.id), ["f1", "f3"]);
  assert.equal(hits[0].text, "May · Questions: Name");
  assert.deepEqual(hits[0].target, { form: "f1" });
  assert.equal(hits[1].title, "Untitled form");
  assert.deepEqual(SP.search({ readJSON: () => null, lang: "en" }), []);
});

test("wiring: links.js before app.js, buttons and draft in the app, strings in EN, EL and DE", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "forms/index.html"), "utf8");
  assert.ok(html.indexOf("links.js") > 0 && html.indexOf("links.js") < html.indexOf("app.js?"));
  const app = fs.readFileSync(path.join(root, "forms/app.js"), "utf8");
  assert.ok(app.includes("LK.toContact(") && app.includes("LK.toCrm(") && app.includes("LK.fromDraft(tg.draft)"));
  const de = fs.readFileSync(path.join(root, "i18n/de/forms.js"), "utf8");
  for (const k of ["an.toContacts", "an.toCrm", "dr.made", "srch.qs", "srch.untitled"]) {
    if (!k.startsWith("srch.")) assert.ok(app.split('"' + k + '"').length - 1 >= 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '"'), k + " in DE");
  }
});

test("Assistant / Gate: propose_entry form opens a draft in Forms; app_summary forms gives counts only", () => {
  global.window = global.window || {};
  const AC = require("../assistant/core.js");
  const S = require("../assistant/summary.js");
  const RS = require("../forms/results.js");
  const r = AC.normEntry({ kind: "form", title: "Fair sign-up", desc: "Sat 10:00", questions: [
    "Name", { label: "E-mail", type: "email", required: true }, { label: "Day", type: "choice", options: ["Sat", "Sun"] }, { label: "Odd", type: "upload" }] });
  assert.equal(r.ok, true);
  assert.equal(r.app, "forms");
  assert.equal(r.call.fn, "openAt");
  const draft = r.call.args[1].draft;
  assert.equal(draft.questions[3].type, "text");
  // what the Assistant sends is what Forms makes
  const f = E.normForm(Object.assign({ id: "fz" }, L.fromDraft(draft)));
  assert.deepEqual(f.qs.map((q) => q.t), ["text", "email", "choice", "text"]);
  assert.match(AC.normEntry({ kind: "form", title: "x", questions: [] }).err, /needs questions/);
  assert.match(AC.normEntry({ kind: "form", title: "x", questions: Array(101).fill("q") }).err, /at most 100/);
  // the same tool on both sides: the Gate takes the Assistant's tools
  const pe = AC.toolsFor({ entries: 1 }).find((t) => t.name === "propose_entry");
  assert.ok(pe && pe.params.properties.kind.enum.includes("form"));

  const data = { ver: 1, forms: [{ id: "f1", m: 1, title: "Fair", x: { k: "abcdefghijklmnop", open: 1 },
    qs: [{ id: "n", t: "text", label: "Name" }, { id: "e", t: "email", label: "Mail" }, { id: "c", t: "choice", label: "Day", opts: [{ id: "a", label: "Sat" }, { id: "b", label: "Sun" }] }] }] };
  const ans = { ver: 1, seen: { f1: 1500 }, rs: [
    { id: "abcdefghijklmnop.1", f: "f1", at: 1000, a: { n: "Maria", e: "m@x.gr", c: "a" } },
    { id: "abcdefghijklmnop.2", f: "f1", at: 2000, a: { n: "Bo", e: "b@x.gr", c: "a" } }] };
  const list = S.formsSummary(data, ans, {});
  assert.deepEqual(list.forms[0], { title: "Fair", questions: 3, shared: true, open: true, answers: 2, new: 1, last: "1970-01-01", target: { form: "f1" } });
  const W = { yes: "Yes", no: "No", other: (x) => x, otherName: "Other", time: "Time", wait: "Waiting list" };
  const one = S.formsSummary(data, ans, { form: "fair" }, RS, W);
  assert.deepEqual(one.results[2].counts, [{ option: "Sat", n: 2, pct: 100 }, { option: "Sun", n: 0, pct: 0 }]);
  const txt = JSON.stringify(one);
  for (const secret of ["Maria", "m@x.gr", "Bo", "b@x.gr"]) assert.ok(!txt.includes(secret), secret + " stays out");
  assert.match(S.formsSummary(data, ans, { form: "nope" }, RS, W).err, /No form called/);
  assert.equal(S.normArgs({ app: "forms", form: "  Fair " }, "2026-11-14").form, "Fair");
});
