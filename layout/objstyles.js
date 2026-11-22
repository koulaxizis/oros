// ============================================================
// orOS Layout — object styles (LY-W5b, v1.0.0)
// A named set of a frame's or shape's looks: fill, stroke and its
// width and dash, opacity, corners, and for text frames inset,
// columns, gutter, vertical alignment and justification; wrap and its
// offset. Kept in the document (setup.ext.os, at most 60), so they
// travel with it; an object that uses one says so in ext.os.
//   - KEYS, TEXT_KEYS: what a style holds
//   - capture(it): the looks of an object as a style's p
//   - apply(it, p, id): the looks onto an object (text keys only on a
//     text frame), remembering the style
//   - norm(list): the saved list checked (ids, names, values)
//   - section(items, ui): the Object style part of the properties
//     panel (browser only)
// Redefining a style puts its new looks on every object that uses it,
// as one undo step. Pure parts are shared with the tests.
// ============================================================
(function (root) {
  "use strict";

  var KEYS = ["fill", "stroke", "sw", "dash", "op", "r", "wrap", "wo"];
  var TEXT_KEYS = ["ins", "cols", "gut", "va"];
  var MAX = 60;
  var ID_RE = /^os-[a-z0-9]{1,24}$/;
  var SW_RE = /^([a-z]{1,4}-[a-z0-9]{1,24})?$/;

  function num(v, min, max, d) { v = Number(v); return isFinite(v) ? Math.max(min, Math.min(max, v)) : d; }
  function capture(it) {
    var p = {};
    KEYS.forEach(function (k) { if (it[k] !== undefined) p[k] = it[k]; });
    if (it.t === "text") {
      TEXT_KEYS.forEach(function (k) { if (it[k] !== undefined) p[k] = it[k]; });
      p.vj = it.ext && it.ext.vj ? 1 : 0;
    }
    return clean(p);
  }
  function clean(p) {
    var o = {};
    if (!p || typeof p !== "object") return o;
    if (typeof p.fill === "string" && SW_RE.test(p.fill)) o.fill = p.fill;
    if (typeof p.stroke === "string" && SW_RE.test(p.stroke)) o.stroke = p.stroke;
    if (p.sw !== undefined) o.sw = num(p.sw, 0, 200, 1);
    if (p.dash !== undefined) o.dash = p.dash ? 1 : 0;
    if (p.op !== undefined) o.op = Math.round(num(p.op, 0, 100, 100));
    if (p.r !== undefined) o.r = num(p.r, 0, 5000, 0);
    if (p.wrap !== undefined && /^(none|box|ell)$/.test(p.wrap)) o.wrap = p.wrap;
    if (p.wo !== undefined) o.wo = num(p.wo, -500, 500, 6);
    if (p.ins !== undefined) o.ins = num(p.ins, 0, 500, 0);
    if (p.cols !== undefined) o.cols = Math.round(num(p.cols, 1, 20, 1));
    if (p.gut !== undefined) o.gut = num(p.gut, 0, 500, 12);
    if (p.va !== undefined && /^[tcb]$/.test(p.va)) o.va = p.va;
    if (p.vj !== undefined) o.vj = p.vj ? 1 : 0;
    return o;
  }
  function apply(it, p, id) {
    p = clean(p);
    KEYS.forEach(function (k) {
      if (p[k] === undefined) return;
      if ((k === "fill" || k === "r") && it.t === "line") return;
      if (k === "r" && (it.t === "ell" || it.t === "path")) return;
      it[k] = p[k];
    });
    if (p.fill !== undefined) delete it.gr;
    if (it.t === "text") {
      TEXT_KEYS.forEach(function (k) { if (p[k] !== undefined) it[k] = p[k]; });
      if (p.vj !== undefined) { it.ext = it.ext || {}; if (p.vj) it.ext.vj = 1; else delete it.ext.vj; }
    }
    if (id) { it.ext = it.ext || {}; it.ext.os = id; }
    else if (it.ext) delete it.ext.os;
    if (it.ext && !Object.keys(it.ext).length) delete it.ext;
    return it;
  }
  function norm(list) {
    if (!Array.isArray(list)) return [];
    var out = [], seen = {};
    list.slice(0, MAX).forEach(function (s) {
      if (!s || typeof s !== "object" || !ID_RE.test(String(s.id)) || seen[s.id]) return;
      seen[s.id] = 1;
      out.push({ id: s.id, name: String(s.name || "").replace(/[\u0000-\u001f]/g, "").slice(0, 60) || s.id, p: clean(s.p) });
    });
    return out;
  }
  function newId() { return "os-" + Math.random().toString(36).slice(2, 10); }

  // ---------- the properties panel (browser) ----------
  function section(items) {
    var LY = root.LY, t = LY.t, el = LY.el, M = LY.M, ui = LY.ui;
    var doc = LY.doc, list = norm(doc.setup.ext && doc.setup.ext.os);
    var s = el("section", "pn-sec");
    s.appendChild(el("h3", "pn-h", t("os.title")));
    var ids = items.map(function (it) { return it.ext && it.ext.os || ""; });
    var cur = ids.every(function (v) { return v === ids[0]; }) ? ids[0] : "";
    if (cur && !list.some(function (x) { return x.id === cur; })) cur = "";
    function setList(d, nl) {
      d.setup.ext = d.setup.ext || {};
      if (nl.length) d.setup.ext.os = nl; else delete d.setup.ext.os;
      if (!Object.keys(d.setup.ext).length) delete d.setup.ext;
    }
    function stamp(d, now) { d.m = Math.max(now, (d.m || 0) + 1); }
    var sel = ui.select([["", t("os.none")]].concat(list.map(function (x) { return [x.id, x.name]; })), cur, function (v) {
      var st = list.filter(function (x) { return x.id === v; })[0];
      var sids = LY.ed.sel.slice();
      LY.op(function (d, now) {
        sids.forEach(function (id) {
          var it = M.find(d.items, id);
          if (!it) return;
          if (st) apply(it, st.p, st.id);
          else if (it.ext && it.ext.os) { delete it.ext.os; if (!Object.keys(it.ext).length) delete it.ext; }
          M.touch(it, now);
        });
      });
    });
    sel.setAttribute("aria-label", t("os.title"));
    s.appendChild(sel);
    var r = el("div", "pn-row wrap");
    r.appendChild(ui.btn(t("os.new"), function () {
      var one = items[0];
      LY.op(function (d, now) {
        var nl = norm(d.setup.ext && d.setup.ext.os);
        if (nl.length >= MAX) { LY.toast(t("os.max", { n: MAX })); return false; }
        var id = newId(), name = t("os.nameN", { n: nl.length + 1 });
        nl.push({ id: id, name: name, p: capture(one) });
        setList(d, nl);
        stamp(d, now);
        LY.ed.sel.forEach(function (sid) { var it = M.find(d.items, sid); if (it) { it.ext = it.ext || {}; it.ext.os = id; M.touch(it, now); } });
      });
    }, "small"));
    if (cur) {
      r.appendChild(ui.btn(t("os.redefine"), function () {
        var one = items[0];
        LY.op(function (d, now) {
          var nl = norm(d.setup.ext && d.setup.ext.os), st = nl.filter(function (x) { return x.id === cur; })[0];
          if (!st) return false;
          st.p = capture(M.find(d.items, one.id) || one);
          setList(d, nl);
          stamp(d, now);
          d.items.forEach(function (it) { if (it.ext && it.ext.os === cur) { apply(it, st.p, cur); M.touch(it, now); } });
        });
      }, "small"));
      var nm = el("input", "inp");
      nm.type = "text"; nm.maxLength = 60;
      nm.value = (list.filter(function (x) { return x.id === cur; })[0] || {}).name || "";
      nm.setAttribute("aria-label", t("os.name"));
      nm.addEventListener("change", function () {
        var v = nm.value.trim().slice(0, 60);
        if (!v) return;
        LY.op(function (d, now) {
          var nl = norm(d.setup.ext && d.setup.ext.os), st = nl.filter(function (x) { return x.id === cur; })[0];
          if (!st || st.name === v) return false;
          st.name = v; setList(d, nl); stamp(d, now);
        });
      });
      s.appendChild(ui.field(t("os.name"), nm));
      r.appendChild(ui.btn(t("os.del"), function () {
        LY.op(function (d, now) {
          var nl = norm(d.setup.ext && d.setup.ext.os).filter(function (x) { return x.id !== cur; });
          setList(d, nl); stamp(d, now);
          // the objects keep their looks; they just no longer follow the style
          d.items.forEach(function (it) { if (it.ext && it.ext.os === cur) { delete it.ext.os; if (!Object.keys(it.ext).length) delete it.ext; M.touch(it, now); } });
        });
      }, "small ghost"));
    }
    s.appendChild(r);
    s.appendChild(el("p", "hint", t("os.hint")));
    return s;
  }

  var api = { KEYS: KEYS, TEXT_KEYS: TEXT_KEYS, MAX: MAX, capture: capture, clean: clean, apply: apply, norm: norm, section: section };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_OS = api;
})(typeof window !== "undefined" ? window : this);
