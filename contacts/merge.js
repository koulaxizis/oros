// ============================================================
// orOS Contacts — per-field merge and the interaction log
// (contacts/merge.js, window.OrosContactsMerge)
// ============================================================
// Pure helpers, no DOM, no storage (also loaded by the node tests).
//
// A contact used to merge as ONE object (newer mtime wins): a phone
// number added on the laptop and a note changed on the phone at the
// same time lost one of the two. Now each field carries its own
// stamp (CT-PF, the To-Do TD-3 / Mood MO-3 pattern):
//   c.fm = { given, middle, …, photo, keep, seen, log }  (stamps)
//   c.mtime = the newest of them; it still decides life against a
//   tombstone, exactly as before.
// Old copies (no fm) merge whole-object as before. A contact whose
// mtime is NEWER than every stamp was last written by code that
// knows only mtime (an older orOS, or the phone bridge, phone.js):
// for the fields that code knows, mtime speaks for each of them.
// `keep` and `seen` are new: older code never changes them, so they
// always use their own stamp; a copy without the key at all (older
// code drops unknown keys) never wins them (stamp -1).
//
// Interaction log (c.log) merges per item: { id, k, d, tx, m },
// newer m wins (equal m: larger JSON), deletions are tombstones in
// c.logDel = { id: m } (an item edited after its delete comes back).
// ============================================================
(function (root) {
  "use strict";

  var OLD_FIELDS = ["given", "middle", "family", "nickname", "org", "jobTitle",
    "phones", "emails", "addresses", "websites", "im", "events", "relations",
    "labelIds", "starred", "note", "photo"];
  var NEW_FIELDS = ["keep", "seen"];
  var FIELDS = OLD_FIELDS.concat(NEW_FIELDS);
  var STAMPS = FIELDS.concat(["log"]);
  var KINDS = ["call", "meet", "msg", "gift", "note"];
  var LOG_MAX = 500;            // items per contact
  var TEXT_MAX = 1000;          // characters per item

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function J(v) { return JSON.stringify(v === undefined ? null : v); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  function validYmd(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
    return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  // ---- sanitizers for the new keys ----
  function sanKeep(k) {
    if (!k || typeof k !== "object") return null;
    var n = Math.round(+k.n);
    if (!isFinite(n) || n < 1 || n > 99) return null;
    if (k.u !== "w" && k.u !== "m") return null;
    return { n: n, u: k.u };
  }
  function sanSeen(s) { return validYmd(s) ? s : ""; }
  function sanLogItem(it) {
    if (!it || typeof it !== "object") return null;
    if (typeof it.id !== "string" || !it.id || it.id.length > 40) return null;
    if (!validYmd(it.d) || !isNum(it.m)) return null;
    return {
      id: it.id,
      k: KINDS.indexOf(it.k) !== -1 ? it.k : "note",
      d: it.d,
      tx: (typeof it.tx === "string" ? it.tx : "").slice(0, TEXT_MAX),
      m: it.m
    };
  }
  function byId(a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); }
  function sanLog(arr) {
    var seen = {}, out = [];
    (Array.isArray(arr) ? arr : []).forEach(function (x) {
      var s = sanLogItem(x);
      if (!s) return;
      if (seen[s.id] && !(s.m > seen[s.id].m)) return;
      if (seen[s.id]) out.splice(out.indexOf(seen[s.id]), 1);
      seen[s.id] = s;
      out.push(s);
    });
    out.sort(byId);
    if (out.length > LOG_MAX) {
      // keep the newest by date (then stamp); the rest are dropped
      var keep = out.slice().sort(function (a, b) {
        return a.d !== b.d ? (a.d < b.d ? 1 : -1) : (b.m - a.m);
      }).slice(0, LOG_MAX);
      var ok = {};
      keep.forEach(function (x) { ok[x.id] = 1; });
      out = out.filter(function (x) { return ok[x.id]; });
    }
    return out;
  }
  function sanLogDel(o) {
    var out = {};
    if (!o || typeof o !== "object") return out;
    Object.keys(o).sort().forEach(function (k) {
      if (k && k.length <= 40 && isNum(o[k])) out[k] = o[k];
    });
    return out;
  }
  function sanFm(o) {
    if (!o || typeof o !== "object") return null;
    var out = {}, any = false;
    STAMPS.forEach(function (f) {
      if (isNum(o[f]) && o[f] >= 0) { out[f] = o[f]; any = true; }
    });
    return any ? out : null;
  }

  // Adds the new keys of a contact onto `out` (sanitized `c`), the
  // way sanitizeContact keeps old data byte-identical: a key that is
  // absent stays absent, empty log / tombstones are left out.
  function sanExtras(c, out) {
    if (!c || typeof c !== "object") return out;
    if (has(c, "keep")) out.keep = sanKeep(c.keep);
    if (has(c, "seen")) out.seen = sanSeen(c.seen);
    var log = sanLog(c.log);
    if (log.length) out.log = log;
    var del = sanLogDel(c.logDel);
    if (Object.keys(del).length) out.logDel = del;
    var fm = sanFm(c.fm);
    if (fm) out.fm = fm;
    return out;
  }

  // ---- stamps ----
  function maxStamp(c) {
    var mx = 0;
    if (c && c.fm && typeof c.fm === "object") {
      STAMPS.forEach(function (f) { if (isNum(c.fm[f]) && c.fm[f] > mx) mx = c.fm[f]; });
    }
    return mx;
  }
  function touchedByOldCode(c) {
    if (!c || !c.fm || typeof c.fm !== "object") return false;
    return (c.mtime || 0) > maxStamp(c);
  }
  function fieldStamp(c, f) {
    if (NEW_FIELDS.indexOf(f) !== -1 || f === "log") {
      if (f !== "log" && !has(c, f)) return -1;
      return (c.fm && isNum(c.fm[f])) ? c.fm[f] : 0;
    }
    if (!c.fm || typeof c.fm !== "object" || touchedByOldCode(c)) return c.mtime || 0;
    return isNum(c.fm[f]) ? c.fm[f] : 0;
  }

  // ---- interaction log ----
  function mergeLog(logA, delA, logB, delB) {
    var tomb = {};
    [delA, delB].forEach(function (d) {
      if (!d || typeof d !== "object") return;
      Object.keys(d).forEach(function (k) {
        if (isNum(d[k]) && (!has(tomb, k) || d[k] > tomb[k])) tomb[k] = d[k];
      });
    });
    var map = {};
    (Array.isArray(logA) ? logA : []).concat(Array.isArray(logB) ? logB : []).forEach(function (it) {
      if (!it || typeof it.id !== "string") return;
      var cur = map[it.id];
      if (!cur) { map[it.id] = it; return; }
      if (it.m > cur.m || (it.m === cur.m && J(it) > J(cur))) map[it.id] = it;
    });
    var log = Object.keys(map).sort().map(function (k) { return map[k]; })
      .filter(function (it) { return !has(tomb, it.id) || it.m > tomb[it.id]; })
      .map(clone);
    var del = {};
    Object.keys(tomb).sort().forEach(function (k) { del[k] = tomb[k]; });
    return { log: log, logDel: del };
  }

  // Two versions of ONE contact → one contact, field by field.
  // Symmetric and deterministic (no clock inside): merge(a, b) and
  // merge(b, a) give the same bytes, merge(a, a) is a.
  function mergeContact(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (J(a) === J(b)) return a;
    var newer = (a.mtime > b.mtime) ? a : (b.mtime > a.mtime ? b : (J(a) >= J(b) ? a : b));
    // Key order = sanitizeContact's (id, fields, mtime, keep, seen,
    // log, logDel, fm), so a merged copy and the stored copy of the
    // same content are the same bytes.
    var out = { id: newer.id };
    var withFm = !!((a.fm && typeof a.fm === "object") || (b.fm && typeof b.fm === "object"));
    var fm = {};
    FIELDS.forEach(function (f) {
      if (f === NEW_FIELDS[0]) out.mtime = Math.max(a.mtime || 0, b.mtime || 0);
      var sa = fieldStamp(a, f), sb = fieldStamp(b, f), w;
      if (sa !== sb) w = sa > sb ? a : b;
      else w = J(a[f]) >= J(b[f]) ? a : b;            // tie → same pick on both devices
      if (has(w, f) && w[f] !== undefined) out[f] = clone(w[f]);
      var s = Math.max(sa, sb);
      if (withFm && s >= 0 && (has(out, f) || NEW_FIELDS.indexOf(f) === -1)) fm[f] = s;
    });
    var lg = mergeLog(a.log, a.logDel, b.log, b.logDel);
    if (lg.log.length) out.log = lg.log;
    if (Object.keys(lg.logDel).length) out.logDel = lg.logDel;
    var sl = Math.max(fieldStamp(a, "log"), fieldStamp(b, "log"));
    if (withFm && sl > 0) fm.log = sl;
    if (withFm) out.fm = fm;
    // keys a newer version may add, kept from the newer copy
    Object.keys(newer).forEach(function (k) {
      if (!has(out, k) && FIELDS.indexOf(k) === -1 && k !== "fm" && k !== "log" && k !== "logDel") out[k] = clone(newer[k]);
    });
    return out;
  }

  // Stamps what changed between the stored copy `prev` and the copy
  // about to be stored `cur` (mutates and returns cur). Every write
  // path of the app goes through this once (saveState), so a field
  // is stamped exactly when its value changes, whoever changed it.
  // `now` is the clock of this save.
  function restamp(prev, cur, now) {
    if (!cur) return cur;
    var base = isNum(cur.mtime) ? cur.mtime : now;
    if (!prev) {
      if (cur.fm && !touchedByOldCode(cur)) return cur;
      var fm0 = {};
      FIELDS.forEach(function (f) {
        if (NEW_FIELDS.indexOf(f) === -1 || has(cur, f)) fm0[f] = base;
      });
      if ((cur.log && cur.log.length) || (cur.logDel && Object.keys(cur.logDel).length)) fm0.log = base;
      cur.fm = fm0;
      return cur;
    }
    var changed = FIELDS.filter(function (f) {
      return J(prev[f]) !== J(cur[f]) || has(prev, f) !== has(cur, f);
    });
    var logChanged = J(prev.log || []) !== J(cur.log || []) || J(prev.logDel || {}) !== J(cur.logDel || {});
    if (!changed.length && !logChanged) {
      if (prev.fm) cur.fm = clone(prev.fm); else delete cur.fm;
      if (cur.mtime !== prev.mtime) cur.mtime = prev.mtime;   // nothing changed: no new stamp (R27)
      return cur;
    }
    var fm = {};
    STAMPS.forEach(function (f) {
      var s = fieldStamp(prev, f);
      if (s >= 0 && (f !== "log" || s > 0)) fm[f] = s;
    });
    var s = (cur.mtime > (prev.mtime || 0)) ? cur.mtime : now;
    var floor = Math.max(prev.mtime || 0, maxStamp(prev));
    if (!(s > floor)) s = floor + 1;
    changed.forEach(function (f) {
      // a new key cleared to nothing stays present (null / ""), so
      // it still wins over a copy that never had it
      if (NEW_FIELDS.indexOf(f) !== -1 && !has(cur, f)) cur[f] = f === "keep" ? null : "";
      fm[f] = s;
    });
    if (logChanged) fm.log = s;
    NEW_FIELDS.forEach(function (f) { if (!has(cur, f)) delete fm[f]; });
    cur.fm = fm;
    cur.mtime = s;
    return cur;
  }

  // ---- log editing (the app stamps; merge never reads a clock) ----
  function logPut(c, item, now) {
    var log = Array.isArray(c.log) ? c.log.filter(function (x) { return x.id !== item.id; }) : [];
    var it = sanLogItem({ id: item.id, k: item.k, d: item.d, tx: item.tx, m: now });
    if (!it) return false;
    log.push(it);
    c.log = sanLog(log);
    if (c.logDel && has(c.logDel, it.id)) {
      delete c.logDel[it.id];
      if (!Object.keys(c.logDel).length) delete c.logDel;
    }
    return true;
  }
  function logRemove(c, id, now) {
    if (!Array.isArray(c.log)) return null;
    var it = null;
    c.log = c.log.filter(function (x) { if (x.id === id) { it = x; return false; } return true; });
    if (!it) return null;
    if (!c.log.length) delete c.log;
    var del = sanLogDel(c.logDel);
    del[id] = Math.max(now, it.m + 1);
    c.logDel = sanLogDel(del);
    return it;
  }

  var api = {
    OLD_FIELDS: OLD_FIELDS, NEW_FIELDS: NEW_FIELDS, FIELDS: FIELDS, KINDS: KINDS,
    sanKeep: sanKeep, sanSeen: sanSeen, sanLog: sanLog, sanLogDel: sanLogDel,
    sanFm: sanFm, sanExtras: sanExtras, validYmd: validYmd,
    fieldStamp: fieldStamp, touchedByOldCode: touchedByOldCode,
    mergeContact: mergeContact, mergeLog: mergeLog, restamp: restamp,
    logPut: logPut, logRemove: logRemove
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosContactsMerge = api;
})(typeof self !== "undefined" ? self : this);
