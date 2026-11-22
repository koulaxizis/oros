// ============================================================
// orOS Layout — working comfort, the parts on screen (LY-N2, v1.0.0)
//   - the context toolbar: a small bar over the selection with what
//     it most needs (edit text or place a picture, duplicate, front,
//     back, group, lock, delete, more); hidden while dragging, while
//     typing in a frame and in preview; Off in Shortcuts and comfort.
//   - History…: the named undo steps (smart.js describe), newest
//     first, a click goes back (or forward) to that step.
//   - Shortcuts and comfort…: every changeable shortcut (press the new
//     keys; a clash asks before it moves), the arrow-key step in the
//     document's unit, and switches for smart guides, live
//     measurements and the toolbar. Saved in Layout's preferences on
//     this device.
// ============================================================
(function () {
  "use strict";
  var LY = window.LY, t = LY.t, el = LY.el, S = window.LY_SMART;
  var ED = null, bar = null, sig = "";
  var MAC = /Mac|iPhone|iPad/.test((navigator && navigator.platform) || "");

  // ---------- the context toolbar ----------
  function ib(icon, label, fn, on) {
    var b = LY.iconBtn(icon, label, "small" + (on ? " on" : ""));
    b.addEventListener("click", function (e) { e.stopPropagation(); fn(b); });
    return b;
  }
  function build(items) {
    bar.innerHTML = "";
    var one = items.length === 1 ? items[0] : null;
    if (one && one.t === "text") bar.appendChild(ib("edit", t("props.edit"), function () { ED.editText(one.id, null); }));
    if (one && one.t === "img") bar.appendChild(ib("image", one.a ? t("props.replace") : t("props.place"), function () { LY.io.placeImage(one.id); }));
    bar.appendChild(ib("copy", t("props.dup"), function () { ED.duplicate(); }));
    bar.appendChild(ib("front", t("props.front"), function () { ED.arrange("front"); }));
    bar.appendChild(ib("toBack", t("props.back"), function () { ED.arrange("back"); }));
    if (items.length > 1) bar.appendChild(ib("group", t("props.group"), function () { ED.group(); }));
    else if (items.some(function (it) { return it.grp; })) bar.appendChild(ib("group", t("props.ungroup"), function () { ED.ungroup(); }, true));
    var locked = items.every(function (it) { return it.lock; });
    var lb = ib(locked ? "lock" : "unlock", t("props.lock"), function () { ED.toggleLock(); }, locked);
    lb.setAttribute("aria-pressed", locked ? "true" : "false");
    bar.appendChild(lb);
    bar.appendChild(ib("trash", t("props.del"), function () { ED.deleteSel(); }));
    bar.appendChild(ib("more", t("cb.more"), function (b) {
      var r = b.getBoundingClientRect(), s = LY.$("stage").getBoundingClientRect();
      ED.contextMenu(r.left - s.left, r.bottom - s.top + 4);
    }));
  }
  function update() {
    if (!bar || !ED) return;
    var doc = LY.doc, items = doc ? ED.selItems() : [];
    var show = doc && items.length && LY.prefs.ctxbar !== 0 && !ED.preview && !ED.dragging() && !ED.vecActive() &&
      !(LY.inframe && LY.inframe.isOn()) && !ED.threadFrom && !LY.$("editor").hidden;
    if (!show) { bar.hidden = true; return; }
    var s2 = items.map(function (it) { return it.id + it.t + (it.lock ? 1 : 0) + (it.grp || "") + (it.a ? 1 : 0); }).join(",");
    if (s2 !== sig) { sig = s2; build(items); }
    // above the selection, or under it when there is no room
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    items.forEach(function (it) {
      var P = ED.pOf(it);
      if (!P) return;
      window.orosDK.render.corners(it).forEach(function (p) {
        var q = ED.toScreen(P.x + p[0], P.y + p[1]);
        x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]);
      });
    });
    if (!isFinite(x0)) { bar.hidden = true; return; }
    bar.hidden = false;
    var st = LY.$("stage"), W = st.clientWidth, H = st.clientHeight, bw = bar.offsetWidth, bh = bar.offsetHeight;
    var top = y0 - bh - 14;
    if (top < 22) top = y1 + 14;
    if (top + bh > H - 4) top = Math.max(22, Math.min(H - bh - 4, y0 + 8));
    var left = Math.max(22, Math.min(W - bw - 6, (x0 + x1) / 2 - bw / 2));
    bar.style.left = Math.round(left) + "px"; bar.style.top = Math.round(top) + "px";
  }

  // ---------- History ----------
  function timeOf(at) {
    if (!at) return "";
    try { return new Date(at).toLocaleTimeString(LY.LANG === "el" ? "el-GR" : LY.LANG === "de" ? "de-DE" : "en-GB", { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; }
  }
  function stepName(d) {
    if (!d) return t("hist.edit");
    if (d.k === "style" && d.name) return t("hist.styleN", { name: LY.label ? LY.label(d.name) : String(d.name) });
    if ((d.k === "add" || d.k === "del" || d.k === "move" || d.k === "resize" || d.k === "rotate" || d.k === "change") && d.n > 1) return t("hist." + d.k + "N", { n: d.n });
    return t("hist." + d.k);
  }
  LY.histName = stepName;
  function historyDlg() {
    if (!LY.doc) return;
    LY.openDialog(t("hist.title"), function (body, close) {
      var list = LY.history(40).slice().reverse();
      if (list.length <= 1) body.appendChild(el("p", "hint", t("hist.none")));
      var ul = el("ul", "hist-list");
      list.forEach(function (h) {
        var li = el("li", "hist-row" + (h.i === 0 ? " now" : h.i > 0 ? " future" : ""));
        var b = el("button", "hist-btn");
        b.type = "button";
        b.appendChild(el("span", "hist-name", h.start ? t("hist.start") : stepName(h.d)));
        b.appendChild(el("span", "hist-time", h.i === 0 ? t("hist.now") : h.start ? "" : timeOf(h.at)));
        if (h.i === 0) { b.disabled = true; b.setAttribute("aria-current", "step"); }
        b.addEventListener("click", function () { close(); LY.historyGo(h.i); });
        li.appendChild(b);
        ul.appendChild(li);
      });
      body.appendChild(ul);
      body.appendChild(el("p", "hint", t("hist.hint")));
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(LY.ui.btn(t("btn.close"), close, "primary"));
      body.appendChild(act);
    });
  }

  // ---------- Shortcuts and comfort ----------
  function actName(id) { return t("ka." + id); }
  function keysDlg() {
    LY.openDialog(t("keys.title"), function (body, close) {
      var mine = Object.assign({}, S.normKeys(LY.prefs.keys)), waiting = null;
      var tbl = el("div", "keys-list");
      function cur() { return S.keymap(mine); }
      function save() {
        LY.prefs.keys = S.normKeys(mine);
        if (!Object.keys(LY.prefs.keys).length) delete LY.prefs.keys;
        LY.savePrefs();
      }
      function draw() {
        tbl.innerHTML = "";
        var map = cur();
        S.ACTIONS.forEach(function (a) {
          var row = el("div", "keys-row");
          row.appendChild(el("span", "keys-name", actName(a[0])));
          var k = el("button", "btn small keys-key" + (waiting === a[0] ? " on" : ""), waiting === a[0] ? t("keys.press") : (S.label(map[a[0]], MAC) || t("keys.none")));
          k.type = "button";
          k.setAttribute("aria-label", actName(a[0]) + ": " + (S.label(map[a[0]], MAC) || t("keys.none")) + ". " + t("keys.change"));
          k.addEventListener("click", function () { waiting = waiting === a[0] ? null : a[0]; draw(); if (waiting) setTimeout(function () { var f = tbl.querySelector(".keys-key.on"); if (f) f.focus(); }, 0); });
          row.appendChild(k);
          if (map[a[0]] !== a[1]) {
            var r = el("button", "btn small ghost", t("keys.default"));
            r.type = "button";
            r.addEventListener("click", function () { delete mine[a[0]]; save(); draw(); });
            row.appendChild(r);
          }
          if (map[a[0]]) {
            var x = LY.iconBtn("close", t("keys.clear"), "small");
            x.addEventListener("click", function () { mine[a[0]] = ""; save(); draw(); });
            row.appendChild(x);
          }
          tbl.appendChild(row);
        });
      }
      function onKey(e) {
        if (!waiting) return;
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); waiting = null; draw(); return; }
        var c = S.comboOf(e);
        if (!c) return;
        e.preventDefault(); e.stopPropagation();
        if (!S.valid(c)) { LY.toast(t("keys.reserved", { k: S.label(c, MAC) })); return; }
        var map = cur(), other = S.lookup(map, c), id = waiting;
        // the keys move here; the action that had them is left without (said so)
        if (other && other !== id) { mine[other] = ""; LY.toast(t("keys.clash", { k: S.label(c, MAC), a: actName(other) })); }
        mine[id] = c;
        waiting = null;
        save(); draw();
      }
      body.addEventListener("keydown", onKey, true);
      body.appendChild(el("p", "hint", t("keys.hint")));
      body.appendChild(tbl);
      draw();
      // comfort
      body.appendChild(el("h3", "pn-h", t("keys.comfort")));
      var u = (LY.doc && LY.doc.setup.unit) || "mm";
      var n = el("input", "inp num");
      n.type = "number"; n.min = 0.01; n.max = 100; n.step = u === "in" ? 0.01 : 0.1;
      n.value = String(Math.round(S.nudge(u, LY.prefs.nudge) / S.PT_PER[u] * 1000) / 1000);
      n.addEventListener("change", function () {
        var v = parseFloat(n.value);
        if (isFinite(v) && v > 0 && v <= 100) LY.prefs.nudge = v; else delete LY.prefs.nudge;
        LY.savePrefs();
      });
      body.appendChild(LY.ui.field(t("keys.nudge", { u: u }), n));
      body.appendChild(el("p", "hint", t("keys.nudgeHint")));
      [["smart", "keys.smart"], ["measure", "keys.measure"], ["ctxbar", "keys.ctxbar"]].forEach(function (f) {
        body.appendChild(LY.ui.check(t(f[1]), LY.prefs[f[0]] !== 0, function (v) {
          if (v) delete LY.prefs[f[0]]; else LY.prefs[f[0]] = 0;
          LY.savePrefs(); update();
        }));
      });
      var act = el("div", "dlg-actions");
      act.appendChild(LY.ui.btn(t("keys.resetAll"), function () { mine = {}; save(); draw(); }));
      act.appendChild(el("span", "spacer"));
      act.appendChild(LY.ui.btn(t("btn.close"), close, "primary"));
      body.appendChild(act);
    }, true);
  }

  LY.on("boot", function () {
    ED = LY.ed;
    bar = el("div", "ctx-bar");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", t("cb.title"));
    bar.hidden = true;
    LY.$("stage").appendChild(bar);
    // pointer events on the bar never reach the canvas
    bar.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    LY.dlg = LY.dlg || {};
    LY.dlg.history = historyDlg;
    LY.dlg.keys = keysDlg;
    LY.on("drawn", update);
    LY.on("sel", update);
    LY.on("close", function () { if (bar) bar.hidden = true; });
  });
  LY.comfort = { update: update, history: historyDlg, keys: keysDlg };
})();
