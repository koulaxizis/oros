// ============================================================
// orOS Mockups — commands.js: what the Assistant and Claude may change
// in a book mockup (MK-G, v1.0.0)
// Chris 2026-11-22: add Mockups to the Gate. The fixed catalog of
// edit_in_app for Mockups, in the step format of the automations
// (recipes/core.js specs). The same file runs in two places:
//   - in the Assistant, to check a command list, find the mockups it is
//     for (targets), count what it would change on a copy (preview)
//     and describe a mockup to the AI (outline);
//   - in Mockups (assist.js), which applies it to the project and
//     saves it, makes the picture (export) and keeps what Undo needs.
// Book mockups only (the products of mockups/goods keep their own
// store). Pictures come from Claude's folders on the orOS disk
// (/internal/ paths); the app copies them into the mockup's pictures
// (designkit/assets.js) and the project keeps their ids, as when the
// owner picks one. Unset fields (null, "") leave things as they are.
// Pure: no DOM. Needs recipes/core.js and mockups/core.js (MockCore).
// Exposes window.MockupsCommands (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var R = node ? require("../recipes/core.js") : root.orosRecipes;
  var M = node ? require("./core.js") : root.MockCore;
  if (!R || !M) return;

  function oneOf(list) { return { t: "enum", v: list, def: list[0] }; }
  function num(lo, hi) { return { t: "num", lo: lo, hi: hi, def: null }; }
  var PIC = { t: "str", max: 1024 };
  var PIC_RX = /^\/internal\/(?!(.*\/)?\.)(?!.*\/\/)[^\u0000-\u001f\\]+\.(jpe?g|png|webp|gif|bmp|avif|svg)$/i;
  var TRIM_IDS = M.TRIMS.map(function (x) { return x.k; });
  var PAPER_IDS = M.PAPERS.map(function (x) { return x.k; }).filter(function (k) { return k !== "custom"; });
  // ready camera angles: [th, ph, turn]
  var ANGLES = { front: [0, 4, 0], left: [-28, 12, 0], right: [28, 12, 0], spine: [-75, 8, 0], back: [180, 8, 0], top: [0, 62, 0], low: [-20, 2, 0] };
  var ANGLE_IDS = Object.keys(ANGLES);

  var CATALOG = {
    create: { kind: "new", args: { title: { t: "str", max: 80 } } },
    book: { kind: "doc", args: { trim: oneOf([""].concat(TRIM_IDS)), w: num(40, 600), h: num(40, 600), npages: { t: "int", lo: 4, hi: 2000, def: null },
      bind: oneOf([""].concat(M.BINDS)), paper: oneOf([""].concat(PAPER_IDS)), finish: oneOf([""].concat(M.FINISH)) } },
    cover: { kind: "doc", args: { front: PIC, back: PIC, spine: PIC, wrap: PIC, c: { t: "color" }, sptext: { t: "str", max: 80 }, sptc: { t: "color" } } },
    show: { kind: "doc", args: { show_as: oneOf([""].concat(M.SHOWS)), device: oneOf([""].concat(M.DEVICES)), dcolor: oneOf([""].concat(M.DCOLS)),
      screen: PIC, left: PIC, right: PIC } },
    scene: { kind: "doc", args: { angle: oneOf([""].concat(ANGLE_IDS)), th: num(-180, 180), ph: num(-10, 89), turn: num(-180, 180), zoom: num(0.5, 3),
      place: oneOf([""].concat(M.PLACES)), bg: oneOf([""].concat(M.BGS.filter(function (k) { return k !== "photo"; }))), c1: { t: "color" }, c2: { t: "color" },
      surf: oneOf([""].concat(M.SURFS)), shadow: num(0, 1) } },
    rename: { kind: "doc", args: { title: { t: "str", max: 80, req: 1 } } },
    export: { kind: "out", args: { fmt: { t: "enum", v: M.FMTS, def: "png" }, ratio: oneOf([""].concat(M.RATIOS)), size: { t: "enum", v: [0].concat(M.SIZES), def: 0 }, out: { t: "str", max: 1030 } } }
  };
  var ORDER = Object.keys(CATALOG);
  var MAX_STEPS = 40;
  var PIC_FIELDS = { cover: ["front", "back", "spine", "wrap"], show: ["screen", "left", "right"] };

  var GUIDE = "Mockups commands (documents are 3D book mockups; pictures are files in Claude's folders on the orOS disk, given by their /internal/ path as files_write or files_upload gave them; sizes in mm):\n" + [
    "create: a NEW book mockup (only as the first command, with designs new; the commands after it set it up): title",
    "book: trim " + TRIM_IDS.join("|") + " (a ready size) or w, h (mm); npages (page count, sets the spine); bind " + M.BINDS.join("|") + " (pb paperback, hc hardcover, ss saddle-stitched, sp spiral, bb board book, lf lay-flat); paper " + PAPER_IDS.join("|") + "; finish " + M.FINISH.join("|"),
    "cover: the cover pictures front, back, spine, or wrap (one full wrap: back + spine + front); c (cover colour where there is no picture), sptext (spine text when there is no spine picture), sptc (its colour)",
    "show: what the mockup shows, show_as book (the closed book) | open (the open book, inside pages left and right) | ebook (the e-book on a device: device " + M.DEVICES.join("|") + ", dcolor " + M.DCOLS.join("|") + ", screen = the picture on its screen, e.g. the cover)",
    "scene: angle " + ANGLE_IDS.join("|") + " (a ready camera), or th (turn around, °), ph (from above, °), turn (the book's own turn, °), zoom (0.5-3); place " + M.PLACES.join("|") + "; bg none (transparent) | solid (c1) | grad (c1 to c2); surf " + M.SURFS.join("|") + "; shadow (0-1)",
    "rename: the mockup's name becomes title",
    "export: the picture: fmt " + M.FMTS.join("|") + ", ratio " + M.RATIOS.join("|") + ", size (long side, " + M.SIZES.join("|") + " px); it is saved into Pictures, and out (a folder of Claude's on the orOS disk with Files at «may change») also gets it, never over a file; the answer lists the paths"
  ].join("\n");

  // ---------- 1. Checking ----------
  function given(v) { return v !== null && v !== undefined && v !== ""; }
  function wrap(op) { var c = {}; c[op] = CATALOG[op]; return c; }
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
          ((spec.t === "num" || spec.t === "int") && (raw[k] < spec.lo || raw[k] > spec.hi)) ||
          (spec.t === "color" && raw[k] !== "" && !v)) {
        bad.push(k + " " + JSON.stringify(raw[k]).slice(0, 60) + " is not allowed");
      }
    });
    Object.keys(def.args).forEach(function (k) { if (def.args[k].req && !given(raw[k])) bad.push(k + " is missing"); });
    var st = bad.length ? null : R.normStep(raw, wrap(raw.op));
    if (!st) return { err: raw.op + ": " + (bad.join("; ") || "not valid") };
    var pf = PIC_FIELDS[st.op] || [], badPic = pf.filter(function (k) { return given(st[k]) && !PIC_RX.test(st[k]); });
    if (badPic.length) return { err: st.op + ": " + badPic.join(", ") + " must be the /internal/ path of a picture file in Claude's folders" };
    if (st.op === "book" && (given(st.w) !== given(st.h))) return { err: "book: give both w and h (or trim)" };
    if (st.op === "book" && st.trim && given(st.w)) return { err: "book: give trim or w and h, not both" };
    if (st.op !== "create" && st.op !== "export" && !Object.keys(def.args).some(function (k) { return given(st[k]) && st[k] !== 0; })) return { err: st.op + ": give at least one field" };
    return { step: st };
  }
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
    if (steps.slice(1).some(function (s) { return s.op === "create"; })) return { ok: false, err: "create is only the first command" };
    return { ok: true, steps: steps };
  }
  // The picture paths a list names (the app copies them first).
  function picPaths(steps) {
    var out = [];
    steps.forEach(function (s) { (PIC_FIELDS[s.op] || []).forEach(function (k) { if (given(s[k]) && out.indexOf(s[k]) < 0) out.push(s[k]); }); });
    return out;
  }

  // ---------- 2. Applying (on a project record) ----------
  // env: { asset(path) → asset id | "" , notes } → how many settings changed
  function note(env, k) { if (env && env.notes && env.notes.indexOf(k) < 0) env.notes.push(k); }
  function set(o, k, v) { if (o[k] === v) return 0; o[k] = v; return 1; }
  function apply(p, st, env) {
    if (!p || p.kind !== "book") return 0;
    var k = 0, bk = p.bk, art = p.art, sc = p.sc;
    switch (st.op) {
      case "book":
        if (st.trim) { var tr = null; M.TRIMS.forEach(function (x) { if (x.k === st.trim) tr = x; }); k += set(bk, "w", tr.w) + set(bk, "h", tr.h) + set(bk, "trim", st.trim); }
        else if (given(st.w)) { k += set(bk, "w", Math.round(st.w * 10) / 10) + set(bk, "h", Math.round(st.h * 10) / 10) + set(bk, "trim", "custom"); }
        if (given(st.npages)) k += set(bk, "pages", st.npages + st.npages % 2);
        if (st.bind) k += set(bk, "bind", st.bind);
        if (st.paper) k += set(bk, "paper", st.paper);
        if (st.finish) k += set(bk, "fin", st.finish);
        break;
      case "cover":
        ["front", "back", "spine", "wrap"].forEach(function (f) {
          if (!given(st[f])) return;
          var id = env && env.asset ? env.asset(st[f]) : "";
          if (!id) { note(env, "noPicture"); return; }
          k += set(art, f, id);
          if (f === "wrap") { k += set(art, "mode", "wrap"); if (art.bleed < 0) art.bleed = 0; }
          else k += set(art, "mode", "parts");
        });
        if (st.c) k += set(art, "c", st.c);
        if (given(st.sptext)) k += set(art, "spT", st.sptext);
        if (st.sptc) k += set(art, "spTC", st.sptc);
        break;
      case "show":
        if (st.show_as) k += set(p, "show", st.show_as);
        if (st.device) k += set(p.ins, "dev", st.device);
        if (st.dcolor) k += set(p.ins, "dc", st.dcolor);
        [["screen", "scr"], ["left", "l"], ["right", "r"]].forEach(function (a) {
          if (!given(st[a[0]])) return;
          var id = env && env.asset ? env.asset(st[a[0]]) : "";
          if (!id) { note(env, "noPicture"); return; }
          k += set(p.ins, a[1], id);
        });
        break;
      case "scene":
        if (st.angle) { var A = ANGLES[st.angle]; k += set(sc.cam, "th", A[0]) + set(sc.cam, "ph", A[1]) + set(sc, "turn", A[2]); }
        if (given(st.th)) k += set(sc.cam, "th", st.th);
        if (given(st.ph)) k += set(sc.cam, "ph", st.ph);
        if (given(st.turn)) k += set(sc, "turn", st.turn);
        if (given(st.zoom)) k += set(sc.cam, "zoom", st.zoom);
        if (st.place) k += set(sc, "place", st.place);
        if (st.bg) k += set(sc.bg, "k", st.bg);
        if (st.c1) k += set(sc.bg, "c1", st.c1);
        if (st.c2) k += set(sc.bg, "c2", st.c2);
        if (st.surf) k += set(sc, "surf", st.surf);
        if (given(st.shadow)) k += set(sc, "shadow", st.shadow);
        break;
      case "rename":
        k += set(p, "nm", String(st.title).slice(0, 80));
        break;
      case "export":
        if (st.ratio) set(p.out, "ratio", st.ratio);
        if (st.size) set(p.out, "size", st.size);
        set(p.out, "fmt", st.fmt);
        break;
    }
    return k;
  }

  // ---------- 3. For the Assistant ----------
  function norm(s) { return String(s || "").toLowerCase().replace(/[\s ]+/g, " ").trim(); }
  // data: the synced store { prj } → { docs: [{ id, name, m }], data }
  function view(data) {
    var d = data && typeof data === "object" && Array.isArray(data.prj) ? M.parse(JSON.stringify(data)) : null;
    if (!d) return { docs: [], data: null };
    return { docs: d.prj.map(function (p) {
      var o = { id: p.id, name: p.nm || "", m: p.m };
      Object.defineProperty(o, "store", { value: p });   // not copied
      return o;
    }).sort(function (a, b) { return b.m - a.m; }), data: d };
  }
  function targets(data, folders, open, designs, name) {
    var docs = data && Array.isArray(data.docs) ? data.docs : [];
    if (designs === "new") return { ok: true, docs: [{ id: "", name: String(name || "") }], fresh: 1 };
    if (designs === "folder") return { ok: false, err: "Mockups has no folders; use open, named, all or new" };
    if (!docs.length) return { ok: false, err: "the user has no book mockups yet; make one with designs new and create" };
    var list = [];
    if (designs === "all") list = docs.slice();
    else if (designs === "named") {
      var q = norm(name);
      if (!q) return { ok: false, err: "give the mockup's name" };
      list = docs.filter(function (d) { return norm(d.name) === q; });
      if (!list.length) list = docs.filter(function (d) { return norm(d.name).indexOf(q) >= 0; });
      if (!list.length) return { ok: false, err: "no mockup is called " + JSON.stringify(String(name).slice(0, 80)) + "; mockups: " + docs.slice(0, 30).map(function (d) { return JSON.stringify(d.name || "Untitled"); }).join(", ") };
      if (list.length > 1 && !docs.some(function (d) { return norm(d.name) === q; })) {
        return { ok: false, err: "several mockups match " + JSON.stringify(String(name).slice(0, 80)) + ": " + list.slice(0, 20).map(function (d) { return JSON.stringify(d.name); }).join(", ") + "; give the whole name" };
      }
      if (list.length > 1) list = list.filter(function (d) { return norm(d.name) === q; });
    } else {
      var o = null;
      docs.forEach(function (d) { if (d.id === open) o = d; });
      if (!o) return { ok: false, err: "no mockup is open in Mockups; name the mockup (designs: named)" };
      list = [o];
    }
    return { ok: true, docs: list.map(function (d) { return { id: d.id, name: d.name || "" }; }) };
  }
  var FAKE = "0000000000000000000000000000000000000000000000000000000000000000.png";
  function preview(data, ids, steps) {
    var out = { n: 0, d: 0, per: [], cut: 0, made: 0, files: 0, notes: [] }, recs = {};
    ((data && data.docs) || []).forEach(function (d) { recs[d.id] = d.store; });
    var env = { notes: out.notes, asset: function () { return FAKE; } };
    var run = function (p, name, id) {
      var w = JSON.parse(JSON.stringify(p)), k = 0;
      steps.forEach(function (st) { if (CATALOG[st.op].kind === "doc") k += apply(w, st, env); });
      if (k) { out.n += k; out.d++; out.per.push({ id: id, name: name, n: k }); }
    };
    if (steps.length && steps[0].op === "create") {
      out.made = 1;
      run(M.blank("k000000preview", 1), steps[0].title || "", "");
    } else ids.forEach(function (id) { if (recs[id]) run(recs[id], recs[id].nm || "", id); });
    var f = R.outFiles(steps, 1);
    if (f) out.files = f * Math.max(1, out.made || ids.length);
    return out;
  }
  function outline(doc) {
    var p = doc && doc.store;
    if (!p) return null;
    function pic(v) { return v ? "set" : ""; }
    var o = { name: p.nm || "", product: "book", show_as: p.show, unit: "mm",
      book: { trim: p.bk.trim, w: p.bk.w, h: p.bk.h, npages: p.bk.pages, bind: p.bk.bind, paper: p.bk.paper, finish: p.bk.fin, spine_mm: Math.round(M.dims(p.bk).spineMm * 10) / 10 },
      cover: { mode: p.art.mode, front: pic(p.art.front), back: pic(p.art.back), spine: pic(p.art.spine), wrap: pic(p.art.wrap), c: p.art.c, sptext: p.art.spT },
      scene: { th: p.sc.cam.th, ph: p.sc.cam.ph, turn: p.sc.turn, zoom: p.sc.cam.zoom, place: p.sc.place, bg: p.sc.bg.k, c1: p.sc.bg.c1, c2: p.sc.bg.c2, surf: p.sc.surf, shadow: p.sc.shadow },
      export: { fmt: p.out.fmt, ratio: p.out.ratio, size: p.out.size } };
    if (p.show === "ebook") o.device = { device: p.ins.dev, dcolor: p.ins.dc, screen: pic(p.ins.scr) };
    if (p.show === "open") o.inside = { left: pic(p.ins.l), right: pic(p.ins.r) };
    return o;
  }

  var api = {
    CATALOG: CATALOG, ORDER: ORDER, GUIDE: GUIDE, MAX_STEPS: MAX_STEPS, ANGLES: ANGLES, PIC_RX: PIC_RX,
    check: check, apply: apply, picPaths: picPaths, view: view, targets: targets, preview: preview, outline: outline
  };
  if (node) module.exports = api;
  else root.MockupsCommands = api;
})(typeof window !== "undefined" ? window : this);
