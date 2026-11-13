// ============================================================
// orOS Lyric Sync — chords (Songbook S1; pure, no DOM)
// Loaded by index.html after core.js, and by Node in the tests.
//   norm(token)            → a chord name ("Am", "F#7/C#") or "" (also
//                            reads Greek names: Λα- → Am, Ρε7 → D7)
//   transpose(chord, n, flats) · keyAfter(key, n) · flatsFor(key, chords)
//   transposeSong(p, n)    → { key, ln, xo } with every chord moved
//   parseSheet(text, opts) → { meta, lines: [{ t, p, c?, k?, x? }], xo }
//                            reads ChordPro ([Am] inline, {directives})
//                            and chords written over the words
//   toChordPro(p, opts)    · toChordsText(p, opts) · toEditor(p, lang)
//   cells(line)            → [{ a, b, ch }] for drawing chords over words
//   show(chord, solfege)   → "Am" or "Λαm" (display only; data stays C D E)
//   suggest(p)             → chords for the picker (the song's, then the key's)
// Chords are data only: nothing here is ever run or put into markup.
// i18n-inline-ok: the Greek here is parser data (Ντο Ρε Μι chord names,
// the [Κουπλέ] [Ρεφρέν] [Γέφυρα] section words the editor reads and
// writes); the words a person reads come from app.js through opts.
// ============================================================
(function (root) {
  "use strict";

  var C = typeof module !== "undefined" && module.exports ? require("./core.js") : root.LyricsyncCore;

  var SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  var PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  // The usual spelling of each key (major, minor), by pitch class.
  var MAJ = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  var MIN = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"];
  var FLAT_KEYS = { F: 1, Bb: 1, Eb: 1, Ab: 1, Db: 1, Gb: 1, Cb: 1, Dm: 1, Gm: 1, Cm: 1, Fm: 1, Bbm: 1, Ebm: 1, Abm: 1 };

  // ---------- Names ----------
  var SOL = { "ντο": "C", "ρε": "D", "μι": "E", "φα": "F", "σολ": "G", "λα": "A", "σι": "B" };
  var SOL_OUT = { C: "Ντο", D: "Ρε", E: "Μι", F: "Φα", G: "Σολ", A: "Λα", B: "Σι" };
  function fold(s) { return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
  // A token as written on a chord sheet → our chord name, or "".
  function norm(tok) {
    var s = String(tok || "").trim().replace(/\u266f/g, "#").replace(/\u266d/g, "b");
    if (!s || s.length > 20) return "";
    if (/^n\.?c\.?$/i.test(s)) return "N.C.";
    if (C.isChord(s)) return s;
    // Greek names, always with a capital first letter (so "λα λα λα"
    // sung is never read as chords): Λα, Λα-, Λαm, Σολ#7, Ρε/Φα#.
    var m = /^([\u0391-\u03a9][\u03b1-\u03c9\u0300-\u036f]{1,5})([#b]?)([^/]*)(?:\/([\u0391-\u03a9][\u03b1-\u03c9\u0300-\u036f]{1,5})([#b]?))?$/.exec(s.normalize("NFD"));
    if (!m) return "";
    var r = SOL[fold(m[1]).toLowerCase()];
    if (!r) return "";
    var q = m[3].replace(/^-/, "m");
    var out = r + m[2] + q;
    if (m[4]) { var bs = SOL[fold(m[4]).toLowerCase()]; if (!bs) return ""; out += "/" + bs + (m[5] || ""); }
    return C.isChord(out) ? out : "";
  }
  function parts(ch) {
    var m = /^([A-G])([#b]?)(.*?)(?:\/([A-G])([#b]?))?$/.exec(ch);
    if (!m || ch === "N.C." || ch === "NC") return null;
    // "C6/9": the "/9" is part of the quality, not a bass.
    return { r: m[1], a: m[2], q: m[3], b: m[4] || "", ba: m[5] || "" };
  }
  function pc(letter, acc) { return (PC[letter] + (acc === "#" ? 1 : acc === "b" ? 11 : 0)) % 12; }
  function name(n, flats) { return (flats ? FLAT : SHARP)[((n % 12) + 12) % 12]; }

  function show(ch, solfege) {
    if (!solfege) return ch;
    var p = parts(ch);
    if (!p) return ch === "N.C." || ch === "NC" ? "N.C." : ch;
    return SOL_OUT[p.r] + p.a + p.q + (p.b ? "/" + SOL_OUT[p.b] + p.ba : "");
  }

  // ---------- Transpose ----------
  function transpose(ch, n, flats) {
    var p = parts(ch);
    if (!p) return ch;
    var out = name(pc(p.r, p.a) + n, flats) + p.q;
    if (p.b) out += "/" + name(pc(p.b, p.ba) + n, flats);
    return C.isChord(out) ? out : ch;
  }
  function keyAfter(key, n) {
    if (!C.isKey(key)) return "";
    var minor = /m$/.test(key), k = pc(key.charAt(0), key.charAt(1) === "#" || key.charAt(1) === "b" ? key.charAt(1) : "");
    k = (((k + n) % 12) + 12) % 12;
    return minor ? MIN[k] : MAJ[k];
  }
  // Flats or sharps: from the key when there is one, else from the
  // chords (more flats written than sharps → flats).
  function flatsFor(key, chords) {
    if (key) return !!FLAT_KEYS[key];
    var f = 0, s = 0;
    (chords || []).forEach(function (ch) { var p = parts(ch); if (p) { if (p.a === "b") f++; if (p.a === "#") s++; } });
    return f > s;
  }
  function allChords(p) {
    var out = [];
    function row(r) { (r.c || []).forEach(function (x) { out.push(x[1]); }); }
    (p.ln || []).forEach(function (l) { (l.x || []).forEach(row); row(l); });
    (p.xo || []).forEach(row);
    return out;
  }
  function transposeSong(p, n) {
    n = Math.round(n) % 12;
    var key = p.key ? keyAfter(p.key, n) : "";
    var flats = flatsFor(key, p.key ? null : allChords(p));
    function tc(c) { return c ? c.map(function (x) { return [x[0], transpose(x[1], n, flats)]; }) : c; }
    function tr(r) { var o = Object.assign({}, r); if (r.c) o.c = tc(r.c); return o; }
    var ln = (p.ln || []).map(function (l) {
      var o = Object.assign({}, l);
      if (l.w) o.w = l.w.slice();
      if (l.c) o.c = tc(l.c);
      if (l.x) o.x = l.x.map(tr);
      return o;
    });
    var out = { ln: ln, key: key };
    if (p.xo) out.xo = p.xo.map(tr);
    return out;
  }

  // Chords for the picker: the song's own (in order of use), then the
  // chords of its key.
  function suggest(p) {
    var seen = {}, out = [];
    function add(ch) { if (ch && !seen[ch]) { seen[ch] = 1; out.push(ch); } }
    allChords(p).forEach(add);
    if (p.key) {
      var minor = /m$/.test(p.key), k = pc(p.key.charAt(0), p.key.charAt(1) === "#" || p.key.charAt(1) === "b" ? p.key.charAt(1) : "");
      var fl = !!FLAT_KEYS[p.key];
      var steps = minor ? [[0, "m"], [2, "dim"], [3, ""], [5, "m"], [7, "m"], [7, ""], [8, ""], [10, ""]]
                        : [[0, ""], [2, "m"], [4, "m"], [5, ""], [7, ""], [9, "m"], [11, "dim"], [7, "7"]];
      steps.forEach(function (st) { add(name(k + st[0], fl) + st[1]); });
    } else ["C", "G", "Am", "F", "D", "Em", "E", "A", "Dm"].forEach(add);
    return out.slice(0, 24);
  }

  // ---------- Reading a chord sheet ----------
  var SECTION = {
    verse: "v", "κουπλε": "v", "στροφη": "v",
    chorus: "c", refrain: "c", "ρεφρεν": "c",
    bridge: "b", "γεφυρα": "b"
  };
  var LABELS = { v: { en: "Verse", el: "Κουπλέ" }, c: { en: "Chorus", el: "Ρεφρέν" }, b: { en: "Bridge", el: "Γέφυρα" } };
  var LABEL_WORDS = /^(?:intro|outro|interlude|instrumental|solo|pre-?chorus|break|ending|coda|tag|riff|εισαγωγη|φινάλε|φιναλε|σολο|ενδιαμεσο|οργανικο|κλεισιμο)\b/i;
  var BAR = /^(?:\|{1,2}:?|:?\|{1,2}|\/|-+|\.+|%|x\d{1,2}|\(x?\d{1,2}x?\)|\d{1,2}x)$/i;

  // A line written only of chords (and bar marks), as on the sheets
  // that put the chords above the words.
  function chordTokens(line) {
    if (/[[\]{}]/.test(line)) return null;
    var re = /\S+/g, m, out = [], any = false;
    while ((m = re.exec(line))) {
      var ch = norm(m[0]);
      if (ch) { out.push([m.index, ch]); any = true; }
      else if (!BAR.test(m[0])) return null;
    }
    return any ? out : null;
  }
  // At least two chords in such lines (a lone "A" may be a sung word).
  function hasChordLines(text) {
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n"), n = 0;
    for (var k = 0; k < lines.length && k < 4000 && n < 2; k++) {
      var tk = lines[k].trim() ? chordTokens(lines[k]) : null;
      if (tk) n += tk.length;
    }
    return n >= 2;
  }
  // A bracket that holds a chord ([Am], not [Chorus]).
  function hasInline(text) {
    var re = /\[([^\]\n]{1,20})\]/g, m, s = String(text || "").slice(0, 200000);
    while ((m = re.exec(s))) if (norm(m[1])) return true;
    return false;
  }

  // Whitespace folded as core.js does (runs → one space, trimmed),
  // carrying the chord offsets along.
  function fold2(raw, chords) {
    var t = "", map = [], sp = false;
    for (var k = 0; k < raw.length; k++) {
      map.push(t.length + (sp && t ? 1 : 0));
      var ch = raw.charAt(k);
      if (/\s/.test(ch)) { sp = true; continue; }
      if (sp && t) t += " ";
      sp = false;
      t += ch;
    }
    map.push(t.length);
    var c = chords.map(function (x) { return [Math.min(map[Math.min(x[0], raw.length)], t.length), x[1]]; });
    if (t.length > C.MAX_LINE) {
      t = t.slice(0, C.MAX_LINE).replace(/\s+$/, "");
      c = c.map(function (x) { return [Math.min(x[0], t.length), x[1]]; });
    }
    return { t: t, c: c.slice(0, C.MAX_CHORDS) };
  }
  // "[Am]Σε θυ[F]μάμαι": brackets that hold a chord become chords; any
  // other bracket stays as text.
  function inline(raw) {
    var txt = "", chords = [], re = /\[([^\]\n]{1,20})\]/g, last = 0, m;
    while ((m = re.exec(raw))) {
      var ch = norm(m[1]);
      txt += raw.slice(last, m.index);
      if (ch) chords.push([txt.length, ch]); else txt += m[0];
      last = re.lastIndex;
    }
    txt += raw.slice(last);
    return fold2(txt, chords);
  }
  // Chords over the words: each chord at its column of the line below.
  function overWords(chordLine, words) {
    var toks = chordTokens(chordLine) || [], w = words.replace(/\t/g, "    ");
    var longest = toks.reduce(function (m, x) { return Math.max(m, x[0]); }, 0);
    while (w.length < longest) w += " ";
    return fold2(w, toks.map(function (x) { return [x[0], x[1]]; }));
  }

  function directive(line) {
    var m = /^\{\s*([a-z_]+(?:-[a-z]+)?)\s*(?:[:\s]\s*([^}]*?))?\s*\}\s*$/i.exec(line);
    return m ? { n: m[1].toLowerCase(), v: (m[2] || "").trim() } : null;
  }
  function labelOf(line) {
    var m = /^\s*\[([^\]]{1,40})\]\s*:?\s*$/.exec(line) || /^\s*([A-Za-z\u0370-\u03ff\u1f00-\u1fff -]{3,30}?)\s*(?:\d+)?\s*:\s*$/.exec(line);
    if (!m || norm(m[1])) return null;
    var w = fold(m[1]).toLowerCase().replace(/\s*\d+\s*$/, "").replace(/\s+\d+$/, "").trim();
    var first = w.split(/[\s:]+/)[0];
    if (SECTION[first]) return { k: SECTION[first] };
    if (LABEL_WORDS.test(w)) return { m: m[1].trim() };
    return /^\s*\[/.test(line) ? { m: m[1].trim() } : null;
  }

  function parseSheet(text, opts) {
    var src = String(text || "").replace(/^\ufeff/, "").replace(/\r\n?/g, "\n").split("\n");
    var meta = {}, lines = [], rows = [], gap = false, sec = "", tab = false, stop = false;
    // A blank line or a section start goes on the next row or line;
    // the line keeps p (a new verse for the timing) when its block has
    // a blank anywhere.
    function row(r) {
      if (gap && (lines.length || rows.length)) r.p = 1;
      if (sec) r.k = sec;
      var c = C.cleanRow(r);
      if (c && rows.length < C.MAX_ROWS_END) { rows.push(c); gap = false; sec = ""; }
    }
    function push(r) {
      if (lines.length >= C.MAX_LINES) return;
      var rp = rows.some(function (x) { return x.p; });
      var o = { t: r.t, p: (gap && (lines.length || rows.length)) || rp ? 1 : 0 };
      if (gap && rp) o.q = 1;                            // a second blank, between the rows and the line
      if (r.c && r.c.length) o.c = r.c;
      if (sec) o.k = sec;
      if (rows.length) o.x = rows.slice(0, C.MAX_ROWS);
      lines.push(o);
      rows = []; gap = false; sec = "";
    }
    for (var k = 0; k < src.length && !stop; k++) {
      var raw = src[k], tr = raw.trim();
      if (tab) {
        var d0 = directive(tr);
        if (d0 && /^(eot|end_of_tab|eog|end_of_grid)$/.test(d0.n)) { tab = false; continue; }
        row({ t: raw, tb: 1 });
        continue;
      }
      if (!tr) { if (lines.length || rows.length) gap = true; continue; }
      if (/^#/.test(tr)) continue;                       // a ChordPro comment for the file only
      var d = directive(tr);
      if (d) {
        var v = d.v;
        switch (d.n) {
          case "title": case "t": if (v) meta.name = v; break;
          case "subtitle": case "st": case "artist": case "composer": if (v && !meta.ar) meta.ar = v; break;
          case "album": if (v) meta.al = v; break;
          case "key": case "k": { var kk = norm(v); if (C.isKey(kk)) meta.key = kk; break; }
          case "capo": if (/^\d{1,2}$/.test(v) && +v >= 1 && +v <= 11) meta.capo = +v; break;
          case "tempo": if (/^\d{2,3}$/.test(v) && +v >= 20 && +v <= 300) meta.bpm = +v; break;
          case "time": if (/^\d{1,2}\/\d{1,2}$/.test(v)) meta.ts = v; break;
          case "meta": {
            var mm = /^(\S+)\s+(.+)$/.exec(v);
            if (mm) {
              var nk = mm[1].toLowerCase(), nv = mm[2].trim();
              if (nk === "artist" && !meta.ar) meta.ar = nv;
              else if (nk === "album") meta.al = nv;
              else if (nk === "title") meta.name = nv;
              else if (nk === "key" && C.isKey(norm(nv))) meta.key = norm(nv);
            }
            break;
          }
          case "start_of_chorus": case "soc": sec = "c"; break;
          case "start_of_verse": case "sov": sec = "v"; break;
          case "start_of_bridge": case "sob": sec = "b"; break;
          case "start_of_tab": case "sot": case "start_of_grid": case "sog": tab = true; break;
          case "comment": case "c": case "comment_italic": case "ci": case "comment_box": case "cb": case "highlight":
            if (v) row({ t: v, m: 1 });
            break;
          case "chorus": row({ t: v || LABELS.c[(opts && opts.lang) === "el" ? "el" : "en"], m: 1 }); break;
          case "new_song": case "ns": if (lines.length || rows.length) stop = true; break;
          default: break;                                  // other directives are left out
        }
        continue;
      }
      var lb = labelOf(tr);
      if (lb) { if (lb.k) sec = lb.k; else row({ t: lb.m, m: 1 }); continue; }
      var r;
      var toks = chordTokens(raw);
      if (toks) {
        var nx = src[k + 1];
        if (nx !== undefined && nx.trim() && !directive(nx.trim()) && !/^#/.test(nx.trim()) && !chordTokens(nx) && !hasInline(nx) && !labelOf(nx.trim())) {
          r = overWords(raw.replace(/\t/g, "    "), nx);
          k++;
        } else {
          // the chord names come out of the text; bar marks stay
          var blank = raw.split("");
          toks.forEach(function (x) { var len = (/\S+/.exec(raw.slice(x[0])) || [""])[0].length; for (var q = 0; q < len; q++) blank[x[0] + q] = " "; });
          r = fold2(blank.join(""), toks);
          row({ t: r.t, c: r.c });
          continue;
        }
      } else r = inline(raw);
      // No word left (only chords and bar marks): a row, never timed.
      if (!/[\p{L}\p{N}]/u.test(r.t)) { row({ t: r.t, c: r.c }); continue; }
      push(r);
    }
    return { meta: meta, lines: lines, xo: rows };
  }

  // ---------- Writing ----------
  function inlineText(t, c) {
    if (!c || !c.length) return t;
    if (!t) return c.map(function (x) { return "[" + x[1] + "]"; }).join(" ");
    var out = "", last = 0;
    c.forEach(function (x) { out += t.slice(last, x[0]) + "[" + x[1] + "]"; last = x[0]; });
    return out + t.slice(last);
  }
  function rowChordPro(r) {
    if (r.m) return "{c: " + r.t.replace(/[{}]/g, "") + "}";
    return inlineText(r.t, r.c);
  }
  var SEC_DIR = { v: "verse", c: "chorus", b: "bridge" };
  // The body, shared by the ChordPro file and the editor; the editor
  // writes sections as [Chorus] labels, the file as {start_of_chorus}.
  function body(p, label) {
    var out = [], open = "", inTab = false;
    function endTab() { if (inTab) { out.push("{end_of_tab}"); inTab = false; } }
    function close() { endTab(); if (open && !label) out.push("{end_of_" + SEC_DIR[open] + "}"); open = ""; }
    // One row or line: its blank line, its section, then the text.
    function item(x, gap, text, tb) {
      if (gap || x.k) close();
      if (gap) out.push("");
      if (x.k) { out.push(label ? "[" + label(x.k) + "]" : "{start_of_" + SEC_DIR[x.k] + "}"); open = x.k; }
      if (tb && !inTab) { out.push("{start_of_tab}"); inTab = true; }
      if (!tb) endTab();
      out.push(text);
    }
    function rows(list) { (list || []).forEach(function (r) { item(r, !!r.p && out.length > 0, r.tb ? r.t : rowChordPro(r), r.tb); }); }
    (p.ln || []).forEach(function (l) {
      var rp = (l.x || []).some(function (r) { return r.p; });
      rows(l.x);
      item(l, !!(l.p && out.length && (!rp || l.q)), inlineText(l.t, l.c), false);
    });
    rows(p.xo);
    close();
    return out;
  }
  function one(v) { return String(v || "").replace(/[\r\n{}]+/g, " ").trim(); }
  function toChordPro(p) {
    var head = [];
    if (p.name) head.push("{title: " + one(p.name) + "}");
    if (p.ar) head.push("{artist: " + one(p.ar) + "}");
    if (p.al) head.push("{album: " + one(p.al) + "}");
    if (p.key) head.push("{key: " + p.key + "}");
    if (p.capo) head.push("{capo: " + p.capo + "}");
    if (p.bpm) head.push("{tempo: " + p.bpm + "}");
    if (p.ts) head.push("{time: " + p.ts + "}");
    if (head.length) head.push("");
    return head.concat(body(p, null)).join("\n") + "\n";
  }
  function toEditor(p, lang) {
    var L = lang === "el" ? "el" : "en";
    return body(p, function (k) { return LABELS[k][L]; }).join("\n");
  }

  // Chords over the words, for plain-text sheets: each chord sits over
  // its letter; when two would touch, the words get spaces.
  function overText(t, c, solfege) {
    if (!c || !c.length) return [t];
    var top = "", low = "", last = 0;
    c.forEach(function (x) {
      low += t.slice(last, x[0]); last = x[0];
      var name2 = show(x[1], solfege);
      if (top.length && top.length + 1 > low.length) while (low.length < top.length + 1) low += " ";
      while (top.length < low.length) top += " ";
      top += name2;
    });
    low += t.slice(last);
    return [top.replace(/\s+$/, ""), low];
  }
  // A chord row on one line: "| Am | F |", "Am  F  C".
  function rowPlain(r, sol) {
    var t = r.t || "", bits = [], last = 0;
    (r.c || []).forEach(function (x) { bits.push(t.slice(last, x[0]), show(x[1], sol)); last = x[0]; });
    bits.push(t.slice(last));
    return bits.join(" ").replace(/\s+/g, " ").trim();
  }
  // opts: solfege, lang, words { key, capo, v, c, b } (the app's own
  // words, so every language reads its own; English without them)
  function toChordsText(p, opts) {
    var o = opts || {}, sol = !!o.solfege, L = o.lang === "el" ? "el" : "en", out = [];
    var W = Object.assign({ key: "Key", capo: "Capo", v: LABELS.v[L], c: LABELS.c[L], b: LABELS.b[L] }, o.words || {});
    if (p.name) out.push(p.name + (p.ar ? " \u00b7 " + p.ar : ""));
    var info = [];
    if (p.key) info.push(W.key + ": " + show(p.key, sol));
    if (p.capo) info.push(W.capo + ": " + p.capo);
    if (p.bpm) info.push(p.bpm + " bpm");
    if (p.ts) info.push(p.ts);
    if (info.length) out.push(info.join(" \u00b7 "));
    if (out.length) out.push("");
    var start = out.length;
    function rows(list) {
      (list || []).forEach(function (r) {
        if (r.p && out.length > start) out.push("");
        if (r.k) out.push("[" + W[r.k] + "]");
        if (r.m || r.tb) { out.push(r.t); return; }
        out.push(rowPlain(r, sol));
      });
    }
    (p.ln || []).forEach(function (l) {
      var rp = (l.x || []).some(function (r) { return r.p; });
      rows(l.x);
      if (l.p && out.length > start && (!rp || l.q)) out.push("");
      if (l.k) out.push("[" + W[l.k] + "]");
      out.push.apply(out, overText(l.t, l.c, sol));
    });
    rows(p.xo);
    return out.join("\n") + "\n";
  }

  // Pieces of a line for drawing: a new piece at every chord and every
  // word start, so a tap on a word can put a chord on it.
  function cells(l) {
    var t = l.t || "", cuts = { 0: 1 }, by = {};
    (l.c || []).forEach(function (x) { cuts[x[0]] = 1; (by[x[0]] = by[x[0]] || []).push(x[1]); });
    var re = /\S+/g, m;
    while ((m = re.exec(t))) cuts[m.index] = 1;
    var keys = Object.keys(cuts).map(Number).sort(function (a, b) { return a - b; });
    return keys.map(function (a, k) {
      var b = k + 1 < keys.length ? keys[k + 1] : t.length;
      return { a: a, b: Math.max(a, b), ch: by[a] || [], word: a < t.length && /\S/.test(t.charAt(a)) };
    }).filter(function (x) { return x.b > x.a || x.ch.length; });
  }
  // Chord i of a line put on (or taken off) the word at offset a.
  function setChord(l, a, chord) {
    var c = (l.c || []).filter(function (x) { return x[0] !== a; });
    if (chord) c.push([a, chord]);
    c.sort(function (x, y) { return x[0] - y[0]; });
    var o = Object.assign({}, l);
    if (l.w) o.w = l.w.slice();
    if (c.length) o.c = c.slice(0, C.MAX_CHORDS); else delete o.c;
    return o;
  }

  var API = {
    norm: norm, show: show, transpose: transpose, keyAfter: keyAfter, flatsFor: flatsFor, transposeSong: transposeSong,
    suggest: suggest, parseSheet: parseSheet, hasChordLines: hasChordLines, hasInline: hasInline,
    toChordPro: toChordPro, toChordsText: toChordsText, toEditor: toEditor, cells: cells, setChord: setChord,
    allChords: allChords, rowPlain: rowPlain, LABELS: LABELS
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.LyricsyncChords = API;
})(typeof window !== "undefined" ? window : globalThis);
