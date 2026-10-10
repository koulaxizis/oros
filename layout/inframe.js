// ============================================================
// orOS Layout — typing straight into text frames (v1.0.0)
// Double-click a text frame (or click one with the Text tool, or
// press Enter on it) and type where the text sits on the page, like
// InDesign's Type tool. The caret, the selection and the live reflow
// follow the frame through its thread, columns and rotation.
//   - Edits change a working copy of the story; it is laid out at
//     once (live reflow) and saved like the Story Editor: after a
//     short pause, on leaving, before undo. One save = one undo step,
//     a concurrent edit on another device goes to Recovered text.
//   - Keys come through a hidden textarea at the caret (mobile
//     keyboards, IME composition, paste).
// Uses layout/caret.js for the geometry and the Story Editor's
// paragraph helpers (LY.storyOps).
// ============================================================
(function () {
  "use strict";

  var LY = window.LY, M = LY.M, T = LY.T, R = LY.R, t = LY.t, $ = LY.$;
  var ED = LY.ed, C = window.LY_CARET;
  var SAVE_MS = 700, SENT = "\u200b";
  var F = { on: false, sid: null, paras: null, a: null, b: null, goal: null, dirty: false, baseM: 0, timer: null,
            blink: true, blinkT: null, drag: false, composing: false, clicks: 0, lastClick: 0, lastPos: null };
  var ta = null;

  function O() { return LY.storyOps; }
  function story() { return F.sid && LY.doc ? M.story(LY.doc, F.sid) : null; }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function keyOf(paras) { return JSON.stringify(paras); }
  function lines() { return C.flow(LY.doc, ED.L, F.sid); }
  function norm(paras) {
    var out = [];
    paras.forEach(function (p) { var n = M.normPara(p); if (n) out.push(n); });
    if (!out.length) out.push({ ps: "ps-body", runs: [] });
    return out;
  }
  function clamp(pos) {
    var ps = F.paras, p = Math.max(0, Math.min(ps.length - 1, pos.p));
    return { p: p, o: Math.max(0, Math.min(O().paraLen(ps[p]), pos.o)) };
  }
  function ordered() { return C.cmp(F.a, F.b) <= 0 ? [F.a, F.b] : [F.b, F.a]; }
  function collapsed() { return F.a.p === F.b.p && F.a.o === F.b.o; }

  // The document the editor lays out: the working copy of the story
  // in place of the saved one (nothing stamped, nothing saved).
  function layoutDoc(doc) {
    if (!F.on || !F.dirty) return doc;
    var d = {}, sid = F.sid, paras = F.paras;
    Object.keys(doc).forEach(function (k) { d[k] = doc[k]; });
    d.stories = doc.stories.map(function (s) { return s.id === sid ? { id: s.id, m: s.m, h: s.h, paras: paras } : s; });
    return d;
  }

  // ---------- saving ----------
  function commit() {
    clearTimeout(F.timer); F.timer = null;
    if (!F.on || !F.dirty) return;
    var paras = norm(F.paras), key = keyOf(paras), sid = F.sid, baseM = F.baseM;
    F.dirty = false;
    LY.op(function (doc, now) {
      var st = M.story(doc, sid);
      if (!st || keyOf(st.paras) === key) return false;
      if (st.m !== baseM) {
        var txt = T.plainText(st);
        if (txt.trim()) doc.rec.push({ id: M.newId("rc"), m: now, sid: sid, t: txt });
      }
      st.h = [st.m].concat(st.h || []);
      st.paras = paras;
      M.touch(st, now);
    });
    var st = story();
    if (st) F.baseM = st.m;
  }
  // the styles panel follows the paragraph under the caret
  var lastPs = null;
  function psChanged() {
    var ps = F.on ? F.paras[F.b.p].ps : null;
    if (ps !== lastPs) { lastPs = ps; LY.emit("story"); }
  }
  function changed() {
    F.dirty = true;
    clearTimeout(F.timer);
    F.timer = setTimeout(commit, SAVE_MS);
    ED.relayout();
    F.blink = true;
    ED.render();
    place();
    psChanged();
  }
  // fn(paras, a, b) → new caret {a, b} or false
  function edit(fn) {
    var o = ordered(), r = fn(F.paras, o[0], o[1]);
    if (r === false) return;
    F.paras = norm(F.paras);
    F.a = clamp(r.a); F.b = clamp(r.b);
    F.goal = null;
    changed();
    focus();
  }

  // ---------- commands ----------
  function insert(text) {
    text = String(text || "").replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b]/g, "");
    if (!text) return;
    if (text.length > 200000) text = text.slice(0, 200000);
    edit(function (paras, a, b) {
      O().deleteRange(paras, a, b);
      var c = O().insertAt(paras, a, text, null);
      return { a: c, b: c };
    });
  }
  // Shift+Enter: a line break inside the paragraph
  function lineBreak() {
    edit(function (paras, a, b) {
      O().deleteRange(paras, a, b);
      var p = paras[a.p], fmt = O().fmtAt(paras, a), i = O().cut(p, a.o), r = { t: "\n" };
      Object.keys(fmt).forEach(function (k) { r[k] = fmt[k]; });
      p.runs.splice(i, 0, r);
      var c = { p: a.p, o: a.o + 1 };
      return { a: c, b: c };
    });
  }
  function del(dir, byWord) {
    edit(function (paras, a, b) {
      if (a.p !== b.p || a.o !== b.o) { O().deleteRange(paras, a, b); return { a: a, b: a }; }
      var other = C.step(paras, a, dir, byWord);
      if (other.p === a.p && other.o === a.o) return false;
      var s = dir < 0 ? other : a, e = dir < 0 ? a : other;
      O().deleteRange(paras, s, e);
      return { a: s, b: s };
    });
  }
  function toggle(attr) {
    if (collapsed()) return;
    edit(function (paras, a, b) {
      var all = true;
      O().eachRun(paras, a, b, function (r) { if (!r[attr]) all = false; });
      O().eachRun(paras, a, b, function (r) { if (all) delete r[attr]; else r[attr] = 1; });
      return { a: F.a, b: F.b };
    });
  }
  function applyPs(id) {
    edit(function (paras, a, b) {
      for (var i = a.p; i <= b.p; i++) paras[i].ps = id;
      return { a: F.a, b: F.b };
    });
  }
  function applyCs(id) {
    if (collapsed()) return;
    edit(function (paras, a, b) {
      O().eachRun(paras, a, b, function (r) { if (id) r.cs = id; else delete r.cs; });
      return { a: F.a, b: F.b };
    });
  }
  function selectedText() {
    if (collapsed()) return "";
    var o = ordered(), out = [];
    for (var p = o[0].p; p <= o[1].p; p++) {
      var s = C.paraText(F.paras[p]).replace(/\uFFFC/g, "");
      out.push(s.slice(p === o[0].p ? o[0].o : 0, p === o[1].p ? o[1].o : s.length));
    }
    return out.join("\n");
  }
  function copy() {
    var s = selectedText();
    if (!s) return false;
    try { navigator.clipboard.writeText(s); } catch (e) { void e; }
    return true;
  }

  // ---------- caret movement ----------
  function moveTo(pos, extend) {
    pos = clamp(pos);
    F.b = pos;
    if (!extend) F.a = pos;
    F.blink = true;
    ED.render();
    place();
    psChanged();
  }
  function moveKey(e) {
    var ext = e.shiftKey, word = e.ctrlKey || e.altKey || e.metaKey, k = e.key, ls = lines();
    var o = ordered();
    if ((k === "ArrowLeft" || k === "ArrowRight") && !ext && !collapsed() && !word) { moveTo(k === "ArrowLeft" ? o[0] : o[1], false); return; }
    if (k === "ArrowLeft") { F.goal = null; moveTo(C.step(F.paras, F.b, -1, word), ext); return; }
    if (k === "ArrowRight") { F.goal = null; moveTo(C.step(F.paras, F.b, 1, word), ext); return; }
    if (k === "ArrowUp" || k === "ArrowDown") {
      var dir = k === "ArrowUp" ? -1 : 1, loc = C.locate(ls, F.b);
      if (F.goal === null && loc) F.goal = loc.x;
      var to = C.lineMove(ls, F.b, dir, F.goal === null ? 0 : F.goal);
      if (!to) to = dir < 0 ? { p: 0, o: 0 } : { p: F.paras.length - 1, o: O().paraLen(F.paras[F.paras.length - 1]) };
      var g = F.goal; moveTo(to, ext); F.goal = g;
      return;
    }
    F.goal = null;
    if (k === "Home") { moveTo(word ? { p: 0, o: 0 } : C.lineEdge(ls, F.b, -1), ext); return; }
    if (k === "End") {
      var last = F.paras.length - 1;
      moveTo(word ? { p: last, o: O().paraLen(F.paras[last]) } : C.lineEdge(ls, F.b, 1), ext);
    }
  }

  function onKey(e) {
    if (!F.on || F.composing || e.isComposing) return;
    var k = e.key, mod = e.ctrlKey || e.metaKey;
    if (mod && e.altKey && e.shiftKey) return;           // shell shortcuts
    var nav = { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1, Home: 1, End: 1 };
    if (nav[k]) { e.preventDefault(); moveKey(e); return; }
    if (k === "Escape") { e.preventDefault(); stop(true); return; }
    if (k === "Backspace") { e.preventDefault(); del(-1, mod || e.altKey); return; }
    if (k === "Delete") { e.preventDefault(); del(1, mod || e.altKey); return; }
    if (k === "Enter") { e.preventDefault(); if (e.shiftKey) lineBreak(); else insert("\n"); return; }
    if (k === "Tab") { e.preventDefault(); insert(" "); return; }
    if (!mod) return;
    var code = e.code;
    if (code === "KeyB") { e.preventDefault(); toggle("b"); }
    else if (code === "KeyI") { e.preventDefault(); toggle("i"); }
    else if (code === "KeyU") { e.preventDefault(); toggle("u"); }
    else if (code === "KeyA") { e.preventDefault(); F.a = { p: 0, o: 0 }; moveTo({ p: F.paras.length - 1, o: O().paraLen(F.paras[F.paras.length - 1]) }, true); }
    else if (code === "KeyZ" || code === "KeyY") {
      e.preventDefault();
      commit();
      if (code === "KeyY" || e.shiftKey) LY.redo(); else LY.undo();
    }
    else if (code === "KeyC") { if (copy()) e.preventDefault(); }
    else if (code === "KeyX") { if (copy()) { e.preventDefault(); del(1, false); } }
    // Ctrl+V: the paste event brings the text
  }

  // text typed into the hidden textarea (after the sentinel)
  function takeInput() {
    var v = ta.value;
    if (v.indexOf(SENT) !== 0) {
      // the sentinel itself was deleted (mobile Backspace)
      if (!v) del(-1, false);
      else insert(v.replace(SENT, ""));
    } else if (v.length > SENT.length) insert(v.slice(SENT.length));
    resetTa();
  }
  function resetTa() {
    ta.value = SENT;
    try { ta.setSelectionRange(SENT.length, SENT.length); } catch (e) { void e; }
  }

  // ---------- geometry ----------
  // frame-local point → screen (CSS px)
  function toScreen(it, lx, ly) {
    var P = LY.pOf(it);
    if (!P) return null;
    var a = (it.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    var dx = lx - it.w / 2, dy = ly - it.h / 2;
    var wx = P.x + it.x + it.w / 2 + dx * c - dy * s, wy = P.y + it.y + it.h / 2 + dx * s + dy * c;
    return ED.toScreen(wx, wy);
  }
  // the chain frame under a world point, with the local point
  function frameAt(wx, wy, tol) {
    var ch = M.chain(LY.doc, F.sid);
    for (var i = 0; i < ch.length; i++) {
      var f = ch[i], P = LY.pOf(f);
      if (!P || f.hide) continue;
      var l = R.toLocal(f, wx - P.x, wy - P.y);
      if (l[0] >= -tol && l[1] >= -tol && l[0] <= f.w + tol && l[1] <= f.h + tol) return { f: f, x: l[0], y: l[1] };
    }
    return null;
  }
  function posAt(wx, wy) {
    var fa = frameAt(wx, wy, 6 / ED.scale());
    if (!fa) return null;
    var h = C.hit(lines(), fa.f.id, fa.x, fa.y);
    if (h) return clamp(h);
    // a frame past the end of the text: the story's end
    var last = F.paras.length - 1;
    return { p: last, o: O().paraLen(F.paras[last]) };
  }
  // keep the textarea at the caret (IME window, mobile scrolling)
  function place() {
    if (!ta || !F.on) return;
    var loc = C.locate(lines(), F.b), it = loc ? M.find(LY.doc.items, loc.fid) : null;
    var sp = it ? toScreen(it, loc.x, loc.top) : null;
    ta.style.left = Math.max(0, Math.min((sp ? sp[0] : 20), $("stage").clientWidth - 4)) + "px";
    ta.style.top = Math.max(0, Math.min((sp ? sp[1] : 20), $("stage").clientHeight - 20)) + "px";
  }

  // ---------- drawing (called from the editor's overlay, CSS px) ----------
  function draw(ctx) {
    if (!F.on || !ED.L) return;
    var ls = lines(), o = ordered(), doc = LY.doc;
    ctx.save();
    if (!collapsed()) {
      var la = C.locate(ls, o[0]), lb = C.locate(ls, o[1]);
      var i0 = la ? la.i : 0, i1 = lb ? lb.i : ls.length - 1;
      ctx.fillStyle = "rgba(77,163,255,0.32)";
      for (var i = i0; i <= i1 && i < ls.length; i++) {
        var ln = ls[i].ln, it = M.find(doc.items, ls[i].fid);
        if (!it) continue;
        var x0 = i === i0 && la ? la.x : (ln.x0 !== undefined ? Math.min(ln.x0, C.xOf(ln, ln.o0)) : ln.cx0);
        var x1 = i === i1 && lb ? lb.x : C.xOf(ln, ln.o1);
        if (i !== i1) x1 = Math.max(x1, x0 + 3);
        var top = ln.y - Math.max(ln.h - ln.d, ln.d), bot = ln.y + ln.d;
        var q = [toScreen(it, x0, top), toScreen(it, x1, top), toScreen(it, x1, bot), toScreen(it, x0, bot)];
        if (!q[0]) continue;
        ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]);
        for (var k = 1; k < 4; k++) ctx.lineTo(q[k][0], q[k][1]);
        ctx.closePath(); ctx.fill();
      }
    } else if (F.blink) {
      var loc = C.locate(ls, F.b), fr = loc ? M.find(doc.items, loc.fid) : null;
      if (fr) {
        var p0 = toScreen(fr, loc.x, loc.top), p1 = toScreen(fr, loc.x, loc.bottom);
        ctx.strokeStyle = ED.palette.accent;
        ctx.lineWidth = Math.max(1.5, ED.zoom * 1.2);
        ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---------- pointer (from the editor) ----------
  function down(e, w) {
    if (!F.on) return false;
    var pos = posAt(w[0], w[1]);
    if (!pos) { stop(false); return false; }
    var now = Date.now(), same = F.lastPos && Math.abs(F.lastPos[0] - w[0]) + Math.abs(F.lastPos[1] - w[1]) < 8 / ED.scale();
    F.clicks = same && now - F.lastClick < 400 ? F.clicks + 1 : 1;
    F.lastClick = now; F.lastPos = w;
    F.goal = null;
    if (F.clicks === 2) { var wd = C.word(F.paras, pos); F.a = wd.a; moveTo(wd.b, true); }
    else if (F.clicks >= 3) { F.a = { p: pos.p, o: 0 }; moveTo({ p: pos.p, o: O().paraLen(F.paras[pos.p]) }, true); }
    else moveTo(pos, e.shiftKey);
    F.drag = F.clicks === 1;
    focus();
    return true;
  }
  function move(w) {
    if (!F.on || !F.drag) return false;
    var pos = posAt(w[0], w[1]);
    if (pos) moveTo(pos, true);
    return true;
  }
  function up() {
    if (!F.on || !F.drag) return false;
    F.drag = false;
    focus();
    return true;
  }

  // ---------- start / stop ----------
  function focus() {
    if (!ta) return;
    try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); }
  }
  function start(itemId, w) {
    var it = LY.doc ? M.find(LY.doc.items, itemId) : null;
    if (!it || it.t !== "text") return false;
    var st = M.story(LY.doc, it.story);
    if (!st) return false;
    if (LY.story && LY.story.isOpen()) { LY.flushStory(); LY.story.close(); }
    if (F.on) stop(false);
    F.on = true; F.sid = it.story; F.paras = norm(clone(st.paras)); F.baseM = st.m; F.dirty = false;
    var end = { p: F.paras.length - 1, o: O().paraLen(F.paras[F.paras.length - 1]) };
    var pos = (w && posAt(w[0], w[1])) || end;
    F.a = pos; F.b = pos; F.goal = null; F.clicks = 1; F.lastClick = Date.now(); F.lastPos = w || null;
    F.drag = !!w;
    if (ED.sel.length !== 1 || ED.sel[0] !== itemId) ED.select([itemId]);
    document.body.classList.add("inframe");
    clearInterval(F.blinkT);
    F.blinkT = setInterval(function () { F.blink = !F.blink; ED.render(); }, 530);
    resetTa();
    place();
    focus();
    ED.render();
    psChanged();
    return true;
  }
  function stop(selectFrame) {
    if (!F.on) return;
    commit();
    var fid = null, loc = C.locate(lines(), F.b);
    if (loc) fid = loc.fid;
    F.on = false; F.drag = false;
    clearInterval(F.blinkT); F.blinkT = null;
    document.body.classList.remove("inframe");
    if (ta && document.activeElement === ta) ta.blur();
    if (selectFrame && fid) ED.select([fid]);
    ED.render();
    psChanged();
  }
  // after undo / a remote change: the saved story is the truth again
  function reload() {
    var st = story();
    if (!st) { F.dirty = false; stop(false); return; }
    F.paras = norm(clone(st.paras)); F.baseM = st.m; F.dirty = false;
    F.a = clamp(F.a); F.b = clamp(F.b);
    ED.render(); place(); psChanged();
  }

  function wire() {
    ta = document.createElement("textarea");
    ta.className = "inframe-input";
    ta.setAttribute("aria-label", t("inframe.aria"));
    ta.setAttribute("autocomplete", "off");
    ta.setAttribute("autocorrect", "off");
    ta.setAttribute("autocapitalize", "sentences");
    ta.spellcheck = false;
    $("stage").appendChild(ta);
    ta.addEventListener("keydown", onKey);
    ta.addEventListener("input", function (e) { if (!F.composing && !e.isComposing) takeInput(); });
    ta.addEventListener("compositionstart", function () { F.composing = true; });
    ta.addEventListener("compositionend", function () { F.composing = false; takeInput(); });
    ta.addEventListener("paste", function (e) {
      e.preventDefault();
      var s = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
      if (s) insert(s);
    });
    ta.addEventListener("blur", function () { commit(); });
    LY.on("sel", function () {
      if (!F.on) return;
      var mine = ED.sel.length && ED.sel.every(function (id) { var x = M.find(LY.doc.items, id); return x && x.story === F.sid; });
      if (!mine) stop(false);
    });
    // undo, a panel, another device: the saved story is the truth again
    // (unsaved typing keeps going; its save sends the other text to
    // Recovered text)
    LY.on("doc", function () { if (F.on && !F.dirty) reload(); });
    LY.on("remote", function () { if (F.on && !F.dirty) reload(); });
    LY.on("close", function () { stop(false); });
    LY.on("open", function () { stop(false); });
    LY.on("mode", function () { stop(false); });
  }

  LY.inframe = {
    start: start, stop: function () { stop(true); }, isOn: function () { return F.on; },
    down: down, move: move, up: up, draw: draw, layoutDoc: layoutDoc, flush: commit,
    applyPs: applyPs, applyCs: applyCs,
    currentPs: function () { return F.on ? F.paras[F.b.p].ps : null; },
    // for tests and the harness
    state: function () { return { on: F.on, sid: F.sid, a: F.a, b: F.b, dirty: F.dirty }; },
    type: insert, key: function (k, mods) { onKey({ key: k, code: mods && mods.code || "", shiftKey: !!(mods && mods.shift), ctrlKey: !!(mods && mods.ctrl), altKey: false, metaKey: false, preventDefault: function () {} }); }
  };
  LY.on("boot", wire);
})();
