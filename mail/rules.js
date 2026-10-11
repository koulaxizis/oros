// ============================================================
// orOS Mail — device rules (filters) (v1.0.0)
// Pure functions shared by mail.js (editor, "Run now") and notify.js
// (applies rules to new Inbox mail every few minutes while orOS is
// open, also with the Mail window closed).
//
// A rule (synced in the "mail" slice, data.rules):
//   { id, m, on, acct, field: "from"|"to"|"subject"|"any", has,
//     act: "move"|"read"|"star", to? }
//   "has" is matched case-insensitively as a substring; several words
//   separated by commas mean "any of them" (e.g. "news@a.gr, offers").
//   "to" is a folder of that account (Spam / Trash / Archive are just
//   folders here: the editor fills in the account's own names).
//
// norm(rule) → rule | null
// match(rule, sum, acctId) → bool    sum: mime.js summary() or mail.js
//   summarize() ({ from, to, cc, subject | subj })
// plan(rules, msgs, acctId) → { flags: { "\\Seen": [uid], "\\Flagged": [uid] },
//   moves: { folder: [uid] }, handled: { uid: "move" | "read" } }
//   msgs: [{ uid, sum, flags? }]. Every matching rule adds its flag;
//   the first matching move wins. Flags already set are skipped.
// ============================================================
(function (root) {
  "use strict";
  var FIELDS = { from: 1, to: 1, subject: 1, any: 1 };
  var ACTS = { move: 1, read: 1, star: 1 };
  var MAX_HAS = 200;
  var MAX_RULES = 100;

  function isInt(n) { return typeof n === "number" && isFinite(n) && Math.floor(n) === n; }
  function folderOk(f) {
    return typeof f === "string" && f.length > 0 && f.length <= 200 && !/[\r\n\0"\\]/.test(f);
  }

  function norm(r) {
    if (!r || typeof r !== "object") return null;
    if (typeof r.id !== "string" || !/^[a-z0-9]{6,40}$/.test(r.id)) return null;
    if (!isInt(r.m) || r.m < 0) return null;
    if (typeof r.acct !== "string" || !/^[a-z0-9]{6,40}$/.test(r.acct)) return null;
    if (!FIELDS[r.field] || !ACTS[r.act]) return null;
    var has = typeof r.has === "string" ? r.has.replace(/[\r\n\t]+/g, " ").trim().slice(0, MAX_HAS) : "";
    if (!has) return null;
    var out = { id: r.id, m: r.m, on: r.on !== false, acct: r.acct, field: r.field, has: has, act: r.act };
    if (r.act === "move") {
      if (!folderOk(r.to)) return null;
      out.to = r.to;
    }
    return out;
  }

  function words(has) {
    return String(has || "").toLowerCase().split(",").map(function (w) { return w.trim(); }).filter(Boolean);
  }
  function people(list) {
    return (Array.isArray(list) ? list : []).map(function (p) {
      return p ? String(p.name || "") + " <" + String(p.addr || "") + ">" : "";
    }).join(", ");
  }
  function hay(field, sum) {
    sum = sum || {};
    var subj = String(sum.subject !== undefined ? sum.subject : (sum.subj || ""));
    var from = people([sum.from]);
    var to = people([].concat(sum.to || [], sum.cc || []));
    if (field === "from") return from;
    if (field === "to") return to;
    if (field === "subject") return subj;
    return from + "\n" + to + "\n" + subj;
  }

  function match(rule, sum, acctId) {
    if (!rule || rule.on === false || rule.acct !== acctId) return false;
    var h = hay(rule.field, sum).toLowerCase();
    return words(rule.has).some(function (w) { return h.indexOf(w) >= 0; });
  }

  function plan(rules, msgs, acctId) {
    var out = { flags: { "\\Seen": [], "\\Flagged": [] }, moves: {}, handled: {} };
    var mine = (Array.isArray(rules) ? rules : []).map(norm).filter(function (r) {
      return r && r.on && r.acct === acctId;
    }).slice(0, MAX_RULES);
    if (!mine.length) return out;
    (Array.isArray(msgs) ? msgs : []).forEach(function (x) {
      if (!x || !(x.uid > 0)) return;
      var have = Array.isArray(x.flags) ? x.flags : [];
      var moved = false;
      mine.forEach(function (r) {
        if (!match(r, x.sum, acctId)) return;
        if (r.act === "read" || r.act === "star") {
          var f = r.act === "read" ? "\\Seen" : "\\Flagged";
          if (have.indexOf(f) < 0 && out.flags[f].indexOf(x.uid) < 0) out.flags[f].push(x.uid);
          if (r.act === "read" && !out.handled[x.uid]) out.handled[x.uid] = "read";
        } else if (!moved) {
          moved = true;
          (out.moves[r.to] = out.moves[r.to] || []).push(x.uid);
          out.handled[x.uid] = "move";
        }
      });
    });
    return out;
  }

  var api = { v: 1, norm: norm, match: match, plan: plan, MAX_RULES: MAX_RULES };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.orosMailRules = api;
})(typeof window !== "undefined" ? window : globalThis);
