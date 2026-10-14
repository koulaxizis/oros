// Writer mail merge (writer/merge.js): placeholders, CSV, Contacts
// records, column matching and escaped merging.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const M = require(path.join(__dirname, "..", "writer/merge.js"));

test("fieldsIn: text placeholders, once each, not inside tags", () => {
  const html = '<p>Dear {{ First name }}, <b>{{LastName}}</b></p><p>{{first_name}} {{Company}}</p>' +
    '<a href="{{Url}}">x</a><p>{{ broken </p>';
  assert.deepEqual(M.fieldsIn(html), ["First name", "LastName", "Company"]);
  assert.deepEqual(M.fieldsIn("<p>none</p>"), []);
});

test("parseCsv: quotes, delimiters, CRLF, BOM, blank lines", () => {
  const c = M.parseCsv('﻿Name,Note\r\n"Smith, Ann","said ""hi""\nthen left"\r\n\r\nBob,\n');
  assert.deepEqual(c.headers, ["Name", "Note"]);
  assert.deepEqual(c.rows, [{ Name: "Smith, Ann", Note: 'said "hi"\nthen left' }, { Name: "Bob", Note: "" }]);
  const s = M.parseCsv("Όνομα;Πόλη\nΜαρία;Αθήνα\n");
  assert.deepEqual(s.rows, [{ "Όνομα": "Μαρία", "Πόλη": "Αθήνα" }]);
  const tsv = M.parseCsv("a\tb\n1\t2");
  assert.deepEqual(tsv.rows, [{ a: "1", b: "2" }]);
  const dup = M.parseCsv("x,x,\n1,2,3");
  assert.deepEqual(dup.headers, ["x", "x 2", "Column 3"]);
  assert.deepEqual(M.parseCsv(""), { headers: [], rows: [] });
});

test("contactRecords: live contacts, fields, label filter, sorted", () => {
  const raw = {
    labels: [{ id: "lbl-work", name: "Work" }],
    contacts: [
      { id: "c1", given: "Maria", family: "Papadopoulou", org: "ACME", emails: [{ v: "m@x.gr" }],
        phones: [{ v: "  " }, { v: "+30 210" }], addresses: [{ street: "Odos 1", city: "Athens", zip: "10558", country: "Greece" }],
        events: [{ type: "birthday", day: "03-21", year: 1990 }], labelIds: ["lbl-work"] },
      { id: "c2", given: "Ann", family: "Adams" },
      { id: "c3", given: "Gone", del: true },
      { id: "c4", given: "Tomb" }
    ],
    deleted: [{ id: "c4", mtime: 1 }]
  };
  const r = M.contactRecords(raw);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].FullName, "Ann Adams");
  const m = r.rows[1];
  assert.equal(m.FirstName, "Maria");
  assert.equal(m.Email, "m@x.gr");
  assert.equal(m.Phone, "+30 210");
  assert.equal(m.Address, "Odos 1, 10558 Athens, Greece");
  assert.equal(m.Birthday, "21/03/1990");
  assert.equal(M.contactRecords(raw, "lbl-work").rows.length, 1);
  assert.deepEqual(M.contactLabels(raw), [{ id: "lbl-work", name: "Work" }]);
  assert.deepEqual(M.contactRecords(null).rows, []);
});

test("findHeader: case, accents, spaces and aliases", () => {
  const h = ["FullName", "FirstName", "LastName", "Email", "City"];
  assert.equal(M.findHeader("first name", h), "FirstName");
  assert.equal(M.findHeader("Όνομα", h), "FirstName");
  assert.equal(M.findHeader("ΕΠΩΝΥΜΟ", h), "LastName");
  assert.equal(M.findHeader("E-mail", h), "Email");
  assert.equal(M.findHeader("Name", h), "FullName");
  assert.equal(M.findHeader("Nope", h), null);
  assert.equal(M.findHeader("Πόλη", ["Πολη"]), "Πολη");
});

test("mergeHtml: values escaped, missing fields reported, tags untouched", () => {
  const html = '<p>Dear {{Name}},</p><p class="{{Name}}">{{Note}} &amp; {{Who}}</p>';
  const row = { Name: '<img src=x onerror="alert(1)">', Note: "a & b\nline 2" };
  const r = M.mergeHtml(html, row, ["Name", "Note"]);
  assert.equal(r.html, '<p>Dear &lt;img src=x onerror=&quot;alert(1)&quot;&gt;,</p>' +
    '<p class="{{Name}}">a &amp; b<br>line 2 &amp; </p>');
  assert.deepEqual(r.missing, ["Who"]);
  // non-breaking spaces survive
  assert.equal(M.mergeHtml("<p>{{a}}&nbsp;x</p>", { a: "1" }, ["a"]).html, "<p>1 x</p>");
  // a document without placeholders comes back unchanged
  assert.equal(M.mergeHtml("<p>x &lt; y</p>", {}, []).html, "<p>x &lt; y</p>");
});
