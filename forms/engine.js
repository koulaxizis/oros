// ============================================================
// orOS Forms — form engine (forms/engine.js, window.OrosFormsEngine)
// The pure model of one form: question types, pages, show-if
// conditions, jumps between pages, answer checks and the clean set of
// answers a submit keeps. The same code runs in the app's preview and,
// from wave 2, on the public page people fill in, so what the builder
// shows is exactly what a respondent gets.
// No DOM, no storage. Node-tested (tests/forms.test.js).
//
// A form: { id, title, desc?, qs: [item], set: { thanks?, prog?, note? } }
// An item (question, statement or page break):
//   { id, t, label, help?, req?, show?, ...type fields }
//   t: text | para | email | phone | number | date | time | choice |
//      multi | select | scale | stars | yesno | matrix | info | page
//   text, para    minL?, maxL? (characters)
//   number        min?, max?, int? (whole numbers only)
//   date          min?, max? ("YYYY-MM-DD")
//   choice, select, multi
//                 opts: [{ id, label }] (1..50); other? (choice, multi:
//                 an "Other: ___" choice, id "_o"); multi: minC?, maxC?
//   scale         lo (0 or 1), hi (2..10), loL?, hiL? (end labels)
//   stars         hi (3..10, default 5)
//   matrix        rows: [{ id, label }] (1..30), opts = the columns
//                 (1..10), multi? (more than one per row)
//   page          a page break; label/help = the new page's title and
//                 text; next? = where to go after this page
//   show          { q, op, v? }: shown only when the earlier question q
//                 matches. op: eq | ne (choice, select, yesno, scale,
//                 stars, number, text), has (multi), set | unset (any),
//                 gt | lt (number, scale, stars, date)
//   go            (choice, select, yesno) { <option id | yes | no>:
//                 <page id | "end"> }: after this page, go there
// Jumps only go forward (a later page or the end), so every way through
// a form ends; a reference to a question or page that is not there any
// more is dropped when the form is normalized.
// Answers: { <question id>: value, "<question id>.o": other text }
//   text/para/email/phone: string · number: number · date "YYYY-MM-DD" ·
//   time "HH:MM" · choice/select: option id or "_o" · multi: [option
//   ids] · scale/stars: whole number · yesno: "yes" | "no" ·
//   matrix: { <row id>: column id } or { <row id>: [column ids] }
// ============================================================
(function (root) {
  "use strict";

  var VERSION = "1.0.0";
  var TYPES = ["text", "para", "email", "phone", "number", "date", "time", "choice",
               "multi", "select", "scale", "stars", "yesno", "matrix", "info", "page"];
  // Items that take an answer.
  var ASKS = { text: 1, para: 1, email: 1, phone: 1, number: 1, date: 1, time: 1, choice: 1,
               multi: 1, select: 1, scale: 1, stars: 1, yesno: 1, matrix: 1 };
  var CHOICE = { choice: 1, select: 1, multi: 1 };
  var JUMPS = { choice: 1, select: 1, yesno: 1 };
  var OPS = ["eq", "ne", "has", "set", "unset", "gt", "lt"];
  var LIM = {
    title: 200, desc: 2000, label: 500, help: 1000, opt: 200, opts: 50, cols: 10, rows: 30,
    items: 300, text: 500, para: 5000, other: 500, thanks: 1000, note: 1000, num: 1e12
  };
  var OTHER = "_o";
  var ID_RE = /^[a-z0-9]{1,24}$/;
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  var EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:.]{2,}$/;
  var PHONE_RE = /^\+?[0-9 ()\-.\/]{3,40}$/;

  // ---------- helpers ----------
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function isNum(v) { return typeof v === "number" && isFinite(v) && Math.abs(v) <= LIM.num; }
  // One line: control and bidi-override characters out, spaces folded.
  function line(s, max) {
    return String(s == null ? "" : s)
      .replace(/[\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, max);
  }
  // Text with line breaks kept (at most one empty line in a row).
  function block(s, max) {
    return String(s == null ? "" : s).replace(/\r\n?/g, "\n").replace(/\t/g, " ")
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "")
      .replace(/[ ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
  }
  function validDay(s) {
    if (typeof s !== "string" || !DAY_RE.test(s)) return false;
    var d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
    return d.toISOString().slice(0, 10) === s;
  }
  function newId(taken) {
    for (;;) {
      var s = Math.random().toString(36).slice(2, 10);
      if (ID_RE.test(s) && !(taken && taken[s])) { if (taken) taken[s] = 1; return s; }
    }
  }
  function clampInt(v, lo, hi, dflt) {
    var n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    if (!isInt(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  }

  // ---------- normalize ----------
  function normOpts(list, max) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (o) {
      if (!isObj(o) || out.length >= max) return;
      var id = typeof o.id === "string" && ID_RE.test(o.id) && o.id !== OTHER ? o.id : "";
      var label = line(o.label, LIM.opt);
      if (!id || seen[id]) return;
      seen[id] = 1;
      out.push({ id: id, label: label });
    });
    return out;
  }

  // One item, its own fields only (references are checked by normForm).
  function normItem(q) {
    if (!isObj(q) || TYPES.indexOf(q.t) < 0 || typeof q.id !== "string" || !ID_RE.test(q.id)) return null;
    var t = q.t, o = { id: q.id, t: t, label: line(q.label, LIM.label) };
    var help = block(q.help, LIM.help);
    if (help) o.help = help;
    if (ASKS[t] && q.req) o.req = 1;
    if (t === "text" || t === "para") {
      var cap = t === "text" ? LIM.text : LIM.para;
      var minL = clampInt(q.minL, 0, cap, 0), maxL = clampInt(q.maxL, 1, cap, 0);
      if (minL) o.minL = minL;
      if (maxL && maxL >= minL) o.maxL = maxL;
    } else if (t === "number") {
      if (isNum(q.min)) o.min = q.min;
      if (isNum(q.max) && !(isNum(o.min) && q.max < o.min)) o.max = q.max;
      if (q.int) o.int = 1;
    } else if (t === "date") {
      if (validDay(q.min)) o.min = q.min;
      if (validDay(q.max) && !(o.min && q.max < o.min)) o.max = q.max;
    } else if (CHOICE[t]) {
      o.opts = normOpts(q.opts, LIM.opts);
      if (!o.opts.length) o.opts = [{ id: "a", label: "" }];
      if (t !== "select" && q.other) o.other = 1;
      if (t === "multi") {
        var n = o.opts.length + (o.other ? 1 : 0);
        var minC = clampInt(q.minC, 0, n, 0), maxC = clampInt(q.maxC, 1, n, 0);
        if (minC) o.minC = minC;
        if (maxC && maxC >= minC) o.maxC = maxC;
      }
    } else if (t === "scale") {
      o.lo = q.lo === 0 ? 0 : 1;
      o.hi = clampInt(q.hi, 2, 10, 5);
      var loL = line(q.loL, 60), hiL = line(q.hiL, 60);
      if (loL) o.loL = loL;
      if (hiL) o.hiL = hiL;
    } else if (t === "stars") {
      o.hi = clampInt(q.hi, 3, 10, 5);
    } else if (t === "matrix") {
      o.rows = normOpts(q.rows, LIM.rows);
      if (!o.rows.length) o.rows = [{ id: "r1", label: "" }];
      o.opts = normOpts(q.opts, LIM.cols);
      if (!o.opts.length) o.opts = [{ id: "a", label: "" }];
      if (q.multi) o.multi = 1;
    }
    if (t !== "page" && isObj(q.show) && typeof q.show.q === "string" && OPS.indexOf(q.show.op) >= 0) {
      var s = { q: q.show.q, op: q.show.op };
      if (q.show.op !== "set" && q.show.op !== "unset") {
        if (typeof q.show.v === "string") s.v = line(q.show.v, LIM.opt);
        else if (isNum(q.show.v)) s.v = q.show.v;
        else s = null;
      }
      if (s) o.show = s;
    }
    if (JUMPS[t] && isObj(q.go)) {
      var go = {};
      Object.keys(q.go).sort().forEach(function (k) {
        if (typeof q.go[k] === "string" && (q.go[k] === "end" || ID_RE.test(q.go[k]))) go[k] = q.go[k];
      });
      if (Object.keys(go).length) o.go = go;
    }
    if (t === "page" && typeof q.next === "string" && (q.next === "end" || ID_RE.test(q.next))) o.next = q.next;
    return o;
  }

  // Answer keys of an item that a jump or a condition can name.
  function keysOf(q) {
    if (q.t === "yesno") return ["yes", "no"];
    if (CHOICE[q.t]) return q.opts.map(function (o) { return o.id; }).concat(q.other ? [OTHER] : []);
    return [];
  }

  // The whole form: items normalized, ids unique, every reference to a
  // question before it and every jump forward to a page that exists.
  function normForm(f) {
    f = isObj(f) ? f : {};
    var out = { id: typeof f.id === "string" && ID_RE.test(f.id) ? f.id : newId(), title: line(f.title, LIM.title) };
    var desc = block(f.desc, LIM.desc);
    if (desc) out.desc = desc;
    var seen = {}, items = [];
    (Array.isArray(f.qs) ? f.qs : []).forEach(function (raw) {
      if (items.length >= LIM.items) return;
      var q = normItem(raw);
      if (!q || seen[q.id]) return;
      seen[q.id] = 1;
      items.push(q);
    });
    // Page of each item (index into the page list; 0 = before any break).
    var pageOf = {}, pageIdx = {}, p = 0;
    items.forEach(function (q) {
      if (q.t === "page") { p++; pageIdx[q.id] = p; }
      pageOf[q.id] = p;
    });
    var before = {};
    items.forEach(function (q) {
      if (q.show) {
        var src = before[q.show.q];
        var ok = !!src;
        if (ok && (q.show.op === "has") && src.t !== "multi") ok = false;
        if (ok && (q.show.op === "gt" || q.show.op === "lt") &&
            ["number", "scale", "stars", "date"].indexOf(src.t) < 0) ok = false;
        if (ok && (q.show.op === "eq" || q.show.op === "ne" || q.show.op === "has") && !has(q.show, "v")) ok = false;
        if (ok && (q.show.op === "eq" || q.show.op === "ne" || q.show.op === "has") && keysOf(src).length &&
            keysOf(src).indexOf(String(q.show.v)) < 0) ok = false;
        if (!ok) delete q.show;
      }
      var forward = function (target) {
        return target === "end" || (has(pageIdx, target) && pageIdx[target] > pageOf[q.id]);
      };
      if (q.go) {
        var keys = keysOf(q);
        Object.keys(q.go).forEach(function (k) {
          if (keys.indexOf(k) < 0 || !forward(q.go[k])) delete q.go[k];
        });
        if (!Object.keys(q.go).length) delete q.go;
      }
      if (q.t === "page" && q.next && !forward(q.next)) delete q.next;
      if (ASKS[q.t]) before[q.id] = q;
    });
    out.qs = items;
    var s = isObj(f.set) ? f.set : {}, set = {};
    var thanks = block(s.thanks, LIM.thanks), note = block(s.note, LIM.note);
    if (thanks) set.thanks = thanks;
    if (note) set.note = note;
    if (s.prog) set.prog = 1;
    // W2: a page to link to after sending (shown as a link, never a
    // redirect) and "one answer per browser" (kept by the browser only).
    var back = typeof s.back === "string" ? s.back.trim() : "";
    if (validBack(back)) set.back = back;
    if (s.once) set.once = 1;
    out.set = set;
    return out;
  }

  // An https address without user, password, spaces or quotes, ≤ 512.
  function validBack(v) {
    if (typeof v !== "string" || !v || v.length > 512 || /[\s<>"'`\\]/.test(v)) return false;
    if (!/^https:\/\/[^/?#@]+\.[^/?#@]+([/?#].*)?$/i.test(v)) return false;
    try { var u = new URL(v); return u.protocol === "https:" && !u.username && !u.password; } catch (e) { return false; }
  }

  // ---------- pages ----------
  // [{ id, head (the page item or null), items: [non-page items] }]
  function pages(form) {
    var list = [{ id: "", head: null, items: [] }];
    form.qs.forEach(function (q) {
      if (q.t === "page") list.push({ id: q.id, head: q, items: [] });
      else list[list.length - 1].items.push(q);
    });
    return list;
  }
  function byId(form) {
    var m = {};
    form.qs.forEach(function (q) { m[q.id] = q; });
    return m;
  }

  // ---------- answers ----------
  function isEmpty(q, v) {
    if (v == null) return true;
    if (q.t === "multi") return !Array.isArray(v) || !v.length;
    if (q.t === "matrix") return !isObj(v) || !Object.keys(v).length;
    if (typeof v === "string") return v.trim() === "";
    return false;
  }
  function numOf(v) {
    if (typeof v === "number") return v;
    if (typeof v !== "string") return NaN;
    var s = v.trim().replace(/\s/g, "");
    if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", ".");
    return s === "" || !/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s) ? NaN : Number(s);
  }

  // A raw value (from an input) → the stored shape, or undefined when it
  // cannot be one (check() then says why).
  function valueOf(q, v) {
    if (v == null) return undefined;
    switch (q.t) {
      case "text": case "email": case "phone": return typeof v === "string" ? line(v, LIM.text) : undefined;
      case "para": return typeof v === "string" ? block(v, LIM.para) : undefined;
      case "number": var n = numOf(v); return isNum(n) ? n : undefined;
      case "date": return validDay(v) ? v : undefined;
      case "time": return typeof v === "string" && TIME_RE.test(v) ? v : undefined;
      case "choice": case "select":
        return typeof v === "string" && keysOf(q).indexOf(v) >= 0 ? v : undefined;
      case "multi":
        if (!Array.isArray(v)) return undefined;
        var keys = keysOf(q), pick = {};
        v.forEach(function (k) { if (typeof k === "string" && keys.indexOf(k) >= 0) pick[k] = 1; });
        return keys.filter(function (k) { return pick[k]; });
      case "scale": case "stars":
        var lo = q.t === "scale" ? q.lo : 1, x = typeof v === "string" ? Number(v) : v;
        return isInt(x) && x >= lo && x <= q.hi ? x : undefined;
      case "yesno": return v === "yes" || v === "no" ? v : undefined;
      case "matrix":
        if (!isObj(v)) return undefined;
        var cols = q.opts.map(function (o) { return o.id; }), out = {};
        q.rows.forEach(function (r) {
          var a = v[r.id];
          if (q.multi) {
            if (!Array.isArray(a)) return;
            var c = cols.filter(function (k) { return a.indexOf(k) >= 0; });
            if (c.length) out[r.id] = c;
          } else if (typeof a === "string" && cols.indexOf(a) >= 0) out[r.id] = a;
        });
        return out;
    }
    return undefined;
  }

  // Why an answer does not fit, or "" when it does. Codes: req, len,
  // short, long, email, phone, num, int, min, max, date, time, opt,
  // few, many, other, rows.
  function checkOne(q, raw, otherText) {
    if (!ASKS[q.t]) return "";
    if (isEmpty(q, raw)) return q.req ? "req" : "";
    var v = valueOf(q, raw);
    if (v === undefined) {
      return { number: "num", date: "date", time: "time", email: "email", phone: "phone" }[q.t] || "opt";
    }
    if (isEmpty(q, v)) return q.req ? "req" : "";
    var picked = q.t === "multi" ? v.indexOf(OTHER) >= 0 : v === OTHER;
    if ((q.t === "choice" || q.t === "multi") && picked && !line(otherText, LIM.other)) return "other";
    switch (q.t) {
      case "text": case "para":
        if (q.minL && v.length < q.minL) return "short";
        if (q.maxL && v.length > q.maxL) return "long";
        return "";
      case "email": return EMAIL_RE.test(v) && v.length <= 200 ? "" : "email";
      case "phone": return PHONE_RE.test(v) && (v.match(/\d/g) || []).length >= 3 ? "" : "phone";
      case "number":
        if (q.int && !isInt(v)) return "int";
        if (has(q, "min") && v < q.min) return "min";
        if (has(q, "max") && v > q.max) return "max";
        return "";
      case "date":
        if (q.min && v < q.min) return "min";
        if (q.max && v > q.max) return "max";
        return "";
      case "multi":
        if (q.minC && v.length < q.minC) return "few";
        if (q.maxC && v.length > q.maxC) return "many";
        return "";
      case "matrix":
        return q.req && Object.keys(v).length < q.rows.length ? "rows" : "";
    }
    return "";
  }

  // ---------- logic ----------
  // Is item q shown, given the answers? A condition on a question that
  // is itself hidden counts as not met (its answer does not count).
  function shownMap(form, ans) {
    var map = {}, idx = byId(form);
    form.qs.forEach(function (q) {
      if (!q.show) { map[q.id] = true; return; }
      var src = idx[q.show.q];
      if (!src || !map[src.id]) { map[q.id] = q.show.op === "unset"; return; }
      var raw = ans ? ans[src.id] : undefined;
      var v = isEmpty(src, raw) ? undefined : valueOf(src, raw);
      if (v !== undefined && isEmpty(src, v)) v = undefined;
      var op = q.show.op, want = q.show.v, ok;
      if (op === "set") ok = v !== undefined;
      else if (op === "unset") ok = v === undefined;
      else if (v === undefined) ok = false;
      else if (op === "has") ok = Array.isArray(v) && v.indexOf(String(want)) >= 0;
      else if (op === "gt" || op === "lt") {
        var a = src.t === "date" ? v : Number(v), b = src.t === "date" ? String(want) : numOf(want);
        ok = src.t === "date" ? (op === "gt" ? a > b : a < b) : (isFinite(b) && (op === "gt" ? a > b : a < b));
      } else {
        var same = typeof v === "number" ? v === numOf(want) :
          (src.t === "text" ? String(v).toLowerCase() === String(want).toLowerCase() : String(v) === String(want));
        ok = op === "eq" ? same : !same;
      }
      map[q.id] = ok;
    });
    return map;
  }

  // The page that comes after page pi (an index), or -1 for the end.
  function nextPage(form, pi, ans, shown) {
    var list = pages(form);
    shown = shown || shownMap(form, ans);
    var target = null;
    list[pi].items.forEach(function (q) {
      if (!q.go || !shown[q.id]) return;
      var v = valueOf(q, ans ? ans[q.id] : undefined);
      if (typeof v === "string" && has(q.go, v)) target = q.go[v];
    });
    if (target == null && list[pi].head && list[pi].head.next) target = list[pi].head.next;
    if (target === "end") return -1;
    if (target) {
      for (var i = pi + 1; i < list.length; i++) if (list[i].id === target) return i;
    }
    return pi + 1 < list.length ? pi + 1 : -1;
  }

  // Every page a respondent with these answers goes through, in order.
  function path(form, ans) {
    var shown = shownMap(form, ans), out = [], pi = 0;
    while (pi >= 0 && out.length <= form.qs.length + 1) {
      out.push(pi);
      var nx = nextPage(form, pi, ans, shown);
      if (nx >= 0 && nx <= pi) break;          // never back (normForm makes this impossible)
      pi = nx;
    }
    return out;
  }

  // Errors of the shown questions of page pi: { <question id>: code }.
  function checkPage(form, pi, ans) {
    var shown = shownMap(form, ans), errs = {};
    pages(form)[pi].items.forEach(function (q) {
      if (!shown[q.id] || !ASKS[q.t]) return;
      var e = checkOne(q, ans ? ans[q.id] : undefined, ans ? ans[q.id + ".o"] : "");
      if (e) errs[q.id] = e;
    });
    return errs;
  }

  // The whole submit: every page on the way checked; the answers kept are
  // only those of shown questions on pages on the way, in stored shape.
  // → { ok, errs, page (first page with an error, or -1), answers }
  function submit(form, ans) {
    ans = isObj(ans) ? ans : {};
    var way = path(form, ans), shown = shownMap(form, ans), list = pages(form);
    var errs = {}, first = -1, out = {};
    way.forEach(function (pi) {
      var e = checkPage(form, pi, ans);
      if (Object.keys(e).length && first < 0) first = pi;
      Object.keys(e).forEach(function (k) { errs[k] = e[k]; });
      list[pi].items.forEach(function (q) {
        if (!shown[q.id] || !ASKS[q.t] || errs[q.id]) return;
        var raw = ans[q.id];
        if (isEmpty(q, raw)) return;
        var v = valueOf(q, raw);
        if (v === undefined || isEmpty(q, v)) return;
        out[q.id] = v;
        var picked = q.t === "multi" ? v.indexOf(OTHER) >= 0 : v === OTHER;
        if (picked) out[q.id + ".o"] = line(ans[q.id + ".o"], LIM.other);
      });
    });
    return { ok: first < 0, errs: errs, page: first, answers: first < 0 ? out : null };
  }

  // A blank item of a type, with a fresh id (the builder's "add").
  function blank(t, taken, words) {
    words = words || {};
    var id = newId(taken), q = { id: id, t: t, label: "" };
    if (CHOICE[t]) q.opts = [{ id: newId(taken), label: words.opt1 || "Option 1" }];
    if (t === "scale") { q.lo = 1; q.hi = 5; }
    if (t === "stars") q.hi = 5;
    if (t === "matrix") {
      q.rows = [{ id: newId(taken), label: words.row1 || "Row 1" }];
      q.opts = [{ id: newId(taken), label: words.col1 || "Column 1" }];
    }
    return normItem(q);
  }

  // Same items with new ids (a duplicated form or question); references
  // follow the new ids.
  function reid(items, taken) {
    var map = {};
    var out = items.map(function (q) {
      var c = JSON.parse(JSON.stringify(q));
      map[c.id] = c.id = newId(taken);
      return c;
    });
    out.forEach(function (c) {
      if (c.show && map[c.show.q]) c.show.q = map[c.show.q];
      if (c.next && map[c.next]) c.next = map[c.next];
      if (c.go) Object.keys(c.go).forEach(function (k) { if (map[c.go[k]]) c.go[k] = map[c.go[k]]; });
    });
    return out;
  }

  var api = {
    VERSION: VERSION, TYPES: TYPES, ASKS: ASKS, LIM: LIM, OTHER: OTHER, ID_RE: ID_RE,
    normItem: normItem, normForm: normForm, pages: pages, keysOf: keysOf,
    valueOf: valueOf, checkOne: checkOne, shownMap: shownMap, nextPage: nextPage, path: path,
    checkPage: checkPage, submit: submit, blank: blank, reid: reid, newId: newId,
    line: line, block: block, validDay: validDay, validBack: validBack
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosFormsEngine = api;
})(typeof window !== "undefined" ? window : this);
