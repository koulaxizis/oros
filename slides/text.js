// ============================================================
// orOS Slides — text editing (v1.0.0)
// Editing the text of a box happens in place: a contenteditable
// field sits over the box (same place, size, rotation, font and
// alignment) while the canvas draws the box without its text.
// Paragraphs are <div data-l data-ls> (level, list style), runs are
// <b>/<i>/<u> and <font color>. The DOM is only READ back into
// plain paragraphs + runs (core.js normalizes them): nothing a user
// pastes is ever kept as markup (paste = plain text).
// One editing session = one undo step; the base mtime of the session
// goes with every save, so a concurrent edit from another device is
// kept as Recovered text (core.js setItemParas).
// ============================================================
(function () {
  "use strict";

  var SL = window.SL, C = SL.C, t = SL.t, $ = SL.$, el = SL.el;
  var TX = SL.text = {};
  var ED;

  var cur = null;           // { id, base, node, bar, timer, dirty, last }

  TX.active = function () { return cur ? cur.id : null; };

  function theme() { return C.themeById(SL.curDeck().th); }
  function hexToRole(hex) {
    var th = theme(), roles = ["fg", "mu", "a1", "a2", "a3", "bg", "sf"];
    for (var i = 0; i < roles.length; i++) if (th.c[roles[i]] === hex) return "t:" + roles[i];
    return hex;
  }
  function cssColor(v) {
    // "rgb(1, 2, 3)" or "#abc" / "#aabbcc" → "#aabbcc"
    if (!v) return null;
    v = String(v).trim().toLowerCase();
    var m = v.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) return "#" + [m[1], m[2], m[3]].map(function (n) { return ("0" + (+n).toString(16)).slice(-2); }).join("");
    if (/^#[0-9a-f]{6}$/.test(v)) return v;
    if (/^#[0-9a-f]{3}$/.test(v)) return "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    return null;
  }

  // ---------- Model → DOM ----------
  function paraNode(p) {
    var d = el("div", "tp");
    d.setAttribute("data-l", String(p.l || 0));
    d.setAttribute("data-ls", p.ls || "");
    p.r.forEach(function (r) {
      var n = document.createTextNode(r.t);
      var wrap = n;
      if (r.c) { var f = document.createElement("font"); f.setAttribute("color", C.resolveColor(r.c, theme()) || "#000000"); f.appendChild(wrap); wrap = f; }
      if (r.u) { var u = document.createElement("u"); u.appendChild(wrap); wrap = u; }
      if (r.i) { var i = document.createElement("i"); i.appendChild(wrap); wrap = i; }
      if (r.b) { var b = document.createElement("b"); b.appendChild(wrap); wrap = b; }
      d.appendChild(wrap);
    });
    if (!p.r.length) d.appendChild(document.createElement("br"));
    return d;
  }
  function fill(node, it) {
    node.innerHTML = "";
    var paras = it.paras.length ? it.paras : [{ l: 0, ls: "", r: [] }];
    paras.forEach(function (p) { node.appendChild(paraNode(p)); });
    numberParas(node);
  }

  // ---------- DOM → model ----------
  function readRuns(div) {
    var runs = [];
    function walk(n, f) {
      if (n.nodeType === 3) {
        var s = n.nodeValue.replace(/ /g, " ");
        if (s) runs.push({ t: s, b: f.b || undefined, i: f.i || undefined, u: f.u || undefined, c: f.c || undefined });
        return;
      }
      if (n.nodeType !== 1) return;
      var g = { b: f.b, i: f.i, u: f.u, c: f.c }, tag = n.tagName;
      if (tag === "B" || tag === "STRONG") g.b = true;
      if (tag === "I" || tag === "EM") g.i = true;
      if (tag === "U") g.u = true;
      var st = n.style || {};
      if (st.fontWeight === "bold" || +st.fontWeight >= 600) g.b = true;
      if (st.fontStyle === "italic") g.i = true;
      if (st.textDecoration && st.textDecoration.indexOf("underline") >= 0) g.u = true;
      var col = cssColor(n.getAttribute && n.getAttribute("color")) || cssColor(st.color);
      if (col) g.c = hexToRole(col);
      for (var k = n.firstChild; k; k = k.nextSibling) walk(k, g);
    }
    for (var k = div.firstChild; k; k = k.nextSibling) walk(k, {});
    // the box's own colour is not a run colour
    var box = SL.data().items[cur.id];
    var fc = C.resolveColor(box ? box.fc : "t:fg", theme());
    runs.forEach(function (r) { if (r.c && C.resolveColor(r.c, theme()) === fc) delete r.c; });
    return runs;
  }
  function normalizeDom(node) {
    // stray inline content at the top level goes into a paragraph
    var kids = [].slice.call(node.childNodes), pend = null;
    kids.forEach(function (k) {
      if (k.nodeType === 1 && (k.tagName === "DIV" || k.tagName === "P")) { pend = null; return; }
      if (!pend) { pend = el("div", "tp"); pend.setAttribute("data-l", "0"); pend.setAttribute("data-ls", ""); node.insertBefore(pend, k); }
      pend.appendChild(k);
    });
  }
  function readParas(node) {
    normalizeDom(node);
    return [].map.call(node.children, function (d) {
      return { l: Math.max(0, Math.min(C.LIM.level, +d.getAttribute("data-l") || 0)), ls: d.getAttribute("data-ls") || "", r: readRuns(d) };
    });
  }
  function numberParas(node) {
    var num = [];
    [].forEach.call(node.children, function (d) {
      var l = +d.getAttribute("data-l") || 0, ls = d.getAttribute("data-ls") || "";
      num.length = l + 1;
      if (ls === "n") { num[l] = (num[l] || 0) + 1; d.setAttribute("data-num", num[l] + "."); }
      else { num[l] = 0; d.removeAttribute("data-num"); }
    });
  }

  // ---------- Placement + look ----------
  function place() {
    if (!cur) return;
    var it = SL.data().items[cur.id];
    if (!it) { TX.stop(); return; }
    var s = ED.scale(), cv = $("cv"), n = cur.node, th = theme();
    var fit = SL.D.fitOf(it, th);
    var fam = SL.D.fontOf(it, th);
    n.style.left = (cv.offsetLeft + it.x * s) + "px";
    n.style.top = (cv.offsetTop + it.y * s) + "px";
    n.style.width = it.w * s + "px";
    n.style.minHeight = it.h * s + "px";
    n.style.transform = it.r ? "rotate(" + it.r + "deg)" : "";
    n.style.transformOrigin = (it.w * s / 2) + "px " + (it.h * s / 2) + "px";
    n.style.padding = SL.D.INS * s + "px";
    n.style.fontFamily = SL.T.cssFamily(fam + "-r") + ", " + (fam === "serif" ? "serif" : fam === "mono" ? "monospace" : "sans-serif");
    n.style.setProperty("--fs", (it.fs * fit.k * s) + "px");
    n.style.color = C.resolveColor(it.fc, th) || "#000";
    n.style.textAlign = { l: "left", c: "center", r: "right", j: "justify" }[it.al];
    n.style.justifyContent = { t: "flex-start", m: "center", b: "flex-end" }[it.va];
    n.style.fontWeight = it.ph === "title" ? "700" : "400";
    n.style.fontStyle = it.ph === "quote" ? "italic" : "normal";
    n.style.setProperty("--accent-caret", C.resolveColor("t:a1", th));
    var bg = C.resolveColor(SL.data().slides[it.s].bg || "t:bg", th);
    n.style.setProperty("--slide-bg", bg);
    placeBar();
  }
  TX.place = place;
  function placeBar() {
    var bar = cur.bar, st = $("stage"), n = cur.node;
    var top = n.offsetTop - bar.offsetHeight - 8;
    if (top < 4) top = Math.min(st.clientHeight - bar.offsetHeight - 4, n.offsetTop + n.offsetHeight + 8);
    var left = Math.max(4, Math.min(st.clientWidth - bar.offsetWidth - 4, n.offsetLeft));
    bar.style.top = Math.max(4, top) + "px";
    bar.style.left = left + "px";
  }

  // ---------- Toolbar ----------
  function buildBar() {
    var bar = el("div", "tbar");
    bar.setAttribute("role", "toolbar");
    function b(icon, label, fn) {
      var x = SL.iconBtn(icon, label);
      x.addEventListener("pointerdown", function (e) { e.preventDefault(); });   // keep the caret
      x.addEventListener("click", function () { fn(x); save(true); });
      bar.appendChild(x);
      return x;
    }
    b("bold", t("tx.b"), function () { exec("bold"); });
    b("italic", t("tx.i"), function () { exec("italic"); });
    b("underline", t("tx.u"), function () { exec("underline"); });
    b("bul", t("tx.bul"), function () { listStyle("b"); });
    b("num", t("tx.num"), function () { listStyle("n"); });
    b("outdent", t("tx.out"), function () { level(-1); });
    b("indent", t("tx.in"), function () { level(1); });
    var col = b("format", t("tx.color"), function () { colorMenu(col); });
    col.innerHTML = '<span class="tcol">A</span>';
    var done = el("button", "btn small primary", t("tx.done"));
    done.type = "button";
    done.addEventListener("pointerdown", function (e) { e.preventDefault(); });
    done.addEventListener("click", function () { TX.stop(); });
    bar.appendChild(done);
    return bar;
  }
  function exec(cmd, val) {
    try { document.execCommand("styleWithCSS", false, false); } catch (e) {}
    document.execCommand(cmd, false, val);
  }
  // Paragraphs touched by the selection.
  function selParas() {
    var s = window.getSelection(), n = cur.node, out = [];
    if (!s.rangeCount) return out;
    var r = s.getRangeAt(0);
    [].forEach.call(n.children, function (d) { if (r.intersectsNode(d)) out.push(d); });
    if (!out.length) {
      var x = r.startContainer;
      while (x && x.parentNode !== n) x = x.parentNode;
      if (x && x.nodeType === 1) out.push(x);
    }
    return out;
  }
  function listStyle(ls) {
    normalizeDom(cur.node);
    var ps = selParas(), all = ps.length && ps.every(function (d) { return d.getAttribute("data-ls") === ls; });
    ps.forEach(function (d) { d.setAttribute("data-ls", all ? "" : ls); });
    numberParas(cur.node);
  }
  function level(step) {
    normalizeDom(cur.node);
    selParas().forEach(function (d) {
      var l = Math.max(0, Math.min(C.LIM.level, (+d.getAttribute("data-l") || 0) + step));
      d.setAttribute("data-l", String(l));
    });
    numberParas(cur.node);
  }
  function colorMenu(anchor) {
    var th = theme();
    var roles = [["fg", "col.fg"], ["mu", "col.mu"], ["a1", "col.a1"], ["a2", "col.a2"], ["a3", "col.a3"], ["bg", "col.bg"]];
    var sel = saveSel();
    SL.menu(anchor, roles.map(function (r) {
      return { label: t(r[1]), fn: function () { restoreSel(sel); exec("foreColor", th.c[r[0]]); save(true); } };
    }));
  }
  function saveSel() { var s = window.getSelection(); return s.rangeCount ? s.getRangeAt(0).cloneRange() : null; }
  function restoreSel(r) {
    cur.node.focus();
    if (!r) return;
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }

  // ---------- Keys ----------
  function caretPara() {
    var s = window.getSelection();
    if (!s.rangeCount || !s.isCollapsed) return null;
    var x = s.anchorNode;
    while (x && x.parentNode !== cur.node) x = x.parentNode;
    return x && x.nodeType === 1 ? x : null;
  }
  function atStart(p) {
    var s = window.getSelection(), r = document.createRange();
    r.selectNodeContents(p);
    r.setEnd(s.anchorNode, s.anchorOffset);
    return r.toString().length === 0;
  }
  function onKey(e) {
    var mod = e.ctrlKey || e.metaKey;
    if (e.key === "Escape") { e.preventDefault(); TX.stop(); return; }
    if (e.key === "Tab") { e.preventDefault(); level(e.shiftKey ? -1 : 1); save(); return; }
    if (mod && /^[biu]$/i.test(e.key) && !e.altKey) {
      e.preventDefault();
      exec({ b: "bold", i: "italic", u: "underline" }[e.key.toLowerCase()]);
      save();
      return;
    }
    if (mod && (e.key === "z" || e.key === "Z" || e.key === "y" || e.key === "Y")) {
      // the field's own undo only knows the DOM: leave it to the app's
      e.preventDefault();
      TX.stop();
      if (e.key === "y" || e.key === "Y" || e.shiftKey) SL.redo(); else SL.undo();
      return;
    }
    var p = caretPara();
    if (!p) return;
    // Enter on an empty list line ends the list; Backspace at the start
    // of a list line removes its bullet first
    if (e.key === "Enter" && !e.shiftKey && p.textContent === "" && (p.getAttribute("data-ls") || +p.getAttribute("data-l"))) {
      e.preventDefault();
      if (+p.getAttribute("data-l") > 0) p.setAttribute("data-l", String(+p.getAttribute("data-l") - 1));
      else p.setAttribute("data-ls", "");
      numberParas(cur.node); save();
      return;
    }
    if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); exec("insertParagraph"); return; }
    if (e.key === "Backspace" && p.getAttribute("data-ls") && atStart(p)) {
      e.preventDefault();
      p.setAttribute("data-ls", "");
      numberParas(cur.node); save();
    }
  }
  function onPaste(e) {
    e.preventDefault();
    var txt = (e.clipboardData && e.clipboardData.getData("text/plain")) || "";
    txt = txt.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
    if (txt) exec("insertText", txt.slice(0, C.LIM.itemText));
  }

  // ---------- Save ----------
  function save(now) {
    if (!cur) return;
    cur.dirty = true;
    numberParas(cur.node);
    clearTimeout(cur.timer);
    if (now) flush(); else cur.timer = setTimeout(flush, 450);
  }
  function flush() {
    if (!cur || !cur.dirty) return;
    clearTimeout(cur.timer);
    cur.dirty = false;
    var id = cur.id, paras = readParas(cur.node), base = cur.base;
    var json = JSON.stringify(C.normParas(paras));
    if (json === cur.last) return;
    cur.last = json;
    SL.op(function (dt, nw) { return C.setItemParas(dt, id, paras, nw, base) ? undefined : false; });
  }
  TX.flush = flush;

  // ---------- Start / stop ----------
  TX.start = function (id) {
    ED = SL.ed;
    var it = SL.data().items[id];
    if (!it || it.k !== "text" || it.s !== ED.cur) return;
    if (it.lk) { SL.toast(t("toast.locked")); return; }
    if (cur && cur.id === id) { cur.node.focus(); return; }
    TX.stop();
    ED.sel = [id];
    var node = el("div", "ted");
    node.contentEditable = "true";
    node.spellcheck = true;
    node.setAttribute("role", "textbox");
    node.setAttribute("aria-multiline", "true");
    node.setAttribute("aria-label", t("pn.edit"));
    fill(node, it);
    var bar = buildBar();
    $("stage").appendChild(node);
    $("stage").appendChild(bar);
    cur = { id: id, base: it.m, node: node, bar: bar, timer: null, dirty: false, last: JSON.stringify(it.paras) };
    try { document.execCommand("defaultParagraphSeparator", false, "div"); } catch (e) {}
    node.addEventListener("input", function () { save(); });
    node.addEventListener("keydown", onKey);
    node.addEventListener("paste", onPaste);
    node.addEventListener("drop", function (e) { e.preventDefault(); });
    node.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    SL.beginGesture();
    place();
    ED.draw();
    SL.panels.render();
    node.focus();
    // caret at the end
    var r = document.createRange(); r.selectNodeContents(node); r.collapse(false);
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  };

  TX.stop = function () {
    if (!cur) return;
    flush();
    var c = cur;
    cur = null;
    c.node.remove(); c.bar.remove();
    SL.endGesture();
    if (SL.ed) { SL.ed.draw(); SL.panels.render(); }
  };

  // A sync changed the data while editing: follow the box, and show
  // the merged text if it changed under us (what we had typed was
  // saved before the merge; a lost version is in Recovered text).
  TX.remote = function () {
    if (!cur) return;
    var it = SL.data().items[cur.id];
    if (!it || it.s !== SL.ed.cur) { cur.dirty = false; TX.stop(); return; }
    var json = JSON.stringify(it.paras);
    if (json !== cur.last) {
      fill(cur.node, it);
      cur.last = json;
      cur.base = it.m;
    }
    place();
  };
})();
