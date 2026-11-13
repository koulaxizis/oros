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
//   - (T2) translation memory: matches under the open segment (100%
//     fills an empty one as a draft), confirmed segments go into the
//     project's memory, repetitions are translated once, concordance,
//     memories with TMX in and out.
//   - (T3) glossaries: terms marked in the source, put in with a tap or
//     Alt+G, checks (terms, forbidden words, numbers, tags, spaces,
//     punctuation, untranslated, inconsistent), CSV and TBX in and out.
// Everything shown from a project goes through textContent (the
// segments are data). Writes go through catstore (own files only).
// window.WriterCatHost (writer.js) is what it may use of Writer.
// Exposes window.WriterCat.
// ============================================================
(function () {
  "use strict";

  var H = window.WriterCatHost, C = window.WriterCatCore, S = window.WriterCatStore, TM = window.WriterCatTM, QA = window.WriterCatQA;
  if (!H || !C || !S || !TM || !QA) return;
  var t = H.t;

  var DEV_KEY = "oros-writer-tr-dev", SUM_KEY = "oros-writer-tr-sum";
  var SAVE_MS = 1200, POLL_MS = 15000, TM_POLL = 4;     // memories: every 4th poll

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
  // [pct, words, name, from, to, source doc, done words, when]: the list's
  // percentages and what the Assistant / orOS Gate read (this device)
  function saveSum(id, st) {
    var o = sums();
    o[id] = [st.pct, st.words, V ? V.nameEl.textContent : "", V ? V.p.from : "", V ? V.p.to : "", V ? V.p.src : "", st.doneWords, Date.now()];
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
      reps: C.repeats(pr.src), chaps: C.chapters(pr.src), same: sameGroups(pr.src),
      tm: { list: [], maps: {}, sigs: {}, index: null, local: {}, localIx: null, write: pr.meta.tm || "", pending: {}, timer: null, polls: 0, ready: false },
      gl: { list: [], maps: {}, sigs: {}, terms: null, write: pr.meta.gl || "", ready: false } };
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
    [["all", "cat.f.all"], ["todo", "cat.f.todo"], ["draft", "cat.f.draft"], ["done", "cat.f.done"], ["rev", "cat.f.rev"], ["tags", "cat.f.qa"]].forEach(function (x) {
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
        { label: t("tm.concord"), action: function () { concord(""); } },
        { label: t("tm.fill100"), action: fill100 },
        { label: t("tm.manage"), action: manageMemories },
        null,
        { label: t("qa.report"), action: qaReport },
        { label: t("gl.add"), action: function () { addTerm(selectedSource()); } },
        { label: t("gl.manage"), action: manageGlossaries },
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
    loadMemories(V);
    loadGlossaries(V);
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
  function paint(box, text, i, terms) {
    box.textContent = "";
    var tags = C.segTags(V.src, i), kinds = tags.map(function (x) { return x.kind; });
    var toks = C.readTags(text, kinds), stack = [box];
    toks.forEach(function (tk) {
      var top = stack[stack.length - 1];
      if (tk.x !== undefined) { addText(top, tk.x, terms); return; }
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
  // text, with the glossary's terms marked (source only)
  function addText(top, txt, terms) {
    var hits = terms ? terms.find(txt) : [], at = 0;
    hits.forEach(function (h) {
      if (h.a > at) top.appendChild(document.createTextNode(txt.slice(at, h.a)));
      var m = el("mark", "cat-term", txt.slice(h.a, h.b));
      m.title = h.e.term + " → " + (h.e.tgt || "—") + (h.e.note ? " · " + h.e.note : "") + (h.e.forb.length ? " · " + fmt("gl.not", { w: h.e.forb.join(", ") }) : "");
      top.appendChild(m);
      at = h.b;
    });
    if (at < txt.length) top.appendChild(document.createTextNode(txt.slice(at)));
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
    r.classList.toggle("cat-bad", problems(i).length > 0);
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
    ta.addEventListener("input", function () { changed(i, ta.value, null); grow(ta); tagHints(); qaSoon(i); });
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
    var gbox = el("div", "cat-gl");
    box.appendChild(gbox);
    var qbox = el("div", "cat-qa");
    qbox.setAttribute("aria-live", "polite");
    box.appendChild(qbox);
    var mbox = el("div", "cat-tm");
    box.appendChild(mbox);
    tg.appendChild(box);
    V.ta = ta;
    V.tagsBox = tagsBox;
    V.tmBox = mbox;
    V.glBox = gbox;
    V.qaBox = qbox;
    tagHints();
    showTerms(i);
    showProblems(i);
    showMatches(i);
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
    V.tmBox = null;
    V.glBox = null;
    V.qaBox = null;
    V.matches = [];
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
      if (k === "K") { e.preventDefault(); concord(selectedSource()); return; }
      if (k === "G") { e.preventDefault(); nextTerm(); return; }
      if (k === "N") { e.preventDefault(); addTerm(selectedSource()); return; }
      var dg = /^Digit([1-3])$/.exec(e.code || "");
      if (dg && V.matches && V.matches[+dg[1] - 1]) { e.preventDefault(); useMatch(V.matches[+dg[1] - 1]); return; }
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
    V.cons = null;
    V.pending[i] = row;
    paintRow(i);
    progress();
    scheduleSave();
  }
  function setStatus(i, st, text) {
    var txt = text !== undefined ? text : (V.cur === i && V.ta ? V.ta.value : (rowOf(i) ? rowOf(i)[0] : ""));
    if (st >= C.ST_DONE && !txt.trim() && text === undefined) { H.toast(t("cat.emptyOk")); return; }
    changed(i, txt, st);
    if (st >= C.ST_DONE && txt.trim()) { remember(i, txt); repeatTo(i, txt); }
  }
  // the same source elsewhere in the book, not started yet: translated once
  function sameGroups(src) {
    var by = {}, out = {};
    src.segs.forEach(function (sg, i) { var k = sg.s.trim(); (by[k] = by[k] || []).push(i); });
    Object.keys(by).forEach(function (k) { if (by[k].length > 1) by[k].forEach(function (i) { out[i] = by[k]; }); });
    return out;
  }
  function repeatTo(i, txt) {
    var g = V.same[i], n = 0;
    if (!g) return;
    g.forEach(function (j) {
      var r = rowOf(j);
      if (j === i || (r && (r[0].trim() || r[1] !== C.ST_NEW))) return;
      changed(j, txt, C.ST_DONE);
      n++;
    });
    if (n) H.toast(fmt("tm.repeated", { n: num(n) }));
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
    if (document.visibilityState === "hidden") { flushNow(); flushTm(V); }
    else poll();
  }
  function poll() {
    if (!V || document.visibilityState === "hidden") return;
    var view = V;
    if (++V.tm.polls % TM_POLL === 0) { pollMemories(view); pollGlossaries(view); }
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
      else if (f === "tags") ok = problems(i).length > 0;
      if (ok && q) ok = fold(C.plainText(V.src, i)).indexOf(q) >= 0 || (row && fold(row[0]).indexOf(q) >= 0);
      V.rowsEl[i].hidden = !ok && i !== V.cur;
      if (ok) shown++;
    });
    V.list.classList.toggle("cat-none", !shown);
  }

  // ---------- translation memory (T2) ----------
  function loadMemories(view) {
    var st = getStore();
    st.listTms().then(function (list) {
      if (V !== view) return;
      view.tm.list = list;
      if (view.tm.write && !list.some(function (m) { return m.id === view.tm.write; })) view.tm.write = "";
      if (!view.tm.write && list.length) view.tm.write = list[0].id;
      return Promise.all(list.map(function (m) {
        return st.loadTm(m.id).then(function (r) { view.tm.maps[m.id] = r.units; view.tm.sigs[m.id] = r.sig; }, function (e) { console.warn("[writer] memory:", e); });
      }));
    }).then(function () {
      if (V !== view) return;
      rebuildIndex(view);
      view.tm.ready = true;
      if (view.cur >= 0) showMatches(view.cur, true);
    }).catch(failed);
  }
  function rebuildIndex(view) {
    var maps = view.tm.list.map(function (m) { return view.tm.maps[m.id] || {}; });
    view.tm.index = new TM.Index(maps, view.p.from, view.p.to);
    view.tm.localIx = new TM.Index([view.tm.local], view.p.from, view.p.to);
  }
  function pollMemories(view) {
    var st = getStore();
    st.listTms().then(function (list) {
      if (V !== view) return;
      var changedAny = list.length !== view.tm.list.length;
      view.tm.list = list;
      return Promise.all(list.map(function (m) {
        return st.tmSig(m.id).then(function (sg) {
          if (sg === view.tm.sigs[m.id]) return;
          changedAny = true;
          return st.loadTm(m.id).then(function (r) { view.tm.maps[m.id] = r.units; view.tm.sigs[m.id] = r.sig; });
        });
      })).then(function () { if (changedAny && V === view) rebuildIndex(view); });
    }).catch(function () {});
  }
  // the best matches for segment i (memory and what was confirmed here)
  function matchesFor(i) {
    var tm = V.tm, q = V.src.segs[i].s, out = [], seen = {};
    [tm.localIx, tm.index].forEach(function (ix) {
      if (!ix) return;
      ix.lookup(q, { max: 3 }).forEach(function (m) { if (!seen[m.key + "|" + m.tgt]) { seen[m.key + "|" + m.tgt] = 1; out.push(m); } });
    });
    out.sort(function (a, b) { return b.score - a.score || b.m - a.m; });
    var tg = {};
    return out.filter(function (m) { if (tg[m.tgt]) return false; tg[m.tgt] = 1; return true; }).slice(0, 3);
  }
  function showMatches(i, late) {
    if (!V || V.cur !== i || !V.tmBox) return;
    var box = V.tmBox;
    box.textContent = "";
    V.matches = [];
    if (!V.tm.ready) { box.appendChild(el("div", "cat-muted", t("tm.loading"))); return; }
    var ms = matchesFor(i);
    V.matches = ms;
    if (!ms.length) return;
    // a 100% match fills an empty segment as a draft (never confirmed)
    var row = rowOf(i);
    if (ms[0].score === 100 && (!row || (!row[0].trim() && row[1] === C.ST_NEW)) && V.ta && !V.ta.value.trim()) {
      V.ta.value = ms[0].tgt;
      changed(i, ms[0].tgt, C.ST_DRAFT);
      grow(V.ta);
      tagHints();
      box.appendChild(el("div", "cat-muted cat-tm-auto", t("tm.auto")));
    }
    ms.forEach(function (m, k) {
      var it = el("div", "cat-tm-item");
      var head = el("div", "cat-tm-head");
      head.appendChild(el("span", "cat-tm-score cat-tm-s" + (m.score === 100 ? "100" : m.score >= 90 ? "90" : "70"), m.score + "%"));
      var src = el("span", "cat-tm-src");
      TM.diff(V.src.segs[i].s, m.src).forEach(function (d) {
        if (d.op === -1) return;
        src.appendChild(d.op === 1 ? el("mark", "cat-dx", d.t) : document.createTextNode(d.t));
      });
      src.setAttribute("lang", V.p.from || "");
      head.appendChild(src);
      it.appendChild(head);
      var tgt = el("div", "cat-tm-tgt");
      tgt.setAttribute("lang", V.p.to || "");
      paint(tgt, m.tgt, i);
      it.appendChild(tgt);
      var use = btn("fb-btn cat-tm-use", t("tm.use"), function () { useMatch(m); }, fmt("tm.useT", { n: k + 1 }));
      use.addEventListener("mousedown", function (e) { e.preventDefault(); });
      it.appendChild(use);
      box.appendChild(it);
    });
  }
  function useMatch(m) {
    if (!V || V.cur < 0 || !V.ta) return;
    V.ta.value = m.tgt;
    changed(V.cur, m.tgt, null);
    grow(V.ta);
    tagHints();
    V.ta.focus();
  }
  // a confirmed segment → the project's memory (saved a moment later)
  function remember(i, txt) {
    var tm = V.tm, src = V.src.segs[i].s, key = TM.keyOf(V.p.from, V.p.to, src);
    if (!key) return;
    var old = tm.local[key] || (tm.write && tm.maps[tm.write] ? tm.maps[tm.write][key] : null);
    if (old && !old[3] && old[1] === txt) return;
    var u = [src, txt, Math.max(Date.now(), old ? old[2] + 1 : 0), 0];
    tm.local[key] = u;
    tm.pending[key] = u;
    tm.localIx = new TM.Index([tm.local], V.p.from, V.p.to);
    clearTimeout(tm.timer);
    var view = V;
    tm.timer = setTimeout(function () { flushTm(view); }, 2000);
  }
  function flushTm(view) {
    if (!view) return Promise.resolve();
    var tm = view.tm, batch = tm.pending, st = getStore();
    clearTimeout(tm.timer);
    if (!Object.keys(batch).length) return Promise.resolve();
    tm.pending = {};
    var idP = tm.write ? Promise.resolve(tm.write) : st.createTm(t("tm.default")).then(function (m) {
      tm.list.push(m);
      tm.maps[m.id] = {};
      tm.write = m.id;
      return st.saveMeta(view.id, { tm: m.id }).then(function () { return m.id; });
    });
    return idP.then(function (id) {
      return st.saveUnits(id, batch).then(function () {
        var map = tm.maps[id] = tm.maps[id] || {};
        Object.keys(batch).forEach(function (k) { map[k] = batch[k]; });
        return st.tmSig(id).then(function (sg) { tm.sigs[id] = sg; });
      });
    }).catch(function (e) {
      Object.keys(batch).forEach(function (k) { if (!tm.pending[k] || tm.pending[k][2] < batch[k][2]) tm.pending[k] = batch[k]; });
      if (V === view) tm.timer = setTimeout(function () { flushTm(view); }, 10000);
      failed(e);
    });
  }
  // every empty segment with a 100% match → a draft
  function fill100() {
    if (!V.tm.ready) { H.toast(t("tm.loading")); return; }
    var n = 0;
    V.src.segs.forEach(function (sg, i) {
      var r = rowOf(i);
      if (i === V.cur || (r && (r[0].trim() || r[1] !== C.ST_NEW))) return;
      var m = matchesFor(i)[0];
      if (m && m.score === 100) { changed(i, m.tgt, C.ST_DRAFT); n++; }
    });
    H.toast(n ? fmt("tm.filled", { n: num(n) }) : t("tm.filledNone"));
  }
  function selectedSource() {
    var sel = window.getSelection && String(window.getSelection() || "").trim();
    if (sel) return sel.slice(0, 200);
    if (V && V.ta && V.ta.selectionEnd > V.ta.selectionStart) return V.ta.value.slice(V.ta.selectionStart, V.ta.selectionEnd).slice(0, 200);
    return "";
  }
  // concordance: where a phrase was translated before
  function concord(q) {
    if (!V) return;
    var view = V;
    var dlg = H.openDialog(t("tm.concord").replace(/…$/, ""), "", [{ class: "fb-btn", label: t("cat.close"), onClick: function () { dlg.close(); } }]);
    dlg.classList.add("cat-dlg");
    var body = dlg.querySelector(".w-dialog-body");
    var inp = el("input", "w-field");
    inp.type = "search";
    inp.placeholder = t("tm.concordQ");
    inp.setAttribute("aria-label", t("tm.concordQ"));
    inp.value = q || "";
    var list = el("div", "cat-conc");
    body.appendChild(inp);
    body.appendChild(list);
    var tmr = null;
    function run() {
      list.textContent = "";
      if (!view.tm.ready) { list.appendChild(el("p", "cat-muted", t("tm.loading"))); return; }
      var v = inp.value.trim();
      if (v.length < 2) return;
      var seen = {}, res = [];
      [view.tm.localIx, view.tm.index].forEach(function (ix) {
        if (ix) ix.concord(v, { limit: 50 }).forEach(function (r) { if (!seen[r.key]) { seen[r.key] = 1; res.push(r); } });
      });
      res.sort(function (a, b) { return b.m - a.m; });
      if (!res.length) { list.appendChild(el("p", "cat-muted", t("tm.concordNone"))); return; }
      res.slice(0, 50).forEach(function (r) {
        var it = el("div", "cat-conc-item");
        var s = el("div", "cat-conc-src", r.src.replace(/\u27E6\/?\d+\/?\u27E7/g, ""));
        s.setAttribute("lang", view.p.from || "");
        var tg = el("div", "cat-conc-tgt", r.tgt.replace(/\u27E6\/?\d+\/?\u27E7/g, ""));
        tg.setAttribute("lang", view.p.to || "");
        it.appendChild(s);
        it.appendChild(tg);
        if (view.cur >= 0) it.appendChild(btn("fb-btn cat-conc-use", t("tm.insert"), function () {
          dlg.close();
          if (V !== view || !V.ta) return;
          var ta = V.ta, a = ta.selectionStart, b = ta.selectionEnd, ins = r.tgt.replace(/\u27E6\/?\d+\/?\u27E7/g, "");
          ta.value = ta.value.slice(0, a) + ins + ta.value.slice(b);
          ta.setSelectionRange(a + ins.length, a + ins.length);
          changed(V.cur, ta.value, null);
          grow(ta);
          tagHints();
          ta.focus();
        }));
        list.appendChild(it);
      });
    }
    inp.addEventListener("input", function () { clearTimeout(tmr); tmr = setTimeout(run, 200); });
    run();
    setTimeout(function () { inp.focus(); }, 0);
  }
  // Translation memories: which one this project writes to, new,
  // rename, TMX in and out, delete
  function manageMemories() {
    if (!V) return;
    var view = V, st = getStore();
    var dlg = H.openDialog(t("tm.manage").replace(/…$/, ""), "", [
      { class: "fb-btn", label: t("cat.close"), onClick: function () { dlg.close(); } },
      { class: "fb-btn primary", label: t("tm.new"), onClick: function () {
        H.wPrompt(t("tm.new"), "").then(function (nm) {
          if (!nm) return;
          st.createTm(nm).then(function (m) { view.tm.list.push(m); view.tm.maps[m.id] = {}; draw(); }, failed);
        });
      } }
    ]);
    dlg.classList.add("cat-dlg");
    var body = dlg.querySelector(".w-dialog-body");
    function draw() {
      body.textContent = "";
      body.appendChild(el("p", "cat-muted", fmt("tm.pairNote", { from: langName(view.p.from), to: langName(view.p.to) })));
      if (!view.tm.list.length) { body.appendChild(el("p", "cat-muted", t("tm.none"))); }
      var ul = el("ul", "cat-plist");
      view.tm.list.forEach(function (m) {
        var li = el("li", "cat-pitem cat-tmitem");
        var lab = el("label", "cat-tmpick");
        var r = el("input");
        r.type = "radio";
        r.name = "cat-tm-write";
        r.checked = view.tm.write === m.id;
        r.addEventListener("change", function () {
          if (!r.checked) return;
          flushTm(view).then(function () {
            view.tm.write = m.id;
            st.saveMeta(view.id, { tm: m.id }).catch(failed);
          });
        });
        lab.appendChild(r);
        var txt = el("span", "cat-tmtext");
        txt.appendChild(el("span", "cat-pname", m.name || t("tm.untitled")));
        var c = TM.count(view.tm.maps[m.id] || {});
        txt.appendChild(el("span", "cat-pmeta", fmt("tm.count", { n: num(c.all) }) + (view.tm.write === m.id ? " · " + t("tm.writes") : "")));
        lab.appendChild(txt);
        li.appendChild(lab);
        var more = btn("tb-btn cat-tmmore", "⋯", function () {
          H.openMenu(more, [
            { label: t("cat.rename"), action: function () {
              H.wPrompt(t("cat.rename"), m.name).then(function (nm) {
                if (!nm) return;
                st.renameTm(m.id, nm).then(function () { m.name = nm; draw(); }, failed);
              });
            } },
            { label: t("tm.import"), action: function () { importTmx(m); } },
            { label: t("tm.export"), action: function () { exportTmx(m); } },
            null,
            { label: t("cat.del"), action: function () {
              H.wConfirm(fmt("tm.delAsk", { name: m.name || t("tm.untitled") }), { danger: true, ok: t("cat.del") }).then(function (yes) {
                if (!yes) return;
                (view.tm.write === m.id ? flushTm(view) : Promise.resolve()).then(function () { return st.trashTm(m.id); }).then(function () {
                  view.tm.list = view.tm.list.filter(function (x) { return x !== m; });
                  delete view.tm.maps[m.id];
                  if (view.tm.write === m.id) { view.tm.write = view.tm.list.length ? view.tm.list[0].id : ""; if (view.tm.write) st.saveMeta(view.id, { tm: view.tm.write }).catch(failed); }
                  rebuildIndex(view);
                  H.toast(t("cat.deleted"));
                  draw();
                }, failed);
              });
            } }
          ]);
        }, t("cat.more"));
        more.setAttribute("aria-haspopup", "menu");
        li.appendChild(more);
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }
    function importTmx(m) {
      H.openFile(".tmx,.xml").then(function (f) {
        if (!f) return;
        if (f.size > 64 * 1024 * 1024) { H.toast(t("tm.tooBig")); return; }
        H.toast(t("cat.loading"));
        return f.text().then(function (text) {
          var r = TM.parseTmx(text);
          if (r.err) { H.toast(t("tm.badTmx")); return; }
          var cur = view.tm.maps[m.id] || {}, add = {}, n = 0;
          r.units.forEach(function (u) {
            var k = TM.keyOf(u.from, u.to, u.src);
            if (!k) return;
            var old = cur[k] || add[k];
            if (old && old[2] >= u.m) return;        // a newer one here stays
            add[k] = [u.src, u.tgt, u.m, 0];
            n++;
          });
          return st.saveUnits(m.id, add).then(function () {
            Object.keys(add).forEach(function (k) { cur[k] = add[k]; });
            view.tm.maps[m.id] = cur;
            return st.tmSig(m.id).then(function (sg) { view.tm.sigs[m.id] = sg; });
          }).then(function () {
            rebuildIndex(view);
            H.toast(fmt("tm.imported", { n: num(n), s: num(r.skipped + (r.units.length - n)) }));
            draw();
            if (V === view && view.cur >= 0) showMatches(view.cur);
          });
        });
      }).catch(failed);
    }
    function exportTmx(m) {
      flushTm(view).then(function () {
        var units = TM.unitsOf(view.tm.maps[m.id] || {});
        if (!units.length) { H.toast(t("tm.emptyMem")); return; }
        var nm = String(m.name || "memory").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 80) || "memory";
        return H.saveText(TM.tmx(units, { name: m.name }), nm + ".tmx", "application/x-tmx+xml");
      }).catch(failed);
    }
    draw();
  }

  // ---------- glossary and checks (T3) ----------
  function loadGlossaries(view) {
    var st = getStore();
    st.listGls().then(function (list) {
      if (V !== view) return;
      view.gl.list = list;
      if (view.gl.write && !list.some(function (g) { return g.id === view.gl.write; })) view.gl.write = "";
      if (!view.gl.write && list.length) view.gl.write = list[0].id;
      return Promise.all(list.map(function (g) {
        return st.loadGl(g.id).then(function (r) { view.gl.maps[g.id] = r.entries; view.gl.sigs[g.id] = r.sig; }, function (e) { console.warn("[writer] glossary:", e); });
      }));
    }).then(function () {
      if (V !== view) return;
      view.gl.ready = true;
      rebuildTerms(view);
    }).catch(failed);
  }
  function rebuildTerms(view) {
    var maps = view.gl.list.map(function (g) { return view.gl.maps[g.id] || {}; });
    view.gl.terms = new QA.Terms(maps, view.p.from, view.p.to);
    view.cons = null;
    // the source again, with the terms marked; the rows' checks too
    view.src.segs.forEach(function (sg, i) {
      var r = view.rowsEl[i];
      if (!r) return;
      paint(r.children[1], sg.s, i, view.gl.terms.size ? view.gl.terms : null);
      paintRow(i);
    });
    if (view.cur >= 0) { showTerms(view.cur); showProblems(view.cur); }
  }
  function pollGlossaries(view) {
    var st = getStore();
    st.listGls().then(function (list) {
      if (V !== view) return;
      var any = list.length !== view.gl.list.length;
      view.gl.list = list;
      return Promise.all(list.map(function (g) {
        return st.glSig(g.id).then(function (sg) {
          if (sg === view.gl.sigs[g.id]) return;
          any = true;
          return st.loadGl(g.id).then(function (r) { view.gl.maps[g.id] = r.entries; view.gl.sigs[g.id] = r.sig; });
        });
      })).then(function () { if (any && V === view) rebuildTerms(view); });
    }).catch(function () {});
  }
  // the checks of segment i (QA.check, and another translation of the same source)
  function problems(i) {
    if (!V) return [];
    var l = QA.check(V.src, V.rows, i, V.gl.terms && V.gl.terms.size ? V.gl.terms : null, { from: V.p.from, to: V.p.to });
    if (!V.cons) V.cons = QA.inconsistent(V.src, V.rows);
    if (V.cons[i] !== undefined) l.push({ k: "cons", a: String(V.cons[i] + 1) });
    return l;
  }
  function problemText(p) {
    var none = p.k === "punct" ? "—" : "";
    return fmt("qa." + p.k, { a: p.a || none, b: p.b || none });
  }
  var qaT = null;
  function qaSoon(i) { clearTimeout(qaT); qaT = setTimeout(function () { if (V && V.cur === i) { V.cons = null; showProblems(i); } }, 400); }
  function showProblems(i) {
    if (!V || V.cur !== i || !V.qaBox) return;
    var box = V.qaBox, l = problems(i);
    box.textContent = "";
    l.forEach(function (p) { box.appendChild(el("div", "cat-qa-item", "⚠ " + problemText(p))); });
  }
  function termsOf(i) {
    var tr = V.gl.terms;
    return tr && tr.size ? tr.find(C.plainText(V.src, i)) : [];
  }
  function showTerms(i) {
    if (!V || V.cur !== i || !V.glBox) return;
    var box = V.glBox, hits = termsOf(i), seen = {};
    box.textContent = "";
    hits.forEach(function (h) {
      if (seen[h.e.key]) return;
      seen[h.e.key] = 1;
      var b = btn("cat-glbtn", "", function () { insertText(h.e.tgt || h.e.term, true); }, fmt("gl.insT", { t: h.e.tgt || h.e.term }));
      b.appendChild(el("span", "cat-gl-src", h.e.term));
      b.appendChild(document.createTextNode(" → "));
      b.appendChild(el("span", "cat-gl-tgt", h.e.tgt || "—"));
      if (h.e.note || h.e.forb.length) b.title += " · " + [h.e.note, h.e.forb.length ? fmt("gl.not", { w: h.e.forb.join(", ") }) : ""].filter(Boolean).join(" · ");
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });
      box.appendChild(b);
    });
  }
  function insertText(txt, word) {
    if (!V || !V.ta || !txt) return;
    var ta = V.ta, a = ta.selectionStart, b = ta.selectionEnd;
    // a term put in next to a word gets a space between
    if (word) {
      if (a > 0 && /[\p{L}\p{N}]/u.test(ta.value.charAt(a - 1))) txt = " " + txt;
      if (/^[\p{L}\p{N}]/u.test(ta.value.charAt(b))) txt += " ";
    }
    ta.value = ta.value.slice(0, a) + txt + ta.value.slice(b);
    ta.setSelectionRange(a + txt.length, a + txt.length);
    changed(V.cur, ta.value, null);
    grow(ta);
    tagHints();
    qaSoon(V.cur);
    ta.focus();
  }
  // Alt+G: the next term of this segment whose translation is not in yet
  function nextTerm() {
    if (!V || V.cur < 0 || !V.ta) return;
    var tr = V.gl.terms, hits = termsOf(V.cur);
    for (var k = 0; k < hits.length; k++) {
      var e = hits[k].e;
      if (e.tgt && !tr.has(V.ta.value, e.tw)) { insertText(e.tgt, true); return; }
    }
  }
  function glWrite(view) {
    var st = getStore();
    if (view.gl.write) return Promise.resolve(view.gl.write);
    return st.createGl(t("gl.default")).then(function (g) {
      view.gl.list.push(g);
      view.gl.maps[g.id] = {};
      view.gl.write = g.id;
      return st.saveMeta(view.id, { gl: g.id }).then(function () { return g.id; });
    });
  }
  // one term: new, or an entry to change (e) of glossary id
  function addTerm(term, e, id) {
    if (!V) return;
    var view = V, st = getStore();
    var dlg = H.openDialog(e ? t("gl.edit") : t("gl.add").replace(/…$/, ""), "", [
      { class: "fb-btn", label: t("wx.cancel"), onClick: function () { dlg.close(); } },
      { class: "fb-btn primary", label: t("gl.save"), onClick: save }
    ]);
    dlg.classList.add("cat-dlg");
    var body = dlg.querySelector(".w-dialog-body"), f = el("div", "cat-form");
    function field(label, value, area) {
      var l = el("label", "cat-frow");
      l.appendChild(el("span", "cat-flabel", label));
      var c = el(area ? "textarea" : "input", "w-field");
      if (!area) c.type = "text";
      c.value = value || "";
      c.maxLength = area ? 2000 : 300;
      l.appendChild(c);
      f.appendChild(l);
      return c;
    }
    var a = field(fmt("gl.term", { l: langName(view.p.from) }), e ? e.term : term);
    a.setAttribute("lang", view.p.from || "");
    var b = field(fmt("gl.tgt", { l: langName(view.p.to) }), e ? e.tgt : "");
    b.setAttribute("lang", view.p.to || "");
    var n = field(t("gl.note"), e ? e.note : "", true);
    var x = field(t("gl.forb"), e ? e.forb.join("; ") : "");
    x.setAttribute("lang", view.p.to || "");
    body.appendChild(f);
    setTimeout(function () { (a.value ? b : a).focus(); }, 0);
    function save() {
      var term = a.value.trim();
      if (!term) { H.toast(t("gl.needTerm")); return; }
      var key = QA.keyOf(view.p.from, view.p.to, term);
      (id ? Promise.resolve(id) : glWrite(view)).then(function (gid) {
        var map = view.gl.maps[gid] = view.gl.maps[gid] || {}, ch = {}, now = Date.now();
        var stamp = function (k) { return Math.max(now, map[k] ? map[k][4] + 1 : 0); };
        // renamed: the old term goes (a deletion that syncs)
        if (e && e.key !== key) ch[e.key] = [e.term, "", "", "", stamp(e.key), 1];
        ch[key] = [term, b.value.trim(), n.value.trim(), x.value, stamp(key), 0];
        return st.saveEntries(gid, ch).then(function () {
          Object.keys(ch).forEach(function (k) { map[k] = QA.cleanEntry(ch[k]); });
          return st.glSig(gid).then(function (sg) { view.gl.sigs[gid] = sg; });
        });
      }).then(function () {
        dlg.close();
        if (V === view) rebuildTerms(view);
        H.toast(t("gl.saved"));
      }).catch(failed);
    }
  }
  // the whole book's checks, each with a Go button
  function qaReport() {
    if (!V) return;
    var view = V;
    if (view.ta) { var o = rowOf(view.cur); if (!o || o[0] !== view.ta.value) changed(view.cur, view.ta.value, null); }
    view.cons = null;
    var all = QA.checkAll(view.src, view.rows, view.gl.terms && view.gl.terms.size ? view.gl.terms : null, { from: view.p.from, to: view.p.to });
    var dlg = H.openDialog(t("qa.report").replace(/…$/, ""), "", [{ class: "fb-btn", label: t("cat.close"), onClick: function () { dlg.close(); } }]);
    dlg.classList.add("cat-dlg");
    var body = dlg.querySelector(".w-dialog-body");
    var n = all.reduce(function (s, x) { return s + x.list.length; }, 0);
    body.appendChild(el("p", "cat-muted", n ? fmt("qa.count", { n: num(n), s: num(all.length) }) : t("qa.clean")));
    var list = el("div", "cat-conc");
    all.slice(0, 500).forEach(function (x) {
      var it = el("div", "cat-conc-item");
      var s = el("div", "cat-conc-src", fmt("cat.segN", { n: x.i + 1 }) + " · " + C.plainText(view.src, x.i).slice(0, 120));
      var p = el("div", "cat-conc-tgt", x.list.map(problemText).join(" · "));
      it.appendChild(s);
      it.appendChild(p);
      it.appendChild(btn("fb-btn cat-conc-use", t("qa.go"), function () {
        dlg.close();
        if (V !== view) return;
        if (view.rowsEl[x.i].hidden) { view.filter = "all"; view.root.querySelector(".cat-filter").value = "all"; applyFilter(); }
        focusRow(x.i);
      }));
      list.appendChild(it);
    });
    body.appendChild(list);
  }
  // Glossaries: which one new terms go into, the terms, CSV/TBX, delete
  function manageGlossaries() {
    if (!V) return;
    var view = V, st = getStore();
    var dlg = H.openDialog(t("gl.manage").replace(/…$/, ""), "", [
      { class: "fb-btn", label: t("cat.close"), onClick: function () { dlg.close(); } },
      { class: "fb-btn primary", label: t("gl.new"), onClick: function () {
        H.wPrompt(t("gl.new"), "").then(function (nm) {
          if (!nm) return;
          st.createGl(nm).then(function (g) { view.gl.list.push(g); view.gl.maps[g.id] = {}; draw(); }, failed);
        });
      } }
    ]);
    dlg.classList.add("cat-dlg");
    var body = dlg.querySelector(".w-dialog-body");
    function draw() {
      body.textContent = "";
      body.appendChild(el("p", "cat-muted", fmt("gl.pairNote", { from: langName(view.p.from), to: langName(view.p.to) })));
      if (!view.gl.list.length) body.appendChild(el("p", "cat-muted", t("gl.none")));
      var ul = el("ul", "cat-plist");
      view.gl.list.forEach(function (g) {
        var li = el("li", "cat-pitem cat-tmitem");
        var lab = el("label", "cat-tmpick");
        var r = el("input");
        r.type = "radio";
        r.name = "cat-gl-write";
        r.checked = view.gl.write === g.id;
        r.addEventListener("change", function () { if (r.checked) { view.gl.write = g.id; st.saveMeta(view.id, { gl: g.id }).catch(failed); draw(); } });
        lab.appendChild(r);
        var txt = el("span", "cat-tmtext");
        txt.appendChild(el("span", "cat-pname", g.name || t("gl.untitled")));
        var cnt = QA.listOf(view.gl.maps[g.id] || {}, view.p.from, view.p.to).length;
        txt.appendChild(el("span", "cat-pmeta", fmt("gl.count", { n: num(cnt) }) + (view.gl.write === g.id ? " · " + t("gl.writes") : "")));
        lab.appendChild(txt);
        li.appendChild(lab);
        var more = btn("tb-btn cat-tmmore", "⋯", function () {
          H.openMenu(more, [
            { label: t("gl.terms"), action: function () { dlg.close(); termsList(g); } },
            { label: t("cat.rename"), action: function () {
              H.wPrompt(t("cat.rename"), g.name).then(function (nm) { if (nm) st.renameGl(g.id, nm).then(function () { g.name = nm; draw(); }, failed); });
            } },
            { label: t("gl.import"), action: function () { importGl(g); } },
            { label: t("gl.exportCsv"), action: function () { exportGl(g, "csv"); } },
            { label: t("gl.exportTbx"), action: function () { exportGl(g, "tbx"); } },
            null,
            { label: t("cat.del"), action: function () {
              H.wConfirm(fmt("gl.delAsk", { name: g.name || t("gl.untitled") }), { danger: true, ok: t("cat.del") }).then(function (yes) {
                if (!yes) return;
                st.trashGl(g.id).then(function () {
                  view.gl.list = view.gl.list.filter(function (x) { return x !== g; });
                  delete view.gl.maps[g.id];
                  if (view.gl.write === g.id) { view.gl.write = view.gl.list.length ? view.gl.list[0].id : ""; if (view.gl.write) st.saveMeta(view.id, { gl: view.gl.write }).catch(failed); }
                  rebuildTerms(view);
                  H.toast(t("cat.deleted"));
                  draw();
                }, failed);
              });
            } }
          ]);
        }, t("cat.more"));
        more.setAttribute("aria-haspopup", "menu");
        li.appendChild(more);
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }
    function importGl(g) {
      H.openFile(".csv,.tsv,.txt,.tbx,.xml").then(function (f) {
        if (!f) return;
        if (f.size > QA.MAX_FILE) { H.toast(t("gl.tooBig")); return; }
        return f.text().then(function (text) {
          var isX = /\.(tbx|xml)$/i.test(f.name) || /^\s*(\uFEFF)?</.test(text);
          var r = isX ? QA.parseTbx(text, view.p.from, view.p.to) : QA.parseCsv(text, view.p.from, view.p.to);
          if (r.err) { H.toast(t("gl.bad")); return; }
          var map = view.gl.maps[g.id] = view.gl.maps[g.id] || {}, ch = {}, now = Date.now(), n = 0;
          r.entries.forEach(function (e) {
            var k = QA.keyOf(view.p.from, view.p.to, e.term);
            if (!k) return;
            ch[k] = [e.term, e.tgt, e.note, e.forb.join("; "), Math.max(now, map[k] ? map[k][4] + 1 : 0), 0];
            n++;
          });
          return st.saveEntries(g.id, ch).then(function () {
            Object.keys(ch).forEach(function (k) { map[k] = QA.cleanEntry(ch[k]); });
            return st.glSig(g.id).then(function (sg) { view.gl.sigs[g.id] = sg; });
          }).then(function () {
            rebuildTerms(view);
            H.toast(fmt("gl.imported", { n: num(n), s: num(r.skipped) }));
            draw();
          });
        });
      }).catch(failed);
    }
    function exportGl(g, kind) {
      var list = QA.listOf(view.gl.maps[g.id] || {}, view.p.from, view.p.to);
      if (!list.length) { H.toast(t("gl.empty")); return; }
      var nm = String(g.name || "glossary").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 80) || "glossary";
      if (kind === "csv") H.saveText(QA.csv(list, view.p.from, view.p.to), nm + ".csv", "text/csv");
      else H.saveText(QA.tbx(list, view.p.from, view.p.to), nm + ".tbx", "application/x-tbx+xml");
    }
    draw();
  }
  // a glossary's terms: search, change, delete
  function termsList(g) {
    if (!V) return;
    var view = V, st = getStore();
    var dlg = H.openDialog(g.name || t("gl.untitled"), "", [
      { class: "fb-btn", label: t("cat.close"), onClick: function () { dlg.close(); } },
      { class: "fb-btn primary", label: t("gl.add").replace(/…$/, ""), onClick: function () { dlg.close(); addTerm("", null, g.id); } }
    ]);
    dlg.classList.add("cat-dlg");
    var body = dlg.querySelector(".w-dialog-body");
    var q = el("input", "w-field");
    q.type = "search";
    q.placeholder = t("gl.search");
    q.setAttribute("aria-label", t("gl.search"));
    var list = el("div", "cat-conc");
    body.appendChild(q);
    body.appendChild(list);
    function draw() {
      list.textContent = "";
      var f = TM.fold(q.value.trim()), all = QA.listOf(view.gl.maps[g.id] || {}, view.p.from, view.p.to);
      var shown = all.filter(function (e) { return !f || TM.fold(e.term).indexOf(f) >= 0 || TM.fold(e.tgt).indexOf(f) >= 0; });
      if (!shown.length) { list.appendChild(el("p", "cat-muted", t("gl.noTerms"))); return; }
      shown.slice(0, 300).forEach(function (e) {
        var it = el("div", "cat-conc-item");
        it.appendChild(el("div", "cat-conc-src", e.term + (e.note ? " · " + e.note : "")));
        it.appendChild(el("div", "cat-conc-tgt", (e.tgt || "—") + (e.forb.length ? " · " + fmt("gl.not", { w: e.forb.join(", ") }) : "")));
        var bx = el("div", "cat-conc-use cat-gl-acts");
        bx.appendChild(btn("fb-btn", t("gl.edit"), function () { dlg.close(); addTerm("", e, g.id); }));
        bx.appendChild(btn("tb-btn", "×", function () {
          var map = view.gl.maps[g.id], ch = {};
          ch[e.key] = [e.term, "", "", "", Math.max(Date.now(), e.m + 1), 1];
          st.saveEntries(g.id, ch).then(function () {
            map[e.key] = QA.cleanEntry(ch[e.key]);
            rebuildTerms(view);
            draw();
          }, failed);
        }, t("cat.del")));
        it.appendChild(bx);
        list.appendChild(it);
      });
    }
    q.addEventListener("input", draw);
    draw();
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
    flushTm(view);
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
