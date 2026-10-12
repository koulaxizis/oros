// ============================================================
// orOS Library — the library screen (v1.0.0)
// Continue-reading strip, the shelf of books (grid or list), filters,
// search and sort; adding books (orOS disk, this device, drag and
// drop, "Open with"); the book's details (edit, finished, export
// notes, remove, delete the file, find a missing file).
// ============================================================
(function () {
  "use strict";

  var LIB = window.LIB, C = LIB.C, t = LIB.t, el = LIB.el, $ = LIB.$, UI = LIB.UI;
  var FILTERS = ["all", "reading", "unread", "done", "epub", "pdf"];
  var SORTS = ["recent", "title", "author", "progress"];
  var COVER_COLORS = ["#8e5a3c", "#3c6e8e", "#5a8e3c", "#8e3c6e", "#6e3c8e", "#3c8e7a", "#8e7a3c", "#5b5f8f"];
  var here = {};          // book id → true when its file is on this device (filled lazily)
  var scanning = false;

  function build() {
    $("app-name").textContent = t("app.name");
    document.title = t("app.name") + " · orOS";
    var add = $("add-btn");
    add.innerHTML = UI.plus;
    add.appendChild(el("span", "", t("btn.add")));
    add.setAttribute("aria-label", t("btn.addBook"));
    add.addEventListener("click", function () { addMenu(add); });
    var more = $("more-btn");
    more.innerHTML = UI.more;
    more.setAttribute("aria-label", t("btn.more"));
    more.title = t("btn.more");
    more.addEventListener("click", function () { moreMenu(more); });

    var chips = $("filters");
    FILTERS.forEach(function (f) {
      var b = LIB.textBtn("chip", t("filter." + f), function () {
        LIB.prefs.filter = f;
        LIB.savePrefs();
        refresh();
      });
      b.setAttribute("data-f", f);
      chips.appendChild(b);
    });
    $("q-ic").innerHTML = UI.search;
    $("q").placeholder = t("search.ph");
    $("q").setAttribute("aria-label", t("search.ph"));
    $("q").addEventListener("input", refresh);
    $("q").addEventListener("keydown", function (e) {
      if (e.key === "Escape" && $("q").value) { e.preventDefault(); $("q").value = ""; refresh(); }
    });
    var so = $("sort");
    so.setAttribute("aria-label", t("sort.aria"));
    SORTS.forEach(function (s) { var o = el("option", "", t("sort." + s)); o.value = s; so.appendChild(o); });
    so.addEventListener("change", function () { LIB.prefs.sort = so.value; LIB.savePrefs(); refresh(); });
    $("view-btn").addEventListener("click", function () {
      LIB.prefs.view = LIB.prefs.view === "grid" ? "list" : "grid";
      LIB.savePrefs();
      refresh();
    });
    $("cont-h").textContent = t("home.continue");

    // drag and drop anywhere on the library
    var home = $("home");
    home.addEventListener("dragover", function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      home.classList.add("drop");
    });
    home.addEventListener("dragleave", function (e) { if (e.target === home || !home.contains(e.relatedTarget)) home.classList.remove("drop"); });
    home.addEventListener("drop", function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      home.classList.remove("drop");
      importFiles([].slice.call(e.dataTransfer.files || []), false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (!LIB.$("home") || LIB.$("home").hidden) return;
      var tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.querySelector("dialog[open]")) return;
      if (e.key === "/") { e.preventDefault(); $("q").focus(); }
    });
  }
  function hasFiles(e) {
    var ty = e.dataTransfer && e.dataTransfer.types;
    return !!ty && [].indexOf.call(ty, "Files") >= 0;
  }

  // ---------- Rendering ----------
  function refresh() {
    var P = LIB.prefs;
    [].forEach.call($("filters").children, function (b) {
      var on = b.getAttribute("data-f") === P.filter;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $("sort").value = P.sort;
    $("view-btn").innerHTML = P.view === "grid" ? UI.list : UI.grid;
    var vl = t(P.view === "grid" ? "btn.viewList" : "btn.viewGrid");
    $("view-btn").setAttribute("aria-label", vl);
    $("view-btn").title = vl;

    var q = $("q").value;
    var all = LIB.data.books;
    var cont = (!q && P.filter === "all") ? C.continueList(LIB.data, 3) : [];
    $("cont").hidden = !cont.length;
    var cl = $("cont-list");
    cl.textContent = "";
    cont.forEach(function (b) { cl.appendChild(contCard(b)); });

    var list = C.viewBooks(LIB.data, { q: q, filter: P.filter, sort: P.sort });
    var g = $("grid");
    g.className = P.view === "grid" ? "grid" : "rows";
    g.textContent = "";
    list.forEach(function (b) { g.appendChild(card(b)); });
    var empty = $("empty");
    empty.textContent = "";
    if (!all.length) {
      empty.hidden = false;
      empty.appendChild(el("div", "empty-ic")).innerHTML = UI.book;
      empty.appendChild(el("p", "empty-title", t("empty.first")));
      empty.appendChild(el("p", "hint", t("empty.firstHint")));
      var acts = el("div", "empty-acts");
      acts.appendChild(LIB.textBtn("btn primary", t("add.device"), pickDevice));
      acts.appendChild(LIB.textBtn("btn", t("add.disk"), pickDisk));
      empty.appendChild(acts);
    } else if (!list.length) {
      empty.hidden = false;
      empty.appendChild(el("p", "hint", t("empty.none")));
    } else empty.hidden = true;
    if (!LIB.store.fs()) {
      $("scan-note").hidden = false;
      $("scan-note").textContent = t("msg.nofs");
    }
  }

  function coverEl(b, cls) {
    var box = el("div", "cover " + (cls || ""));
    var c = COVER_COLORS[parseInt(b.id.slice(1, 3), 16) % COVER_COLORS.length];
    box.style.setProperty("--cv", c);
    box.appendChild(el("span", "cv-title", b.title));
    if (b.by) box.appendChild(el("span", "cv-by", b.by));
    box.appendChild(el("span", "cv-fmt", b.fmt.toUpperCase()));
    box.setAttribute("data-cover", b.id);
    LIB.store.getCover(b.id).then(function (d) {
      if (d) setCover(box, d);
      else LIB.store.ensureCover(b);
    });
    return box;
  }
  function setCover(box, d) {
    if (box.querySelector("img")) return;
    var img = el("img");
    img.alt = "";
    img.src = d;
    box.classList.add("has-img");
    box.appendChild(img);
  }
  function coverReady(id) {
    LIB.store.getCover(id).then(function (d) {
      if (!d) return;
      [].forEach.call(document.querySelectorAll("[data-cover=\"" + id + "\"]"), function (box) { setCover(box, d); });
    });
  }

  function pctText(b) {
    if (b.fin) return t("book.finished");
    var p = C.progressOf(LIB.data, b.id);
    return p > 0 ? t("book.pct", { p: Math.max(1, Math.floor(p / 10)) }) : t("book.new");
  }
  function bar(b) {
    var w = el("div", "bar");
    var i = el("i");
    i.style.width = (b.fin ? 100 : C.progressOf(LIB.data, b.id) / 10) + "%";
    w.appendChild(i);
    return w;
  }
  function card(b) {
    var li = el("li", "card");
    var open = el("button", "card-open");
    open.type = "button";
    open.setAttribute("aria-label", t("book.open", { title: b.title }));
    open.appendChild(coverEl(b));
    var meta = el("div", "card-meta");
    meta.appendChild(el("span", "card-title", b.title));
    if (b.by) meta.appendChild(el("span", "card-by", b.by));
    var row = el("div", "card-row");
    row.appendChild(el("span", "card-pct", pctText(b)));
    if (LIB.prefs.view === "list") {
      var bits = [b.fmt.toUpperCase()];
      if (b.pages) bits.push(t("book.pages", { n: LIB.num(b.pages) }));
      var mk = LIB.data.marks.filter(function (k) { return k.b === b.id && k.k === "hl"; }).length;
      if (mk) bits.push(t("book.hls", { n: mk }));
      row.appendChild(el("span", "card-info", bits.join(" · ")));
    }
    meta.appendChild(row);
    meta.appendChild(bar(b));
    open.appendChild(meta);
    open.addEventListener("click", function () { LIB.openBook(b.id); });
    li.appendChild(open);
    li.appendChild(LIB.btn("icon-btn card-more", t("book.details", { title: b.title }), UI.info, function () { details(b.id); }));
    markMissing(li, b);
    return li;
  }
  function contCard(b) {
    var li = el("li");
    var bt = el("button", "cont-card");
    bt.type = "button";
    bt.setAttribute("aria-label", t("book.continue", { title: b.title }));
    bt.appendChild(coverEl(b, "small"));
    var m = el("div", "cont-meta");
    m.appendChild(el("span", "card-title", b.title));
    m.appendChild(el("span", "card-pct", pctText(b)));
    m.appendChild(bar(b));
    bt.appendChild(m);
    bt.addEventListener("click", function () { LIB.openBook(b.id); });
    li.appendChild(bt);
    markMissing(li, b);
    return li;
  }
  function markMissing(li, b) {
    if (here[b.id] === true) return;
    if (here[b.id] === false) { li.classList.add("missing"); li.title = t("book.notHere"); return; }
    LIB.store.pathOf(b).then(function (p) {
      here[b.id] = !!p;
      if (!p) { li.classList.add("missing"); li.title = t("book.notHere"); }
    });
  }

  // ---------- Menus ----------
  function menu(anchor, items) {
    var old = $("lb-menu");
    if (old) { old.remove(); if (old._anchor === anchor) return; }
    var m = el("div", "lb-menu");
    m.id = "lb-menu";
    m._anchor = anchor;
    m.setAttribute("role", "menu");
    items.forEach(function (it) {
      var b = LIB.textBtn("menu-item", it.label, function () { m.remove(); it.fn(); });
      b.setAttribute("role", "menuitem");
      if (it.icon) b.insertAdjacentHTML("afterbegin", it.icon);
      m.appendChild(b);
    });
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    var w = m.offsetWidth, x = Math.min(window.innerWidth - w - 8, Math.max(8, r.right - w));
    m.style.left = x + "px";
    m.style.top = Math.min(window.innerHeight - m.offsetHeight - 8, r.bottom + 4) + "px";
    var first = m.querySelector("button");
    if (first) first.focus();
    setTimeout(function () {
      function off(e) {
        if (m.contains(e.target)) return;
        m.remove();
        document.removeEventListener("pointerdown", off, true);
        document.removeEventListener("keydown", esc, true);
      }
      function esc(e) { if (e.key === "Escape") { m.remove(); anchor.focus(); document.removeEventListener("keydown", esc, true); } }
      document.addEventListener("pointerdown", off, true);
      document.addEventListener("keydown", esc, true);
    }, 0);
    return m;
  }
  LIB.menu = menu;
  function addMenu(anchor) {
    menu(anchor, [
      { label: t("add.device"), icon: UI.device, fn: pickDevice },
      { label: t("add.disk"), icon: UI.disk, fn: pickDisk }
    ]);
  }
  function moreMenu(anchor) {
    menu(anchor, [
      { label: t("more.stats"), icon: UI.stats, fn: function () { LIB.stats.show(); } },
      { label: t("more.rescan"), icon: UI.refresh, fn: function () { scan(true); } }
    ]);
  }

  // ---------- Adding ----------
  function pickDevice() {
    var p = LIB.parentWin();
    var dlg = p && p.orosDialog;
    var accept = ".epub,.pdf,application/epub+zip,application/pdf";
    var pr = dlg && typeof dlg.openFiles === "function" ? dlg.openFiles(accept) :
      dlg && typeof dlg.openFile === "function" ? dlg.openFile(accept).then(function (f) { return f ? [f] : null; }) :
      standalonePick(accept);
    pr.then(function (files) { if (files && files.length) importFiles([].slice.call(files), files.length === 1); });
  }
  // Standalone (no shell): a hidden input, local fallback only (R33).
  function standalonePick(accept) {
    return new Promise(function (resolve) {
      var i = el("input");
      i.type = "file"; i.accept = accept; i.multiple = true;
      i.addEventListener("change", function () { resolve(i.files ? [].slice.call(i.files) : null); });
      i.click();
    });
  }
  // Adds files; opens the book when there is one and openAfter.
  function importFiles(files, openAfter) {
    files = files.filter(Boolean);
    if (!files.length) return Promise.resolve();
    var done = 0, added = 0, firstId = null, i = 0;
    LIB.busy(true, t("busy.adding"));
    function next() {
      if (i >= files.length) return Promise.resolve();
      var f = files[i++];
      return LIB.store.addFile(f).then(function (r) {
        done++;
        if (r.isNew) added++;
        here[r.id] = true;
        if (!firstId) firstId = r.id;
      }, function (e) {
        var why = e && e.message;
        LIB.toast(t(why === "type" ? "msg.badType" : why === "big" ? "msg.tooBig" : why === "nofs" ? "msg.nofs" : "msg.addFail", { name: f.name || "" }));
      }).then(next);
    }
    return next().then(function () {
      LIB.busy(false);
      refresh();
      if (openAfter && firstId && files.length === 1) { LIB.openBook(firstId); return; }
      if (done) LIB.toast(added ? t("msg.added", { n: added }) : t("msg.already"));
    });
  }

  // A small browser of the orOS disk: folders and .epub / .pdf files.
  function pickDisk() {
    var api = LIB.store.fs();
    if (!api) { LIB.toast(t("msg.nofs")); return; }
    var dlg = LIB.dialog("lb-disk", t("disk.title"));
    var bar = el("div", "dk-bar");
    var up = LIB.btn("icon-btn", t("disk.up"), UI.back);
    var where = el("span", "dk-path", "/");
    bar.appendChild(up);
    bar.appendChild(where);
    dlg.appendChild(bar);
    var list = el("ul", "dk-list");
    dlg.appendChild(list);
    var ROOT = "/internal", cwd = ROOT, gen = 0;
    up.addEventListener("click", function () { if (cwd !== ROOT) go(cwd.replace(/\/[^\/]+$/, "") || ROOT); });
    function go(path) {
      cwd = path;
      var my = ++gen;
      up.disabled = path === ROOT;
      where.textContent = path === ROOT ? "/" : path.slice(ROOT.length);
      list.textContent = "";
      list.appendChild(el("li", "hint", t("busy.loading")));
      Promise.resolve(typeof api.ready === "function" ? api.ready() : null).then(function () { return api.ls(path); }).then(function (entries) {
        if (my !== gen) return;
        list.textContent = "";
        var items = (entries || []).filter(function (en) { return en && typeof en.name === "string" && (en.dir || C.formatOf(en.name)); });
        items.sort(function (a, b) { return (b.dir ? 1 : 0) - (a.dir ? 1 : 0) || C.cmpStr(C.fold(a.name), C.fold(b.name)); });
        if (!items.length) list.appendChild(el("li", "hint", t("disk.empty")));
        items.forEach(function (en) {
          var li = el("li");
          var b = el("button", "dk-item");
          b.type = "button";
          b.innerHTML = en.dir ? UI.disk : UI.book;
          b.appendChild(el("span", "", en.name));
          b.addEventListener("click", function () {
            var p = path + "/" + en.name;
            if (en.dir) { go(p); return; }
            dlg.close();
            openPath(p);
          });
          li.appendChild(b);
          list.appendChild(li);
        });
      }, function () {
        if (my !== gen) return;
        list.textContent = "";
        list.appendChild(el("li", "hint", t("msg.nofs")));
      });
    }
    dlg.showModal();
    go(ROOT);
  }

  // A book file of the orOS disk: open it (adding it to the library).
  function openPath(path) {
    var api = LIB.store.fs();
    if (!api || !C.formatOf(path)) { LIB.toast(t("msg.badType", { name: path.split("/").pop() })); return; }
    LIB.busy(true, t("busy.opening"));
    api.readBlob(path).then(function (blob) {
      var f = blob.slice(0, blob.size, blob.type);
      f.name = path.split("/").pop();
      // the same file → the same book; addFile maps it without copying
      return blob.arrayBuffer().then(LIB.store.sha256).then(function (hex) {
        var id = C.bookIdOf(hex);
        var b = LIB.book(id);
        if (b) { LIB.busy(false); here[id] = true; LIB.openBook(id); return; }
        return api.stat(path).then(function (st) {
          return LIB.store.readBytes(path).then(function (bytes) { return LIB.store.describe(bytes, path); }).then(function (info) {
            var rec = { id: id, h: hex, fmt: info.fmt, title: info.title || C.titleFromName(path), path: path, size: st.size, added: Date.now() };
            ["by", "lang", "year", "pages"].forEach(function (k) { if (info[k]) rec[k] = info[k]; });
            LIB.putBook(rec);
            LIB.busy(false);
            here[id] = true;
            LIB.openBook(id);
          });
        });
      });
    }).catch(function () { LIB.busy(false); LIB.toast(t("msg.openFail")); });
  }

  // ---------- Scan ----------
  function scan(manual) {
    if (scanning) return;
    scanning = true;
    var note = $("scan-note");
    var started = false;
    var tm = setTimeout(function () { started = true; note.hidden = false; note.textContent = t("scan.running"); }, 600);
    LIB.store.scan(function (i, n) {
      if (started) note.textContent = t("scan.progress", { i: i, n: n });
    }).then(function (r) {
      clearTimeout(tm);
      scanning = false;
      note.hidden = true;
      here = {};
      refresh();
      if (r && manual) LIB.toast(r.added ? t("msg.added", { n: r.added }) : t("scan.nothing"));
    }, function () { clearTimeout(tm); scanning = false; note.hidden = true; });
  }

  // ---------- Details ----------
  function details(id) {
    var b = LIB.book(id);
    if (!b) return;
    var dlg = LIB.dialog("lb-details", t("details.title"), "wide");
    var top = el("div", "dt-top");
    top.appendChild(coverEl(b, "big"));
    var info = el("div", "dt-info");
    info.appendChild(el("h3", "dt-title", b.title));
    if (b.by) info.appendChild(el("p", "dt-by", b.by));
    var dl = el("dl", "dt-list");
    function row(k, v) { if (!v && v !== 0) return; dl.appendChild(el("dt", "", k)); dl.appendChild(el("dd", "", String(v))); }
    row(t("details.format"), b.fmt === "pdf" ? "PDF" : "EPUB");
    if (b.pages) row(t("details.pages"), LIB.num(b.pages));
    if (b.year) row(t("details.year"), b.year);
    if (b.lang) row(t("details.lang"), b.lang);
    row(t("details.progress"), pctText(b));
    var tm = LIB.stats.ofBook(b);
    if (tm) { row(t("details.timeRead"), tm.read); if (tm.left) row(t("details.timeLeft"), tm.left); }
    var nHl = 0, nBm = 0;
    LIB.data.marks.forEach(function (k) { if (k.b === id) { if (k.k === "hl") nHl++; else nBm++; } });
    row(t("details.marks"), t("details.marksN", { h: nHl, b: nBm }));
    if (b.size) row(t("details.size"), LIB.size(b.size));
    if (b.added) row(t("details.added"), LIB.date(b.added));
    if (b.tags && b.tags.length) row(t("details.tags"), b.tags.join(", "));
    var pathDd = el("dd", "dt-path", "…");
    dl.appendChild(el("dt", "", t("details.file")));
    dl.appendChild(pathDd);
    info.appendChild(dl);
    top.appendChild(info);
    dlg.appendChild(top);
    var acts = el("div", "dlg-actions wrap");
    var readBtn = LIB.textBtn("btn primary", C.progressOf(LIB.data, id) > 0 ? t("details.continue") : t("details.read"), function () { dlg.close(); LIB.openBook(id); });
    acts.appendChild(readBtn);
    acts.appendChild(LIB.textBtn("btn", t("details.edit"), function () { dlg.close(); editDialog(id); }));
    acts.appendChild(LIB.textBtn("btn", b.fin ? t("details.unfinish") : t("details.finish"), function () {
      dlg.close();
      LIB.putBook({ id: id, fin: b.fin ? undefined : ymd(new Date()) });
    }));
    if (nHl + nBm) acts.appendChild(LIB.textBtn("btn", t("details.export"), function () { dlg.close(); exportNotes(id); }));
    var shelfId = C.shelfItemOf(LIB.readShelf(), id);
    acts.appendChild(LIB.textBtn("btn", shelfId ? t("details.shelfOpen") : t("details.shelfAdd"), function () {
      dlg.close();
      var cur = LIB.book(id);
      if (cur) LIB.openApp("shelf", shelfId ? { item: shelfId } : C.shelfTarget(cur));
    }));
    acts.appendChild(LIB.textBtn("btn", t("details.remove"), function () { dlg.close(); LIB.removeBook(id); }));
    dlg.appendChild(acts);
    var missing = el("div", "dt-missing");
    missing.hidden = true;
    dlg.appendChild(missing);
    dlg.showModal();
    LIB.store.pathOf(b).then(function (p) {
      here[id] = !!p;
      pathDd.textContent = p ? p.replace(/^\/internal/, "") : t("book.notHere");
      if (p) {
        acts.appendChild(LIB.textBtn("btn danger", t("details.delete"), function () { dlg.close(); deleteFile(id, p); }));
        return;
      }
      readBtn.disabled = true;
      missing.hidden = false;
      missing.appendChild(el("p", "hint", t("details.missing")));
      var ma = el("div", "dlg-actions wrap");
      ma.appendChild(LIB.textBtn("btn primary", t("add.device"), function () { dlg.close(); pickDevice(); }));
      ma.appendChild(LIB.textBtn("btn", t("add.disk"), function () { dlg.close(); pickDisk(); }));
      missing.appendChild(ma);
    });
  }
  function ymd(d) {
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function editDialog(id) {
    var b = LIB.book(id);
    if (!b) return;
    var dlg = LIB.dialog("lb-edit", t("edit.title"), "small");
    var form = el("form", "form");
    function field(label, value, max) {
      var l = el("label", "field");
      l.appendChild(el("span", "", label));
      var i = el("input");
      i.type = "text"; i.value = value || ""; i.maxLength = max;
      l.appendChild(i);
      form.appendChild(l);
      return i;
    }
    var ti = field(t("edit.name"), b.title, C.TITLE_LEN);
    var by = field(t("edit.by"), b.by, C.BY_LEN);
    var tg = field(t("edit.tags"), (b.tags || []).join(", "), 400);
    var acts = el("div", "dlg-actions");
    acts.appendChild(LIB.textBtn("btn", t("btn.cancel"), function () { dlg.close(); }));
    var ok = LIB.textBtn("btn primary", t("btn.save"));
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var title = C.str(ti.value, C.TITLE_LEN);
      if (!title) { ti.focus(); return; }
      LIB.putBook({ id: id, title: title, by: C.str(by.value, C.BY_LEN) || undefined, tags: C.parseTags(tg.value) });
      dlg.close();
    });
    dlg.appendChild(form);
    dlg.showModal();
    ti.focus();
  }
  function deleteFile(id, path) {
    var b = LIB.book(id);
    LIB.confirm(t("delete.title"), t("delete.text", { title: b ? b.title : "", path: path.replace(/^\/internal/, "") }), t("delete.ok"), true).then(function (yes) {
      if (!yes) return;
      var api = LIB.store.fs();
      api.rm(path).then(function () {
        here[id] = false;
        var bk = LIB.book(id);
        if (bk) LIB.data.tombs[id] = LIB.now(bk.m);
        LIB.data.marks.forEach(function (k) { if (k.b === id) LIB.data.tombs[k.id] = LIB.now(k.m); });
        if (LIB.data.pos[id]) delete LIB.data.pos[id];
        LIB.commit();
        LIB.toast(t("msg.deleted"));
      }, function () { LIB.toast(t("msg.deleteFail")); });
    });
  }
  // Markdown of the book's notes: to the orOS disk (Notes folder), a
  // download or the clipboard; or a new page of the Notes app.
  function exportNotes(id) {
    var b = LIB.book(id);
    if (!b) return;
    var md = C.exportMarkdown(b, LIB.data.marks, LIB.LANG);
    var name = b.title + " - " + t("export.suffix") + ".md";
    var dlg = LIB.dialog("lb-export", t("export.title"), "small");
    dlg.appendChild(el("p", "dlg-text", t("export.text")));
    var acts = el("div", "dlg-actions wrap");
    acts.appendChild(LIB.textBtn("btn primary", t("export.disk"), function () {
      dlg.close();
      LIB.store.saveText("/internal/" + t("export.folder"), name, md).then(function (p) {
        LIB.toast(t("export.saved", { path: p.replace(/^\/internal/, "") }));
      }, function () { LIB.toast(t("msg.saveFail")); });
    }));
    acts.appendChild(LIB.textBtn("btn", t("export.download"), function () {
      dlg.close();
      var p = LIB.parentWin();
      var dl = p && p.orosDialog;
      var blob = new Blob([md], { type: "text/markdown" });
      if (dl && typeof dl.saveFile === "function") dl.saveFile({ blob: blob, filename: name, mime: "text/markdown" });
      else {
        var a = el("a");
        a.href = URL.createObjectURL(blob); a.download = name; a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 40000);
      }
    }));
    acts.appendChild(LIB.textBtn("btn", t("export.copy"), function () {
      dlg.close();
      copyText(md);
    }));
    // Notes: a new page, plain text (BR: __orosOpenAt("notes", { add }))
    var plain = C.notesPlain(b, LIB.data.marks, LIB.LANG);
    var hasHl = LIB.data.marks.some(function (k) { return k.b === id && (k.k === "hl" || k.n); });
    if (hasHl && LIB.parentWin()) acts.appendChild(LIB.textBtn("btn", t("export.notes"), function () {
      dlg.close();
      if (LIB.openApp("notes", { add: { title: t("export.notesTitle", { title: b.title }), text: plain.text } })) {
        LIB.toast(t("export.notesSent"));
      } else LIB.toast(t("export.notesFail"));
    }));
    dlg.appendChild(acts);
    dlg.showModal();
  }
  function copyText(s) {
    var ok = function () { LIB.toast(t("msg.copied")); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(s).then(ok, fallback); return; }
    } catch (e) {}
    fallback();
    function fallback() {
      var ta = el("textarea");
      ta.value = s;
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); ok(); } catch (e) { LIB.toast(t("msg.copyFail")); }
      ta.remove();
    }
  }
  LIB.copyText = copyText;

  LIB.home = {
    build: build, refresh: refresh, scan: scan, details: details, importFiles: importFiles,
    openPath: openPath, coverReady: coverReady, exportNotes: exportNotes, forget: function (id) { delete here[id]; }
  };
})();
