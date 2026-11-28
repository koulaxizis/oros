// ============================================================
// orOS Assistant — conversation history as threads (AS-THREADS)
// Pure helpers, node-tested (tests/assistant-threads.test.js):
//   - fold(text): lower case, accents and final sigma folded, so
//     "Ρουτίνα" finds "ρουτινα" and "café" finds "cafe"
//   - waits(chat): cards in a conversation still waiting for the
//     person (an entry, a file, a PDF … whose button nobody pressed)
//   - order(chats): pinned first, then newest first
//   - find(chats, query): every word in the title or the messages;
//     title hits first, each with a short snippet around the match
//   - resume(chats): the conversation to continue (newest with
//     messages)
//   - groups(chats, now): Pinned / Waiting / Routines / Today / Yesterday /
//     This week / Older, for the list
// Chris 2026-11-28: "να κρατάει ιστορικό των συνομιλιών … να
// μπορούμε να δουλεύουμε αβίαστα χωρίς να υπάρχει κενό".
// ============================================================
(function (root) {
  "use strict";

  var SNIP = 90;                 // characters of context in a search hit
  var TEXT_MAX = 60000;          // characters of one chat searched
  var FIND_MAX = 200;            // hits returned
  var Q_MAX = 120;

  // Cards that wait for a press. A card that waits keeps ui.st "" until
  // the person acts on it (done, declined, dismissed, opened, failed…).
  var WAIT_KINDS = {
    entry: 1, file: 1, rebuild: 1, house: 1, epub: 1, pdf: 1, mockup: 1,
    edit: 1, recipe: 1, rule: 1, nl: 1, cover: 1, nlCheck: 1, "do": 1,
    change: 1, create: 1, prop: 1
  };

  function isObj(x) { return !!x && typeof x === "object" && !Array.isArray(x); }

  // Same length as the text for Greek and Latin (each accented letter
  // stays one letter), so a position in it is a position in the text.
  function foldKeep(s) {
    s = String(s == null ? "" : s).toLowerCase();
    try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    return s.replace(/ς/g, "σ");   // i18n-inline-ok: final sigma folded for search
  }
  function fold(s) { return foldKeep(s).replace(/\s+/g, " ").trim(); }

  function waits(c) {
    var n = 0;
    if (!isObj(c) || !Array.isArray(c.msgs)) return 0;
    c.msgs.forEach(function (m) {
      if (!isObj(m) || m.r !== "tool" || !Array.isArray(m.results)) return;
      m.results.forEach(function (r) {
        var ui = isObj(r) ? r.ui : null;
        if (isObj(ui) && ui.st === "" && WAIT_KINDS[ui.k]) n++;
      });
    });
    return n;
  }

  function stampOf(c) { return isObj(c) && typeof c.m === "number" ? c.m : 0; }
  function order(list) {
    return (Array.isArray(list) ? list.slice() : []).filter(isObj).sort(function (a, b) {
      var pa = a.pin === 1 ? 1 : 0, pb = b.pin === 1 ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return stampOf(b) - stampOf(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
  }

  // The words a conversation says: its title, then what the person and
  // the AI wrote (tool results are data, not the conversation).
  function chatText(c) {
    var parts = [], len = 0;
    (Array.isArray(c.msgs) ? c.msgs : []).some(function (m) {
      if (!isObj(m) || m.cont) return false;
      if ((m.r === "user" || m.r === "asst" || m.r === "note") && typeof m.text === "string" && m.text) {
        parts.push(m.text);
        len += m.text.length + 1;
      }
      return len >= TEXT_MAX;
    });
    return parts.join("\n").slice(0, TEXT_MAX);
  }

  function words(q) {
    var f = fold(String(q == null ? "" : q).slice(0, Q_MAX));
    return f ? f.split(" ").filter(Boolean).slice(0, 8) : [];
  }

  // A snippet of the original text around the first word (the folded
  // text keeps the same length per character for Greek and Latin, so
  // positions match; when they do not, the start of the text is shown).
  function snippet(raw, w) {
    raw = raw.replace(/\s/g, " ");
    var folded = foldKeep(raw);
    var at = folded.indexOf(w);
    var src = raw.length === folded.length ? raw : folded;
    if (at < 0) at = 0;
    var from = Math.max(0, at - Math.floor(SNIP / 3));
    var s = src.slice(from, from + SNIP).replace(/\s+/g, " ").trim();
    return (from > 0 ? "…" : "") + s + (from + SNIP < src.length ? "…" : "");
  }

  function find(list, q) {
    var ws = words(q);
    if (!ws.length) return [];
    var hits = [];
    order(list).forEach(function (c) {
      var title = String(c.title || ""), ft = fold(title);
      var raw = chatText(c), fx = foldKeep(raw).replace(/\s/g, " ");
      var inTitle = ws.every(function (w) { return ft.indexOf(w) >= 0; });
      var all = ft + "\n" + fx;
      if (!inTitle && !ws.every(function (w) { return all.indexOf(w) >= 0; })) return;
      var w0 = ws.filter(function (w) { return fx.indexOf(w) >= 0; })[0];
      hits.push({ id: c.id, title: inTitle ? 1 : 0, snip: w0 ? snippet(raw, w0) : "" });
    });
    hits.sort(function (a, b) { return b.title - a.title; });
    return hits.slice(0, FIND_MAX);
  }

  function resume(list) {
    var best = null;
    (Array.isArray(list) ? list : []).forEach(function (c) {
      if (!isObj(c) || !Array.isArray(c.msgs) || !c.msgs.length) return;
      if (!best || stampOf(c) > stampOf(best)) best = c;
    });
    return best;
  }

  function dayStart(ms) { var d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

  // → [{ key: "pin"|"wait"|"rt"|"today"|"yday"|"week"|"older", chats: [...] }]
  // (empty groups left out). A pinned chat is only under Pinned; a chat
  // waiting for the person is under Waiting; a routine's conversation
  // (c.rt, AS-RT) is under Routines.
  function groups(list, now) {
    now = typeof now === "number" ? now : Date.now();
    var t0 = dayStart(now), y0 = t0 - 86400000, w0 = t0 - 6 * 86400000;
    var g = { pin: [], wait: [], rt: [], today: [], yday: [], week: [], older: [] };
    order(list).forEach(function (c) {
      var m = stampOf(c);
      if (c.pin === 1) g.pin.push(c);
      else if (waits(c)) g.wait.push(c);
      else if (typeof c.rt === "string" && c.rt) g.rt.push(c);
      else if (m >= t0) g.today.push(c);
      else if (m >= y0) g.yday.push(c);
      else if (m >= w0) g.week.push(c);
      else g.older.push(c);
    });
    return ["pin", "wait", "rt", "today", "yday", "week", "older"].filter(function (k) { return g[k].length; })
      .map(function (k) { return { key: k, chats: g[k] }; });
  }

  var api = { fold: fold, waits: waits, order: order, find: find, resume: resume, groups: groups,
              chatText: chatText, WAIT_KINDS: WAIT_KINDS, FIND_MAX: FIND_MAX };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosAssistThreads = api;
})(typeof window !== "undefined" ? window : globalThis);
