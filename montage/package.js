// ============================================================
// orOS Montage — .orosmontage package (montage/package.js,
// window.MontagePackage). One project = one orOS bundle (../bundle.js,
// docs/oros-bundle.md). Pure (no DOM, no storage), so the app and
// `node --test` run the same code:
//   build(project)        the project in the app's own model →
//                         { content, media[], preview[], title }
//     content = { kind: "oros-montage-package", ver: 1,
//                 project { id, name, ar, fps, bg, vs, dk?, m,
//                           items { <iid>: item } } }
//               every clip, track, effect, title and caption exactly
//               as MontageCore keeps it (tombstones are left out:
//               they only matter to sync).
//     media   = the ids the project needs, "<sha256>.<ext>" (the
//               bundle's media/ keys, unchanged)
//     preview = timeline.txt (the clips in order, for any program)
//               + captions.srt when the Text row has text
//   parse(content, o)     content.json → a NEW project: fresh project
//                         and clip ids, every stamp = o.now, through
//                         MontageCore's normaliser (invalid clips are
//                         dropped). Throws Error("notpackage").
//   mediaOk(id, head)     a media key the app can use AND whose first
//                         bytes are that kind of file
// Needs MontageCore (window or require("./core.js")).
// ============================================================
(function (root) {
  "use strict";

  var KIND = "oros-montage-package", VER = 1;

  function core() {
    if (root.MontageCore) return root.MontageCore;
    if (typeof require === "function") return require("./core.js");
    throw new Error("core");
  }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : null; }
  function err(code) { var e = new Error(code); e.code = code; return e; }

  function build(project) {
    var C = core();
    var wrap = { projects: {} };
    if (!obj(project) || !C.isId(project.id)) throw err("noproject");
    wrap.projects[project.id] = project;
    var p = C.merge(wrap, null).projects[project.id];     // canonical, normalised
    if (!p) throw err("noproject");
    var out = {};
    Object.keys(p).forEach(function (k) { if (k !== "tombs") out[k] = p[k]; });
    var preview = [{ name: "timeline.txt", data: timelineText(p), type: "text/plain" }];
    var srt = C.toSrt(p);
    if (srt.trim()) preview.push({ name: "captions.srt", data: srt, type: "application/x-subrip" });
    return {
      content: { kind: KIND, ver: VER, project: out },
      media: C.mediaOf(p),
      preview: preview,
      title: p.name
    };
  }

  // A plain list of the timeline: one line per clip, track by track.
  // m:ss.mmm (h:mm:ss.mmm past an hour)
  function ts(sec) {
    var ms = Math.round(Math.max(0, sec) * 1000), r = String(ms % 1000);
    while (r.length < 3) r = "0" + r;
    return core().fmtTime(Math.floor(ms / 1000)) + "." + r;
  }
  var TRACK_NAMES = { tt: "Text", ov: "Overlay", main: "Main", a1: "Music", a2: "Voice" };
  function timelineText(p) {
    var C = core();
    var lines = [p.name, p.ar + " · " + p.fps + " fps · " + C.fmtTime(C.duration(p)), ""];
    ["main", "ov", "tt", "a1", "a2"].forEach(function (tr) {
      var list = tr === "main" ? C.mainSeq(p).map(function (s) { return { it: s.it, start: s.start, end: s.end }; })
        : C.trackItems(p, tr).map(function (it) { return { it: it, start: it.at, end: it.at + C.itemDur(it) }; });
      if (!list.length) return;
      lines.push("## " + TRACK_NAMES[tr]);
      list.forEach(function (x) {
        var it = x.it, what = it.k;
        if (it.src) what += " media/" + it.src;
        if (it.k === "video" || it.k === "audio") what += " [" + it["in"] + "–" + it.out + " s]";
        if (it.text && it.text.t) what += " “" + it.text.t.replace(/\s+/g, " ").slice(0, 80) + "”";
        if (it.sh) what += " " + it.sh.k;
        lines.push(ts(x.start) + " – " + ts(x.end) + "  " + what);
      });
      lines.push("");
    });
    return lines.join("\n");
  }

  // o: { uid() → a fresh id, now (ms), name? (when the file names none) }
  function parse(content, o) {
    var C = core();
    o = o || {};
    var c = obj(content);
    if (!c || c.kind !== KIND || !obj(c.project)) throw err("notpackage");
    var src = c.project, now = Math.max(0, Math.floor(o.now || Date.now()));
    var uid = typeof o.uid === "function" ? o.uid : function () { return Math.random().toString(36).slice(2, 12); };
    var pid = uid();
    if (!C.isId(pid)) throw err("id");
    var items = {}, seen = {}, its = obj(src.items) || {};
    Object.keys(its).forEach(function (k) {
      var it = obj(its[k]);
      if (!it) return;
      var nid = uid();
      while (seen[nid]) nid = uid();
      seen[nid] = 1;
      var copy = JSON.parse(JSON.stringify(it));
      copy.id = nid; copy.m = now;
      items[nid] = copy;
    });
    var p = { id: pid, name: typeof src.name === "string" && src.name.trim() ? src.name : (o.name || ""),
      ar: src.ar, fps: src.fps, bg: src.bg, vs: src.vs === true, dk: src.dk, m: now, items: items, tombs: {} };
    var wrap = { projects: {} };
    wrap.projects[pid] = p;
    var out = C.merge(wrap, null).projects[pid];
    if (!out) throw err("notpackage");
    return out;
  }

  // Media from a bundle: the id must be one the app accepts, and the
  // first bytes must agree with its extension (a ".mp4" that is a PNG
  // is refused). head: the first ≥ 12 bytes; sniff: MontageMedia.sniff.
  var FAMILY = { jpg: "jpg", png: "png", mp4: "mp4", m4a: "mp4", webm: "webm", weba: "webm", mp3: "mp3", ogg: "ogg", wav: "wav" };
  function mediaOk(id, head, sniff) {
    var C = core();
    if (!(C.isPicture(id) || C.isVideo(id) || C.isSound(id))) return false;
    var ext = String(id).split(".").pop(), got = sniff ? sniff(head) : "";
    return !!got && FAMILY[ext] === got;
  }

  var api = { KIND: KIND, VER: VER, build: build, parse: parse, mediaOk: mediaOk, timelineText: timelineText };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MontagePackage = api;
})(typeof window !== "undefined" ? window : this);
