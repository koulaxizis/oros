// Newsletter W3 (2026-11): the welcome mail (who gets it, once), the
// report after an issue, and the one-click unsubscribe check
// (newsletter/core.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../newsletter/core.js");

const DAY = 864e5, NOW = Date.UTC(2026, 10, 3, 12);
const LIST = { id: "list-1", m: 1, name: "News", chan: "chan-1", from: "me@example.com", lang: "el", addr: "Street 1",
  salt: "abcdefgh12", welTpl: "tpl-1", welAt: NOW - 10 * DAY };
const TPL = { id: "tpl-1", m: 1, name: "Welcome", subj: "Καλώς ήρθες {first|φίλε}", fmt: "md", md: "Γεια!" };
function sub(email, extra) {
  return Object.assign({ id: C.subId("list-1", email), m: 5, list: "list-1", email, name: "", tags: [], src: "form",
    basis: "optin", at: NOW - 2 * DAY, conf: NOW - DAY, off: 0 }, extra || {});
}
function data(subs, extra) {
  return C.normalize(Object.assign({ ver: 1, chans: [], lists: [LIST], subs, issues: [], tpls: [TPL], supp: [] }, extra || {}));
}

test("welcomesDue: only own sign-ups, active after it was turned on, not yet welcomed", () => {
  const d = data([
    sub("form@x.gr"),
    sub("mail@x.gr", { src: "mail", at: NOW - 4 * DAY, conf: NOW - 3 * DAY }),
    sub("csv@x.gr", { src: "csv" }),
    sub("pend@x.gr", { conf: 0 }),
    sub("old@x.gr", { at: NOW - 40 * DAY, conf: NOW - 20 * DAY }),
    sub("done@x.gr", { wel: NOW - 1000 }),
    sub("left@x.gr", { off: NOW - 100, offSt: "off" }),
    sub("late@x.gr", { at: NOW - 3 * DAY, conf: NOW - 2 * DAY + 5 })
  ]);
  assert.deepEqual(C.welcomesDue(d, "list-1", NOW).map((s) => s.email), ["mail@x.gr", "late@x.gr", "form@x.gr"]);
  // turned off, or its template deleted: nobody
  const off = data([sub("form@x.gr")], { lists: [Object.assign({}, LIST, { welTpl: undefined })] });
  assert.deepEqual(C.welcomesDue(off, "list-1", NOW), []);
  const gone = data([sub("form@x.gr")], { tpls: [{ id: "tpl-1", m: 2, del: 1 }] });
  assert.deepEqual(C.welcomesDue(gone, "list-1", NOW), []);
  // more than 30 days after they confirmed: too late
  const stale = data([sub("form@x.gr", { conf: NOW - 31 * DAY, at: NOW - 32 * DAY })], { lists: [Object.assign({}, LIST, { welAt: 1 })] });
  assert.deepEqual(C.welcomesDue(stale, "list-1", NOW), []);
});

test("welcomeIssue is the template as an issue of the list; wel survives normalize and merges as max", () => {
  const d = data([sub("a@x.gr")]);
  const x = C.welcomeIssue(d, d.lists[0]);
  assert.equal(x.list, "list-1");
  assert.equal(x.subj, TPL.subj);
  assert.equal(x.fmt, "md");
  const a = data([sub("a@x.gr", { wel: 50, m: 9 })]), b = data([sub("a@x.gr", { wel: 0, m: 10 })]);
  assert.equal(C.mergeNewsletter(a, b).subs[0].wel, 50);
  assert.equal("wel" in C.normSub(sub("b@x.gr")), false);
  // the list keeps welTpl/welAt; without welTpl both go
  assert.equal(d.lists[0].welTpl, "tpl-1");
  assert.equal(d.lists[0].welAt, LIST.welAt);
  const l2 = C.normList(Object.assign({}, LIST, { welTpl: "" }));
  assert.equal("welTpl" in l2 || "welAt" in l2, false);
});

test("issueReport: left by kind, from the start until 14 days after", () => {
  const x = { id: "iss-1", list: "list-1", start: NOW - 20 * DAY, done: NOW - 19 * DAY };
  const old = (email, extra) => sub(email, Object.assign({ at: NOW - 60 * DAY, conf: NOW - 60 * DAY }, extra));
  const d = data([
    old("u1@x.gr", { off: NOW - 19 * DAY, offSt: "off" }),
    old("u2@x.gr", { off: NOW - 6 * DAY, offSt: "off" }),           // within 14 days of done
    old("u3@x.gr", { off: NOW - 2 * DAY, offSt: "off" }),           // later: not counted
    old("b1@x.gr", { off: NOW - 19 * DAY, offSt: "bounce" }),
    old("s1@x.gr", { off: NOW - 18 * DAY, offSt: "spam" }),
    old("before@x.gr", { off: NOW - 30 * DAY, offSt: "off" }),
    old("back@x.gr", { off: NOW - 19 * DAY, offSt: "off", at: NOW - 10 * DAY, conf: NOW - 10 * DAY })   // signed up again
  ]);
  assert.deepEqual(C.issueReport(d, x, NOW), { unsub: 2, bounce: 1, spam: 1, days: 14 });
  assert.deepEqual(C.issueReport(d, { list: "list-1" }, NOW), { unsub: 0, bounce: 0, spam: 0, days: 14 });
});

test("check: no one-click unsubscribe is a warning only where the app can turn it on", () => {
  const d = data([sub("a@x.gr")]);
  const x = C.normIssue({ id: "iss-1", m: 1, list: "list-1", subj: "Hi", fmt: "md", md: "Hello", st: "draft" });
  const info = { chan: { id: "chan-1", kind: "smtp" }, aud: 1, inbox: true };
  assert.deepEqual(C.preflight(d, x, info), []);
  assert.deepEqual(C.preflight(d, x, Object.assign({ relay: true }, info)).map((r) => r.k), ["noOneClick"]);
});

test("engine: the list's sending device welcomes a new sign-up once, never an import", async () => {
  const { sandbox } = require("./newsletter-sandbox.js");
  const T = Date.now();
  const CHAN = { id: "chan-1", m: 1, name: "My mail", kind: "mail", acct: "acct01", rate: 1, cap: 300 };
  const L = Object.assign({}, LIST, { clnDev: "devaaa1", welAt: T - 5 * DAY });
  const s = (email, extra) => Object.assign({ id: C.subId("list-1", email), m: T - DAY, list: "list-1", email, name: "Ann Lee", tags: [],
    src: "form", basis: "optin", at: T - 2 * DAY, conf: T - DAY, off: 0 }, extra || {});
  const model = (lists) => C.normalize({ ver: 1, chans: [CHAN], lists, issues: [], tpls: [TPL], supp: [],
    subs: [s("new@x.gr"), s("csv@x.gr", { src: "csv", basis: "consent" })] });
  const S = await sandbox(model([L]));
  await S.run(10);
  assert.deepEqual(S.sent.map((m) => m.to), ["new@x.gr"]);
  assert.match(S.sent[0].raw, /Subject: =\?UTF-8\?/);
  const out = C.normalize(S.read());
  assert.ok(C.sub(out, C.subId("list-1", "new@x.gr")).wel > T - 60000);
  await S.run(6);
  assert.equal(S.sent.length, 1, "not welcomed twice");
  S.engine.stop();
  // another device sends this list: nothing from here
  const S2 = await sandbox(model([Object.assign({}, L, { clnDev: "devzzz9" })]));
  await S2.run(8);
  assert.equal(S2.sent.length, 0);
  S2.engine.stop();
});
