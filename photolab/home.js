// ============================================================
// orOS Photo Lab — projects screen (v1.0.0)
// The list of projects (the synced index), newest first, with
// their thumbnails from the orOS disk; New, Open picture, Paste;
// rename and delete (with Undo) per project.
// ============================================================
(function () {
  "use strict";

  var PL = window.PL, st = PL.st, $ = PL.$, el = PL.el;
  function t(k, p) { return PL.t(k, p); }
  var urls = [];

  function when(ms) {
    try {
      return new Date(ms).toLocaleDateString(PL.LANG === "el" ? "el-GR" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch (e) { return ""; }
  }
  function freeUrls() { urls.forEach(function (u) { URL.revokeObjectURL(u); }); urls = []; }

  function card(e) {
    var li = el("li", "card");
    var open = el("button", "card-open"); open.type = "button";
    var th = el("span", "card-thumb");
    var img = el("img"); img.alt = ""; img.decoding = "async"; img.hidden = true;
    th.appendChild(img);
    open.appendChild(th);
    var meta = el("span", "card-meta");
    meta.appendChild(el("span", "card-name", e.name));
    meta.appendChild(el("span", "card-sub", e.w + " × " + e.h + " · " + when(e.m)));
    open.appendChild(meta);
    open.addEventListener("click", function () { PL.openProject(e.id); });
    li.appendChild(open);
    var acts = el("div", "card-acts");
    var ren = el("button", "icon-btn small"); ren.type = "button";
    ren.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
    PL.setLabel(ren, t("btn.renameProject", { name: e.name }));
    ren.addEventListener("click", function () {
      var n = PL.ui.textIn(e.name);
      PL.dialog({ title: t("dlg.rename"), ok: t("btn.save"), body: [PL.ui.field(t("f.name"), n)], onOk: function () { PL.renameProject(e.id, n.value); } });
    });
    var del = el("button", "icon-btn small"); del.type = "button";
    del.innerHTML = PL.ICON.del; PL.setLabel(del, t("btn.deleteProject", { name: e.name }));
    del.addEventListener("click", function () { PL.deleteProject(e.id); });
    acts.appendChild(ren); acts.appendChild(del);
    li.appendChild(acts);
    var fs = PL.fs();
    if (fs) PL.ST.readThumb(fs, e.id).then(function (b) {
      var u = URL.createObjectURL(b); urls.push(u);
      img.onload = function () { img.hidden = false; };
      img.src = u;
    }, function () { th.classList.add("none"); });
    return li;
  }

  function render() {
    if (st.doc) return;
    freeUrls();
    var list = $("projects"), ix = PL.index();
    list.innerHTML = "";
    var items = ix.projects.slice().sort(function (a, b) { return b.m - a.m; });
    $("projects-empty").hidden = items.length > 0;
    $("projects-count").textContent = items.length ? PL.num(items.length) : "";
    items.forEach(function (e) { list.appendChild(card(e)); });
    $("disk-note").hidden = !!PL.fs();
  }

  function build() {
    $("home-title").textContent = t("app.name");
    $("home-sub").textContent = t("home.sub");
    $("projects-h").textContent = t("home.projects");
    $("projects-empty").textContent = t("home.empty");
    $("disk-note").textContent = t("msg.noDisk");
    var acts = [["home-new", "btn.new", function () { PL.panels.newDialog(); }],
                ["home-open", "btn.openPicture", function () { PL.io.openPicture(false); }],
                ["home-paste", "btn.paste", function () { PL.io.pasteFromMenu(); }]];
    acts.forEach(function (a) {
      var b = $(a[0]); b.textContent = t(a[1]); b.addEventListener("click", a[2]);
    });
    $("drop-hint").textContent = t("home.drop");
    PL.on("index", function () { if (!st.doc) render(); });
  }

  // Another device saved the open project: offer to load its version.
  var offered = false;
  function offerReload() {
    if (offered || !st.doc) return;
    offered = true;
    var id = st.doc.id;
    PL.actionToast(t("msg.remoteChanged"), t("btn.reload"), function () { offered = false; PL.openProject(id); });
    setTimeout(function () { offered = false; }, 8000);
  }

  PL.home = { build: build, render: render, offerReload: offerReload };
})();
