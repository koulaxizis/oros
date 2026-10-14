// orOS Mail — snooze (mail/snooze.js): times, keys, records, wake plan;
// and the slice merge of data.snoozes (mail.js mergeMail).
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const SN = require("../mail/snooze.js");

const local = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi || 0, 0, 0).getTime();

test("snooze times: later today, tomorrow, next Monday", () => {
  // Wednesday 14 Oct 2026, 10:20
  let t = SN.times(local(2026, 10, 14, 10, 20));
  assert.equal(t.later, local(2026, 10, 14, 18));
  assert.equal(t.tomorrow, local(2026, 10, 15, 8));
  assert.equal(t.monday, local(2026, 10, 19, 8));
  // 17:40 → three hours on, to the whole hour: 21:00
  t = SN.times(local(2026, 10, 14, 17, 40));
  assert.equal(t.later, local(2026, 10, 14, 21));
  // exactly 18:00 → 21:00 (no rounding needed)
  assert.equal(SN.times(local(2026, 10, 14, 18, 0)).later, local(2026, 10, 14, 21));
  // 21:30 → would be tomorrow: no "later today"
  assert.equal(SN.times(local(2026, 10, 14, 21, 30)).later, 0);
  // on a Monday, "next Monday" is a week on; on Sunday it is tomorrow
  assert.equal(SN.times(local(2026, 10, 19, 9)).monday, local(2026, 10, 26, 8));
  assert.equal(SN.times(local(2026, 10, 18, 9)).monday, local(2026, 10, 19, 8));
  // end of month / year
  assert.equal(SN.times(local(2026, 12, 31, 12)).tomorrow, local(2027, 1, 1, 8));
});

test("snooze: a picked time must be ahead and within a year", () => {
  const now = local(2026, 10, 14, 10);
  assert.equal(SN.pickOk(now + 30000, now), "past");
  assert.equal(SN.pickOk(NaN, now), "past");
  assert.equal(SN.pickOk(now + 3600000, now), "");
  assert.equal(SN.pickOk(now + 367 * 86400000, now), "far");
});

test("snooze key: Message-ID, else date + sender", () => {
  assert.equal(SN.keyOf({ mid: " <a.b@x.gr> ", date: 5, from: { addr: "A@x.gr" } }), "<a.b@x.gr>");
  assert.equal(SN.keyOf({ mid: "", date: 1700000000000, from: { addr: " A@X.gr " } }), "f:1700000000000:a@x.gr");
  assert.equal(SN.keyOf({ mid: "junk", date: 0, from: { addr: "" } }), "");
  assert.equal(SN.keyOf(null), "");
});

test("snooze records: norm keeps only valid fields", () => {
  const ok = SN.norm({ id: "abc123x", m: 5, acct: "acct001", key: "<k@x>", until: 99, from: "INBOX.Work", extra: 1 });
  assert.deepEqual(ok, { id: "abc123x", m: 5, acct: "acct001", key: "<k@x>", until: 99, from: "INBOX.Work" });
  assert.equal(SN.norm({ id: "abc123x", m: 5, acct: "acct001", key: "<k@x>", until: 99 }).from, "INBOX");
  assert.equal(SN.norm({ id: "bad id", m: 5, acct: "acct001", key: "<k@x>", until: 99 }), null);
  assert.equal(SN.norm({ id: "abc123x", m: 5, acct: "acct001", key: "a\nb", until: 99 }), null);
  assert.equal(SN.norm({ id: "abc123x", m: 5, acct: "acct001", key: "<k@x>", until: 0 }), null);
  assert.equal(SN.norm({ id: "abc123x", m: -1, acct: "acct001", key: "<k@x>", until: 9 }), null);
});

test("snooze: due, next, per account", () => {
  const r = (id, acct, until) => ({ id, m: 1, acct, key: "<" + id + "@x>", until, from: "INBOX" });
  const list = [r("aaaaaa1", "acct001", 100), r("aaaaaa2", "acct002", 50), r("aaaaaa3", "acct001", 300)];
  assert.deepEqual(SN.due(list, 100).map((x) => x.id), ["aaaaaa1", "aaaaaa2"]);
  assert.equal(SN.next(list, 100), 300);
  assert.equal(SN.next(list, 300), 0);
  assert.deepEqual(SN.forAcct(list, "acct001").map((x) => x.id), ["aaaaaa1", "aaaaaa3"]);
});

