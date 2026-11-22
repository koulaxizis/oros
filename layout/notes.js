// ============================================================
// orOS Layout — notes, cross-references, links and contents (LY-W7)
// The dialogs behind the Story Editor's ¹ menu and More › Contents…:
//   - editNote(text, done, canDelete): a footnote's or endnote's text
//   - editLink(url, done): a link on the selected words (ext.href)
//   - pickAnchor(done): a paragraph to point at; it gets ext.aid
//   - settings(): footnotes or endnotes, their style, their numbers
//     (setup.ext.fn { kind, ps, r })
//   - anchor(id): { t, pg } of a paragraph with ext.aid = id
//   - toc(): the contents of any document from the styles chosen
//     (setup.ext.toc), made or brought up to date
// The text engine sets notes at the foot of their column or after the
// story, and cross-references with the page their paragraph is on
// (designkit/text.js 6a/6c, render.js computeLayout).
// ============================================================
(function () {
  "use strict";

  var LY = window.LY;
  if (!LY) return;
  var t = LY.t, el = LY.el, M = window.orosDK.model, T = window.orosDK.text;

  function textOf(p) { return (p.runs || []).map(function (r) { return r.ext && (r.ext.fn || r.ext.xr) ? "" : r.t || ""; }).join("").replace(/\s+/g, " ").trim(); }
  function actions(body, list) {
    var act = el("div", "dlg-actions");
    act.appendChild(el("span", "spacer"));
    list.forEach(function (b) { if (b) act.appendChild(b); });
    body.appendChild(act);
  }

  // ---------- one note ----------
  function editNote(text, done, canDelete) {
    LY.openDialog(t(canDelete ? "note.edit" : "note.ins"), function (body, close) {
      var ta = el("textarea", "inp note-text");
      ta.rows = 5; ta.maxLength = 4000; ta.value = text || "";
      ta.setAttribute("aria-label", t("note.text"));
      body.appendChild(LY.ui.field(t("note.text"), ta, "block"));
      body.appendChild(el("p", "hint", t("note.hint")));
      actions(body, [
        canDelete ? LY.ui.btn(t("note.del"), function () { close(); done(""); }, "ghost") : null,
        LY.ui.btn(t("btn.cancel"), close),
        LY.ui.btn(t("btn.ok"), function () { close(); done(ta.value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")); }, "primary")
      ]);
      setTimeout(function () { ta.focus(); }, 0);
    });
  }

  // ---------- a link ----------
  var URL_RE = /^(https?:\/\/[^\s<>"]{1,1990}|mailto:[^\s<>"]{1,200})$/i;
  function editLink(url, done) {
    LY.openDialog(t("link.title"), function (body, close) {
      var inp = el("input", "inp");
      inp.type = "url"; inp.value = url || ""; inp.placeholder = "https://";
      inp.setAttribute("aria-label", t("link.url"));
      body.appendChild(LY.ui.field(t("link.url"), inp, "block"));
      body.appendChild(el("p", "hint", t("link.hint")));
      function ok() {
        var v = inp.value.trim();
        if (v && !/^[a-z]+:/i.test(v)) v = "https://" + v;
        if (v && !URL_RE.test(v)) { LY.toast(t("link.bad")); return; }
        close(); done(v);
      }
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); ok(); } });
      actions(body, [
        url ? LY.ui.btn(t("link.remove"), function () { close(); done(""); }, "ghost") : null,
        LY.ui.btn(t("btn.cancel"), close),
        LY.ui.btn(t("btn.ok"), ok, "primary")
      ]);
    });
  }

  // ---------- cross-references ----------
  function anchor(id) {
    if (!id || !LY.doc) return null;
    var hit = null;
    LY.doc.stories.some(function (st) {
      return (st.paras || []).some(function (p) {
        if (!p.ext || p.ext.aid !== id) return false;
        hit = { t: textOf(p), sid: st.id };
        return true;
      });
    });
    if (hit) { var L = LY.ed && LY.ed.L, x = L && L.xr && L.xr[id]; hit.pg = x ? x.pg : ""; }
    return hit;
  }
  // the paragraphs worth pointing at: those already pointed at, titles
  // (a running-head style, a contents style or a bigger style than the
  // body), and with a search any paragraph
  function candidates(q) {
    var doc = LY.doc, psMap = T.byId(doc.pstyles), body = T.resolvePs(psMap, "ps-body").size, out = [];
    var toc = window.LY_AUTO && window.LY_AUTO.tocCfg ? window.LY_AUTO.tocCfg(doc) : null;
    var shown = {};
    doc.items.forEach(function (it) { if (it.t === "text") shown[it.story] = 1; });
    q = String(q || "").toLocaleLowerCase();
    doc.stories.forEach(function (st) {
      if (!shown[st.id] || (st.ext && st.ext.hs === "toc")) return;
      (st.paras || []).forEach(function (p, k) {
        if (out.length >= 300) return;
        var tx = textOf(p);
        if (!tx) return;
        var ps = T.resolvePs(psMap, p.ps);
        var head = (p.ext && p.ext.aid) || ps.sec || (toc && toc.heads[p.ps]) || (ps.size > body + 0.5 && tx.length <= 160);
        if (q.length >= 2 ? tx.toLocaleLowerCase().indexOf(q) < 0 : !head) return;
        out.push({ sid: st.id, k: k, t: tx.slice(0, 120), aid: p.ext && p.ext.aid });
      });
    });
    return out;
  }
  function newAid() { return "a" + Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, ""); }
  function pickAnchor(done) {
    LY.openDialog(t("xr.ins"), function (body, close) {
      var kind = "p";
      body.appendChild(LY.ui.field(t("xr.show"), LY.ui.select([["p", t("xr.k.p")], ["t", t("xr.k.t")], ["tp", t("xr.k.tp")]], kind, function (v) { kind = v; })));
      var q = el("input", "inp");
      q.type = "search"; q.placeholder = t("xr.search");
      q.setAttribute("aria-label", t("xr.search"));
      body.appendChild(q);
      var list = el("div", "xr-list");
      list.setAttribute("role", "list");
      body.appendChild(list);
      function fill() {
        list.innerHTML = "";
        var c = candidates(q.value);
        if (!c.length) list.appendChild(el("p", "hint", t("xr.none")));
        c.forEach(function (x) {
          var b = el("button", "xr-item", x.t);
          b.type = "button";
          b.setAttribute("role", "listitem");
          b.addEventListener("click", function () {
            close();
            var aid = x.aid;
            if (!aid) {
              aid = newAid();
              LY.op(function (doc, now) {
                var st = M.story(doc, x.sid), p = st && st.paras[x.k];
                if (!p || textOf(p).slice(0, 120) !== x.t) { aid = null; return false; }
                p.ext = p.ext ? JSON.parse(JSON.stringify(p.ext)) : {};
                p.ext.aid = aid;
                st.h = [st.m].concat(st.h || []);
                M.touch(st, now);
              });
              if (LY.story && LY.story.reload) LY.story.reload();
            }
            if (aid) done(aid, kind);
          });
          list.appendChild(b);
        });
      }
      q.addEventListener("input", fill);
      fill();
      body.appendChild(el("p", "hint", t("xr.hint")));
      actions(body, [LY.ui.btn(t("btn.cancel"), close)]);
    }, true);
  }

  // ---------- settings ----------
  function psOptions(none) {
    var list = LY.doc.pstyles.slice().sort(function (a, b) { return T.collate(LY.label(a.name), LY.label(b.name)); });
    return [["", none]].concat(list.map(function (s) { return [s.id, LY.label(s.name)]; }));
  }
  function setupExt(key, val) {
    LY.op(function (doc, now) {
      var x = doc.setup.ext ? JSON.parse(JSON.stringify(doc.setup.ext)) : {};
      if (JSON.stringify(x[key]) === JSON.stringify(val)) return false;
      if (val === null) delete x[key]; else x[key] = val;
      doc.setup.ext = x;
      M.touch(doc, now);
    });
  }
  function settings() {
    if (!LY.doc) return;
    var cur = (LY.doc.setup.ext && LY.doc.setup.ext.fn) || {};
    var v = { kind: cur.kind === "end" ? "end" : "foot", ps: typeof cur.ps === "string" ? cur.ps : "", r: cur.r === "story" ? "story" : "doc" };
    LY.openDialog(t("note.settings"), function (body, close) {
      body.appendChild(LY.ui.field(t("note.kind"), LY.ui.select([["foot", t("note.foot")], ["end", t("note.end")]], v.kind, function (x) { v.kind = x; })));
      body.appendChild(LY.ui.field(t("note.ps"), LY.ui.select(psOptions(t("note.psAuto")), v.ps, function (x) { v.ps = x; })));
      body.appendChild(LY.ui.field(t("note.num"), LY.ui.select([["doc", t("note.numDoc")], ["story", t("note.numStory")]], v.r, function (x) { v.r = x; })));
      body.appendChild(el("p", "hint", t("note.setHint")));
      actions(body, [LY.ui.btn(t("btn.cancel"), close), LY.ui.btn(t("btn.ok"), function () {
        close();
        var o = { kind: v.kind };
        if (v.ps) o.ps = v.ps;
        if (v.r === "story") o.r = "story";
        setupExt("fn", o);
      }, "primary")]);
    });
  }

  // ---------- contents ----------
  // i18n-inline-ok: the default text between title and page in Greek («Τίτλος | σελ. 12»)
  var SEP_EL = " | σελ. ";
  var SEPS = [["\t", "toc.sepTab"], [" ", "toc.sepSpace"], [" | p. ", "toc.sepP"], [SEP_EL, "toc.sepSel"]];
  function toc() {
    var doc = LY.doc;
    if (!doc) return;
    if (LY.flushStory) LY.flushStory();
    var A = window.LY_AUTO, cfg = A.tocCfg(doc), lv = {}, eps = ["", "", ""], sep = LY.BASE === "el" ? SEP_EL : "\t";
    if (cfg) { lv = JSON.parse(JSON.stringify(cfg.heads)); eps = [cfg.eps[0] || "", cfg.eps[1] || "", cfg.eps[2] || ""]; sep = cfg.sep || sep; }
    else doc.pstyles.forEach(function (s) { var ps = T.resolvePs(T.byId(doc.pstyles), s.id); if (ps.sec) lv[s.id] = 1; });
    LY.openDialog(t("toc.title"), function (body, close) {
      body.appendChild(el("p", "hint", t("toc.pick")));
      var grid = el("div", "toc-grid");
      doc.pstyles.slice().sort(function (a, b) { return T.collate(LY.label(a.name), LY.label(b.name)); }).forEach(function (s) {
        if (s.id === "ps-base") return;
        grid.appendChild(LY.ui.field(LY.label(s.name), LY.ui.select([["0", t("toc.lv0")], ["1", t("toc.lv", { n: 1 })], ["2", t("toc.lv", { n: 2 })], ["3", t("toc.lv", { n: 3 })]],
          String(lv[s.id] || 0), function (x) { if (x === "0") delete lv[s.id]; else lv[s.id] = Number(x); })));
      });
      body.appendChild(grid);
      [0, 1, 2].forEach(function (k) {
        body.appendChild(LY.ui.field(t("toc.eps", { n: k + 1 }), LY.ui.select(psOptions(t("toc.epsSame")), eps[k], function (x) { eps[k] = x; })));
      });
      var sepOpts = SEPS.map(function (s) { return [s[0], t(s[1])]; });
      if (!SEPS.some(function (s) { return s[0] === sep; })) sepOpts.push([sep, sep]);
      body.appendChild(LY.ui.field(t("toc.sep"), LY.ui.select(sepOpts, sep, function (x) { sep = x; })));
      body.appendChild(el("p", "hint", t("toc.hint")));
      actions(body, [LY.ui.btn(t("btn.cancel"), close), LY.ui.btn(t("toc.go"), function () {
        if (!Object.keys(lv).length) { LY.toast(t("toc.noStyles")); return; }
        close();
        make({ ps: lv, eps: eps.some(Boolean) ? eps : undefined, sep: sep });
      }, "primary")]);
    }, true);
  }
  // keep the choice, then fill the contents story (a new frame on this
  // page when there is none) from the layout
  function make(c) {
    var n = -1, page = LY.ed && LY.ed.curPage ? LY.ed.curPage() : null;
    var o = { ps: Object.keys(c.ps).map(function (id) { return [id, c.ps[id]]; }), sep: c.sep };
    if (c.eps) o.eps = c.eps;
    LY.op(function (doc, now) {
      var x = doc.setup.ext ? JSON.parse(JSON.stringify(doc.setup.ext)) : {};
      x.toc = o;
      doc.setup.ext = x;
      M.touch(doc, now);
      var st = null;
      doc.stories.forEach(function (s) { if (s.ext && s.ext.hs === "toc") st = s; });
      if (!st) {
        var pg = page && M.find(doc.pages, page.id) ? page : M.pagesInOrder(doc)[0];
        if (!pg) return;
        var side = M.sideOf(doc, M.pagesInOrder(doc).indexOf(pg)), mg = M.margins(doc, side);
        st = LY.ed.newStory(doc, now, [{ ps: titlePs(doc), runs: [{ t: t("toc.head") }] }, { ps: "ps-body", runs: [{ t: "…" + c.sep + "1" }] }]);
        st.ext = { hs: "toc" };
        LY.ed.addItem(doc, { t: "text", pg: pg.id, x: mg.l, y: mg.t, w: Math.max(36, doc.setup.w - mg.l - mg.r), h: Math.max(36, doc.setup.h - mg.t - mg.b), story: st.id }, now);
      }
      n = window.LY_AUTO.toc(doc, window.orosDK.render.computeLayout(doc));
      st.h = [st.m].concat(st.h || []);
      M.touch(st, now);
    });
    LY.toast(n < 0 ? t("au.noToc") : t("au.tocDone", { n: n }));
  }
  function titlePs(doc) {
    var psMap = T.byId(doc.pstyles), best = "ps-body", size = 0;
    doc.pstyles.forEach(function (s) { var ps = T.resolvePs(psMap, s.id); if (/^ps-h/.test(s.id) && ps.size > size) { size = ps.size; best = s.id; } });
    return best;
  }

  LY.notes = { editNote: editNote, editLink: editLink, pickAnchor: pickAnchor, settings: settings, anchor: anchor, toc: toc, candidates: candidates };
})();
