// Manuscript submissions and answer / contract texts in Publishing
// (wave P7): the subs list, the late flag, templates in settings, and
// Mail's "Send to an app" item that hands a message over.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const P = require(path.join(__dirname, "..", "publish/core.js"));

test("cleanSub: needs a name or an address; bad address, status and dates dropped", () => {
  assert.equal(P.cleanSub({ id: "s1", m: 1 }), null);
  const s = P.cleanSub({ id: "s1", m: 1, n: "  Anna\nWriter ", email: "not an address", t: "Sea", d: "2026-02-30", st: "maybe", ans: "x", ti: "bad id!" });
  assert.deepEqual(s, { id: "s1", m: 1, n: "Anna Writer", email: "", t: "Sea", d: "", st: "new", note: "", ans: "" });
  assert.equal(P.cleanSub({ id: "s2", m: 1, email: "anna@example.org", ti: "t1" }).ti, "t1");
});

test("subs merge like the other lists (LWW, tombstones)", () => {
  const a = P.put(P.empty(), "subs", { id: "s1", n: "Anna", st: "new", d: "2026-01-10" }, 10);
  const b = P.put(a, "subs", { id: "s1", n: "Anna", st: "read", d: "2026-01-10" }, 20);
  assert.equal(P.merge(a, b).subs[0].st, "read");
  assert.deepEqual(P.merge(a, b), P.merge(b, a));
  assert.equal(P.remove(b, "subs", "s1", 30).subs.length, 0);
});

test("subsLate: new or being read, unanswered, older than the days given", () => {
  let d = P.empty();
  d = P.put(d, "subs", { id: "s1", n: "A", st: "new", d: "2026-06-01" }, 1);
  d = P.put(d, "subs", { id: "s2", n: "B", st: "read", d: "2026-07-01", ans: "2026-07-02" }, 1);   // thanked
  d = P.put(d, "subs", { id: "s3", n: "C", st: "no", d: "2026-01-01" }, 1);                       // closed
  d = P.put(d, "subs", { id: "s4", n: "D", st: "read", d: "2026-09-20" }, 1);                     // recent
  d = P.put(d, "subs", { id: "s5", n: "E", st: "new", d: "2026-05-01" }, 1);
  assert.deepEqual(P.subsLate(d, "2026-10-25", 90).map((x) => x.id), ["s5", "s1"]);
  assert.deepEqual(P.subsLate(d, "2026-10-25", 40).map((x) => x.id), ["s5", "s1"]);
  assert.deepEqual(P.subsLate(d, "2026-10-25", 30).map((x) => x.id), ["s5", "s1", "s4"]);
});

test("templates and days live in settings; empty = built-in; fillTpl keeps unknown names", () => {
  let d = P.setSet(P.empty(), { tpl: { ack: "Hi {name}", no: "   ", con: "x".repeat(30000), zz: "?" }, subDays: 60 }, 5);
  assert.deepEqual(Object.keys(d.set.tpl), ["ack", "con"]);
  assert.equal(d.set.tpl.con.length, 20000);
  assert.equal(d.set.subDays, 60);
  d = P.setSet(d, { tpl: {}, subDays: 0 }, 6);
  assert.ok(!("tpl" in d.set));
  assert.ok(!("subDays" in d.set));
  assert.equal(P.fillTpl("Dear {name}, “{title}” {nope} {imprint}", { name: "Anna", title: "Sea", imprint: "" }), "Dear Anna, “Sea” {nope} ");
});

test("Mail offers the submission only when Publishing is there, and Publishing takes { submit }", () => {
  const mail = fs.readFileSync(path.join(__dirname, "..", "mail/mail.js"), "utf8");
  assert.match(mail, /if \(appThere\("publish"\)\)/);
  assert.match(mail, /go\("publish", \{ submit: \{/);
  const app = fs.readFileSync(path.join(__dirname, "..", "publish/app.js"), "utf8");
  assert.match(app, /target\.submit && typeof target\.submit === "object"/);
});