test("snooze wake plan: due records find their messages; missing ones give up only on a full listing", () => {
  const r = (id, key, until, from) => ({ id, m: 1, acct: "acct001", key, until, from: from || "INBOX" });
  const recs = [r("aaaaaa1", "<1@x>", 10), r("aaaaaa2", "<2@x>", 20, "Work"), r("aaaaaa3", "<3@x>", 999), r("aaaaaa4", "<4@x>", 15),
                { id: "bbbbbb1", m: 1, acct: "acct002", key: "<5@x>", until: 1, from: "INBOX" }];
  const msgs = [{ uid: 7, key: "<1@x>" }, { uid: 8, key: "<2@x>" }, { uid: 9, key: "<3@x>" }, { uid: 10, key: "<5@x>" }];
  let p = SN.plan(recs, "acct001", msgs, 100, true);
  assert.deepEqual(p.wake.map((w) => [w.uid, w.rec.id]), [[7, "aaaaaa1"], [8, "aaaaaa2"]]);
  assert.deepEqual(p.gone.map((x) => x.id), ["aaaaaa4"]);           // woken elsewhere / moved away
  p = SN.plan(recs, "acct001", msgs, 100, false);
  assert.deepEqual(p.gone, []);                                       // maybe in an older page
  // the same message twice in the folder: both wake; one UID is never claimed twice
  p = SN.plan([r("aaaaaa1", "<1@x>", 10), r("aaaaaa9", "<1@x>", 12)], "acct001", [{ uid: 3, key: "<1@x>" }, { uid: 4, key: "<1@x>" }], 100, true);
  assert.deepEqual(p.wake.map((w) => w.uid), [3, 4]);
  assert.deepEqual(p.gone.map((x) => x.id), ["aaaaaa9"]);
});

test("snooze folder: \\Snoozed, or a folder named Snoozed (any depth)", () => {
  assert.equal(SN.isFolder({ name: "Snoozed", delim: "/", flags: [] }), true);
  assert.equal(SN.isFolder({ name: "INBOX.snoozed", delim: ".", flags: [] }), true);
  assert.equal(SN.isFolder({ name: "Later", delim: "/", flags: ["\\Snoozed"] }), true);
  assert.equal(SN.isFolder({ name: "Snoozed stuff", delim: "/", flags: [] }), false);
  assert.equal(SN.isFolder(null), false);
});

// ---------- the slice merge (mail.js section 2) ----------
const src = fs.readFileSync(path.join(__dirname, "..", "mail/mail.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const A = new Function("M", "R", "SV", "SN",
  "var DATA_VER = 1, MAX_TOMBS = 200, MAX_IMGOK = 500, KEEP_HEADS = 500, MAX_SIG = 1000, MAX_SIG_HTML = 60000;\n" +
  block("  function cmpStr(", "  function el(") +
  block("  function lowerAddr(", "\n  // UID sets") +
  block("  // ---------- 2. Data model", "  // ---------- 3. Device store") +
  "\nreturn { mergeMail, emptyData };")(require("../mail/mime.js"), require("../mail/rules.js"), require("../mail/sieve.js"), SN);

const acct = (id) => ({ id, m: 1, name: "", email: id + "@x.gr", imap: { host: "mail.x.gr", port: 993 } });
const snz = (id, m, until, acctId) => ({ id, m, acct: acctId || "acct001", key: "<" + id + "@x>", until, from: "INBOX" });

test("snooze slice: LWW by m, tombstones, removed accounts, symmetric and canonical", () => {
  assert.deepEqual(A.emptyData().snoozes, []);
  const a = { accounts: [acct("acct001"), acct("acct002")], snoozes: [snz("sss0001", 5, 100), snz("sss0002", 1, 50, "acct002")] };
  const b = { accounts: [acct("acct001"), acct("acct002")], snoozes: [snz("sss0001", 7, 300), snz("sss0003", 1, 70)], tombs: { sss0002: 1 } };
  const ab = A.mergeMail(a, b), ba = A.mergeMail(b, a);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba));
  assert.equal(JSON.stringify(A.mergeMail(ab, ab)), JSON.stringify(ab));
  // newer m wins; the tombstone (≥ m) removes; sorted by wake time
  assert.deepEqual(ab.snoozes.map((x) => [x.id, x.until]), [["sss0003", 70], ["sss0001", 300]]);
  // a snooze changed after its tombstone comes back
  assert.equal(A.mergeMail({ accounts: [acct("acct001")], snoozes: [snz("sss0004", 9, 1)] }, { tombs: { sss0004: 8 } }).snoozes.length, 1);
  // its account removed → gone
  const gone = A.mergeMail({ accounts: [acct("acct001")], snoozes: [snz("sss0005", 1, 1, "acct009")] }, { tombs: { acct009: 5 } });
  assert.equal(gone.snoozes.length, 0);
  // old data without snoozes still loads
  assert.deepEqual(A.mergeMail({ accounts: [acct("acct001")] }, {}).snoozes, []);
  // bad rows dropped
  assert.equal(A.mergeMail({ accounts: [acct("acct001")], snoozes: [{ id: "x" }, null, snz("sss0006", 1, 0)] }, {}).snoozes.length, 0);
});
