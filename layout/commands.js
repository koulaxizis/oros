// ============================================================
// orOS Layout — commands.js: what the Assistant may change in a
// document (AS-EDIT for Layout, v1.0.0)
// The commands are Layout's automation steps (recipesteps.js, LY-IN
// wave Q5) without preflight and export, plus rename; the Assistant
// never writes code or raw data, it sends { op, …fields } that
// check() accepts. The same file runs in two places:
//   - in the Assistant, to check a command list, find the documents it
//     is for (targets), count what it would change on copies of the
//     stored documents (preview) and describe a document to the AI
//     (outline, with the user's consent);
//   - in Layout (assist.js), which applies it.
// Styles and masters are named by id or by name (any language, any
// case), pages by position ("3-10,12", 1 = the first page).
// apply(doc, step, env) edits a copy of a document in place and
// returns how many things changed. env: { now, grey: { asset id: its
// black and white copy } }. Without the text engine (the Assistant
// loads only the model) pages are added without running text on and
// fit counts as one change, made when Layout applies it (note "fitLater").
// Pure: no DOM. Exposes window.LayoutCommands (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var R = node ? require("../recipes/core.js") : root.orosRecipes;
  var S = node ? require("./recipesteps.js") : root.LayoutRecipes;
  var SH = node ? require("../recipes/share.js") : root.orosRecipeShare;
  var M = node ? require("../designkit/model.js") : root.orosDK && root.orosDK.model;
  if (!R || !S || !M) return;
  function hasEngine() { return node || !!(root.orosDK && root.orosDK.render && root.orosDK.text); }

  var OPS = ["text", "pstyle", "style", "master", "margins", "pages", "delpages", "fit", "numbering", "bleed", "grey", "imgfit"];
  var CATALOG = {};
  OPS.forEach(function (op) { CATALOG[op] = S.CATALOG[op]; });
  CATALOG.rename = { kind: "doc", args: { title: { t: "str", max: 120, req: 1 } } };
  var ORDER = OPS.concat(["rename"]);
  var MAX_STEPS = 40;

  // What each command does, for the model (the automation guide's
  // words, a test checks that every op and field is named).
  var GUIDE = "Layout commands (documents are print layouts: books, magazines, brochures; styles and masters by name, e.g. Body text; pages by position, 1 = the first page; null or \"\" leaves a field as it is):\n" +
    OPS.map(function (op) { return op + ": " + SH.GUIDE.layout.ops[op]; }).join("\n") +
    "\nrename: the document's name becomes `title`";

  // ---------- 1. Checking ----------
  function given(v) { return v !== null && v !== undefined && v !== ""; }
  function wrap(op) { var c = {}; c[op] = CATALOG[op]; return c; }
  // One command → { step } or { err } (English, for the model).
  function checkStep(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.op !== "string") return { err: "a command needs op" };
    var def = Object.prototype.hasOwnProperty.call(CATALOG, raw.op) ? CATALOG[raw.op] : null;
    if (!def) return { err: "unknown command " + JSON.stringify(String(raw.op).slice(0, 40)) + " (use " + ORDER.join(", ") + ")" };
    var bad = [];
    Object.keys(raw).forEach(function (k) {
      if (k === "op" || raw[k] === null || raw[k] === undefined) return;
      var spec = def.args[k];
      if (!spec) { bad.push(k + " is not a field of " + raw.op); return; }
      var v = R.arg(spec, raw[k]);
      if (v === undefined || (spec.t === "enum" && spec.v.indexOf(raw[k]) < 0) ||
          ((spec.t === "num" || spec.t === "int") && (raw[k] < spec.lo || raw[k] > spec.hi))) {
        bad.push(k + " " + JSON.stringify(raw[k]).slice(0, 60) + " is not allowed");
      }
    });
    Object.keys(def.args).forEach(function (k) { if (def.args[k].req && !given(raw[k])) bad.push(k + " is missing"); });
    if (typeof raw.pages === "string" && !S.pageTest(raw.pages)) bad.push("pages " + JSON.stringify(raw.pages) + " is not a page list");
    var st = bad.length ? null : R.normStep(raw, wrap(raw.op));
    if (!st) return { err: raw.op + ": " + (bad.join("; ") || "not valid") };
    return { step: st };
  }
  // A command list → { ok, steps } | { ok: false, err }
  function check(list) {
    if (!Array.isArray(list) || !list.length) return { ok: false, err: "steps is empty" };
    if (list.length > MAX_STEPS) return { ok: false, err: "at most " + MAX_STEPS + " commands" };
    var steps = [], errs = [];
    list.forEach(function (raw, i) {
      var r = checkStep(raw);
      if (r.err) errs.push("command " + (i + 1) + " " + r.err);
      else steps.push(r.step);
    });
    if (errs.length) return { ok: false, err: errs.slice(0, 6).join(". ") };
    return { ok: true, steps: steps };
  }

  // ---------- 2. Applying ----------
  function apply(doc, st, env) {
    env = env || {};
    var now = env.now || Date.now();
    if (!doc.tombs) doc.tombs = {};
    if (st.op === "rename") {
      if (doc.name === st.title) return 0;
      doc.name = st.title;
      doc.m = Math.max(now, (doc.m || 0) + 1);
      return 1;
    }
    if (!hasEngine()) {
      if (st.op === "fit") { if (env.notes && env.notes.indexOf("fitLater") < 0) env.notes.push("fitLater"); return 1; }
      if (st.op === "pages" && st.flow) st = Object.assign({}, st, { flow: 0 });
    }
    return S.apply(doc, st, now, { grey: env.grey || {} });
  }

  // ---------- 3. For the Assistant ----------
  function norm(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }
  function docsOf(data) {
    return (data && Array.isArray(data.docs) ? data.docs : []).filter(function (d) { return d && d.id && !M.needsNewer(d); });
  }
  // Which documents a request is for. data: the stored Layout data,
  // folders: none in Layout, open: the open (or last opened) document's
  // id. designs: open | named | all; name: the document's name.
  function targets(data, folders, open, designs, name) {
    var docs = docsOf(data);
    if (!docs.length) return { ok: false, err: "the user has no documents in Layout yet" };
    var list = [];
    if (designs === "all") list = docs.slice();
    else if (designs === "folder") return { ok: false, err: "Layout has no folders; use designs named or all" };
    else if (designs === "named") {
      var q = norm(name);
      if (!q) return { ok: false, err: "give the document's name" };
      list = docs.filter(function (d) { return norm(d.name) === q; });
      if (!list.length) list = docs.filter(function (d) { return norm(d.name).indexOf(q) >= 0; });
      if (!list.length) return { ok: false, err: "no document is called " + JSON.stringify(String(name).slice(0, 80)) + "; documents: " + docs.slice(0, 30).map(function (d) { return JSON.stringify(d.name || "Untitled"); }).join(", ") };
      if (list.length > 1 && !docs.some(function (d) { return norm(d.name) === q; })) {
        return { ok: false, err: "several documents match " + JSON.stringify(String(name).slice(0, 80)) + ": " + list.slice(0, 20).map(function (d) { return JSON.stringify(d.name); }).join(", ") + "; give the whole name" };
      }
    } else {
      var o = null;
      docs.forEach(function (d) { if (d.id === open) o = d; });
      if (!o) return { ok: false, err: "no document is open in Layout; name the document (designs: named)" };
      list = [o];
    }
    return { ok: true, docs: list.map(function (d) { return { id: d.id, name: d.name || "" }; }) };
  }
  // What a list of commands would change, on copies: { n, d, per[{id,
  // name, n}], cut: 0, notes[] }. Black and white counts the pictures
  // it would change (their copies are made when Layout applies it).
  function preview(data, ids, steps) {
    var docs = docsOf(data), out = { n: 0, d: 0, per: [], cut: 0, notes: [] };
    ids.forEach(function (id) {
      var src = null;
      docs.forEach(function (d) { if (d.id === id) src = d; });
      if (!src) return;
      var w = JSON.parse(JSON.stringify(src)), k = 0, grey = {};
      steps.forEach(function (st) {
        if (st.op === "grey") S.greyAssets(w, st).forEach(function (a) { grey[a] = a + "~"; });
        k += apply(w, st, { now: 1, notes: out.notes, grey: grey });
      });
      out.n += k;
      if (k) out.d++;
      out.per.push({ id: id, name: src.name || "", n: k });
    });
    return out;
  }
  // A document for the AI: size, margins, numbering, its styles and
  // masters by name, and per page the master and the start of each
  // text and the pictures, without file data.
  var OUT_PAGES = 400, OUT_TEXT = 160;
  var PT_MM = 25.4 / 72;
  function mm(v) { return Math.round((v || 0) * PT_MM * 10) / 10; }
  function nameOf(n) { return n && typeof n === "object" ? n.en || n.el || n[Object.keys(n)[0]] || "" : String(n || ""); }
  function textOf(st) {
    return (st && st.paras || []).map(function (p) { return (p.runs || []).map(function (r) { return typeof r.t === "string" ? r.t : ""; }).join(""); }).join(" ").replace(/\s+/g, " ").trim();
  }
  function outline(doc) {
    var u = doc.setup || {}, order = M.pagesInOrder(doc), used = {}, msName = {};
    (doc.stories || []).forEach(function (s) { (s.paras || []).forEach(function (p) { var k = p.ps || "ps-base"; used[k] = (used[k] || 0) + 1; }); });
    (doc.masters || []).forEach(function (m) { msName[m.id] = nameOf(m.name) || m.id; });
    var o = {
      name: doc.name || "", size_mm: mm(u.w) + " × " + mm(u.h), pages: order.length, facing: !!u.facing,
      margins_mm: { t: mm(u.mt), b: mm(u.mb), i: mm(u.mi), o: mm(u.mo) }, bleed_mm: mm(u.bleed), first_page_number: M.firstNumber(doc),
      paragraph_styles: (doc.pstyles || []).map(function (s) {
        var e = { name: nameOf(s.name) || s.id, paragraphs: used[s.id] || 0 };
        if (s.size) e.size = s.size;
        if (s.font) e.font = s.font;
        if (s.align) e.align = s.align;
        return e;
      }),
      masters: (doc.masters || []).map(function (m) { return msName[m.id]; }),
      page_list: []
    };
    var seen = {};
    order.slice(0, OUT_PAGES).forEach(function (pg, i) {
      var e = { page: i + 1 };
      if (pg.ms) e.master = msName[pg.ms] || "";
      var texts = [], pics = 0;
      (doc.items || []).filter(function (it) { return it.pg === pg.id; }).forEach(function (it) {
        if (it.t === "img") { pics++; return; }
        if (it.t !== "text" || seen[it.story]) return;
        seen[it.story] = 1;
        var tx = textOf(M.find(doc.stories || [], it.story));
        if (tx) texts.push(tx.length > OUT_TEXT ? tx.slice(0, OUT_TEXT) + "…" : tx);
      });
      if (texts.length) e.text_starts = texts.slice(0, 6);
      if (pics) e.pictures = pics;
      o.page_list.push(e);
    });
    if (order.length > OUT_PAGES) o.note = "Only the first " + OUT_PAGES + " pages are listed.";
    return o;
  }

  var api = { CATALOG: CATALOG, ORDER: ORDER, GUIDE: GUIDE, MAX_STEPS: MAX_STEPS, check: check, apply: apply, targets: targets, preview: preview, outline: outline };
  if (node) module.exports = api;
  else root.LayoutCommands = api;
})(typeof window !== "undefined" ? window : this);
