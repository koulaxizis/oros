// orOS Mail — recipients from Contacts (mail/people.js)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../mail/people.js");

const raw = {
  contacts: [
    { id: "c1", given: "Μαρία", family: "Παπαδοπούλου", emails: [{ v: "maria@x.gr", type: "home" }, { v: "m.pap@work.gr", type: "work" }] },
    { id: "c2", given: "", family: "", nickname: "", org: "ACME", emails: [{ v: "info@acme.com" }] },
    { id: "c3", given: "Άννα", emails: [{ v: "not an address" }, { v: "MARIA@x.gr" }] },
    { id: "c4", given: "Gone", del: true, emails: [{ v: "gone@x.gr" }] },
    { id: "c5", given: "Removed", emails: [{ v: "removed@x.gr" }] },
    { id: "c6", given: "Νίκος", family: "Ανδρέου", emails: [{ v: "nikos@andreou.gr" }] },
    null, { id: 7 }
  ],
  deleted: [{ id: "c5", mtime: 1 }]
};

test("people: live contacts, one entry per valid address, duplicates once", () => {
  const ps = P.fromContacts(raw);
  assert.deepEqual(ps.map((p) => [p.name, p.addr]), [
    ["Μαρία Παπαδοπούλου", "maria@x.gr"], ["Μαρία Παπαδοπούλου", "m.pap@work.gr"], ["ACME", "info@acme.com"], ["Νίκος Ανδρέου", "nikos@andreou.gr"]
  ]);
  assert.deepEqual(P.fromContacts(null), []);
  assert.deepEqual(P.fromContacts({ contacts: "x" }), []);
});

test("people: suggestions ignore case and accents, word starts first, skip what is there", () => {
  const ps = P.fromContacts(raw);
  assert.deepEqual(P.suggest(ps, "μαρ").map((p) => p.addr), ["m.pap@work.gr", "maria@x.gr"]);
  assert.deepEqual(P.suggest(ps, "ΑΝΔΡ").map((p) => p.addr), ["nikos@andreou.gr"]);        // family name, no accent
  assert.deepEqual(P.suggest(ps, "andreou").map((p) => p.addr), ["nikos@andreou.gr"]);     // inside the address
  assert.deepEqual(P.suggest(ps, "m", ["MARIA@x.gr"]).map((p) => p.addr), ["m.pap@work.gr", "info@acme.com"]);
  assert.deepEqual(P.suggest(ps, ""), []);
  assert.deepEqual(P.suggest(ps, "<"), []);
  assert.equal(P.suggest(ps, "a", [], 2).length, 2);
});

test("people: the address being typed and putting a pick in its place", () => {
  const v = 'Bob <bob@x.gr>, "Smith, Jo" <jo@x.gr>; ma';
  const tk = P.token(v, v.length);
  assert.equal(tk.text, "ma");
  assert.equal(P.put(v, tk, "Μαρία <maria@x.gr>"), 'Bob <bob@x.gr>, "Smith, Jo" <jo@x.gr>; Μαρία <maria@x.gr>, ');
  // caret in the middle: only that piece
  const v2 = "a@b.gr, ni, c@d.gr";
  const tk2 = P.token(v2, 10);
  assert.deepEqual([tk2.text, tk2.start, tk2.end], ["ni", 7, 10]);
  assert.equal(P.put(v2, tk2, "Νίκος <nikos@andreou.gr>"), "a@b.gr, Νίκος <nikos@andreou.gr>, c@d.gr");
  assert.equal(P.put("ni", P.token("ni", 2), "N <n@x.gr>"), "N <n@x.gr>, ");
  // a comma inside quotes is not a separator
  assert.equal(P.token('"Smith, J', 9).text, '"Smith, J');
});
