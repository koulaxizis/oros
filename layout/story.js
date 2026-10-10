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

  var S = { sid: null, item: null, dirty: false, baseM: 0, lastKey: "", timer: null, sel: null, curPs: null };
  var ed, tools, foot, psSel, csSel;

  function story() { return S.sid && LY.doc ? M.story(LY.doc, S.sid) : null; }
  function keyOf(paras) { return JSON.stringify(paras); }
  function isOpen() { return !!S.sid && !$("story").hidden; }

  // ---------- Model helpers (paragraph arrays) ----------
  function runLen(r) { return r.f ? 1 : r.t.length; }
  function paraLen(p) { var n = 0; p.runs.forEach(function (r) { n += runLen(r); }); return n; }
  function fmtOf(r) { var o = {}; if (r.cs) o.cs = r.cs; if (r.b) o.b = 1; if (r.i) o.i = 1; if (r.u) o.u = 1; return o; }
  function withFmt(o, fmt) { Object.keys(fmt).forEach(function (k) { o[k] = fmt[k]; }); return o; }

  // Make sure a run boundary sits at offset `off`; returns the index
  // of the first run at or after it.
  function cut(p, off) {
    var pos = 0;
    for (var i = 0; i < p.runs.length; i++) {
      var r = p.runs[i], n = runLen(r);
      if (off <= pos) return i;
      if (off < pos + n) {            // only text runs are longer than 1
        var a = withFmt({ t: r.t.slice(0, off - pos) }, fmtOf(r));
        var b = withFmt({ t: r.t.slice(off - pos) }, fmtOf(r));
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

  // Insert plain text (a newline starts a paragraph) or a field run.
  // Returns the caret after it.
  function insertAt(paras, at, text, field) {
    var fmt = fmtAt(paras, at), p = paras[at.p], i = cut(p, at.o);
    if (field) { p.runs.splice(i, 0, withFmt({ f: field }, fmt)); return { p: at.p, o: at.o + 1 }; }
    var lines = text.split("\n");
    var tail = p.runs.splice(i);
    if (lines[0]) p.runs.push(withFmt({ t: lines[0] }, fmt));
    var cur = p, caret = { p: at.p, o: at.o + lines[0].length };
    for (var k = 1; k < lines.length; k++) {
      cur = { ps: p.ps, runs: lines[k] ? [withFmt({ t: lines[k] }, fmt)] : [] };
      paras.splice(at.p + k, 0, cur);
      caret = { p: at.p + k, o: lines[k].length };
    }
    cur.runs = cur.runs.concat(tail);
    return caret;
  }

  function normParas(paras) {
    var out = [];
    paras.forEach(function (p) { var n = M.normPara(p); if (n) out.push(n); });
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
    var ps = T.resolvePs(psMap, p.ps);
    d.style.fontFamily = familyCss(ps.font);
    d.style.fontSize = Math.max(13, Math.min(26, ps.size * 1.25)) + "px";
    d.style.textAlign = ps.align === "c" ? "center" : ps.align === "r" ? "right" : "left";
    var endsWithBr = false;
    p.runs.forEach(function (r) {
      var node;
      if (r.f) {
        node = el("span", "sf", r.f === "pn" ? "#" : "##");
        node.contentEditable = "false";
        node.setAttribute("data-f", r.f);
        node.title = t(r.f === "pn" ? "story.pn" : "story.pc");
        endsWithBr = false;
      } else {
        node = document.createDocumentFragment();
        r.t.split("\n").forEach(function (part, k) {
          if (k) node.appendChild(document.createElement("br"));
          if (part) node.appendChild(document.createTextNode(part));
        });
        endsWithBr = r.t.charAt(r.t.length - 1) === "\n";
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

  function render(paras, range) {
    styleMaps();
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
    var paras = [], cur = null, curLen = 0, lastPs = S.curPs || "ps-body", res = [], trailingBr = false;
    function open(ps) {
      cur = { ps: M.isId(ps) ? ps : lastPs, runs: [] };
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
      var c = e.closest && e.closest("[data-cs]");
      if (c && ed.contains(c) && M.isId(c.getAttribute("data-cs"))) f.cs = c.getAttribute("data-cs");
      return f;
    }
    function add(run) {
      ensure();
      var last = cur.runs[cur.runs.length - 1];
      if (last && !last.f && !run.f && last.cs === run.cs && last.b === run.b && last.i === run.i && last.u === run.u) last.t += run.t;
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
        if (f === "pn" || f === "pc") { add(withFmt({ f: f }, fmtFor(node.firstChild || node))); trailingBr = false; }
        return;
      }
      var block = BLOCK[tag] && node !== ed;
      if (block) { close(); open(node.getAttribute("data-ps")); }
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
            count += 1;
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
  function updateFoot(paras) {
    var st = story(), n = 0;
    paras.forEach(function (p, i) { n += paraLen(p) + (i ? 1 : 0); });
    var over = st && ED.L && ED.L.overset[st.id];
    foot.textContent = t("story.chars", { n: n }) + (over ? " " + t("story.overset") : "");
    foot.classList.toggle("warn", !!over);
    ed.classList.toggle("is-empty", paras.length === 1 && !paras[0].runs.length);
  }

  function commitParas(paras) {
    paras = normParas(paras);
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
    commitParas(res.paras);
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
    commitParas(paras);
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
      list.slice().sort(function (x, y) { return LY.label(x.name).localeCompare(LY.label(y.name)); }).forEach(function (s) {
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
    buildTools();
    fillSelects();
    $("story").hidden = false;
    document.body.classList.add("story-open");
    render(st.paras, { a: { p: 0, o: 0 } });
    ed.focus();
    rememberSel();
    LY.emit("story");
    ED.render();
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
      if (!mod || e.altKey) return;
      var c = e.code;
      if (c === "KeyB") { e.preventDefault(); toggle("b"); }
      else if (c === "KeyI") { e.preventDefault(); toggle("i"); }
      else if (c === "KeyU") { e.preventDefault(); toggle("u"); }
      else if (c === "KeyZ") { e.preventDefault(); if (e.shiftKey) LY.redo(); else LY.undo(); }
      else if (c === "KeyY") { e.preventDefault(); LY.redo(); }
      else if (c === "KeyS") { e.preventDefault(); flush(); }
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
    open: open, close: close, isOpen: isOpen,
    currentPs: function () {
      if (LY.inframe && LY.inframe.isOn()) return LY.inframe.currentPs();
      if (isOpen()) return S.curPs;
      var its = ED.selItems().filter(function (it) { return it.t === "text"; });
      var st = its.length === 1 ? M.story(LY.doc, its[0].story) : null;
      return st && st.paras[0] ? st.paras[0].ps : null;
    },
    applyPs: applyPs, applyCs: applyCs
  };
  // paragraph helpers shared with in-frame editing (inframe.js)
  LY.storyOps = { runLen: runLen, paraLen: paraLen, cut: cut, eachRun: eachRun, deleteRange: deleteRange, fmtAt: fmtAt, insertAt: insertAt };
  LY.on("boot", wire);
})();
