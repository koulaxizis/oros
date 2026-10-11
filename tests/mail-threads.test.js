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
