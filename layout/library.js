// ============================================================
// orOS Layout — asset library (LY-N3, v1.0.0)
// Objects kept for reuse in any document on this device: a logo, a
// running head, a chapter opener, a caption with its frame. Each entry
// is what Copy would take (the objects, their stories, the colours and
// styles they use) plus a small picture. Kept in Layout's own storage
// on this device ("oros-layout-lib", at most 200 entries, 1.5 MB in
// all); pictures are only named by their id, never stored here (R30),
// so they appear where the device has them. A library travels as a
// .oroslib file (JSON) through Export / Import.
//   - norm(entry): an entry checked, or null
//   - normLib(list): the saved list checked, newest first, within caps
//   - fromClip(clip, name, thumb, now): a new entry from a clipboard
//   - toClip(entry): what Place pastes
//   - open(): the Library dialog (browser only)
// ============================================================
(function (root) {
  "use strict";

  var KEY = "oros-layout-lib", MAX = 200, MAX_ITEMS = 300, MAX_BYTES = 1500000, MAX_ONE = 400000;
  var ID_RE = /^lib-[a-z0-9]{1,24}$/;

  function str(v, n) { return String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n); }
  function arr(v, n) { return Array.isArray(v) ? v.slice(0, n) : []; }
  function plain(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; } }

  function norm(e) {
    if (!e || typeof e !== "object" || !ID_RE.test(String(e.id))) return null;
    var c = e.clip || {};
    var items = arr(c.items, MAX_ITEMS).filter(function (it) { return it && typeof it === "object" && typeof it.t === "string"; });
    if (!items.length) return null;
    var out = {
      id: e.id,
      name: str(e.name, 60) || "—",
      m: Number(e.m) || 0,
      thumb: typeof e.thumb === "string" && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+\/=]+$/.test(e.thumb) && e.thumb.length < 60000 ? e.thumb : "",
      clip: plain({
        items: items,
        stories: arr(c.stories, MAX_ITEMS).filter(function (s) { return s && typeof s === "object" && Array.isArray(s.paras); }),
        swatches: arr(c.swatches, 2000), pstyles: arr(c.pstyles, 500), cstyles: arr(c.cstyles, 500)
      })
    };
    if (!out.clip || JSON.stringify(out).length > MAX_ONE) return null;
    return out;
  }
  function normLib(list) {
    var out = [], seen = {}, bytes = 0;
    arr(list, 1000).map(norm).filter(Boolean)
      .sort(function (a, b) { return b.m - a.m; })
      .forEach(function (e) {
        if (seen[e.id] || out.length >= MAX) return;
        var n = JSON.stringify(e).length;
        if (bytes + n > MAX_BYTES) return;
        seen[e.id] = 1; bytes += n; out.push(e);
      });
    return out;
  }
  function newId() { return "lib-" + Math.random().toString(36).slice(2, 12); }
  // only the colours and styles the objects use travel with them
  function usedOnly(clip) {
    var s = JSON.stringify({ i: clip.items, s: clip.stories });
    function keep(list) { return (list || []).filter(function (x) { return x && x.id && s.indexOf('"' + x.id + '"') >= 0; }); }
    var ps = keep(clip.pstyles), cs = keep(clip.cstyles);
    var s2 = s + JSON.stringify(ps) + JSON.stringify(cs);
    return { items: clip.items, stories: clip.stories, swatches: (clip.swatches || []).filter(function (x) { return x && x.id && s2.indexOf('"' + x.id + '"') >= 0; }), pstyles: ps, cstyles: cs };
  }
  function fromClip(clip, name, thumb, now) {
    if (!clip || !clip.items || !clip.items.length) return null;
    return norm({ id: newId(), name: name, m: now || Date.now(), thumb: thumb || "", clip: usedOnly(clip) });
  }
  function toClip(e) {
    var c = plain(e.clip);
    c.from = "lib";
    return c;
  }

  var api = { KEY: KEY, MAX: MAX, MAX_BYTES: MAX_BYTES, norm: norm, normLib: normLib, fromClip: fromClip, toClip: toClip, usedOnly: usedOnly };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.LY_LIB = api;

  // ---------- the dialog (browser) ----------
  var LY = root.LY;
  if (!LY) return;
  var t = LY.t, el = LY.el;

  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
    return normLib(raw && raw.list);
  }
  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, list: normLib(list) })); return true; }
    catch (e) { LY.toast(t("lib.full")); return false; }
  }

  // a small picture of the selection, drawn like the page draws it
  function thumbOf(items) {
    try {
      var ED = LY.ed, R = LY.R, doc = LY.doc;
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      items.forEach(function (it) {
        x0 = Math.min(x0, it.x); y0 = Math.min(y0, it.y);
        x1 = Math.max(x1, it.x + (it.w || 0)); y1 = Math.max(y1, it.y + (it.h || 0));
      });
      var w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0), W = 120, H = 90;
      var k = Math.min(W / w, H / h);
      var cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      var ctx = cv.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
      ctx.translate((W - w * k) / 2, (H - h * k) / 2);
      ctx.scale(k, k);
      ctx.translate(-x0, -y0);
      items.forEach(function (it) {
        R.drawItem(ctx, doc, it, { lines: function (id) { var f = ED.L && ED.L.frames[id]; return f && f.lines; }, getImage: LY.A.get, preview: true });
      });
      return cv.toDataURL("image/png");
    } catch (e) { return ""; }
  }

  function addSel(list, done) {
    var ED = LY.ed;
    if (LY.inframe && LY.inframe.isOn()) LY.inframe.stop();
    var clip = ED.selClip && ED.selClip();
    if (!clip) { LY.toast(t("lib.pick")); return; }
    var e = fromClip(clip, t("lib.nameN", { n: list.length + 1 }), thumbOf(ED.selItems()), Date.now());
    if (!e) { LY.toast(t("lib.big")); return; }
    list.unshift(e);
    if (normLib(list).length < list.length) { list.shift(); LY.toast(t("lib.full")); return; }
    if (save(list)) { LY.toast(t("lib.added")); done(); }
  }

  function exportLib(list) {
    if (!list.length) return;
    var blob = new Blob([JSON.stringify({ oroslib: 1, list: list })], { type: "application/json" });
    LY.io.saveBlob(blob, t("lib.fileName") + ".oroslib", "application/json", "orOS library", ".oroslib");
  }
  function importLib(list, done) {
    LY.io.pickFile(".oroslib,application/json").then(function (f) {
      if (!f) return;
      if (f.size > 4000000) { LY.toast(t("lib.bad")); return; }
      f.text().then(function (txt) {
        var data = null;
        try { data = JSON.parse(txt); } catch (e) {}
        var inc = data && data.oroslib === 1 ? normLib(data.list) : [];
        if (!inc.length) { LY.toast(t("lib.bad")); return; }
        var have = {};
        list.forEach(function (e) { have[e.id] = 1; });
        var n = 0;
        inc.forEach(function (e) { if (!have[e.id]) { list.push(e); n++; } });
        var kept = normLib(list);
        save(kept);
        LY.toast(t("lib.imported", { n: Math.max(0, n - (list.length - kept.length)) }));
        done();
      });
    });
  }

  function open() {
    if (!LY.doc) return;
    var list = load();
    LY.openDialog(t("lib.title"), function (body, close) {
      function again() { close(); open(); }
      var top = el("div", "pn-row wrap");
      var hasSel = LY.ed && LY.ed.selItems().length;
      var add = LY.ui.btn(t("lib.add"), function () { addSel(list, again); }, "small primary");
      add.disabled = !hasSel;
      top.appendChild(add);
      top.appendChild(LY.ui.btn(t("lib.import"), function () { importLib(list, again); }, "small"));
      var ex = LY.ui.btn(t("lib.export"), function () { exportLib(list); }, "small");
      ex.disabled = !list.length;
      top.appendChild(ex);
      body.appendChild(top);
      if (!list.length) body.appendChild(el("p", "hint", t("lib.empty")));
      var grid = el("div", "lib-grid");
      list.forEach(function (e) {
        var card = el("div", "lib-card");
        var pic = el("button", "lib-pic");
        pic.type = "button";
        pic.title = t("lib.place");
        pic.setAttribute("aria-label", t("lib.place") + ": " + e.name);
        if (e.thumb) { var img = el("img"); img.src = e.thumb; img.alt = ""; pic.appendChild(img); }
        else pic.appendChild(el("span", "lib-n", String(e.clip.items.length)));
        pic.addEventListener("click", function () {
          close();
          LY.ed.pasteClip(toClip(e));
          LY.toast(t("lib.placed", { name: e.name }));
        });
        card.appendChild(pic);
        var nm = el("input", "inp lib-name");
        nm.type = "text"; nm.maxLength = 60; nm.value = e.name;
        nm.setAttribute("aria-label", t("lib.name"));
        nm.addEventListener("change", function () {
          var v = str(nm.value, 60);
          if (!v) { nm.value = e.name; return; }
          e.name = v; save(list);
        });
        card.appendChild(nm);
        var del = LY.ui.btn("✕", function () {
          list = list.filter(function (x) { return x.id !== e.id; });
          save(list); again();
        }, "small ghost");
        del.title = t("lib.del");
        del.setAttribute("aria-label", t("lib.del") + ": " + e.name);
        card.appendChild(del);
        grid.appendChild(card);
      });
      body.appendChild(grid);
      body.appendChild(el("p", "hint", t("lib.hint")));
      var act = el("div", "dlg-actions");
      var c = el("button", "btn", t("btn.close")); c.type = "button";
      c.addEventListener("click", close);
      act.appendChild(c);
      body.appendChild(act);
    }, true);
  }

  LY.on("boot", function () {
    LY.dlg = LY.dlg || {};
    LY.dlg.lib = open;
  });
  LY.lib = { open: open, load: load };
})(typeof window !== "undefined" ? window : this);
