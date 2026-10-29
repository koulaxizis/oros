// ============================================================
// orOS Layout — recipes.js: Automations (wave A2, v1.0.0)
// The shared Automations panel (recipes/ui.js) with Layout's steps
// (recipesteps.js). A run works on the open document or on every
// document:
// - the open document changes through LY.op, one undo step; the
//   others are edited as copies and put back (LY.putDoc); the toast's
//   Undo takes every changed document back to how it was
//   (LY.restoreDoc: fresh stamps, so it syncs like any edit);
// - "grey" first makes black and white copies of the pictures it
//   would change (on the disk, LY.io.greyBlob), then edits like the
//   rest;
// - steps run in order on a working copy; preflight with "stop" keeps
//   a document with errors from being exported;
// - one PDF is saved with the usual Save dialog; several go to Files,
//   /internal/Layout/, under names that do not overwrite (without the
//   orOS disk they are downloaded one by one).
// Opens from More (editor) and the Automations button (home).
// ============================================================
(function () {
  "use strict";

  var LY = window.LY, M = LY.M, t = LY.t, S = window.LayoutRecipes, UI = window.orosRecipesUI;
  if (!S || !UI || !window.orosRecipes) return;
  var C = S.CATALOG, FOLDER = "/internal/Layout";

  function title(d) { return d.name || t("doc.untitled"); }
  function docs() { return LY.data().docs.filter(function (d) { return !M.needsNewer(d); }); }
  function named(n) { return M.label(n, LY.BASE); }

  // Styles and masters to pick from: the open document's, else every
  // document's. Seeded ones share ids in every document; others are
  // offered by name (recipesteps.resolve matches either).
  function pool(coll) {
    var src = LY.doc ? [LY.doc] : docs(), seen = {}, out = [];
    src.forEach(function (d) {
      (d[coll] || []).forEach(function (e) {
        var seed = /^(ps|ms)-[a-z0-9]{1,8}$/.test(e.id), v = seed ? e.id : named(e.name);
        if (!v || seen[v.toLocaleLowerCase()]) return;
        seen[v.toLocaleLowerCase()] = 1;
        out.push([v, named(e.name) || v]);
      });
    });
    return out;
  }
  function withCurrent(list, v) {
    if (v && !list.some(function (o) { return o[0] === v; })) list.push([v, v]);
    return list;
  }
  function choices(op, key, st) {
    if (op === "pstyle" && key === "to") return withCurrent(pool("pstyles"), st.to);
    if (op === "style" && key === "name") return withCurrent(pool("pstyles"), st.name);
    if (op === "pstyle" && key === "from") return [["", t("rc.anyStyle")]].concat(withCurrent(pool("pstyles"), st.from));
    if (op === "master" && key === "ms") return [["", t("rc.noMaster")]].concat(withCurrent(pool("masters"), st.ms));
    return null;
  }
  function pickName(v, coll) {
    if (!v) return "";
    var hit = null;
    (LY.doc ? [LY.doc] : docs()).forEach(function (d) { if (!hit) hit = S.resolve(d[coll], v); });
    return hit ? named(hit.name) : v;
  }

  function newStep(op) {
    var st = { op: op }, args = C[op].args;
    Object.keys(args).forEach(function (k) {
      var a = args[k];
      st[k] = a.def !== undefined ? a.def : a.t === "bool" ? 0 : "";
    });
    if (op === "pstyle") { var p = pool("pstyles"); st.to = p.length ? p[0][0] : ""; }
    if (op === "style") { var q = pool("pstyles"); st.name = q.length ? q[0][0] : ""; }
    if (op === "margins" && LY.doc) {
      var s0 = LY.doc.setup;
      ["t", "b", "i", "o"].forEach(function (k, i) {
        st[k] = Math.round(M.toUnit(s0[["mt", "mb", "mi", "mo"][i]], "mm") * 10) / 10;
      });
    }
    return st;
  }

  var ONOFF = { bold: 1, ital: 1, caps: 1, hyph: 1 };
  function enumLabel(op, key, v) { return t("rc.e." + (ONOFF[key] ? "onoff" : key) + "." + v); }
  function pagesText(p) { return p ? String(p) : t("rc.e.on.all"); }
  function describe(st) {
    switch (st.op) {
      case "text": return "“" + st.find + "” → “" + (st.repl || "") + "”";
      case "pstyle": return (st.from ? pickName(st.from, "pstyles") : t("rc.anyStyle")) + " → " + pickName(st.to, "pstyles");
      case "style": return pickName(st.name, "pstyles") + (st.size ? " · " + st.size + " pt" : "");
      case "master": return (st.ms ? pickName(st.ms, "masters") : t("rc.noMaster")) + " · " + enumLabel("master", "on", st.on);
      case "margins": return [st.t, st.b, st.i, st.o].join(" / ") + " mm";
      case "pages": return "+" + st.n + " · " + (st.at === "end" || !st.page ? enumLabel("pages", "at", "end") : enumLabel("pages", "at", st.at) + " " + st.page);
      case "delpages": return st.last && st.last !== st.first ? Math.min(st.first, st.last) + "–" + Math.max(st.first, st.last) : String(st.first);
      case "numbering": return enumLabel("numbering", "mode", st.mode) + " " + st.n;
      case "bleed": return st.mm + " mm";
      case "grey": return pagesText(st.pages);
      case "imgfit": return enumLabel("imgfit", "mode", st.mode) + " · " + pagesText(st.pages);
      case "preflight": return st.stop ? t("rc.f.stop") : "";
      case "export": return enumLabel("export", "q", st.q);
    }
    return "";
  }
  function note(op) {
    var k = "rc.n." + op, s = t(k);
    return s === k ? "" : s;
  }

  function targets() {
    var all = docs(), out = [];
    if (LY.doc) out.push(["this", t("rc.on.this", { name: title(LY.doc) })]);
    if (all.length > (LY.doc ? 1 : 0) || !LY.doc) out.push(["all", t("rc.on.all", { n: all.length })]);
    return all.length ? out : [];
  }
  function listFor(target) { return target === "this" && LY.doc ? [LY.doc] : docs(); }
  function preview(steps, target) {
    var n = listFor(target).length, lines = [];
    if (!n) return [t("rc.pv.none")];
    lines.push(n === 1 ? t("rc.pv.one") : t("rc.pv.many", { n: n }));
    if (steps.some(function (s) { return s.op === "export"; }) && n > 1) lines.push(t("rc.pv.pdfs"));
    return lines;
  }

  // ---------- PDFs ----------
  function diskFs() {
    try { var p = window.parent; return p && p !== window && p.orosFS ? p.orosFS : null; }
    catch (e) { return null; }
  }
  function ppi(st) { return st.q === "screen" ? 150 : 300; }
  function pdfOf(doc, st) {
    return LY.io.pdfBlob(doc, { spreads: !!st.spreads, bleed: !!st.bleed, marks: !!st.marks, ppi: ppi(st) });
  }
  function uniq(base, taken) {
    var name = base + ".pdf", n = 2;
    while (taken[name.toLowerCase()]) name = base + " (" + n++ + ").pdf";
    taken[name.toLowerCase()] = 1;
    return name;
  }

  // ---------- Black and white (async) ----------
  // The pictures the "grey" steps would change (found on a trial copy,
  // so pages added or removed before them count) get a greyscale copy
  // on the disk: → Promise of { grey: { asset id: copy id } }. A picture
  // that cannot be read keeps its colour.
  function greyCopies(doc, steps, ctl) {
    var ctx = { grey: {} }, ids = [];
    if (!steps.some(function (s) { return s.op === "grey"; })) return Promise.resolve(ctx);
    var trial = JSON.parse(JSON.stringify(doc)), nw = LY.now();
    steps.forEach(function (st) {
      if (st.op === "grey") S.greyAssets(trial, st).forEach(function (a) { if (ids.indexOf(a) < 0) ids.push(a); });
      else if (C[st.op].kind === "doc") S.apply(trial, st, nw);
    });
    var chain = Promise.resolve();
    ids.forEach(function (a) {
      chain = chain.then(function () {
        if (ctl.signal.aborted) return;
        return LY.A.blob(a).then(function (b) {
          if (!b) return;
          return LY.io.greyBlob(b, false).then(function (g) { return LY.A.importFile(g); }).then(function (res) { ctx.grey[a] = res.id; });
        }).then(null, function () {});
      });
    });
    return chain.then(function () { return ctx; });
  }

  // ---------- Run ----------
  function run(steps, target, ctl) {
    LY.flushStory && LY.flushStory();
    LY.closeMenu();
    var list = listFor(target).map(function (d) { return d.id; });
    var many = list.length > 1, fs = many ? diskFs() : null, taken = {};
    var snaps = [], edits = 0, touched = 0, pdfs = 0, held = 0, saved = [], pfE = 0, pfW = 0, pfRun = false;
    // "grey" is an edit too, once its black and white copies are made
    var editSteps = steps.filter(function (s) { return C[s.op].kind === "doc" || s.op === "grey"; });
    var chain = Promise.resolve();
    if (fs && steps.some(function (s) { return s.op === "export"; })) {
      chain = Promise.resolve(typeof fs.ready === "function" ? fs.ready() : null)
        .then(function () { return fs.ls(FOLDER); })
        .then(function (en) { (en || []).forEach(function (e) { taken[String(e.name).toLowerCase()] = 1; }); }, function () {});
    }
    list.forEach(function (id, i) {
      chain = chain.then(function () {
        if (ctl.signal.aborted) return;
        var cur = LY.findDoc(id);
        if (!cur) return;
        ctl.status(t("rc.doing", { i: i + 1, n: list.length, name: title(cur) }));
        return greyCopies(cur, steps, ctl).then(function (ctx) { return one(cur, ctx); });
      });
    });
    function one(cur, ctx) {
      cur = LY.findDoc(cur.id);   // it may have changed while the copies were made
      if (ctl.signal.aborted || !cur) return;
      var snap = JSON.parse(JSON.stringify(cur)), work = JSON.parse(JSON.stringify(cur));
      var n = 0, bad = false, kept = false, out = Promise.resolve(), nw = LY.now();
      steps.forEach(function (st) {
        var kind = C[st.op].kind;
        if (kind === "doc" || st.op === "grey") { n += S.apply(work, st, nw, ctx); return; }
        if (kind === "check") {
          var pf = S.problems(M.normDoc(JSON.parse(JSON.stringify(work))), LY.R, LY.A.isMissing);
          pfRun = true; pfE += pf.err; pfW += pf.warn;
          if (st.stop && pf.err) bad = true;
          return;
        }
        if (st.op === "export") {
          if (bad) { if (!kept) held++; kept = true; return; }   // counted once per document
          var copy = M.normDoc(JSON.parse(JSON.stringify(work)));
          out = out.then(function () {
            if (ctl.signal.aborted) return;
            return pdfOf(copy, st).then(function (blob) {
              if (!many) return LY.io.saveBlob(blob, LY.io.fileName(copy, ".pdf"), "application/pdf", "PDF", ".pdf").then(function (ok) { if (ok) pdfs++; });
              var base = LY.io.fileName(copy, "");
              if (!fs) return LY.io.saveBlob(blob, base + ".pdf", "application/pdf", "PDF", ".pdf").then(function (ok) { if (ok) pdfs++; });
              var file = uniq(base, taken);
              return fs.write(FOLDER + "/" + file, blob).then(function () { pdfs++; saved.push(file); });
            });
          });
        }
      });
      // the edits first (an export reflects them either way)
      if (n) {
        var done = cur === LY.doc
          ? LY.op(function (w, now) { var k = 0; editSteps.forEach(function (st) { k += S.apply(w, st, now, ctx); }); return k ? undefined : false; })
          : LY.putDoc(work);
        if (done) { snaps.push(snap); edits += n; touched++; }
      }
      return out;
    }
    return chain.then(function () {
      if (!LY.doc) LY.renderHome();
      var msg = [];
      if (editSteps.length) msg.push(edits ? t("rc.done", { n: edits, d: touched }) : t("rc.nochange"));
      if (pfRun) msg.push(t("rc.pf", { e: pfE, w: pfW }));
      if (held) msg.push(t("rc.held", { n: held }));
      if (pdfs) msg.push(saved.length ? (saved.length === 1 ? t("rc.pdfs1") : t("rc.pdfs", { n: saved.length })) : t("exp.done"));
      var res = { msg: msg.join(" ") };
      if (snaps.length) res.undo = function () {
        snaps.forEach(function (s) { LY.restoreDoc(s); });
        if (!LY.doc) LY.renderHome();
        LY.toast(t("rc.undone"));
      };
      return res;
    });
  }

  var panel = UI.mount({
    app: "layout", catalog: C, order: S.ORDER,
    t: t, enumLabel: enumLabel, choices: choices, newStep: newStep, describe: describe, note: note,
    dialog: function (ttl, build) { LY.openDialog(ttl, build, true); },
    toast: LY.toast, now: LY.now,
    cls: { inp: "inp", lbl: "fld-lbl" },
    targets: targets, preview: preview, run: run
  });
  LY.recipes = panel;
  // the black and white copies, also for the Assistant's changes (assist.js)
  LY.recipeGrey = greyCopies;

  var b = document.getElementById("btn-recipes");
  if (b) b.addEventListener("click", function () { panel.open(); });
})();
