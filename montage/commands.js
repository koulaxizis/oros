// ============================================================
// orOS Montage — commands.js: what the Assistant may change in a
// video project (AS-EDIT, wave MT1, v1.0.0)
// The fixed catalog of the Assistant's edit_in_app for Montage, in the
// step format of the automations (recipes/core.js specs; field names
// as in the other catalogs where they mean the same). The same file
// runs in two places:
//   - in the Assistant, to check a command list, find the projects it
//     is for (targets), count what it would change on a copy (preview)
//     and describe a project to the AI (outline, with the user's
//     consent);
//   - in Montage (assist.js), which applies it and saves the result as
//     a new edit of each project, so it syncs like any other change.
// Every change goes through MontageCore's own edits (setItem, addItem,
// split, delItem, setProject), so it is checked and stamped as if made
// by hand. Clips are picked with:
//   ids    clip ids from read_in_app (comma separated)
//   what   "" (every clip) | video | image | audio | title | shape
//   row    "" (every row) | main | overlay | text | music | voice (the
//          timeline's tracks; "track" is letter spacing elsewhere)
//   has    words in a title's text
// Times are seconds on the project's timeline (main clips follow each
// other without gaps; the other rows start where `time` says).
// Unset fields (null, "") leave things as they are, so the same list
// twice changes nothing more (add and split make new clips each time).
// Pure: no DOM. Needs recipes/core.js and montage/core.js
// (MontageCore). Exposes window.MontageCommands (browser) or
// module.exports.
// ============================================================
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var R = node ? require("../recipes/core.js") : root.orosRecipes;
  var M = node ? require("./core.js") : root.MontageCore;
  if (!R || !M) return;

  var WHAT = ["", "video", "image", "audio", "title", "shape"];
  var TRACK = { main: "main", overlay: "ov", text: "tt", music: "a1", voice: "a2" };
  var ROWS = [""].concat(Object.keys(TRACK));
  var FONTS = ["", "sans", "serif", "mono", "display"];
  function oneOf(list) { return { t: "enum", v: list, def: list[0] }; }
  var ONOFF = oneOf(["", "on", "off"]);
  function n(lo, hi) { return { t: "num", lo: lo, hi: hi, def: null }; }
  function i(lo, hi) { return { t: "int", lo: lo, hi: hi, def: null }; }
  var SEL = { ids: { t: "str", max: 2000 }, what: oneOf(WHAT), row: oneOf(ROWS), has: { t: "str", max: 200 } };
  function sel(args) {
    var o = {};
    Object.keys(SEL).forEach(function (k) { o[k] = SEL[k]; });
    Object.keys(args || {}).forEach(function (k) { o[k] = args[k]; });
    return o;
  }

  // kind: "doc" (every command edits a project)
  var CATALOG = {
    replace: { kind: "doc", args: sel({ find: { t: "str", max: 500, req: 1 }, repl: { t: "str", max: 500 }, cs: { t: "bool" }, word: { t: "bool" } }) },
    settext: { kind: "doc", args: sel({ text: { t: "str", max: 500, req: 1 } }) },
    textstyle: { kind: "doc", args: sel({ font: oneOf(FONTS), size: n(2, 40), c: { t: "color" }, stroke: { t: "color" }, fill: { t: "color" },
      back: { t: "color" }, align: oneOf(["", "l", "c", "r"]), anim: oneOf(["", "none", "fade", "rise", "pop"]) }) },
    clip: { kind: "doc", args: sel({ speed: n(0.25, 4), vol: i(0, 200), mute: ONOFF, fi: n(0, 10), fo: n(0, 10), opacity: i(0, 100),
      flt: oneOf([""].concat(M.FILTERS)), fit: oneOf(["", "fit", "fill"]), rot: { t: "int", lo: 0, hi: 270, def: null }, flip: oneOf(["", "h", "none"]),
      bright: i(-100, 100), contrast: i(-100, 100), sat: i(-100, 100), warmth: i(-100, 100), secs: n(0.1, 14400) }) },
    transition: { kind: "doc", args: sel({ trans: oneOf([""].concat(["none"], M.TRANSITIONS)), secs: n(0.1, 14400) }) },
    move: { kind: "doc", args: sel({ after: { t: "str", max: 40 }, time: n(0, 57600), x: n(-200, 200), y: n(-200, 200), w: n(2, 400), h: n(2, 400) }) },
    add: { kind: "doc", args: { what: { t: "enum", v: ["title", "card", "shape"], def: "title" }, text: { t: "str", max: 500 }, time: n(0, 57600), secs: n(0.1, 14400),
      after: { t: "str", max: 40 }, font: oneOf(FONTS), size: n(2, 40), c: { t: "color" }, fill: { t: "color" }, back: { t: "color" },
      shape: oneOf([""].concat(M.SHAPES)) } },
    split: { kind: "doc", args: sel({ time: { t: "num", lo: 0, hi: 57600, def: null, req: 1 } }) },
    remove: { kind: "doc", args: sel({}) },
    project: { kind: "doc", args: { ratio: oneOf([""].concat(M.RATIOS)), fps: i(30, 60), back: { t: "color" }, duck: i(0, 90) } },
    rename: { kind: "doc", args: { title: { t: "str", max: 80, req: 1 } } }
  };
  var ORDER = Object.keys(CATALOG);
  var MAX_STEPS = 40;

  // What each command does, for the model (English, short). Every op
  // and field is named here (a test checks it).
  var GUIDE = "Montage commands (documents are video projects; clips are picked with ids (clip ids from read_in_app, comma separated), what (\"\" every clip, or video, image, audio, title, shape), " +
    "row (\"\" every row of the timeline, or main (the clips that follow each other), overlay (picture in picture), text (titles over the video), music, voice) and has (words in a title); times are seconds on the timeline; " +
    "null or \"\" leaves a field as it is):\n" + [
    "replace: find → repl in the text of the picked titles (cs = match case, word = whole words)",
    "settext: the text of the picked titles becomes `text`",
    "textstyle: for the picked titles font sans|serif|mono|display, size (2-40, % of the frame's height), c (text colour), stroke (outline colour), fill (box colour behind the text), back (background of a full-screen title card on the main row), align l|c|r, anim none|fade|rise|pop (how it comes in)",
    "clip: for the picked clips speed (0.25-4, video and sound), vol (0-200 %), mute on|off, fi / fo (fade in / out seconds, 0-10), opacity (0-100), flt (look: " + M.FILTERS.join("|") + "), fit fit|fill, rot 0|90|180|270, flip h|none (mirror), " +
      "bright, contrast, sat, warmth (-100 to 100), secs (the clip's length on the timeline: a picture or title lasts that long; video and sound are cut at the end)",
    "transition: trans none|" + M.TRANSITIONS.join("|") + " into each picked main clip (from the clip before it), secs its length (0.1-2)",
    "move: a main clip goes after the clip `after` (an id, or start); a clip on another row starts at `time`; x, y (top-left), w, h place overlays, titles and shapes in % of the frame",
    "add: a new title (what title, on the text row at `time` for `secs`), a full-screen title card (what card, on the main row at the end or after `after`) or a shape (what shape, on the overlay row) with text, font, size, c, fill (box or shape colour), back (card background), shape " + M.SHAPES.join("|"),
    "split: cut the picked clips that run through `time` in two there",
    "remove: delete the picked clips (needs ids, what, row or has)",
    "project: ratio " + M.RATIOS.join("|") + ", fps 30|60, back (the colour behind everything), duck (0-90: how much the music drops under the voice, 0 = off)",
    "rename: the project's name becomes `title`"
  ].join("\n");

  // ---------- 1. Checking ----------
  var IDS_RX = /^[\s,a-z0-9]*$/;
  function given(v) { return v !== null && v !== undefined && v !== ""; }
  function picks(st) { return given(st.ids) || given(st.what) || given(st.row) || given(st.has); }
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
          (spec.t === "color" && raw[k] !== "" && !v) ||
          ((spec.t === "num" || spec.t === "int") && (raw[k] < spec.lo || raw[k] > spec.hi))) {
        bad.push(k + " " + JSON.stringify(raw[k]).slice(0, 60) + " is not allowed");
      }
    });
    Object.keys(def.args).forEach(function (k) { if (def.args[k].req && !given(raw[k])) bad.push(k + " is missing"); });
    if (typeof raw.ids === "string" && !IDS_RX.test(raw.ids)) bad.push("ids must be clip ids from read_in_app, comma separated");
    if (given(raw.rot) && [0, 90, 180, 270].indexOf(raw.rot) < 0) bad.push("rot must be 0, 90, 180 or 270");
    if (given(raw.fps) && raw.fps !== 30 && raw.fps !== 60) bad.push("fps must be 30 or 60");
    if (raw.op === "transition" && given(raw.secs) && (raw.secs < 0.1 || raw.secs > 2)) bad.push("secs of a transition is 0.1-2");
    var st = bad.length ? null : R.normStep(raw, wrap(raw.op));
    if (!st) return { err: raw.op + ": " + (bad.join("; ") || "not valid") };
    if (st.op === "remove" && !picks(st)) return { err: "remove: pick the clips with ids, what, row or has" };
    if (st.op === "add" && st.what !== "shape" && !given(st.text)) return { err: "add: a title or card needs text" };
    if (st.op === "move" && !given(st.after) && !given(st.time) && !given(st.x) && !given(st.y) && !given(st.w) && !given(st.h)) return { err: "move: give after, time, x, y, w or h" };
    if (st.op === "transition" && !st.trans && !given(st.secs)) return { err: "transition: give trans or secs" };
    if (st.op === "project" && !st.ratio && !given(st.fps) && !st.back && !given(st.duck)) return { err: "project: give ratio, fps, back or duck" };
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

  // ---------- 2. Picking ----------
  function norm(s) { return String(s || "").toLowerCase().replace(/[\s ]+/g, " ").trim(); }
  function note(env, k) { if (env && env.notes && env.notes.indexOf(k) < 0) env.notes.push(k); }
  // The project's clips in timeline order (row by row).
  function inOrder(p) {
    var out = [];
    M.TRACKS.forEach(function (tr) { out = out.concat(M.trackItems(p, tr)); });
    return out;
  }
  function pick(p, st) {
    var ids = given(st.ids) ? String(st.ids).split(/[\s,]+/).filter(Boolean) : null, words = given(st.has) ? norm(st.has) : "";
    return inOrder(p).filter(function (it) {
      if (ids && ids.indexOf(it.id) < 0) return false;
      if (st.what && it.k !== st.what) return false;
      if (st.row && it.tr !== TRACK[st.row]) return false;
      if (words && !(it.text && norm(it.text.t).indexOf(words) >= 0)) return false;
      return true;
    });
  }
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function finder(st) {
    var src = esc(st.find);
    if (st.word) src = "(?<![\\p{L}\\p{N}_])" + src + "(?![\\p{L}\\p{N}_])";
    return new RegExp(src, "gu" + (st.cs ? "" : "i"));
  }
  function r3(v) { return Math.round(v * 1000) / 1000; }

  // ---------- 3. Applying ----------
  // A project as the commands see it: { pid, data } where data holds
  // that one project (MontageCore's edits work on it as on the whole).
  function work(p) {
    var d = { projects: {}, tombs: {} };
    d.projects[p.id] = JSON.parse(JSON.stringify(p));
    return { pid: p.id, data: M.merge(d, null) };
  }
  function proj(w) { return w.data.projects[w.pid]; }
  function itemsJson(w) { var p = proj(w), o = {}; Object.keys(p.items).forEach(function (k) { o[k] = JSON.stringify(p.items[k]); }); return o; }
  // The number of clips that differ between two itemsJson() maps.
  function diff(a, b) {
    var k, c = 0, all = {};
    for (k in a) all[k] = 1;
    for (k in b) all[k] = 1;
    for (k in all) if (a[k] !== b[k]) c++;
    return c;
  }
  function setIt(w, iid, patch, now) { w.data = M.setItem(w.data, w.pid, iid, patch, now); }
  var TT_BOX = { x: 0.05, y: 0.72, w: 0.9, h: 0.2 }, OV_BOX = { x: 0.6, y: 0.06, w: 0.34, h: 0.34 };

  // One command on a project copy (work()) → how many things changed.
  // env: { notes: [], now: ms, newId: () → a fresh clip id }.
  function apply(w, st, env) {
    env = env || {};
    var now = env.now || Date.now(), p = proj(w);
    if (!p) return 0;
    var before = itemsJson(w), f0 = JSON.stringify([p.name, p.ar, p.fps, p.bg, p.dk || 0]);
    function done() {
      var p2 = proj(w);
      return diff(before, itemsJson(w)) + (JSON.stringify([p2.name, p2.ar, p2.fps, p2.bg, p2.dk || 0]) !== f0 ? 1 : 0);
    }
    switch (st.op) {
      case "rename":
        w.data = M.setProject(w.data, w.pid, { name: st.title }, now);
        return done();
      case "project": {
        var patch = {};
        if (st.ratio) patch.ar = st.ratio;
        if (given(st.fps)) patch.fps = st.fps;
        if (st.back) patch.bg = st.back;
        if (given(st.duck)) patch.dk = st.duck;
        w.data = M.setProject(w.data, w.pid, patch, now);
        return done();
      }
      case "add": {
        var id = env.newId ? env.newId() : "c" + now.toString(36);
        var it = { id: id };
        if (st.what === "shape") {
          it.k = "shape"; it.tr = "ov"; it.at = given(st.time) ? st.time : 0; it.d = given(st.secs) ? st.secs : 4;
          it.sh = { k: st.shape || "rect", col: st.fill || "#f8d14a" };
        } else {
          it.k = "title"; it.tr = st.what === "card" ? "main" : "tt"; it.d = given(st.secs) ? st.secs : 3;
          if (it.tr === "tt") it.at = given(st.time) ? st.time : 0;
          it.text = { t: st.text, f: st.font || "sans", sz: given(st.size) ? st.size : (it.tr === "main" ? 10 : 8), col: st.c || "#ffffff", bx: st.fill || "", al: "c", an: "none" };
          if (it.tr === "main") it.bg = st.back || "#000000";
        }
        var opts = it.tr === "main" ? { after: given(st.after) ? (st.after === "start" ? null : st.after) : undefined } : undefined;
        if (Object.keys(p.items).length >= M.MAX_ITEMS) { note(env, "maxClips"); return 0; }
        w.data = M.addItem(w.data, w.pid, it, now, opts);
        return done();
      }
    }
    var list = pick(p, st);
    if (!list.length) { note(env, "noClips"); return 0; }
    switch (st.op) {
      case "remove":
        list.forEach(function (it) { w.data = M.delItem(w.data, w.pid, it.id, now); });
        return done();
      case "split": {
        var cut = 0;
        list.forEach(function (it) {
          var pl = M.placeOf(proj(w), it.id);
          if (!pl || !(st.time > pl.start + M.MIN && st.time < pl.end - M.MIN)) return;
          w.data = M.split(w.data, w.pid, it.id, st.time, now, env.newId ? env.newId() : it.id + "s");
          cut++;
        });
        if (!cut) note(env, "noClips");
        return done();
      }
      case "replace": {
        var rx = finder(st);
        list.forEach(function (it) {
          if (!it.text) return;
          rx.lastIndex = 0;
          var t = it.text.t.replace(rx, st.repl || "");
          if (t !== it.text.t) setIt(w, it.id, { text: Object.assign({}, it.text, { t: t }) }, now);
        });
        return done();
      }
      case "settext":
        list.forEach(function (it) { if (it.text) setIt(w, it.id, { text: Object.assign({}, it.text, { t: st.text }) }, now); });
        return done();
      case "textstyle":
        list.forEach(function (it) {
          if (it.k === "shape") {
            if (st.fill || st.stroke) setIt(w, it.id, { sh: Object.assign({}, it.sh, st.fill ? { col: st.fill } : {}, st.stroke ? { ol: st.stroke, ow: it.sh.ow || 4 } : {}) }, now);
            return;
          }
          if (!it.text) return;
          var tx = Object.assign({}, it.text);
          if (st.font) tx.f = st.font;
          if (given(st.size)) tx.sz = st.size;
          if (st.c) tx.col = st.c;
          if (st.stroke) tx.ol = st.stroke;
          if (st.fill) tx.bx = st.fill;
          if (st.align) tx.al = st.align;
          if (st.anim) tx.an = st.anim;
          var pt = { text: tx };
          if (st.back && it.tr === "main") pt.bg = st.back;
          setIt(w, it.id, pt, now);
        });
        return done();
      case "clip":
        list.forEach(function (it) {
          var pt = {}, av = it.k === "video" || it.k === "audio", pic = it.k === "video" || it.k === "image";
          if (given(st.speed) && av) pt.sp = st.speed;
          if (given(st.vol) && av) pt.vol = st.vol;
          if (st.mute && av) pt.mu = st.mute === "on";
          if (given(st.fi)) pt.fi = st.fi;
          if (given(st.fo)) pt.fo = st.fo;
          if (given(st.opacity) && it.k !== "audio") pt.op = st.opacity;
          if (pic) {
            if (st.flt) pt.flt = st.flt;
            if (st.fit) pt.fit = st.fit;
            if (given(st.rot)) pt.rot = st.rot;
            if (st.flip) pt.fl = st.flip === "h";
            var lk = Object.assign({}, it.lk), lch = false;
            [["bright", "b"], ["contrast", "c"], ["sat", "s"], ["warmth", "t"]].forEach(function (q) { if (given(st[q[0]])) { lk[q[1]] = st[q[0]]; lch = true; } });
            if (lch) pt.lk = lk;
          }
          if (given(st.secs)) {
            if (av) {
              var sp = given(pt.sp) ? pt.sp : it.sp;
              if (M.hasRamp(it)) note(env, "ramp");
              else pt.out = Math.min(it.len > 0 ? it.len : Infinity, it["in"] + st.secs * sp);
            } else pt.d = st.secs;
          }
          if (Object.keys(pt).length) setIt(w, it.id, pt, now);
        });
        return done();
      case "transition": {
        var first = M.trackItems(p, "main")[0];
        list.forEach(function (it) {
          if (it.tr !== "main" || (first && it.id === first.id)) return;   // the first clip has nothing before it
          var cur = it.tx || { k: "fade", d: 0.5 }, nx;
          if (st.trans === "none") nx = null;
          else if (!st.trans && !it.tx) return;
          else nx = { k: st.trans || cur.k, d: given(st.secs) ? st.secs : cur.d };
          setIt(w, it.id, { tx: nx }, now);
        });
        return done();
      }
      case "move":
        list.forEach(function (it) {
          if (it.tr === "main") {
            if (given(st.after)) w.data = M.moveMain(w.data, w.pid, it.id, st.after === "start" ? null : st.after, now);
          } else if (given(st.time)) setIt(w, it.id, { at: st.time }, now);
          if (it.box && (given(st.x) || given(st.y) || given(st.w) || given(st.h))) {
            var b = Object.assign({}, it.box);
            if (given(st.x)) b.x = r3(st.x / 100);
            if (given(st.y)) b.y = r3(st.y / 100);
            if (given(st.w)) b.w = r3(st.w / 100);
            if (given(st.h)) b.h = r3(st.h / 100);
            setIt(w, it.id, { box: b }, now);
          }
        });
        return done();
    }
    return 0;
  }

  // ---------- 4. For the Assistant ----------
  // The stored slice as a list of documents (its projects, newest
  // first): { docs: [{ id, name, m }], data } (each doc's `store` is
  // the project).
  function view(data) {
    if (!data || typeof data !== "object" || !data.projects || typeof data.projects !== "object") return { docs: [], data: null };
    var d = M.merge(data, null);
    return { docs: M.projectList(d).map(function (p) {
      var o = { id: p.id, name: p.name, m: M.lastEdit(p) };
      Object.defineProperty(o, "store", { value: p });   // not copied
      return o;
    }), data: d };
  }
  // Which projects a request is for. data: view(), open: the open
  // project's id. designs: open | named | all.
  function targets(data, folders, open, designs, name) {
    var docs = data && Array.isArray(data.docs) ? data.docs : [];
    if (designs === "new") return { ok: false, err: "a new video project is made in Montage itself; use open, named or all" };
    if (designs === "folder") return { ok: false, err: "Montage has no folders; use open, named or all" };
    if (!docs.length) return { ok: false, err: "the user has no projects in Montage yet" };
    var list = [];
    if (designs === "all") list = docs.slice();
    else if (designs === "named") {
      var q = norm(name);
      if (!q) return { ok: false, err: "give the project's name" };
      list = docs.filter(function (d) { return norm(d.name) === q; });
      if (!list.length) list = docs.filter(function (d) { return norm(d.name).indexOf(q) >= 0; });
      if (!list.length) return { ok: false, err: "no project is called " + JSON.stringify(String(name).slice(0, 80)) + "; projects: " + docs.slice(0, 30).map(function (d) { return JSON.stringify(d.name); }).join(", ") };
      if (list.length > 1 && !docs.some(function (d) { return norm(d.name) === q; })) {
        return { ok: false, err: "several projects match " + JSON.stringify(String(name).slice(0, 80)) + ": " + list.slice(0, 20).map(function (d) { return JSON.stringify(d.name); }).join(", ") + "; give the whole name" };
      }
      if (list.length > 1) list = list.filter(function (d) { return norm(d.name) === q; });
    } else {
      var o = null;
      docs.forEach(function (d) { if (d.id === open) o = d; });
      if (!o) return { ok: false, err: "no project is open in Montage; name the project (designs: named)" };
      list = [o];
    }
    return { ok: true, docs: list.map(function (d) { return { id: d.id, name: d.name || "" }; }) };
  }
  // What a list of commands would change, on copies: { n, d, per[{id,
  // name, n}], cut: 0, notes[] }. data: view().
  function preview(data, ids, steps) {
    var out = { n: 0, d: 0, per: [], cut: 0, notes: [] }, recs = {}, seq = 0;
    ((data && data.docs) || []).forEach(function (d) { recs[d.id] = d.store; });
    var env = { notes: out.notes, now: Date.now(), newId: function () { seq++; return "zzpreview" + seq; } };
    ids.forEach(function (id) {
      if (!recs[id]) return;
      var w = work(recs[id]), k = 0;
      steps.forEach(function (st) { k += apply(w, st, env); });
      if (k) { out.n += k; out.d++; out.per.push({ id: id, name: proj(w).name, n: k }); }
    });
    return out;
  }
  // A project for the model: its settings and every clip with its id,
  // kind, row, place on the timeline and what can be changed.
  var OUT_CLIPS = 600;
  var TRACK_NAME = { main: "main", ov: "overlay", tt: "text", a1: "music", a2: "voice" };
  function pct(v) { return Math.round(v * 1000) / 10; }
  function outline(doc) {
    var p = doc && doc.store;
    if (!p) return null;
    var o = { name: p.name, ratio: p.ar, fps: p.fps, back: p.bg, length: r3(M.duration(p)), clips: [] };
    if (p.dk) o.duck = p.dk;
    var all = inOrder(p);
    all.slice(0, OUT_CLIPS).forEach(function (it) {
      var pl = M.placeOf(p, it.id) || { start: 0, end: 0 };
      var e = { id: it.id, kind: it.k, row: TRACK_NAME[it.tr], start: r3(pl.start), end: r3(pl.end) };
      if (it.k === "video" || it.k === "audio") { e.speed = it.sp; e.vol = it.vol; if (it.mu) e.mute = true; if (M.hasRamp(it)) e.ramp = true; }
      if (it.fi) e.fi = it.fi;
      if (it.fo) e.fo = it.fo;
      if (it.k !== "audio" && it.op !== 100) e.opacity = it.op;
      if (it.k === "video" || it.k === "image") {
        if (it.flt !== "none") e.flt = it.flt;
        e.fit = it.fit;
        if (it.rot) e.rot = it.rot;
        if (it.fl) e.flip = "h";
        if (it.lk.b || it.lk.c || it.lk.s || it.lk.t) e.look = { bright: it.lk.b, contrast: it.lk.c, sat: it.lk.s, warmth: it.lk.t };
      }
      if (it.text) {
        e.text = it.text.t;
        e.font = it.text.f; e.size = it.text.sz; e.c = it.text.col;
        if (it.text.ol) e.stroke = it.text.ol;
        if (it.text.bx) e.fill = it.text.bx;
        e.align = it.text.al;
        if (it.text.an !== "none") e.anim = it.text.an;
        if (it.bg) e.back = it.bg;
      }
      if (it.sh) { e.shape = it.sh.k; if (it.sh.col) e.fill = it.sh.col; }
      if (it.box) e.box = { x: pct(it.box.x), y: pct(it.box.y), w: pct(it.box.w), h: pct(it.box.h) };
      if (it.tx) e.transition = { trans: it.tx.k, secs: it.tx.d };
      if (it.kf) e.keyframes = it.kf.length;
      o.clips.push(e);
    });
    if (all.length > OUT_CLIPS) o.note = "Only the first " + OUT_CLIPS + " of " + all.length + " clips are listed.";
    return o;
  }

  var api = {
    CATALOG: CATALOG, ORDER: ORDER, GUIDE: GUIDE, MAX_STEPS: MAX_STEPS, TRACK: TRACK,
    check: check, pick: pick, work: work, apply: apply,
    view: view, targets: targets, preview: preview, outline: outline
  };
  if (node) module.exports = api;
  else root.MontageCommands = api;
})(typeof window !== "undefined" ? window : this);
