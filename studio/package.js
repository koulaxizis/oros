// ============================================================
// orOS Studio — .orosstudio package (studio/package.js,
// window.StudioPackage). One project (song) = one orOS bundle
// (../bundle.js, docs/oros-bundle.md). Pure (no DOM, no Web Audio,
// no disk), so the app and `node --test` run the same code:
//   build(data, pid, keys, o)  the project in the app's own model
//                              (core.js) → { content, tracksTxt }
//     keys = { src: { sourceId: mediaKey }, fx: { diskPath: mediaKey } }
//     o    = { fxName(id), instName(id), words {…} } for tracks.txt
//     content = { kind: "oros-studio-package", ver: 1,
//       project { id, name, bpm, sig, vol, loop { on, a, b }, fx },
//       tracks  [{ id, name, color, vol, pan, mute, solo, ord, fx,
//                  inst?, auto? }],
//       sources [{ id, name, dur, ch, media, lic? }],
//       clips   [{ id, t, s?, at, off, len, gain, fi, fo, name?, n? }] }
//     fx = the NULL JSFX chain as core.js keeps it ({ u, id, on, s,
//     sc? }), except that file sliders (Convolution's IR) are
//     f: { slider: { media, name } } instead of a disk path.
//     media = "<sha256>.<ext>" in media/ ("" when the file was not on
//     this device when it was saved).
//   parse(content, o)          content.json → a NEW project: fresh ids
//                              for the project, tracks, sources, clips
//                              and effect slots (sidechain keys and
//                              automation lanes follow), new disk
//                              paths, everything through core.js's
//                              normalisers. o = { newId(kind), now,
//                              title }. → { project, tracks, sources,
//                              clips, files [{ path, key }] } (files
//                              = what to write to the disk from
//                              media/). Throws Error("notpackage").
// ============================================================
(function (root) {
  "use strict";

  var C = root.StudioCore || (typeof require === "function" ? require("./core.js") : null);
  var KIND = "oros-studio-package", VER = 1;
  var KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
  var MAX_SOURCES = 500;

  function isNum(n) { return typeof n === "number" && isFinite(n); }
  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function okKey(k) { return typeof k === "string" && KEY_RE.test(k); }
  function extOfKey(k) {
    var m = /\.([a-z0-9]{1,5})$/i.exec(String(k || ""));
    return m ? m[1].toLowerCase() : "wav";
  }
  // "/internal/Studio/fx/My-IR-sab12cd34ef56.wav" → "My-IR"
  function stemOf(path) {
    return String(path || "").replace(/^.*\//, "").replace(/\.[a-z0-9]{1,5}$/i, "")
      .replace(/-?[a-z][a-z0-9]{12}$/, "") || "file";
  }

  // ---------- build ----------
  function packFx(list, keys) {
    return (list || []).map(function (x) {
      var o = { u: x.u, id: x.id, on: x.on !== false, s: Object.assign({}, x.s || {}) };
      if (x.f) {
        var f = {}, any = false;
        Object.keys(x.f).forEach(function (sl) {
          f[sl] = { media: keys[x.f[sl]] || "", name: stemOf(x.f[sl]) };
          any = true;
        });
        if (any) o.f = f;
      }
      if (x.sc) o.sc = x.sc;
      if (x.st) o.st = x.st.slice();      // an instrument's own state (its drawn pattern)
      return o;
    });
  }
  function build(data, pid, keys, o) {
    keys = keys || {};
    o = o || {};
    var srcKeys = keys.src || {}, fxKeys = keys.fx || {};
    var p = C.find(data, "projects", pid);
    if (!p) throw new Error("noproject");
    var tracks = C.tracksOf(data, pid);
    var tids = {};
    tracks.forEach(function (t) { tids[t.id] = true; });
    var clips = C.ofProject(data, "clips", pid).filter(function (c) { return tids[c.t]; })
      .sort(function (a, b) { return a.at - b.at || (a.id < b.id ? -1 : 1); });
    var used = {};
    clips.forEach(function (c) { if (c.s) used[c.s] = true; });
    var sources = C.ofProject(data, "sources", pid).filter(function (s) { return used[s.id]; });
    var content = {
      kind: KIND, ver: VER,
      project: { id: p.id, name: p.name, bpm: p.bpm, sig: p.sig, vol: p.vol,
                 loop: { on: !!p.loop.on, a: p.loop.a, b: p.loop.b }, fx: packFx(p.fx, fxKeys) },
      tracks: tracks.map(function (t) {
        var x = { id: t.id, name: t.name, color: t.color, vol: t.vol, pan: t.pan, mute: !!t.mute, solo: !!t.solo,
                  ord: t.ord, fx: packFx(t.fx, fxKeys) };
        if (t.inst) x.inst = t.inst;
        if (t.auto && t.auto.length) x.auto = JSON.parse(JSON.stringify(t.auto));
        return x;
      }),
      sources: sources.map(function (s) {
        var o = { id: s.id, name: s.name, dur: s.dur, ch: s.ch, media: srcKeys[s.id] || "" };
        if (s.lic) o.lic = s.lic;
        return o;
      }),
      clips: clips.map(function (c) {
        var x = { id: c.id, t: c.t };
        if (c.s) x.s = c.s;
        x.at = c.at; x.off = c.off; x.len = c.len; x.gain = c.gain; x.fi = c.fi; x.fo = c.fo;
        if (C.isMidi(c)) {
          if (c.name) x.name = c.name;
          x.n = c.n.map(function (q) { return q.slice(); });
        }
        return x;
      })
    };
    return { content: content, tracksTxt: tracksTxt(content, o) };
  }

  // preview/tracks.txt: what is in the song, for any text viewer
  function tracksTxt(c, o) {
    var w = o.words || {};
    var fxName = typeof o.fxName === "function" ? o.fxName : function (id) { return id; };
    var instName = typeof o.instName === "function" ? o.instName : function (id) { return id; };
    var end = 0;
    c.clips.forEach(function (x) { end = Math.max(end, x.at + x.len); });
    var L = [];
    L.push(c.project.name || w.untitled || "Studio");
    L.push((w.tempo || "Tempo") + ": " + c.project.bpm + " BPM, " + c.project.sig + "/4");
    L.push((w.length || "Length") + ": " + C.fmtTime(end));
    if (c.project.fx.length) L.push((w.master || "Master") + " · " + (w.fx || "Effects") + ": " + c.project.fx.map(function (x) { return fxName(x.id); }).join(", "));
    L.push("");
    c.tracks.forEach(function (t, i) {
      var cl = c.clips.filter(function (x) { return x.t === t.id; });
      var midi = !!t.inst || cl.some(function (x) { return Array.isArray(x.n); });
      var line = (i + 1) + ". " + (t.name || "-") + " — " + (midi ? (w.inst || "Instrument") + " (" + instName(t.inst || "piano") + ")" : (w.audio || "Audio")) +
        ", " + cl.length + " " + (w.clips || "clips");
      if (t.mute) line += ", " + (w.mute || "muted");
      if (t.solo) line += ", " + (w.solo || "solo");
      L.push(line);
      if (t.fx.length) L.push("   " + (w.fx || "Effects") + ": " + t.fx.map(function (x) { return fxName(x.id); }).join(", "));
      cl.forEach(function (x) {
        var src = x.s ? c.sources.filter(function (s) { return s.id === x.s; })[0] : null;
        var nm = src ? src.name : (x.name || (w.midi || "MIDI"));
        L.push("   " + C.fmtTime(x.at) + " – " + C.fmtTime(x.at + x.len) + "  " + nm + (Array.isArray(x.n) ? " (" + x.n.length + " " + (w.notes || "notes") + ")" : ""));
      });
    });
    return L.join("\n") + "\n";
  }

  // ---------- parse ----------
  function parse(content, o) {
    o = o || {};
    if (!content || typeof content !== "object" || content.kind !== KIND || !content.project || typeof content.project !== "object") throw new Error("notpackage");
    var newId = o.newId, now = isNum(o.now) ? Math.max(0, Math.floor(o.now)) : Date.now();
    var files = [], wrote = {};
    var pid = newId("p");
    var tmap = {}, smap = {};

    var rawTracks = (Array.isArray(content.tracks) ? content.tracks : [])
      .filter(function (t) { return t && typeof t === "object" && typeof t.id === "string"; });
    rawTracks.forEach(function (t) { if (!tmap[t.id] && Object.keys(tmap).length < C.MAX_TRACKS) tmap[t.id] = newId("t"); });

    // an effect chain: fresh slot ids (returned in umap), sidechain
    // keys onto the new tracks, file sliders onto new disk paths
    function unpackFx(list, umap) {
      if (!Array.isArray(list)) return [];
      var out = [], cand = [];
      list.forEach(function (x) {
        if (!x || typeof x !== "object" || typeof x.u !== "string" || umap[x.u]) return;
        var u = newId("f");
        var y = { u: u, id: x.id, on: x.on !== false, s: x.s };
        if (x.f && typeof x.f === "object") {
          var f = {};
          Object.keys(x.f).forEach(function (sl) {
            var v = x.f[sl];
            if (!v || typeof v !== "object" || !okKey(v.media)) return;
            var path = C.fxFilePath(u, str(v.name, 40) || "file", extOfKey(v.media));
            f[sl] = path;
            cand.push({ path: path, key: v.media });
          });
          y.f = f;
        }
        if (typeof x.sc === "string" && tmap[x.sc]) y.sc = tmap[x.sc];
        if (Array.isArray(x.st)) y.st = x.st;        // normFx keeps it only when valid
        umap[x.u] = u;
        out.push(y);
      });
      var norm = C.normFx(out);
      // a file whose slot did not survive normFx is not written
      var kept = {};
      norm.forEach(function (x) { Object.keys(x.f || {}).forEach(function (k) { kept[x.f[k]] = true; }); });
      cand.forEach(function (fl) { if (kept[fl.path]) files.push(fl); });
      return norm;
    }

    var P = content.project;
    var pfx = unpackFx(P.fx, {});
    var project = C.normProject({ id: pid, m: now, name: str(P.name, 200) || str(o.title, 200), bpm: P.bpm, sig: P.sig, vol: P.vol, loop: P.loop, fx: pfx });
    if (!project) throw new Error("notpackage");

    var tracks = [];
    rawTracks.forEach(function (t) {
      var id = tmap[t.id];
      if (!id || tracks.some(function (x) { return x.id === id; })) return;
      var umap = {};
      var fx = unpackFx(t.fx, umap);
      var auto = Array.isArray(t.auto) ? t.auto.map(function (l) {
        if (!l || typeof l !== "object" || typeof l.k !== "string") return null;
        var f = C.laneFx(l.k);
        if (f) { if (!umap[f.u]) return null; return Object.assign({}, l, { k: C.fxLaneKey(umap[f.u], f.i) }); }
        return l;
      }).filter(Boolean) : undefined;
      var x = C.normTrack({ id: id, m: now, p: pid, name: t.name, color: t.color, vol: t.vol, pan: t.pan, mute: t.mute, solo: t.solo,
                            ord: t.ord, fx: fx, inst: t.inst, auto: auto });
      if (x) tracks.push(x);
    });

    var sources = [];
    (Array.isArray(content.sources) ? content.sources : []).forEach(function (s) {
      if (!s || typeof s !== "object" || typeof s.id !== "string" || smap[s.id] || sources.length >= MAX_SOURCES) return;
      var id = newId("s"), key = okKey(s.media) ? s.media : "";
      var name = str(s.name, 80) || "audio";
      var path = C.sourcePath(id, name, extOfKey(key || name));
      var x = C.normSource({ id: id, m: now, p: pid, name: name, path: path, dur: s.dur, ch: s.ch, lic: s.lic });
      if (!x) return;
      smap[s.id] = id;
      sources.push(x);
      if (key && !wrote[path]) { wrote[path] = true; files.push({ path: path, key: key }); }
    });

    var clips = [];
    (Array.isArray(content.clips) ? content.clips : []).forEach(function (c) {
      if (!c || typeof c !== "object" || clips.length >= C.MAX_CLIPS) return;
      var t = tmap[c.t];
      if (!t || !tracks.some(function (x) { return x.id === t; })) return;
      var midi = c.s === undefined && Array.isArray(c.n);
      var x = { id: newId("c"), m: now, p: pid, t: t, at: c.at, off: c.off, len: c.len, gain: c.gain, fi: c.fi, fo: c.fo };
      if (midi) { x.n = c.n; x.name = c.name; }
      else { if (!smap[c.s]) return; x.s = smap[c.s]; }
      var y = C.normClip(x);
      if (y) clips.push(y);
    });
    // sources no clip plays are left out
    var usedS = {};
    clips.forEach(function (c) { if (c.s) usedS[c.s] = true; });
    var keepPaths = {};
    sources = sources.filter(function (s) { if (usedS[s.id]) { keepPaths[s.path] = true; return true; } return false; });
    files = files.filter(function (f) { return f.path.indexOf("/internal/Studio/audio/") !== 0 || keepPaths[f.path]; });
    return { project: project, tracks: tracks, sources: sources, clips: clips, files: files };
  }

  var api = { KIND: KIND, VER: VER, build: build, parse: parse, tracksTxt: tracksTxt, stemOf: stemOf };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StudioPackage = api;
})(typeof window !== "undefined" ? window : this);
