// Contacts "asNew" prefill (contacts/cardtext.js fromAsNew): the
// Assistant's entry card → a clamped parser-shape contact, or null.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const CT = require(path.join(__dirname, "..", "contacts/cardtext.js"));

test("fromAsNew: needs a name or a company", () => {
  assert.equal(CT.fromAsNew(null), null);
  assert.equal(CT.fromAsNew([]), null);
  assert.equal(CT.fromAsNew({ phones: ["2101234567"], note: "x" }), null);
  assert.equal(CT.fromAsNew({ given: "  \u0000 " }), null);
  assert.equal(CT.fromAsNew({ org: "Acme" }).org, "Acme");
});

test("fromAsNew: name split like add, given/family win", () => {
  const a = CT.fromAsNew({ name: "  Maria  Anna Papadopoulou " });
  assert.equal(a.given, "Maria Anna");
  assert.equal(a.family, "Papadopoulou");
  assert.equal(CT.fromAsNew({ name: "Cher" }).given, "Cher");
  const b = CT.fromAsNew({ given: "Nikos", name: "Ignored Name" });
  assert.equal(b.given, "Nikos");
  assert.equal(b.family, "");
  assert.equal(CT.fromAsNew({ given: "x".repeat(90) }).given.length, 60);
});

test("fromAsNew: phones, emails, address, birthday, note clamped", () => {
  const c = CT.fromAsNew({
    given: "A\u0007b", org: 5,
    phones: ["+30 69 1234 5678", "no digits", 42, "1", "2", "3", "4", "5"],
    emails: ["A@x.gr", "a@x.gr", "bad", "b@y.com"],
    address: "Ermou 1\nAthens",
    birthday: "1980-02-29",
    note: "line 1\r\nline 2\u0000",
    unknown: "ignored"
  });
  assert.equal(c.given, "A b");
  assert.equal(c.org, "");
  assert.deepEqual(c.phones.map((p) => p.v), ["+30 69 1234 5678", "1", "2", "3", "4"]);
  assert.deepEqual(c.emails, [{ v: "A@x.gr", type: "home" }, { v: "b@y.com", type: "home" }]);
  assert.equal(c.addresses[0].street, "Ermou 1 Athens");
  assert.deepEqual(c.events, [{ day: "02-29", year: 1980, type: "birthday", label: "" }]);
  assert.equal(c.note, "line 1\nline 2");
  assert.equal(c.unknown, undefined);
  assert.equal(CT.fromAsNew({ given: "a", phones: "2310 123456" }).phones.length, 1);
});

test("fromAsNew: only real birthdays", () => {
  const bd = (v) => CT.fromAsNew({ given: "a", birthday: v }).events;
  assert.deepEqual(bd("1981-02-29"), []);
  assert.deepEqual(bd("1980-13-01"), []);
  assert.deepEqual(bd("1850-01-01"), []);
  assert.deepEqual(bd("3000-01-01"), []);
  assert.deepEqual(bd("17/03/1975"), []);
  assert.deepEqual(bd("--02-29"), [{ day: "02-29", year: null, type: "birthday", label: "" }]);
  assert.deepEqual(bd("03-17"), [{ day: "03-17", year: null, type: "birthday", label: "" }]);
  assert.equal(CT.fromAsNew({ given: "a", note: "n".repeat(900) }).note.length, 900);
  assert.equal(CT.fromAsNew({ given: "a", note: "n".repeat(2500) }).note.length, 2000);
});
