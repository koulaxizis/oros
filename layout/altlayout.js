// ============================================================
// orOS Layout — alternate layouts (v1.0.0, LY-W16). One design in
// another size (a 140×210 book as a square post, an A5 flyer as an A4
// poster): the alternate is a document of its own, made from the
// original with its pages fitted to the new size the way retrim.js
// moves things (LY-W8), and it keeps its texts linked to the
// original's:
//   - setup.ext.alt { src (the original's id), n (the label, "Square"),
//     k (how much the text sizes followed the page, 1 = not) };
//   - each linked story keeps ext.alt = the fingerprint of the
//     original's paragraphs when they were last taken.
// Only text goes one way, original → alternate, and only when the
// person says so (Update): a story whose original changed is "out of
// date"; one also changed here is "changed on both sides" and an
// update replaces its changes here (the dialog says so first). Frames,
// pictures and places stay the alternate's own. Paragraph and
// character styles and swatches the original gained are added (text
// sizes scaled by k); styles both have stay as the alternate set them.
// A book's membership (setup.ext.bk), the Publishing title (pub) and a
// cover's geometry (cover) stay with the original.
// Pure part LY_ALT (make, info, status, update, unlink, alternates,
// fp) / module.exports; the browser part is LY.altLayouts
// (More › Alternate layouts…).
// ============================================================
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var M = node ? require("../designkit/model.js") : root.orosDK && root.orosDK.model;
  var RT = node ? require("./retrim.js") : root.LY_RETRIM;
  var LABEL = 60, MIN = 36, MAX = 14400;   // points, as the setup allows
  var KEEP_OUT = ["bk", "pub", "cover", "alt"];

  function str(v, n) { return String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n); }
  function plain(o) { return JSON.parse(JSON.stringify(o)); }
  // the fingerprint of a story's paragraphs (FNV-1a and the length)
  function fp(paras) {
    var s = JSON.stringify(paras || []), h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8) + "-" + s.length.toString(36);
  }
  function info(doc) {
    var a = doc && doc.setup && doc.setup.ext && doc.setup.ext.alt;
    if (!a || typeof a !== "object" || typeof a.src !== "string" || !a.src) return null;
    var k = Number(a.k);
    return { src: a.src, n: str(a.n, LABEL), k: isFinite(k) && k > 0 ? k : 1 };
  }
  function bump(doc, now) {
    doc.setup.m = Math.max(now, (doc.setup.m || 0) + 1);
    doc.m = Math.max(now, (doc.m || 0) + 1);
  }

  // A new alternate of src: opts { w, h (points), label, text ("scale"
  // = text sizes follow the page), now } → the new document, or
  // { err: "size" | "label" }
  function make(src, opts) {
    opts = opts || {};
    var w = Number(opts.w), h = Number(opts.h), label = str(opts.label, LABEL), now = opts.now || Date.now();
    if (!isFinite(w) || !isFinite(h) || w < MIN || h < MIN || w > MAX || h > MAX) return { err: "size" };
    if (!label) return { err: "label" };
    var d = M.copyDoc(src, now);
    var x = Object.assign({}, d.setup.ext || {});
    KEEP_OUT.forEach(function (k) { delete x[k]; });
    d.setup.ext = x;
    var nu = Object.assign(plain(d.setup), { w: w, h: h }, RT.marginsFor(d.setup, w, h));
    delete nu.preset;
    var res = RT.retrim(d, nu, { text: opts.text === "scale" ? "scale" : "", now: now });
    d.setup.ext.alt = { src: src.id, n: label, k: opts.text === "scale" ? res.k : 1 };
    d.name = str((src.name || "") + " · " + label, 120);
    (d.stories || []).forEach(function (s) {
      var o = M.find(src.stories, s.id);
      if (!o) return;
      s.ext = Object.assign({}, s.ext || {}, { alt: fp(o.paras) });
    });
    return M.normDoc(d);
  }

  // what changed in the original since the alternate last took it
  // → { gone, out [story ids changed there], both [of those, also
  // changed here], styles (styles and swatches the original gained) }
  function status(alt, src) {
    var a = info(alt), out = [], both = [];
    if (!a) return null;
    if (!src || src.id !== a.src) return { gone: true, out: out, both: both, styles: 0 };
    (alt.stories || []).forEach(function (s) {
      var mark = s.ext && s.ext.alt, o = M.find(src.stories, s.id);
      if (typeof mark !== "string" || !o) return;
      if (fp(o.paras) === mark) return;
      out.push(s.id);
      if (fp(s.paras) !== mark) both.push(s.id);
    });
    return { gone: false, out: out, both: both, styles: missing(alt, src).length };
  }
  function missing(alt, src) {
    var l = [];
    [["pstyles"], ["cstyles"], ["swatches"]].forEach(function (c) {
      (src[c[0]] || []).forEach(function (e) { if (!M.find(alt[c[0]] || [], e.id)) l.push([c[0], e]); });
    });
    return l;
  }

  // the original's texts into the alternate (in place) → { stories,
  // styles }; ids limits it to those stories
  function update(alt, src, now, ids) {
    var st = status(alt, src);
    if (!st || st.gone) return { stories: 0, styles: 0 };
    var a = info(alt), want = ids ? {} : null;
    if (ids) ids.forEach(function (id) { want[id] = 1; });
    var n = 0;
    (alt.stories || []).forEach(function (s) {
      if (st.out.indexOf(s.id) < 0 || (want && !want[s.id])) return;
      var o = M.find(src.stories, s.id);
      s.paras = plain(o.paras);
      s.ext = Object.assign({}, s.ext || {}, { alt: fp(o.paras) });
      s.h = [s.m].concat(s.h || []);
      s.m = Math.max(now, (s.m || 0) + 1);
      n++;
    });
    var add = missing(alt, src), styles = 0;
    add.forEach(function (p) {
      var e = plain(p[1]);
      e.m = now;
      if (p[0] !== "swatches" && Math.abs(a.k - 1) > 0.01) {
        var tmp = { pstyles: p[0] === "pstyles" ? [e] : [], cstyles: p[0] === "cstyles" ? [e] : [] };
        RT.scaleStyles(tmp, a.k, now);
      }
      alt[p[0]] = (alt[p[0]] || []).concat([e]);
      styles++;
    });
    if (n || styles) bump(alt, now);
    return { stories: n, styles: styles };
  }

  // a plain document again (its texts no longer follow the original)
  function unlink(alt, now) {
    if (!info(alt)) return false;
    var x = Object.assign({}, alt.setup.ext);
    delete x.alt;
    alt.setup.ext = x;
    (alt.stories || []).forEach(function (s) {
      if (!s.ext || s.ext.alt === undefined) return;
      var e = Object.assign({}, s.ext);
      delete e.alt;
      if (Object.keys(e).length) s.ext = e; else delete s.ext;
      s.m = Math.max(now, (s.m || 0) + 1);
    });
    bump(alt, now);
    return true;
  }

  // the alternates made from a document (deleted ones left out)
  function alternates(docs, id) {
    return (docs || []).filter(function (d) { var a = !d.del && info(d); return a && a.src === id; });
  }

  var api = { make: make, info: info, status: status, update: update, unlink: unlink, alternates: alternates, fp: fp, LABEL: LABEL };
  if (node) { module.exports = api; return; }
  root.LY_ALT = api;

  // ---------- browser: LY.altLayouts ----------
  var LY = root.LY;
  if (!LY) return;
  var t = LY.t, el = LY.el;
  function mm(pt) { return Math.round(M.toUnit(pt, "mm")); }

  // More › Alternate layouts…
  function dialog() {
    if (!LY.doc) return;
    LY.flushStory && LY.flushStory();
    LY.openDialog(t("alt.title"), function (body, close) {
      var doc = LY.doc, a = info(doc);
      body.appendChild(el("p", "hint", t("alt.hint")));
      // this document is an alternate
      if (a) {
        var src = LY.findDoc(a.src), st = status(doc, src && !src.del ? src : null);
        var box = el("div", "alt-box");
        if (st.gone) {
          box.appendChild(el("p", "", t("alt.gone", { n: a.n })));
        } else {
          box.appendChild(el("p", "", t("alt.of", { n: a.n, src: LY.docTitle(src) })));
          box.appendChild(el("p", "hint", st.out.length || st.styles
            ? t("alt.out", { n: st.out.length, s: st.styles }) : t("alt.current")));
          if (st.both.length) box.appendChild(el("p", "hint warn", t("alt.both", { n: st.both.length })));
        }
        var row = el("div", "pn-row wrap");
        if (!st.gone) {
          var up = LY.ui.btn(t("alt.update"), function () {
            var res = null;
            LY.op(function (d, now) { res = update(d, LY.findDoc(a.src), now); if (!res.stories && !res.styles) return false; });
            LY.toast(t("alt.updated", { n: res ? res.stories : 0, s: res ? res.styles : 0 }));
            close();
          }, "small primary");
          up.disabled = !st.out.length && !st.styles;
          row.appendChild(up);
          row.appendChild(LY.ui.btn(t("alt.openSrc"), function () { close(); LY.openDoc(a.src); }, "small"));
        }
        var arm = false, un = LY.ui.btn(t("alt.unlink"), function () {
          if (!arm) { arm = true; un.textContent = t("alt.unlinkSure"); return; }
          LY.op(function (d, now) { if (!unlink(d, now)) return false; });
          LY.toast(t("alt.unlinked"));
          close();
        }, "small");
        row.appendChild(un);
        box.appendChild(row);
        body.appendChild(box);
      }
      // the alternates of this document
      var mine = alternates(LY.allDocs ? LY.allDocs() : [], doc.id);
      if (mine.length) {
        body.appendChild(el("span", "fld-lbl", t("alt.list")));
        var lst = el("div", "sym-list");
        mine.forEach(function (d) {
          var r = el("div", "sym-row");
          r.appendChild(el("span", "alt-n", info(d).n));
          r.appendChild(el("span", "hint", mm(d.setup.w) + "×" + mm(d.setup.h) + " mm"));
          var s2 = status(d, doc);
          if (s2 && (s2.out.length || s2.styles)) r.appendChild(el("span", "hint", t("alt.stale")));
          r.appendChild(LY.ui.btn(t("alt.open"), function () { close(); LY.openDoc(d.id); }, "small"));
          lst.appendChild(r);
        });
        body.appendChild(lst);
      }
      // a new alternate
      body.appendChild(el("span", "fld-lbl", t("alt.new")));
      var s = { w: doc.setup.h > doc.setup.w ? doc.setup.h : doc.setup.w, h: doc.setup.w, text: 1, preset: "custom" };
      var first = M.preset("square");
      if (first) { s.w = first.w; s.h = first.h; s.preset = "square"; }
      var lab = el("input", "inp"); lab.type = "text"; lab.maxLength = LABEL; lab.value = t("preset." + s.preset);
      body.appendChild(LY.ui.field(t("alt.label"), lab));
      var wIn, hIn;
      var opts = M.PRESETS.map(function (p) { return [p[0], t("preset." + p[0])]; }).concat([["custom", t("preset.custom")]]);
      var sel = LY.ui.select(opts, s.preset, function (v) {
        var old = t("preset." + s.preset);
        s.preset = v;
        if (!lab.value.trim() || lab.value === old) lab.value = t("preset." + v);
        var p = M.preset(v);
        if (!p) return;
        var land = s.w > s.h;
        s.w = land ? p.h : p.w; s.h = land ? p.w : p.h;
        wIn.value = LY.fmt(s.w); hIn.value = LY.fmt(s.h);
      });
      body.appendChild(LY.ui.field(t("new.size"), sel));
      function dim(key) {
        var inp = el("input", "inp num"); inp.type = "text"; inp.inputMode = "decimal"; inp.value = LY.fmt(s[key]);
        inp.addEventListener("change", function () {
          var v = LY.parse(inp.value);
          if (v === null || !isFinite(v)) { inp.value = LY.fmt(s[key]); return; }
          s[key] = Math.min(MAX, Math.max(MIN, v)); inp.value = LY.fmt(s[key]);
          s.preset = "custom"; sel.value = "custom";
        });
        return inp;
      }
      var g = el("div", "grid2");
      wIn = dim("w"); hIn = dim("h");
      g.appendChild(LY.ui.field(t("new.w"), wIn));
      g.appendChild(LY.ui.field(t("new.h"), hIn));
      body.appendChild(g);
      var turn = LY.ui.btn(t("alt.turn"), function () {
        var tmp = s.w; s.w = s.h; s.h = tmp; wIn.value = LY.fmt(s.w); hIn.value = LY.fmt(s.h);
      }, "small");
      body.appendChild(turn);
      body.appendChild(LY.ui.check(t("alt.text"), s.text, function (v) { s.text = v; }));
      var row2 = el("div", "pn-row wrap");
      row2.appendChild(LY.ui.btn(t("alt.make"), function () {
        var d = make(LY.doc, { w: s.w, h: s.h, label: lab.value, text: s.text ? "scale" : "", now: LY.now() });
        if (d.err) { LY.toast(t(d.err === "label" ? "alt.errLabel" : "alt.errSize")); return; }
        close();
        LY.addDoc(d);
        LY.toast(t("alt.made", { n: info(d).n }));
      }, "small primary"));
      body.appendChild(row2);
    });
  }

  LY.altLayouts = { dialog: dialog };
})(typeof window !== "undefined" ? window : this);
