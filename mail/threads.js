// ============================================================
// orOS Mail — conversations (v1.0.0)
// Pure: groups a folder's list of messages into conversations.
//   1. A reply joins the message it answers (In-Reply-To = that
//      Message-ID), when both are in the list.
//   2. A message whose subject starts with Re: / Fwd: / Απ: … joins
//      the nearest OLDER message with the same subject (without the
//      prefixes), so a reply finds its start even when the headers
//      are missing. Messages without a prefix are never joined by
//      subject alone: five "Invoice" newsletters stay five rows.
// group(msgs) → [{ key, msgs }]   msgs: newest first (as given, the
//   list is newest first); groups ordered by their newest message.
// msgs: [{ uid, mid?, irt?, subj? }]
// ============================================================
(function (root) {
  "use strict";
  var PREFIX = /^\s*(?:(?:re|fwd?|fw|aw|sv|wg|tr|rif|απ|σχετ|προωθ\.?|προώθ\.?|προώθηση|ΠΡΘ)\s*(?:\[\d+\])?\s*[:：]\s*)+/i;

  function base(subj) {
    return String(subj || "").replace(PREFIX, "").replace(/\s+/g, " ").trim().toLowerCase();
  }
  function isReply(subj) { return PREFIX.test(String(subj || "")); }

  function group(msgs) {
    msgs = Array.isArray(msgs) ? msgs : [];
    var n = msgs.length;
    var parent = new Array(n);
    for (var i = 0; i < n; i++) parent[i] = i;
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); }
    var byMid = {};
    msgs.forEach(function (m, i) { if (m && m.mid) byMid[m.mid] = i; });
    msgs.forEach(function (m, i) {
      if (m && m.irt && byMid[m.irt] !== undefined) union(i, byMid[m.irt]);
    });
    // subject: list is newest first, so "older" = a later index
    msgs.forEach(function (m, i) {
      if (!m || !isReply(m.subj)) return;
      var b = base(m.subj);
      if (b.length < 2) return;
      for (var j = i + 1; j < n; j++) {
        if (msgs[j] && base(msgs[j].subj) === b) { union(i, j); return; }
      }
    });
    var out = [], at = {};
    msgs.forEach(function (m, i) {
      var r = find(i);
      if (at[r] === undefined) { at[r] = out.length; out.push({ key: "t" + (msgs[r] && msgs[r].uid), msgs: [] }); }
      out[at[r]].msgs.push(m);
    });
    // key = the oldest message's uid: stable while new replies arrive
    out.forEach(function (g) { g.key = "t" + g.msgs[g.msgs.length - 1].uid; });
    return out;
  }

  // "All inboxes": every account's rows in one list.
  // perAcct: [{ acct, msgs (newest first), threads: bool }]
  // → [{ key: acct + ":" + group key, acct, msgs }] at most max, by
  //   each row's newest message: date, then account order, then UID
  //   (a message without a date sorts as its account's neighbours do)
  function unify(perAcct, max) {
    var out = [];
    (perAcct || []).forEach(function (a, ai) {
      if (!a || !Array.isArray(a.msgs)) return;
      var gs = a.threads ? group(a.msgs) : a.msgs.map(function (m) { return { key: "t" + m.uid, msgs: [m] }; });
      var last = Infinity;
      gs.forEach(function (g, gi) {
        var d = g.msgs[0] && g.msgs[0].date > 0 ? g.msgs[0].date : 0;
        // no date: just under the row above it in its own account
        var sortAt = d || (last === Infinity ? 0 : last);
        last = sortAt;
        out.push({ key: a.acct + ":" + g.key, acct: a.acct, msgs: g.msgs, at: sortAt, ai: ai, gi: gi });
      });
    });
    out.sort(function (x, y) { return (y.at - x.at) || (x.ai - y.ai) || (x.gi - y.gi); });
    return out.slice(0, max > 0 ? max : out.length).map(function (g) { return { key: g.key, acct: g.acct, msgs: g.msgs }; });
  }

  var api = { v: 1, group: group, base: base, isReply: isReply, unify: unify };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.orosMailThreads = api;
})(typeof window !== "undefined" ? window : globalThis);
