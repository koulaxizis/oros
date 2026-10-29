// ============================================================
// orOS Layout — line fitting (v1.0.0)
// Makes a document's lines break where a printed PDF broke them,
// without forced breaks: a line whose words do not end where they did
// gets the tracking that makes exactly its words fit (and the next
// word not), through a character style ("Line fit +12"), the way a
// typesetter would tighten or loosen one line by hand.
//   - targets: [{ sid, p, br: [o, …] }]: in story sid, paragraph p,
//     the character offsets where its 2nd, 3rd… lines start in the PDF
//     (a break inside a word is a soft hyphen U+00AD or a zero-width
//     space U+200B in the text, see designkit/text.js).
//   - fit(doc, targets, opts) changes doc (a normalized document) in
//     place: runs are split at the line starts that need it and those
//     lines get a fit style based on their own character style; the
//     styles carry ext.fit 1. Lines that already break right are left
//     alone. Several passes, since one line's fit moves the next.
//     opts: { name (the styles' name, in the document's language),
//     lang (for a base style's name), now }.
//     → { lines, inPlace, fitted, styles }
//   - breaks(L, doc, sid, p): where Layout breaks paragraph p now.
//   - align(doc, sid, texts): the PDF's lines of story sid (their
//     text, in reading order) → targets for fit. A line that ends
//     inside a word gets a soft hyphen there (its "-" was a
//     hyphenation) or a zero-width space (after a hyphen of the text)
//     in the story. A paragraph with a line not found is left out.
//     → { targets, matched, total }
// Pure (designkit only), testable under Node.
// Exposes LY_LINEFIT (browser) or module.exports (Node tests).
// ============================================================
(function (root) {
  "use strict";

  var M, T, R;
  if (typeof module !== "undefined" && module.exports) {
    M = require("../designkit/model.js"); T = require("../designkit/text.js"); R = require("../designkit/render.js");
  } else { M = root.orosDK.model; T = root.orosDK.text; R = root.orosDK.render; }

  var PASSES = 6;
  // the most a line moves from its style's tracking (1/1000 em)
  var MAX_SHIFT = 60;
  var SOFT = /[\u00AD\u200B]/, SPACE = /[ \t]/;

  // Our lines of paragraph p of story sid, along its thread.
  function linesOf(L, doc, sid, p) {
    var out = [];
    M.chain(doc, sid).forEach(function (f) {
      var fr = L.frames[f.id];
      if (fr) fr.lines.forEach(function (ln) { if (ln.p === p) out.push(ln); });
    });
    return out;
  }
  function breaks(L, doc, sid, p) { return linesOf(L, doc, sid, p).slice(1).map(function (ln) { return ln.o0; }); }

  function isFit(cs) { return !!(cs && cs.ext && cs.ext.fit); }

  // The paragraph as characters with the attributes they have without
  // a fit style: [{ c, a, f }] (f: a field, one character).
  function chars(para, ps, csMap) {
    var out = [];
    (para.runs || []).forEach(function (r) {
      var id = r.cs, cs = id && csMap[id];
      if (isFit(cs)) id = cs.base || "";
      var a = T.runAttrs(ps, id ? T.resolveCs(csMap, id) : {}, r);
      if (r.f) { out.push({ c: "#", a: a, f: 1 }); return; }
      var s = String(r.t || "");
      for (var i = 0; i < s.length; i++) out.push({ c: s[i], a: a, f: 0 });
    });
    return out;
  }

  // Width of characters [s, e) set as one line at tracking t, as
  // designkit/text.js measures it: words part by part, spaces one by
  // one, soft breaks nothing; trailing spaces and breaks do not count,
  // a soft hyphen at the end shows as "-". → { w0, c } with width =
  // w0 + c · t.
  function lineWidth(ch, s, e, hyphen) {
    while (e > s && (SPACE.test(ch[e - 1].c) || SOFT.test(ch[e - 1].c))) e--;
    while (s < e && (SPACE.test(ch[s].c) || SOFT.test(ch[s].c))) s++;
    var w0 = 0, c = 0, k = s;
    while (k < e) {
      var x = ch[k];
      if (SPACE.test(x.c)) { w0 += T.measure(x.a.key, " ", x.a.size, 0); c += x.a.size / 1000; k++; continue; }
      if (SOFT.test(x.c)) { k++; continue; }
      var j = k, txt = "";
      while (j < e && ch[j].a === x.a && !SPACE.test(ch[j].c) && !SOFT.test(ch[j].c)) { txt += ch[j].c; j++; }
      w0 += T.measure(x.a.key, txt, x.a.size, 0, x.a.kern); c += txt.length * x.a.size / 1000;
      k = j;
    }
    if (hyphen && hyphen.a) { w0 += T.measure(hyphen.a.key, "-", hyphen.a.size, 0); c += hyphen.a.size / 1000; }
    return { w0: w0, c: c };
  }
  // the first word (up to a space or a soft break) from o
  function wordAt(ch, o) {
    var e = o;
    while (e < ch.length && !SPACE.test(ch[e].c) && !SOFT.test(ch[e].c)) e++;
    return e;
  }

  // Tracking for each target line: null when its own already breaks
  // right (or nothing can), else the value. Last line first, since a
  // line's end depends on how wide the next line's first word is.
  // known: trackings fit styles have already (reused when in range,
  // so a book needs few styles)
  function plan(ch, br, aw, track0, known) {
    var starts = [0].concat(br), n = starts.length, out = new Array(n), cur = new Array(n);
    for (var k = n - 1; k >= 0; k--) {
      var s = starts[k], e = k + 1 < n ? starts[k + 1] : ch.length;
      var t0 = track0(s);
      cur[k] = t0;
      out[k] = null;
      var avail = aw(k);
      if (!(avail > 0) || e <= s) continue;
      // the break: a soft hyphen right before the next line shows "-"
      var sep = e - 1, hy = k + 1 < n && sep >= s && ch[sep].c === "\u00AD" ? ch[sep] : null;
      var lw = lineWidth(ch, s, e, hy);
      var hi = lw.c > 0 ? (avail - 0.02 - lw.w0) / lw.c : Infinity, lo = -Infinity;
      if (k + 1 < n) {
        // with the next word the line must not fit: the line without its
        // hyphen, the spaces before the word (at t), the word at its own t
        var nw = wordAt(ch, e), next = lineWidth(ch, e, nw, null), tn = cur[k + 1];
        var bare = lineWidth(ch, s, e, null), gap = 0, gc = 0;
        for (var q = e - 1; q >= s && (SPACE.test(ch[q].c) || SOFT.test(ch[q].c)); q--) {
          if (SPACE.test(ch[q].c)) { gap += T.measure(ch[q].a.key, " ", ch[q].a.size, 0); gc += ch[q].a.size / 1000; }
        }
        var C = bare.c + gc;
        if (C > 0) lo = (avail + 0.02 - bare.w0 - gap - (next.w0 + next.c * tn)) / C;
      }
      if (t0 > lo && t0 <= hi) continue;
      var t;
      if (lo >= hi) t = Math.floor(hi * 10) / 10;   // cannot do both: at least its words fit
      else {
        // a little inside the range (measuring may differ in the last
        // digits): a tracking already in use, else a whole number
        var room = Math.min(2, (hi - lo) / 4), want = t0 > hi ? hi - room : lo + room;
        var reuse = (known || []).filter(function (v) { return v > lo + room / 2 && v <= hi - room / 2; })
          .sort(function (a, b) { return Math.abs(a - want) - Math.abs(b - want); });
        t = reuse.concat([Math.round(want), Math.floor(want * 10) / 10, Math.ceil(want * 10) / 10, want]).filter(function (v) { return v > lo && v <= hi; })[0];
      }
      if (t === undefined || !isFinite(t) || Math.abs(t - t0) > MAX_SHIFT) continue;
      if (known && known.indexOf(t) < 0) known.push(t);
      out[k] = t;
      cur[k] = t;
    }
    return { starts: starts, track: out };
  }

  // A fit style for character style base (or none) at tracking t.
  function styleFor(doc, made, base, t, opts) {
    var key = (base || "") + "|" + t;
    if (made[key]) return made[key];
    var id = "cs-fit" + (doc.cstyles.length + 1).toString(36);
    while (M.find(doc.cstyles, id)) id += "x";
    var bcs = base ? M.find(doc.cstyles, base) : null;
    var name = (opts.name || "Line fit") + " " + (t > 0 ? "+" : t < 0 ? "−" : "") + Math.abs(t) + (bcs ? " · " + (typeof bcs.name === "string" ? bcs.name : (bcs.name && (bcs.name[opts.lang] || bcs.name.en)) || "") : "");
    var cs = { id: id, m: opts.now || 1, name: name.slice(0, 60), track: t, ext: { fit: 1 } };
    if (base) cs.base = base;
    doc.cstyles.push(M.normCs(cs));
    made[key] = id;
    return id;
  }

  // Rewrite a paragraph's runs: characters of line k with track[k]
  // take the fit style (on their own style), the others their own.
  function apply(doc, para, csMap, pl, made, opts) {
    var k = 0, pos = 0, runs = [];
    (para.runs || []).forEach(function (r) {
      var id = r.cs, cs = id && csMap[id];
      if (isFit(cs)) id = cs.base || "";
      var len = r.f ? 1 : String(r.t || "").length, o = 0;
      while (o < len) {
        while (k + 1 < pl.starts.length && pl.starts[k + 1] <= pos + o) k++;
        var end = k + 1 < pl.starts.length ? Math.min(len, pl.starts[k + 1] - pos) : len;
        if (end <= o) end = len;
        var n = {};
        Object.keys(r).forEach(function (f) { if (f !== "t" && f !== "cs") n[f] = r[f]; });
        if (!r.f) n.t = String(r.t).slice(o, end);
        var t = pl.track[k];
        var cid = t === null || t === undefined ? id : styleFor(doc, made, id, t, opts);
        if (cid) n.cs = cid;
        runs.push(n);
        o = end;
      }
      pos += len;
    });
    para.runs = runs;
  }

  function fit(doc, targets, opts) {
    opts = opts || {};
    var made = {}, stats = { lines: 0, inPlace: 0, fitted: 0, styles: 0 };
    // existing fit styles are found again, not made twice
    doc.cstyles.forEach(function (c) { if (isFit(c)) made[(c.base || "") + "|" + c.track] = c.id; });
    var known = Object.keys(made).map(function (k) { return +k.split("|")[1]; });
    var todo = (targets || []).filter(function (tg) { return tg && tg.br && tg.br.length; });
    for (var pass = 0; pass < PASSES && todo.length; pass++) {
      var L = R.computeLayout(doc), psMap = T.byId(doc.pstyles), csMap = T.byId(doc.cstyles), next = [];
      todo.forEach(function (tg) {
        var st = M.find(doc.stories, tg.sid), para = st && st.paras[tg.p];
        if (!para) return;
        var ours = linesOf(L, doc, tg.sid, tg.p);
        if (ours.length && sameBreaks(ours, tg.br)) return;
        var ps = T.resolvePs(psMap, para.ps), ch = chars(para, ps, csMap);
        var pl = plan(ch, tg.br, function (k) { var ln = ours[Math.min(k, ours.length - 1)]; return ln ? ln.aw : 0; },
          function (s) { return ch[s] ? ch[s].a.track || 0 : ps.track || 0; }, known);
        // a pass that changes nothing ends the target
        var before = JSON.stringify(para.runs);
        apply(doc, para, csMap, pl, made, opts);
        csMap = T.byId(doc.cstyles);
        if (JSON.stringify(para.runs) !== before) next.push(tg);
      });
      todo = next;
    }
    var Lf = R.computeLayout(doc), used = {};
    (targets || []).forEach(function (tg) {
      var ours = linesOf(Lf, doc, tg.sid, tg.p), n = (tg.br || []).length + 1;
      stats.lines += n;
      ours.forEach(function (ln, k) {
        if (k >= n) return;
        var want = k ? tg.br[k - 1] : 0, end = k + 1 < n ? tg.br[k] : null;
        var nextO = ours[k + 1] ? ours[k + 1].o0 : null;
        if (ln.o0 === want && (end === null ? nextO === null : nextO === end)) stats.inPlace++;
      });
    });
    doc.stories.forEach(function (st) { st.paras.forEach(function (p) { p.runs.forEach(function (r) { if (r.cs) used[r.cs] = 1; }); }); });
    // fit styles no run uses go again
    doc.cstyles = doc.cstyles.filter(function (c) { return !isFit(c) || used[c.id]; });
    // normalized again (adjacent runs with the same look join, lists in order)
    var nd = M.normDoc(doc);
    Object.keys(nd).forEach(function (k) { doc[k] = nd[k]; });
    doc.cstyles.forEach(function (c) { if (isFit(c)) stats.styles++; });
    // lines that carry a fit style
    var fitIds = {};
    doc.cstyles.forEach(function (c) { if (isFit(c)) fitIds[c.id] = 1; });
    (targets || []).forEach(function (tg) {
      var st = M.find(doc.stories, tg.sid), para = st && st.paras[tg.p], starts = [0].concat(tg.br || []), hit = {}, pos = 0;
      if (!para) return;
      para.runs.forEach(function (r) {
        var len = r.f ? 1 : String(r.t || "").length;
        if (fitIds[r.cs]) starts.forEach(function (s, k) { var e = k + 1 < starts.length ? starts[k + 1] : Infinity; if (pos < e && pos + len > s) hit[k] = 1; });
        pos += len;
      });
      stats.fitted += Object.keys(hit).length;
    });
    return stats;
  }
  function sameBreaks(ours, br) {
    if (ours.length !== br.length + 1) return false;
    for (var k = 0; k < br.length; k++) if (ours[k + 1].o0 !== br[k]) return false;
    return true;
  }

  // ---------- The PDF's lines → line starts in the story ----------
  var HY_END = /[-\u2010\u2011\u00AD]$/, BLANK = /[\s\u00AD\u200B]/;
  // compared without accents: some PDFs (Greek fonts whose tonos is a
  // glyph of its own) give "καλα" for "καλά" when their text is read
  var MARKS = /[\u0300-\u036F\u0384\u0385]/g;
  function norm(t) { return String(t).normalize("NFKC").normalize("NFD").replace(MARKS, ""); }
  function align(doc, sid, texts) {
    var st = M.find(doc.stories, sid), out = { targets: [], matched: 0, total: (texts || []).length };
    if (!st) return out;
    // the story without spaces, each character with its paragraph and offset
    var S = [], at = [];
    st.paras.forEach(function (para, p) {
      var o = 0;
      para.runs.forEach(function (r) {
        if (r.f) { S.push("\uFFFC"); at.push({ p: p, o: o, f: 1 }); o++; return; }
        var t = String(r.t || "");
        for (var i = 0; i < t.length; i++) {
          if (!BLANK.test(t[i])) norm(t[i]).split("").forEach(function (c) { if (!BLANK.test(c)) { S.push(c); at.push({ p: p, o: o + i }); } });
        }
        o += t.length;
      });
    });
    function match(j, t) {
      for (var k = 0; k < t.length; k++, j++) {
        if (j >= S.length) return -1;
        if (S[j] === "\uFFFC") { var m = /^[0-9#]{1,4}/.exec(t.slice(k)); if (!m) return -1; k += m[0].length - 1; continue; }
        if (S[j] !== t[k]) return -1;
      }
      return j;
    }
    var j = 0, starts = [];      // per line: { p, o, soft } or null
    (texts || []).forEach(function (raw) {
      var t = norm(raw).replace(/\s+/g, ""), bare = HY_END.test(t) ? t.slice(0, -1) : null, e = -1, soft = false, s0 = j;
      if (!t) { starts.push(null); return; }
      e = match(j, t);
      if (e < 0 && bare) { e = match(j, bare); soft = e >= 0; }
      if (e < 0) {
        // further on (text the PDF had that the story has not, or the reverse)
        var probe = S.slice(j, j + 400).join("");
        [[t, false], [bare, true]].some(function (c) {
          var q = c[0] ? probe.indexOf(c[0]) : -1, ee = q > 0 ? match(j + q, c[0]) : -1;
          if (ee < 0) return false;
          s0 = j + q; e = ee; soft = c[1];
          return true;
        });
      }
      if (e < 0) { starts.push(null); return; }
      starts.push({ p: at[s0].p, o: at[s0].o, soft: soft });
      out.matched++;
      j = e;
    });
    // paragraphs: their line starts after the first, and what to insert
    var byP = {}, bad = {}, lost = false;
    starts.forEach(function (sl, k) {
      var prev = starts[k - 1];
      // a line not found: its neighbours' paragraphs are uncertain
      if (!sl) { if (prev) bad[prev.p] = 1; lost = true; return; }
      if (lost) { bad[sl.p] = 1; lost = false; }
      var e = byP[sl.p] || (byP[sl.p] = { br: [], ins: [] });
      if (prev && prev.p === sl.p) {
        e.br.push(sl.o);
        var para = st.paras[sl.p], ch = paraChar(para, sl.o - 1);
        if (ch !== null && !BLANK.test(ch)) e.ins.push({ o: sl.o, c: prev.soft ? "\u00AD" : "\u200B" });
      }
    });
    Object.keys(byP).forEach(function (pk) {
      var p = +pk, e = byP[pk];
      if (bad[p] || !e.br.length) return;
      if (e.ins.length) insert(st.paras[p], e.ins);
      out.targets.push({ sid: sid, p: p, br: e.br.map(function (o) { return o + e.ins.filter(function (x) { return x.o <= o; }).length; }) });
    });
    return out;
  }
  function paraChar(para, o) {
    var pos = 0;
    for (var i = 0; i < para.runs.length; i++) {
      var r = para.runs[i], len = r.f ? 1 : String(r.t || "").length;
      if (o < pos + len) return r.f ? null : String(r.t)[o - pos];
      pos += len;
    }
    return null;
  }
  // put characters in before offsets (ascending), run by run
  function insert(para, ins) {
    var pos = 0, k = 0;
    para.runs.forEach(function (r) {
      var len = r.f ? 1 : String(r.t || "").length;
      if (!r.f) {
        var t = String(r.t), out = "", last = 0;
        while (k < ins.length && ins[k].o < pos + len) { out += t.slice(last, ins[k].o - pos) + ins[k].c; last = ins[k].o - pos; k++; }
        r.t = out + t.slice(last);
      }
      pos += len;
    });
  }

  var api = { fit: fit, breaks: breaks, align: align, key: norm, plan: plan, lineWidth: lineWidth, chars: chars };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_LINEFIT = api;
})(typeof window !== "undefined" ? window : this);
