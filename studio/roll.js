// ============================================================
// orOS Studio — piano roll and loop browser (v1.0.0)
// Loaded before studio.js; studio.js calls window.StudioRoll(host).
//   - Piano roll (#pr-dlg): the notes of one MIDI clip on a grid of
//     pitches (rows) and time (columns, the project's bars and beats).
//     Draw tool: tap or click to add a note, drag to set its length.
//     Select tool: drag a box (mouse) or tap notes (touch) to select.
//     Both: drag a note to move the selection, drag its right end to
//     resize, double-click to delete. Velocity lane under the grid.
//     Keys: arrows move, Delete, Ctrl+A / C / X / V / D, Q quantize,
//     Ctrl+Z / Y. Every change is one undo step of Studio.
//   - Loop browser (#loops): the built-in loops (loops.js) by style,
//     kind and tempo; listen, add at the playhead, or drag one onto a
//     track (mouse anywhere on the row, touch on the grip).
// All text through host.t, all user text through textContent.
// ============================================================
(function (root) {
  "use strict";

  root.StudioRoll = function (host) {
    var C = host.C, N = host.N, M = host.M, L = host.L, t = host.t, el = host.el, setLabel = host.setLabel, ICON = host.ICON;
    var ZOOMS = [12, 18, 24, 36, 48, 72, 96, 144, 192];   // pixels per beat
    var GRID_KEY = { "1/4": "pr.g4", "1/8": "pr.g8", "1/16": "pr.g16", "1/32": "pr.g32", "1/8t": "pr.g8t", "1/16t": "pr.g16t", "off": "pr.goff" };
    var cid = "";                  // the clip in the piano roll
    var sel = [];                  // indices of the selected notes
    var g = null;                  // the gesture in progress
    var clipBuf = null;            // copied notes
    var pasteNext = null;          // clip time of the next paste
    var lastLen = 0;               // length of the last note drawn or resized (seconds)
    var lastPh = null;             // where the playhead was at the last paste
    var raf = 0;

    function $(id) { return document.getElementById(id); }
    function coarse() { try { return window.matchMedia("(pointer: coarse)").matches; } catch (e) { return false; } }
    function rowH() { return coarse() ? 22 : 16; }
    function keyW() {                // drum names need more room than note names
      var c = clip(), d = c && instOf(c) === "drums", n = window.innerWidth <= 420;
      return d ? (n ? 78 : 104) : (n ? 46 : 64);
    }
    var RUL_H = 22;

    // ---------- What is open ----------
    function clip() { var c = cid ? C.find(host.data(), "clips", cid) : null; return c && C.isMidi(c) ? c : null; }
    function track(c) { return c ? C.find(host.data(), "tracks", c.t) : null; }
    function bpm() { var p = host.proj(); return p ? p.bpm : 120; }
    function sig() { var p = host.proj(); return p ? p.sig : 4; }
    function pxs() { return host.pref("prZoom") * bpm() / 60; }          // pixels per second
    function step() { return N.gridSec(bpm(), host.pref("prGrid")); }
    function origin(c) { return c.at - c.off; }                         // project time of the content start
    function instOf(c) { var tr = track(c); return (tr && tr.inst) || "piano"; }
    function isOpen() { return $("pr-dlg").open; }
    function busy() { return !!g; }
    // the content time range the grid shows: from off to the end plus 4 bars
    function span(c) {
      var e = Math.max(c.off + c.len, c.off + N.notesEnd(c.n.filter(function (q) { return q[1] >= c.off; })) );
      return e - c.off + 4 * C.barSec(bpm(), sig());
    }
    function noteName(c, p) {
      if (instOf(c) === "drums") { var k = M.drumKind(p); if (k) return t("dr." + k); }
      return M.noteName(p);
    }

    function open(id) {
      cid = id; sel = []; pasteNext = null; g = null; lastPh = null;
      var c = clip();
      if (!c) return;
      lastLen = step() || C.beatSec(bpm());
      host.showDlg("pr-dlg");
      render();
      // scroll to the notes (or around middle C)
      var sc = $("pr-scroll"), ps = c.n.filter(function (q) { return q[1] >= c.off; }), mid = 60;
      if (ps.length) { var sum = 0; ps.forEach(function (q) { sum += q[0]; }); mid = Math.round(sum / ps.length); }
      else if (instOf(c) === "drums") mid = 42;
      sc.scrollTop = Math.max(0, (127 - mid) * rowH() + RUL_H - sc.clientHeight / 2);
      sc.scrollLeft = 0;
      syncVelScroll();
      setTimeout(function () { sc.focus(); }, 0);
    }
    function close() { if (isOpen()) host.hideDlg("pr-dlg"); }

    // ---------- Drawing ----------
    function render() {
      if (!isOpen()) return;
      var c = clip();
      if (!c) { close(); return; }
      sel = sel.filter(function (i) { return i < c.n.length; });
      var z = pxs(), rh = rowH(), kw = keyW(), w = Math.ceil(span(c) * z), h = 128 * rh;
      var tr = track(c);
      $("pr-title").textContent = t("pr.title", { name: c.name || (tr && tr.name) || "" });
      var inner = $("pr-inner");
      inner.style.gridTemplateColumns = kw + "px " + w + "px";
      inner.style.gridTemplateRows = RUL_H + "px " + h + "px";
      inner.style.setProperty("--tc", tr ? tr.color : "#3584e4");
      renderTools(c);
      renderRuler(c, w);
      renderKeys(c, rh);
      renderGrid(c, w, h, z, rh);
      renderVel(c, w, z, kw);
    }
    function renderTools(c) {
      var mode = host.pref("prMode");
      [].forEach.call($("pr-mode").querySelectorAll("button"), function (b) {
        var on = b.getAttribute("data-v") === mode;
        b.classList.toggle("on", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
        b.tabIndex = on ? 0 : -1;
      });
      $("pr-grid-sel").value = host.pref("prGrid");
      var vi = $("pr-vel"), v = sel.length ? c.n[sel[0]][3] : host.pref("prVel");
      if (document.activeElement !== vi) vi.value = String(v);
      $("pr-vel-out").textContent = String(v);
      setLabel(vi, t("pr.vel") + ": " + v + (sel.length ? " (" + t("pr.nSel", { n: sel.length }) + ")" : ""));
      $("pr-copy").disabled = !sel.length;
      $("pr-del").disabled = !sel.length;
      $("pr-paste").disabled = !clipBuf;
      $("pr-undo").disabled = !host.canUndo();
      $("pr-redo").disabled = !host.canRedo();
      $("pr-zin").disabled = host.pref("prZoom") >= ZOOMS[ZOOMS.length - 1];
      $("pr-zout").disabled = host.pref("prZoom") <= ZOOMS[0];
      $("pr-status").textContent = sel.length ? t("pr.nSel", { n: sel.length }) : t("pr.nNotes", { n: c.n.length });
    }
    function renderRuler(c, w) {
      var r = $("pr-ruler"), z = pxs(), bar = C.barSec(bpm(), sig()), o = origin(c);
      r.innerHTML = "";
      r.style.width = w + "px";
      var k = Math.ceil((o + c.off) / bar - 1e-6), every = 1;
      while (bar * every * z < 40) every *= 2;
      for (; (k * bar - o - c.off) * z <= w; k++) {
        if (k % every) continue;
        var x = (k * bar - o - c.off) * z;
        if (x < 0) continue;
        var m = el("span", "pr-tick", String(k + 1));
        m.style.left = x + "px";
        r.appendChild(m);
      }
      var end = el("span", "pr-end");
      end.style.left = (c.len * z) + "px";
      r.appendChild(end);
    }
    function renderKeys(c, rh) {
      var host2 = $("pr-keys"), drums = instOf(c) === "drums", key = host2.getAttribute("data-k") || "";
      var sig2 = (drums ? "d" : "p") + rh;
      if (key === sig2) return;                                // same keys as before
      host2.setAttribute("data-k", sig2);
      host2.classList.toggle("drums", drums);
      host2.innerHTML = "";
      host2.style.height = (128 * rh) + "px";
      for (var p = 127; p >= 0; p--) {
        var black = M.isBlack(p), name = noteName(c, p);
        var b = el("button", "pr-key " + (black ? "b" : "w"));
        b.type = "button";
        b.tabIndex = -1;
        b.style.top = ((127 - p) * rh) + "px";
        b.style.height = rh + "px";
        b.setAttribute("data-p", String(p));
        setLabel(b, name);
        if (drums ? M.drumKind(p) : p % 12 === 0) b.appendChild(el("span", "pr-kl", name));
        host2.appendChild(b);
      }
    }
    // background: rows (black keys darker), beat and bar lines on the project's grid
    function gridBg(c, z, rh) {
      var beat = C.beatSec(bpm()) * z, bar = beat * sig(), st = step() * z, stops = [];
      for (var r = 0; r < 12; r++) {
        var p = 127 - r, dark = M.isBlack(p), col = dark ? "var(--pr-black)" : "var(--pr-white)";
        stops.push(col + " " + (r * rh) + "px " + ((r + 1) * rh - 1) + "px", "var(--pr-row) " + ((r + 1) * rh - 1) + "px " + ((r + 1) * rh) + "px");
      }
      var layers = [
        "repeating-linear-gradient(90deg, var(--pr-bar) 0 1px, transparent 1px " + bar + "px)",
        "repeating-linear-gradient(90deg, var(--pr-beat) 0 1px, transparent 1px " + beat + "px)"
      ];
      if (st >= 6 && st < beat - 0.5) layers.push("repeating-linear-gradient(90deg, var(--pr-sub) 0 1px, transparent 1px " + st + "px)");
      layers.push("linear-gradient(180deg, " + stops.join(", ") + ")");
      var phase = (((-(origin(c) + c.off) * z) % bar) + bar) % bar;
      var pos = layers.map(function (x, i) { return i === layers.length - 1 ? "0 0" : phase + "px 0"; });
      var size = layers.map(function (x, i) { return i === layers.length - 1 ? "100% " + (12 * rh) + "px" : "auto"; });
      return { image: layers.join(", "), pos: pos.join(", "), size: size.join(", ") };
    }
    function renderGrid(c, w, h, z, rh) {
      var gr = $("pr-grid"), bg = gridBg(c, z, rh);
      gr.classList.toggle("select", host.pref("prMode") === "select");
      gr.style.width = w + "px"; gr.style.height = h + "px";
      gr.style.backgroundImage = bg.image;
      gr.style.backgroundPosition = bg.pos;
      gr.style.backgroundSize = bg.size;
      var keep = [$("pr-out"), $("pr-ph"), $("pr-marq")];
      gr.innerHTML = "";
      keep.forEach(function (n) { gr.appendChild(n); });
      var out = $("pr-out");
      out.style.left = (c.len * z) + "px";
      out.style.width = Math.max(0, w - c.len * z) + "px";
      var on = {};
      sel.forEach(function (i) { on[i] = true; });
      var frag = document.createDocumentFragment(), bb = C.beatSec(bpm());
      c.n.forEach(function (q, i) {
        if (q[1] < c.off - 1e-9) return;                        // trimmed away at the clip's start
        var d = el("div", "pr-note" + (on[i] ? " sel" : "") + (q[1] >= c.off + c.len ? " out" : ""));
        d.setAttribute("data-i", String(i));
        d.style.left = ((q[1] - c.off) * z) + "px";
        d.style.top = ((127 - q[0]) * rh + 1) + "px";
        d.style.width = Math.max(4, q[2] * z - 1) + "px";
        d.style.height = (rh - 2) + "px";
        d.style.setProperty("--v", String(0.35 + 0.65 * q[3] / 127));
        d.tabIndex = -1;
        d.setAttribute("role", "img");
        var bpos = C.barBeat(origin(c) + q[1], bpm(), sig());
        d.setAttribute("aria-label", t("pr.note", { name: noteName(c, q[0]), bar: bpos.bar, beat: bpos.beat, len: host.numTxt(q[2] / bb, 2), v: q[3] }));
        if (q[2] * z > 34 && rh >= 16) d.appendChild(el("span", "pr-nl", noteName(c, q[0])));
        frag.appendChild(d);
      });
      gr.appendChild(frag);
      tick(host.position());
    }
    function renderVel(c, w, z, kw) {
      var lane = $("pr-vstems"), on = {};
      $("pr-vlabel").style.width = kw + "px";
      lane.style.width = w + "px";
      lane.innerHTML = "";
      sel.forEach(function (i) { on[i] = true; });
      c.n.forEach(function (q, i) {
        if (q[1] < c.off - 1e-9) return;
        var s = el("span", "pr-stem" + (on[i] ? " sel" : ""));
        s.style.left = ((q[1] - c.off) * z) + "px";
        s.style.height = (q[3] / 127 * 100) + "%";
        s.setAttribute("data-i", String(i));
        lane.appendChild(s);
      });
    }
    function renderSoon() {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; render(); });
    }
    // the playhead (project time)
    function tick(pos) {
      if (!isOpen()) return;
      var c = clip(), ph = $("pr-ph");
      if (!c) return;
      var x = (pos - origin(c) - c.off) * pxs();
      ph.hidden = x < 0;
      ph.style.transform = "translateX(" + x + "px)";
    }
    function syncVelScroll() { $("pr-vscroll").scrollLeft = $("pr-scroll").scrollLeft; }

    // ---------- Edits ----------
    // r = { notes, sel } from StudioNotes; live: no undo step (a drag)
    function setNotes(r, live, opts) {
      var c = clip();
      if (!c || !r) return;
      sel = r.sel;
      if (live) host.liveNotes(c.id, r.notes);
      else host.setNotes(c.id, r.notes, opts);
      renderSoon();
    }
    function notes() { var c = clip(); return c ? c.n : []; }
    function delSel() {
      if (!sel.length) return;
      var n = sel.length;
      setNotes(N.deleteNotes(notes(), sel));
      host.live(t("pr.deleted", { n: n }));
    }
    function selectAll() {
      var c = clip();
      if (!c) return;
      sel = [];
      c.n.forEach(function (q, i) { if (q[1] >= c.off - 1e-9) sel.push(i); });
      render();
    }
    function copySel(cut) {
      var cp = N.copyNotes(notes(), sel);
      if (!cp) { host.showToast(t("pr.noSel")); return; }
      clipBuf = cp;
      var st = step() || C.beatSec(bpm()) / 4, c = clip();
      pasteNext = N.snapT(cp.from + cp.span, origin(c), st);
      if (pasteNext < cp.from + cp.span - 1e-6) pasteNext += st;
      host.live(t("pr.copied", { n: cp.notes.length }));
      if (cut) delSel(); else render();
    }
    function paste() {
      var c = clip();
      if (!c || !clipBuf) { host.showToast(t("pr.nothing")); return; }
      var ph = host.position() - origin(c), at;
      // at the playhead when it was moved inside the clip since the last paste, else right after
      if (ph >= c.off && ph < c.off + c.len && !host.isPlaying() && ph !== lastPh) at = ph;
      else at = pasteNext != null ? pasteNext : c.off;
      lastPh = ph;
      var st = step();
      if (st > 0) at = N.snapT(at, origin(c), st);
      var r = N.pasteNotes(c.n, clipBuf, Math.max(c.off, at));
      if (!r) { host.showToast(t("pr.max", { n: N.MAX_NOTES })); return; }
      pasteNext = Math.max(c.off, at) + clipBuf.span;
      if (st > 0) { var p2 = N.snapT(pasteNext, origin(c), st); pasteNext = p2 < pasteNext - 1e-6 ? p2 + st : p2; }
      setNotes(r);
    }
    function duplicate() {
      if (!sel.length) { host.showToast(t("pr.noSel")); return; }
      copySel(false);
      paste();
    }
    function quantize() {
      var c = clip();
      if (!c) return;
      var st = step() || N.gridSec(bpm(), "1/16"), n = sel.length || c.n.length;
      if (!n) return;
      setNotes(N.quantize(c.n, sel, origin(c), st, 1));
      host.live(t("pr.quantized", { n: n }));
    }
    function nudge(dt, dp) {
      var c = clip();
      if (!c || !sel.length) return;
      setNotes(N.moveNotes(c.n, sel, dt, dp, c.off), false, host.burst("prn" + c.id));
      if (dp && sel.length === 1) audition(clip().n[sel[0]][0], clip().n[sel[0]][3]);
    }
    function audition(p, v) { var c = clip(); if (c) host.audition(p, v || 100, instOf(c), c.t); }

    // ---------- Pointer: grid ----------
    function local(e) {
      var r = $("pr-grid").getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function pitchAt(y) { return Math.max(0, Math.min(127, 127 - Math.floor(y / rowH()))); }
    function onDown(e) {
      var c = clip();
      if (!c || e.button > 0) return;
      var pt = local(e), nEl = e.target.closest && e.target.closest(".pr-note"), z = pxs();
      if (nEl) {
        e.preventDefault();
        var i = +nEl.getAttribute("data-i"), q = c.n[i];
        if (!q) return;
        var toggle = e.shiftKey || e.ctrlKey || e.metaKey || (host.pref("prMode") === "select" && e.pointerType === "touch");
        if (toggle) {
          var k = sel.indexOf(i);
          if (k >= 0) { sel.splice(k, 1); render(); return; }
          sel.push(i);
        } else if (sel.indexOf(i) < 0) sel = [i];
        var right = (q[1] - c.off + q[2]) * z, edge = Math.min(coarse() ? 14 : 8, q[2] * z / 3);
        g = { type: pt.x > right - edge ? "resize" : "move", i: i, x0: e.clientX, y0: e.clientY, base: c.n, baseSel: sel.slice(),
              before: host.snapshot(), moved: false, pid: e.pointerId, dp: 0 };
        try { $("pr-grid").setPointerCapture(e.pointerId); } catch (err) {}
        audition(q[0], q[3]);
        render();
        return;
      }
      if (e.pointerType === "touch") {                   // a tap adds or clears; a drag scrolls (the browser's)
        g = { type: "tap", x0: e.clientX, y0: e.clientY, pid: e.pointerId, pt: pt };
        return;
      }
      e.preventDefault();
      if (host.pref("prMode") === "draw") {
        var r = drawAt(c, pt);
        if (!r) return;
        g = { type: "resize", i: r.sel[0], x0: e.clientX, y0: e.clientY, base: r.notes, baseSel: r.sel.slice(), before: r.before,
              moved: false, created: true, pid: e.pointerId };
      } else {
        g = { type: "marq", x0: e.clientX, y0: e.clientY, p0: pt, add: e.shiftKey || e.ctrlKey || e.metaKey ? sel.slice() : [], pid: e.pointerId, moved: false };
      }
      try { $("pr-grid").setPointerCapture(e.pointerId); } catch (err) {}
    }
    // a new note under the pointer (live; the gesture's end makes the undo step)
    function drawAt(c, pt) {
      if (c.n.length >= N.MAX_NOTES) { host.showToast(t("pr.max", { n: N.MAX_NOTES })); return null; }
      var st = step(), s = c.off + pt.x / pxs();
      if (st > 0) s = N.floorT(s, origin(c), st);
      s = Math.max(c.off, s);
      var len = lastLen > 0 ? lastLen : (st || C.beatSec(bpm()));
      var before = host.snapshot(), p = pitchAt(pt.y), v = host.pref("prVel");
      var r = N.addNote(c.n, [p, s, len, v]);
      if (!r) return null;
      r.before = before;
      setNotes(r, true);
      audition(p, v);
      return r;
    }
    function onMove(e) {
      var c = clip(), d = g;
      if (!c || !d || e.pointerId !== d.pid) return;
      var dx = e.clientX - d.x0, dy = e.clientY - d.y0;
      if (!d.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      d.moved = true;
      if (d.type === "tap") return;
      var z = pxs(), st = step(), o = origin(c);
      if (e.altKey) st = 0;                                // Alt: off the grid
      if (d.type === "move") {
        var a = d.base[d.i], s0 = a[1], ns = s0 + dx / z;
        if (st > 0) ns = N.snapT(ns, o, st);
        var dp = -Math.round(dy / rowH());
        var r = N.moveNotes(d.base, d.baseSel, ns - s0, dp, c.off);
        if (dp !== d.dp && d.baseSel.length === 1) { d.dp = dp; audition(Math.max(0, Math.min(127, a[0] + dp)), a[3]); }
        setNotes(r, true);
      } else if (d.type === "resize") {
        var b = d.base[d.i], e0 = b[1] + b[2], ne = e0 + dx / z;
        if (st > 0) ne = N.snapT(ne, o, st);
        var min = st > 0 ? Math.min(st, b[2]) : C.MIN_NOTE;
        var r2 = N.resizeNotes(d.base, d.baseSel, Math.max(ne, b[1] + min) - e0, min);
        setNotes(r2, true);
        if (d.baseSel.length === 1) lastLen = r2.notes[r2.sel[0]] ? r2.notes[r2.sel[0]][2] : lastLen;
      } else if (d.type === "marq") {
        var pt = local(e), m = $("pr-marq"), x0 = Math.min(d.p0.x, pt.x), y0 = Math.min(d.p0.y, pt.y);
        m.hidden = false;
        m.style.left = x0 + "px"; m.style.top = y0 + "px";
        m.style.width = Math.abs(pt.x - d.p0.x) + "px"; m.style.height = Math.abs(pt.y - d.p0.y) + "px";
        var hit = N.inRect(c.n, c.off + d.p0.x / z, c.off + pt.x / z, pitchAt(d.p0.y), pitchAt(pt.y)).filter(function (i) { return c.n[i][1] >= c.off - 1e-9; });
        var all = d.add.slice();
        hit.forEach(function (i) { if (all.indexOf(i) < 0) all.push(i); });
        sel = all;
        renderSoon();
      }
    }
    function onUp(e) {
      var c = clip(), d = g;
      if (!d || e.pointerId !== d.pid) return;
      g = null;
      if (!c) return;
      if (e.type === "pointercancel") {                    // the browser took over (a scroll)
        if (d.before && d.moved) host.commit(d.before);
        render();
        return;
      }
      if (d.type === "tap") {
        if (d.moved) return;
        if (host.pref("prMode") === "draw") {
          var r = drawAt(c, d.pt);
          if (r) host.commit(r.before);
        } else { sel = []; render(); }
        return;
      }
      if (d.type === "marq") { $("pr-marq").hidden = true; render(); return; }
      if (d.type === "move" && !d.moved && twice(d.i, e.clientX)) { sel = [d.i]; delSel(); return; }   // a double click or tap deletes
      if (d.created || d.moved) host.commit(d.before);
      render();
    }
    // the same note pressed twice in a short time (the notes are drawn anew in between)
    var lastTap = { at: 0, i: -1, x: 0 };
    function twice(i, x) {
      var now = Date.now(), hit = lastTap.i === i && now - lastTap.at < 450 && Math.abs(x - lastTap.x) < 16;
      lastTap = hit ? { at: 0, i: -1, x: 0 } : { at: now, i: i, x: x };
      return hit;
    }

    // ---------- Pointer: velocity lane ----------
    var vg = null;
    function velAt(e) {
      var r = $("pr-vstems").getBoundingClientRect();
      return { x: e.clientX - r.left, v: Math.max(1, Math.min(127, Math.round((1 - (e.clientY - r.top) / Math.max(1, r.height)) * 127))) };
    }
    function velDown(e) {
      var c = clip();
      if (!c || e.button > 0) return;
      var p = velAt(e), z = pxs(), best = -1, bd = coarse() ? 16 : 8;
      c.n.forEach(function (q, i) {
        if (q[1] < c.off - 1e-9) return;
        var dx = Math.abs((q[1] - c.off) * z - p.x);
        if (dx < bd || (dx === bd && sel.indexOf(i) >= 0)) { bd = dx; best = i; }
      });
      if (best < 0) return;
      e.preventDefault();
      var which = sel.indexOf(best) >= 0 ? sel.slice() : [best];
      if (which.length === 1) sel = which.slice();
      vg = { which: which, before: host.snapshot(), pid: e.pointerId };
      try { $("pr-vstems").setPointerCapture(e.pointerId); } catch (err) {}
      setNotes(N.setVel(c.n, which, p.v), true);
      vg.which = sel.slice();
    }
    function velMove(e) {
      var c = clip();
      if (!c || !vg || e.pointerId !== vg.pid) return;
      var r = N.setVel(c.n, vg.which, velAt(e).v);
      setNotes(r, true);
      vg.which = r.sel.slice();
    }
    function velUp(e) {
      if (!vg || e.pointerId !== vg.pid) return;
      var d = vg; vg = null;
      host.commit(d.before);
      render();
    }

    // ---------- Keys ----------
    function onKey(e) {
      if (!isOpen()) return;
      var tg = e.target, tag = tg && tg.tagName;
      if (tag === "INPUT" && tg.type !== "range" || tag === "SELECT" || tag === "TEXTAREA") return;
      var k = e.key, lk = k.length === 1 ? k.toLowerCase() : k, mod = e.ctrlKey || e.metaKey, c = clip();
      if (!c) return;
      var st = step() || N.gridSec(bpm(), "1/16");
      if (mod && lk === "z") { e.preventDefault(); if (e.shiftKey) host.redo(); else host.undo(); return; }
      if (mod && lk === "y") { e.preventDefault(); host.redo(); return; }
      if (mod && lk === "a") { e.preventDefault(); selectAll(); return; }
      if (mod && lk === "c") { e.preventDefault(); copySel(false); return; }
      if (mod && lk === "x") { e.preventDefault(); copySel(true); return; }
      if (mod && lk === "v") { e.preventDefault(); paste(); return; }
      if (mod && lk === "d") { e.preventDefault(); duplicate(); return; }
      if (mod || e.altKey) return;
      if (tag === "BUTTON" && (k === " " || k === "Enter")) return;
      if (k === "Delete" || k === "Backspace") { e.preventDefault(); delSel(); }
      else if (k === "ArrowLeft" || k === "ArrowRight") {
        if (tag === "INPUT") return;
        e.preventDefault();
        nudge((k === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? C.barSec(bpm(), sig()) : st), 0);
      } else if (k === "ArrowUp" || k === "ArrowDown") {
        if (tag === "INPUT") return;
        e.preventDefault();
        nudge(0, (k === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 12 : 1));
      } else if (lk === "q") { e.preventDefault(); quantize(); }
      else if (k === " ") { e.preventDefault(); playHere(); }
      else if (lk === "b" || lk === "d") { e.preventDefault(); setMode("draw"); }
      else if (lk === "s" || lk === "v") { e.preventDefault(); setMode("select"); }
    }
    function setMode(m) { host.pref("prMode", m); render(); }
    function playHere() {
      var c = clip();
      if (!c) return;
      if (!host.isPlaying()) {
        var ph = host.position();
        if (ph < c.at || ph >= C.clipEnd(c)) host.seek(c.at);
      }
      host.togglePlay();
    }
    function zoomBy(d) {
      var i = ZOOMS.indexOf(host.pref("prZoom")), j = Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 4 : i) + d));
      var sc = $("pr-scroll"), mid = (sc.scrollLeft + (sc.clientWidth - keyW()) / 2) / pxs();
      host.pref("prZoom", ZOOMS[j]);
      render();
      sc.scrollLeft = Math.max(0, mid * pxs() - (sc.clientWidth - keyW()) / 2);
      syncVelScroll();
    }

    // ---------- Loop browser ----------
    var preview = null;            // { id, handles, timer }
    function loopName(l) { return t("lp.name", { genre: t("lp.g" + l.g), kind: t("lp.k" + l.k), n: L.numberOf(l) }); }
    function loopsOpen() { return !$("loops").hidden; }
    function toggleLoops(force) {
      var box = $("loops"), show = force == null ? box.hidden : force;
      box.hidden = !show;
      $("loops-btn").classList.toggle("on", show);
      $("loops-btn").setAttribute("aria-pressed", show ? "true" : "false");
      if (show) renderLoops(); else stopPreview();
      host.layout();
    }
    function renderLoops() {
      var gs = $("lp-genre"), ts = $("lp-tempo");
      gs.value = host.pref("lpG"); ts.value = host.pref("lpT");
      var kinds = [""].concat(L.KINDS), kcur = host.pref("lpK"), kh = $("lp-kind");
      kh.innerHTML = "";
      kinds.forEach(function (k) {
        var on = k === kcur, b = el("button", "chip" + (on ? " on" : ""), k ? t("lp.k" + k) : t("lp.all"));
        b.type = "button";
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", on ? "true" : "false");
        b.tabIndex = on ? 0 : -1;
        b.addEventListener("click", function () { host.pref("lpK", k); renderLoops(); });
        kh.appendChild(b);
      });
      kh.onkeydown = function (e) {
        var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!d) return;
        e.preventDefault(); e.stopPropagation();
        var j = (kinds.indexOf(kcur) + d + kinds.length) % kinds.length;
        host.pref("lpK", kinds[j]); renderLoops();
        var nb = kh.querySelectorAll("button")[j]; if (nb) nb.focus();
      };
      var list = $("lp-list"), found = L.filter({ g: host.pref("lpG"), k: kcur, tempo: host.pref("lpT") });
      list.innerHTML = "";
      $("lp-none").hidden = found.length > 0;
      found.forEach(function (l) {
        var li = el("li", "lp-item"), name = loopName(l);
        li.setAttribute("data-l", l.id);
        var grip = el("span", "lp-grip");
        grip.innerHTML = ICON.grip;
        grip.setAttribute("aria-hidden", "true");
        grip.title = t("lp.drag");
        li.appendChild(grip);
        var pl = el("button", "icon-btn small lp-play" + (preview && preview.id === l.id ? " on" : ""));
        pl.type = "button";
        pl.innerHTML = preview && preview.id === l.id ? ICON.stop : ICON.play;
        setLabel(pl, (preview && preview.id === l.id ? t("lp.stop") : t("lp.play")) + ": " + name);
        pl.addEventListener("click", function () { togglePreview(l); });
        li.appendChild(pl);
        var txt = el("span", "lp-txt");
        txt.appendChild(el("span", "lp-name", name));
        txt.appendChild(el("span", "lp-meta", t(l.bars === 1 ? "lp.meta1" : "lp.meta", { n: l.bars, bpm: l.bpm, inst: t("snd." + l.inst) })));
        li.appendChild(txt);
        var add = el("button", "icon-btn small lp-add");
        add.type = "button"; add.innerHTML = ICON.plus;
        setLabel(add, t("lp.add") + ": " + name);
        add.addEventListener("click", function () { host.addLoop(l, null, null); });
        li.appendChild(add);
        list.appendChild(li);
      });
    }
    function stopPreview() {
      if (!preview) return;
      clearTimeout(preview.timer);
      preview.handles.forEach(function (h) { try { h.stop(); } catch (e) {} try { h.disconnect(); } catch (e) {} });
      preview = null;
      if (loopsOpen()) renderLoops();
    }
    function togglePreview(l) {
      var was = preview && preview.id;
      stopPreview();
      if (was === l.id) return;
      var a = host.audio(), out = a && host.previewOut();
      if (!out) return;
      var k = 60 / bpm(), t0 = a.currentTime + 0.05, hs = [];
      for (var rep = 0; rep < 2; rep++) {                 // twice round
        var base = t0 + rep * L.beatsOf(l) * k;
        L.notesOf(l).forEach(function (q) { hs.push(M.playNote(a, out, l.inst, q[0], q[3], base + q[1] * k, q[2] * k, 1)); });
      }
      preview = { id: l.id, handles: hs, timer: setTimeout(stopPreview, (2 * L.beatsOf(l) * k + 0.6) * 1000) };
      renderLoops();
    }
    // drag a loop onto a track
    var ld = null;
    function loopDown(e) {
      var li = e.target.closest && e.target.closest(".lp-item");
      if (!li || e.button > 0 || (e.target.closest && e.target.closest("button"))) return;
      if (e.pointerType === "touch" && !(e.target.closest && e.target.closest(".lp-grip"))) return;   // touch: only the grip drags; the rest scrolls
      e.preventDefault();
      ld = { id: li.getAttribute("data-l"), x0: e.clientX, y0: e.clientY, pid: e.pointerId, moved: false, ghost: null };
      try { $("lp-list").setPointerCapture(e.pointerId); } catch (err) {}
    }
    function loopMove(e) {
      if (!ld || e.pointerId !== ld.pid) return;
      if (!ld.moved && Math.abs(e.clientX - ld.x0) < 5 && Math.abs(e.clientY - ld.y0) < 5) return;
      if (!ld.moved) {
        ld.moved = true;
        var l = L.byId(ld.id);
        ld.ghost = el("div", "lp-ghost", l ? loopName(l) : "");
        ld.ghost.setAttribute("aria-hidden", "true");
        document.body.appendChild(ld.ghost);
      }
      ld.ghost.style.transform = "translate(" + (e.clientX + 8) + "px," + (e.clientY - 14) + "px)";
      host.dropHint(e.clientX, e.clientY);
    }
    function loopUp(e) {
      if (!ld || e.pointerId !== ld.pid) return;
      var d = ld; ld = null;
      if (d.ghost) d.ghost.remove();
      host.dropHint(null);
      if (!d.moved || e.type === "pointercancel") return;
      var l = L.byId(d.id);
      if (l) host.dropLoop(l, e.clientX, e.clientY);
    }

    // ---------- Wiring ----------
    function wire() {
      // tool, grid, velocity
      var mh = $("pr-mode");
      [["draw", "pr.draw", ICON.pencil], ["select", "pr.select", ICON.cursor]].forEach(function (x) {
        var b = el("button", "chip");
        b.type = "button";
        b.setAttribute("role", "radio");
        b.setAttribute("data-v", x[0]);
        b.innerHTML = x[2];
        b.appendChild(el("span", "", t(x[1])));
        b.addEventListener("click", function () { setMode(x[0]); });
        mh.appendChild(b);
      });
      mh.addEventListener("keydown", function (e) {
        var d = e.key === "ArrowRight" || e.key === "ArrowLeft";
        if (!d) return;
        e.preventDefault(); e.stopPropagation();
        setMode(host.pref("prMode") === "draw" ? "select" : "draw");
        var on = mh.querySelector('[data-v="' + host.pref("prMode") + '"]'); if (on) on.focus();
      });
      var gs = $("pr-grid-sel");
      N.GRID_ORDER.forEach(function (gid) { var o = el("option", "", t(GRID_KEY[gid])); o.value = gid; gs.appendChild(o); });
      gs.addEventListener("change", function () { host.pref("prGrid", gs.value); lastLen = step() || lastLen; render(); });
      $("pr-vel").addEventListener("input", function () {
        var v = parseInt($("pr-vel").value, 10) || 100, c = clip();
        $("pr-vel-out").textContent = String(v);
        if (sel.length && c) setNotes(N.setVel(c.n, sel, v), false, host.burst("prv" + c.id));
        else host.pref("prVel", v);
      });
      var icons = [["pr-undo", "undo", "btn.undo", function () { host.undo(); }], ["pr-redo", "redo", "btn.redo", function () { host.redo(); }],
                   ["pr-copy", "copy", "pr.copy", function () { copySel(false); }], ["pr-paste", "paste", "pr.paste", paste],
                   ["pr-del", "trash", "pr.del", delSel], ["pr-all", "selall", "pr.all", selectAll],
                   ["pr-zout", "zout", "btn.zoomOut", function () { zoomBy(-1); }], ["pr-zin", "zin", "btn.zoomIn", function () { zoomBy(1); }],
                   ["pr-close", "close", "btn.close", close], ["lp-close", "close", "btn.close", function () { toggleLoops(false); }]];
      icons.forEach(function (x) { var b = $(x[0]); b.innerHTML = ICON[x[1]]; setLabel(b, t(x[2])); b.addEventListener("click", x[3]); });
      $("pr-quant").addEventListener("click", quantize);
      $("pr-import").addEventListener("click", function () { var c = clip(); if (c) host.importMidiInto(c.id); });
      $("pr-export").addEventListener("click", function () { var c = clip(); if (c) host.exportClipMidi(c.id); });
      $("pr-play").addEventListener("click", playHere);
      // grid
      var gr = $("pr-grid");
      gr.addEventListener("pointerdown", onDown);
      gr.addEventListener("pointermove", onMove);
      gr.addEventListener("pointerup", onUp);
      gr.addEventListener("pointercancel", onUp);
      gr.addEventListener("contextmenu", function (e) { if (e.target.closest && e.target.closest(".pr-note")) e.preventDefault(); });
      $("pr-keys").addEventListener("pointerdown", function (e) {
        var k = e.target.closest && e.target.closest(".pr-key");
        if (k) audition(+k.getAttribute("data-p"), 100);
      });
      $("pr-ruler").addEventListener("click", function (e) {
        var c = clip();
        if (!c) return;
        var r = $("pr-ruler").getBoundingClientRect();
        host.seek(origin(c) + c.off + Math.max(0, (e.clientX - r.left) / pxs()));
      });
      $("pr-scroll").addEventListener("scroll", syncVelScroll, { passive: true });
      $("pr-scroll").addEventListener("wheel", function (e) {
        if (!e.ctrlKey) return;
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? 1 : -1);
      }, { passive: false });
      var vs = $("pr-vstems");
      vs.addEventListener("pointerdown", velDown);
      vs.addEventListener("pointermove", velMove);
      vs.addEventListener("pointerup", velUp);
      vs.addEventListener("pointercancel", velUp);
      $("pr-dlg").addEventListener("keydown", onKey);
      $("pr-dlg").addEventListener("close", function () { cid = ""; sel = []; g = null; host.closed(); });
      // loops
      $("loops-btn").innerHTML = ICON.loops;
      setLabel($("loops-btn"), t("lp.btn"));
      $("loops-btn").addEventListener("click", function () { toggleLoops(); });
      var lg = $("lp-genre");
      [""].concat(L.GENRES).forEach(function (x) { var o = el("option", "", x ? t("lp.g" + x) : t("lp.allGenres")); o.value = x; lg.appendChild(o); });
      lg.addEventListener("change", function () { host.pref("lpG", lg.value); renderLoops(); });
      var lt = $("lp-tempo");
      [["", "lp.anyTempo"], ["slow", "lp.slow"], ["mid", "lp.mid"], ["fast", "lp.fast"]].forEach(function (x) { var o = el("option", "", t(x[1])); o.value = x[0]; lt.appendChild(o); });
      lt.addEventListener("change", function () { host.pref("lpT", lt.value); renderLoops(); });
      var ll = $("lp-list");
      ll.addEventListener("pointerdown", loopDown);
      ll.addEventListener("pointermove", loopMove);
      ll.addEventListener("pointerup", loopUp);
      ll.addEventListener("pointercancel", loopUp);
    }

    return {
      open: open, close: close, isOpen: isOpen, render: render, tick: tick, busy: busy, wire: wire,
      clipId: function () { return isOpen() ? cid : ""; },
      toggleLoops: toggleLoops, loopsOpen: loopsOpen, renderLoops: renderLoops, stopPreview: stopPreview, loopName: loopName
    };
  };
})(typeof window !== "undefined" ? window : this);
