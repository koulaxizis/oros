// orOS Mail — conversations (mail/threads.js). Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../mail/threads.js");

const m = (uid, subj, mid, irt) => ({ uid, subj, mid: mid || "", irt: irt || "" });
const keys = (gs) => gs.map((g) => g.msgs.map((x) => x.uid).join("+"));

test("threads: subject without prefixes", () => {
  assert.equal(T.base("Re: RE: Fwd: Hello  world"), "hello world");
  assert.equal(T.base("Απ: ΣΧΕΤ: Τιμολόγιο"), "τιμολόγιο");
  assert.equal(T.base("Re[2]: x"), "x");
  assert.equal(T.base("Report: done"), "report: done");
  assert.ok(T.isReply("AW: Termin") && !T.isReply("Rent"));
});

test("threads: replies join by In-Reply-To or by subject, newest first", () => {
  const list = [
    m(9, "Re: Lunch", "<9@x>", "<5@x>"),
    m(8, "Invoice", "<8@x>"),
    m(7, "Απ: Εκδρομή", "<7@x>"),            // no headers: joins by subject
    m(6, "Other topic", "<6@x>", "<5@x>"),    // reply with a changed subject: headers win
    m(5, "Lunch", "<5@x>"),
    m(4, "Invoice", "<4@x>"),                 // two newsletters stay apart
    m(3, "Εκδρομή", "<3@x>"),
    m(2, "Re: Unknown start", "<2@x>")        // its start is not here: alone
  ];
  const g = T.group(list);
  assert.deepEqual(keys(g), ["9+6+5", "8", "7+3", "4", "2"]);
  assert.equal(g[0].key, "t5");               // the oldest message names the conversation
  assert.deepEqual(T.group([]), []);
});

test("threads: a reply joins only the nearest older start with that subject", () => {
  const g = T.group([m(4, "Re: Weekly"), m(3, "Weekly"), m(2, "Weekly"), m(1, "Weekly")]);
  assert.deepEqual(keys(g), ["4+3", "2", "1"]);
});

// ---------- All inboxes (unify) ----------
test("all inboxes: rows of every account merged newest first, keyed by account", () => {
  const d = (uid, date, subj, mid, irt) => ({ uid, date, subj: subj || "s" + uid, mid: mid || "<" + uid + "@x>", irt: irt || "" });
  const A1 = [d(30, 5000), d(20, 3000, "Re: Lunch", "<20@x>", "<10@x>"), d(10, 1000, "Lunch", "<10@x>")];
  const B1 = [d(9, 4000), d(8, 3000), d(7, 500)];
  const out = T.unify([{ acct: "aaa", msgs: A1, threads: true }, { acct: "bbb", msgs: B1, threads: false }], 0);
  assert.deepEqual(out.map((g) => g.key), ["aaa:t30", "bbb:t9", "aaa:t10", "bbb:t8", "bbb:t7"]);
  assert.deepEqual(out[2].msgs.map((x) => x.uid), [20, 10]);       // the conversation travels together
  assert.equal(out[1].acct, "bbb");
  // same date: account order, then the account's own order
  const tie = T.unify([{ acct: "x", msgs: [d(2, 100), d(1, 100)] }, { acct: "y", msgs: [d(5, 100)] }], 0);
  assert.deepEqual(tie.map((g) => g.key), ["x:t2", "x:t1", "y:t5"]);
  // a message without a date stays next to its neighbour; max cuts
  const nd = T.unify([{ acct: "x", msgs: [d(3, 900), d(2, 0), d(1, 100)] }, { acct: "y", msgs: [d(9, 500)] }], 3);
  assert.deepEqual(nd.map((g) => g.key), ["x:t3", "x:t2", "y:t9"]);
  assert.deepEqual(T.unify([], 10), []);
  assert.deepEqual(T.unify([{ acct: "x", msgs: null }], 10), []);
});
