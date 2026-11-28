// Mail bar card + peek (MAILCARD-1, video ideas 2026-11-23 #19): the
// unread count of the Inboxes in the smart top bar; a peek with the
// unread messages first and Starred one tap away; a row opens the
// message in Mail. Read only from Mail's own cache; nothing under
// Sensitive work or while Mail is locked.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const M = require(path.join(ROOT, "smartbar.js"));
const A = require(path.join(ROOT, "smartbar-apps.js"));

const DATA = { accounts: [{ id: "acct0001", email: "me@example.com", m: 5 }, { id: "acct0002", email: "old@example.com", m: 3 },
  { id: "BAD!", email: "x" }], tombs: { acct0002: 4 } };

test("a known kind with a peek, from smartbar-apps.js", () => {
  assert.ok(M.KINDS.includes("mail") && A.KINDS.includes("mail") && A.OWN.mail);
  assert.match(read("smartbar.js"), /var APP_PEEK = \{ screen: 1, mail: 1 \};/);
});

test("living accounts only (tombstones, bad ids), Inbox unread summed", () => {
  const accts = A.mailAccounts(DATA);
  assert.deepEqual(accts.map((a) => a.id), ["acct0001"]);
  assert.equal(A.mailUnread(accts, { acct0001: { list: [{ name: "INBOX", unseen: 3 }, { name: "Spam", unseen: 40 }] } }), 3);
  assert.equal(A.mailUnread(accts, { acct0002: { list: [{ name: "INBOX", unseen: 9 }] } }), 0, "a removed account counts nothing");
  assert.equal(A.mailUnread(accts, null), 0);
  assert.deepEqual(A.mailAccounts(null), []);
});

test("peek rows: unread newest first; Starred the flagged ones; never deleted", () => {
  const accts = A.mailAccounts(DATA);
  const heads = { acct0001: { msgs: [
    { uid: 1, subj: "Old unread", from: { name: "Ann" }, date: 100, flags: [] },
    { uid: 2, subj: "Read", from: { addr: "b@x.org" }, date: 300, flags: ["\\Seen"] },
    { uid: 3, subj: "New unread", from: { name: "Cy" }, date: 200, flags: [] },
    { uid: 4, subj: "Starred read", from: { name: "Di" }, date: 50, flags: ["\\Seen", "\\Flagged"] },
    { uid: 5, subj: "Gone", date: 400, flags: ["\\Deleted"] },
    { uid: 0, subj: "bad" }, null
  ] } };
  assert.deepEqual(A.mailRows(accts, heads, "unread", 8).map((r) => r.uid), [3, 1]);
  assert.deepEqual(A.mailRows(accts, heads, "starred", 8).map((r) => r.uid), [4]);
  assert.equal(A.mailRows(accts, heads, "unread", 1).length, 1);
  assert.equal(A.mailRows(accts, { acct0001: { msgs: [{ uid: 9, subj: "x".repeat(500), from: {}, date: 1, flags: [] }] } }, "unread")[0].subj.length, 200);
  assert.deepEqual(A.mailRows(accts, null, "unread"), []);
});

test("privacy: a count only in the bar, hidden under Sensitive work and Mail's lock, Mail's cache read only", () => {
  const SA = read("smartbar-apps.js");
  const off = SA.slice(SA.indexOf("function mailOff()"), SA.indexOf("function mailData()"));
  assert.match(off, /if \(strict\(\)\) return true;/);
  assert.match(off, /L\.apps\.state\("mail"\)/);
  const card = SA.slice(SA.indexOf("      mail: function () {\n        if (mailOff()) return null;"), SA.indexOf("      // RATES-1: hidden"));
  assert.doesNotMatch(card, /subj|from|who/, "never a sender or a subject in the bar");
  const db = SA.slice(SA.indexOf("function mailDb("), SA.indexOf("function mailRefresh("));
  assert.match(db, /idb\.open\("oros-mail"\)/, "no version: nothing is created");
  assert.match(db, /rq\.transaction\.abort\(\)/);
  assert.match(db, /"readonly"/);
  assert.doesNotMatch(SA.slice(SA.indexOf("(function (root)")), /"keys"|"creds"|readwrite|\.put\(|\.delete\(/);
  assert.match(SA, /__orosOpenAt\("mail", \{ acct: r\.acct, folder: "INBOX", uid: r\.uid \}\)/);
  assert.match(SA, /kit\.el\("span", "pk-w", r\.subj \|\| t\("sb\.mail\.nosubj"\)\)/, "text only");
  assert.match(read("smartbar.js"), /if \(peekEl && APP_PEEK\[peekKind\] && chips\[peekKind\] && chips\[peekKind\]\.key === ""\) closePeek\(\);/);
});

test("strings in EN, EL and DE; help", () => {
  const tr = read("translations.js"), de = read("i18n/de/shell.js");
  for (const k of ["sb.k.mail", "sb.mail.one", "sb.mail.label", "sb.mail.tip", "sb.mail.unread", "sb.mail.starred", "sb.mail.loading",
    "sb.mail.none", "sb.mail.nostar", "sb.mail.nosubj"]) {
    assert.equal(tr.split('"' + k + '":').length - 1, 2, "EN + EL " + k);
    assert.ok(de.includes('"' + k + '":'), "DE " + k);
  }
  assert.match(read("help/topics/appearance.en.txt"), /- `Mail`: how many emails are unread/);
  assert.match(read("help/topics/appearance.el.txt"), /- `Αλληλογραφία`:/);
});
