// ============================================================
// orOS Layout — House style dialogs (v1.0.0, LY-HS)
// More › "House style…": in an ordinary document, learn a house style
// from earlier books (the documents picked from the list) into a new
// house style document; in a house style document, its rules sheet:
// the roles' paragraph styles, the rules (from the works, the Greek
// set, your own) turned on or off, and your own rules added in plain
// words, optionally with what they set. The learning and the rules are
// in layout/house.js (LY_HOUSE). More › "Automatic layout…": a
// manuscript (read by layout/io.js readDoc) and the book's details
// (typed, or from the Publishing app's titles, read only) become a new
// book in a house style (layout/autolay.js, LY-AUTO), with its report;
// "Update contents" makes the contents again from the pages. Before
// the layout, the book's questions (LY-IN, layout/intake.js): each with
// "as in the series" first; the answers are the book sheet, which More ›
// "Book sheet…" opens again for a new layout.
// ============================================================
(function () {
  "use strict";

  var LY = window.LY, M = LY.M, t = LY.t, el = LY.el;
  var H = window.LY_HOUSE, I = window.LY_INTAKE;
  var MAX_OWN = 400;
  // what an own rule may set: [id, role, set]
  var OWN_ACTS = [
    ["", "", null],
    ["titlePage", "title", { brk: "page" }],
    ["titleOdd", "title", { brk: "odd" }],
    ["kwn", "title", { kwn: 1 }],
    ["firstFlush", "first", { fi: 0 }],
    ["hyphOff", "body", { hyph: 0 }]
  ];

  function roleNames() {
    var n = {};
    H.ROLES.forEach(function (r) { n[r] = t("hs.role." + r); });
    return n;
  }
  function ruleText(r) {
    if (r.t) return r.t;
    var p = {};
    Object.keys(r.p || {}).forEach(function (k) { p[k] = LY.BASE === "el" && typeof r.p[k] === "number" ? String(r.p[k]).replace(".", ",") : r.p[k]; });
    return t("hr." + r.code, p);
  }

  function open() {
    if (!LY.doc) return;
    if (H.houseOf(LY.doc)) sheetDlg();
    else learnDlg();
  }

  // ---------- Learn ----------
  function learnDlg() {
    var docs = LY.data().docs.filter(function (d) { return !H.houseOf(d) && !M.needsNewer(d); });
    var pick = {};
    if (LY.doc && !H.houseOf(LY.doc)) pick[LY.doc.id] = 1;
    LY.openDialog(t("hs.learn"), function (body, close) {
      body.appendChild(el("p", "hint", t("hs.learnHint")));
      var name = el("input", "inp");
      name.type = "text"; name.maxLength = 120; name.value = t("hs.defName");
      body.appendChild(LY.ui.field(t("hs.name"), name));
      var list = el("div", "hs-works");
      docs.forEach(function (d) {
        list.appendChild(LY.ui.check(LY.docTitle(d) + " · " + t(d.pages.length === 1 ? "home.pages1" : "home.pages", { n: d.pages.length }), pick[d.id], function (v) {
          if (v) pick[d.id] = 1; else delete pick[d.id];
          go.disabled = !Object.keys(pick).length;
        }));
      });
      body.appendChild(list);
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(LY.ui.btn(t("btn.cancel"), close));
      var go = LY.ui.btn(t("hs.go"), function () {
        var works = docs.filter(function (d) { return pick[d.id]; });
        close();
        learn(works, name.value.trim() || t("hs.defName"));
      }, "primary");
      go.disabled = !Object.keys(pick).length;
      act.appendChild(go);
      body.appendChild(act);
    });
  }
  function learn(works, name, done, chat) {
    LY.flushStory && LY.flushStory();
    var res = null;
    try { res = H.learn(works, { now: LY.now(), name: name, names: roleNames() }); } catch (e) { res = null; }
    if (!res) { LY.toast(t("hs.none")); if (done) done(null); return; }
    LY.addDoc(res.doc);
    reportDlg(res.report, chat);
    if (done) done(res.report);
  }
  // back to the conversation a card came from (AS-HS)
  function backBtn(act, chat, close) {
    if (!chat) return;
    act.appendChild(LY.ui.btn(t("rb.back"), function () {
      close();
      try { window.parent.__orosOpenAt("assistant", { chat: chat }); } catch (e) {}
    }));
  }
  function reportDlg(rep, chat) {
    var h = H.houseOf(LY.doc);
    LY.openDialog(t("hs.done"), function (body, close) {
      var p = function (txt, cls) { body.appendChild(el("p", cls || "", txt)); };
      p(t("hs.repWorks", { n: rep.works }));
      p(t("hs.repPages", { f: rep.front, b: rep.back }));
      var ro = h.roles, names = [];
      H.ROLES.forEach(function (r) {
        var s = ro[r] && M.find(LY.doc.pstyles, ro[r]);
        if (s) names.push(t("hs.role." + r) + ": " + LY.label(s.name));
      });
      p(t("hs.repRoles", { list: names.join(" · ") }));
      p(t("hs.repRules", { n: h.rules.filter(function (r) { return r.src === "works"; }).length }), "hint");
      if (rep.skipped) p(t("hs.repSkipped", { n: rep.skipped }), "hint");
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      backBtn(act, chat, close);
      act.appendChild(LY.ui.btn(t("btn.ok"), close));
      act.appendChild(LY.ui.btn(t("hs.sheet"), function () { close(); sheetDlg(); }, "primary"));
      body.appendChild(act);
    });
  }

  // ---------- The rules sheet ----------
  function sheetDlg() {
    var doc = LY.doc, h = JSON.parse(JSON.stringify(H.houseOf(doc))), gone = [];
    var opts = [["", t("hs.noStyle")]].concat(doc.pstyles.map(function (s) { return [s.id, LY.label(s.name) || s.id]; }));
    LY.openDialog(t("hs.sheet"), function (body, close) {
      body.appendChild(el("p", "hint", t("hs.sheetHint", { n: h.from })));
      body.appendChild(el("h3", "pn-h", t("hs.roles")));
      H.ROLES.forEach(function (r) {
        body.appendChild(LY.ui.field(t("hs.role." + r), LY.ui.select(opts, h.roles[r] || "", function (v) {
          if (v) h.roles[r] = v; else delete h.roles[r];
        })));
      });
      var list = el("div", "hs-rules");
      function draw() {
        list.innerHTML = "";
        ["works", "greek", "own"].forEach(function (src) {
          var rs = h.rules.filter(function (r) { return r.src === src; });
          if (!rs.length) return;
          list.appendChild(el("h3", "pn-h", t("hs.src." + src)));
          rs.forEach(function (r) {
            var row = el("div", "hs-rule");
            if (r.a && r.a.k === "info") row.appendChild(el("p", "hint", ruleText(r)));
            else row.appendChild(LY.ui.check(ruleText(r), r.on, function (v) { r.on = v ? 1 : 0; }));
            if (src === "own") {
              var del = LY.ui.btn(t("hs.del"), function () {
                h.rules = h.rules.filter(function (x) { return x !== r; });
                r.on = 0;
                gone.push(r);
                draw();
              });
              row.appendChild(del);
            }
            list.appendChild(row);
          });
        });
      }
      draw();
      body.appendChild(list);
      // an own rule, in plain words
      body.appendChild(el("h3", "pn-h", t("hs.add")));
      var txt = el("input", "inp");
      txt.type = "text"; txt.maxLength = MAX_OWN; txt.placeholder = t("hs.addPh");
      body.appendChild(txt);
      var actSel = OWN_ACTS[0][0];
      body.appendChild(LY.ui.field(t("hs.addDoes"), LY.ui.select(OWN_ACTS.map(function (a) { return [a[0], t("hs.does." + (a[0] || "none"))]; }), "", function (v) { actSel = v; })));
      body.appendChild(LY.ui.btn(t("hs.addBtn"), function () {
        var words = txt.value.trim();
        if (!words) return;
        var a = OWN_ACTS.filter(function (x) { return x[0] === actSel; })[0];
        var n = 1;
        h.rules.forEach(function (r) { var k = parseInt(String(r.id).slice(1), 10); if (k >= n) n = k + 1; });
        h.rules.push({ id: "r" + n, src: "own", on: 1, t: words.slice(0, MAX_OWN), a: a && a[2] ? { k: "style", role: a[1], set: a[2] } : { k: "check" } });
        txt.value = "";
        draw();
      }));
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(LY.ui.btn(t("btn.cancel"), close));
      act.appendChild(LY.ui.btn(t("hs.save"), function () {
        close();
        save(h, gone);
      }, "primary"));
      body.appendChild(act);
    }, true);
  }
  // gone: own rules deleted in the sheet, applied once as off so their
  // settings come back out of the styles
  function save(h, gone) {
    var n = 0;
    LY.op(function (doc, now) {
      var before = JSON.stringify(doc.setup.ext.house);
      doc.setup.ext.house = { v: h.v, from: h.from, roles: h.roles, rules: h.rules.concat(gone) };
      n = H.apply(doc, now);
      doc.setup.ext.house = h;
      doc.setup.ext.wmap = H.wmapOf(h.roles);
      if (JSON.stringify(h) === before && !n) return false;
      doc.m = now;
    });
    LY.toast(t("hs.saved", { n: n }));
    return n;
  }

  // ---------- Automatic layout (LY-AUTO) ----------
  // The book's details from the Publishing app (its titles), read only
  function pubTitles() {
    var data = null;
    try { data = JSON.parse(localStorage.getItem("oros-publish-data") || "null"); } catch (e) { data = null; }
    var tombs = (data && data.tombs) || {};
    return ((data && data.titles) || []).filter(function (x) { return x && x.id && !(tombs[x.id] >= x.m) && x.t; }).map(function (x) {
      var isbn = "";
      (x.fmts || []).some(function (f) { if (f && f.isbn) { isbn = f.isbn; return true; } return false; });
      var au = (x.ppl || []).filter(function (p) { return p && p.r === "a" && p.n; }).map(function (p) { return p.n; }).join(", ");
      return { id: x.id, title: String(x.t), subtitle: String(x.sub || ""), author: au, isbn: isbn, year: /^\d{4}/.test(x.rel || "") ? x.rel.slice(0, 4) : "" };
    });
  }
  // pre: { house: id, sheet, name } from a book sheet
  function autoDlg(pre) {
    pre = pre && pre.sheet ? pre : null;
    var houses = LY.data().docs.filter(function (d) { return H.houseOf(d) && !M.needsNewer(d); });
    LY.openDialog(t("au.title"), function (body, close) {
      if (!houses.length) {
        body.appendChild(el("p", "hint", t("au.noHouse")));
        var a0 = el("div", "dlg-actions");
        a0.appendChild(el("span", "spacer"));
        a0.appendChild(LY.ui.btn(t("btn.cancel"), close));
        a0.appendChild(LY.ui.btn(t("hs.learn"), function () { close(); learnDlg(); }, "primary"));
        body.appendChild(a0);
        return;
      }
      body.appendChild(el("p", "hint", t("au.hint")));
      var cur = pre && houses.some(function (d) { return d.id === pre.house; }) ? pre.house : LY.doc && H.houseOf(LY.doc) ? LY.doc.id : houses[0].id;
      body.appendChild(LY.ui.field(t("au.house"), LY.ui.select(houses.map(function (d) { return [d.id, LY.docTitle(d)]; }), cur, function (v) { cur = v; })));
      var file = null, fname = el("span", "hint", t("au.noFile"));
      var fb = LY.ui.btn(t("au.file"), function () {
        LY.io.pickFile(LY.io.TEXT_ACCEPT).then(function (f) { if (f) { file = f; fname.textContent = f.name; go.disabled = false; } });
      });
      var frow = el("div", "pn-row");
      frow.appendChild(fb);
      frow.appendChild(fname);
      body.appendChild(frow);
      var meta = { title: pre ? String(pre.name || "") : "", subtitle: "", author: "", isbn: "", year: "", editor: "", publisher: "" }, inputs = {};
      var pubs = pubTitles();
      if (pubs.length) {
        body.appendChild(LY.ui.field(t("au.pub"), LY.ui.select([["", t("au.pubNone")]].concat(pubs.map(function (x) { return [x.id, x.title]; })), "", function (v) {
          var x = pubs.filter(function (y) { return y.id === v; })[0];
          Object.keys(meta).forEach(function (k) { if (x && x[k] !== undefined) { meta[k] = x[k]; inputs[k].value = meta[k]; } });
        })));
      }
      Object.keys(meta).forEach(function (k) {
        var inp = el("input", "inp");
        inp.type = "text"; inp.maxLength = 200; inp.value = meta[k];
        inp.addEventListener("input", function () { meta[k] = inp.value; });
        inputs[k] = inp;
        body.appendChild(LY.ui.field(t("au.f." + k), inp));
      });
      var keepFront = 0;
      body.appendChild(LY.ui.check(t("au.keepFront"), 0, function (v) { keepFront = v; }));
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(LY.ui.btn(t("btn.cancel"), close));
      var go = LY.ui.btn(t("au.go"), function () {
        var house = houses.filter(function (d) { return d.id === cur; })[0];
        close();
        build(house, file, meta, keepFront, null, "", { sheet: pre ? pre.sheet : null });
      }, "primary");
      go.disabled = true;
      act.appendChild(go);
      body.appendChild(act);
    });
  }
  // ask: { sheet, quiet, files, missed } → the book's questions (LY-IN):
  // the dialog first, or (quiet: the Assistant's answers) straight on;
  // files: photos besides the manuscript, missed: photos not received
  function build(house, file, meta, keepFront, done, chat, ask) {
    var fail = function () { LY.toast(t("txt.fail")); if (done) done(null); };
    var A = window.LY_AUTO, m = {};
    Object.keys(meta).forEach(function (k) { if (String(meta[k] || "").trim()) m[k] = String(meta[k]).trim(); });
    function make(r, sheet, extra) {
      LY.flushStory && LY.flushStory();
      var res = A.build(house, r.list, m, {
        now: LY.now(), pictures: r.pictures, keepFront: keepFront, name: file.name.replace(/\.[a-z]+$/i, ""),
        sheet: sheet, names: newNames(), tocHead: t("in.n.tocHead"), extra: extra
      });
      if (!res) { fail(); return; }
      if (ask && ask.missed) res.report.pictures = (res.report.pictures || 0) + ask.missed;
      LY.addDoc(res.doc);
      autoReport(res.report, chat);
      if (done) done(res.report);
    }
    if (!ask) LY.toast(t("au.working"));
    LY.io.readDoc(file, null, ask && I ? { pics: 1 } : null).then(function (r) {
      if (!r || !r.list.some(function (p) { return p.runs.length; })) { fail(); return; }
      if (!ask || !I) { make(r, null); return; }
      var px = I.pictures(r.list), s = A.structure(px.list, { keepFront: keepFront });
      var go = function (sheet, keep, files) {
        if (keep) keepAnswers(house, sheet);
        LY.toast(t("au.working"));
        var grey = I.ans(sheet, "grey") === "yes";
        importPics(r.list, files, grey).then(function (extra) { make(r, sheet, extra); }).then(null, fail);
      };
      var sheet0 = ask.sheet || I.defaults(house), files = (ask.files || []).slice(0, 500);
      if (!ask.quiet) { askDlg(house, I.info(house, s.list, s.cut), sheet0, px.pics, go, files, function () { if (done) done(null, "cancel"); }); return; }
      sheet0 = I.clean(sheet0);
      if (files.length && !sheet0.a.extraAt) sheet0.a.extraAt = "end";
      go(sheet0, false, files);
    }).then(null, fail);
  }
  // The pictures into the disk (designkit/assets.js), greyscale when the
  // sheet says so: the manuscript's (list "img" entries get a, nm, iw,
  // ih) and the files picked besides it. One that cannot be read stays
  // without an asset and the report counts it as left out.
  // → Promise of the extra pictures [{ a, nm, iw, ih }]
  function importPics(list, files, grey) {
    var chain = Promise.resolve(), extra = [];
    function one(blob, name) {
      return (grey ? toGrey(blob) : Promise.resolve(blob)).then(function (b) {
        try { b.name = name; } catch (e) { /* a File keeps its own name */ }
        return LY.A.importFile(b);
      }).then(function (res) { return { a: res.id, nm: String(name || res.name || "").slice(0, 120), iw: res.w, ih: res.h }; }, function () { return null; });
    }
    list.forEach(function (p) {
      if (p.role !== "img") return;
      var b = dataBlob(p.src);
      if (!b) return;
      chain = chain.then(function () { return one(b, p.alt || ""); }).then(function (r) { if (r) { p.a = r.a; p.nm = r.nm; p.iw = r.iw; p.ih = r.ih; } });
    });
    (files || []).forEach(function (f) {
      chain = chain.then(function () { return one(f, f.name); }).then(function (r) { extra.push(r || { nm: String(f.name || "").slice(0, 120) }); });
    });
    return chain.then(function () { return extra; });
  }
  // a data: URL (as Writer's reader gives a document's pictures) → Blob
  function dataBlob(src) {
    var m = /^data:([a-z]+\/[a-z0-9.+-]+)?(;base64)?,(.*)$/i.exec(String(src || ""));
    if (!m) return null;
    try {
      var raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]), u = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i);
      return new Blob([u], { type: m[1] || "image/png" });
    } catch (e) { return null; }
  }
  var GREY_SIDE = 4000;
  // → Promise of a greyscale JPEG of the picture (white under clear parts)
  function toGrey(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth || 1200, h = img.naturalHeight || 1200, k = Math.min(1, GREY_SIDE / Math.max(w, h));
        var cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
        var ctx = cv.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        var px = ctx.getImageData(0, 0, cv.width, cv.height), d = px.data;
        for (var i = 0; i < d.length; i += 4) {
          var y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
          d[i] = d[i + 1] = d[i + 2] = y;
        }
        ctx.putImageData(px, 0, 0);
        cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error("encode")); }, "image/jpeg", 0.92);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("decode")); };
      img.src = url;
    });
  }
  // the series' answers with the Assistant's on top (LY-IN)
  function overSheet(base, over) {
    var b = I.clean(base), o = I.clean(over);
    Object.keys(o.a).forEach(function (k) { b.a[k] = o.a[k]; });
    Object.keys(o.ty).forEach(function (k) {
      b.ty[k] = b.ty[k] || {};
      Object.keys(o.ty[k]).forEach(function (x) { b.ty[k][x] = o.ty[k][x]; });
    });
    ["ded", "motto"].forEach(function (k) { if (typeof o[k] === "string") b[k] = o[k]; });
    return b;
  }
  // the names of the styles a book sheet adds
  function newNames() {
    var n = {};
    ["part", "open", "sep", "toc", "tocHead", "thanks", "links", "ded", "pn", "first", "colophon", "cap"].forEach(function (k) { n[k] = t("in.n." + k); });
    return n;
  }
  // "keep as the series' rules": the answers (not the book's own pages,
  // dedication or motto) into the house style
  function keepAnswers(house, sheet) {
    var c = I.clean(sheet);
    LY.openDoc(house.id);
    LY.op(function (doc) {
      var h = H.houseOf(doc);
      if (!h) return false;
      var a = {};
      Object.keys(c.a).forEach(function (k) { if (k !== "pnStart") a[k] = c.a[k]; });
      h.answers = { a: a, ty: c.ty };
    });
  }

  // ---------- The book's questions (LY-IN) ----------
  var SEP_KEY = { "***": "stars", "* * *": "spaced", "\u2042": "aster" };
  function num(v) { return LY.BASE === "el" ? String(v).replace(".", ",") : String(v); }
  function optName(id, v) { return t("in." + id + "." + (SEP_KEY[v] || v)); }
  function famName(house, f) {
    if (!f) return "";
    if (/^(serif|sans|mono)$/.test(f)) return t("in.font." + f);
    var e = LY.F.docFonts(house).filter(function (x) { return x.id === f; })[0];
    return e ? e.name : f;
  }
  function lookTxt(house, l) {
    if (!l) return "";
    return famName(house, l.fam) + " " + num(l.size) + "/" + num(l.lead) + " · " + t("in.align." + l.align) + (l.b ? " · " + t("sty.b") : "") + (l.i ? " · " + t("sty.i") : "") + (l.caps ? " · " + t("sty.caps") : "");
  }
  // the series' answer to a question, in words
  function seriesOf(id, S) {
    if (id === "size") return S.size + " mm";
    if (id === "sink") return S.sink ? t("in.mm", { n: num(S.sink) }) : optName("sink", "top");
    if (id === "sep") return S.sep || optName("sep", "keep");
    if (id === "parts") return optName("parts", "own");
    if (id === "tocParts") return optName("tocParts", "parts");
    return S[id] ? optName(id, S[id]) : "";
  }
  function numIn(value, ph, onSet, min, max) {
    var inp = el("input", "inp num");
    inp.type = "text"; inp.inputMode = "decimal"; inp.placeholder = ph === undefined ? "" : String(ph);
    inp.value = value === undefined || value === null ? "" : num(value);
    inp.addEventListener("change", function () {
      var v = parseFloat(String(inp.value).replace(",", "."));
      if (inp.value.trim() === "" || !isFinite(v)) { inp.value = ""; onSet(undefined); return; }
      v = Math.min(max, Math.max(min, v));
      inp.value = num(v);
      onSet(v);
    });
    return inp;
  }
  // cancel: called when the dialog closes without a layout
  function askDlg(house, inf, sheet0, pics, go, files0, cancel) {
    var sheet = I.clean(sheet0), S = inf.series, a = sheet.a, files = (files0 || []).slice(), urls = [];
    var bye = function () { urls.forEach(function (u) { URL.revokeObjectURL(u); }); urls = []; };
    LY.openDialog(t("in.title"), function (body, close) {
      var dlg = body.parentNode, went = false;
      dlg.addEventListener("close", function gone() {
        dlg.removeEventListener("close", gone);
        bye();
        if (!went && cancel) cancel();
      });
      body.appendChild(el("p", "hint", t("in.hint", { n: inf.titles })));
      var quick = el("div", "pn-row");
      quick.appendChild(LY.ui.btn(t("in.allSeries"), function () { went = true; close(); go(I.defaults(house), false, files); }));
      body.appendChild(quick);
      function group(key) { body.appendChild(el("h3", "pn-h", t("in.g." + key))); }
      function ask(id) { askIn(id, body); }
      function askIn(id, into, then) {
        var q = I.QUESTIONS.filter(function (x) { return x.id === id; })[0];
        if (q.when && !inf[q.when] && !(q.when === "pics" && files.length)) return;
        var ser = seriesOf(id, S);
        var opts = q.v.map(function (v) { return [v, v === "s" ? t("in.series", { v: ser }) : optName(id, v)]; });
        into.appendChild(LY.ui.field(t("in.q." + id), LY.ui.select(opts, a[id] || "s", function (v) {
          if (v === "s") delete a[id]; else a[id] = v;
          if (then) then();
        })));
      }
      // A. page and structure
      group("page");
      ask("size");
      var mg = el("div", "grid2"), marg = a.marg || {};
      ["t", "b", "i", "o"].forEach(function (k) {
        mg.appendChild(LY.ui.field(t("in.marg." + k) + " (mm)", numIn(marg[k], num(S.marg[k]), function (v) {
          if (v === undefined) delete marg[k]; else marg[k] = v;
          if (Object.keys(marg).length) a.marg = marg; else delete a.marg;
        }, 0, 199)));
      });
      body.appendChild(el("span", "fld-lbl", t("in.q.marg")));
      body.appendChild(mg);
      ["start", "parts", "sink", "first", "sep", "pn", "pnHide"].forEach(ask);
      body.appendChild(LY.ui.field(t("in.q.pnStart"), numIn(a.pnStart, S.pnStart, function (v) { if (v === undefined) delete a.pnStart; else a.pnStart = Math.floor(v); }, 0, 9999)));
      ["toc", "tocParts"].forEach(ask);
      // B. front and back pages; the manuscript's sections
      group("front");
      if (inf.pages.length) {
        body.appendChild(el("span", "fld-lbl", t("in.q.pages")));
        var pl = el("div", "hs-works"), drop = {};
        sheet.drop.forEach(function (id) { drop[id] = 1; });
        inf.pages.forEach(function (p) {
          var lbl = t("pf.page", { n: p.no }) + " · " + t("in.side." + p.side) + (p.toc ? " · " + t("in.tocPage") : p.text ? " · " + p.text : "");
          pl.appendChild(LY.ui.check(lbl, !drop[p.id], function (v) { if (v) delete drop[p.id]; else drop[p.id] = 1; sheet.drop = Object.keys(drop); }));
        });
        body.appendChild(pl);
      }
      Object.keys(inf.sections).forEach(function (k) {
        var id = I.atKey(k);
        body.appendChild(LY.ui.field(t("in.q.at", { s: t("in.sec." + k) }), LY.ui.select(I.AT.map(function (v) { return [v, t("in.at." + v)]; }), a[id] || "s", function (v) { if (v === "s") delete a[id]; else a[id] = v; })));
      });
      ["ded", "motto"].forEach(function (k) {
        var ta = el("textarea", "inp");
        ta.rows = 2; ta.maxLength = 2000; ta.value = typeof sheet[k] === "string" ? sheet[k] : inf[k] || "";
        ta.placeholder = t("in.none");
        ta.addEventListener("input", function () { sheet[k] = ta.value; });
        body.appendChild(LY.ui.field(t("in.q." + k), ta));
      });
      // C. typography per part
      group("type");
      var parts = ["body", "title"];
      if (inf.parts) parts.push("part");
      if (S.toc !== "none") parts.push("toc");
      if (inf.colophon) parts.push("colophon");
      if (inf.sections.thanks) parts.push("thanks");
      if (inf.sections.links) parts.push("links");
      parts.push("ded");
      if (inf.pics) parts.push("cap");
      var fonts = [["", t("in.asSeries")], ["serif", t("in.font.serif")], ["sans", t("in.font.sans")], ["mono", t("in.font.mono")]]
        .concat(LY.F.docFonts(house).map(function (e) { return [e.id, e.name]; }));
      parts.forEach(function (k) {
        var look = sheet.ty[k] = sheet.ty[k] || {}, ser = lookTxt(house, S.ty[k]);
        var row = el("div", "in-part");
        row.appendChild(el("span", "fld-lbl", t("in.part." + k) + (ser ? " · " + t("in.series", { v: ser }) : "")));
        var g = el("div", "grid2");
        g.hidden = !Object.keys(look).length;
        var more = LY.ui.btn(t("in.change"), function () { g.hidden = !g.hidden; });
        row.appendChild(more);
        var setK = function (key) { return function (v) { if (v === undefined || v === "") delete look[key]; else look[key] = v; }; };
        g.appendChild(LY.ui.field(t("in.font"), LY.ui.select(fonts, look.fam || "", setK("fam"))));
        g.appendChild(LY.ui.field(t("in.size") + " (pt)", numIn(look.size, S.ty[k] ? num(S.ty[k].size) : "", setK("size"), 4, 200)));
        g.appendChild(LY.ui.field(t("in.lead") + " (pt)", numIn(look.lead, S.ty[k] ? num(S.ty[k].lead) : "", setK("lead"), 0, 400)));
        g.appendChild(LY.ui.field(t("in.alignQ"), LY.ui.select([["", t("in.asSeries")]].concat(["l", "c", "r", "j"].map(function (v) { return [v, t("in.align." + v)]; })), look.align || "", setK("align"))));
        ["b", "i", "caps"].forEach(function (key) {
          g.appendChild(LY.ui.field(t("sty." + key), LY.ui.select([["", t("in.asSeries")], ["1", t("in.yes")], ["0", t("in.no")]], look[key] === undefined ? "" : String(look[key]), function (v) { if (v === "") delete look[key]; else look[key] = +v; })));
        });
        g.appendChild(LY.ui.field(t("in.track"), numIn(look.track, S.ty[k] ? num(S.ty[k].track) : "", setK("track"), -200, 1000)));
        row.appendChild(g);
        body.appendChild(row);
      });
      // E. pictures: the manuscript's and others picked here
      group("pics");
      var pg = el("div");
      body.appendChild(pg);
      var each = !!(sheet.pics && sheet.pics.some(function (x) { return x.at || x.cap; }));
      function picRow(k, src, name) {
        var o = sheet.pics[k] = sheet.pics[k] || {}, row = el("div", "in-pic");
        var im = el("img");
        im.alt = ""; im.src = src;
        row.appendChild(im);
        var col = el("div", "in-pic-f");
        col.appendChild(el("span", "fld-lbl", (k + 1) + ". " + (name || t("in.picN", { n: k + 1 }))));
        if (k < pics.length && I.ans(sheet, "picAt") === "each") {
          col.appendChild(LY.ui.select(I.PIC_AT.map(function (v) { return [v, v === "s" ? t("in.series", { v: seriesOf("picAt", S) }) : optName("picAt", v)]; }), o.at || "s", function (v) { if (v === "s") delete o.at; else o.at = v; }));
        }
        var cap = el("input", "inp");
        cap.type = "text"; cap.maxLength = 300; cap.value = o.cap || ""; cap.placeholder = t("in.capPh");
        cap.addEventListener("input", function () { if (cap.value.trim()) o.cap = cap.value; else delete o.cap; });
        col.appendChild(cap);
        row.appendChild(col);
        return row;
      }
      function drawPics() {
        pg.textContent = "";
        sheet.pics = sheet.pics || [];
        if (inf.pics) pg.appendChild(el("p", "hint", t("in.picsHint", { n: inf.pics })));
        ["picAt", "picSize", "cap", "capSrc", "grey"].forEach(function (id) { askIn(id, pg, id === "picAt" || id === "capSrc" ? drawPics : null); });
        // the other photos (a folder's section): where they go
        var ex = el("div", "pn-row");
        ex.appendChild(LY.ui.btn(t("in.extra"), function () {
          LY.io.pickFiles("image/*").then(function (fs) {
            fs.forEach(function (f) { if (files.length < 500 - pics.length) files.push(f); });
            drawPics();
          });
        }));
        if (files.length) ex.appendChild(el("span", "hint", t("in.extraN", { n: files.length })));
        pg.appendChild(ex);
        if (files.length) {
          var at = [["end", t("in.extraAt.end")]].concat(inf.chapters.map(function (c, i) { return ["after" + i, t("in.extraAt.after", { t: c || i + 1 })]; }));
          pg.appendChild(LY.ui.field(t("in.q.extraAt"), LY.ui.select(at, a.extraAt || "end", function (v) { a.extraAt = v; })));
        }
        var n = pics.length + files.length;
        if (!n) return;
        if (I.ans(sheet, "picAt") === "each" || I.ans(sheet, "capSrc") === "typed") each = true;
        var tg = LY.ui.btn(t("in.eachPic", { n: n }), function () { each = !each; drawPics(); });
        pg.appendChild(tg);
        if (!each) return;
        var ls = el("div", "in-pics");
        pics.forEach(function (p, k) { ls.appendChild(picRow(k, /^data:image\//i.test(p.src) ? p.src : "", p.alt)); });
        files.forEach(function (f, j) {
          var u = URL.createObjectURL(f);
          urls.push(u);
          ls.appendChild(picRow(pics.length + j, u, f.name));
        });
        pg.appendChild(ls);
      }
      drawPics();
      // D. text
      group("text");
      ["hyph", "widows", "fix"].forEach(ask);
      var keep = 0;
      body.appendChild(LY.ui.check(t("in.keep"), 0, function (v) { keep = v; }));
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(LY.ui.btn(t("btn.cancel"), close));
      act.appendChild(LY.ui.btn(t("au.go"), function () {
        Object.keys(sheet.ty).forEach(function (k) { if (!Object.keys(sheet.ty[k]).length) delete sheet.ty[k]; });
        if (sheet.pics) {
          sheet.pics = sheet.pics.slice(0, pics.length + files.length);
          for (var k = 0; k < sheet.pics.length; k++) sheet.pics[k] = sheet.pics[k] || {};
          if (!sheet.pics.some(function (x) { return x.at || x.cap; })) delete sheet.pics;
        }
        if (files.length && !a.extraAt) a.extraAt = "end";
        went = true;
        close();
        go(sheet, keep, files);
      }, "primary"));
      body.appendChild(act);
    }, true);
  }
  // More › "Book sheet…": the answers this book was made with, for a
  // new layout of it
  function hasSheet(doc) { return !!(doc && doc.setup.ext && doc.setup.ext.book && doc.setup.ext.book.v); }
  function sheetAgain() {
    if (!hasSheet(LY.doc)) return;
    var b = LY.doc.setup.ext.book;
    autoDlg({ house: b.house, sheet: b, name: LY.docTitle(LY.doc) });
  }
  function autoReport(rep, chat) {
    LY.openDialog(t("au.done"), function (body, close) {
      var p = function (txt, cls) { body.appendChild(el("p", cls || "", txt)); };
      p(t("au.repPages", { n: rep.pages, b: rep.body }));
      p(t("au.repTitles", { n: rep.titles }));
      if (rep.guessed) p(t("au.repGuessed", { n: rep.guessed }), "hint warn");
      var fx = rep.fixes;
      p(t("au.repFixes", { q: fx.quotes, d: fx.dash, e: fx.ellipsis, s: fx.spaces }), "hint");
      p(t("au.repFields", { n: rep.fields }), "hint");
      if (rep.toc >= 0) p(t("au.repToc", { n: rep.toc }), "hint");
      if (rep.front) p(t("au.repFront", { n: rep.front }), "hint");
      if (rep.dropped) p(t("au.repDropped", { n: rep.dropped }), "hint");
      var ns = Object.keys(rep.noStyle).map(function (k) { return t("wd." + k) + " (" + rep.noStyle[k] + ")"; });
      if (ns.length) p(t("au.repNoStyle", { list: ns.join(", ") }), "hint warn");
      if (rep.placed) p(t("au.repPlaced", { n: rep.placed }), "hint");
      if (rep.pictures) p(t(rep.placed !== undefined ? "au.repPicsOut" : "au.repPics", { n: rep.pictures }), "hint warn");
      if (rep.overset) p(t("au.repOverset"), "hint warn");
      if (rep.sheet) {
        if (rep.moved) p(t("au.repMoved", { n: rep.moved }), "hint");
        if (rep.left) p(t("au.repLeft", { n: rep.left }), "hint");
        if (rep.bare) p(t("au.repBare", { n: rep.bare }), "hint");
      }
      if (rep.check.length) {
        p(t("au.repCheck"), "hint warn");
        var ul = el("ul", "pf-list");
        rep.check.forEach(function (x) {
          var li = el("li"), b = el("button", "pf-item warn");
          b.type = "button";
          b.appendChild(el("span", "pf-dot"));
          b.appendChild(el("span", "", t("pf.page", { n: x.page }) + " · " + t("au.why." + x.why)));
          b.addEventListener("click", function () { close(); LY.ed.gotoItem(x.id); });
          li.appendChild(b);
          ul.appendChild(li);
        });
        body.appendChild(ul);
      }
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      backBtn(act, chat, close);
      act.appendChild(LY.ui.btn(t("btn.close"), close, "primary"));
      body.appendChild(act);
    });
  }
  function hasToc(doc) { return !!(doc && H.houseOf(doc) && doc.stories.some(function (s) { return s.ext && s.ext.hs === "toc"; })); }
  function updateToc() {
    var n = -1;
    LY.flushStory && LY.flushStory();
    LY.op(function (doc, now) {
      var st = null;
      doc.stories.forEach(function (s) { if (s.ext && s.ext.hs === "toc") st = s; });
      if (!st) return false;
      var before = JSON.stringify(st.paras);
      n = window.LY_AUTO.toc(doc);
      if (n < 0 || JSON.stringify(st.paras) === before) return false;
      st.h = [st.m].concat(st.h || []);
      M.touch(st, now);
    });
    LY.toast(n < 0 ? t("au.noToc") : t("au.tocDone", { n: n }));
  }

  // ---------- From the Assistant (AS-HS) ----------
  // rq: { op: "learn", docs, name } | { op: "book", house, meta,
  // keepFront } with file | { op: "rule", text, does, house }; done gets
  // the report for the Assistant's card, or { failed, why }.
  function byName(list, want) {
    var w = String(want || "").replace(/\s+/g, " ").trim().toLocaleLowerCase(), newest = function (a, b) { return (b.m || 0) - (a.m || 0); };
    if (!w) return null;
    var hit = list.filter(function (d) { return LY.docTitle(d).toLocaleLowerCase() === w; });
    if (!hit.length) hit = list.filter(function (d) { return LY.docTitle(d).toLocaleLowerCase().indexOf(w) >= 0; });
    return hit.sort(newest)[0] || null;
  }
  function houseNamed(name) {
    var houses = LY.data().docs.filter(function (d) { return H.houseOf(d) && !M.needsNewer(d); });
    if (name) return byName(houses, name);
    return houses.sort(function (a, b) { return (b.m || 0) - (a.m || 0); })[0] || null;
  }
  // photos, missed: the photos besides the manuscript the card handed
  // over (Files), and how many of them could not be taken
  function run(rq, file, done, photos, missed) {
    var chat = typeof rq.chat === "string" ? rq.chat.slice(0, 80) : "";
    var fail = function (why, more) { var o = { failed: 1, why: why }; if (more) o.missing = more; done(o); };
    if (rq.op === "learn") {
      var docs = LY.data().docs.filter(function (d) { return !H.houseOf(d) && !M.needsNewer(d); }), works = [], missing = [];
      (Array.isArray(rq.docs) ? rq.docs : []).slice(0, 40).forEach(function (n) {
        var d = byName(docs, n);
        if (d && works.indexOf(d) < 0) works.push(d); else if (!d) missing.push(String(n).slice(0, 120));
      });
      if (!works.length) { LY.toast(t("hs.none")); fail("noDocs", missing); return; }
      learn(works, String(rq.name || "").trim().slice(0, 120) || t("hs.defName"), function (rep) {
        if (!rep) { fail("learn"); return; }
        var h = H.houseOf(LY.doc);
        done({ works: rep.works, front: rep.front, back: rep.back, roles: rep.roles, rules: h ? h.rules.filter(function (r) { return r.src === "works"; }).length : 0, missing: missing });
      }, chat);
      return;
    }
    var house = houseNamed(typeof rq.house === "string" ? rq.house : "");
    if (!house) { LY.toast(rq.house ? t("hs.noNamed", { n: String(rq.house).slice(0, 120) }) : t("au.noHouse")); fail("noHouse"); return; }
    if (rq.op === "rule") {
      var text = String(rq.text || "").trim().slice(0, MAX_OWN);
      if (!text) { fail("rule"); return; }
      LY.openDoc(house.id);
      var h = JSON.parse(JSON.stringify(H.houseOf(house)));
      var a = OWN_ACTS.filter(function (x) { return x[0] && x[0] === rq.does; })[0], n = 1;
      h.rules.forEach(function (r) { var k = parseInt(String(r.id).slice(1), 10); if (k >= n) n = k + 1; });
      h.rules.push({ id: "r" + n, src: "own", on: 1, t: text, a: a ? { k: "style", role: a[1], set: a[2] } : { k: "check" } });
      done({ changes: save(h, []) });
      sheetDlg();
      return;
    }
    // the book's details: what the Assistant gave, the rest from the
    // Publishing app's title of that name
    var meta = {}, given = rq.meta && typeof rq.meta === "object" ? rq.meta : {};
    ["title", "subtitle", "author", "isbn", "year", "publisher"].forEach(function (k) { if (typeof given[k] === "string" && given[k].trim()) meta[k] = given[k].trim().slice(0, 200); });
    var pub = meta.title ? pubTitles().filter(function (x) { return x.title.trim().toLocaleLowerCase() === meta.title.toLocaleLowerCase(); })[0] : null;
    if (pub) ["subtitle", "author", "isbn", "year"].forEach(function (k) { if (!meta[k] && pub[k]) meta[k] = pub[k]; });
    // the book's questions (LY-IN): the Assistant's answers over the
    // series'; "All the questions…" shows them first
    var ask = I ? { sheet: overSheet(I.defaults(house), rq.sheet), quiet: rq.all !== 1, files: Array.isArray(photos) ? photos : [], missed: missed > 0 ? missed : 0 } : null;
    build(house, file, meta, rq.keepFront === 1 ? 1 : 0, function (rep, why) { if (rep) done(rep); else fail(why || "read"); }, chat, ask);
  }

  LY.house = { open: open, auto: function () { autoDlg(); }, hasToc: hasToc, updateToc: updateToc, run: run, hasSheet: hasSheet, sheet: sheetAgain };
})();
