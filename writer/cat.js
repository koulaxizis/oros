// ============================================================
// orOS Writer — cat.js: book translation, the screens (WR-CAT, T1)
// Loaded on first use (with catcore.js and catstore.js) from the
// Review menu, the Translations list or a { translate } deep link.
//   - Translations: the list of projects (open, delete, new)
//   - New translation: from one of the person's documents or a file
//     (Writer's own import, the original file is kept), languages
//   - The translation screen: source and translation side by side per
//     segment (one under the other on a phone), status per segment,
//     progress, search, filter, chapters, Build document.
// Everything shown from a project goes through textContent (the
// segments are data). Writes go through catstore (own files only).
// window.WriterCatHost (writer.js) is what it may use of Writer.
// Exposes window.WriterCat.
// ============================================================
(function () {
  "use strict";

  var H = window.WriterCatHost, C = window.WriterCatCore, S = window.WriterCatStore;
  if (!H || !C || !S) return;
  var t = H.t;

  var DEV_KEY = "oros-writer-tr-dev", SUM_KEY = "oros-writer-tr-sum";
  var SAVE_MS = 1200, POLL_MS = 15000;

  // ---------- device + store ----------
  function devId() {
    var v = "";
    try { v = localStorage.getItem(DEV_KEY) || ""; } catch (e) {}
    if (!C.DEV_RX.test(v)) {
      v = "";
      var a = "abcdefghijklmnopqrstuvwxyz0123456789";
      var r = new Uint8Array(12);
      (window.crypto || {}).getRandomValues ? crypto.getRandomValues(r) : r.forEach(function (x, i) { r[i] = Math.random() * 256; });
      for (var i = 0; i < 12; i++) v += a[r[i] % 36];
      try { localStorage.setItem(DEV_KEY, v); } catch (e) {}
    }
    return v;
  }
  var store = null;
  function getStore() {
    var fs = H.fs();
    if (!fs) return null;
    if (!store) store = new S.Store(fs, devId());
    return store;
  }
  function sums() { try { var o = JSON.parse(localStorage.getItem(SUM_KEY) || "{}"); return o && typeof o === "object" ? o : {}; } catch (e) { return {}; } }
  function saveSum(id, st) {
    var o = sums();
    o[id] = [st.pct, st.words];
    try { localStorage.setItem(SUM_KEY, JSON.stringify(o)); } catch (e) {}
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function btn(cls, label, fn, title) {
    var b = el("button", cls, label);
    b.type = "button";
    if (title) { b.title = title; b.setAttribute("aria-label", title); }
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function langName(code) {
    var hit = C.LANGS.filter(function (l) { return l[0] === code || l[0] === String(code).split("-")[0]; })[0];
    return hit ? hit[1] : code;
  }
  function langSelect(value) {
    var s = el("select", "w-field cat-lang");
    C.LANGS.forEach(function (l) {
      var o = el("option", "", l[1] + " (" + l[0] + ")");
      o.value = l[0];
      s.appendChild(o);
    });
    s.value = value;
    return s;
  }
  function num(n) { try { return n.toLocaleString(H.locale()); } catch (e) { return String(n); } }
  function fmt(key, vals) {
    return t(key).replace(/\{(\w+)\}/g, function (m, k) { return vals[k] !== undefined ? vals[k] : m; });
  }
  function noDisk() { H.toast(t("cat.noDisk")); }
  function failed(e) { console.warn("[writer] translation:", e); H.toast(t("cat.err")); }

  // ---------- Translations (the list) ----------
  function openManager() {
    var st = getStore();
    if (!st) { noDisk(); return; }
    var dlg = H.openDialog(t("cat.list"), "", [
      { class: "fb-btn", label: t("cat.close"), onClick: function () { dlg.close(); } },
      { class: "fb-btn primary", label: t("cat.new"), onClick: function () { dlg.close(); newProject(); } }
    ]);
    dlg.classList.add("cat-dlg");
    var body = dlg.querySelector(".w-dialog-body");
    body.appendChild(el("p", "cat-muted", t("cat.loading")));
    st.list().then(function (list) {
      body.textContent = "";
      if (!list.length) { body.appendChild(el("p", "cat-muted", t("cat.none"))); return; }
      var sm = sums(), ul = el("ul", "cat-plist");
      list.forEach(function (p) {
        var li = el("li", "cat-pitem");
        var main = btn("cat-popen", "", function () { dlg.close(); openProject(p.id); });
        main.appendChild(el("span", "cat-pname", p.name || t("cat.untitled")));
        var s = sm[p.id];
        main.appendChild(el("span", "cat-pmeta", langName(p.from) + " → " + langName(p.to) +
          (s ? " · " + fmt("cat.pct", { p: num(s[0]) }) : "")));
        li.appendChild(main);
        li.appendChild(btn("tb-btn cat-pdel", "×", function () {
          H.wConfirm(fmt("cat.delAsk", { name: p.name || t("cat.untitled") }), { danger: true, ok: t("cat.del") }).then(function (yes) {
            if (!yes) return;
            st.trash(p.id).then(function () { li.remove(); H.toast(t("cat.deleted")); }, failed);
          });
        }, t("cat.del")));
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }, function (e) { body.textContent = ""; body.appendChild(el("p", "cat-muted", t("cat.err"))); failed(e); });
  }

  // ---------- New translation ----------
  function newProject(docId) {
    var st = getStore();
    if (!st) { noDisk(); return; }
    var docs = H.docs();
    var cur = docId ? H.getDoc(docId) : H.activeDoc();
    var file = null, fileDoc = null;
    var dlg = H.openDialog(t("cat.new"), "", [
      { class: "fb-btn", label: t("wx.cancel"), onClick: function () { dlg.close(); } },
      { class: "fb-btn primary", label: t("cat.create"), onClick: create }
    ]);
    dlg.classList.add("cat-dlg");
    var body = dlg.querySelector(".w-dialog-body");
    var f = el("div", "cat-form");
    function row(label, ctl) {
      var l = el("label", "cat-frow");
      l.appendChild(el("span", "cat-flabel", label));
      l.appendChild(ctl);
      f.appendChild(l);
      return l;
    }
    var srcSel = el("select", "w-field");
    docs.forEach(function (d) {
      var o = el("option", "", d.title || H.untitled(d));
      o.value = d.id;
      srcSel.appendChild(o);
    });
    if (cur) srcSel.value = cur.id;
    row(t("cat.source"), srcSel);
    var fileRow = el("div", "cat-filerow");
    var fileBtn = btn("fb-btn", t("cat.fromFile"), pickFile);
    var fileName = el("span", "cat-muted", "");
    fileRow.appendChild(fileBtn);
    fileRow.appendChild(fileName);
    f.appendChild(fileRow);
    var ui = String(H.lang() || "en").split("-")[0];
    var from = langSelect(ui === "el" ? "en" : "en");
    var to = langSelect(ui === "en" ? "el" : ui);
    if (to.value === from.value) to.value = from.value === "el" ? "en" : "el";
    row(t("cat.from"), from);
    row(t("cat.to"), to);
    var name = el("input", "w-field");
    name.type = "text";
    name.maxLength = 200;
    row(t("cat.name"), name);
    function suggest() {
      var d = fileDoc || H.getDoc(srcSel.value);
      name.placeholder = ((d && (d.title || H.untitled(d))) || t("cat.untitled")) + " · " + to.value.toUpperCase();
    }
    srcSel.addEventListener("change", function () { fileDoc = null; file = null; fileName.textContent = ""; suggest(); });
    to.addEventListener("change", suggest);
    suggest();
    body.appendChild(f);
    if (!docs.length) srcSel.disabled = true;

    function pickFile() {
      H.openFile(".docx,.odt,.rtf,.md,.markdown,.html,.htm,.txt,.pdf").then(function (fl) {
        if (!fl) return;
        fileBtn.disabled = true;
        fileName.textContent = t("cat.loading");
        return H.importFileAsDoc(fl).then(function (d) {
          file = fl; fileDoc = d;
          fileName.textContent = fl.name;
          var o = el("option", "", d.title || fl.name);
          o.value = d.id;
          srcSel.appendChild(o);
          srcSel.value = d.id;
          srcSel.disabled = false;
          suggest();
        });
      }).catch(function (e) { fileName.textContent = ""; failed(e); }).then(function () { fileBtn.disabled = false; });
    }
    var busy = false;
    function create() {
      if (busy) return;
      var d = fileDoc || H.getDoc(srcSel.value);
      if (!d) { H.toast(t("cat.pickSrc")); return; }
      if (from.value === to.value) { H.toast(t("cat.sameLang")); return; }
      H.flushSave();
      var data = C.extract({ html: d.html, title: d.title, header: d.header, footer: d.footer, footnotes: d.footnotes }, from.value);
      if (!data.segs.length) { H.toast(t("cat.empty")); return; }
      data.page = { pageSize: d.pageSize, margins: d.margins };
      busy = true;
      st.create({ name: name.value.trim() || name.placeholder, from: from.value, to: to.value, src: d.id, data: data,
        orig: file, origName: file ? file.name : "" }).then(function (p) {
        dlg.close();
        openProject(p.id);
      }, function (e) { busy = false; failed(e); });
    }
  }

  // ---------- The translation screen ----------
  var V = null;     // the open project's view state

  function openProject(id) {
    var st = getStore();
    if (!st) { noDisk(); return; }
    if (V) closeView();
    st.open(id).then(function (pr) { showView(id, pr); }, function (e) {
      H.toast(e && e.code === "nosrc" ? t("cat.noSrc") : (e && e.code === "gone" ? t("cat.gone") : t("cat.err")));
      if (!e || !e.code) failed(e);
    });
  }

  function showView(id, pr) {
    var root = el("div", "cat-view");
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", t("cat.list"));
    V = { id: id, p: pr.p, src: pr.src, rows: pr.rows, meta: pr.meta, sig: pr.sig, root: root,
      pending: {}, saveTimer: null, poll: null, cur: -1, ta: null, rowsEl: [], filter: "all", q: "",
      reps: C.repeats(pr.src), chaps: C.chapters(pr.src) };
    // header
    var head = el("div", "cat-head");
    head.appendChild(btn("tb-btn cat-back", "←", closeView, t("cat.back")));
    var tl = el("div", "cat-title");
    V.nameEl = el("span", "cat-name", V.meta.name || V.p.name || t("cat.untitled"));
    tl.appendChild(V.nameEl);
    tl.appendChild(el("span", "cat-langs", langName(V.p.from) + " → " + langName(V.p.to)));
    head.appendChild(tl);
    var prog = el("div", "cat-prog");
    V.bar = el("div", "cat-bar");
    V.barFill = el("div", "cat-bar-fill");
    V.bar.appendChild(V.barFill);
    V.bar.setAttribute("role", "progressbar");
    V.bar.setAttribute("aria-valuemin", "0");
    V.bar.setAttribute("aria-valuemax", "100");
    V.progText = el("span", "cat-prog-text", "");
    prog.appendChild(V.bar);
    prog.appendChild(V.progText);
    head.appendChild(prog);
    V.saveEl = el("span", "cat-save", "");
    V.saveEl.setAttribute("aria-live", "polite");
    head.appendChild(V.saveEl);
    root.appendChild(head);
    // tools
    var tools = el("div", "cat-tools");
    var q = el("input", "w-field cat-q");
    q.type = "search";
    q.placeholder = t("cat.search");
    q.setAttribute("aria-label", t("cat.search"));
    var qt = null;
    q.addEventListener("input", function () { clearTimeout(qt); qt = setTimeout(function () { V.q = fold(q.value.trim()); applyFilter(); }, 200); });
    tools.appendChild(q);
    var fsel = el("select", "w-field cat-filter");
    fsel.setAttribute("aria-label", t("cat.filter"));
    [["all", "cat.f.all"], ["todo", "cat.f.todo"], ["draft", "cat.f.draft"], ["done", "cat.f.done"], ["rev", "cat.f.rev"], ["tags", "cat.f.tags"]].forEach(function (x) {
      var o = el("option", "", t(x[1]));
      o.value = x[0];
      fsel.appendChild(o);
    });
    fsel.addEventListener("change", function () { V.filter = fsel.value; applyFilter(); });
    tools.appendChild(fsel);
    if (V.chaps.length) {
      var csel = el("select", "w-field cat-chap");
      csel.setAttribute("aria-label", t("cat.chapter"));
      V.chapSel = csel;
      csel.addEventListener("change", function () {
        var i = +csel.value;
        if (i >= 0) { var r = V.rowsEl[i]; if (r) { r.scrollIntoView({ block: "start" }); focusRow(i); } }
      });
      tools.appendChild(csel);
    }
    tools.appendChild(btn("fb-btn primary cat-build", t("cat.build"), build));
    var more = btn("tb-btn cat-more", "⋯", function () {
      H.openMenu(more, [
        { label: t("cat.rename"), action: rename },
        { label: t("cat.nextTodo"), action: function () { nextTodo(V.cur); } },
        null,
        { label: t("cat.del"), action: delProject }
      ]);
    }, t("cat.more"));
    more.setAttribute("aria-haspopup", "menu");
    tools.appendChild(more);
    root.appendChild(tools);
    // the segments
    var list = el("div", "cat-list");
    V.list = list;
    var frag = document.createDocumentFragment();
    var lastB = -1;
    V.src.segs.forEach(function (sg, i) {
      var r = el("div", "cat-row");
      r.dataset.i = i;
      if (sg.b !== lastB) r.classList.add("cat-first");
      lastB = sg.b;
      var b = V.src.blocks[sg.b];
      if (b.k === "h" && b.h) r.classList.add("cat-h");
      else if (b.k !== "h") r.classList.add("cat-k-" + b.k);
      var n = el("div", "cat-num", String(i + 1));
      var s = el("div", "cat-src");
      s.setAttribute("lang", V.p.from || "");
      paint(s, sg.s, i);
      var tg = el("div", "cat-tgt");
      tg.setAttribute("lang", V.p.to || "");
      var mark = el("div", "cat-st");
      r.appendChild(n); r.appendChild(s); r.appendChild(tg); r.appendChild(mark);
      frag.appendChild(r);
      V.rowsEl.push(r);
      paintRow(i);
    });
    list.appendChild(frag);
    list.addEventListener("click", function (e) {
      var r = e.target.closest && e.target.closest(".cat-row");
      if (!r || (V.ta && V.ta.parentNode && r.contains(V.ta) && e.target.closest(".cat-edit"))) return;
      focusRow(+r.dataset.i);
    });
    root.appendChild(list);
    root.appendChild(el("div", "cat-keys", t("cat.keys")));
    document.body.appendChild(root);
    document.body.classList.add("cat-open");
    progress();
    // the first segment still to do
    var first = firstTodo(-1);
    focusRow(first < 0 ? 0 : first, true);
    V.poll = setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flushNow);
    root.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("dialog[open]")) { e.preventDefault(); closeView(); }
    });
  }

  function fold(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }

  // a segment's text with its tags as small numbered chips
  var STYLE = { b: "b", strong: "b", i: "i", em: "i", u: "u", s: "s", strike: "s", del: "s", sup: "sup", sub: "sub", a: "a", code: "code" };
  function paint(box, text, i) {
    box.textContent = "";
    var tags = C.segTags(V.src, i), kinds = tags.map(function (x) { return x.kind; });
    var toks = C.readTags(text, kinds), stack = [box];
    toks.forEach(function (tk) {
      var top = stack[stack.length - 1];
      if (tk.x !== undefined) { top.appendChild(document.createTextNode(tk.x)); return; }
      var n = tk.v || tk.o || tk.c, info = tags[n - 1] || {};
      var chip = el("span", "cat-tag", tk.c ? "/" + n : String(n));
      chip.title = info.name || "";
      if (tk.v) { chip.classList.add("cat-tag-v"); chip.textContent = n + (info.name === "img" ? " ▣" : info.name === "br" ? " ↵" : ""); top.appendChild(chip); return; }
      if (tk.o) {
        top.appendChild(chip);
        var span = el("span", "cat-fmt cat-fmt-" + (STYLE[info.name] || "x"));
        top.appendChild(span);
        stack.push(span);
        return;
      }
      // closing: leave the span it opened (or ignore a stray one)
      if (stack.length > 1) stack.pop();
      stack[stack.length - 1].appendChild(chip);
    });
  }
  function rowOf(i) { return V.rows[i] || null; }
  function statusOf(i) { var r = rowOf(i); return r ? (r[0].trim() || r[1] >= C.ST_DONE ? r[1] : 0) : 0; }
  var ST_ICON = ["○", "✎", "✓", "✓✓"], ST_KEY = ["cat.s0", "cat.s1", "cat.s2", "cat.s3"];
  function paintRow(i) {
    var r = V.rowsEl[i];
    if (!r) return;
    var row = rowOf(i), st = statusOf(i), tg = r.children[2], mk = r.children[3];
    r.classList.remove("cat-s0", "cat-s1", "cat-s2", "cat-s3");
    r.classList.add("cat-s" + st);
    mk.textContent = ST_ICON[st];
    mk.title = t(ST_KEY[st]);
    if (V.cur === i && V.ta) return;
    if (row && row[0]) paint(tg, row[0], i);
    else { tg.textContent = ""; if (row && row[1] >= C.ST_DONE) tg.appendChild(el("span", "cat-muted", t("cat.joined"))); }
    var bad = row && row[0] && C.checkTags(V.src, i, row[0]);
    r.classList.toggle("cat-bad", !!(bad && (bad.missing.length || bad.twice.length || bad.order)));
  }

  function progress() {
    var s = C.stats(V.src, V.rows);
    V.barFill.style.width = s.pct + "%";
    V.bar.setAttribute("aria-valuenow", String(Math.round(s.pct)));
    V.progText.textContent = fmt("cat.prog", { p: num(s.pct), d: num(s.doneWords), w: num(s.words) });
    saveSum(V.id, s);
    if (V.chapSel) {
      var keep = V.chapSel.value;
      V.chapSel.textContent = "";
      var o0 = el("option", "", t("cat.chapter"));
      o0.value = "-1";
      V.chapSel.appendChild(o0);
      V.chaps.forEach(function (c, k) {
        var end = k + 1 < V.chaps.length ? V.chaps[k + 1].i : V.src.segs.length, w = 0, d = 0;
        for (var i = c.i; i < end; i++) { w += V.src.segs[i].w; if (statusOf(i) >= C.ST_DONE) d += V.src.segs[i].w; }
        var o = el("option", "", (c.title.length > 40 ? c.title.slice(0, 40) + "…" : c.title) + " · " + (w ? Math.floor(d * 100 / w) : 100) + "%");
        o.value = String(c.i);
        V.chapSel.appendChild(o);
      });
      V.chapSel.value = keep || "-1";
    }
  }

  // ---------- editing one segment ----------
  function focusRow(i, noScroll) {
    if (!V || i < 0 || i >= V.src.segs.length) return;
    if (V.cur === i && V.ta) { V.ta.focus(); return; }
    leaveRow();
    V.cur = i;
    var r = V.rowsEl[i];
    r.classList.add("cat-cur");
    var tg = r.children[2];
    tg.textContent = "";
    var box = el("div", "cat-edit");
    var ta = el("textarea", "cat-ta");
    ta.setAttribute("aria-label", fmt("cat.segN", { n: i + 1 }));
    ta.setAttribute("lang", V.p.to || "");
    ta.spellcheck = true;
    var row = rowOf(i);
    ta.value = row ? row[0] : "";
    ta.addEventListener("input", function () { changed(i, ta.value, null); grow(ta); tagHints(); });
    ta.addEventListener("keydown", keys);
    box.appendChild(ta);
    var bar = el("div", "cat-ebar");
    bar.appendChild(btn("fb-btn cat-copy", t("cat.copySrc"), function () { copySource(); ta.focus(); }, t("cat.copySrcT")));
    var tagsBox = el("span", "cat-etags");
    bar.appendChild(tagsBox);
    var rep = V.reps[i];
    if (rep !== undefined && rowOf(rep) && rowOf(rep)[0]) {
      bar.appendChild(btn("fb-btn cat-rep", fmt("cat.repeat", { n: rep + 1 }), function () {
        ta.value = rowOf(rep)[0]; changed(i, ta.value, null); grow(ta); tagHints(); ta.focus();
      }));
    }
    var sp = el("span", "cat-espace");
    bar.appendChild(sp);
    bar.appendChild(btn("fb-btn cat-join", t("cat.join"), function () { setStatus(i, C.ST_DONE, ""); next(i); }, t("cat.joinT")));
    bar.appendChild(btn("fb-btn cat-rev", t("cat.reviewed"), function () { setStatus(i, C.ST_REVIEWED); next(i); }, t("cat.reviewedT")));
    bar.appendChild(btn("fb-btn primary cat-ok", t("cat.confirm"), function () { setStatus(i, C.ST_DONE); next(i); }, t("cat.confirmT")));
    box.appendChild(bar);
    tg.appendChild(box);
    V.ta = ta;
    V.tagsBox = tagsBox;
    tagHints();
    grow(ta);
    if (!noScroll) r.scrollIntoView({ block: "nearest" });
    else r.scrollIntoView({ block: "center" });
    ta.focus({ preventScroll: true });
  }
  function leaveRow() {
    if (!V || V.cur < 0) return;
    var i = V.cur, r = V.rowsEl[i];
    V.cur = -1;
    V.ta = null;
    if (r) { r.classList.remove("cat-cur"); paintRow(i); }
  }
  function grow(ta) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight + 2, 400) + "px"; }
  function tagHints() {
    if (!V || V.cur < 0 || !V.tagsBox) return;
    var i = V.cur, box = V.tagsBox, tags = C.segTags(V.src, i);
    box.textContent = "";
    if (!tags.length) return;
    var chk = C.checkTags(V.src, i, V.ta.value);
    tags.forEach(function (tg) {
      var miss = chk.missing.indexOf(tg.n) >= 0;
      var b = btn("cat-tag cat-tagbtn" + (miss ? " cat-miss" : ""), String(tg.n) + (tg.kind === "p" ? "…/" + tg.n : ""), function () { insertTag(tg); },
        fmt(miss ? "cat.tagMiss" : "cat.tagIns", { n: tg.n, name: tg.name }));
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });
      box.appendChild(b);
    });
    if (chk.twice.length || chk.order) box.appendChild(el("span", "cat-warn", t("cat.tagOrder")));
  }
  function insertTag(tg) {
    var ta = V.ta;
    if (!ta) return;
    var a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
    var ins = tg.kind === "v" ? [C.OPEN + tg.n + "/" + C.CLOSE, ""] : [C.OPEN + tg.n + C.CLOSE, C.OPEN + "/" + tg.n + C.CLOSE];
    ta.value = v.slice(0, a) + ins[0] + v.slice(a, b) + ins[1] + v.slice(b);
    var pos = b + ins[0].length + (b > a ? ins[1].length : 0);
    ta.setSelectionRange(pos, pos);
    ta.focus();
    changed(V.cur, ta.value, null);
    tagHints();
  }
  function nextMissingTag() {
    if (!V || V.cur < 0) return;
    var chk = C.checkTags(V.src, V.cur, V.ta.value), tags = C.segTags(V.src, V.cur);
    var tg = tags.filter(function (x) { return chk.missing.indexOf(x.n) >= 0; })[0];
    if (tg) insertTag(tg);
  }
  function copySource() {
    if (!V || V.cur < 0) return;
    V.ta.value = V.src.segs[V.cur].s;
    changed(V.cur, V.ta.value, null);
    grow(V.ta);
    tagHints();
  }
  function keys(e) {
    var i = V.cur;
    if (e.isComposing) return;
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setStatus(i, e.shiftKey ? C.ST_REVIEWED : C.ST_DONE); next(i); return; }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      if (e.key === "ArrowDown") { e.preventDefault(); focusRow(i + 1); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); focusRow(i - 1); return; }
      var k = (e.code || "").replace(/^Key/, "");
      if (k === "S") { e.preventDefault(); copySource(); return; }
      if (k === "T") { e.preventDefault(); nextMissingTag(); return; }
    }
  }
  function visible(i) { var r = V.rowsEl[i]; return r && !r.hidden; }
  function next(i) {
    for (var k = i + 1; k < V.src.segs.length; k++) if (visible(k)) { focusRow(k); return; }
    leaveRow();
  }
  function firstTodo(from) {
    for (var k = from + 1; k < V.src.segs.length; k++) if (statusOf(k) < C.ST_DONE) return k;
    return -1;
  }
  function nextTodo(from) {
    var k = firstTodo(from);
    if (k < 0) k = firstTodo(-1);
    if (k < 0) { H.toast(t("cat.allDone")); return; }
    if (!visible(k)) { V.filter = "all"; V.root.querySelector(".cat-filter").value = "all"; applyFilter(); }
    focusRow(k);
  }

  // a change of segment i: text (null = keep) and status (null = draft rules)
  function changed(i, text, status) {
    var old = rowOf(i), now = Date.now();
    var txt = text === null ? (old ? old[0] : "") : String(text).slice(0, C.MAX_TEXT);
    var st;
    if (status !== null && status !== undefined) st = status;
    else st = txt.trim() ? C.ST_DRAFT : C.ST_NEW;    // typing makes a draft (a confirmed one too)
    if (old && old[0] === txt && old[1] === st) return;
    var row = [txt, st, Math.max(now, old ? old[2] + 1 : 0)];
    V.rows[i] = row;
    V.pending[i] = row;
    paintRow(i);
    progress();
    scheduleSave();
  }
  function setStatus(i, st, text) {
    var txt = text !== undefined ? text : (V.cur === i && V.ta ? V.ta.value : (rowOf(i) ? rowOf(i)[0] : ""));
    if (st >= C.ST_DONE && !txt.trim() && text === undefined) { H.toast(t("cat.emptyOk")); return; }
    changed(i, txt, st);
  }

  // ---------- saving and other devices ----------
  function scheduleSave() {
    V.saveEl.textContent = t("cat.saving");
    clearTimeout(V.saveTimer);
    V.saveTimer = setTimeout(flushNow, SAVE_MS);
  }
  function flushNow() {
    if (!V) return Promise.resolve();
    clearTimeout(V.saveTimer);
    var batch = V.pending, id = V.id, view = V;
    if (!Object.keys(batch).length) return Promise.resolve();
    V.pending = {};
    return getStore().saveRows(id, batch).then(function () {
      if (V === view && !Object.keys(V.pending).length) V.saveEl.textContent = t("cat.saved");
      return getStore().sig(id).then(function (s) { if (V === view) V.sig = s; });
    }, function (e) {
      // keep them for the next try
      Object.keys(batch).forEach(function (k) { if (!view.pending[k] || view.pending[k][2] < batch[k][2]) view.pending[k] = batch[k]; });
      if (V === view) { V.saveEl.textContent = t("cat.notSaved"); scheduleSaveLater(view); }
      failed(e);
    });
  }
  function scheduleSaveLater(view) { setTimeout(function () { if (V === view) flushNow(); }, 10000); }
  function onVis() {
    if (!V) return;
    if (document.visibilityState === "hidden") flushNow();
    else poll();
  }
  function poll() {
    if (!V || document.visibilityState === "hidden") return;
    var view = V;
    getStore().sig(V.id).then(function (s) {
      if (V !== view || s === V.sig) return;
      return getStore().reload(V.id).then(function (x) {
        if (V !== view) return;
        V.sig = x.sig;
        var merged = C.mergeRows([V.rows, x.rows]);
        Object.keys(merged).forEach(function (k) {
          var a = V.rows[k], b = merged[k];
          if (a && a[2] === b[2] && a[0] === b[0] && a[1] === b[1]) return;
          V.rows[k] = b;
          if (+k === V.cur && V.ta && V.ta.value !== b[0]) {
            // the open segment changed elsewhere: take it unless typed here since
            if (!V.pending[k]) { V.ta.value = b[0]; grow(V.ta); tagHints(); }
          }
          paintRow(+k);
        });
        if (x.meta.name && x.meta.name !== V.nameEl.textContent) V.nameEl.textContent = x.meta.name;
        V.meta = x.meta;
        progress();
      });
    }).catch(function () {});
  }

  function applyFilter() {
    var f = V.filter, q = V.q, shown = 0;
    V.src.segs.forEach(function (sg, i) {
      var st = statusOf(i), row = rowOf(i), ok = true;
      if (f === "todo") ok = st < C.ST_DONE;
      else if (f === "draft") ok = st === C.ST_DRAFT;
      else if (f === "done") ok = st >= C.ST_DONE;
      else if (f === "rev") ok = st === C.ST_REVIEWED;
      else if (f === "tags") { var c = row && row[0] ? C.checkTags(V.src, i, row[0]) : null; ok = !!(c && (c.missing.length || c.twice.length || c.order)); }
      if (ok && q) ok = fold(C.plainText(V.src, i)).indexOf(q) >= 0 || (row && fold(row[0]).indexOf(q) >= 0);
      V.rowsEl[i].hidden = !ok && i !== V.cur;
      if (ok) shown++;
    });
    V.list.classList.toggle("cat-none", !shown);
  }

  // ---------- Build document ----------
  function build() {
    if (!V) return;
    if (V.ta) { var old = rowOf(V.cur); if (!old || old[0] !== V.ta.value) changed(V.cur, V.ta.value, null); }
    var view = V;
    flushNow().then(function () {
      var out = C.build(view.src, view.rows);
      var st = C.stats(view.src, view.rows);
      var left = st.segs - st.done;
      var doc = view.meta.out ? H.getDoc(view.meta.out) : null;
      var go = function (replace) {
        var d = H.writeDoc(replace ? doc : null, {
          title: out.title || (view.meta.name || view.p.name), html: out.html, header: out.header, footer: out.footer,
          footnotes: out.footnotes, page: view.src.page, lang: view.p.to
        });
        if (!d) { H.toast(t("cat.err")); return; }
        getStore().saveMeta(view.id, { out: d.id }).catch(failed);
        view.meta.out = d.id;
        closeView();
        H.activateTab(d.id);
        H.toast(left ? fmt("cat.builtLeft", { n: num(left) }) : t("cat.built"));
      };
      if (doc && !doc.del) {
        H.wConfirm(fmt("cat.updateAsk", { name: doc.title || H.untitled(doc) }), { ok: t("cat.update") }).then(function (yes) { if (yes) go(true); });
      } else go(false);
    }).catch(failed);
  }

  function rename() {
    H.wPrompt(t("cat.rename"), V.nameEl.textContent).then(function (v) {
      if (!v || !V) return;
      V.nameEl.textContent = v;
      getStore().saveMeta(V.id, { name: v }).catch(failed);
    });
  }
  function delProject() {
    var id = V.id, nm = V.nameEl.textContent;
    H.wConfirm(fmt("cat.delAsk", { name: nm }), { danger: true, ok: t("cat.del") }).then(function (yes) {
      if (!yes) return;
      flushNow().then(function () {
        closeView();
        return getStore().trash(id).then(function () { H.toast(t("cat.deleted")); });
      }).catch(failed);
    });
  }

  function closeView() {
    if (!V) return;
    var view = V;
    if (V.ta) { var v = V.ta.value, i = V.cur; var old = rowOf(i); if (!old || old[0] !== v) changed(i, v, null); }
    flushNow();
    clearInterval(view.poll);
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("pagehide", flushNow);
    view.root.remove();
    document.body.classList.remove("cat-open");
    V = null;
  }

  window.WriterCat = {
    openManager: openManager, newProject: newProject, openProject: openProject,
    isOpen: function () { return !!V; }, close: closeView
  };
})();
