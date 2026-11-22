// ============================================================
// orOS Layout — Find/Change and spelling, the parts on screen (LY-W5, v1.0.0)
//   - Find/Change… (Ctrl+F): text or GREP (a JavaScript regular
//     expression), match case, whole word, in the document or in one
//     story, only in paragraphs of one style; the change can also set a
//     paragraph style or put a character style on what it changes.
//     Ready-made queries for a book, and saved queries (Layout's
//     preferences on this device). Find lists the hits; a hit opens the
//     Story Editor on it; Next goes on from there; Change all is one
//     undo step. findchange.js does the work.
//   - Spelling… : every word of every story checked against the Greek
//     and English dictionaries of Writer (writer/spell.js and its
//     worker, both loaded on first use; the worker keeps the
//     dictionaries for offline use), the words
//     of the document's dictionary (setup.ext.dict, travels with the
//     document) and Writer's "my dictionary" (read, never written). Each
//     unknown word: where it is, suggestions, change everywhere, add to
//     the document's dictionary or ignore for now.
// ============================================================
(function () {
  "use strict";
  var LY = window.LY, t = LY.t, el = LY.el, M = LY.M, F = window.LY_FIND;
  var MAX_LIST = 200, DICT_MAX = 800;

  // ---------- Find/Change ----------
  var Q = { find: "", change: "", grep: 0, cs: 0, word: 0, scope: "doc", ps: "", toPs: "", toCs: "" };
  var cur = -1;   // the hit Next / Change last went to

  function storyScope() {
    if (LY.story && LY.story.isOpen()) return LY.story.sid();
    var its = LY.ed ? LY.ed.selItems().filter(function (it) { return it.t === "text"; }) : [];
    return its.length === 1 ? its[0].story : null;
  }
  function query() { return { find: Q.find, grep: Q.grep, cs: Q.cs, word: Q.word, ps: Q.ps || undefined }; }
  function scopeSid() { return Q.scope === "story" ? storyScope() : null; }
  function hits(doc) { return F.search(doc || LY.doc, query(), { sid: scopeSid() || undefined, max: 5000 }); }
  function flushText() {
    if (LY.inframe && LY.inframe.isOn()) LY.inframe.stop();
    if (LY.story && LY.story.flush) LY.story.flush();
  }
  function goTo(h) {
    if (!h) return;
    if (!LY.story.openAt(h.sid, h.p, h.s, h.e)) LY.toast(t("fc.noFrame"));
  }
  // what changed, as one undo step; stamps each story it touched
  function applyChange(only) {
    flushText();
    var res = null;
    LY.op(function (doc, now) {
      var before = {};
      doc.stories.forEach(function (s) { before[s.id] = s.m; });
      res = F.change(doc, query(), Q.change, { sid: scopeSid() || undefined, ps: Q.toPs || undefined, csTo: Q.toCs || undefined, only: only || undefined });
      if (!res.n) return false;
      res.stories.forEach(function (sid) {
        var st = M.story(doc, sid);
        st.h = [before[sid]].concat(st.h || []);
        M.touch(st, now);
      });
    });
    return res || { n: 0 };
  }

  function findDlg() {
    if (!LY.doc) return;
    if (!storyScope() && Q.scope === "story") Q.scope = "doc";
    LY.openDialog(t("fc.title"), function (body, close) {
      var doc = LY.doc;
      // queries: ready-made and saved
      var saved = (LY.prefs.queries || []);
      var qOpts = [["", t("fc.queries")]];
      F.PRESETS.forEach(function (p) { qOpts.push(["p:" + p.id, t("fc.pre." + p.id)]); });
      saved.forEach(function (q, i) { qOpts.push(["s:" + i, q.name]); });
      var qSel = LY.ui.select(qOpts, "", function (v) {
        var q = v.indexOf("p:") === 0 ? F.PRESETS.filter(function (p) { return "p:" + p.id === v; })[0] : v.indexOf("s:") === 0 ? saved[+v.slice(2)] : null;
        if (!q) return;
        Q.find = q.find; Q.change = q.change || ""; Q.grep = q.grep ? 1 : 0; Q.cs = q.cs ? 1 : 0; Q.word = q.word ? 1 : 0;
        cur = -1;
        close(); findDlg();
      });
      qSel.setAttribute("aria-label", t("fc.queries"));
      var top = el("div", "fc-top");
      top.appendChild(qSel);
      var del = LY.iconBtn("trash", t("fc.delQuery"), "small");
      del.addEventListener("click", function () {
        var v = qSel.value;
        if (v.indexOf("s:") !== 0) { LY.toast(t("fc.delPick")); return; }
        saved.splice(+v.slice(2), 1);
        if (saved.length) LY.prefs.queries = saved; else delete LY.prefs.queries;
        LY.savePrefs();
        close(); findDlg();
      });
      top.appendChild(del);
      body.appendChild(top);

      var fi = el("input", "inp" + (Q.grep ? " mono" : ""));
      fi.type = "text"; fi.maxLength = 500; fi.value = Q.find; fi.spellcheck = false; fi.autocomplete = "off";
      var ci = el("input", "inp" + (Q.grep ? " mono" : ""));
      ci.type = "text"; ci.maxLength = 500; ci.value = Q.change; ci.spellcheck = false; ci.autocomplete = "off";
      var err = el("p", "hint warn");
      function check() {
        Q.find = fi.value; Q.change = ci.value;
        var c = Q.find ? F.compile(query()) : {};
        err.textContent = c.error === "bad" ? t("fc.bad", { m: c.msg || "" }) : c.error === "long" ? t("fc.long") : c.error === "empty" && Q.find ? t("fc.matchesEmpty") : "";
        return !c.error;
      }
      fi.addEventListener("input", function () { cur = -1; check(); });
      ci.addEventListener("input", check);
      fi.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); show(); } });
      body.appendChild(LY.ui.field(t("fc.find"), fi));
      body.appendChild(LY.ui.field(t("fc.change"), ci));
      body.appendChild(err);

      var mode = el("div");
      function drawMode() {
        mode.innerHTML = "";
        mode.appendChild(LY.ui.seg([["0", t("fc.text")], ["1", t("fc.grep")]], String(Q.grep), function (v) {
          Q.grep = +v; cur = -1; drawMode();
          fi.classList.toggle("mono", !!Q.grep); ci.classList.toggle("mono", !!Q.grep);
          hint.textContent = Q.grep ? t("fc.grepHint") : t("fc.textHint");
          check();
        }));
      }
      drawMode();
      body.appendChild(mode);
      var hint = el("p", "hint", Q.grep ? t("fc.grepHint") : t("fc.textHint"));
      body.appendChild(hint);
      var opts = el("div", "pn-row wrap");
      opts.appendChild(LY.ui.check(t("fc.cs"), Q.cs, function (v) { Q.cs = v; cur = -1; }));
      opts.appendChild(LY.ui.check(t("fc.word"), Q.word, function (v) { Q.word = v; cur = -1; }));
      body.appendChild(opts);

      var g = el("div", "grid2");
      var scopes = [["doc", t("fc.inDoc")]];
      if (storyScope()) scopes.push(["story", t("fc.inStory")]);
      g.appendChild(LY.ui.field(t("fc.scope"), LY.ui.select(scopes, Q.scope, function (v) { Q.scope = v; cur = -1; })));
      var psList = doc.pstyles.map(function (x) { return [x.id, LY.label(x.name)]; });
      var csList = doc.cstyles.map(function (x) { return [x.id, LY.label(x.name)]; });
      g.appendChild(LY.ui.field(t("fc.onlyPs"), LY.ui.select([["", t("fc.anyPs")]].concat(psList), Q.ps, function (v) { Q.ps = v; cur = -1; })));
      g.appendChild(LY.ui.field(t("fc.toPs"), LY.ui.select([["", t("fc.keep")]].concat(psList), Q.toPs, function (v) { Q.toPs = v; })));
      g.appendChild(LY.ui.field(t("fc.toCs"), LY.ui.select([["", t("fc.keep")]].concat(csList), Q.toCs, function (v) { Q.toCs = v; })));
      body.appendChild(g);

      var out = el("div", "fc-out");
      out.setAttribute("aria-live", "polite");
      body.appendChild(out);
      function show() {
        if (!check() || !Q.find) return;
        out.innerHTML = "";
        var hs = hits();
        out.appendChild(el("p", "fc-n", hs.length ? t(hs.length >= 5000 ? "fc.nMany" : "fc.n", { n: hs.length }) : t("fc.none")));
        if (!hs.length) return;
        var ul = el("ul", "fc-list");
        hs.slice(0, MAX_LIST).forEach(function (h, i) {
          var st = M.story(LY.doc, h.sid), text = F.paraText(st.paras[h.p]);
          var b = el("button", "fc-hit");
          b.type = "button";
          var a = Math.max(0, h.s - 40), z = Math.min(text.length, h.e + 40);
          b.appendChild(document.createTextNode((a > 0 ? "…" : "") + text.slice(a, h.s)));
          b.appendChild(el("mark", "", text.slice(h.s, h.e)));
          b.appendChild(document.createTextNode(text.slice(h.e, z) + (z < text.length ? "…" : "")));
          b.addEventListener("click", function () { cur = i; close(); goTo(h); });
          var li = el("li");
          li.appendChild(b);
          ul.appendChild(li);
        });
        out.appendChild(ul);
        if (hs.length > MAX_LIST) out.appendChild(el("p", "hint", t("fc.more", { n: MAX_LIST })));
      }

      var act = el("div", "dlg-actions");
      act.appendChild(LY.ui.btn(t("fc.save"), function () {
        if (!check() || !Q.find) return;
        // no native dialogs: the name is the query itself
        var list = (LY.prefs.queries || []).filter(function (q) { return !(q.find === Q.find && q.grep === Q.grep && q.change === Q.change); });
        list.unshift({ name: Q.find.slice(0, 60), find: Q.find, change: Q.change, grep: Q.grep, cs: Q.cs, word: Q.word });
        LY.prefs.queries = F.normQueries(list);
        LY.savePrefs();
        LY.toast(t("fc.saved"));
        close(); findDlg();
      }));
      act.appendChild(el("span", "spacer"));
      act.appendChild(LY.ui.btn(t("fc.findBtn"), show));
      act.appendChild(LY.ui.btn(t("fc.next"), function () {
        if (!check() || !Q.find) return;
        var hs = hits();
        if (!hs.length) { out.innerHTML = ""; out.appendChild(el("p", "fc-n", t("fc.none"))); return; }
        cur = (cur + 1) % hs.length;
        close(); goTo(hs[cur]);
      }));
      act.appendChild(LY.ui.btn(t("fc.changeOne"), function () {
        if (!check() || !Q.find) return;
        var hs = hits();
        if (!hs.length) { out.innerHTML = ""; out.appendChild(el("p", "fc-n", t("fc.none"))); return; }
        var h = hs[Math.max(0, Math.min(cur, hs.length - 1))];
        if (cur < 0) { cur = 0; close(); goTo(h); return; }   // first show it, then change it
        applyChange({ sid: h.sid, p: h.p, s: h.s });
        // the next hit after this one in reading order, else the first
        var after = hits(), order = F.storyOrder(LY.doc), oh = order.indexOf(h.sid), nx = null;
        after.forEach(function (x) {
          var ox = order.indexOf(x.sid);
          if (!nx && (ox > oh || (ox === oh && (x.p > h.p || (x.p === h.p && x.s > h.s))))) nx = x;
        });
        nx = nx || after[0];
        close();
        if (nx) { cur = after.indexOf(nx); goTo(nx); } else { cur = -1; LY.toast(t("fc.done", { n: 1 })); }
      }));
      act.appendChild(LY.ui.btn(t("fc.all"), function () {
        if (!check() || !Q.find) return;
        var r = applyChange(null);
        cur = -1;
        out.innerHTML = "";
        out.appendChild(el("p", "fc-n", r.n ? t("fc.done", { n: r.n }) : t("fc.none")));
      }, "primary"));
      body.appendChild(act);
      if (Q.find) check();
      setTimeout(function () { fi.focus(); fi.select(); }, 0);
    }, true);
  }

  // ---------- Spelling ----------
  var worker = null, wid = 0, waiting = {}, ignored = {};
  function call(msg) {
    return new Promise(function (res) {
      if (!worker) {
        try { worker = new Worker("../writer/spell-worker.js"); } catch (e) { res(null); return; }
        worker.onmessage = function (ev) {
          var m = ev.data || {};
          if (m.id && waiting[m.id]) { var f = waiting[m.id]; delete waiting[m.id]; f(m); }
        };
        worker.onerror = function () { Object.keys(waiting).forEach(function (k) { waiting[k](null); }); waiting = {}; worker = null; };
      }
      var id = ++wid;
      msg.id = id;
      waiting[id] = res;
      worker.postMessage(msg);
    });
  }
  function docDict(doc) {
    var x = doc.setup && doc.setup.ext, d = x && Array.isArray(x.dict) ? x.dict : [];
    return d.filter(function (w) { return typeof w === "string" && w; });
  }
  function writerWords() {
    var WS = window.WriterSpell;
    try {
      var d = JSON.parse(localStorage.getItem("oros-writer-data") || "null");
      return d && d.userDict && WS ? WS.userDictWords(WS.mergeUserDict(d.userDict, null)) : [];
    } catch (e) { return []; }
  }
  // every word worth checking, with where it is: { w → { lang, at: [{ sid, p, s, e }] } }
  function collect(doc) {
    var WS = window.WriterSpell, words = {}, n = 0;
    F.storyOrder(doc).forEach(function (sid) {
      var st = M.story(doc, sid);
      if (!st) return;
      st.paras.forEach(function (para, p) {
        if (n > 300000) return;
        WS.tokens(F.paraText(para)).forEach(function (tk) {
          if (!WS.shouldCheck(tk.w)) return;
          var lang = WS.scriptOf(tk.w);
          if (!lang) return;
          var e = words[tk.w] || (words[tk.w] = { lang: lang, at: [] });
          if (e.at.length < 50) e.at.push({ sid: sid, p: p, s: tk.s, e: tk.e });
          n++;
        });
      });
    });
    return words;
  }
  // Writer's spell.js, loaded the first time Spelling… opens
  var libP = null;
  function lib() {
    if (window.WriterSpell) return Promise.resolve(true);
    if (!libP) libP = new Promise(function (res) {
      var s = document.createElement("script");
      s.src = "../writer/spell.js";
      s.onload = function () { res(!!window.WriterSpell); };
      s.onerror = function () { libP = null; res(false); };
      document.head.appendChild(s);
    });
    return libP;
  }
  function spellDlg() {
    if (!LY.doc) return;
    lib().then(function (ok) { if (ok) spellOpen(); else LY.toast(t("sp.noLib")); });
  }
  function spellOpen() {
    if (!LY.doc) return;
    flushText();
    LY.openDialog(t("sp.title"), function (body, close) {
      var WS = window.WriterSpell;
      var status = el("p", "hint", t("sp.checking"));
      status.setAttribute("aria-live", "polite");
      body.appendChild(status);
      var list = el("ul", "sp-list");
      body.appendChild(list);
      body.appendChild(el("p", "hint", t("sp.hint")));
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(LY.ui.btn(t("btn.close"), close, "primary"));
      body.appendChild(act);

      var words = collect(LY.doc), byLang = { el: [], en: [] };
      Object.keys(words).forEach(function (w) { byLang[words[w].lang].push(w); });
      var known = new Set(docDict(LY.doc).concat(writerWords()));
      var bad = [], failed = false;
      var jobs = ["el", "en"].filter(function (l) { return byLang[l].length; }).map(function (l) {
        var all = byLang[l], parts = [];
        for (var i = 0; i < all.length; i += 4000) parts.push(all.slice(i, i + 4000));
        return parts.reduce(function (pr, part) {
          return pr.then(function () {
            return call({ op: "check", lang: l, words: part }).then(function (m) {
              if (!m || m.failed) { failed = true; return; }
              (m.bad || []).forEach(function (w) { bad.push(w); });
            });
          });
        }, Promise.resolve());
      });
      Promise.all(jobs).then(function () {
        if (!body.isConnected) return;
        bad = bad.filter(function (w) { return !WS.userHas(known, w) && !ignored[w]; });
        bad.sort(function (a, b) { return words[b].at.length - words[a].at.length || a.localeCompare(b); });
        draw();
      });

      function draw() {
        list.innerHTML = "";
        var left = bad.filter(function (w) { return !ignored[w]; });
        status.textContent = failed ? t("sp.failed") : left.length ? t("sp.n", { n: left.length }) : t("sp.none");
        left.slice(0, 300).forEach(function (w) {
          var li = el("li", "sp-row");
          var head = el("div", "sp-head");
          head.appendChild(el("span", "sp-word", w));
          head.appendChild(el("span", "sp-count", "×" + words[w].at.length));
          var go = LY.ui.btn(t("sp.go"), function () { var a = words[w].at[0]; close(); LY.story.openAt(a.sid, a.p, a.s, a.e); }, "small");
          var add = LY.ui.btn(t("sp.add"), function () { addWord(w); ignored[w] = 1; draw(); }, "small");
          var ign = LY.ui.btn(t("sp.ignore"), function () { ignored[w] = 1; draw(); }, "small ghost");
          var sug = LY.ui.btn(t("sp.suggest"), function () {
            sug.disabled = true;
            call({ op: "suggest", lang: words[w].lang, word: w }).then(function (m) {
              var opts = (m && m.list) || [];
              var box = el("div", "sp-sug");
              if (!opts.length) box.appendChild(el("span", "hint", t("sp.noSug")));
              opts.forEach(function (s) {
                box.appendChild(LY.ui.btn(s, function () {
                  var r = changeWord(w, s);
                  LY.toast(t("fc.done", { n: r }));
                  ignored[w] = 1; draw();
                }, "small"));
              });
              li.appendChild(box);
            });
          }, "small");
          [go, sug, add, ign].forEach(function (b) { head.appendChild(b); });
          li.appendChild(head);
          list.appendChild(li);
        });
      }
    }, true);
  }
  // a misspelt word changed everywhere (exact case, whole word): one undo step
  function changeWord(w, to) {
    var res = null;
    LY.op(function (doc, now) {
      var before = {};
      doc.stories.forEach(function (s) { before[s.id] = s.m; });
      res = F.change(doc, { find: w, cs: 1, word: 1 }, to.replace(/\$/g, "$$$$"), {});
      if (!res.n) return false;
      res.stories.forEach(function (sid) { var st = M.story(doc, sid); st.h = [before[sid]].concat(st.h || []); M.touch(st, now); });
    });
    return res ? res.n : 0;
  }
  function addWord(w) {
    LY.op(function (doc, now) {
      var x = doc.setup.ext = doc.setup.ext || {}, d = Array.isArray(x.dict) ? x.dict.slice() : [];
      if (d.indexOf(w) >= 0) return false;
      d.push(String(w).slice(0, 60));
      d.sort();
      x.dict = d.slice(-DICT_MAX);
      doc.m = Math.max(now, (doc.m || 0) + 1);
    });
  }

  LY.on("boot", function () {
    LY.dlg = LY.dlg || {};
    LY.dlg.find = findDlg;
    LY.dlg.spell = spellDlg;
  });
  LY.findui = { find: findDlg, spell: spellDlg, collect: collect, docDict: docDict };
})();
