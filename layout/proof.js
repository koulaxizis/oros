// ============================================================
// orOS Layout — print colours (LY-W9, v1.0.0)
// What the pages look like in ink, and the settings of the print
// checks:
//   - views: proof (soft proof: each colour through the print profile,
//     CMYK swatches with their own inks), c / m / y / k (one ink plate,
//     dark where it prints) and ink (total ink: over the limit in
//     bright pink, the rest in greys). Overprinting colours are drawn
//     multiplied, as they print. Pictures go through the same table.
//   - the print profile: Coated FOGRA39 (built in) or the person's own
//     CMYK printer profile (.icc, a v2 profile with 16-bit tables),
//     kept in Files at /internal/Layout/Profiles and named in
//     setup.ext.iccF / iccN, so the document and its PDF use it.
//   - settings (setup.ext.pf): ink limit, the safe distance of text
//     from the trim, black overprints (render.js pfOf, preflight).
//   - opList / opFn: the inks that overprint in the PDF (pdfx.js).
// Pure part LY_PROOF (Node tests); browser part LY.proof.
// ============================================================
(function (root) {
  "use strict";

  var MODES = ["", "proof", "c", "m", "y", "k", "ink"];
  var WARN = [255, 0, 170];

  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  // a colour's inks 0..1: the swatch's own CMYK, else through the profile
  function inksOf(c, conv) {
    if (c.cmyk) return c.cmyk.map(function (v) { return clamp(v / 100); });
    var r = c.rgb[0] / 255, g = c.rgb[1] / 255, b = c.rgb[2] / 255;
    if (conv) return conv.rgb(r, g, b);
    var k = 1 - Math.max(r, g, b);
    return k >= 1 ? [0, 0, 0, 1] : [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
  }
  function byte(v) { return Math.round(clamp(v) * 255); }
  // inks → what this view shows, [r, g, b] 0..255
  function showInks(mode, q, conv, limit) {
    if (mode === "proof") return conv.show(q[0], q[1], q[2], q[3]).map(byte);
    if (mode === "ink") {
      var t = (q[0] + q[1] + q[2] + q[3]) * 100;
      if (t > limit + 0.5) return WARN.slice();
      var g = Math.round(255 - t / 400 * 150);
      return [g, g, g];
    }
    var i = "cmyk".indexOf(mode), v = Math.round(255 * (1 - clamp(q[i])));
    return [v, v, v];
  }
  // a view for render.setView; R: designkit/render.js; grid: pdfx.grid
  function viewFor(mode, conv, doc, R, grid, images) {
    if (MODES.indexOf(mode) < 1 || !conv) return null;
    var limit = R.pfOf(doc).ink, memo = {};
    return {
      mode: mode,
      color: function (c) {
        var key = c.cmyk ? "c" + c.cmyk.join(",") : c.rgb.join(",");
        return memo[key] || (memo[key] = showInks(mode, inksOf(c, conv), conv, limit));
      },
      op: function (sw) { return R.overprints(doc, sw); },
      image: images ? function (img) { return images(mode, limit, img, function (r, g, b) { return showInks(mode, conv.rgb(r, g, b), conv, limit).map(function (v) { return v / 255; }); }, grid); } : null
    };
  }
  // the inks that overprint in the PDF (0..1 each): black alone when
  // black overprints, and every swatch marked so
  function opList(doc, R) {
    var out = [];
    if (R.pfOf(doc).bop) out.push([0, 0, 0, 1]);
    (doc.swatches || []).forEach(function (sw) {
      if (!(sw.ext && sw.ext.op)) return;
      out.push(sw.mode === "cmyk" ? sw.v.map(function (v) { return clamp(v / 100); }) : null);
    });
    return out.filter(Boolean);
  }
  function opFn(list) {
    if (!list.length) return null;
    return function (q) {
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (Math.abs(a[0] - q[0]) < 0.003 && Math.abs(a[1] - q[1]) < 0.003 && Math.abs(a[2] - q[2]) < 0.003 && Math.abs(a[3] - q[3]) < 0.003) return true;
      }
      return false;
    };
  }
  // the settings, checked: ink 200..400 %, safe 0..12 mm (stored in pt)
  function normPf(o) {
    var ink = Math.round(Number(o.ink)), mm = Number(o.safeMm), x = {};
    x.ink = ink >= 200 && ink <= 400 ? ink : 300;
    x.safe = Math.round((mm >= 0 && mm <= 12 ? mm : 3) * 72 / 25.4 * 100) / 100;
    if (o.bop === false || o.bop === 0) x.bop = 0;
    return x;
  }

  var api = { MODES: MODES, inksOf: inksOf, showInks: showInks, viewFor: viewFor, opList: opList, opFn: opFn, normPf: normPf };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.LY_PROOF = api;

  // ---------- browser ----------
  var LY = root.LY;
  if (!LY) return;
  var t = LY.t, el = LY.el, R = LY.R;
  var FOLDER = "/internal/Layout/Profiles", BUILT_IN = "../vendor/icc/ISOcoated_v2_eci.icc";
  var mode = "", conv = null, convKey = "", loading = null, pxP = null, pill = null;

  function fsys() {
    try { return (root.parent && root.parent.orosFS) || root.orosFS || null; }
    catch (e) { return root.orosFS || null; }
  }
  function pdfx() {
    if (root.orosDK.pdfx) return Promise.resolve(root.orosDK.pdfx);
    if (pxP) return pxP;
    pxP = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = "../designkit/pdfx.js";
      s.onload = function () { if (root.orosDK.pdfx) res(root.orosDK.pdfx); else rej(new Error("pdfx")); };
      s.onerror = function () { pxP = null; rej(new Error("pdfx")); };
      document.head.appendChild(s);
    });
    return pxP;
  }
  function keyOf(doc) { var x = doc && doc.setup.ext; return x && x.iccF ? String(x.iccF) : ""; }
  // the document's profile bytes → Promise<{ icc, cond } | null> (null:
  // the built-in Coated FOGRA39)
  function profile(doc) {
    var k = keyOf(doc), F = fsys();
    if (!k || !/^[0-9a-f]{16}\.icc$/.test(k) || !F) return Promise.resolve(null);
    return F.read(FOLDER + "/" + k).then(function (b) { return b.arrayBuffer(); }).then(function (ab) {
      var nm = String(doc.setup.ext.iccN || "Custom").slice(0, 60);
      return { icc: new Uint8Array(ab), cond: { id: "Custom", info: nm, registry: "" } };
    }, function () { return null; });
  }
  function bytesFor(doc) {
    return profile(doc).then(function (p) {
      if (p) return p.icc;
      return fetch(BUILT_IN).then(function (r) { if (!r.ok) throw new Error("icc"); return r.arrayBuffer(); }).then(function (ab) { return new Uint8Array(ab); });
    });
  }
  // the converter of the open document's profile (loads it once)
  function load() {
    var doc = LY.doc, k = keyOf(doc);
    if (conv && convKey === k) return Promise.resolve(conv);
    if (loading && loading.k === k) return loading.p;
    var p = Promise.all([pdfx(), bytesFor(doc)]).then(function (r) {
      var c = r[0].cmyk(r[1]);
      if (!c) throw new Error("profile");
      if (keyOf(LY.doc) === k) { conv = c; convKey = k; if (LY.ed && LY.ed.recheck) LY.ed.recheck(); }
      loading = null;
      return c;
    }, function (e) { loading = null; throw e; });
    loading = { k: k, p: p };
    return p;
  }
  // pictures through the view, once per picture and view (at most
  // 1600 px on the long side; the page shows them smaller)
  var imgCache = typeof WeakMap !== "undefined" ? new WeakMap() : null;
  function images(m, limit, img, fn, grid) {
    if (!imgCache || !grid) return null;
    var key = m + ":" + limit + ":" + convKey, per = imgCache.get(img);
    if (per && per[key]) return per[key];
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    var k = Math.min(1, 1600 / Math.max(w, h)), cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    var cv = document.createElement("canvas");
    cv.width = cw; cv.height = ch;
    var cx = cv.getContext("2d");
    try {
      cx.drawImage(img, 0, 0, cw, ch);
      var id = cx.getImageData(0, 0, cw, ch), d = id.data, at = grid(fn, 3, 17), o = [0, 0, 0];
      for (var i = 0; i < d.length; i += 4) {
        at(d[i], d[i + 1], d[i + 2], o);
        d[i] = o[0] * 255; d[i + 1] = o[1] * 255; d[i + 2] = o[2] * 255;
      }
      cx.putImageData(id, 0, 0);
    } catch (e) { return null; }
    per = per || {};
    per[key] = cv;
    imgCache.set(img, per);
    return cv;
  }
  function view() {
    if (!mode || !LY.doc) return null;
    if (!conv || convKey !== keyOf(LY.doc)) { load().then(function () { if (LY.ed) LY.ed.render(); }, function () {}); return null; }
    return viewFor(mode, conv, LY.doc, R, root.orosDK.pdfx && root.orosDK.pdfx.grid, images);
  }
  function profileName(doc) { return keyOf(doc) ? String(doc.setup.ext.iccN || "") || t("pc.own") : "Coated FOGRA39"; }
  function showPill() {
    var host = document.getElementById("stage");
    if (!host) return;
    if (!mode) { if (pill) { pill.remove(); pill = null; } return; }
    if (!pill) {
      pill = el("button", "proof-pill");
      pill.type = "button";
      pill.addEventListener("click", function () { set(""); });
      host.appendChild(pill);
    }
    pill.textContent = t("pc.v." + mode) + " · " + profileName(LY.doc) + " ✕";
    pill.setAttribute("aria-label", t("pc.off"));
  }
  function set(m) {
    mode = MODES.indexOf(m) > 0 ? m : "";
    showPill();
    if (!mode) { if (LY.ed) LY.ed.render(); return Promise.resolve(); }
    return load().then(function () { if (LY.ed) LY.ed.render(); }, function () {
      mode = ""; showPill();
      LY.toast(t("pc.noProfile"));
    });
  }
  // the converter if loaded (Preflight checks RGB colours with it)
  function current() { return conv && convKey === keyOf(LY.doc) ? conv : null; }
  function opFor(doc) { return opFn(opList(doc, R)); }

  // a printer profile of one's own
  function pickProfile(done) {
    LY.io.pickFile(".icc,.icm,application/vnd.iccprofile").then(function (f) {
      if (!f) return;
      if (f.size > 8000000) { LY.toast(t("pc.badProfile")); return; }
      Promise.all([f.arrayBuffer(), pdfx()]).then(function (r) {
        var b = new Uint8Array(r[0]), X = r[1], info = X.profileInfo(b);
        if (!info || info.cls !== "prtr" || info.space !== "CMYK" || !X.cmyk(b)) { LY.toast(t("pc.badProfile")); return; }
        var F = fsys();
        if (!F) { LY.toast(t("pc.noFiles")); return; }
        return root.crypto.subtle.digest("SHA-256", b).then(function (h) {
          var hx = Array.prototype.map.call(new Uint8Array(h).subarray(0, 8), function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
          var name = hx + ".icc", path = FOLDER + "/" + name;
          return F.stat(path).then(function () {}, function () { return F.write(path, new Blob([b], { type: "application/vnd.iccprofile" })); }).then(function () {
            LY.op(function (doc, now) {
              doc.setup.ext.iccF = name;
              doc.setup.ext.iccN = info.name || f.name.replace(/\.(icc|icm)$/i, "").slice(0, 60);
              doc.m = Math.max(now, doc.m + 1);
            });
            conv = null;
            LY.toast(t("pc.profileSet", { name: profileName(LY.doc) }));
            done();
          });
        });
      }).then(null, function () { LY.toast(t("pc.badProfile")); });
    });
  }

  function dialog() {
    var doc = LY.doc, ui = LY.ui, pf = R.pfOf(doc);
    var st = { ink: pf.ink, safeMm: Math.round(pf.safe * 25.4 / 72 * 10) / 10, bop: pf.bop };
    LY.openDialog(t("pc.title"), function (body, close) {
      var vw = el("div");
      function drawV() {
        vw.innerHTML = "";
        vw.appendChild(ui.seg(MODES.map(function (m) { return [m || "off", t("pc.v." + (m || "off"))]; }), mode || "off", function (v) { set(v === "off" ? "" : v); drawV(); }));
      }
      drawV();
      body.appendChild(ui.field(t("pc.view"), vw, "block"));
      body.appendChild(el("p", "hint", t("pc.viewHint")));
      var pr = el("div", "pn-row wrap");
      function drawP() {
        pr.innerHTML = "";
        pr.appendChild(el("span", "pc-prof", profileName(LY.doc)));
        pr.appendChild(ui.btn(t("pc.ownBtn"), function () { pickProfile(drawP); }, "small"));
        if (keyOf(LY.doc)) pr.appendChild(ui.btn(t("pc.builtIn"), function () {
          LY.op(function (d2, now) { delete d2.setup.ext.iccF; delete d2.setup.ext.iccN; d2.m = Math.max(now, d2.m + 1); });
          conv = null; if (mode) set(mode); drawP();
        }, "small"));
      }
      drawP();
      body.appendChild(ui.field(t("pc.profile"), pr, "block"));
      body.appendChild(el("p", "hint", t("pc.profileHint")));
      var ink = el("input", "inp num"); ink.type = "number"; ink.min = 200; ink.max = 400; ink.step = 5; ink.value = st.ink;
      ink.addEventListener("input", function () { st.ink = parseFloat(ink.value); });
      body.appendChild(ui.field(t("pc.ink"), ink));
      var safe = el("input", "inp num"); safe.type = "number"; safe.min = 0; safe.max = 12; safe.step = 0.5; safe.value = st.safeMm;
      safe.addEventListener("input", function () { st.safeMm = parseFloat(safe.value); });
      body.appendChild(ui.field(t("pc.safe"), safe));
      body.appendChild(ui.check(t("pc.bop"), st.bop ? 1 : 0, function (v) { st.bop = !!v; }));
      body.appendChild(el("p", "hint", t("pc.hint")));
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(ui.btn(t("btn.cancel"), close));
      act.appendChild(ui.btn(t("btn.save"), function () {
        var x = normPf(st);
        close();
        LY.op(function (d2, now) {
          var old = JSON.stringify(d2.setup.ext.pf || {});
          if (old === JSON.stringify(x) || (!d2.setup.ext.pf && x.ink === 300 && Math.abs(x.safe - 72 / 25.4 * 3) < 0.01 && x.bop !== 0)) return false;
          d2.setup.ext.pf = x;
          d2.m = Math.max(now, d2.m + 1);
        });
      }, "primary"));
      body.appendChild(act);
    }, true);
  }
  if (LY.on) LY.on("open", function () { conv = null; if (mode) set(""); });

  LY.proof = { view: view, set: set, mode: function () { return mode; }, conv: current, load: load, profile: profile, opFor: opFor, dialog: dialog, name: profileName };
})(typeof window !== "undefined" ? window : this);
