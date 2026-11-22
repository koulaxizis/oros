// ============================================================
// orOS Layout — named versions and compare (LY-N7 + LY-W11, v1.0.0)
// A version is the whole document as it was, under a name, kept on
// this device (IndexedDB oros-layout-versions, store "v"; 30 per
// document, the oldest go first): saved from More › Versions…, by
// Claude through edit_in_app's `version` command (before its other
// commands), and before a restore (so a restore can be undone the
// same way). Restore puts the document back as new edits
// (LY.restoreDoc: it syncs, and the open one takes it as one undo
// step). Compare lists what changed between a version and now:
// pages, words, frames, styles, the document's setup, and each
// paragraph that changed with its words struck and added.
// Pure part LY_VERSIONS (Node tests): stats, words, diffWords,
// diffParas, diff. Browser part LY.versions: save, list, dialog.
// ============================================================
(function (root) {
  "use strict";

  var KEEP = 30, NAME_MAX = 80, PARA_MAX = 200;

  function paraText(p) {
    // a table (LY-W12): its cells' text, row by row
    var tb = p.ext && p.ext.tbl;
    if (tb && Array.isArray(tb.rows)) return tb.rows.map(function (r) { return (r && r.c || []).map(function (c) { return c && !c.x && typeof c.t === "string" ? c.t : ""; }).join(" "); }).join(" ").replace(/\s+/g, " ").trim();
    return (p.runs || []).map(function (r) { return typeof r.t === "string" && !(r.ext && (r.ext.fn || r.ext.xr || r.ext.del)) ? r.t : ""; }).join("").replace(/\s+/g, " ").trim();
  }
  function words(s) { return String(s || "").split(/\s+/).filter(Boolean); }
  // { pages, words, frames, pictures, stories }
  function stats(doc) {
    var w = 0, fr = 0, pic = 0;
    (doc.stories || []).forEach(function (st) { (st.paras || []).forEach(function (p) { w += words(paraText(p)).length; }); });
    (doc.items || []).forEach(function (it) { if (it.t === "text") fr++; else if (it.t === "img") pic++; });
    return { pages: (doc.pages || []).filter(function (p) { return !p.master; }).length, words: w, frames: fr, pictures: pic, stories: (doc.stories || []).length };
  }

  // the longest common subsequence of a and b (arrays of strings) as
  // [op, value] with op "=" | "-" | "+"; common ends first, then a table
  // (left as one removal and one addition when it would be too big)
  function lcs(a, b, cap) {
    var s = 0, ea = a.length, eb = b.length, out = [], tail = [];
    while (s < ea && s < eb && a[s] === b[s]) out.push(["=", a[s++]]);
    while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { eb--; tail.unshift(["=", a[--ea]]); }
    var A = a.slice(s, ea), B = b.slice(s, eb), n = A.length, m = B.length;
    if (n * m > (cap || 4e6)) {
      A.forEach(function (x) { out.push(["-", x]); });
      B.forEach(function (x) { out.push(["+", x]); });
      return out.concat(tail);
    }
    var T = [], i, j;
    for (i = 0; i <= n; i++) T.push(new Uint32Array(m + 1));
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) T[i][j] = A[i] === B[j] ? T[i + 1][j + 1] + 1 : Math.max(T[i + 1][j], T[i][j + 1]);
    i = 0; j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { out.push(["=", A[i]]); i++; j++; }
      else if (T[i + 1][j] >= T[i][j + 1]) out.push(["-", A[i++]]);
      else out.push(["+", B[j++]]);
    }
    while (i < n) out.push(["-", A[i++]]);
    while (j < m) out.push(["+", B[j++]]);
    return out.concat(tail);
  }
  // two texts → [[op, words]] with runs of the same op joined
  function diffWords(a, b) {
    var out = [];
    lcs(words(a), words(b), 250000).forEach(function (x) {
      var last = out[out.length - 1];
      if (last && last[0] === x[0]) last[1] += " " + x[1];
      else out.push([x[0], x[1]]);
    });
    return out;
  }
  // a story's paragraphs then and now → [{ k "chg" | "add" | "del",
  // p (index now, or where it was), a, b }]; a removal right before an
  // addition is one changed paragraph
  function diffParas(pa, pb) {
    var A = pa.map(paraText), B = pb.map(paraText), ops = lcs(A, B), out = [], ia = 0, ib = 0, k;
    for (k = 0; k < ops.length; k++) {
      var o = ops[k];
      if (o[0] === "=") { ia++; ib++; continue; }
      if (o[0] === "-" && ops[k + 1] && ops[k + 1][0] === "+") { out.push({ k: "chg", p: ib, a: A[ia], b: B[ib] }); ia++; ib++; k++; continue; }
      if (o[0] === "-") { out.push({ k: "del", p: ib, a: A[ia], b: "" }); ia++; continue; }
      out.push({ k: "add", p: ib, a: "", b: B[ib] }); ib++;
    }
    return out;
  }
  function byId(list) { var o = {}; (list || []).forEach(function (x) { if (x && x.id) o[x.id] = x; }); return o; }
  function same(x, y, skip) {
    var c = function (v) { var o = {}; Object.keys(v || {}).sort().forEach(function (k) { if (skip.indexOf(k) < 0) o[k] = v[k]; }); return JSON.stringify(o); };
    return c(x) === c(y);
  }
  // then (a version) and now → { stats: [then, now], paras: [{ sid, k,
  // p, a, b }] (at most 200, more: true), items { add, del, chg },
  // styles { add, del, chg }, setup (changed), pages { add, del } }
  function diff(then, now) {
    var out = { stats: [stats(then), stats(now)], paras: [], more: false };
    var sa = byId(then.stories), sb = byId(now.stories), seen = {};
    function push(list) {
      list.forEach(function (x) { if (out.paras.length < PARA_MAX) out.paras.push(x); else out.more = true; });
    }
    (now.stories || []).forEach(function (st) {
      seen[st.id] = 1;
      push(diffParas((sa[st.id] || {}).paras || [], st.paras || []).map(function (x) { x.sid = st.id; return x; }));
    });
    (then.stories || []).forEach(function (st) {
      if (seen[st.id]) return;
      push(diffParas(st.paras || [], []).map(function (x) { x.sid = st.id; x.gone = 1; return x; }));
    });
    function sets(a, b, skip) {
      var A = byId(a), B = byId(b), r = { add: 0, del: 0, chg: 0 };
      Object.keys(B).forEach(function (id) { if (!A[id]) r.add++; else if (!same(A[id], B[id], skip)) r.chg++; });
      Object.keys(A).forEach(function (id) { if (!B[id]) r.del++; });
      return r;
    }
    out.items = sets(then.items, now.items, ["m"]);
    out.styles = sets((then.pstyles || []).concat(then.cstyles || []), (now.pstyles || []).concat(now.cstyles || []), ["m"]);
    out.swatches = sets(then.swatches, now.swatches, ["m"]);
    var pg = sets((then.pages || []).filter(function (p) { return !p.master; }), (now.pages || []).filter(function (p) { return !p.master; }), ["m", "pos"]);
    out.pages = { add: pg.add, del: pg.del };
    out.setup = !same(then.setup, now.setup, ["m"]);
    return out;
  }
  function cleanName(s) { return String(s || "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX); }

  var api = { stats: stats, words: words, paraText: paraText, diffWords: diffWords, diffParas: diffParas, diff: diff, cleanName: cleanName, KEEP: KEEP, NAME_MAX: NAME_MAX };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.LY_VERSIONS = api;

  // ---------- browser ----------
  var LY = root.LY;
  if (!LY) return;
  var t = LY.t, el = LY.el;
  var DB = "oros-layout-versions", dbP = null;
  function db() {
    if (!dbP) {
      dbP = new Promise(function (resolve, reject) {
        var rq;
        try { rq = indexedDB.open(DB, 1); } catch (e) { reject(e); return; }
        rq.onupgradeneeded = function () {
          var s = rq.result.createObjectStore("v", { keyPath: "key" });
          s.createIndex("doc", "doc");
        };
        rq.onsuccess = function () { resolve(rq.result); };
        rq.onerror = function () { reject(rq.error); };
      });
      dbP.catch(function () { dbP = null; });
    }
    return dbP;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tr = d.transaction("v", mode), out = fn(tr.objectStore("v"));
        tr.oncomplete = function () { resolve(out && "result" in out ? out.result : undefined); };
        tr.onerror = tr.onabort = function () { reject(tr.error); };
      });
    });
  }
  // the versions of a document, newest first, without their data
  function list(docId) {
    return tx("readonly", function (st) { return st.index("doc").getAll(docId); }).then(function (all) {
      return (all || []).sort(function (a, b) { return b.at - a.at; }).map(function (r) {
        return { key: r.key, name: r.name, at: r.at, by: r.by || "", st: r.st || {} };
      });
    });
  }
  function getOne(key) { return tx("readonly", function (st) { return st.get(key); }); }
  function del(key) { return tx("readwrite", function (st) { st.delete(key); }); }
  // a version of `doc` as it is now → Promise<key>
  function save(doc, name, by) {
    var nm = cleanName(name);
    if (!doc || !nm) return Promise.reject(new Error("name"));
    var at = Date.now(), rec = { key: doc.id + ":" + at + ":" + Math.random().toString(36).slice(2, 7), doc: doc.id, at: at, name: nm, by: by === "claude" ? "claude" : "", st: stats(doc), data: JSON.stringify(doc) };
    return tx("readwrite", function (st) { st.put(rec); }).then(function () {
      return list(doc.id).then(function (all) {
        var drop = all.slice(KEEP);
        if (drop.length) return tx("readwrite", function (st) { drop.forEach(function (r) { st.delete(r.key); }); });
      }).then(function () { return rec.key; });
    });
  }
  function when(at) {
    try { return new Date(at).toLocaleString(document.documentElement.lang || undefined, { dateStyle: "medium", timeStyle: "short" }); } catch (e) { return new Date(at).toLocaleString(); }
  }
  // the version back as new edits, after a version of how it is now
  function restore(key) {
    var doc = LY.doc;
    return getOne(key).then(function (r) {
      if (!r || !doc || r.doc !== doc.id) throw new Error("gone");
      LY.flushStory && LY.flushStory();
      return save(LY.doc, t("ver.beforeRestore", { name: r.name })).then(function () {
        if (!LY.restoreDoc(JSON.parse(r.data))) throw new Error("gone");
        LY.toast(t("ver.restored", { name: r.name }));
      });
    });
  }

  function diffView(box, r, now, close) {
    var then = JSON.parse(r.data), d = diff(then, now), s0 = d.stats[0], s1 = d.stats[1];
    box.innerHTML = "";
    box.appendChild(el("h3", "pn-h", t("ver.cmpTitle", { name: r.name })));
    var sum = el("ul", "ver-sum");
    function li(txt) { sum.appendChild(el("li", null, txt)); }
    li(t("ver.cmpPages", { a: s0.pages, b: s1.pages }));
    li(t("ver.cmpWords", { a: s0.words, b: s1.words }));
    if (d.items.add || d.items.del || d.items.chg) li(t("ver.cmpItems", { add: d.items.add, del: d.items.del, chg: d.items.chg }));
    if (d.styles.add || d.styles.del || d.styles.chg) li(t("ver.cmpStyles", { add: d.styles.add, del: d.styles.del, chg: d.styles.chg }));
    if (d.swatches.add || d.swatches.del || d.swatches.chg) li(t("ver.cmpSwatches", { add: d.swatches.add, del: d.swatches.del, chg: d.swatches.chg }));
    if (d.setup) li(t("ver.cmpSetup"));
    box.appendChild(sum);
    if (!d.paras.length) { box.appendChild(el("p", "hint", t("ver.cmpNoText"))); return; }
    box.appendChild(el("p", "hint", t("ver.cmpParas", { n: d.paras.length + (d.more ? "+" : "") })));
    d.paras.forEach(function (x) {
      var row = el("div", "ver-para ver-" + x.k);
      var head = el("div", "ver-ph");
      head.appendChild(el("span", "ver-k", t("ver.k." + x.k)));
      if (!x.gone && x.k !== "del" && LY.story && LY.story.openAt) {
        var go = LY.ui.btn(t("ver.go"), function () { close(); if (!LY.story.openAt(x.sid, x.p, 0, 0)) LY.toast(t("fc.noFrame")); }, "small");
        head.appendChild(go);
      }
      row.appendChild(head);
      var txt = el("p", "ver-txt");
      var parts = x.k === "chg" ? diffWords(x.a, x.b) : [[x.k === "add" ? "+" : "-", x.k === "add" ? x.b : x.a]];
      parts.forEach(function (pt, i) {
        var s = el(pt[0] === "+" ? "ins" : pt[0] === "-" ? "del" : "span", null, pt[1]);
        if (i) txt.appendChild(document.createTextNode(" "));
        txt.appendChild(s);
      });
      row.appendChild(txt);
      box.appendChild(row);
    });
    if (d.more) box.appendChild(el("p", "hint", t("ver.cmpMore", { n: PARA_MAX })));
  }

  function dialog() {
    var doc = LY.doc, ui = LY.ui;
    if (!doc) return;
    LY.flushStory && LY.flushStory();
    LY.openDialog(t("ver.title"), function (body, close) {
      var nameIn = el("input", "inp"); nameIn.type = "text"; nameIn.maxLength = NAME_MAX; nameIn.placeholder = t("ver.namePh");
      var row = el("div", "pn-row");
      row.appendChild(nameIn);
      var listBox = el("div", "ver-list"), cmp = el("div", "ver-cmp");
      row.appendChild(ui.btn(t("ver.save"), function () {
        var nm = cleanName(nameIn.value);
        if (!nm) { nameIn.focus(); LY.toast(t("ver.needName")); return; }
        LY.flushStory && LY.flushStory();
        save(LY.doc, nm).then(function () { nameIn.value = ""; LY.toast(t("ver.saved", { name: nm })); draw(); }, function () { LY.toast(t("ver.fail")); });
      }, "primary"));
      body.appendChild(ui.field(t("ver.new"), row, "block"));
      body.appendChild(el("p", "hint", t("ver.hint", { n: KEEP })));
      body.appendChild(listBox);
      body.appendChild(cmp);
      function draw() {
        list(doc.id).then(function (all) {
          listBox.innerHTML = "";
          if (!all.length) { listBox.appendChild(el("p", "hint", t("ver.none"))); return; }
          all.forEach(function (r) {
            var it = el("div", "ver-row");
            var info = el("div", "ver-info");
            info.appendChild(el("b", null, r.name));
            info.appendChild(el("span", "hint", when(r.at) + " · " + t("ver.meta", { p: r.st.pages || 0, w: r.st.words || 0 }) + (r.by === "claude" ? " · " + t("ver.byClaude") : "")));
            it.appendChild(info);
            var acts = el("div", "pn-row wrap");
            acts.appendChild(ui.btn(t("ver.compare"), function () {
              getOne(r.key).then(function (full) { if (full) { LY.flushStory && LY.flushStory(); diffView(cmp, full, LY.doc, close); cmp.scrollIntoView({ block: "start" }); } });
            }, "small"));
            acts.appendChild(ui.btn(t("ver.restore"), function () {
              close();
              restore(r.key).then(null, function () { LY.toast(t("ver.fail")); });
            }, "small"));
            // delete asks once, in place (no browser dialog)
            var sure = false, delB = ui.btn(t("ver.delete"), function () {
              if (!sure) { sure = true; delB.textContent = t("ver.deleteSure"); return; }
              del(r.key).then(draw, function () { LY.toast(t("ver.fail")); });
            }, "small");
            acts.appendChild(delB);
            it.appendChild(acts);
            listBox.appendChild(it);
          });
        }, function () { listBox.innerHTML = ""; listBox.appendChild(el("p", "hint", t("ver.noStore"))); });
      }
      draw();
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(ui.btn(t("btn.close"), close));
      body.appendChild(act);
    }, true);
  }

  LY.versions = { save: save, list: list, get: getOne, del: del, restore: restore, dialog: dialog };
})(typeof window !== "undefined" ? window : this);
