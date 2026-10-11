// ============================================================
// orOS Atelier — homefolders.js: folders on the home screen (v1.0.0)
// The folder row above "Your designs" (All, each folder, New folder),
// moving designs into a folder (one or many), rename / delete.
// The record (atelier/folders.js) syncs as its own slice
// "atelier-folders"; which folder is open is this device's choice.
// ============================================================
(function () {
  "use strict";

  var AT = window.AT, t = AT.t, el = AT.el;
  var FO = window.AtelierFolders;
  var KEY = "oros-atelier-folders", OPEN_KEY = "oros-atelier-folder-open";

  var R = FO.empty();
  try { R = FO.norm(JSON.parse(localStorage.getItem(KEY) || "null")); } catch (e) { R = FO.empty(); }
  var open = "";              // "" = all designs
  try { open = localStorage.getItem(OPEN_KEY) || ""; } catch (e) {}

  function api() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  var suppress = false;
  function store() {
    try { localStorage.setItem(KEY, JSON.stringify(R)); } catch (e) { AT.toast(t("toast.save")); }
    var s = api();
    if (!suppress && s && typeof s.markDirty === "function") s.markDirty();
  }
  function change(next) {
    if (JSON.stringify(next) === JSON.stringify(R)) return;
    R = next; store();
    AT.renderHome();
  }
  (function register() {
    var s = api();
    if (!s || typeof s.registerSlice !== "function") return;
    s.registerSlice("atelier-folders", function () { return FO.norm(R); }, function (incoming) {
      if (!incoming || typeof incoming !== "object") return;
      var next = FO.norm(incoming);
      if (JSON.stringify(next) === JSON.stringify(R)) return;
      suppress = true;
      try { R = next; store(); } finally { suppress = false; }     // R6: a pull never marks dirty
      AT.renderHome();
    }, KEY, FO.merge);
  })();

  function setOpen(id) {
    open = id || "";
    try { localStorage.setItem(OPEN_KEY, open); } catch (e) {}
    AT.renderHome();
  }
  function current() {
    if (open && !R.folders.some(function (f) { return f.id === open; })) open = "";
    return open;
  }
  function nameOf(id) { var f = R.folders.filter(function (x) { return x.id === id; })[0]; return f ? f.nm : ""; }
  function inCurrent(d) { var c = current(); return !c || FO.folderOf(R, d.id) === c; }

  function newFolder(then) {
    AT.prompt(t("fo.new"), "", function (v) {
      var res = FO.add(R, v, AT.now());
      if (!res.id) return;
      change(res.r);
      if (then) then(res.id);
    });
  }
  function move(ids, folderId) {
    change(FO.move(R, ids, folderId, AT.now()));
    AT.toast(folderId ? t("fo.moved", { n: ids.length, f: nameOf(folderId) }) : t("fo.movedOut", { n: ids.length }));
  }
  // menu: every folder, "No folder", "New folder…"
  function moveMenu(anchor, ids, done) {
    if (!ids.length) return;
    var here = ids.length === 1 ? FO.folderOf(R, ids[0]) : null;
    var items = R.folders.map(function (f) {
      return { label: f.nm, on: here === f.id, fn: function () { move(ids, f.id); if (done) done(); } };
    });
    if (R.folders.length) items.push({ label: t("fo.none"), on: here === "", fn: function () { move(ids, ""); if (done) done(); } });
    items.push({ sep: true });
    items.push({ label: t("fo.newMove"), fn: function () { newFolder(function (id) { move(ids, id); if (done) done(); }); } });
    AT.menu(anchor, items);
  }
  function folderMenu(f, anchor) {
    AT.menu(anchor, [
      { label: t("fo.rename"), fn: function () {
        AT.prompt(t("fo.rename"), f.nm, function (v) { change(FO.rename(R, f.id, v, AT.now())); });
      } },
      { label: t("fo.delete"), danger: true, fn: function () {
        AT.confirm(t("fo.delAsk", { f: f.nm }), t("home.delOk"), function () {
          var before = R;
          change(FO.remove(R, f.id, AT.now()));
          if (open === f.id) setOpen("");
          AT.toast(t("fo.deleted", { f: f.nm }), t("btn.undo"), function () {
            // bring the folder and its designs back, newer than the delete
            var nw = AT.now(), back = JSON.parse(JSON.stringify(before));
            back.folders.forEach(function (x) { if (x.id === f.id) x.m = nw; });
            Object.keys(back.place).forEach(function (d) { if (back.place[d].f === f.id) back.place[d].m = nw; });
            delete back.dt[f.id];
            var cur = FO.norm(R);
            delete cur.dt[f.id];
            change(FO.merge(cur, back));
          });
        });
      } }
    ]);
  }

  // the row of folder buttons above the designs
  function renderBar(host, docs) {
    host.innerHTML = "";
    var cur = current();
    if (!docs.length && !R.folders.length) { host.hidden = true; return; }
    host.hidden = false;
    var counts = {};
    docs.forEach(function (d) { var f = FO.folderOf(R, d.id); counts[f] = (counts[f] || 0) + 1; });
    function chip(label, on, fn) {
      var b = el("button", "chip-btn fo-chip" + (on ? " on" : ""), label);
      b.type = "button";
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.addEventListener("click", fn);
      host.appendChild(b);
      return b;
    }
    chip(t("fo.all") + " · " + docs.length, !cur, function () { setOpen(""); });
    R.folders.forEach(function (f) {
      var b = chip("", cur === f.id, function () { setOpen(f.id); });
      b.appendChild(el("span", "fo-ic", "▸"));
      b.appendChild(document.createTextNode(f.nm + " · " + (counts[f.id] || 0)));
      b.addEventListener("contextmenu", function (e) { e.preventDefault(); folderMenu(f, b); });
      if (cur === f.id) {
        var more = AT.iconBtn("more", t("fo.options"), "fo-more");
        more.addEventListener("click", function () { folderMenu(f, more); });
        host.appendChild(more);
      }
    });
    chip("+ " + t("fo.newShort"), false, function () { newFolder(function (id) { setOpen(id); }); });
  }

  // a design made while a folder is open goes into that folder
  function created(docId) {
    var c = current();
    if (c) { R = FO.move(R, [docId], c, AT.now()); store(); }
  }

  AT.folders = { renderBar: renderBar, inCurrent: inCurrent, moveMenu: moveMenu, created: created,
    current: current, nameOf: nameOf, folderOf: function (id) { return FO.folderOf(R, id); } };
})();
