// ============================================================
// orOS Mail — timed sends from the Outbox (v1.0.0)
// "Undo send" (a few seconds' wait) and "Send later" (a date and time)
// put the message, already built, in the Outbox (IndexedDB "oros-mail",
// store "outbox", device-local):
//   rec: { id, at, draft, err, due (ms), job: { acct, from, rcpt[],
//          raw (base64), sent?, subj, serverDraft? }, claim?: { by, at } }
// Mail sends it when it is due; with Mail closed the shell's checker
// (notify.js) does, while orOS is open. Whoever sends first CLAIMS it
// in one transaction, so it goes out once even with two tabs; a claim
// older than CLAIM_MS belongs to a closed tab and may be taken again.
// "Undo", "Edit" and "Delete" TAKE IT BACK in one transaction, which
// fails once someone has claimed it (it is being sent).
// Pure part (isDue, nextDue) is tested under Node; the rest needs
// IndexedDB. Exposes window.orosMailOutbox or module.exports.
// ============================================================
(function (root) {
  "use strict";
  var CLAIM_MS = 10 * 60 * 1000;
  var STORE = "outbox";

  function claimed(rec, now) { return !!(rec && rec.claim && now - rec.claim.at < CLAIM_MS); }
  function timed(rec) { return !!(rec && rec.job && rec.due > 0); }
  function isDue(rec, now) { return timed(rec) && !rec.err && rec.due <= now && !claimed(rec, now); }
  // the next moment something waiting becomes due (0: none)
  function nextDue(recs, now) {
    var n = 0;
    (recs || []).forEach(function (r) {
      if (!timed(r) || r.err) return;
      var at = claimed(r, now) ? r.claim.at + CLAIM_MS : r.due;
      if (!n || at < n) n = at;
    });
    return n;
  }

  // One readwrite transaction: fn(rec | null) → { put?, del?, out }
  function step(d, id, fn) {
    return new Promise(function (resolve, reject) {
      var out = null, t;
      try { t = d.transaction(STORE, "readwrite"); } catch (e) { reject(e); return; }
      var s = t.objectStore(STORE);
      var g = s.get(id);
      g.onsuccess = function () {
        var r = fn(g.result || null) || {};
        if (r.put) s.put(r.put, id);
        if (r.del) s.delete(id);
        out = r.out === undefined ? null : r.out;
      };
      t.oncomplete = function () { resolve(out); };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error); };
    });
  }
  function claim(d, id, by, now) {
    return step(d, id, function (rec) {
      if (!isDue(rec, now)) return { out: null };
      rec.claim = { by: by, at: now };
      return { put: rec, out: rec };
    });
  }
  function takeBack(d, id, now) {
    return step(d, id, function (rec) {
      if (!rec || claimed(rec, now)) return { out: null };
      return { del: true, out: rec };
    });
  }
  // sent: gone
  function finish(d, id) { return step(d, id, function (rec) { return { del: !!rec, out: rec }; }); }
  // not sent: free it again; err (text) keeps it until the person acts
  function release(d, id, err) {
    return step(d, id, function (rec) {
      if (!rec) return { out: null };
      delete rec.claim;
      if (err) rec.err = String(err).slice(0, 300);
      return { put: rec, out: rec };
    });
  }

  var api = { v: 1, CLAIM_MS: CLAIM_MS, claimed: claimed, timed: timed, isDue: isDue, nextDue: nextDue,
              claim: claim, takeBack: takeBack, finish: finish, release: release };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.orosMailOutbox = api;
})(typeof window !== "undefined" ? window : globalThis);
