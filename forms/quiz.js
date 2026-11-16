// ============================================================
// orOS Forms: quiz (FORMS-5). Pure, Node-tested (tests/forms-quiz.test.js);
// no DOM. Shared by the app (results, each answer, export) and the
// public page (the score after sending, when the form shows it).
//
//   on(form) → true when the form is a quiz with at least one key
//   score(form, a) → { pts, max, n, items: [{ q, ok, pts, max }] } for
//     the keyed questions the person was asked (on their way through
//     the pages and shown by the conditions); a question without an
//     answer scores 0. null when the form is not a quiz.
//   right(q, v) → true when a stored answer v matches q.key
//   pub(form) → the copy the public page gets: without keys, points and
//     the quiz settings unless the form shows the score (set.score),
//     so the right answers never travel when nobody needs them there.
// ============================================================
(function (root) {
  "use strict";
  var E = (typeof module !== "undefined" && module.exports) ? require("./engine.js") : root.OrosFormsEngine;

  function fold(s) {
    return String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\u03c2/g, "\u03c3").replace(/\s+/g, " ").trim();
  }
  function keyed(f) { return f.qs.filter(function (q) { return E.KEYED[q.t] && q.key !== undefined; }); }
  function on(form) {
    var f = E.normForm(form);
    return !!f.set.quiz && keyed(f).length > 0;
  }
  function right(q, v) {
    if (v === undefined || q.key === undefined) return false;
    if (q.t === "multi") {
      if (!Array.isArray(v) || v.length !== q.key.length) return false;
      return q.key.every(function (k) { return v.indexOf(k) >= 0; });
    }
    if (q.t === "number") return typeof v === "number" && Math.abs(v - q.key) < 1e-9;
    if (q.t === "text") { var a = fold(v); return !!a && q.key.some(function (k) { return fold(k) === a; }); }
    return v === q.key;
  }
  // The items the person was asked: pages on their path, shown items.
  function askedIds(f, a) {
    var shown = E.shownMap(f, a), way = E.path(f, a), list = E.pages(f), out = {};
    way.forEach(function (pi) { (list[pi] ? list[pi].items : []).forEach(function (q) { if (shown[q.id]) out[q.id] = 1; }); });
    return out;
  }
  function score(form, a) {
    var f = E.normForm(form);
    if (!f.set.quiz) return null;
    var ks = keyed(f);
    if (!ks.length) return null;
    a = a && typeof a === "object" && !Array.isArray(a) ? a : {};
    var asked = askedIds(f, a), out = { pts: 0, max: 0, n: 0, items: [] };
    ks.forEach(function (q) {
      if (!asked[q.id]) return;
      var max = q.pts || 1, ok = right(q, E.valueOf(q, a[q.id]));
      out.n++; out.max += max;
      if (ok) out.pts += max;
      out.items.push({ q: q.id, ok: ok, pts: ok ? max : 0, max: max });
    });
    return out;
  }
  function pub(form) {
    var f = E.normForm(form);
    if (f.set.quiz && f.set.score) return f;
    f.qs = f.qs.map(function (q) { var c = Object.assign({}, q); delete c.key; delete c.pts; return c; });
    var set = Object.assign({}, f.set);
    delete set.quiz; delete set.score; delete set.reveal;
    f.set = set;
    return f;
  }

  var api = { on: on, score: score, right: right, pub: pub };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosFormsQuiz = api;
})(typeof window !== "undefined" ? window : this);
