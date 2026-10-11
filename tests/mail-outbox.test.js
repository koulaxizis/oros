// orOS Mail — timed sends (mail/outbox.js): due times, claims, take-back.
// The IndexedDB part runs on a tiny in-memory stand-in with the same
// transaction shape (get → put/delete → oncomplete).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const OB = require("../mail/outbox.js");

function fakeDb(recs) {
  const store = new Map(recs.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
  return {
    store,
    transaction() {
      const t = {};
      const s = {
        get(id) {
          const rq = {};
          setTimeout(() => {
            rq.result = store.has(id) ? JSON.parse(JSON.stringify(store.get(id))) : undefined;
            rq.onsuccess();
            setTimeout(() => t.oncomplete && t.oncomplete());
          });
          return rq;
        },
        put(v, id) { store.set(id, JSON.parse(JSON.stringify(v))); },
        delete(id) { store.delete(id); }
      };
      t.objectStore = () => s;
      return t;
    }
  };
}
const rec = (id, due, extra) => Object.assign({ id, at: 1, err: "", due, draft: {}, job: { acct: "a", raw: "" } }, extra || {});

test("outbox: isDue / nextDue skip plain records, errors and fresh claims", () => {
  const now = 1000000;
  const plain = { id: "p", err: "", job: undefined };
  const later = rec("l", now + 5000);
  const due = rec("d", now - 1);
  const failed = rec("f", now - 1, { err: "Not sent" });
  const busy = rec("b", now - 1, { claim: { by: "x", at: now - 1000 } });
  const stale = rec("s", now - 1, { claim: { by: "x", at: now - OB.CLAIM_MS - 1 } });
  assert.equal(OB.isDue(plain, now), false);
  assert.equal(OB.isDue(later, now), false);
  assert.equal(OB.isDue(due, now), true);
  assert.equal(OB.isDue(failed, now), false);
  assert.equal(OB.isDue(busy, now), false);
  assert.equal(OB.isDue(stale, now), true);         // a closed tab's claim expires
  assert.equal(OB.nextDue([plain, failed], now), 0);
  assert.equal(OB.nextDue([plain, later], now), now + 5000);
  assert.equal(OB.nextDue([later, due], now), now - 1);
  assert.equal(OB.nextDue([later, busy], now), now + 5000);
  assert.equal(OB.nextDue([busy], now), now - 1000 + OB.CLAIM_MS);   // a claim that may expire
});

test("outbox: a record is claimed once; take-back fails once claimed; release keeps the error", async () => {
  const now = Date.now();
  const d = fakeDb([rec("r1", now - 10), rec("r2", now + 60000)]);
  assert.equal((await OB.claim(d, "r1", "tab1", now)).claim.by, "tab1");
  assert.equal(d.store.get("r1").claim.by, "tab1");
  assert.equal(await OB.claim(d, "r1", "tab3", now), null);        // claimed: nobody else
  assert.equal(await OB.claim(d, "r2", "tab1", now), null);        // not due yet
  assert.equal(await OB.takeBack(d, "r1", now), null);             // being sent: no undo
  assert.equal((await OB.takeBack(d, "r2", now)).id, "r2");         // waiting: undo works
  assert.equal(d.store.has("r2"), false);
  await OB.release(d, "r1", "Not sent (auth)");
  assert.equal(d.store.get("r1").err, "Not sent (auth)");
  assert.equal(d.store.get("r1").claim, undefined);
  assert.equal(OB.isDue(d.store.get("r1"), now), false);            // waits for the person
  await OB.release(d, "r1", "");                                    // no new reason: the old one stays
  assert.equal(d.store.get("r1").err, "Not sent (auth)");
  assert.equal((await OB.finish(d, "r1")).id, "r1");
  assert.equal(d.store.has("r1"), false);
  assert.equal(await OB.finish(d, "r1"), null);
});
