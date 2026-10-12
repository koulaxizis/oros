// ============================================================
// orOS Library — the reading screen (v1.0.0)
// One screen for both formats; the engine (epub.js or pdfview.js)
// draws the book inside #rd-stage and reports back through ctx:
//   onMove(here)          the place changed: { loc, pct, label, sub, text }
//   onSelect(rect|null)   text selected (rect in app coordinates)
//   onMarkTap(id, rect)   a highlight was tapped
//   onTap(zone)           "prev" | "next" | "menu" (tap zones)
//   onLink(url)           an outside link (asked before opening)
//   onNote(text, rect)    a footnote to show in a popup
//   onKey(e)              keys pressed inside the book frame
// Engine: open(bytes, loc) → Promise({ toc }), go(loc, flash?),
//   goToc(entry), goPct(pct), next(), prev(), here(), visible(loc),
//   selection() → { loc, end, q, pre, suf, label } | null, clearSel(),
//   paint(marks), search(q, onHit, isLive) → Promise(count),
//   applyPrefs(prefs), labelOf(loc), resize(), destroy().
// The place read is saved (LIB.setPos) 3 s after it settles, when
// the app hides and when the book closes; never on a mere repaint.
// ============================================================
(function () {
  "use strict";

  var LIB = window.LIB, C = LIB.C, t = LIB.t, el = LIB.el, $ = LIB.$, UI = LIB.UI;
  var SAVE_MS = 3000;
  var cur = null;        // { book, path, engine, toc, here, saveTimer, gen, panel }
  var gen = 0;

  function build() {
    $("rd-back").innerHTML = UI.back;
    label($("rd-back"), t("rd.back"));
    $("rd-back").addEventListener("click", function () { close(false); });
    [["rd-search", UI.search, "rd.search", function () { panel("search"); }],
     ["rd-toc", UI.toc, "rd.toc", function () { panel("toc"); }],
     ["rd-notes", UI.notes, "rd.notes", function () { panel("notes"); }],
     ["rd-aa", UI.aa, "rd.settings", settings],
     ["rd-bm", UI.bookmark, "rd.bookmark", toggleBookmark]].forEach(function (d) {
      var b = $(d[0]);
      b.innerHTML = d[1];
      label(b, t(d[2]));
      b.addEventListener("click", d[3]);
    });
    $("rd-speak").innerHTML = UI.speak;
    label($("rd-speak"), t("speak.start"));
    $("rd-speak").addEventListener("click", function () { LIB.speak.toggle(); });
    $("rd-prev").innerHTML = UI.back;
    label($("rd-prev"), t("rd.prev"));
    $("rd-prev").addEventListener("click", function () { if (cur) cur.engine.prev(); });
    $("rd-next").innerHTML = UI.next;
    label($("rd-next"), t("rd.next"));
    $("rd-next").addEventListener("click", function () { if (cur) cur.engine.next(); });
    var sl = $("rd-slider");
    sl.setAttribute("aria-label", t("rd.slider"));
    sl.addEventListener("input", function () {
      $("rd-pct").textContent = t("book.pct", { p: Math.floor(sl.value / 10) });
    });
    sl.addEventListener("change", function () { if (cur) cur.engine.goPct(+sl.value); });
    $("panel-close").innerHTML = UI.close;
    label($("panel-close"), t("btn.close"));
    $("panel-close").addEventListener("click", function () { panel(null); });
    [].forEach.call(document.querySelectorAll("#panel-tabs [data-tab]"), function (b) {
      b.textContent = t("tab." + b.getAttribute("data-tab"));
      b.addEventListener("click", function () { panel(b.getAttribute("data-tab")); });
    });
    $("ps-q").placeholder = t("rd.searchPh");
    $("ps-q").setAttribute("aria-label", t("rd.searchPh"));
    $("ps-form").addEventListener("submit", function (e) { e.preventDefault(); runSearch(); });
    $("ps-go").textContent = t("rd.searchGo");
    window.addEventListener("resize", function () { if (cur) { hideSel(); cur.engine.resize(); } });
    document.addEventListener("keydown", onKey);
  }
  function label(b, s) { b.setAttribute("aria-label", s); b.title = s; }

  // ---------- Open / close ----------
  function open(book, path, loc) {
    if (cur) close(true);
    var my = ++gen;
    LIB.busy(true, t("busy.opening"));
    LIB.store.readBytes(path).then(function (bytes) {
      if (my !== gen) return null;
      var factory = book.fmt === "pdf" ? LIB.pdfEngine : LIB.epubEngine;
      var stage = $("rd-stage");
      stage.textContent = "";
      stage.className = "rd-stage fmt-" + book.fmt + (book.kind ? " kind-" + book.kind : "");
      var c = { book: book, path: path, toc: [], here: null, saveTimer: null, gen: my, panel: null, searchQ: "" };
      cur = c;
      c.engine = factory.create(stage, ctxFor(c));
      $("home").hidden = true;
      $("reader").hidden = false;
      document.body.classList.add("reading");
      $("rd-title").textContent = book.title;
      var saved = LIB.data.pos[book.id] && LIB.data.pos[book.id].loc;
      var start = loc || saved || null;
      c.keep = saved && (!loc || loc === saved) ? saved : null;
      return c.engine.open(bytes, start, C.kindOf(path), path).then(function (info) {
        if (cur !== c) return;
        c.toc = info && info.toc || [];
        // books added before page estimates: fill them in once
        if (info && info.pages && !book.pages && book.fmt === "epub") {
          c.book = LIB.putBook({ id: book.id, pages: info.pages }) || c.book;
        }
        c.ready = true;
        c.engine.applyPrefs(LIB.prefs);
        c.engine.paint(LIB.marksOf(book.id));
        LIB.busy(false);
        if (window.innerWidth >= 1100 && !c.panel && LIB.prefs.panelOpen) panel(LIB.prefs.panelOpen);
        $("rd-stage").focus({ preventScroll: true });
      });
    }).catch(function (e) {
      LIB.busy(false);
      if (my !== gen) return;
      if (cur && cur.gen === my) close(true);
      LIB.toast(t(e && e.message === "drm" ? "msg.drm" : "msg.openFail"));
    });
  }
  function close(quiet) {
    if (!cur) return;
    LIB.speak.stop(true);
    speakChanged(false);
    flush();
    flushTime(true);
    hideSel();
    hidePop();
    var c = cur;
    cur = null;
    try { c.engine.destroy(); } catch (e) {}
    $("rd-stage").textContent = "";
    $("reader").hidden = true;
    $("home").hidden = false;
    document.body.classList.remove("reading", "bare");
    panel(null, true);
    if (!quiet) LIB.home.refresh();
  }

  // ---------- Engine callbacks ----------
  function ctxFor(c) {
    return {
      t: t,
      prefs: function () { return LIB.prefs; },
      palette: LIB.palette,
      onMove: function (h) {
        if (cur !== c || !h) return;
        c.here = h;
        touched();
        if (c.keep && c.ready && !keptVisible(c)) c.keep = null;
        bars();
        hidePop();
        clearTimeout(c.saveTimer);
        c.saveTimer = setTimeout(flush, SAVE_MS);
        if (h.pct >= 999 && !c.book.fin && !c.askedFin) {
          c.askedFin = true;
          LIB.actionToast(t("rd.endReached"), t("rd.markFinished"), function () {
            LIB.putBook({ id: c.book.id, fin: ymd(new Date()) });
            c.book = LIB.book(c.book.id) || c.book;
          });
        }
      },
      onSelect: function (rect) { if (cur === c) { touched(); if (rect) showSel(rect); else hideSel(); } },
      onMarkTap: function (id, rect) { if (cur === c) markPop(id, rect); },
      onTap: function (zone) {
        if (cur !== c) return;
        touched();
        if (zone === "next") c.engine.next();
        else if (zone === "prev") c.engine.prev();
        else document.body.classList.toggle("bare");
      },
      onLink: function (url) { outsideLink(url); },
      onNote: function (text, rect) { notePop(text, rect); },
      onKey: function (e) { onKey(e); }
    };
  }
  function ymd(d) {
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  // While the saved place is still on screen (just opened, or only the
  // layout changed) it is kept: another device's screen starts its page
  // elsewhere, and re-saving that would move the place for nothing.
  function flush() {
    if (!cur || !cur.here) return;
    clearTimeout(cur.saveTimer);
    cur.saveTimer = null;
    if (cur.keep && keptVisible(cur)) return;
    cur.keep = null;
    LIB.setPos(cur.book.id, cur.here.loc, cur.here.pct);
  }
  // ---------- Reading time (stats.js shows it) ----------
  // Every 15 s with the book on screen counts, while you turn pages,
  // select, press keys or listen; five minutes with none of that and
  // the clock stops until the next one. Saved once a minute and when
  // the book closes or orOS hides.
  var TICK = 15, IDLE_MS = 5 * 60000, lastAct = 0;
  function touched() { lastAct = Date.now(); }
  function tick() {
    if (!cur || !cur.ready || document.visibilityState !== "visible") return;
    if (Date.now() - lastAct > IDLE_MS && !LIB.speak.playing()) return;
    cur.secs = (cur.secs || 0) + TICK;
    if (cur.secs >= 60) flushTime(true);
  }
  function flushTime(force) {
    if (!cur || !cur.secs || (!force && cur.secs < 60)) return;
    var s = cur.secs;
    cur.secs = 0;
    LIB.addReading(cur.book.id, s);
  }
  setInterval(tick, TICK * 1000);

  function keptVisible(c) {
    try { return !!c.engine.visible(c.keep); } catch (e) { return false; }
  }

  function bars() {
    var h = cur && cur.here;
    if (!h) return;
    $("rd-sub").textContent = h.label || "";
    $("rd-where").textContent = h.sub || "";
    $("rd-slider").value = h.pct;
    $("rd-pct").textContent = t("book.pct", { p: Math.floor(h.pct / 10) });
    var bm = currentBookmark();
    $("rd-bm").innerHTML = bm ? UI.bookmarkOn : UI.bookmark;
    $("rd-bm").classList.toggle("on", !!bm);
    label($("rd-bm"), t(bm ? "rd.unbookmark" : "rd.bookmark"));
    if (cur.panel === "toc") markToc();
  }

  // ---------- Bookmarks ----------
  function currentBookmark() {
    if (!cur) return null;
    var list = LIB.marksOf(cur.book.id).filter(function (k) { return k.k === "bm"; });
    for (var i = 0; i < list.length; i++) if (cur.engine.visible(list[i].loc)) return list[i];
    return null;
  }
  function toggleBookmark() {
    if (!cur || !cur.here) return;
    var bm = currentBookmark();
    if (bm) { LIB.delMark(bm.id); bars(); return; }
    var h = cur.here;
    LIB.putMark({ b: cur.book.id, k: "bm", loc: h.loc, q: C.squash(h.text || "").slice(0, 160).trim(), lbl: h.label || "", pct: h.pct });
    LIB.toast(t("msg.bmAdded"));
    bars();
    if (cur.panel === "notes") renderNotes();
  }

  // ---------- Selection → highlight ----------
  function showSel(rect) {
    hidePop();
    var pop = $("sel-pop");
    pop.textContent = "";
    for (var c = 0; c < C.NCOLORS; c++) (function (c) {
      var b = LIB.btn("swatch c" + c, t("hl.color", { name: C.COLOR_NAMES[LIB.LANG][c] }), "", function () { highlight(c, false); });
      pop.appendChild(b);
    })(c);
    pop.appendChild(LIB.btn("icon-btn", t("hl.note"), UI.note, function () { highlight(0, true); }));
    pop.appendChild(LIB.btn("icon-btn", t("hl.copy"), UI.copy, function () {
      var s = cur && cur.engine.selection();
      if (s) LIB.copyText(s.q);
      cur.engine.clearSel();
      hideSel();
    }));
    pop.appendChild(LIB.btn("icon-btn", t("look.title"), UI.dict, function () {
      var s = cur && cur.engine.selection();
      cur.engine.clearSel();
      hideSel();
      if (s) {
        try { s.sent = cur.engine.sentenceAt(s.loc, s.end); } catch (e) { s.sent = ""; }
        LIB.lookup.open(s, cur.book, cur.here ? cur.here.pct : 0);
      }
    }));
    pop.appendChild(LIB.btn("icon-btn", t("hl.find"), UI.search, function () {
      var s = cur && cur.engine.selection();
      cur.engine.clearSel();
      hideSel();
      if (s) { $("ps-q").value = C.squash(s.q).slice(0, 80); panel("search"); runSearch(); }
    }));
    place(pop, rect);
  }
  function hideSel() { var p = $("sel-pop"); if (p) p.hidden = true; }
  function place(pop, rect) {
    pop.hidden = false;
    var W = window.innerWidth, H = window.innerHeight;
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var x = Math.max(8, Math.min(W - w - 8, rect.left + rect.width / 2 - w / 2));
    var y = rect.top - h - 10;
    if (y < 56) y = Math.min(H - h - 8, rect.bottom + 10);
    pop.style.left = Math.round(x) + "px";
    pop.style.top = Math.round(y) + "px";
  }
  function highlight(color, withNote) {
    if (!cur) return;
    var s = cur.engine.selection();
    hideSel();
    if (!s) return;
    var k = LIB.putMark({ b: cur.book.id, k: "hl", loc: s.loc, end: s.end, q: s.q, pre: s.pre, suf: s.suf, c: color,
                          lbl: s.label || "", pct: cur.here ? cur.here.pct : 0 });
    cur.engine.clearSel();
    marksChanged();
    if (!k) { LIB.toast(t("msg.hlFail")); return; }
    if (withNote) noteDialog(k.id);
  }

  // A tapped highlight: colour, note, copy, delete.
  function markPop(id, rect) {
    var k = LIB.mark(id);
    if (!k) return;
    hideSel();
    var pop = $("mark-pop");
    pop.textContent = "";
    for (var c = 0; c < C.NCOLORS; c++) (function (c) {
      var b = LIB.btn("swatch c" + c + (k.c === c ? " on" : ""), t("hl.color", { name: C.COLOR_NAMES[LIB.LANG][c] }), "", function () {
        hidePop();
        LIB.putMark({ id: id, c: c });
        marksChanged();
      });
      pop.appendChild(b);
    })(c);
    pop.appendChild(LIB.btn("icon-btn", t(k.n ? "hl.editNote" : "hl.note"), UI.note, function () { hidePop(); noteDialog(id); }));
    pop.appendChild(LIB.btn("icon-btn", t("hl.copy"), UI.copy, function () { hidePop(); LIB.copyText(k.q || ""); }));
    pop.appendChild(LIB.btn("icon-btn danger", t("hl.delete"), UI.trash, function () { hidePop(); LIB.delMark(id); }));
    if (k.n) {
      var n = el("p", "pop-note", k.n);
      pop.appendChild(n);
    }
    place(pop, rect);
  }
  function hidePop() {
    var p = $("mark-pop");
    if (p) p.hidden = true;
    var f = $("fn-pop");
    if (f) f.hidden = true;
  }
  function notePop(text, rect) {
    hideSel();
    var pop = $("fn-pop");
    pop.textContent = "";
    pop.appendChild(el("p", "", C.squash(text).slice(0, 3000)));
    pop.appendChild(LIB.btn("icon-btn fn-close", t("btn.close"), UI.close, hidePop));
    place(pop, rect);
  }
  function noteDialog(id) {
    var k = LIB.mark(id);
    if (!k) return;
    var dlg = LIB.dialog("lb-note", t(k.k === "bm" ? "note.bmTitle" : "note.title"), "small");
    if (k.q) dlg.appendChild(el("blockquote", "note-quote", C.squash(k.q).slice(0, 400)));
    var ta = el("textarea", "note-text");
    ta.maxLength = C.NOTE_LEN;
    ta.rows = 6;
    ta.value = k.n || "";
    ta.placeholder = t("note.ph");
    ta.setAttribute("aria-label", t("note.title"));
    dlg.appendChild(ta);
    var acts = el("div", "dlg-actions");
    acts.appendChild(LIB.textBtn("btn", t("btn.cancel"), function () { dlg.close(); }));
    acts.appendChild(LIB.textBtn("btn primary", t("btn.save"), function () {
      var v = ta.value.slice(0, C.NOTE_LEN);
      if ((k.n || "") !== v) { LIB.putMark({ id: id, n: v }); marksChanged(); }
      dlg.close();
    }));
    dlg.appendChild(acts);
    dlg.showModal();
    ta.focus();
  }

  function outsideLink(url) {
    var host = "";
    try { host = new URL(url).host || url; } catch (e) { return; }
    LIB.confirm(t("link.title"), t("link.text", { url: url.slice(0, 300) }), t("link.open")).then(function (yes) {
      if (!yes) return;
      try { var w = window.open(url, "_blank", "noopener,noreferrer"); if (w) w.opener = null; } catch (e) {}
    });
    return host;
  }

  // ---------- Side panel: contents, search, notes ----------
  function panel(which, quiet) {
    var p = $("rd-panel");
    if (!cur || !which || (cur.panel === which && !quiet && which !== "search")) {
      p.hidden = true;
      document.body.classList.remove("panel-open");
      if (cur) { cur.panel = null; if (!quiet) { LIB.prefs.panelOpen = null; LIB.savePrefs(); } }
      if (cur && !quiet) setTimeout(function () { cur && cur.engine.resize(); }, 0);
      return;
    }
    var was = cur.panel;
    cur.panel = which;
    p.hidden = false;
    document.body.classList.add("panel-open");
    [].forEach.call(document.querySelectorAll("#panel-tabs [data-tab]"), function (b) {
      var on = b.getAttribute("data-tab") === which;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    $("ps-form").hidden = which !== "search";
    if (which === "toc") renderToc();
    else if (which === "notes") renderNotes();
    else if (which === "search") {
      if (!cur.searchQ) $("panel-body").textContent = "";
      setTimeout(function () { $("ps-q").focus(); $("ps-q").select(); }, 0);
    }
    if (window.innerWidth >= 1100) { LIB.prefs.panelOpen = which; LIB.savePrefs(); }
    if (!was) setTimeout(function () { cur && cur.engine.resize(); }, 0);
  }
  function narrow() { return window.innerWidth < 1100; }

  function renderToc() {
    var body = $("panel-body");
    body.textContent = "";
    if (!cur.toc.length) { body.appendChild(el("p", "hint pad", t("toc.none"))); return; }
    var ul = el("ul", "toc");
    cur.toc.forEach(function (e, i) {
      var li = el("li");
      var b = LIB.textBtn("toc-item d" + Math.min(e.d || 0, 4), e.t, function () {
        cur.engine.goToc(e);
        if (narrow()) panel(null);
      });
      b.setAttribute("data-i", i);
      li.appendChild(b);
      ul.appendChild(li);
    });
    body.appendChild(ul);
    markToc();
  }
  function markToc() {
    var h = cur && cur.here;
    var on = -1;
    if (h && cur.engine.tocIndex) on = cur.engine.tocIndex(h.loc);
    [].forEach.call(document.querySelectorAll(".toc-item"), function (b) {
      var is = +b.getAttribute("data-i") === on;
      b.classList.toggle("on", is);
      if (is) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
    });
  }

  function runSearch() {
    if (!cur) return;
    var q = $("ps-q").value.trim();
    var body = $("panel-body");
    body.textContent = "";
    cur.searchQ = q;
    if (!q) return;
    var status = el("p", "hint pad", t("search.running"));
    body.appendChild(status);
    var ul = el("ul", "hits");
    body.appendChild(ul);
    var c = cur, n = 0, mySearch = c.searchGen = (c.searchGen || 0) + 1;
    c.engine.search(q, function (hit) {
      if (cur !== c || c.searchGen !== mySearch) return false;
      n++;
      var li = el("li");
      var b = el("button", "hit");
      b.type = "button";
      if (hit.label) b.appendChild(el("span", "hit-where", hit.label));
      var p = el("span", "hit-text");
      p.appendChild(document.createTextNode(hit.pre));
      p.appendChild(el("mark", "", hit.hit));
      p.appendChild(document.createTextNode(hit.post));
      b.appendChild(p);
      b.addEventListener("click", function () {
        c.engine.go(hit.loc, hit.end);
        if (narrow()) panel(null);
      });
      li.appendChild(b);
      ul.appendChild(li);
      status.textContent = t("search.count", { n: n });
      return true;
    }).then(function (total) {
      if (cur !== c || c.searchGen !== mySearch) return;
      status.textContent = total ? t("search.count", { n: total }) : t("search.none");
    });
  }

  var notesFilter = "all";
  function renderNotes() {
    var body = $("panel-body");
    body.textContent = "";
    var chips = el("div", "chips pad");
    ["all", "hl", "notes", "bm"].forEach(function (f) {
      var b = LIB.textBtn("chip" + (notesFilter === f ? " on" : ""), t("nf." + f), function () { notesFilter = f; renderNotes(); });
      chips.appendChild(b);
    });
    body.appendChild(chips);
    var list = LIB.marksOf(cur.book.id).filter(function (k) {
      return notesFilter === "all" || (notesFilter === "notes" ? !!k.n : k.k === notesFilter);
    });
    if (!list.length) {
      body.appendChild(el("p", "hint pad", t(LIB.marksOf(cur.book.id).length ? "notes.noneHere" : "notes.none")));
      return;
    }
    var ul = el("ul", "marks");
    list.forEach(function (k) {
      var li = el("li", "mark-item");
      var b = el("button", "mark-go");
      b.type = "button";
      var head = el("span", "mark-head");
      if (k.k === "bm") head.innerHTML = UI.bookmarkOn;
      else head.appendChild(el("i", "dot c" + (k.c || 0)));
      head.appendChild(el("span", "", k.lbl || (cur.engine.labelOf ? cur.engine.labelOf(k.loc) : "")));
      b.appendChild(head);
      if (k.q) b.appendChild(el("span", "mark-q", C.squash(k.q).slice(0, 300)));
      if (k.n) b.appendChild(el("span", "mark-n", k.n));
      b.addEventListener("click", function () {
        cur.engine.go(k.loc, k.k === "hl" ? k.end : null);
        if (narrow()) panel(null);
      });
      li.appendChild(b);
      var acts = el("div", "mark-acts");
      acts.appendChild(LIB.btn("icon-btn small", t(k.n ? "hl.editNote" : "hl.note"), UI.note, function () { noteDialog(k.id); }));
      acts.appendChild(LIB.btn("icon-btn small", t("hl.delete"), UI.trash, function () { LIB.delMark(k.id); }));
      li.appendChild(acts);
      ul.appendChild(li);
    });
    body.appendChild(ul);
    var ex = el("div", "pad");
    ex.appendChild(LIB.textBtn("btn", t("details.export"), function () { LIB.home.exportNotes(cur.book.id); }));
    body.appendChild(ex);
  }

  function marksChanged() {
    if (!cur) return;
    cur.engine.paint(LIB.marksOf(cur.book.id));
    bars();
    if (cur.panel === "notes") renderNotes();
  }
  function dataChanged() {
    if (!cur) return;
    var b = LIB.book(cur.book.id);
    if (!b) { close(); return; }
    cur.book = b;
    $("rd-title").textContent = b.title;
    marksChanged();
  }

  // ---------- Reading settings ----------
  function settings() {
    if (!cur) return;
    var P = LIB.prefs, pdf = cur.book.fmt === "pdf";
    var dlg = LIB.dialog("lb-aa", t("aa.title"), "small aa");
    function apply() { LIB.savePrefs(); if (cur) cur.engine.applyPrefs(P); draw(); }
    var box = el("div", "aa-box");
    dlg.appendChild(box);
    function row(name, node) {
      var r = el("div", "aa-row");
      r.appendChild(el("span", "aa-name", name));
      r.appendChild(node);
      box.appendChild(r);
    }
    function chips(options, value, set) {
      var w = el("div", "chips");
      options.forEach(function (o) {
        var b = LIB.textBtn("chip" + (value === o[0] ? " on" : ""), o[1], function () { set(o[0]); apply(); });
        b.setAttribute("aria-pressed", value === o[0] ? "true" : "false");
        w.appendChild(b);
      });
      return w;
    }
    function stepper(text, dec, inc) {
      var w = el("div", "stepper");
      w.appendChild(LIB.btn("icon-btn", t("aa.less"), "<span class=\"step\">−</span>", function () { dec(); apply(); }));
      w.appendChild(el("span", "step-val", text));
      w.appendChild(LIB.btn("icon-btn", t("aa.more"), "<span class=\"step\">+</span>", function () { inc(); apply(); }));
      return w;
    }
    function toggle(on, set) {
      var b = LIB.textBtn("chip" + (on ? " on" : ""), on ? t("aa.on") : t("aa.off"), function () { set(!on); apply(); });
      b.setAttribute("aria-pressed", on ? "true" : "false");
      return b;
    }
    function draw() {
      box.textContent = "";
      if (pdf) {
        var z = P.pdfZoom;
        row(t("aa.zoom"), chips([["width", t("aa.fitWidth")], ["page", t("aa.fitPage")]], typeof z === "string" ? z : "", function (v) { P.pdfZoom = v; }));
        var zv = cur.engine.zoomValue ? cur.engine.zoomValue() : 1;
        row("", stepper(Math.round(zv * 100) + "%",
          function () { P.pdfZoom = Math.max(0.25, Math.round((zv - 0.1) * 10) / 10); },
          function () { P.pdfZoom = Math.min(5, Math.round((zv + 0.1) * 10) / 10); }));
        row(t("aa.night"), toggle(P.pdfNight, function (v) { P.pdfNight = v; }));
        return;
      }
      row(t("aa.size"), stepper(P.size + "%",
        function () { P.size = Math.max(70, P.size - 10); }, function () { P.size = Math.min(250, P.size + 10); }));
      row(t("aa.font"), chips([["pub", t("aa.fontPub")], ["serif", t("aa.fontSerif")], ["sans", t("aa.fontSans")]], P.font, function (v) { P.font = v; }));
      row(t("aa.lh"), stepper(LIB.num(P.lh.toFixed(1)),
        function () { P.lh = Math.max(1.2, Math.round((P.lh - 0.1) * 10) / 10); }, function () { P.lh = Math.min(2.2, Math.round((P.lh + 0.1) * 10) / 10); }));
      row(t("aa.margin"), chips([[0, t("aa.small")], [1, t("aa.medium")], [2, t("aa.large")]], P.margin, function (v) { P.margin = v; }));
      row(t("aa.justify"), toggle(P.justify, function (v) { P.justify = v; }));
      row(t("aa.hyph"), toggle(P.hyph, function (v) { P.hyph = v; }));
      row(t("aa.layout"), chips([["paged", t("aa.paged")], ["scroll", t("aa.scroll")]], P.mode, function (v) { P.mode = v; }));
      if (P.mode === "paged") row(t("aa.spread"), toggle(P.spread, function (v) { P.spread = v; }));
      row(t("aa.theme"), chips([["auto", t("aa.themeAuto")], ["paper", t("aa.themePaper")], ["sepia", t("aa.themeSepia")], ["night", t("aa.themeNight")]], P.theme, function (v) { P.theme = v; }));
    }
    draw();
    dlg.showModal();
  }

  // ---------- Keys ----------
  function onKey(e) {
    if (!cur || $("reader").hidden) return;
    touched();
    if (e.ctrlKey && e.altKey && e.shiftKey) return;
    var tag = e.target && e.target.tagName;
    var typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "f" || e.key === "F")) { e.preventDefault(); panel("search"); return; }
    if (typing || document.querySelector("dialog[open]") || e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    if (k === "ArrowRight" || k === "PageDown" || (k === " " && !e.shiftKey)) { e.preventDefault(); cur.engine.next(); }
    else if (k === "ArrowLeft" || k === "PageUp" || (k === " " && e.shiftKey)) { e.preventDefault(); cur.engine.prev(); }
    else if (k === "ArrowDown" && cur.engine.lineDown) { if (cur.engine.lineDown()) e.preventDefault(); }
    else if (k === "ArrowUp" && cur.engine.lineUp) { if (cur.engine.lineUp()) e.preventDefault(); }
    else if (k === "Escape") {
      if (!$("sel-pop").hidden || !$("mark-pop").hidden || !$("fn-pop").hidden) { hideSel(); hidePop(); e.preventDefault(); }
      else if (cur.panel) { panel(null); e.preventDefault(); }
      else document.body.classList.remove("bare");
    }
    else if (k === "b" || k === "B") { e.preventDefault(); toggleBookmark(); }
    else if (k === "t" || k === "T") { e.preventDefault(); panel("toc"); }
    else if (k === "n" || k === "N") { e.preventDefault(); panel("notes"); }
    else if (k === "s" || k === "S") { e.preventDefault(); LIB.speak.toggle(); }
  }
  // The footer button shows whether reading aloud is on.
  function speakChanged(on) {
    var b = $("rd-speak");
    if (!b) return;
    b.classList.toggle("on", !!on);
    document.body.classList.toggle("speaking", !!on);
  }

  function paletteChanged() { if (cur) cur.engine.applyPrefs(LIB.prefs); }

  LIB.reader = {
    build: build, open: open, close: close, flush: flush, marksChanged: marksChanged,
    dataChanged: dataChanged, paletteChanged: paletteChanged, speakChanged: speakChanged,
    touched: touched, flushTime: flushTime,
    current: function () { return cur; }
  };
})();
