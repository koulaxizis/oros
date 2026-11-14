// ============================================================
// orOS Forms: links to other apps (FORMS-4). Pure, Node-tested
// (tests/forms-links.test.js); no DOM.
//
//   person(form, row) → { name, email, phone } | null
//     who answered, read from the form's own questions: the first
//     e-mail and phone question, and the name from a text question
//     whose label says name (any of NAME_WORDS), else the first short
//     text question before the e-mail. null when nothing was found.
//   toContact(p, title) → the Contacts entry card target
//     ({ asNew: { name, emails, phones, from } }), or null without a name
//   toCrm(p, title) → the CRM New customer target
//     ({ asNew: { name, email, phone, from } }), or null without a name
//   fromDraft(d) → { title, desc, qs } | null: a form the Assistant (or
//     Claude through the Gate) drafted, in simple words:
//     { title, desc?, questions: [{ label, type?, options?, required?,
//       low?, high?, rows? }] }; unknown types become short text, at
//     most MAX_DRAFT questions; ids are fresh. The app runs the result
//     through engine.normForm like every other form.
// ============================================================
(function (root) {
  "use strict";
  var E = (typeof module !== "undefined" && module.exports) ? require("./engine.js") : root.OrosFormsEngine;

  var MAX_DRAFT = 100;
  // The engine's own checks (engine.js checkOne email / phone).
  var EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:.]{2,}$/;
  var PHONE_RE = /^\+?[0-9 ()\-.\/]{3,40}$/;
  // Words a "name" question's label holds (EN, EL onoma / onomatepwnymo /
  // epwnymo as escapes, DE; folded, no accents).
  var NAME_WORDS = ["name", "\u03bf\u03bd\u03bf\u03bc\u03b1", "\u03bf\u03bd\u03bf\u03bc\u03b1\u03c4\u03b5\u03c0\u03c9\u03bd\u03c5\u03bc\u03bf", "\u03b5\u03c0\u03c9\u03bd\u03c5\u03bc\u03bf", "vorname", "nachname"];
  var TYPE_ALIAS = {
    text: "text", short: "text", para: "para", long: "para", paragraph: "para",
    email: "email", phone: "phone", number: "number", date: "date", time: "time",
    choice: "choice", one: "choice", radio: "choice", multi: "multi", checkboxes: "multi", checkbox: "multi",
    select: "select", dropdown: "select", scale: "scale", stars: "stars", rating: "stars",
    yesno: "yesno", matrix: "matrix", grid: "matrix", info: "info", page: "page"
  };

  function isObj(x) { return !!x && typeof x === "object" && !Array.isArray(x); }
  function fold(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u03c2/g, "\u03c3");
  }
  function str(v, max) {
    return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  }

  function person(form, row) {
    var qs = E.normForm(form).qs, a = row && isObj(row.a) ? row.a : {};
    var get = function (q) { var v = E.valueOf(q, a[q.id]); return typeof v === "string" ? v.trim() : ""; };
    var email = "", phone = "", name = "", firstText = "", seenEmail = false;
    qs.forEach(function (q) {
      if (q.t === "email") { var m = get(q); if (!email && EMAIL_RE.test(m)) email = m; seenEmail = true; }
      else if (q.t === "phone") { var ph = get(q); if (!phone && PHONE_RE.test(ph) && (ph.match(/\d/g) || []).length >= 3) phone = ph; }
      else if (q.t === "text") {
        var v = get(q);
        if (!v) return;
        var l = fold(q.label).replace(/[^a-z0-9\u03b1-\u03c9 ]/g, " ");
        var named = NAME_WORDS.some(function (w) { return (" " + l + " ").indexOf(" " + w) >= 0; });
        if (named && !name) name = v;
        if (!firstText && !seenEmail && v.length <= 120) firstText = v;
      }
    });
    if (!name) name = firstText;
    name = str(name, 120);
    if (!name && !email && !phone) return null;
    return { name: name, email: str(email, 120), phone: str(phone, 40) };
  }
  function from(title) { return str(title, 120); }
  function toContact(p, title) {
    if (!p || !p.name) return null;
    return { asNew: { name: p.name, emails: p.email ? [p.email] : [], phones: p.phone ? [p.phone] : [], from: from(title) } };
  }
  function toCrm(p, title) {
    if (!p || !p.name) return null;
    var o = { name: p.name, from: from(title) };
    if (p.email) o.email = p.email;
    if (p.phone) o.phone = p.phone;
    return { asNew: o };
  }

  function opts(list) {
    var taken = {};
    return (Array.isArray(list) ? list : []).slice(0, E.LIM.opts).map(function (o) {
      var label = str(isObj(o) ? o.label : o, E.LIM.opt);
      return label ? { id: E.newId(taken), label: label } : null;
    }).filter(Boolean);
  }
  function fromDraft(d) {
    if (!isObj(d)) return null;
    var title = str(d.title, E.LIM.title);
    var taken = {}, qs = [];
    (Array.isArray(d.questions) ? d.questions : []).slice(0, MAX_DRAFT).forEach(function (x) {
      if (typeof x === "string") x = { label: x };
      if (!isObj(x)) return;
      var t = TYPE_ALIAS[fold(x.type).replace(/[^a-z]/g, "")] || "text";
      var label = str(x.label, E.LIM.label);
      if (!label && t !== "page") return;
      var q = { id: E.newId(taken), t: t, label: label };
      if (x.required === true && E.ASKS[t]) q.req = 1;
      if (t === "choice" || t === "multi" || t === "select" || t === "matrix") {
        q.opts = opts(x.options);
        if (!q.opts.length && t !== "matrix") { q.t = "text"; delete q.opts; }
      }
      if (t === "matrix") {
        q.rows = opts(x.rows).slice(0, E.LIM.rows);
        if (!q.rows.length || !q.opts.length) { q.t = "text"; delete q.opts; delete q.rows; }
      }
      if (t === "scale") {
        var lo = x.low === 0 ? 0 : 1, hi = Math.round(Number(x.high));
        q.lo = lo; q.hi = isFinite(hi) && hi >= lo + 1 && hi <= 10 ? hi : 5;
      }
      if (t === "stars") { var h = Math.round(Number(x.high)); q.hi = isFinite(h) && h >= 3 && h <= 10 ? h : 5; }
      qs.push(q);
    });
    if (!title && !qs.length) return null;
    return { title: title, desc: typeof d.desc === "string" ? d.desc.slice(0, E.LIM.desc) : "", qs: qs };
  }

  var api = { person: person, toContact: toContact, toCrm: toCrm, fromDraft: fromDraft, MAX_DRAFT: MAX_DRAFT };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosFormsLinks = api;
})(typeof window !== "undefined" ? window : this);
