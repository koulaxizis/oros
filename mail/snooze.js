// ============================================================
// orOS Mail — snooze (v1.0.0)
// Pure functions shared by mail.js (snooze, the Snoozed folder,
// waking while Mail is open) and notify.js (waking while orOS is open
// with Mail closed).
//
// How it works with plain IMAP: a snoozed message is MOVED to the
// account's "Snoozed" folder (created when missing), so it leaves the
// Inbox on every device and in webmail too. When it is due back it is
// marked unread and moved back where it came from (a new UID: it shows
// at the top). The wake time travels in the synced "mail" slice:
//   data.snoozes: [{ id, m, acct, key, until, from }]
//     key   = the message's Message-ID ("<…>"), else a fingerprint
//             "f:<date ms>:<sender address>" (same on every device)
//     until = when it comes back (ms); from = the folder it left
// LWW by m, the slice's shared tombstones (a woken or cancelled
// snooze is tombstoned). No subject, sender name or text is synced.
//
// times(now) → { later, tomorrow, monday }   ms, later = 0 when
//   "later today" would no longer be today
// pickOk(ms, now) → "" | "past" | "far"
// keyOf(sum) → key | ""          sum: mail.js summarize() row
// norm(rec) → rec | null
// due(recs, now) / next(recs, now) / forAcct(recs, acctId)
// plan(recs, acctId, msgs, now, complete) → { wake: [{ uid, rec }],
//   gone: [rec] }   msgs: the Snoozed folder's rows ({ uid, key });
//   complete = the whole folder was listed (else a due record whose
//   message is not seen yet is kept, not given up)
// isFolder(f) → bool             an IMAP folder { name, delim, flags }
// ============================================================
(function (root) {
  "use strict";
  var MAX = 200;                       // snoozed messages kept in the slice
  var FAR = 366 * 86400000;
  var FOLDER = "Snoozed";

  function isInt(n) { return typeof n === "number" && isFinite(n) && Math.floor(n) === n; }

  function at(now, days, h) {
    var d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(h, 0, 0, 0);
    return d.getTime();
  }
  // Later today: 18:00 before 17:00, else three hours on, to the next
  // whole hour, while that is still today. Tomorrow and next Monday
  // (a week on when today is Monday): 08:00.
  function times(now) {
    var d = new Date(now);
    var later;
    if (d.getHours() < 17) later = at(now, 0, 18);
    else {
      var l = new Date(now + 3 * 3600000);
      if (l.getMinutes() || l.getSeconds() || l.getMilliseconds()) l.setHours(l.getHours() + 1, 0, 0, 0);
      later = l.toDateString() === d.toDateString() ? l.getTime() : 0;
    }
    return { later: later, tomorrow: at(now, 1, 8), monday: at(now, ((8 - d.getDay()) % 7) || 7, 8) };
  }
  function pickOk(ms, now) {
    if (!isInt(ms) || ms < now + 60000) return "past";
    if (ms > now + FAR) return "far";
    return "";
  }

  function keyOf(sum) {
    if (!sum) return "";
    var mid = (/<[^<>\s]{3,250}>/.exec(String(sum.mid || "")) || [""])[0];
    if (mid) return mid;
    var addr = String((sum.from && sum.from.addr) || "").trim().toLowerCase().slice(0, 254);
    if (!sum.date && !addr) return "";
    return "f:" + (isInt(sum.date) ? sum.date : 0) + ":" + addr;
  }

  function folderOk(f) {
    return typeof f === "string" && f.length > 0 && f.length <= 1000 && !/[\r\n\0]/.test(f);
  }
  function norm(r) {
    if (!r || typeof r !== "object") return null;
    if (typeof r.id !== "string" || !/^[a-z0-9]{6,40}$/.test(r.id)) return null;
    if (typeof r.acct !== "string" || !/^[a-z0-9]{6,40}$/.test(r.acct)) return null;
    if (!isInt(r.m) || r.m < 0 || !isInt(r.until) || r.until <= 0) return null;
    if (typeof r.key !== "string" || !r.key || r.key.length > 300 || /[\r\n\0]/.test(r.key)) return null;
    return { id: r.id, m: r.m, acct: r.acct, key: r.key, until: r.until, from: folderOk(r.from) ? r.from : "INBOX" };
  }

  function due(recs, now) {
    return (recs || []).filter(function (r) { return r && r.until <= now; });
  }
  function next(recs, now) {
    var n = 0;
    (recs || []).forEach(function (r) { if (r && r.until > now && (!n || r.until < n)) n = r.until; });
    return n;
  }
  function forAcct(recs, acctId) {
    return (recs || []).filter(function (r) { return r && r.acct === acctId; });
  }

  function plan(recs, acctId, msgs, now, complete) {
    var byKey = {};
    (msgs || []).forEach(function (m) {
      if (m && m.key && m.uid > 0) (byKey[m.key] = byKey[m.key] || []).push(m.uid);
    });
    var wake = [], gone = [], taken = {};
    due(forAcct(recs, acctId), now).sort(function (a, b) { return a.until - b.until || (a.id < b.id ? -1 : 1); })
      .forEach(function (r) {
        var uids = (byKey[r.key] || []).filter(function (u) { return !taken[u]; });
        if (uids.length) {
          uids.forEach(function (u) { taken[u] = 1; wake.push({ uid: u, rec: r }); });
        } else if (complete) gone.push(r);
      });
    return { wake: wake, gone: gone };
  }

  function isFolder(f) {
    if (!f || typeof f.name !== "string") return false;
    if ((f.flags || []).some(function (x) { return /^\\snoozed$/i.test(x); })) return true;
    var name = f.name;
    if (f.delim && name.indexOf(f.delim) >= 0) name = name.slice(name.lastIndexOf(f.delim) + 1);
    return /^snoozed$/i.test(name);
  }

  var api = { MAX: MAX, FOLDER: FOLDER, times: times, pickOk: pickOk, keyOf: keyOf, norm: norm,
              due: due, next: next, forAcct: forAcct, plan: plan, isFolder: isFolder };
  root.orosMailSnooze = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
