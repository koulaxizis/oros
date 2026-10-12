// ============================================================
// orOS Text Tools — core (v1.0.0)
// Pure logic, no DOM: the tools (lines, spaces, numbering, columns,
// find and replace), the pipeline that runs a chain of steps, the
// text statistics and the saved-recipe merge. Loaded by texttools.js
// (window.TextToolsCore), by worker.js (importScripts) and the tests.
//
// Data (sync slice "texttools", oros-texttools-data):
//   { ver: 1,
//     recipes: [{ id, m, name, steps: [{ tool, opts }] }] sorted by id,
//     tombs:   { id: deletedAt } }
// LWW per recipe by m (equal m: the larger canonical JSON), tombstones
// max-merged, delete wins ties, a newer edit resurrects (R5, R17, R26).
// The text itself is never part of the data.
// ============================================================
(function (root) {
  "use strict";

  var DATA_VER    = 1;
  var MAX_RECIPES = 100;
  var MAX_STEPS   = 30;
  var NAME_LEN    = 60;
  var STR_LEN     = 500;           // any text option (separators, find, prefix…)
  var MAX_TEXT    = 2000000;       // characters the app takes in
  var LIVE_MAX    = 200000;        // above this, the chain runs on "Apply"
  var ID_RE       = /^[a-z0-9]{6,40}$/;
  var TOOL_RE     = /^[a-z][a-z0-9]{1,23}$/;
  var KEY_RE      = /^[a-zA-Z][a-zA-Z0-9]{0,23}$/;

  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // ---------- Text helpers ----------
  // Lines: any line ending in, "\n" out. One final line break is kept
  // aside so per-line tools don't see an empty last line.
  function splitLines(text) {
    var s = String(text == null ? "" : text);
    var tail = /(\r\n|\r|\n)$/.test(s);
    if (tail) s = s.replace(/(\r\n|\r|\n)$/, "");
    return { ls: s === "" && !tail ? [] : s.split(/\r\n|\r|\n/), tail: tail };
  }
  function joinLines(L, ls) { return ls.join("\n") + (L.tail && ls.length ? "\n" : ""); }
  function perLine(text, fn) {
    var L = splitLines(text);
    return joinLines(L, L.ls.map(fn));
  }
  function isBlank(s) { return /^[\s ​  ﻿]*$/.test(s); }

  // "\t", "\n", "\\" typed into a separator field mean tab, line break, backslash.
  function unescapeSep(s) {
    return String(s == null ? "" : s).replace(/\\(t|n|\\)/g, function (m, c) {
      return c === "t" ? "\t" : (c === "n" ? "\n" : "\\");
    });
  }

  // Greek accents and diaeresis, folded for comparison only (never
  // written back: changing letters is the Case Converter's job).
  function foldAccents(s) {
    return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC");
  }
  function keyOf(s, o) {
    var k = o.trim ? String(s).trim() : String(s);
    if (o.iaccent) k = foldAccents(k);
    if (o.icase) k = k.toLocaleLowerCase("el").replace(/ς/g, "σ");
    return k;
  }

  // Characters as the eye sees them (emoji, accented letters count once).
  function graphemes(s) {
    s = String(s);
    try {
      if (typeof Intl !== "undefined" && Intl.Segmenter) {
        var n = 0, it = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s);
        for (var x of it) n++;        // eslint-disable-line no-unused-vars
        return n;
      }
    } catch (e) {}
    return Array.from(s).length;
  }

  function collator(o, numeric) {
    var sens = o.icase ? (o.iaccent ? "base" : "accent") : (o.iaccent ? "case" : "variant");
    try { return new Intl.Collator(["el", "en"], { sensitivity: sens, numeric: !!numeric }); }
    catch (e) { return { compare: function (a, b) { return cmpStr(keyOf(a, o), keyOf(b, o)); } }; }
  }

  // Uniform integer in [0, n) — crypto when there is one, no modulo bias.
  function randInt(n, rand) {
    if (rand) return Math.floor(rand() * n) % n;
    var c = (typeof crypto !== "undefined" && crypto.getRandomValues) ? crypto : null;
    if (!c) return Math.floor(Math.random() * n);
    var lim = Math.floor(4294967296 / n) * n, r = new Uint32Array(1);
    do { c.getRandomValues(r); } while (r[0] >= lim);
    return r[0] % n;
  }

  // ---------- Delimited text (CSV and friends) ----------
  var DELIMS = { comma: ",", semi: ";", tab: "\t", pipe: "|" };
  function delimOf(id, custom) {
    if (has(DELIMS, id)) return DELIMS[id];
    if (id === "custom") return unescapeSep(custom) || ",";
    return null;
  }

  // Guess the separator from the first 20 lines: the candidate that
  // appears the same number of times (≥ 1) on most lines.
  function detectDelim(text) {
    var ls = splitLines(text).ls.filter(function (l) { return !isBlank(l); }).slice(0, 20);
    var best = ",", bestScore = -1;
    [",", ";", "\t", "|"].forEach(function (d) {
      var counts = ls.map(function (l) { return countOutsideQuotes(l, d); });
      if (!counts.length || !counts[0]) return;
      var same = counts.filter(function (c) { return c === counts[0]; }).length;
      var score = same * 1000 + counts[0];
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }
  function countOutsideQuotes(line, d) {
    var n = 0, q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (c === '"') q = !q;
      else if (!q && line.substr(i, d.length) === d) { n++; i += d.length - 1; }
    }
    return n;
  }

  // RFC 4180 reader: quoted fields may hold separators, "" and line breaks.
  function parseDelimited(text, d) {
    var s = String(text).replace(/\r\n|\r/g, "\n").replace(/\n$/, "");
    var rows = [], row = [], f = "", i = 0, q = false, quoted = false;
    if (s === "") return rows;
    while (i < s.length) {
      var c = s.charAt(i);
      if (q) {
        if (c === '"') {
          if (s.charAt(i + 1) === '"') { f += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        f += c; i++; continue;
      }
      if (c === '"' && !quoted && f === "") { q = true; quoted = true; i++; continue; }
      if (s.substr(i, d.length) === d) { row.push(f); f = ""; quoted = false; i += d.length; continue; }
      if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; quoted = false; i++; continue; }
      f += c; i++;
    }
    row.push(f);
    rows.push(row);
    return rows;
  }
  function needsQuote(f, d) {
    return f.indexOf(d) >= 0 || f.indexOf('"') >= 0 || /[\r\n]/.test(f);
  }
  function writeDelimited(rows, d, quoteAll) {
    return rows.map(function (r) {
      return r.map(function (f) {
        f = String(f == null ? "" : f);
        return quoteAll || needsQuote(f, d) ? '"' + f.replace(/"/g, '""') + '"' : f;
      }).join(d);
    }).join("\n");
  }
  function tableIn(text, o) {
    var d = o.delim === "auto" || !o.delim ? detectDelim(text) : delimOf(o.delim, o.custom);
    return { d: d, rows: parseDelimited(text, d) };
  }

  // "1,3,2" or "2-4" → 0-based column indexes, in that order.
  function colSpec(spec) {
    var out = [];
    String(spec || "").split(/[,;\s]+/).forEach(function (p) {
      var m = /^(\d{1,3})(?:-(\d{1,3}))?$/.exec(p);
      if (!m) return;
      var a = +m[1], b = m[2] ? +m[2] : a, step = a <= b ? 1 : -1;
      for (var k = a; out.length < 256; k += step) { if (k >= 1) out.push(k - 1); if (k === b) break; }
    });
    return out;
  }

  // ---------- Find helpers ----------
  var GREEK_VARIANTS = {
    "α": "αά", "ε": "εέ", "η": "ηή", "ι": "ιίϊΐ", "ο": "οό", "υ": "υύϋΰ", "ω": "ωώ",
    "Α": "ΑΆ", "Ε": "ΕΈ", "Η": "ΗΉ", "Ι": "ΙΊΪ", "Ο": "ΟΌ", "Υ": "ΥΎΫ", "Ω": "ΩΏ"
  };
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&"); }
  var WORDCH = "0-9A-Za-z_\\u00C0-\\u024F\\u0370-\\u03FF\\u1F00-\\u1FFF\\u0400-\\u04FF";

  // Build the search pattern. Returns { re } or { err }.
  function buildFind(o, extraFlags) {
    var src = String(o.find || "");
    if (!src) return { err: "empty" };
    if (src.length > STR_LEN) return { err: "long" };
    var flags = "g" + (o.icase ? "i" : "") + (extraFlags || "");
    if (!o.regex) {
      var folded = o.iaccent ? foldAccents(src) : src;
      src = Array.from(folded).map(function (ch) {
        if (!o.iaccent) return escRe(ch);
        var lo = ch.toLowerCase(), up = ch.toUpperCase();
        var set = (GREEK_VARIANTS[lo] || "") + (GREEK_VARIANTS[up] || "");
        return set ? "[" + set + "]" : escRe(ch);
      }).join("");
    }
    if (o.word) src = "(?<![" + WORDCH + "])(?:" + src + ")(?![" + WORDCH + "])";
    var re = null;
    try { re = new RegExp(src, flags + "u"); }
    catch (e) {
      try { re = new RegExp(src, flags); } catch (e2) { return { err: "pattern" }; }
    }
    return { re: re };
  }

  // ---------- The tools ----------
  // Each tool: group, option defaults (+ field kinds for the UI), run.
  // f: "sel" (choices), "chk", "txt", "num" ([min, max]). `when` hides
  // a field unless another option has one of the given values.
  var DELIM_CHOICES = ["comma", "semi", "tab", "pipe", "custom"];
  var TOOLS = {
    // Lines
    sort: { g: "lines", o: { by: "az", icase: true, iaccent: true, emptyLast: true },
            f: { by: ["sel", ["az", "za", "natural", "num", "len", "random"]], icase: ["chk"], iaccent: ["chk"], emptyLast: ["chk"] } },
    reverse: { g: "lines", o: {}, f: {} },
    dedupe: { g: "lines", o: { keep: "first", icase: false, iaccent: false, trim: true, empty: false },
              f: { keep: ["sel", ["first", "last"]], icase: ["chk"], iaccent: ["chk"], trim: ["chk"], empty: ["chk"] } },
    dupes: { g: "lines", o: { icase: false, iaccent: false, trim: true }, f: { icase: ["chk"], iaccent: ["chk"], trim: ["chk"] } },
    count: { g: "lines", o: { icase: false, iaccent: false, trim: true, order: "count" },
             f: { order: ["sel", ["count", "first", "az"]], icase: ["chk"], iaccent: ["chk"], trim: ["chk"] } },
    noempty: { g: "lines", o: {}, f: {} },
    squeeze: { g: "lines", o: {}, f: {} },
    filter: { g: "lines", o: { mode: "keep", where: "contains", find: "", icase: true },
              f: { mode: ["sel", ["keep", "drop"]], where: ["sel", ["contains", "starts", "ends", "regex"]], find: ["txt"], icase: ["chk"] } },
    join: { g: "lines", o: { sep: ", ", skipEmpty: true }, f: { sep: ["txt"], skipEmpty: ["chk"] } },
    split: { g: "lines", o: { sep: ",", trim: true, skipEmpty: true }, f: { sep: ["txt"], trim: ["chk"], skipEmpty: ["chk"] } },
    // Spaces and clean-up
    trim: { g: "space", o: { side: "both" }, f: { side: ["sel", ["both", "start", "end"]] } },
    spaces: { g: "space", o: { indent: true }, f: { indent: ["chk"] } },
    tabs: { g: "space", o: { dir: "t2s", width: 4 }, f: { dir: ["sel", ["t2s", "s2t"]], width: ["num", [1, 16]] } },
    unwrap: { g: "space", o: {}, f: {} },
    wrap: { g: "space", o: { width: 72 }, f: { width: ["num", [10, 500]] } },
    clean: { g: "space", o: { invisible: true, nbsp: true, quotes: false, dashes: false },
             f: { invisible: ["chk"], nbsp: ["chk"], quotes: ["chk"], dashes: ["chk"] } },
    eol: { g: "space", o: { to: "lf" }, f: { to: ["sel", ["lf", "crlf"]] } },
    // Numbering and prefixes
    number: { g: "num", o: { start: 1, step: 1, pad: 0, style: "dot", skipEmpty: true },
              f: { style: ["sel", ["dot", "paren", "dash", "bracket", "tab", "space"]], start: ["num", [-999999, 999999]],
                   step: ["num", [-1000, 1000]], pad: ["num", [0, 8]], skipEmpty: ["chk"] } },
    unnumber: { g: "num", o: {}, f: {} },
    affix: { g: "num", o: { prefix: "", suffix: "", skipEmpty: true }, f: { prefix: ["txt"], suffix: ["txt"], skipEmpty: ["chk"] } },
    // Columns and separators
    convert: { g: "cols", o: { delim: "auto", custom: "", to: "semi", toCustom: "", quoteAll: false },
               f: { delim: ["sel", ["auto"].concat(DELIM_CHOICES)], custom: ["txt", null, { delim: ["custom"] }],
                    to: ["sel", DELIM_CHOICES], toCustom: ["txt", null, { to: ["custom"] }], quoteAll: ["chk"] } },
    columns: { g: "cols", o: { delim: "auto", custom: "", mode: "keep", cols: "1" },
               f: { mode: ["sel", ["keep", "drop"]], cols: ["txt"], delim: ["sel", ["auto"].concat(DELIM_CHOICES)],
                    custom: ["txt", null, { delim: ["custom"] }] } },
    transpose: { g: "cols", o: { delim: "auto", custom: "" },
                 f: { delim: ["sel", ["auto"].concat(DELIM_CHOICES)], custom: ["txt", null, { delim: ["custom"] }] } },
    markdown: { g: "cols", o: { delim: "auto", custom: "", header: true },
                f: { delim: ["sel", ["auto"].concat(DELIM_CHOICES)], custom: ["txt", null, { delim: ["custom"] }], header: ["chk"] } },
    json: { g: "cols", o: { delim: "auto", custom: "", header: true },
            f: { delim: ["sel", ["auto"].concat(DELIM_CHOICES)], custom: ["txt", null, { delim: ["custom"] }], header: ["chk"] } },
    // Find and replace
    replace: { g: "find", o: { find: "", repl: "", regex: false, icase: false, word: false, iaccent: false },
               f: { find: ["txt"], repl: ["txt"], icase: ["chk"], iaccent: ["chk", null, { regex: [false] }], word: ["chk"], regex: ["chk"] } }
  };
  var GROUPS = ["lines", "space", "num", "cols", "find"];
  var TOOL_IDS = Object.keys(TOOLS);
  function toolsOf(g) { return TOOL_IDS.filter(function (id) { return TOOLS[id].g === g; }); }

  // Options of a step with the tool's defaults filled in and bad
  // values replaced; unknown keys are ignored for the run.
  function optsFor(tool, opts) {
    var T = TOOLS[tool], o = {}, src = opts && typeof opts === "object" ? opts : {};
    if (!T) return null;
    Object.keys(T.o).forEach(function (k) {
      var def = T.o[k], v = has(src, k) ? src[k] : def, fd = T.f[k];
      if (typeof def === "boolean") o[k] = typeof v === "boolean" ? v : def;
      else if (typeof def === "number") {
        var lim = fd && fd[1] || [-1e9, 1e9];
        o[k] = typeof v === "number" && isFinite(v) ? Math.max(lim[0], Math.min(lim[1], Math.round(v))) : def;
      } else if (fd && fd[0] === "sel") o[k] = fd[1].indexOf(v) >= 0 ? v : def;
      else o[k] = typeof v === "string" ? v.slice(0, STR_LEN) : def;
    });
    return o;
  }

  // Each runner: (text, o, ctx) → { text, n?, err? }. n = how many
  // things changed / were found, shown under the result.
  var RUN = {
    sort: function (text, o, ctx) {
      var L = splitLines(text), ls = L.ls.slice();
      var empties = o.emptyLast ? ls.filter(isBlank) : [];
      if (o.emptyLast) ls = ls.filter(function (l) { return !isBlank(l); });
      if (o.by === "random") {
        for (var i = ls.length - 1; i > 0; i--) { var j = randInt(i + 1, ctx.rand), x = ls[i]; ls[i] = ls[j]; ls[j] = x; }
      } else if (o.by === "len") {
        ls = ls.map(function (l, i) { return { l: l, i: i, n: graphemes(l) }; })
               .sort(function (a, b) { return a.n - b.n || a.i - b.i; }).map(function (x) { return x.l; });
      } else if (o.by === "num") {
        var num = function (l) {
          var m = /[-−]?\d+(?:[.,]\d+)?/.exec(l);
          return m ? parseFloat(m[0].replace("−", "-").replace(",", ".")) : null;
        };
        var col = collator(o, true);
        ls = ls.map(function (l, i) { return { l: l, i: i, v: num(l) }; }).sort(function (a, b) {
          if (a.v === null || b.v === null) return (a.v === null) - (b.v === null) || col.compare(a.l, b.l) || a.i - b.i;
          return a.v - b.v || col.compare(a.l, b.l) || a.i - b.i;
        }).map(function (x) { return x.l; });
      } else {
        var c = collator(o, o.by === "natural");
        ls = ls.map(function (l, i) { return { l: l, i: i }; }).sort(function (a, b) {
          return c.compare(a.l, b.l) || cmpStr(a.l, b.l) || a.i - b.i;
        }).map(function (x) { return x.l; });
        if (o.by === "za") ls.reverse();
      }
      return { text: joinLines(L, ls.concat(empties)) };
    },
    reverse: function (text) {
      var L = splitLines(text);
      return { text: joinLines(L, L.ls.slice().reverse()) };
    },
    dedupe: function (text, o) {
      var L = splitLines(text), seen = {}, out = [], ls = L.ls;
      var order = o.keep === "last" ? ls.slice().reverse() : ls;
      order.forEach(function (l) {
        if (isBlank(l) && !o.empty) { out.push(l); return; }
        var k = "\u0001" + keyOf(l, o);
        if (seen[k]) return;
        seen[k] = 1;
        out.push(l);
      });
      if (o.keep === "last") out.reverse();
      return { text: joinLines(L, out), n: ls.length - out.length };
    },
    dupes: function (text, o) {
      var L = splitLines(text), cnt = {}, first = {}, out = [];
      L.ls.forEach(function (l) {
        if (isBlank(l)) return;
        var k = "\u0001" + keyOf(l, o);
        cnt[k] = (cnt[k] || 0) + 1;
        if (!has(first, k)) first[k] = l;
      });
      Object.keys(first).forEach(function (k) { if (cnt[k] > 1) out.push(first[k]); });
      return { text: joinLines(L, out), n: out.length };
    },
    count: function (text, o) {
      var L = splitLines(text), cnt = {}, first = {}, keys = [];
      L.ls.forEach(function (l) {
        if (isBlank(l)) return;
        var k = "\u0001" + keyOf(l, o);
        if (!has(cnt, k)) { cnt[k] = 0; first[k] = o.trim ? l.trim() : l; keys.push(k); }
        cnt[k]++;
      });
      var c = collator({ icase: true, iaccent: true }, true);
      var idx = {};
      keys.forEach(function (k, i) { idx[k] = i; });
      if (o.order === "count") keys.sort(function (a, b) { return cnt[b] - cnt[a] || idx[a] - idx[b]; });
      else if (o.order === "az") keys.sort(function (a, b) { return c.compare(first[a], first[b]) || idx[a] - idx[b]; });
      return { text: joinLines(L, keys.map(function (k) { return cnt[k] + "\t" + first[k]; })), n: keys.length };
    },
    noempty: function (text) {
      var L = splitLines(text), out = L.ls.filter(function (l) { return !isBlank(l); });
      return { text: joinLines(L, out), n: L.ls.length - out.length };
    },
    squeeze: function (text) {
      var L = splitLines(text), out = [];
      L.ls.forEach(function (l) {
        var b = isBlank(l);
        if (b && out.length && isBlank(out[out.length - 1])) return;
        out.push(b ? "" : l);
      });
      return { text: joinLines(L, out), n: L.ls.length - out.length };
    },
    filter: function (text, o) {
      var L = splitLines(text), test;
      if (!o.find) return { text: text };
      if (o.where === "regex") {
        var b = buildFind({ find: o.find, regex: true, icase: o.icase });
        if (b.err) return { text: text, err: b.err };
        var re = new RegExp(b.re.source, b.re.flags.replace("g", ""));
        test = function (l) { return re.test(l); };
      } else {
        var f = o.icase ? o.find.toLocaleLowerCase("el") : o.find;
        test = function (l) {
          var s = o.icase ? l.toLocaleLowerCase("el") : l;
          if (o.where === "starts") return s.slice(0, f.length) === f;
          if (o.where === "ends") return f.length <= s.length && s.slice(s.length - f.length) === f;
          return s.indexOf(f) >= 0;
        };
      }
      var out = L.ls.filter(function (l) { return o.mode === "drop" ? !test(l) : test(l); });
      return { text: joinLines(L, out), n: out.length };
    },
    join: function (text, o) {
      var ls = splitLines(text).ls;
      if (o.skipEmpty) ls = ls.filter(function (l) { return !isBlank(l); });
      return { text: ls.join(unescapeSep(o.sep)), n: ls.length };
    },
    split: function (text, o) {
      var sep = unescapeSep(o.sep);
      if (!sep) return { text: text };
      var parts = String(text).replace(/\r\n|\r/g, "\n").split(sep);
      if (o.trim) parts = parts.map(function (p) { return p.trim(); });
      if (o.skipEmpty) parts = parts.filter(function (p) { return p !== ""; });
      return { text: parts.join("\n"), n: parts.length };
    },
    trim: function (text, o) {
      return { text: perLine(text, function (l) {
        return o.side === "start" ? l.replace(/^\s+/, "") : (o.side === "end" ? l.replace(/\s+$/, "") : l.trim());
      }) };
    },
    spaces: function (text, o) {
      return { text: perLine(text, function (l) {
        var lead = "";
        if (o.indent) { lead = /^[ \t]*/.exec(l)[0]; l = l.slice(lead.length); }
        return lead + l.replace(/[ \t ]{2,}/g, " ");
      }) };
    },
    tabs: function (text, o) {
      var w = o.width;
      if (o.dir === "s2t") {
        return { text: perLine(text, function (l) {
          var lead = /^ */.exec(l)[0].length, tabs = Math.floor(lead / w);
          return new Array(tabs + 1).join("\t") + l.slice(tabs * w);
        }) };
      }
      return { text: perLine(text, function (l) {
        var out = "", col = 0;
        Array.from(l).forEach(function (ch) {
          if (ch === "\t") { var n = w - (col % w); out += new Array(n + 1).join(" "); col += n; }
          else { out += ch; col++; }
        });
        return out;
      }) };
    },
    unwrap: function (text) {
      var L = splitLines(text), out = [], cur = null;
      L.ls.forEach(function (l) {
        if (isBlank(l)) { if (cur !== null) out.push(cur); cur = null; out.push(""); return; }
        cur = cur === null ? l.trim() : cur + " " + l.trim();
      });
      if (cur !== null) out.push(cur);
      return { text: joinLines(L, out) };
    },
    wrap: function (text, o) {
      var L = splitLines(text), out = [];
      L.ls.forEach(function (l) {
        if (graphemes(l) <= o.width) { out.push(l); return; }
        var lead = /^\s*/.exec(l)[0], words = l.slice(lead.length).split(/[ \t]+/), cur = lead;
        words.forEach(function (w) {
          if (cur.trim() === "") cur = lead + w;
          else if (graphemes(cur) + 1 + graphemes(w) <= o.width) cur += " " + w;
          else { out.push(cur); cur = lead + w; }
        });
        out.push(cur);
      });
      return { text: joinLines(L, out) };
    },
    clean: function (text, o) {
      var s = String(text), before = s;
      if (o.invisible) s = s.replace(/[​-‍⁠﻿­‎‏‪-‮⁦-⁩]/g, "")
                            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
      if (o.nbsp) s = s.replace(/[    -  - 　]/g, " ");
      if (o.quotes) s = s.replace(/[‘’‚‛′]/g, "'").replace(/[“”„‟″«»]/g, '"');
      if (o.dashes) s = s.replace(/[‒–—―−]/g, "-").replace(/…/g, "...");
      s = s.normalize("NFC");
      return { text: s, n: before === s ? 0 : null };
    },
    eol: function (text, o) {
      var s = String(text).replace(/\r\n|\r/g, "\n");
      return { text: o.to === "crlf" ? s.replace(/\n/g, "\r\n") : s };
    },
    number: function (text, o) {
      var L = splitLines(text), k = 0;
      var fmt = function (n) {
        var neg = n < 0, s = String(Math.abs(n));
        while (s.length < o.pad) s = "0" + s;
        s = (neg ? "-" : "") + s;
        switch (o.style) {
          case "paren": return s + ") ";
          case "dash": return s + " - ";
          case "bracket": return "(" + s + ") ";
          case "tab": return s + "\t";
          case "space": return s + " ";
          default: return s + ". ";
        }
      };
      return { text: joinLines(L, L.ls.map(function (l) {
        if (o.skipEmpty && isBlank(l)) return l;
        return fmt(o.start + o.step * (k++)) + l;
      })), n: k };
    },
    unnumber: function (text) {
      var n = 0;
      var re = /^(\s*)(?:\(?\d{1,9}[.)\]:]|\d{1,9}\s*[-–—]|\d{1,9}\t|[-*•·–—▪◦‣>]|\[[ xX]\])[ \t]+/;
      return { text: perLine(text, function (l) {
        var m = re.exec(l);
        if (!m) return l;
        n++;
        return m[1] + l.slice(m[0].length);
      }), n: n };
    },
    affix: function (text, o) {
      var p = unescapeSep(o.prefix), s = unescapeSep(o.suffix);
      return { text: perLine(text, function (l) { return o.skipEmpty && isBlank(l) ? l : p + l + s; }) };
    },
    convert: function (text, o) {
      var T = tableIn(text, o), to = delimOf(o.to, o.toCustom);
      return { text: writeDelimited(T.rows, to, o.quoteAll) + (/\n$/.test(text) ? "\n" : ""), n: T.rows.length, d: T.d };
    },
    columns: function (text, o) {
      var T = tableIn(text, o), idx = colSpec(o.cols);
      if (!idx.length) return { text: text, err: "cols" };
      var rows = T.rows.map(function (r) {
        if (o.mode === "drop") return r.filter(function (f, i) { return idx.indexOf(i) < 0; });
        return idx.map(function (i) { return i < r.length ? r[i] : ""; });
      });
      return { text: writeDelimited(rows, T.d, false) + (/\n$/.test(text) ? "\n" : ""), n: rows.length, d: T.d };
    },
    transpose: function (text, o) {
      var T = tableIn(text, o), w = 0;
      T.rows.forEach(function (r) { w = Math.max(w, r.length); });
      var rows = [];
      for (var c = 0; c < w && c < 10000; c++) rows.push(T.rows.map(function (r) { return c < r.length ? r[c] : ""; }));
      return { text: writeDelimited(rows, T.d, false) + (/\n$/.test(text) ? "\n" : ""), n: rows.length, d: T.d };
    },
    markdown: function (text, o) {
      var T = tableIn(text, o), w = 0;
      if (!T.rows.length) return { text: "" };
      T.rows.forEach(function (r) { w = Math.max(w, r.length); });
      var cell = function (f) { return String(f).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim(); };
      var line = function (r) {
        var cs = [];
        for (var i = 0; i < w; i++) cs.push(cell(i < r.length ? r[i] : ""));
        return "| " + cs.join(" | ") + " |";
      };
      var rows = T.rows.slice(), head = o.header ? rows.shift() : [];
      var out = [line(head), "|" + new Array(w + 1).join(" --- |")];
      rows.forEach(function (r) { out.push(line(r)); });
      return { text: out.join("\n") + "\n", n: rows.length, d: T.d };
    },
    json: function (text, o) {
      var T = tableIn(text, o), rows = T.rows.slice(), val;
      if (o.header && rows.length) {
        var head = rows.shift().map(function (h, i) { return String(h).trim() || "column" + (i + 1); });
        var uniq = {};
        head = head.map(function (h) {
          var k = h, n = 2;
          while (has(uniq, k)) k = h + "_" + (n++);
          uniq[k] = 1;
          return k;
        });
        val = rows.map(function (r) {
          var obj = {};
          head.forEach(function (h, i) { obj[h] = i < r.length ? r[i] : ""; });
          return obj;
        });
      } else val = rows;
      return { text: JSON.stringify(val, null, 2) + "\n", n: val.length, d: T.d };
    },
    replace: function (text, o) {
      if (!o.find) return { text: text };
      var b = buildFind(o);
      if (b.err) return { text: text, err: b.err };
      var n = 0, repl = o.regex ? unescapeSep(o.repl) : o.repl;
      var out = String(text).replace(b.re, function () {
        n++;
        if (!o.regex) return repl;
        var args = arguments, groups = args[args.length - 1];
        var hasGroups = typeof groups === "object" && groups !== null;
        var subs = Array.prototype.slice.call(args, 1, args.length - (hasGroups ? 3 : 2));
        return repl.replace(/\$(\$|&|\d{1,2}|<([^>]*)>)/g, function (m, c, name) {
          if (c === "$") return "$";
          if (c === "&") return args[0];
          if (name !== undefined) return hasGroups && groups[name] != null ? groups[name] : "";
          var k = +c;
          return k >= 1 && k <= subs.length ? (subs[k - 1] == null ? "" : subs[k - 1]) : m;
        });
      });
      return { text: out, n: n };
    }
  };

  // Steps that can hang on a pattern (they run in the worker with a time limit).
  function usesPattern(step) {
    if (!step || !step.opts) return false;
    if (step.tool === "replace") return !!step.opts.regex;
    if (step.tool === "filter") return step.opts.where === "regex";
    return false;
  }

  // Run a chain. ctx = { rand? }. Returns { text, notes: [{ tool, n, err }] }.
  function run(text, steps, ctx) {
    var s = String(text == null ? "" : text);
    if (s.length > MAX_TEXT) s = s.slice(0, MAX_TEXT);
    var notes = [];
    (steps || []).forEach(function (st) {
      var o = st && optsFor(st.tool, st.opts);
      if (!o) { notes.push({ tool: st && st.tool, err: "unknown" }); return; }
      var r;
      try { r = RUN[st.tool](s, o, ctx || {}); }
      catch (e) { r = { text: s, err: "failed" }; }
      s = r.text;
      notes.push({ tool: st.tool, n: r.n === undefined ? null : r.n, err: r.err || null, d: r.d || null });
    });
    return { text: s, notes: notes };
  }

  // ---------- Statistics ----------
  function stats(text) {
    var s = String(text || ""), big = s.length > LIVE_MAX;
    var words = 0, sentences = 0, seg = null;
    try { seg = !big && typeof Intl !== "undefined" && Intl.Segmenter ? Intl.Segmenter : null; } catch (e) { seg = null; }
    if (seg) {
      for (var w of new seg(undefined, { granularity: "word" }).segment(s)) if (w.isWordLike) words++;
      for (var x of new seg(undefined, { granularity: "sentence" }).segment(s)) if (/[\p{L}\p{N}]/u.test(x.segment)) sentences++;
    } else {
      words = (s.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) || []).length;
      sentences = (s.match(/[^.!?;…]*[\p{L}\p{N}][^.!?;…]*(?:[.!?;…]+|$)/gu) || []).length;
    }
    var L = splitLines(s);
    var paras = s.replace(/\r\n|\r/g, "\n").split(/\n[ \t ]*\n/).filter(function (p) { return !isBlank(p); }).length;
    var chars = big ? Array.from(s).length : graphemes(s);
    var noSpace = big ? Array.from(s.replace(/\s+/g, "")).length : graphemes(s.replace(/\s+/g, ""));
    return {
      chars: chars, noSpace: noSpace, words: words, lines: L.ls.length,
      paras: paras, sentences: sentences, minutes: words ? Math.max(1, Math.round(words / 200)) : 0,
      exact: !big
    };
  }

  // Most used words (3+ letters), case and accents ignored.
  function topWords(text, n) {
    var cnt = {}, shown = {}, order = [];
    (String(text || "").match(/[\p{L}][\p{L}\p{M}'’]{2,}/gu) || []).forEach(function (w) {
      var k = foldAccents(w.toLocaleLowerCase("el")).replace(/ς/g, "σ");
      if (!has(cnt, k)) { cnt[k] = 0; shown[k] = w.toLocaleLowerCase("el"); order.push(k); }
      cnt[k]++;
    });
    return order.sort(function (a, b) { return cnt[b] - cnt[a] || cmpStr(a, b); })
                .slice(0, n || 10).map(function (k) { return { w: shown[k], n: cnt[k] }; });
  }

  // ---------- Recipes ----------
  function normName(s) {
    return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, NAME_LEN) : "";
  }
  // A step keeps every option that is a plain value (unknown ones too:
  // a newer version's options survive a round trip through this one).
  function normStep(x) {
    if (!x || typeof x !== "object" || typeof x.tool !== "string" || !TOOL_RE.test(x.tool)) return null;
    var o = {}, src = x.opts && typeof x.opts === "object" && !Array.isArray(x.opts) ? x.opts : {};
    Object.keys(src).sort(cmpStr).slice(0, 24).forEach(function (k) {
      if (!KEY_RE.test(k)) return;
      var v = src[k];
      if (typeof v === "boolean" || (typeof v === "number" && isFinite(v))) o[k] = v;
      else if (typeof v === "string") o[k] = v.slice(0, STR_LEN);
    });
    return { tool: x.tool, opts: o };
  }
  function normSteps(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (s) {
      var x = normStep(s);
      if (x && out.length < MAX_STEPS) out.push(x);
    });
    return out;
  }
  function normRecipe(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !isInt(x.m) || x.m < 0) return null;
    var name = normName(x.name), steps = normSteps(x.steps);
    if (!name || !steps.length) return null;
    return { id: x.id, m: x.m, name: name, steps: steps };
  }
  function emptyData() { return { ver: DATA_VER, recipes: [], tombs: {} }; }

  function mergeRecipes(A, B) {
    var a = A || {}, b = B || {}, tombs = {}, best = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object" || Array.isArray(tm)) return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (!has(tombs, id) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    [a.recipes, b.recipes].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var x = normRecipe(raw);
        if (!x) return;
        var cur = best[x.id];
        if (!cur || x.m > cur.m || (x.m === cur.m && JSON.stringify(x) > JSON.stringify(cur))) best[x.id] = x;
      });
    });
    var recipes = [];
    Object.keys(best).sort(cmpStr).forEach(function (id) {
      if (has(tombs, id) && tombs[id] >= best[id].m) return;
      recipes.push(best[id]);
    });
    var st = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { st[id] = tombs[id]; });
    return { ver: DATA_VER, recipes: recipes, tombs: st };
  }

  // A recipes file (export of this app). Returns { ok, recipes } or { ok:false, err }.
  function parseRecipesFile(s) {
    var j;
    try { j = JSON.parse(String(s).replace(/^﻿/, "")); } catch (e) { return { ok: false, err: "json" }; }
    if (!j || typeof j !== "object" || j.app !== "texttools" || !Array.isArray(j.recipes)) return { ok: false, err: "kind" };
    var out = [];
    j.recipes.forEach(function (r) {
      if (!r || typeof r !== "object") return;
      var name = normName(r.name), steps = normSteps(r.steps).filter(function (st) { return has(TOOLS, st.tool); });
      if (name && steps.length && out.length < MAX_RECIPES) out.push({ name: name, steps: steps });
    });
    return out.length ? { ok: true, recipes: out } : { ok: false, err: "empty" };
  }
  function recipesFile(data, exportedAt) {
    return JSON.stringify({
      app: "texttools", ver: 1, exported: exportedAt || "",
      recipes: (data && data.recipes || []).map(function (r) { return { name: r.name, steps: r.steps }; })
    }, null, 2) + "\n";
  }

  // ---------- Hand-over helpers (other apps) ----------
  // Spreadsheet (BR-S1): rows of a table, numbers as numbers, capped.
  function sheetRows(text, maxRows, maxCols) {
    var d = detectDelim(text), rows = parseDelimited(text, d);
    var cut = rows.length > maxRows || rows.some(function (r) { return r.length > maxCols; });
    rows = rows.slice(0, maxRows).map(function (r) {
      return r.slice(0, maxCols).map(function (f) {
        var t = f.trim();
        return /^-?\d{1,15}(\.\d{1,10})?$/.test(t) ? Number(t) : f;
      });
    });
    return { rows: rows, cut: cut };
  }
  // To-Do (BR-TD-ADD): one item per non-empty line.
  function todoItems(text, max) {
    var out = [], seen = {};
    splitLines(text).ls.forEach(function (l) {
      var s = l.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
      if (!s || seen["\u0001" + s] || out.length >= max) return;
      seen["\u0001" + s] = 1;
      out.push({ text: s });
    });
    return out;
  }

  // Which file type fits the result of a chain (for Save).
  function outKind(steps) {
    var last = null;
    (steps || []).forEach(function (s) { if (s && TOOLS[s.tool]) last = s; });
    if (!last) return "txt";
    var o = optsFor(last.tool, last.opts);
    if (last.tool === "markdown") return "md";
    if (last.tool === "json") return "json";
    if (last.tool === "convert") return o.to === "tab" ? "tsv" : (o.to === "custom" ? "txt" : "csv");
    return "txt";
  }

  var api = {
    DATA_VER: DATA_VER, MAX_RECIPES: MAX_RECIPES, MAX_STEPS: MAX_STEPS, NAME_LEN: NAME_LEN, STR_LEN: STR_LEN,
    MAX_TEXT: MAX_TEXT, LIVE_MAX: LIVE_MAX, ID_RE: ID_RE,
    TOOLS: TOOLS, TOOL_IDS: TOOL_IDS, GROUPS: GROUPS, toolsOf: toolsOf, optsFor: optsFor,
    run: run, usesPattern: usesPattern, stats: stats, topWords: topWords, graphemes: graphemes,
    splitLines: splitLines, detectDelim: detectDelim, parseDelimited: parseDelimited,
    writeDelimited: writeDelimited, colSpec: colSpec, foldAccents: foldAccents, unescapeSep: unescapeSep,
    normName: normName, normStep: normStep, normSteps: normSteps, normRecipe: normRecipe,
    emptyData: emptyData, mergeRecipes: mergeRecipes, parseRecipesFile: parseRecipesFile, recipesFile: recipesFile,
    sheetRows: sheetRows, todoItems: todoItems, outKind: outKind
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TextToolsCore = api;
})(typeof self !== "undefined" ? self : this);
