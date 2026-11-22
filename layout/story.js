// ============================================================
// orOS Layout — Story Editor (v1.0.0)
// The whole text of a story (all its threaded frames) in one plain
// editor: one <div data-ps> per paragraph, bold / italic / underline,
// character styles, page-number fields. Docked beside the canvas on
// a desktop, full screen on a phone. Typing is read back from the
// DOM (debounced, one undo step per pause); formatting, paste and
// fields are applied to the model and re-rendered, so the browser's
// own markup never reaches the document.
// Sync: every save pushes the old stamp into story.h (designkit
// model), so two devices editing the same story at the same time
// keep the losing text in "Recovered text"; a remote change that
// lands while this editor has unsaved typing is kept the same way.
// ============================================================
(function () {
  "use strict";

  var LY = window.LY, M = LY.M, T = LY.T, t = LY.t, $ = LY.$, el = LY.el;
  var ED = LY.ed;
  var SAVE_MS = 600;

  var S = { sid: null, item: null, dirty: false, baseM: 0, lastKey: "", timer: null, sel: null, curPs: null, pext: {}, pextN: 0, noteNo: {} };
  var ed, tools, foot, psSel, csSel;

  function story() { return S.sid && LY.doc ? M.story(LY.doc, S.sid) : null; }
  function keyOf(paras) { return JSON.stringify(paras); }
  function isOpen() { return !!S.sid && !$("story").hidden; }

  // ---------- Model helpers (paragraph arrays) ----------
  function runLen(r) { return r.f ? 1 : r.t.length; }
  function paraLen(p) { var n = 0; p.runs.forEach(function (r) { n += runLen(r); }); return n; }
  function fmtOf(r) { var o = {}; if (r.cs) o.cs = r.cs; if (r.b) o.b = 1; if (r.i) o.i = 1; if (r.u) o.u = 1; return o; }
  // a split run keeps its ext (R39) on both halves
  function keepOf(r) { var o = fmtOf(r); if (r.ext) o.ext = JSON.parse(JSON.stringify(r.ext)); return o; }
  function withFmt(o, fmt) { Object.keys(fmt).forEach(function (k) { o[k] = fmt[k]; }); return o; }

  // Make sure a run boundary sits at offset `off`; returns the index
  // of the first run at or after it.
  function cut(p, off) {
    var pos = 0;
    for (var i = 0; i < p.runs.length; i++) {
      var r = p.runs[i], n = runLen(r);
      if (off <= pos) return i;
      if (off < pos + n) {            // only text runs are longer than 1
        if (r.ext && (r.ext.fld || r.ext.sup)) return i + 1;   // a running head or a note's mark is one piece: the boundary after it
        var a = withFmt({ t: r.t.slice(0, off - pos) }, keepOf(r));
        var b = withFmt({ t: r.t.slice(off - pos) }, keepOf(r));
        p.runs.splice(i, 1, a, b);
        return i + 1;
      }
      pos += n;
    }
    return p.runs.length;
  }

  // Runs fully inside [a, b) of each touched paragraph.
  function eachRun(paras, a, b, fn) {
    for (var pi = a.p; pi <= b.p; pi++) {
      var p = paras[pi];
      var s = pi === a.p ? a.o : 0, e = pi === b.p ? b.o : paraLen(p);
      if (e <= s) continue;
      var i0 = cut(p, s), i1 = cut(p, e);
      for (var i = i0; i < i1; i++) fn(p.runs[i]);
    }
  }

  function deleteRange(paras, a, b) {
    if (a.p === b.p) {
      var p = paras[a.p], i0 = cut(p, a.o), i1 = cut(p, b.o);
      p.runs.splice(i0, i1 - i0);
      return;
    }
    var first = paras[a.p], last = paras[b.p];
    first.runs.splice(cut(first, a.o));
    var tail = last.runs.slice(cut(last, b.o));
    first.runs = first.runs.concat(tail);
    paras.splice(a.p + 1, b.p - a.p);
  }

  // Format of the character before the caret (what typing would get).
  function fmtAt(paras, at) {
    var p = paras[at.p], pos = 0, last = null;
    for (var i = 0; i < p.runs.length; i++) {
      var r = p.runs[i];
      if (pos >= at.o && last) break;
      if (!r.f) last = r;
      pos += runLen(r);
    }
    return last ? fmtOf(last) : {};
  }

  // The style a new paragraph after one in `id` takes: ext.next when it names a style.
  function nextPs(id) {
    var d = LY.doc, ps = d ? M.find(d.pstyles, id) : null, n = ps && ps.ext && ps.ext.next;
    return n && n !== id && M.find(d.pstyles, n) ? n : id;
  }

  // A break character (LY-W5b): the paragraph splits at the caret and
  // the part after it starts in the next column, on the next page, or
  // on the next odd or even page (its ext.brk).
  function insertBreak(paras, at, kind) {
    var c = insertAt(paras, at, "\n", null), np = paras[c.p];
    np.ext = Object.assign({}, np.ext || {}, { brk: kind });
    return c;
  }

  // Insert plain text (a newline starts a paragraph) or a field run.
  // Returns the caret after it.
  function insertAt(paras, at, text, field) {
    var fmt = fmtAt(paras, at), p = paras[at.p], i = cut(p, at.o);
    if (field) { p.runs.splice(i, 0, withFmt({ f: field }, fmt)); return { p: at.p, o: at.o + 1 }; }
    var lines = text.split("\n");
    var tail = p.runs.splice(i);
    if (lines[0]) p.runs.push(withFmt({ t: lines[0] }, fmt));
    var cur = p, caret = { p: at.p, o: at.o + lines[0].length };
    // Enter at the end of a paragraph: the new one takes its style's next style (LY-W5)
    var nps = p.ps;
    if (text === "\n" && !tail.some(function (r) { return runLen(r) > 0; })) nps = nextPs(p.ps);
    for (var k = 1; k < lines.length; k++) {
      cur = { ps: nps, runs: lines[k] ? [withFmt({ t: lines[k] }, fmt)] : [] };
      paras.splice(at.p + k, 0, cur);
      caret = { p: at.p + k, o: lines[k].length };
    }
    cur.runs = cur.runs.concat(tail);
    return caret;
  }

  function normParas(paras) {
    var out = [];
    var TB = window.orosDK && window.orosDK.table;
    (TB ? TB.unrun(paras) : paras).forEach(function (p) { var n = M.normPara(p); if (n) out.push(n); });
    if (!out.length) out.push({ ps: S.curPs || "ps-body", runs: [] });
    return out;
  }

  // ---------- Render ----------
  var psMap = {}, csMap = {};
  function styleMaps() {
    psMap = T.byId(LY.doc.pstyles); csMap = T.byId(LY.doc.cstyles);
  }
  function familyCss(fam) {
    return fam === "sans" ? '"dk-sans-r", system-ui, sans-serif' : fam === "mono" ? '"dk-mono-r", ui-monospace, monospace' : '"dk-serif-r", Georgia, serif';
  }

  function renderPara(p) {
    var d = el("div", "sp");
    d.setAttribute("data-ps", p.ps);
    // a paragraph's own ext (a break before it, LY-W5b, or another
    // program's) rides on the div by key, so typing never drops it
    if (p.ext) {
      var key = "x" + (++S.pextN);
      S.pext[key] = p.ext;
      d.setAttribute("data-px", key);
      if (p.ext.brk && /^(col|page|odd|even)$/.test(p.ext.brk)) d.setAttribute("data-brk", t("brk." + p.ext.brk));
    }
    var ps = T.resolvePs(psMap, p.ps), pso = psMap[p.ps];
    // the style's name in the left column (LY-N3, Style names)
    d.setAttribute("data-psn", pso ? LY.label(pso.name) : p.ps);
    // a table (LY-W12): one piece; a click opens the table dialog
    var tb = p.ext && p.ext.tbl;
    if (tb && Array.isArray(tb.rows) && Array.isArray(tb.cols)) {
      d.className = "sp sp-tbl";
      d.contentEditable = "false";
      var tl = el("span", "sf stbl", "\u25A6 " + t("tbl.label", { r: tb.rows.length, c: tb.cols.length }));
      tl.setAttribute("data-f", "tbl");
      tl.title = t("tbl.open");
      var pv = LY.tables && window.orosDK && window.orosDK.table ? window.orosDK.table.text(tb).split("\n")[0].replace(/\t/g, " · ").slice(0, 80) : "";
      if (pv) tl.appendChild(el("span", "stbl-pv", pv));
      d.appendChild(tl);
      return d;
    }
    d.style.fontFamily = familyCss(ps.font);
    d.style.fontSize = Math.round(Math.max(13, Math.min(26, ps.size * 1.25)) * zoom() * 10) / 10 + "px";
    d.style.textAlign = ps.align === "c" ? "center" : ps.align === "r" ? "right" : "left";
    var endsWithBr = false;
    p.runs.forEach(function (r) {
      var node;
      if (r.ext && r.ext.del) {
        // a tracked deletion (LY-W12): one piece, struck; it rides by key
        var dk = "r" + (++S.pextN);
        S.pext[dk] = r;
        node = el("del", "sf sdel", r.f ? (r.f === "pn" ? "#" : "##") : r.t);
        node.contentEditable = "false";
        node.setAttribute("data-f", "del");
        node.setAttribute("data-rx", dk);
        node.setAttribute("data-t", r.f ? "#" : r.t);
        node.title = revTitle(r.ext.del, "trk.del");
        endsWithBr = false;
      } else if (r.f) {
        node = el("span", "sf", r.f === "pn" ? "#" : "##");
        node.contentEditable = "false";
        node.setAttribute("data-f", r.f);
        node.title = t(r.f === "pn" ? "story.pn" : "story.pc");
        endsWithBr = false;
      } else if (r.ext && r.ext.fld === "sec") {
        // a running head (LY-RH): one piece, its own text kept
        node = el("span", "sf", r.t);
        node.contentEditable = "false";
        node.setAttribute("data-f", "sec");
        node.setAttribute("data-t", r.t);
        node.title = t("story.sec");
        endsWithBr = false;
      } else if (r.ext && (typeof r.ext.fn === "string" || (r.ext.xr && typeof r.ext.xr === "object"))) {
        // a note's reference or a cross-reference (LY-W7): one piece;
        // its run rides by key, so its ext is never lost
        var rk = "r" + (++S.pextN);
        S.pext[rk] = r.ext;
        var isFn = typeof r.ext.fn === "string";
        node = el(isFn ? "sup" : "span", "sf " + (isFn ? "sfn" : "sxr"), isFn ? noteMark(r.ext.fn) : "\u2192 " + xrLabel(r.ext.xr));
        node.contentEditable = "false";
        node.setAttribute("data-f", "rx");
        node.setAttribute("data-rx", rk);
        node.setAttribute("data-t", r.t || "*");
        node.setAttribute("data-fn", isFn ? r.ext.fn : "");
        node.title = isFn ? String(r.ext.ft || "").slice(0, 300) || t("note.empty") : t("xr.title");
        endsWithBr = false;
      } else if (r.ext && r.ext.sup) {
        // a note's mark (LY-NT): one piece, raised
        node = el("sup", "sf", r.t);
        node.contentEditable = "false";
        node.setAttribute("data-f", "sup");
        node.setAttribute("data-t", r.t);
        endsWithBr = false;
      } else {
        node = document.createDocumentFragment();
        r.t.split("\n").forEach(function (part, k) {
          if (k) node.appendChild(document.createElement("br"));
          if (part) node.appendChild(document.createTextNode(part));
        });
        endsWithBr = r.t.charAt(r.t.length - 1) === "\n";
      }
      if (r.ext && !r.f && !r.ext.fld && !r.ext.sup && node.nodeType === 11) {
        // any other ext of a run (a link, LY-W7, or another program's)
        // rides on a span by key, so typing in it keeps it
        var xk = "r" + (++S.pextN), sx = el("span", (r.ext.href ? "sx slink" : "sx") + (r.ext.ins ? " sins" : "") + (r.ext.ix ? " six" : ""));
        S.pext[xk] = r.ext;
        sx.setAttribute("data-rx", xk);
        if (r.ext.href) sx.title = String(r.ext.href);
        else if (r.ext.ins) sx.title = revTitle(r.ext.ins, "trk.ins");
        else if (r.ext.ix) sx.title = t("ix.mark") + ": " + (r.ext.ix.t || r.t) + (r.ext.ix.s ? " / " + r.ext.ix.s : "");
        sx.appendChild(node); node = sx;
      }
      if (r.u) { var u = document.createElement("u"); u.appendChild(node); node = u; }
      if (r.i) { var i = document.createElement("i"); i.appendChild(node); node = i; }
      if (r.b) { var b = document.createElement("b"); b.appendChild(node); node = b; }
      if (r.cs) {
        var c = el("span", "scs");
        c.setAttribute("data-cs", r.cs);
        var cs = csMap[r.cs];
        if (cs) c.title = LY.label(cs.name);
        c.appendChild(node); node = c;
      }
      d.appendChild(node);
    });
    // an empty paragraph, or one ending in a line break, needs a
    // placeholder <br> to have a line at all
    if (!p.runs.length || endsWithBr) d.appendChild(document.createElement("br"));
    return d;
  }

  // who changed it and when (track changes, LY-W12)
  function revTitle(m, key) {
    var d = m && m.at ? new Date(m.at) : null;
    return t(key) + (m && m.by ? " · " + m.by : "") + (d && !isNaN(d) ? " · " + d.toLocaleString() : "");
  }

  // a note's number in this story, as the editor shows it
  function noteMark(id) { return String(S.noteNo[id] || "*"); }
  // where a cross-reference points, in words
  function xrLabel(x) {
    var a = LY.notes ? LY.notes.anchor(x && x.to) : null;
    return a ? a.t.slice(0, 40) : "?";
  }

  function render(paras, range) {
    styleMaps();
    S.pext = {};
    S.noteNo = {};
    var nn = 0;
    paras.forEach(function (p) { p.runs.forEach(function (r) { if (r.ext && typeof r.ext.fn === "string" && !S.noteNo[r.ext.fn]) S.noteNo[r.ext.fn] = ++nn; }); });
    var frag = document.createDocumentFragment();
    paras.forEach(function (p) { frag.appendChild(renderPara(p)); });
    ed.innerHTML = "";
    ed.appendChild(frag);
    S.lastKey = keyOf(paras);
    if (range) setRange(range.a, range.b);
    updateFoot(paras);
  }

  // ---------- DOM → model ----------
  var BLOCK = { DIV: 1, P: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, LI: 1, UL: 1, OL: 1, BLOCKQUOTE: 1, PRE: 1 };

  // Reads the editor back into paragraphs. targets: [{node, off}]
  // DOM points to translate into { p, o } model positions.
  function parse(targets) {
    targets = targets || [];
    var paras = [], cur = null, curLen = 0, lastPs = S.curPs || "ps-body", res = [], trailingBr = false, pxSeen = {};
    function open(ps, px) {
      cur = { ps: M.isId(ps) ? ps : lastPs, runs: [] };
      // a div the browser split off by Enter carries the same key: only the first keeps the ext
      if (px && S.pext[px] && !pxSeen[px]) { pxSeen[px] = 1; cur.ext = JSON.parse(JSON.stringify(S.pext[px])); }
      lastPs = cur.ps; curLen = 0; trailingBr = false;
      paras.push(cur);
    }
    function close() {
      if (cur && trailingBr) {        // the placeholder <br> is not text
        var r = cur.runs[cur.runs.length - 1];
        if (r && !r.f && r.t.charAt(r.t.length - 1) === "\n") { r.t = r.t.slice(0, -1); if (!r.t) cur.runs.pop(); curLen--; }
      }
      cur = null;
    }
    function ensure() { if (!cur) open(null); }
    function hit(node, off) {
      for (var k = 0; k < targets.length; k++) {
        if (!res[k] && targets[k].node === node && targets[k].off === off) { ensure(); res[k] = { p: paras.length - 1, o: curLen }; }
      }
    }
    function hitText(node) {
      for (var k = 0; k < targets.length; k++) {
        if (!res[k] && targets[k].node === node) { ensure(); res[k] = { p: paras.length - 1, o: curLen + Math.min(targets[k].off, node.nodeValue.length) }; }
      }
    }
    function fmtFor(node) {
      var e = node.parentNode, f = {};
      var cs = window.getComputedStyle(e);
      if ((parseInt(cs.fontWeight, 10) || 400) >= 600) f.b = 1;
      if (cs.fontStyle === "italic" || cs.fontStyle === "oblique") f.i = 1;
      for (var a = e; a && a !== ed && !a.hasAttribute("data-ps"); a = a.parentNode) {
        var dl = window.getComputedStyle(a).textDecorationLine || "";
        if (dl.indexOf("underline") >= 0) { f.u = 1; break; }
      }
      var rx = e.closest && e.closest("[data-rx]");
      if (rx && ed.contains(rx) && S.pext[rx.getAttribute("data-rx")]) f.ext = JSON.parse(JSON.stringify(S.pext[rx.getAttribute("data-rx")]));
      var c = e.closest && e.closest("[data-cs]");
      if (c && ed.contains(c) && M.isId(c.getAttribute("data-cs"))) f.cs = c.getAttribute("data-cs");
      return f;
    }
    function sameExt(a, b) { return !a.ext && !b.ext || (a.ext && b.ext && a.ext.href && !a.ext.fn && !a.ext.xr && JSON.stringify(a.ext) === JSON.stringify(b.ext)); }
    function add(run) {
      ensure();
      var last = cur.runs[cur.runs.length - 1];
      if (last && !last.f && !run.f && sameExt(last, run) && last.cs === run.cs && last.b === run.b && last.i === run.i && last.u === run.u) last.t += run.t;
      else cur.runs.push(run);
      curLen += runLen(run);
    }
    function walk(node) {
      if (node.nodeType === 3) {
        hitText(node);
        var v = node.nodeValue.replace(/\r\n?/g, "\n").replace(/​/g, "");
        if (v) { add(withFmt({ t: v }, fmtFor(node))); trailingBr = false; }
        return;
      }
      if (node.nodeType !== 1) return;
      var tag = node.tagName;
      if (tag === "BR") { add({ t: "\n" }); trailingBr = true; return; }
      if (node.hasAttribute("data-f")) {
        var f = node.getAttribute("data-f");
        if (f === "pn" || f === "pc") { add(withFmt({ f: f }, fmtFor(node))); trailingBr = false; }
        if (f === "sec") { add(withFmt({ t: node.getAttribute("data-t") || " ", ext: { fld: "sec" } }, fmtFor(node))); trailingBr = false; }
        if (f === "rx" && S.pext[node.getAttribute("data-rx")]) {
          var fx = fmtFor(node);
          delete fx.ext;
          add(withFmt({ t: node.getAttribute("data-t") || "*", ext: JSON.parse(JSON.stringify(S.pext[node.getAttribute("data-rx")])) }, fx)); trailingBr = false;
        }
        if (f === "del" && S.pext[node.getAttribute("data-rx")]) { add(JSON.parse(JSON.stringify(S.pext[node.getAttribute("data-rx")]))); trailingBr = false; }
        if (f === "sup" && node.getAttribute("data-t")) { add(withFmt({ t: node.getAttribute("data-t"), ext: { sup: 1 } }, fmtFor(node))); trailingBr = false; }
        return;
      }
      var block = BLOCK[tag] && node !== ed;
      if (block) { close(); open(node.getAttribute("data-ps"), node.getAttribute("data-px")); }
      var kids = node.childNodes;
      for (var k = 0; k < kids.length; k++) {
        hit(node, k);
        walk(kids[k]);
      }
      hit(node, kids.length);
      if (block) close();
    }
    walk(ed);
    close();
    if (!paras.length) { open(null); close(); }
    // positions not found (the node vanished): end of the story
    targets.forEach(function (x, k) { if (!res[k]) res[k] = { p: paras.length - 1, o: paraLen(paras[paras.length - 1]) }; });
    // clamp positions that pointed past a dropped placeholder
    res = res.map(function (r) { return { p: r.p, o: Math.min(r.o, paraLen(paras[r.p])) }; });
    return { paras: paras, pos: res };
  }

  // ---------- Model positions → DOM ----------
  function domPoint(p, o) {
    var d = ed.children[Math.max(0, Math.min(p, ed.children.length - 1))];
    if (!d) return { node: ed, off: 0 };
    var count = 0, found = null;
    (function walk(n) {
      if (found) return;
      for (var k = 0; k < n.childNodes.length && !found; k++) {
        var c = n.childNodes[k];
        if (c.nodeType === 3) {
          if (o <= count + c.nodeValue.length) { found = { node: c, off: o - count }; return; }
          count += c.nodeValue.length;
        } else if (c.nodeType === 1) {
          var atom = c.tagName === "BR" || c.hasAttribute("data-f");
          if (atom) {
            if (o === count) { found = { node: n, off: k }; return; }
            if (c.tagName === "BR" && !c.nextSibling && n === d) return;   // placeholder
            var len = /^(sec|sup|rx|del)$/.test(c.getAttribute("data-f")) ? (c.getAttribute("data-t") || "").length : c.getAttribute("data-f") === "tbl" ? 0 : 1;   // a table counts nothing   // a running head or a note's mark counts its own text
            if (o < count + len) { found = { node: n, off: k + 1 }; return; }
            count += len;
          } else walk(c);
        }
      }
    })(d);
    if (found) return found;
    var last = d.lastChild;
    return { node: d, off: last && last.tagName === "BR" ? d.childNodes.length - 1 : d.childNodes.length };
  }
  function setRange(a, b) {
    var s = window.getSelection();
    if (!s) return;
    var A = domPoint(a.p, a.o), B = b ? domPoint(b.p, b.o) : A;
    try {
      var r = document.createRange();
      r.setStart(A.node, A.off); r.setEnd(B.node, B.off);
      s.removeAllRanges(); s.addRange(r);
    } catch (e) {}
  }

  // The current selection inside the editor (or the last one, when a
  // toolbar or panel control has the focus), in model positions.
  function rememberSel() {
    var s = window.getSelection();
    if (!s || !s.rangeCount) return;
    var r = s.getRangeAt(0);
    if (!ed.contains(r.startContainer) || !ed.contains(r.endContainer)) return;
    S.sel = { sn: r.startContainer, so: r.startOffset, en: r.endContainer, eo: r.endOffset };
  }
  function readModel() {
    var tg = S.sel && ed.contains(S.sel.sn) && ed.contains(S.sel.en) ? [{ node: S.sel.sn, off: S.sel.so }, { node: S.sel.en, off: S.sel.eo }] : [];
    var res = parse(tg);
    var a = res.pos[0], b = res.pos[1];
    if (!a) { a = { p: res.paras.length - 1, o: paraLen(res.paras[res.paras.length - 1]) }; b = a; }
    if (b.p < a.p || (b.p === a.p && b.o < a.o)) { var x = a; a = b; b = x; }
    return { paras: res.paras, a: a, b: b };
  }

  // ---------- Saving ----------
  // the Story Editor's text size (LY-N3): 0.8-1.6, on this device
  function zoom() { var z = Number(LY.prefs.stZoom); return z >= 0.8 && z <= 1.6 ? z : 1; }
  function updateFoot(paras) {
    var st = story(), n = 0;
    paras.forEach(function (p, i) { n += paraLen(p) + (i ? 1 : 0); });
    var over = st && ED.L && ED.L.overset[st.id];
    // the paragraphs that do not fit in the frames: a red line beside them (LY-N3)
    var placed = over && ED.L.placed && typeof ED.L.placed[st.id] === "number" ? ED.L.placed[st.id] : Infinity;
    for (var ci = 0; ci < ed.children.length; ci++) ed.children[ci].classList.toggle("sp-over", ci >= placed);
    foot.textContent = t("story.chars", { n: n }) + (over ? " " + t("story.overset") : "");
    foot.classList.toggle("warn", !!over);
    ed.classList.toggle("is-empty", paras.length === 1 && !paras[0].runs.length);
  }

  function commitParas(paras, keepCaret) {
    paras = normParas(paras);
    // track changes (LY-W12): the new text marked against the saved one
    var st0 = story();
    if (st0 && LY.track && LY.track.on() && !S.noTrack) {
      var m0 = keepCaret ? readModel() : null;
      var tr = LY.track.mark(st0.paras, paras, m0 ? [m0.a, m0.b] : null);
      if (keyOf(normParas(tr.paras)) !== keyOf(paras)) {
        paras = normParas(tr.paras);
        if (keepCaret) { render(paras, tr.pos ? { a: tr.pos[0], b: tr.pos[1] } : null); rememberSel(); }
      }
    }
    var key = keyOf(paras), sid = S.sid, baseM = S.baseM;
    S.lastKey = key;
    S.dirty = false;
    clearTimeout(S.timer); S.timer = null;
    LY.op(function (doc, now) {
      var st = M.story(doc, sid);
      if (!st || keyOf(st.paras) === key) return false;
      if (st.m !== baseM) {
        // changed on another device while this editor had unsaved
        // typing: keep that version in Recovered text
        var txt = T.plainText(st);
        if (txt.trim()) doc.rec.push({ id: M.newId("rc"), m: now, sid: sid, t: txt });
      }
      st.h = [st.m].concat(st.h || []);
      st.paras = paras;
      M.touch(st, now);
    });
    var st = story();
    if (st) S.baseM = st.m;
    updateFoot(paras);
  }

  function flush() {
    if (LY.inframe) LY.inframe.flush();
    if (!S.sid || !S.dirty) return;
    var res = parse([]);
    commitParas(res.paras, isOpen() && document.activeElement === ed);
  }
  LY.flushStory = flush;

  function onInput() {
    S.dirty = true;
    clearTimeout(S.timer);
    S.timer = setTimeout(flush, SAVE_MS);
    ed.classList.remove("is-empty");
  }

  // A model-level edit: read the DOM + selection, change paragraphs,
  // re-render, save at once (one undo step).
  function modelEdit(fn) {
    if (!isOpen()) return;
    var m = readModel();
    var range = fn(m.paras, m.a, m.b);
    if (range === false) return;
    var paras = normParas(m.paras);
    render(paras, range);
    ed.focus();
    rememberSel();
    commitParas(paras, true);
    trackPs();
  }

  // ---------- Commands ----------
  function toggle(attr) {
    modelEdit(function (paras, a, b) {
      if (a.p === b.p && a.o === b.o) return false;
      var all = true;
      eachRun(paras, a, b, function (r) { if (!r[attr]) all = false; });
      eachRun(paras, a, b, function (r) { if (all) delete r[attr]; else r[attr] = 1; });
      return { a: a, b: b };
    });
  }

  function insertText(text) {
    text = String(text || "").replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
    if (text.length > 200000) text = text.slice(0, 200000);
    modelEdit(function (paras, a, b) {
      deleteRange(paras, a, b);
      var c = insertAt(paras, a, text, null);
      return { a: c, b: c };
    });
  }

  function breakCmd(kind) {
    modelEdit(function (paras, a, b) {
      deleteRange(paras, a, b);
      var c = insertBreak(paras, a, kind);
      return { a: c, b: c };
    });
  }

  function insertField(f) {
    modelEdit(function (paras, a, b) {
      deleteRange(paras, a, b);
      var c = insertAt(paras, a, "", f);
      return { a: c, b: c };
    });
  }

  // Whole story, when no editor is open but one text frame is selected.
  function selectedStoryOp(fn) {
    var its = ED.selItems().filter(function (it) { return it.t === "text"; });
    if (its.length !== 1) { LY.toast(t("story.none")); return; }
    var sid = its[0].story;
    LY.op(function (doc, now) {
      var st = M.story(doc, sid);
      if (!st) return false;
      var before = keyOf(st.paras);
      fn(st.paras);
      if (keyOf(st.paras) === before) return false;
      st.h = [st.m].concat(st.h || []);
      M.touch(st, now);
    });
  }

  function applyPs(id) {
    if (LY.inframe && LY.inframe.isOn()) { LY.inframe.applyPs(id); return; }
    if (!isOpen()) { selectedStoryOp(function (paras) { paras.forEach(function (p) { p.ps = id; }); }); return; }
    modelEdit(function (paras, a, b) {
      for (var i = a.p; i <= b.p; i++) paras[i].ps = id;
      return { a: a, b: b };
    });
  }

  function applyCs(id) {
    function set(r) { if (id) r.cs = id; else delete r.cs; }
    if (LY.inframe && LY.inframe.isOn()) { LY.inframe.applyCs(id); return; }
    if (!isOpen()) {
      selectedStoryOp(function (paras) { paras.forEach(function (p) { p.runs.forEach(set); }); });
      return;
    }
    modelEdit(function (paras, a, b) {
      if (a.p === b.p && a.o === b.o) return false;
      eachRun(paras, a, b, set);
      return { a: a, b: b };
    });
  }

  // ---------- Toolbar ----------
  function fillSelects() {
    styleMaps();
    function opts(sel, list, none) {
      var v = sel.value;
      sel.innerHTML = "";
      if (none) { var o0 = el("option", "", none); o0.value = ""; sel.appendChild(o0); }
      list.slice().sort(function (x, y) { return LY.T.collate(LY.label(x.name), LY.label(y.name)); }).forEach(function (s) {
        var o = el("option", "", LY.label(s.name)); o.value = s.id; sel.appendChild(o);
      });
      sel.value = v;
    }
    opts(psSel, LY.doc.pstyles, null);
    opts(csSel, LY.doc.cstyles, t("styles.noneChar"));
    psSel.value = S.curPs || "";
  }

  function buildTools() {
    tools.innerHTML = "";
    psSel = el("select", "inp sm"); psSel.setAttribute("aria-label", t("story.ps")); psSel.title = t("story.ps");
    psSel.addEventListener("change", function () { if (psSel.value) applyPs(psSel.value); });
    csSel = el("select", "inp sm"); csSel.setAttribute("aria-label", t("story.cs")); csSel.title = t("story.cs");
    csSel.addEventListener("change", function () { applyCs(csSel.value); csSel.value = ""; });
    tools.appendChild(psSel);
    tools.appendChild(csSel);
    [["bold", "story.b", function () { toggle("b"); }], ["italic", "story.i", function () { toggle("i"); }],
      ["underline", "story.u", function () { toggle("u"); }], ["hash", "story.pn", function () { insertField("pn"); }]
    ].forEach(function (d) {
      var b = LY.iconBtn(d[0], t(d[1]));
      // keep the text selection: no focus change on press
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });
      b.addEventListener("click", d[2]);
      tools.appendChild(b);
    });
    var pc = el("button", "icon-btn sf-btn", "##");
    pc.type = "button"; pc.title = t("story.pc"); pc.setAttribute("aria-label", t("story.pc"));
    pc.addEventListener("mousedown", function (e) { e.preventDefault(); });
    pc.addEventListener("click", function () { insertField("pc"); });
    tools.appendChild(pc);
    // a running head (LY-RH): the page's chapter title, on a master
    var sec = el("button", "icon-btn sf-btn", "§");
    sec.type = "button"; sec.title = t("story.sec"); sec.setAttribute("aria-label", t("story.sec"));
    sec.addEventListener("mousedown", function (e) { e.preventDefault(); });
    sec.addEventListener("click", insertSec);
    tools.appendChild(sec);
    // notes, cross-references and links (LY-W7)
    var nt = el("button", "icon-btn sf-btn", "¹");
    nt.type = "button"; nt.title = t("note.menu"); nt.setAttribute("aria-label", t("note.menu"));
    nt.addEventListener("mousedown", function (e) { e.preventDefault(); });
    nt.addEventListener("click", function () {
      rememberSel();
      LY.menu(nt, [{ label: t("note.ins"), fn: insertNote }, { label: t("xr.ins"), fn: insertXref }, { label: t("link.ins"), fn: linkCmd }, { label: t("ix.ins"), fn: insertIx },
        { label: t("note.settings"), fn: function () { flush(); LY.notes.settings(); } }]);
    });
    tools.appendChild(nt);
    // track changes (LY-W12)
    var trb = el("button", "icon-btn sf-btn trk-btn", "\u270E");
    trb.type = "button"; trb.title = t("trk.menu"); trb.setAttribute("aria-label", t("trk.menu"));
    trb.addEventListener("mousedown", function (e) { e.preventDefault(); });
    trb.addEventListener("click", function () {
      if (!LY.track) return;
      rememberSel(); flush();
      var st = story();
      LY.menu(trb, LY.track.menu(settle, st ? st.paras : []));
    });
    tools.appendChild(trb);
    // a table (LY-W12)
    var tbb = el("button", "icon-btn sf-btn", "\u25A6");
    tbb.type = "button"; tbb.title = t("tbl.ins"); tbb.setAttribute("aria-label", t("tbl.ins"));
    tbb.addEventListener("mousedown", function (e) { e.preventDefault(); });
    tbb.addEventListener("click", insertTable);
    tools.appendChild(tbb);
    // break characters (LY-W5b)
    var brk = el("button", "icon-btn sf-btn", "⤓");
    brk.type = "button"; brk.title = t("brk.menu"); brk.setAttribute("aria-label", t("brk.menu"));
    brk.addEventListener("mousedown", function (e) { e.preventDefault(); });
    brk.addEventListener("click", function () {
      LY.menu(brk, ["col", "page", "odd", "even"].map(function (k) { return { label: t("brk.ins." + k), fn: function () { breakCmd(k); } }; }));
    });
    tools.appendChild(brk);
    // style names beside the paragraphs, and the text size (LY-N3)
    var nm = el("button", "icon-btn sf-btn" + (LY.prefs.stNames ? " on" : ""), "¶");
    nm.type = "button"; nm.title = t("story.names"); nm.setAttribute("aria-label", t("story.names"));
    nm.setAttribute("aria-pressed", LY.prefs.stNames ? "true" : "false");
    nm.addEventListener("mousedown", function (e) { e.preventDefault(); });
    nm.addEventListener("click", function () {
      if (LY.prefs.stNames) delete LY.prefs.stNames; else LY.prefs.stNames = 1;
      LY.savePrefs();
      ed.classList.toggle("names", !!LY.prefs.stNames);
      nm.classList.toggle("on", !!LY.prefs.stNames);
      nm.setAttribute("aria-pressed", LY.prefs.stNames ? "true" : "false");
    });
    tools.appendChild(nm);
    [["A−", "story.smaller", -0.1], ["A+", "story.bigger", 0.1]].forEach(function (z) {
      var b = el("button", "icon-btn sf-btn", z[0]);
      b.type = "button"; b.title = t(z[1]); b.setAttribute("aria-label", t(z[1]));
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });
      b.addEventListener("click", function () {
        var v = Math.round(Math.max(0.8, Math.min(1.6, zoom() + z[2])) * 10) / 10;
        if (v === 1) delete LY.prefs.stZoom; else LY.prefs.stZoom = v;
        LY.savePrefs();
        flush();
        var st = story();
        if (st) { var m = readModel(); render(st.paras, { a: clampPos(st.paras, m.a), b: clampPos(st.paras, m.b) }); }
      });
      tools.appendChild(b);
    });
    ed.classList.toggle("names", !!LY.prefs.stNames);
  }
  function insertSec() {
    var fb = String(LY.doc.name || "").trim().slice(0, 120) || "§";
    modelEdit(function (paras, a, b) {
      deleteRange(paras, a, b);
      var p = paras[a.p], i = cut(p, a.o);
      p.runs.splice(i, 0, withFmt({ t: fb, ext: { fld: "sec" } }, fmtAt(paras, a)));
      var c = { p: a.p, o: a.o + fb.length };
      return { a: c, b: c };
    });
  }

  // the story changed under the editor by a command of its own (an
  // anchor on a paragraph): shown again, the caret kept
  function reload() {
    if (!isOpen()) return;
    var m = readModel(), st = story();
    if (!st) return;
    S.baseM = st.m;
    render(JSON.parse(JSON.stringify(st.paras)), { a: m.a, b: m.b });
    rememberSel();
  }

  // ---------- Notes, cross-references and links (LY-W7) ----------
  function newNoteId() { return "n" + Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, "") + (Date.now() % 1000); }
  // a footnote or endnote here: its text asked first; the reference
  // is one piece that holds the note (ext.fn id, ext.ft text)
  function insertNote() {
    if (!isOpen() || !LY.notes) return;
    rememberSel();
    LY.notes.editNote("", function (txt) {
      if (txt === null || !txt.trim()) return;
      modelEdit(function (paras, a, b) {
        var p = paras[b.p], i = cut(p, b.o);
        p.runs.splice(i, 0, withFmt({ t: "*", ext: { fn: newNoteId(), ft: txt.slice(0, 4000) } }, fmtAt(paras, b)));
        var c = { p: b.p, o: b.o + 1 };
        return { a: c, b: c };
      });
    });
  }
  // ---------- Index entries (LY-W13) ----------
  // the selected words become an index entry (run ext.ix)
  function insertIx() {
    if (!isOpen() || !LY.bookIndex) return;
    var m = readModel();
    if (m.a.p === m.b.p && m.a.o === m.b.o) { LY.toast(t("ix.select")); return; }
    var words = "";
    eachRun(m.paras, m.a, m.b, function (r) { if (!r.f) words += r.t; });
    LY.bookIndex.entryDlg(words, function (ix) {
      modelEdit(function (paras, a, b) {
        if (a.p === b.p && a.o === b.o) return false;
        eachRun(paras, a, b, function (r) { if (r.f || (r.ext && (r.ext.fn || r.ext.xr || r.ext.del))) return; r.ext = Object.assign({}, r.ext || {}, { ix: JSON.parse(JSON.stringify(ix)) }); });
        return { a: a, b: b };
      });
    });
  }

  // ---------- Track changes (LY-W12) ----------
  // accept or reject the changes in the selection (or all), untracked
  function settle(fn, all) {
    if (!isOpen()) {
      selectedStoryOp(function (paras) { var r = fn(paras, null); paras.length = 0; r.paras.forEach(function (p) { paras.push(p); }); });
      return;
    }
    var n = 0;
    S.noTrack = true;
    try {
      modelEdit(function (paras, a, b) {
        var r = fn(paras, all ? null : { a: a, b: b });
        n = r.n;
        if (!n) return false;
        paras.length = 0;
        r.paras.forEach(function (p) { paras.push(p); });
        var c = { p: Math.min(a.p, paras.length - 1), o: 0 };
        return { a: c, b: c };
      });
    } finally { S.noTrack = false; }
    LY.toast(t(n ? "trk.done" : "trk.none", { n: n }));
  }
  function showTrk() { var b = tools && tools.querySelector(".trk-btn"); if (b) { var on = !!(LY.track && LY.track.on()); b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); } }

  // ---------- Tables (LY-W12) ----------
  // a new table at the caret: before the caret's paragraph when the
  // caret is at its start, after it at its end, else the paragraph
  // splits there
  function insertTable() {
    if (!isOpen() || !LY.tables) return;
    flush();
    rememberSel();
    LY.tables.edit(null, function (tb) {
      if (!tb) return;
      modelEdit(function (paras, a, b) {
        deleteRange(paras, a, b);
        var p = paras[a.p], at;
        if (a.o === 0 && (paraLen(p) || paras.length > 1)) at = a.p;
        else if (a.o >= paraLen(p)) at = a.p + 1;
        else { var c = insertAt(paras, a, "\n", null); at = c.p; }
        paras.splice(at, 0, { ps: S.curPs || p.ps, runs: [], ext: { tbl: tb } });
        // an empty story's one paragraph gives way to the table
        if (paras.length === 2 && at === 1 && !paraLen(paras[0]) && !paras[0].ext) { paras.shift(); at = 0; }
        var to = Math.min(at + 1, paras.length - 1);
        if (to === at) { paras.push({ ps: p.ps, runs: [] }); to = at + 1; }
        return { a: { p: to, o: 0 }, b: { p: to, o: 0 } };
      });
      tableLevel();
    });
  }
  function editTableAt(i) {
    flush();
    var st = story(), p = st && st.paras[i];
    if (!p || !p.ext || !p.ext.tbl) return;
    LY.tables.edit(p.ext.tbl, function (tb) {
      modelEdit(function (paras) {
        var q = paras[i];
        if (!q || !q.ext || !q.ext.tbl) return false;
        if (!tb) { paras.splice(i, 1); if (!paras.length) paras.push({ ps: q.ps, runs: [] }); return { a: { p: Math.max(0, i - 1), o: 0 }, b: { p: Math.max(0, i - 1), o: 0 } }; }
        q.ext = Object.assign({}, q.ext, { tbl: tb });
        return { a: { p: i, o: 0 }, b: { p: i, o: 0 } };
      });
      tableLevel();
    }, { canRemove: true });
  }
  // a table over the usual size: the document needs model level 3
  function tableLevel() { if (M.tableLevel(LY.doc) > 1 && !(LY.doc.setup.ext && LY.doc.setup.ext.mv >= 3)) LY.op(function (doc, now) { LY.tables.level(doc, now); }); }

  // a note's text changed or the note removed (null text)
  function setNote(id, txt) {
    modelEdit(function (paras) {
      var hit = false;
      paras.forEach(function (p) {
        p.runs = p.runs.filter(function (r) {
          if (!r.ext || r.ext.fn !== id) return true;
          hit = true;
          if (txt === null) return false;
          r.ext = JSON.parse(JSON.stringify(r.ext));
          r.ext.ft = txt.slice(0, 4000);
          return true;
        });
      });
      return hit ? undefined : false;
    });
  }
  function editNoteAt(node) {
    var id = node.getAttribute("data-fn"), x = S.pext[node.getAttribute("data-rx")];
    if (!id || !x) return;
    LY.notes.editNote(String(x.ft || ""), function (txt) {
      if (txt === null) return;
      setNote(id, txt.trim() ? txt : null);
    }, true);
  }
  // a cross-reference to a paragraph anywhere in the document
  function insertXref() {
    if (!isOpen() || !LY.notes) return;
    flush();
    rememberSel();
    LY.notes.pickAnchor(function (to, k) {
      if (!to) return;
      modelEdit(function (paras, a, b) {
        deleteRange(paras, a, b);
        var p = paras[a.p], i = cut(p, a.o);
        p.runs.splice(i, 0, withFmt({ t: "?", ext: { xr: { to: to, k: k } } }, fmtAt(paras, a)));
        var c = { p: a.p, o: a.o + 1 };
        return { a: c, b: c };
      });
    });
  }
  // a link on the selected words (ext.href; empty removes it)
  function linkCmd() {
    if (!isOpen() || !LY.notes) return;
    rememberSel();
    var m = readModel(), cur = "";
    if (m.a.p === m.b.p && m.a.o === m.b.o) { LY.toast(t("link.pick")); return; }
    eachRun(m.paras, m.a, m.b, function (r) { if (!cur && r.ext && r.ext.href) cur = r.ext.href; });
    LY.notes.editLink(cur, function (url) {
      if (url === null) return;
      modelEdit(function (paras, a, b) {
        eachRun(paras, a, b, function (r) {
          if (r.f || (r.ext && (r.ext.fn || r.ext.xr))) return;
          var x = r.ext ? JSON.parse(JSON.stringify(r.ext)) : {};
          if (url) x.href = url; else delete x.href;
          if (Object.keys(x).length) r.ext = x; else delete r.ext;
        });
        return { a: a, b: b };
      });
    });
  }

  // Paragraph style under the caret (style list + panel highlight).
  function trackPs() {
    var ps = null;
    if (S.sel && ed.contains(S.sel.sn)) {
      var n = S.sel.sn.nodeType === 1 ? S.sel.sn : S.sel.sn.parentNode;
      var d = n.closest && n.closest("[data-ps]");
      if (d && ed.contains(d)) ps = d.getAttribute("data-ps");
    }
    if (ps && ps !== S.curPs) {
      S.curPs = ps;
      if (psSel) psSel.value = ps;
      LY.emit("story");
    }
  }

  // ---------- Open / close ----------
  function open(itemId) {
    if (LY.inframe && LY.inframe.isOn()) LY.inframe.stop();
    flush();
    var it = M.find(LY.doc.items, itemId);
    if (!it || it.t !== "text") { LY.toast(t("story.none")); return; }
    var st = M.story(LY.doc, it.story);
    if (!st) return;
    S.sid = st.id; S.item = it.id; S.baseM = st.m; S.dirty = false; S.sel = null;
    S.curPs = st.paras[0] ? st.paras[0].ps : "ps-body";
    $("story-title").textContent = t("story.title");
    buildTools(); showTrk();
    fillSelects();
    $("story").hidden = false;
    document.body.classList.add("story-open");
    render(st.paras, { a: { p: 0, o: 0 } });
    ed.focus();
    rememberSel();
    LY.emit("story");
    ED.render();
  }

  // Open a story (its first frame) with a range selected: a Find/Change
  // or spelling hit (LY-W5).
  function openAt(sid, p, s, e) {
    var it = null;
    (LY.doc.items || []).forEach(function (x) { if (!it && x.t === "text" && x.story === sid) it = x; });
    if (!it) return false;
    if (S.sid !== sid) open(it.id);
    if (S.sid !== sid) return false;
    var st = story();
    if (!st || !st.paras[p]) return false;
    var a = clampPos(st.paras, { p: p, o: s }), b = clampPos(st.paras, { p: p, o: e });
    ed.focus();
    setRange(a, b);
    rememberSel();
    var node = ed.children[a.p];
    if (node && node.scrollIntoView) node.scrollIntoView({ block: "center" });
    trackPs();
    return true;
  }

  function close() {
    if (!S.sid) return;
    flush();
    S.sid = null; S.item = null; S.sel = null; S.dirty = false;
    clearTimeout(S.timer); S.timer = null;
    $("story").hidden = true;
    document.body.classList.remove("story-open");
    ed.innerHTML = "";
    LY.emit("story");
    ED.render();
  }

  // The document changed (undo, a panel, another device): re-render
  // when the story is not being typed into, keeping the caret.
  function onDoc() {
    if (!isOpen()) return;
    var st = story();
    if (!st) { S.dirty = false; close(); return; }
    fillSelects();
    showTrk();
    if (S.dirty) { updateFoot(parse([]).paras); return; }
    S.baseM = st.m;
    if (keyOf(st.paras) === S.lastKey) { updateFoot(st.paras); return; }
    var hadFocus = document.activeElement === ed;
    var m = readModel();
    render(st.paras, hadFocus ? { a: clampPos(st.paras, m.a), b: clampPos(st.paras, m.b) } : null);
    if (hadFocus) rememberSel();
  }
  function clampPos(paras, p) {
    var pi = Math.min(p.p, paras.length - 1);
    return { p: pi, o: Math.min(p.o, paraLen(paras[pi])) };
  }

  // ---------- Wiring ----------
  function wire() {
    ed = $("story-ed"); tools = $("story-tools"); foot = $("story-foot");
    ed.setAttribute("data-ph", t("story.empty"));
    ed.setAttribute("aria-label", t("story.title"));
    LY.setIcon($("story-close"), "close", t("btn.close"));
    $("story-close").addEventListener("click", close);
    try { document.execCommand("defaultParagraphSeparator", false, "div"); } catch (e) {}

    ed.addEventListener("click", function (e) {
      var n = e.target && e.target.closest ? e.target.closest(".sfn") : null;
      if (n && ed.contains(n) && LY.notes) { e.preventDefault(); rememberSel(); editNoteAt(n); }
      var tb = e.target && e.target.closest ? e.target.closest(".sp-tbl") : null;
      if (tb && ed.contains(tb) && LY.tables) { e.preventDefault(); editTableAt(Array.prototype.indexOf.call(ed.children, tb)); }
    });
    ed.addEventListener("input", onInput);
    ed.addEventListener("blur", flush);
    ed.addEventListener("paste", function (e) {
      e.preventDefault();
      var txt = "";
      try { txt = (e.clipboardData || window.clipboardData).getData("text/plain"); } catch (x) {}
      if (txt) insertText(txt);
    });
    // nothing is dropped in as markup
    ed.addEventListener("dragover", function (e) { e.preventDefault(); });
    ed.addEventListener("drop", function (e) {
      e.preventDefault();
      var txt = "";
      try { txt = e.dataTransfer.getData("text/plain"); } catch (x) {}
      if (txt) insertText(txt);
    });
    ed.addEventListener("keydown", function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      // Numpad Enter: a column break; with Ctrl, a page break (LY-W5b, as in InDesign)
      if (e.code === "NumpadEnter" && !e.shiftKey && !e.altKey) { e.preventDefault(); breakCmd(mod ? "page" : "col"); return; }
      // Enter in a style with a next style goes through the model, so it applies (LY-W5)
      if (e.key === "Enter" && !e.shiftKey && !mod && !e.altKey && !e.isComposing && S.curPs && nextPs(S.curPs) !== S.curPs) { e.preventDefault(); insertText("\n"); return; }
      if (!mod || e.altKey) return;
      var c = e.code;
      if (c === "KeyB") { e.preventDefault(); toggle("b"); }
      else if (c === "KeyI") { e.preventDefault(); toggle("i"); }
      else if (c === "KeyU") { e.preventDefault(); toggle("u"); }
      else if (c === "KeyZ") { e.preventDefault(); if (e.shiftKey) LY.redo(); else LY.undo(); }
      else if (c === "KeyY") { e.preventDefault(); LY.redo(); }
      else if (c === "KeyS") { e.preventDefault(); flush(); }
      else if (c === "KeyF" && LY.dlg && LY.dlg.find) { e.preventDefault(); LY.dlg.find(); }
    });
    document.addEventListener("selectionchange", function () {
      if (!isOpen()) return;
      var s = window.getSelection();
      if (!s || !s.rangeCount || !ed.contains(s.getRangeAt(0).startContainer)) return;
      rememberSel();
      trackPs();
    });

    LY.on("doc", onDoc);
    LY.on("remote", onDoc);
    LY.on("drawn", function () { if (isOpen() && !S.dirty) updateFoot(story() ? story().paras : []); });
    LY.on("open", close);
    LY.on("close", close);
  }

  LY.story = {
    open: open, openAt: openAt, close: close, isOpen: isOpen, flush: flush, sid: function () { return S.sid; },
    currentPs: function () {
      if (LY.inframe && LY.inframe.isOn()) return LY.inframe.currentPs();
      if (isOpen()) return S.curPs;
      var its = ED.selItems().filter(function (it) { return it.t === "text"; });
      var st = its.length === 1 ? M.story(LY.doc, its[0].story) : null;
      return st && st.paras[0] ? st.paras[0].ps : null;
    },
    applyPs: applyPs, applyCs: applyCs, insertNote: insertNote, insertXref: insertXref, link: linkCmd, reload: reload
  };
  // paragraph helpers shared with in-frame editing (inframe.js)
  LY.storyOps = { insertBreak: insertBreak, nextPs: nextPs, runLen: runLen, paraLen: paraLen, cut: cut, eachRun: eachRun, deleteRange: deleteRange, fmtAt: fmtAt, insertAt: insertAt };
  LY.on("boot", wire);
})();
