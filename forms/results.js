// ============================================================
// orOS Forms: results (FORMS-3). Pure, Node-tested
// (tests/forms-results.test.js); no DOM.
//
//   summary(form, rows, words) → [item] per asked question, in form order:
//     { q, t, label, n (answered), of (all rows), kind, ... }
//     kind "bars":  bars [{ key, label, n, pct }]   choice, select, multi,
//                   yes/no, scale, stars; avg? (scale, stars); for multi
//                   pct is of the people who answered (they may pick more)
//     kind "hist":  bars of value ranges (number); min, max, avg
//     kind "list":  texts [{ text, at }] newest first (text, para, e-mail,
//                   phone, date, time), at most LIST_MAX; more = how many left
//     kind "grid":  cols [label], rows [{ label, counts [n], n }] (matrix)
//   filterable(form) → [{ q, label, opts [{ key, label }] }] questions a
//     filter can use (one choice, drop-down, checkboxes, yes/no, scale, stars)
//   filter(form, rows, f) → rows where answer f.q is (or includes) f.v
//   table(form, rows, words) → [[head…], [cells…]…] oldest first: time,
//     waiting list (when any), then one column per asked question (a grid
//     one per row); numbers stay numbers, choices are their labels
//   csv(table) → text ("﻿", ";" between cells, CRLF, formula guard)
//
// words: { yes, no, other(text) → "Other: text", otherName, time, wait }
// rows: the answers of one form as C.answersOf gives them
//   ({ id, at, a, w? }); a = the stored answers (engine.submit shape).
// ============================================================
(function (root) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports;
  var E = NODE ? require("./engine.js") : root.OrosFormsEngine;
  var Q = NODE ? require("./quiz.js") : root.OrosFormsQuiz;

  var LIST_MAX = 50;
  var BINS = 8;
  var BAR = { choice: 1, select: 1, multi: 1, yesno: 1, scale: 1, stars: 1 };
  var LIST = { text: 1, para: 1, email: 1, phone: 1, date: 1, time: 1 };

  function isObj(x) { return !!x && typeof x === "object" && !Array.isArray(x); }
  function pct(n, of) { return of ? Math.round(n * 1000 / of) / 10 : 0; }
  function round(x) { return Math.round(x * 100) / 100; }
  function asked(form) {
    return E.normForm(form).qs.filter(function (q) { return E.ASKS[q.t]; });
  }
  function val(q, a) { return isObj(a) ? E.valueOf(q, a[q.id]) : undefined; }

  // The choices of a bar question, in order: [{ key, label }].
  function keysOf(q, words) {
    if (q.t === "yesno") return [{ key: "yes", label: words.yes }, { key: "no", label: words.no }];
    if (q.t === "scale" || q.t === "stars") {
      var out = [], lo = q.t === "scale" ? q.lo : 1;
      for (var i = lo; i <= q.hi; i++) out.push({ key: i, label: String(i) });
      return out;
    }
    var o = (q.opts || []).map(function (x) { return { key: x.id, label: x.label }; });
    if (q.other) o.push({ key: E.OTHER, label: words.otherName });
    return o;
  }
  function otherText(q, a) {
    var s = isObj(a) ? a[q.id + ".o"] : "";
    return typeof s === "string" ? s.trim().slice(0, E.LIM.other) : "";
  }

  function bars(q, rows, words) {
    var keys = keysOf(q, words), count = {}, n = 0, sum = 0;
    keys.forEach(function (k) { count[k.key] = 0; });
    rows.forEach(function (r) {
      var v = val(q, r.a);
      if (v === undefined || (Array.isArray(v) && !v.length)) return;
      n++;
      (Array.isArray(v) ? v : [v]).forEach(function (k) { if (count[k] !== undefined) count[k]++; });
      if (typeof v === "number") sum += v;
    });
    var o = { kind: "bars", n: n, bars: keys.map(function (k) {
      var b = { key: k.key, label: k.label, n: count[k.key], pct: pct(count[k.key], n) };
      // W5: the right option(s) of a quiz question
      if (q.key !== undefined && (Array.isArray(q.key) ? q.key.indexOf(k.key) >= 0 : q.key === k.key)) b.ok = 1;
      return b;
    }) };
    if ((q.t === "scale" || q.t === "stars") && n) o.avg = round(sum / n);
    return o;
  }

  // Numbers: whole numbers over a small range get one bar each, the
  // rest BINS equal ranges from the smallest to the largest answer.
  function hist(q, rows) {
    var xs = [];
    rows.forEach(function (r) { var v = val(q, r.a); if (typeof v === "number" && isFinite(v)) xs.push(v); });
    var o = { kind: "hist", n: xs.length, bars: [] };
    if (!xs.length) return o;
    var min = Math.min.apply(null, xs), max = Math.max.apply(null, xs), sum = 0;
    xs.forEach(function (x) { sum += x; });
    o.min = min; o.max = max; o.avg = round(sum / xs.length);
    var ints = xs.every(function (x) { return x === Math.floor(x); });
    if (ints && max - min < 12) {
      for (var v = min; v <= max; v++) {
        var c = xs.filter(function (x) { return x === v; }).length;
        o.bars.push({ key: String(v), label: String(v), n: c, pct: pct(c, xs.length) });
      }
      return o;
    }
    var w = (max - min) / BINS || 1, cnt = [];
    for (var i = 0; i < BINS; i++) cnt.push(0);
    xs.forEach(function (x) { cnt[Math.min(BINS - 1, Math.floor((x - min) / w))]++; });
    var fmt = function (x) { return String(ints ? Math.round(x) : round(x)); };
    for (var j = 0; j < BINS; j++) {
      var a = min + j * w, b = j === BINS - 1 ? max : min + (j + 1) * w;
      o.bars.push({ key: String(j), label: fmt(a) + "–" + fmt(b), n: cnt[j], pct: pct(cnt[j], xs.length) });
    }
    return o;
  }

  function list(q, rows) {
    var texts = [];
    rows.forEach(function (r) {
      var v = val(q, r.a);
      if (v === undefined || v === "") return;
      texts.push({ text: String(v), at: r.at || 0 });
    });
    texts.sort(function (a, b) { return b.at - a.at; });
    return { kind: "list", n: texts.length, texts: texts.slice(0, LIST_MAX), more: Math.max(0, texts.length - LIST_MAX) };
  }

  function grid(q, rows) {
    var cols = q.opts || [], n = 0;
    var out = (q.rows || []).map(function (r) {
      return { key: r.id, label: r.label, counts: cols.map(function () { return 0; }), n: 0 };
    });
    rows.forEach(function (row) {
      var v = val(q, row.a);
      if (!isObj(v) || !Object.keys(v).length) return;
      n++;
      out.forEach(function (r) {
        var c = v[r.key];
        if (c === undefined) return;
        r.n++;
        (Array.isArray(c) ? c : [c]).forEach(function (id) {
          var i = cols.map(function (x) { return x.id; }).indexOf(id);
          if (i >= 0) r.counts[i]++;
        });
      });
    });
    return { kind: "grid", n: n, cols: cols.map(function (c) { return c.label; }), rows: out };
  }

  function summary(form, rows, words) {
    rows = Array.isArray(rows) ? rows : [];
    var quiz = !!(Q && Q.on(form));
    return asked(form).map(function (q) {
      var s = BAR[q.t] ? bars(q, rows, words) : q.t === "number" ? hist(q, rows)
            : q.t === "matrix" ? grid(q, rows) : list(q, rows);
      s.q = q.id; s.t = q.t; s.label = q.label; s.of = rows.length;
      // W5: how many got it right, of those who answered it
      if (quiz && q.key !== undefined) {
        var ok = 0;
        rows.forEach(function (r) { if (Q.right(q, val(q, r.a))) ok++; });
        s.right = ok;
      }
      return s;
    });
  }
  // W5: the average score of these answers → { avg, max, n } | null
  function quizAvg(form, rows) {
    if (!Q || !Q.on(form)) return null;
    var sum = 0, mx = 0, n = 0;
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      var sc = Q.score(form, r.a);
      if (sc && sc.max) { sum += sc.pts; mx += sc.max; n++; }
    });
    return n ? { avg: round(sum / n), max: round(mx / n), n: n } : { avg: 0, max: 0, n: 0 };
  }

  function filterable(form, words) {
    return asked(form).filter(function (q) { return BAR[q.t]; }).map(function (q) {
      return { q: q.id, label: q.label, opts: keysOf(q, words) };
    });
  }
  function filter(form, rows, f) {
    rows = Array.isArray(rows) ? rows : [];
    if (!f || !f.q) return rows;
    var q = asked(form).filter(function (x) { return x.id === f.q; })[0];
    if (!q || !BAR[q.t]) return rows;
    return rows.filter(function (r) {
      var v = val(q, r.a);
      if (v === undefined) return false;
      return Array.isArray(v) ? v.indexOf(f.v) >= 0 : String(v) === String(f.v);
    });
  }

  function table(form, rows, words) {
    var qs = asked(form);
    rows = (Array.isArray(rows) ? rows : []).slice().sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
    var anyWait = rows.some(function (r) { return r.w; });
    var quiz = !!(Q && Q.on(form));
    var head = [words.time];
    if (anyWait) head.push(words.wait);
    if (quiz) head.push(words.score || "Score");
    qs.forEach(function (q) {
      if (q.t === "matrix") (q.rows || []).forEach(function (r) { head.push((q.label || "") + " – " + (r.label || "")); });
      else head.push(q.label || "");
    });
    var out = [head];
    rows.forEach(function (r) {
      var line = [iso(r.at)];
      if (anyWait) line.push(r.w ? words.yes : "");
      if (quiz) { var sc = Q.score(form, r.a); line.push(sc ? sc.pts : ""); }
      qs.forEach(function (q) {
        var v = val(q, r.a);
        var label = function (id) {
          if (id === E.OTHER) return words.other(otherText(q, r.a));
          var o = (q.opts || []).filter(function (x) { return x.id === id; })[0];
          return o ? o.label : "";
        };
        if (q.t === "matrix") {
          (q.rows || []).forEach(function (row) {
            var c = isObj(v) ? v[row.id] : undefined;
            line.push(c === undefined ? "" : (Array.isArray(c) ? c : [c]).map(label).filter(Boolean).join(", "));
          });
          return;
        }
        if (v === undefined) line.push("");
        else if (q.t === "yesno") line.push(v === "yes" ? words.yes : words.no);
        else if (q.t === "choice" || q.t === "select") line.push(label(v));
        else if (q.t === "multi") line.push(v.map(label).filter(Boolean).join(", "));
        else line.push(v);
      });
      out.push(line);
    });
    return out;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  // Local time, YYYY-MM-DD HH:MM (what a spreadsheet reads as a date).
  function iso(ms) {
    var d = new Date(ms || 0);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  // A cell a spreadsheet would run as a formula gets a leading ' (CSV
  // injection); cells with ; " or a line break are quoted.
  function cell(v) {
    var s = v == null ? "" : String(v);
    if (typeof v !== "number" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(tbl) {
    return "﻿" + (tbl || []).map(function (r) { return r.map(cell).join(";"); }).join("\r\n") + "\r\n";
  }

  var api = { summary: summary, quizAvg: quizAvg, filterable: filterable, filter: filter, table: table, csv: csv, cell: cell,
              LIST_MAX: LIST_MAX, BINS: BINS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosFormsResults = api;
})(typeof window !== "undefined" ? window : this);
