// CRM "asNew" prefill (crm/core.js asNewCust): the Assistant's entry
// card → the New customer form's fields, or null.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "crm/core.js"));

test("asNewCust: needs a name or a company", () => {
  assert.equal(C.asNewCust(null), null);
  assert.equal(C.asNewCust([]), null);
  assert.equal(C.asNewCust({ email: "a@b.gr" }), null);
  assert.equal(C.asNewCust({ name: " \u0001 " }), null);
});

test("asNewCust: person, or company with the person as who", () => {
  assert.deepEqual(C.asNewCust({ name: " Maria  Papa " }), { kind: "person", name: "Maria Papa", who: "" });
  assert.deepEqual(C.asNewCust({ name: "Maria", company: "Acme ΑΕ" }), { kind: "co", name: "Acme ΑΕ", who: "Maria" });
  assert.equal(C.asNewCust({ name: "ACME", company: "Acme" }).who, "");
  assert.equal(C.asNewCust({ company: "x".repeat(300) }).name.length, 120);
});

test("asNewCust: fields clamped, bad ones dropped, unknown ignored", () => {
  const n = C.asNewCust({ name: "N", email: "N@Example.gr", phone: "+30 210 1234567", afm: "el 094 019 245",
                          address: "Ermou 1\nAthens", note: "a\r\nb\u0000", web: "https://x", st: "won" });
  assert.deepEqual(n, { kind: "person", name: "N", who: "", email: "N@Example.gr", phone: "+30 210 1234567",
                        afm: "EL094019245", addr: "Ermou 1 Athens", note: "a\nb" });
  const b = C.asNewCust({ name: "N", email: "bad", phone: "call me", vat: "<b>", note: 3 });
  assert.deepEqual(b, { kind: "person", name: "N", who: "" });
  assert.equal(C.asNewCust({ name: "N", vat: "123456789" }).afm, "123456789");
});
