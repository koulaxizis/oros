// ============================================================
// orOS Atelier — Brand kit (v1.0.0): your colours, fonts and logos
// in one place, on every device (synced slice "atelier-brand",
// record and merge in brandkit.js).
//   - colours: tap to colour the selection; they also head the
//     colour panel
//   - fonts: heading / subheading / body; "Text" adds text in them
//   - logos: pictures kept in the asset store (like uploads), tap to
//     place
// ============================================================
(function () {
  "use strict";

  var AT = window.AT, A = AT.A, AX = AT.AX, T = AT.T, t = AT.t, el = AT.el, ED = AT.ed;
  var BK = window.AtelierBrand;
  var KEY = "oros-atelier-brand";

  var B = BK.empty();
  try { B = BK.norm(JSON.parse(localStorage.getItem(KEY) || "null")); } catch (e) { B = BK.empty(); }

  function api() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  var suppress = false;
  function store() {
    try { localStorage.setItem(KEY, JSON.stringify(B)); } catch (e) { AT.toast(t("toast.save")); }
    var s = api();
    if (!suppress && s && typeof s.markDirty === "function") s.markDirty();
  }
  function change(next) {
    if (JSON.stringify(next) === JSON.stringify(B)) return;
    B = next; store();
    AT.renderDrawer();
  }
  (function register() {
    var s = api();
    if (!s || typeof s.registerSlice !== "function") return;
    s.registerSlice("atelier-brand", function () { return BK.norm(B); }, function (incoming) {
      if (!incoming || typeof incoming !== "object") return;
      var next = BK.norm(incoming);
      if (JSON.stringify(next) === JSON.stringify(B)) return;
      suppress = true;
      try { B = next; store(); } finally { suppress = false; }     // R6: a pull never marks dirty
      AT.renderDrawer();
    }, KEY, BK.merge);
  })();

  // ---------- helpers for other panels ----------
  function colors() { return B.colors.map(function (x) { return x.c; }); }
  function font(slot) { return B.fonts[slot] || null; }

  function btn(cls, label, fn) {
    var b = el("button", cls, label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function sec(title) {
    var s = el("div", "pn-sec");
    if (title) s.appendChild(el("div", "pn-h", title));
    return s;
  }
  var thumbs = {};
  function thumb(id, img) {
    if (thumbs[id]) { img.src = thumbs[id]; return; }
    A.load(id).then(function (im) {
      if (!im) return;
      var w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, s = 160 / Math.max(w, h);
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      thumbs[id] = c.toDataURL("image/png");
      img.src = thumbs[id];
    });
  }

  var editing = false;

  function view(body) {
    var top = el("div", "brand-top");
    top.appendChild(el("p", "hint", t("br.intro")));
    var ed = btn("btn small" + (editing ? " primary" : ""), editing ? t("br.done") : t("br.edit"), function () { editing = !editing; AT.renderDrawer(); });
    ed.setAttribute("aria-pressed", editing ? "true" : "false");
    top.appendChild(ed);
    body.appendChild(top);

    // colours
    var s1 = sec(t("br.colors"));
    var g = el("div", "swp");
    B.colors.forEach(function (x) {
      var wrap = el("span", "br-sw");
      var b = el("button", "sw");
      b.type = "button"; b.style.background = x.c; b.title = x.c; b.setAttribute("aria-label", x.c);
      b.addEventListener("click", function () {
        if (editing) return;
        if (!ED.selItems().length) { AT.toast(t("br.pickEl")); return; }
        AT.setColour("fill", x.c);
      });
      wrap.appendChild(b);
      if (editing) wrap.appendChild(btn("br-x", "×", function () { change(BK.remove(B, x.id, AT.now())); })).setAttribute("aria-label", t("br.remove"));
      g.appendChild(wrap);
    });
    s1.appendChild(g);
    if (!B.colors.length) s1.appendChild(el("p", "hint", t("br.noColors")));
    var row = el("div", "pn-row");
    var inp = el("input"); inp.type = "color"; inp.value = "#5e17eb"; inp.setAttribute("aria-label", t("br.addColor"));
    row.appendChild(inp);
    row.appendChild(btn("btn small", t("br.addColor"), function () { change(BK.addColor(B, inp.value, AT.now())); }));
    if (AT.doc) row.appendChild(btn("btn small", t("br.fromDesign"), function () {
      var nb = B, n = 0;
      AT.docColours().forEach(function (c) { if (n < 8) { var before = nb.colors.length; nb = BK.addColor(nb, c, AT.now()); if (nb.colors.length > before) n++; } });
      change(nb);
      AT.toast(n ? t("br.added", { n: n }) : t("br.nothingNew"));
    }));
    s1.appendChild(row);
    body.appendChild(s1);

    // fonts
    var s2 = sec(t("br.fonts"));
    var one = ED.selItems().length === 1 && ED.selItems()[0].ax.k === "text" ? ED.selItems()[0] : null;
    BK.SLOTS.forEach(function (slot) {
      var f = font(slot);
      var r = el("div", "br-font");
      r.appendChild(el("span", "br-slot", t("br.slot." + slot)));
      var name = f ? AX.fontName(f.f) : t("br.notSet");
      var add = btn("br-font-btn", name, function () { AT.addBrandText(slot); });
      if (f) {
        var k = T.fontKey(f.f, f.b, 0);
        if (T.isLoaded(k)) add.style.fontFamily = T.cssStack(k) + ", sans-serif";
        if (f.b) add.style.fontWeight = "700";
      }
      add.title = t("br.addText");
      r.appendChild(add);
      var use = btn("btn small", t("br.useSel"), function () {
        change(BK.setFont(B, slot, one.ax.font || "sans", one.ax.b, AT.now()));
      });
      use.disabled = !one;
      r.appendChild(use);
      s2.appendChild(r);
    });
    s2.appendChild(el("p", "hint", t("br.fontsHint")));
    body.appendChild(s2);

    // logos
    var s3 = sec(t("br.logos"));
    var grid = el("div", "up-grid");
    B.logos.forEach(function (x) {
      var wrap = el("span", "br-logo");
      var b = el("button", "up-tile");
      b.type = "button"; b.setAttribute("aria-label", x.nm || t("br.logo"));
      var img = el("img"); img.alt = "";
      thumb(x.a, img);
      b.appendChild(img);
      b.addEventListener("click", function () {
        if (editing) return;
        A.load(x.a).then(function (im) {
          if (!im) { AT.toast(t("img.missing")); return; }
          AT.io.placePhoto({ id: x.a, w: x.w, h: x.h, name: x.nm });
        });
      });
      wrap.appendChild(b);
      if (editing) wrap.appendChild(btn("br-x", "×", function () { change(BK.remove(B, x.id, AT.now())); })).setAttribute("aria-label", t("br.remove"));
      grid.appendChild(wrap);
    });
    s3.appendChild(grid);
    if (B.logos.length < BK.MAX_LOGOS) s3.appendChild(btn("btn small block", t("br.addLogo"), function () {
      AT.io.pickFile("image/*").then(function (f) {
        if (!f) return;
        return A.importFile(f).then(function (res) {
          AT.noteUpload(res.id);
          change(BK.addLogo(B, res, AT.now()));
        }, function (e) { AT.toast(e && e.message === "nofs" ? t("img.nofs") : t("img.fail")); });
      });
    }));
    body.appendChild(s3);
  }
  AT.registerView("brand", view);

  // fonts in the brand kit and in the panel load when used
  function loadFonts() {
    var keys = [];
    BK.SLOTS.forEach(function (s) { var f = font(s); if (f) { AX.ensureFont(f.f); keys.push(T.fontKey(f.f, f.b, 0)); } });
    if (keys.length) T.load(keys).then(function () { AT.renderDrawer(); }, function () {});
  }
  AT.on("open", loadFonts);

  AT.brand = { colors: colors, font: font, get: function () { return BK.norm(B); } };
})();
