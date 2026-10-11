// orOS Mail — device rules (mail/rules.js) and their sync merge.
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../mail/rules.js");

const A1 = "acct0001", A2 = "acct0002";
const rule = (o) => Object.assign({ id: "rule" + Math.random().toString(36).slice(2, 8), m: 1, on: true, acct: A1, field: "from", has: "x", act: "read" }, o);
const sum = (from, subj, to) => ({ from: { name: from[0], addr: from[1] }, to: (to || []).map((a) => ({ name: "", addr: a })), cc: [], subject: subj });

test("rules: norm keeps valid rules and drops broken ones", () => {
  assert.deepEqual(R.norm(rule({ id: "r00001", has: "  News@A.gr \n", act: "move", to: "INBOX.News", extra: 1 })),
    { id: "r00001", m: 1, on: true, acct: A1, field: "from", has: "News@A.gr", act: "move", to: "INBOX.News" });
  assert.equal(R.norm(rule({ on: false })).on, false);
  for (const bad of [{ id: "x" }, { m: -1 }, { acct: "" }, { field: "body" }, { act: "delete" }, { has: "  " },
                     { act: "move" }, { act: "move", to: "a\r\nb" }, { act: "move", to: 'a"b' }]) {
    assert.equal(R.norm(rule(bad)), null, JSON.stringify(bad));
  }
  assert.equal(R.norm(rule({ act: "read", to: "X" })).to, undefined);
});

test("rules: match by field, any of comma-separated words, case-insensitive", () => {
  const s = sum(["Λογιστήριο", "billing@shop.gr"], "Τιμολόγιο Οκτωβρίου", ["me@pmail.gr"]);
  assert.ok(R.match(rule({ has: "SHOP.GR" }), s, A1));
  assert.ok(R.match(rule({ has: "nothing, λογιστήριο" }), s, A1));
  assert.ok(R.match(rule({ field: "subject", has: "τιμολόγιο" }), s, A1));
  assert.ok(R.match(rule({ field: "to", has: "me@pmail" }), s, A1));
  assert.ok(R.match(rule({ field: "any", has: "οκτωβρ" }), s, A1));
  assert.ok(!R.match(rule({ field: "subject", has: "shop.gr" }), s, A1));
  assert.ok(!R.match(rule({ has: "shop.gr" }), s, A2), "other account");
  assert.ok(!R.match(rule({ has: "shop.gr", on: false }), s, A1), "switched off");
  // mail.js summaries call the subject "subj"
  assert.ok(R.match(rule({ field: "subject", has: "hello" }), { from: { addr: "a@b.c" }, subj: "Hello" }, A1));
});

test("rules: plan — flags add up, first move wins, set flags are skipped", () => {
  const rules = [
    rule({ id: "r1aaaa", has: "news@", act: "move", to: "INBOX.News" }),
    rule({ id: "r2aaaa", has: "news@", act: "read" }),
    rule({ id: "r3aaaa", field: "subject", has: "urgent", act: "star" }),
    rule({ id: "r4aaaa", has: "news@", act: "move", to: "INBOX.Junk" }),
    rule({ id: "r5aaaa", has: "spam@", act: "move", to: "INBOX.Junk" }),
    rule({ id: "r6aaaa", acct: A2, has: "boss@", act: "star" })
  ];
  const msgs = [
    { uid: 10, sum: sum(["N", "news@a.gr"], "Weekly"), flags: [] },
    { uid: 11, sum: sum(["B", "boss@a.gr"], "Urgent: call me"), flags: ["\\Flagged"] },
    { uid: 12, sum: sum(["B", "boss@a.gr"], "urgent too"), flags: [] },
    { uid: 13, sum: sum(["S", "spam@x.example"], "Win"), flags: ["\\Seen"] },
    { uid: 14, sum: sum(["N", "news@a.gr"], "Seen already"), flags: ["\\Seen"] }
  ];
  const p = R.plan(rules, msgs, A1);
  assert.deepEqual(p.flags["\\Seen"], [10]);
  assert.deepEqual(p.flags["\\Flagged"], [12]);
  assert.deepEqual(p.moves, { "INBOX.News": [10, 14], "INBOX.Junk": [13] });
  assert.deepEqual(p.handled, { 10: "move", 13: "move", 14: "move" });
  assert.deepEqual(R.plan([], msgs, A1), { flags: { "\\Seen": [], "\\Flagged": [] }, moves: {}, handled: {} });
  assert.deepEqual(R.plan(rules, msgs, "nobody1").moves, {});
});
