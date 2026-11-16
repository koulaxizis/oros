// ============================================================
// orOS Writer — catxlf.js: XLIFF 1.2 and 2.0 for book translation
// (WR-CAT, wave T4). Pure: no DOM, no storage. Tested in Node
// (tests/writer-catxlf.test.js).
// A project goes out as XLIFF so a translator with another tool
// (Trados, memoQ, OmegaT, Poedit …) can work on it, and comes back in:
//   - one unit a segment, id "u<n>"; tags as <g>/<x> (1.2) or
//     <pc>/<ph> (2.0) with our tag numbers as ids
//   - status: draft, translated, reviewed ↔ needs-review-translation,
//     translated, signed-off (1.2) / initial, translated, final (2.0)
//   - reading back: a unit is matched by its id when its source is
//     still ours, else by the same source text; other units are
//     counted as skipped. bpt/ept/ph/it (1.2), sc/ec/ph (2.0) and mrk
//     are understood; the native code inside them is never text.
//   - no DTD and no entity is ever read (cattm.js xml parser)
// Exposes window.WriterCatXlf (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var C = node ? require("./catcore.js") : root.WriterCatCore;
  var TM = node ? require("./cattm.js") : root.WriterCatTM;

  var MAX_FILE = 64 * 1024 * 1024;
  var xesc = TM.xesc;

  // one segment's text with our tags → XLIFF inline markup
  function inline(src, i, text, v2) {
    var sg = src.segs[i], bl = src.blocks[sg.b];
    var kinds = sg.t.map(function (id) { return (bl.tags[id] || ["v"])[0]; });
    var tk = C.readTags(text, kinds), out = "", stack = [];
    function name(n) { return String((bl.tags[sg.t[n - 1]] || [])[3] || "x").replace(/[^A-Za-z0-9-]/g, "").slice(0, 12) || "x"; }
    function open(n) { return v2 ? '<pc id="' + n + '">' : '<g id="' + n + '" ctype="x-' + name(n) + '">'; }
    function close() { return v2 ? "</pc>" : "</g>"; }
    tk.forEach(function (t) {
      if (t.x !== undefined) { out += xesc(t.x.replace(C.TAG_RX, "")); return; }
      if (t.v) { out += v2 ? '<ph id="' + t.v + '"/>' : '<x id="' + t.v + '" ctype="x-' + name(t.v) + '"/>'; return; }
      if (t.o) { out += open(t.o); stack.push(t.o); return; }
      var at = stack.lastIndexOf(t.c);
      if (at < 0) return;
      var above = stack.slice(at + 1);
      for (var k = stack.length - 1; k >= at; k--) out += close();
      stack.length = at;
      above.forEach(function (n) { out += open(n); stack.push(n); });
    });
    for (var k = stack.length - 1; k >= 0; k--) out += close();
    return out;
  }
  // (2.0: a code in the target has the id of the same code in the source)

  var ST12 = { 1: "needs-review-translation", 2: "translated", 3: "signed-off" };
  var ST20 = { 1: "initial", 2: "translated", 3: "final" };

  // o = { from, to, name, file, version: "1.2"|"2.0" } → text
  function xliff(src, rows, o) {
    o = o || {};
    rows = rows || {};
    var v2 = o.version === "2.0", out = ['<?xml version="1.0" encoding="UTF-8"?>'];
    var from = xesc(o.from || "en"), to = xesc(o.to || ""), orig = xesc(o.file || o.name || "translation");
    if (v2) {
      out.push('<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="' + from + '" trgLang="' + to + '">');
      out.push('<file id="f1" original="' + orig + '">');
    } else {
      out.push('<xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" version="1.2">');
      out.push('<file original="' + orig + '" source-language="' + from + '" target-language="' + to + '" datatype="plaintext"><body>');
    }
    src.segs.forEach(function (sg, i) {
      var r = rows[i], has = r && (r[0].trim() || r[1] >= C.ST_DONE), st = has ? (r[1] || 1) : 0;
      var s = inline(src, i, sg.s, v2), t = has ? inline(src, i, r[0], v2) : "";
      if (v2) {
        out.push('<unit id="u' + i + '"><segment' + (has ? ' state="' + ST20[st] + '"' : "") + '><source xml:space="preserve">' + s +
          "</source>" + (has ? '<target xml:space="preserve">' + t + "</target>" : "") + "</segment></unit>");
      } else {
        out.push('<trans-unit id="u' + i + '" xml:space="preserve"' + (st === 3 ? ' approved="yes"' : "") + "><source>" + s + "</source>" +
          (has ? '<target state="' + ST12[st] + '">' + t + "</target>" : "") + "</trans-unit>");
      }
    });
    out.push(v2 ? "</file></xliff>" : "</body></file></xliff>");
    return out.join("\n") + "\n";
  }

  // ---------- reading ----------
  // an element of a source/target → our text; ids are our tag numbers
  function textIn(nd, max) {
    var out = "", bpt = {};
    function id(v) { var n = parseInt(v, 10); return n >= 1 && n <= max && String(n) === String(v).trim() ? n : 0; }
    function walk(x) {
      x.c.forEach(function (k) {
        if (typeof k === "string") { out += k.replace(/[⟦⟧]/g, function (c) { return c === "⟦" ? "[" : "]"; }); return; }
        var n = k.n.replace(/^[\w-]+:/, "");
        if (n === "g" || n === "pc") {
          var a = id(k.a.id);
          if (a) out += "⟦" + a + "⟧";
          walk(k);
          if (a) out += "⟦/" + a + "⟧";
        } else if (n === "x" || n === "ph" || n === "cp") {
          if (n === "cp") { var cp = parseInt(k.a.hex, 16); if (cp > 0 && cp <= 0x10FFFF && !(cp >= 0xD800 && cp <= 0xDFFF)) out += String.fromCodePoint(cp); return; }
          var b = id(k.a.id);
          if (b) out += "⟦" + b + "/⟧";
        } else if (n === "bx" || n === "bpt" || n === "sc") {
          var c = id(k.a.id);
          if (n === "bpt" && c) bpt[k.a.rid || k.a.id] = c;
          if (c) out += "⟦" + c + "⟧";
        } else if (n === "ex" || n === "ept" || n === "ec") {
          var e = n === "ept" ? (bpt[k.a.rid || k.a.id] || id(k.a.id)) : id(n === "ec" ? (k.a.startref || k.a.id) : (k.a.startref || k.a.rid || k.a.id));
          if (e) out += "⟦/" + e + "⟧";
        } else if (n === "it") {
          var f = id(k.a.id);
          if (f) out += k.a.pos === "close" || k.a.pos === "end" ? "⟦/" + f + "⟧" : "⟦" + f + "⟧";
        } else if (n === "mrk" || n === "sm" || n === "em") {
          walk(k);
        }
        // sub, ut and every other code: never text
      });
    }
    walk(nd);
    return out;
  }
  function norm(s) { return String(s || "").replace(C.TAG_RX, "").replace(/\s+/g, " ").trim(); }
  function first(nd, name) {
    var hit = null;
    (function walk(x) { if (hit) return; x.c.forEach(function (k) { if (hit || typeof k === "string") return; if (k.n.replace(/^[\w-]+:/, "") === name) hit = k; else walk(k); }); })(nd);
    return hit;
  }
  function all(nd, name, out) {
    out = out || [];
    nd.c.forEach(function (k) { if (typeof k === "string") return; if (k.n.replace(/^[\w-]+:/, "") === name) out.push(k); else all(k, name, out); });
    return out;
  }
  function stateOf(v2, st, approved, text) {
    st = String(st || "").toLowerCase();
    if (approved === "yes" || st === "final" || st === "signed-off" || st === "reviewed") return C.ST_REVIEWED;
    if (st === "translated" || st === "needs-review-l10n" || st === "needs-review-adaptation") return C.ST_DONE;
    return text.trim() ? C.ST_DRAFT : C.ST_NEW;
  }

  // text → { rows: { i: [text, status] }, matched, skipped, err }
  function parseXliff(text, src) {
    text = String(text || "");
    if (text.length > MAX_FILE) return { err: "toobig", rows: {}, matched: 0, skipped: 0 };
    var doc = TM.xml.parse(text), x = first(doc, "xliff");
    if (!x) return { err: "notxliff", rows: {}, matched: 0, skipped: 0 };
    var v2 = /^2/.test(String(x.a.version || "")) || /xliff:document:2/.test(String(x.a.xmlns || ""));
    var byText = {}, rows = {}, matched = 0, skipped = 0, taken = {};
    src.segs.forEach(function (sg, i) { var k = norm(sg.s); if (byText[k] === undefined) byText[k] = []; byText[k].push(i); });
    function place(id, srcNd, tgtNd, st, approved) {
      if (!tgtNd) return;
      var m = /^u(\d{1,6})$/.exec(String(id || "")), i = m ? +m[1] : -1;
      var max = i >= 0 && i < src.segs.length ? src.segs[i].t.length : 0;
      var sText = srcNd ? norm(textIn(srcNd, 999)) : "";
      if (!(i >= 0 && i < src.segs.length && norm(src.segs[i].s) === sText)) {
        var list = (byText[sText] || []).filter(function (j) { return !taken[j]; });
        i = list.length ? list[0] : -1;
      }
      if (i < 0) { skipped++; return; }
      max = src.segs[i].t.length;
      var t = textIn(tgtNd, max).slice(0, C.MAX_TEXT), s = stateOf(v2, st, approved, t);
      if (!t.trim() && s < C.ST_DONE) return;
      taken[i] = 1;
      rows[i] = [t, s];
      matched++;
    }
    if (v2) {
      all(x, "unit").forEach(function (u) {
        var segsOf = all(u, "segment");
        if (segsOf.length !== 1) {
          // a unit split or joined by another tool: one text of all its segments
          var s1 = "", t1 = "", any = false, st1 = "final";
          segsOf.forEach(function (g) {
            var a = first(g, "source"), b = first(g, "target");
            if (a) s1 += textIn(a, 0); if (b) { any = true; t1 += textIn(b, 0); }
            if (String(g.a.state || "initial") !== "final") st1 = g.a.state || "initial";
          });
          if (any) place(u.a.id, { c: [s1] }, { c: [t1] }, st1, "");
          return;
        }
        var sg = segsOf[0];
        place(u.a.id, first(sg, "source"), first(sg, "target"), sg.a.state, "");
      });
    } else {
      all(x, "trans-unit").forEach(function (u) {
        var tg = first(u, "target");
        place(u.a.id, first(u, "source"), tg, tg ? tg.a.state : "", u.a.approved);
      });
    }
    return { rows: rows, matched: matched, skipped: skipped, err: "" };
  }

  var api = { xliff: xliff, parseXliff: parseXliff, MAX_FILE: MAX_FILE };
  if (node) module.exports = api;
  else root.WriterCatXlf = api;
})(this);
