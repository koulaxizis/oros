// ============================================================
// orOS Montage — pure core (no DOM): projects, the timeline, the
// merge for sync, and what is on screen and heard at a given time.
//
//   Data    { ver, projects: { <pid>: project }, tombs: { <pid>: ms } }
//   project { id, name, ar, fps, bg, vs, m, items: { <iid>: item },
//             tombs: { <iid>: ms } }
//           ar  "16:9" | "9:16" | "1:1" | "4:5"; fps 30 | 60;
//           bg  "#rrggbb" behind everything; vs = sync this project's
//           media through Vault Drive (off by default, device only);
//           m   mtime of the project's own fields (name … vs).
//   item    { id, k, tr, m, … } one clip on one track
//           k   "video" | "image" | "audio" | "title"
//           tr  "main" (magnetic: clips follow each other, no gaps),
//               "ov" (overlay: picture in picture), "tt" (titles),
//               "a1" / "a2" (sound: music, voice)
//           main clips have an order `o`; the others a start `at`
//           (seconds on the timeline).
//   Media are files on the orOS disk, /internal/Assets/<sha256>.<ext>
//   (the same folder and ids as Atelier's clips.js); a project keeps
//   only the ids, never the media.
//
// Merge (R5, R17, R26, R27): projects and items are separate entities,
// each last-writer-wins by its own m; tombstones max-union; a newer
// edit beats an older tombstone. Output is canonical (keys sorted,
// every item normalized), so merge(merge(a)) === merge(a).
//
// UMD: module.exports in Node, window.MontageCore in the browser.
// ============================================================
(function (root) {
  "use strict";

  var VER = 1;
  var MIN = 0.1;                       // shortest clip, seconds
  var MAX_DUR = 4 * 3600;              // longest clip or still, seconds
  var MAX_ITEMS = 2000;                // per project
  var ID_RE = /^[a-z0-9]{1,40}$/;
  // The same id forms Atelier's clips.js and designkit/assets.js use,
  // so Atelier's "unused files" check sees Montage's media as in use.
  var PIC_RE = /^[0-9a-f]{64}\.(jpg|png)$/;
  var VIDEO_RE = /^[0-9a-f]{64}\.(webm|mp4)$/;
  var SOUND_RE = /^[0-9a-f]{64}\.(mp3|m4a|ogg|wav|weba)$/;
  var COLOR_RE = /^#[0-9a-f]{6}$/;

  var KINDS = ["video", "image", "audio", "title"];
  var TRACKS = ["main", "ov", "tt", "a1", "a2"];
  var TRACK_KINDS = { main: ["video", "image", "title"], ov: ["video", "image"], tt: ["title"], a1: ["audio"], a2: ["audio"] };
  var RATIOS = { "16:9": [16, 9], "9:16": [9, 16], "1:1": [1, 1], "4:5": [4, 5] };
  var FPS = [30, 60];
  var TRANSITIONS = ["fade", "black", "slide", "wipe"];
  var FILTERS = ["none", "mono", "sepia", "warm", "cool", "vivid", "fade", "noir", "film"];
  var ANIMS = ["none", "fade", "rise", "pop"];
  var ALIGNS = ["l", "c", "r"];

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function isInt(v) { return isNum(v) && Math.floor(v) === v; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function num(v, d, lo, hi) { return isNum(v) ? clamp(v, lo, hi) : d; }
  function r3(v) { return Math.round(v * 1000) / 1000; }        // ms precision: stable JSON
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : null; }
  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function oneOf(v, list, d) { return list.indexOf(v) >= 0 ? v : d; }
  function stamp(v) { return isInt(v) && v >= 0 ? v : 0; }

  function isPicture(id) { return typeof id === "string" && PIC_RE.test(id); }
  function isVideo(id) { return typeof id === "string" && VIDEO_RE.test(id); }
  function isSound(id) { return typeof id === "string" && SOUND_RE.test(id); }
  function isId(id) { return typeof id === "string" && ID_RE.test(id); }

  // ---------- Normalizers (strict: invalid rows are dropped) ----------
  function normLook(v) {
    var o = obj(v) || {};
    return {
      b: Math.round(num(o.b, 0, -100, 100)), c: Math.round(num(o.c, 0, -100, 100)),
      s: Math.round(num(o.s, 0, -100, 100)), t: Math.round(num(o.t, 0, -100, 100))
    };
  }
  function normBox(v, d) {
    var o = obj(v) || d;
    var w = r3(num(o.w, d.w, 0.02, 4)), h = r3(num(o.h, d.h, 0.02, 4));
    return { x: r3(num(o.x, d.x, -2, 2)), y: r3(num(o.y, d.y, -2, 2)), w: w, h: h };
  }
  function normText(v) {
    var o = obj(v) || {};
    var t = str(o.t, 500).replace(/\r\n?/g, "\n");
    return {
      t: t, f: str(o.f, 40).replace(/[^a-z0-9-]/gi, "") || "sans",
      sz: r3(num(o.sz, 8, 2, 40)),
      col: COLOR_RE.test(o.col) ? o.col : "#ffffff",
      ol: COLOR_RE.test(o.ol) ? o.ol : "",
      bx: COLOR_RE.test(o.bx) ? o.bx : "",
      al: oneOf(o.al, ALIGNS, "c"), an: oneOf(o.an, ANIMS, "none")
    };
  }
  var BOX_OV = { x: 0.6, y: 0.06, w: 0.34, h: 0.34 };
  var BOX_TT = { x: 0.05, y: 0.72, w: 0.9, h: 0.2 };

  function normItem(v, id) {
    var o = obj(v);
    if (!o || !isId(id) || o.id !== id) return null;
    var k = oneOf(o.k, KINDS, ""), tr = oneOf(o.tr, TRACKS, "");
    if (!k || !tr || TRACK_KINDS[tr].indexOf(k) < 0) return null;
    var it = { id: id, k: k, tr: tr, m: stamp(o.m) };
    if (k === "video" || k === "audio") {
      if (k === "video" ? !isVideo(o.src) : !(isSound(o.src) || isVideo(o.src))) return null;
      it.src = o.src;
      var len = num(o.len, 0, 0, MAX_DUR);
      var inn = num(o["in"], 0, 0, MAX_DUR);
      var out = num(o.out, 0, 0, MAX_DUR);
      if (len > 0) { out = Math.min(out, len); inn = Math.min(inn, Math.max(0, len - MIN)); }
      if (!(out - inn >= MIN - 1e-9)) return null;
      it.len = r3(len); it["in"] = r3(inn); it.out = r3(out);
      it.sp = r3(num(o.sp, 1, 0.25, 4));
      it.vol = Math.round(num(o.vol, 100, 0, 200));
      it.mu = o.mu === true;
    } else {
      if (k === "image" && !isPicture(o.src)) return null;
      if (k === "image") it.src = o.src;
      it.d = r3(num(o.d, k === "title" ? 3 : 4, MIN, MAX_DUR));
    }
    if (tr === "main") it.o = isNum(o.o) ? o.o : 0;
    else it.at = r3(num(o.at, 0, 0, MAX_DUR * 4));
    it.fi = r3(num(o.fi, 0, 0, 10));
    it.fo = r3(num(o.fo, 0, 0, 10));
    if (k !== "audio") {
      it.op = Math.round(num(o.op, 100, 0, 100));
      if (k !== "title") {
        it.fit = oneOf(o.fit, ["fit", "fill"], "fit");
        it.rot = oneOf(o.rot, [0, 90, 180, 270], 0);
        it.fl = o.fl === true;
        it.lk = normLook(o.lk);
        it.flt = oneOf(o.flt, FILTERS, "none");
      }
      if (tr !== "main") it.box = normBox(o.box, tr === "tt" ? BOX_TT : BOX_OV);
      if (k === "title") {
        it.text = normText(o.text);
        if (tr === "main") it.bg = COLOR_RE.test(o.bg) ? o.bg : "#000000";
      }
    }
    if (tr === "main") {
      var tx = obj(o.tx);
      it.tx = tx && TRANSITIONS.indexOf(tx.k) >= 0 ? { k: tx.k, d: r3(num(tx.d, 0.5, 0.1, 2)) } : null;
    }
    return it;
  }

  function normFields(o) {
    return {
      name: str(o.name, 80).replace(/[\r\n\t]+/g, " ").trim() || "Untitled",
      ar: RATIOS[o.ar] ? o.ar : "16:9",
      fps: oneOf(o.fps, FPS, 30),
      bg: COLOR_RE.test(o.bg) ? o.bg : "#000000",
      vs: o.vs === true,
      m: stamp(o.m)
    };
  }

  function normTombs(v, keyOk) {
    var out = {}, o = obj(v);
    if (!o) return out;
    Object.keys(o).forEach(function (k) { if (keyOk(k) && isInt(o[k]) && o[k] >= 0) out[k] = o[k]; });
    return out;
  }

  // ---------- Merge ----------
  function newerOf(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }
  function maxInto(into, tm) {
    Object.keys(tm).forEach(function (k) { if (!(k in into) || tm[k] > into[k]) into[k] = tm[k]; });
  }
  function sortedObj(o) {
    var out = {};
    Object.keys(o).sort(cmpStr).forEach(function (k) { out[k] = o[k]; });
    return out;
  }

  function mergeProject(pa, pb, id) {
    var fa = pa ? normFields(pa) : null, fb = pb ? normFields(pb) : null;
    var f = newerOf(fa, fb);
    var tombs = {};
    [pa, pb].forEach(function (p) { if (p) maxInto(tombs, normTombs(p.tombs, isId)); });
    var best = {};
    [pa, pb].forEach(function (p) {
      var its = p && obj(p.items);
      if (!its) return;
      Object.keys(its).forEach(function (k) {
        var it = normItem(its[k], k);
        if (it) best[k] = newerOf(best[k], it);
      });
    });
    var items = {};
    Object.keys(best).sort(cmpStr).forEach(function (k) {
      if (k in tombs && tombs[k] >= best[k].m) return;
      items[k] = best[k];
    });
    // a tombstone older than every possible resurrection is still kept:
    // dropping it would let an offline device's stale copy return.
    var out = { id: id };
    Object.keys(f).forEach(function (k) { out[k] = f[k]; });
    out.items = items;
    out.tombs = sortedObj(tombs);
    return out;
  }

  // Newest edit anywhere in a project (its fields or any item).
  function lastEdit(p) {
    var m = p.m;
    Object.keys(p.items).forEach(function (k) { if (p.items[k].m > m) m = p.items[k].m; });
    Object.keys(p.tombs).forEach(function (k) { if (p.tombs[k] > m) m = p.tombs[k]; });
    return m;
  }

  function merge(A, B) {
    var a = obj(A) || {}, b = obj(B) || {};
    var tombs = {};
    maxInto(tombs, normTombs(a.tombs, isId));
    maxInto(tombs, normTombs(b.tombs, isId));
    var ids = {};
    [a.projects, b.projects].forEach(function (ps) {
      ps = obj(ps);
      if (ps) Object.keys(ps).forEach(function (k) { if (isId(k) && obj(ps[k])) ids[k] = 1; });
    });
    var projects = {};
    Object.keys(ids).sort(cmpStr).forEach(function (id) {
      var pa = obj(a.projects) && obj(a.projects[id]), pb = obj(b.projects) && obj(b.projects[id]);
      var p = mergeProject(pa, pb, id);
      if (id in tombs && tombs[id] >= lastEdit(p)) return;     // a newer edit resurrects (R17)
      projects[id] = p;
    });
    return { ver: VER, projects: projects, tombs: sortedObj(tombs) };
  }

  // ---------- Timeline ----------
  function itemDur(it) {
    if (it.k === "video" || it.k === "audio") return (it.out - it["in"]) / it.sp;
    return it.d;
  }
  function byOrder(a, b) { return a.o !== b.o ? a.o - b.o : cmpStr(a.id, b.id); }
  function byStart(a, b) { return a.at !== b.at ? a.at - b.at : cmpStr(a.id, b.id); }
  function trackItems(p, tr) {
    var out = [];
    Object.keys(p.items).forEach(function (k) { if (p.items[k].tr === tr) out.push(p.items[k]); });
    return out.sort(tr === "main" ? byOrder : byStart);
  }
  // The transition into a main clip overlaps the clip before it; it is
  // never longer than half of either clip.
  function txLen(prev, cur) {
    if (!prev || !cur.tx) return 0;
    return Math.min(cur.tx.d, itemDur(prev) / 2, itemDur(cur) / 2);
  }
  // Main track in order with each clip's place: [{ it, start, end, tx }]
  function mainSeq(p) {
    var list = trackItems(p, "main"), out = [], t = 0, prev = null;
    list.forEach(function (it) {
      var tx = txLen(prev, it), start = Math.max(0, t - tx), end = start + itemDur(it);
      out.push({ it: it, start: start, end: end, tx: tx });
      t = end; prev = it;
    });
    return out;
  }
  // Where an item sits on the timeline: { start, end } (null if absent)
  function placeOf(p, iid) {
    var it = p.items[iid];
    if (!it) return null;
    if (it.tr !== "main") return { start: it.at, end: it.at + itemDur(it) };
    var seq = mainSeq(p);
    for (var i = 0; i < seq.length; i++) if (seq[i].it.id === iid) return { start: seq[i].start, end: seq[i].end };
    return null;
  }
  function duration(p) {
    var seq = mainSeq(p), end = seq.length ? seq[seq.length - 1].end : 0;
    Object.keys(p.items).forEach(function (k) {
      var it = p.items[k];
      if (it.tr !== "main") end = Math.max(end, it.at + itemDur(it));
    });
    return end;
  }

  function outputSize(ar, shortSide) {
    var r = RATIOS[ar] || RATIOS["16:9"], s = shortSide || 1080;
    var w, h;
    if (r[0] >= r[1]) { h = s; w = s * r[0] / r[1]; } else { w = s; h = s * r[1] / r[0]; }
    return { w: Math.round(w / 2) * 2, h: Math.round(h / 2) * 2 };
  }

  // Fade multiplier 0..1 for a clip `local` seconds into it.
  function fadeAt(it, local, dur) {
    var g = 1;
    if (it.fi > 0 && local < it.fi) g = Math.min(g, local / it.fi);
    if (it.fo > 0 && local > dur - it.fo) g = Math.min(g, (dur - local) / it.fo);
    return clamp(g, 0, 1);
  }
  function srcTime(it, local) { return Math.min(it.out, it["in"] + local * it.sp); }

  function pictureLayer(it, local, dur) {
    var L = {
      id: it.id, k: it.k, tr: it.tr, src: it.src || null, alpha: fadeAt(it, local, dur) * (it.op / 100),
      bri: 1, dx: 0, clip: null, local: local
    };
    if (it.k === "video") L.st = srcTime(it, local);
    if (it.k !== "title") { L.fit = it.fit; L.rot = it.rot; L.fl = it.fl; L.lk = it.lk; L.flt = it.flt; }
    if (it.box) L.box = it.box;
    if (it.k === "title") { L.text = it.text; if (it.bg) L.bg = it.bg; }
    return L;
  }

  // What is on screen at time t, bottom to top. Each layer:
  // { id, k, tr, src, st (video: seconds into the file), alpha, bri,
  //   dx (horizontal shift, fraction of the frame), clip ([x0, x1] of
  //   the frame shown, wipes), fit, rot, fl, lk, flt, box, text, bg,
  //   local (seconds into the clip) }
  function framePlan(p, t) {
    var layers = [], seq = mainSeq(p);
    for (var i = 0; i < seq.length; i++) {
      var s = seq[i];
      if (t < s.start || t >= s.end) continue;
      var L = pictureLayer(s.it, t - s.start, s.end - s.start);
      var next = seq[i + 1];
      // inside the transition into this clip
      if (s.tx > 0 && t < s.start + s.tx) {
        var q = (t - s.start) / s.tx, k = s.it.tx.k;
        if (k === "fade") L.alpha *= q;
        else if (k === "black") { if (q < 0.5) L.alpha = 0; else L.bri = 2 * q - 1; }
        else if (k === "slide") L.dx = 1 - q;
        else if (k === "wipe") L.clip = [0, q];
      }
      // inside the transition out of this clip (into the next one)
      if (next && next.tx > 0 && t >= next.start) {
        var q2 = (t - next.start) / next.tx, k2 = next.it.tx.k;
        if (k2 === "black") { if (q2 >= 0.5) L.alpha = 0; else L.bri = 1 - 2 * q2; }
        else if (k2 === "slide") L.dx = -q2;
      }
      layers.push(L);
    }
    ["ov", "tt"].forEach(function (tr) {
      trackItems(p, tr).forEach(function (it) {
        var d = itemDur(it);
        if (t >= it.at && t < it.at + d) layers.push(pictureLayer(it, t - it.at, d));
      });
    });
    return layers;
  }

  // Everything that makes sound, on the timeline:
  // [{ id, src, start, dur, in, sp, vol (0..2), fi, fo }]
  // A main transition crossfades the two clips' sound over its length.
  function soundPlan(p) {
    var out = [], seq = mainSeq(p);
    seq.forEach(function (s, i) {
      var it = s.it;
      if (it.k !== "video" || it.mu || it.vol === 0) return;
      var next = seq[i + 1];
      out.push({
        id: it.id, src: it.src, start: s.start, dur: s.end - s.start, "in": it["in"], sp: it.sp, vol: it.vol / 100,
        fi: Math.max(it.fi, s.tx), fo: Math.max(it.fo, next ? next.tx : 0)
      });
    });
    ["ov", "a1", "a2"].forEach(function (tr) {
      trackItems(p, tr).forEach(function (it) {
        if ((it.k !== "video" && it.k !== "audio") || it.mu || it.vol === 0) return;
        out.push({ id: it.id, src: it.src, start: it.at, dur: itemDur(it), "in": it["in"], sp: it.sp, vol: it.vol / 100, fi: it.fi, fo: it.fo });
      });
    });
    return out.sort(function (a, b) { return a.start !== b.start ? a.start - b.start : cmpStr(a.id, b.id); });
  }
  // Gain of a sound segment `local` seconds into it.
  function gainAt(seg, local) {
    var g = seg.vol;
    if (seg.fi > 0 && local < seg.fi) g *= clamp(local / seg.fi, 0, 1);
    if (seg.fo > 0 && local > seg.dur - seg.fo) g *= clamp((seg.dur - local) / seg.fo, 0, 1);
    return g;
  }

  // Every media id a project (or all projects) needs.
  function mediaOf(p) {
    var ids = {};
    Object.keys(p.items).forEach(function (k) { if (p.items[k].src) ids[p.items[k].src] = 1; });
    return Object.keys(ids).sort(cmpStr);
  }

  // ---------- Edits (each returns new data; the input is untouched) ----------
  // Every edit stamps m at the mutation site (R27) with a clock that
  // never goes back for that entity (a device whose clock is behind
  // still wins over its own previous edit).
  function clone(data) { return merge(data, null); }
  function tick(old, now) { return Math.max(now, old ? old + 1 : 0); }

  function newProject(data, opts, now, id) {
    var d = clone(data);
    if (!isId(id) || d.projects[id]) return d;
    var f = normFields({ name: opts && opts.name, ar: opts && opts.ar, fps: opts && opts.fps, bg: opts && opts.bg, m: tick(d.tombs[id], now) });
    var p = { id: id };
    Object.keys(f).forEach(function (k) { p[k] = f[k]; });
    p.items = {}; p.tombs = {};
    d.projects[id] = p;
    return merge(d, null);
  }
  function setProject(data, pid, patch, now) {
    var d = clone(data), p = d.projects[pid];
    if (!p) return d;
    var f = normFields(p), changed = false;
    ["name", "ar", "fps", "bg", "vs"].forEach(function (k) {
      if (!patch || !(k in patch)) return;
      var cand = Object.assign({}, f);
      cand[k] = patch[k];
      var v = normFields(cand)[k];
      if (v !== p[k]) { p[k] = v; changed = true; }
    });
    if (changed) p.m = tick(p.m, now);
    return merge(d, null);
  }
  function delProject(data, pid, now) {
    var d = clone(data), p = d.projects[pid];
    if (!p) return d;
    d.tombs[pid] = tick(lastEdit(p), now);
    return merge(d, null);
  }

  // A fresh order key after `afterId` on the main track (null = first;
  // undefined = last). Renumbers the track when two keys get too close.
  function orderKey(p, afterId, now) {
    var list = trackItems(p, "main");
    if (afterId === undefined) return list.length ? list[list.length - 1].o + 1 : 1;
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === afterId) idx = i;
    if (afterId !== null && idx < 0) return list.length ? list[list.length - 1].o + 1 : 1;
    var lo = idx >= 0 ? list[idx].o : (list.length ? list[0].o - 2 : 0);
    var hi = idx + 1 < list.length ? list[idx + 1].o : lo + 2;
    if (hi - lo > 1e-6) return (lo + hi) / 2;
    list.forEach(function (it, j) { it.o = j + 1; it.m = tick(it.m, now); });
    return (idx >= 0 ? idx + 1 : 0) + 0.5;
  }

  // Add an item; opts.after = the main clip it follows (null = first).
  function addItem(data, pid, item, now, opts) {
    var d = clone(data), p = d.projects[pid];
    if (!p || !item || !isId(item.id) || p.items[item.id]) return d;
    if (Object.keys(p.items).length >= MAX_ITEMS) return d;
    var it = Object.assign({}, item, { m: tick(p.tombs[item.id], now) });
    if (it.tr === "main") it.o = orderKey(p, opts ? opts.after : undefined, now);
    var n = normItem(it, it.id);
    if (!n) return d;
    p.items[n.id] = n;
    return merge(d, null);
  }
  function setItem(data, pid, iid, patch, now) {
    var d = clone(data), p = d.projects[pid], it = p && p.items[iid];
    if (!it) return d;
    var next = Object.assign({}, it, patch || {}, { id: it.id, k: it.k, m: it.m });
    if (next.tr !== it.tr) {                                 // change of track
      if (next.tr === "main") { delete next.at; next.o = orderKey(p, undefined, now); }
      else if (it.tr === "main") { var pl = placeOf(p, iid); next.at = pl ? pl.start : 0; delete next.tx; }
    }
    var n = normItem(next, iid);
    if (!n || JSON.stringify(n) === JSON.stringify(it)) return d;
    n.m = tick(it.m, now);
    p.items[iid] = n;
    return merge(d, null);
  }
  function delItem(data, pid, iid, now) {
    var d = clone(data), p = d.projects[pid], it = p && p.items[iid];
    if (!it) return d;
    p.tombs[iid] = tick(it.m, now);
    delete p.items[iid];
    return merge(d, null);
  }
  // Move a main clip so that it follows `afterId` (null = first).
  function moveMain(data, pid, iid, afterId, now) {
    var d = clone(data), p = d.projects[pid], it = p && p.items[iid];
    if (!it || it.tr !== "main" || afterId === iid) return d;
    delete p.items[iid];
    var o = orderKey(p, afterId, now);
    p.items[iid] = it;
    if (o === it.o) return merge(d, null);
    it.o = o; it.m = tick(it.m, now);
    return merge(d, null);
  }

  // Split an item at timeline time t; the right part gets newId.
  function split(data, pid, iid, t, now, newId) {
    var d = clone(data), p = d.projects[pid], it = p && p.items[iid];
    if (!it || !isId(newId) || p.items[newId]) return d;
    var pl = placeOf(p, iid), local = t - pl.start, dur = pl.end - pl.start;
    if (!(local >= MIN && dur - local >= MIN)) return d;
    var left = JSON.parse(JSON.stringify(it)), right = JSON.parse(JSON.stringify(it));
    right.id = newId; right.fi = 0; left.fo = 0;
    if (it.k === "video" || it.k === "audio") {
      var cut = it["in"] + local * it.sp;
      left.out = cut; right["in"] = cut;
    } else { left.d = local; right.d = dur - local; }
    if (it.tr === "main") { right.tx = null; right.o = orderKey(p, iid, now); }
    else right.at = it.at + local;
    left.m = tick(it.m, now); right.m = tick(p.tombs[newId], now);
    var nl = normItem(left, iid), nr = normItem(right, newId);
    if (!nl || !nr) return d;
    p.items[iid] = nl; p.items[newId] = nr;
    return merge(d, null);
  }
  function duplicate(data, pid, iid, now, newId) {
    var d = clone(data), p = d.projects[pid], it = p && p.items[iid];
    if (!it || !isId(newId) || p.items[newId]) return d;
    var c = JSON.parse(JSON.stringify(it));
    c.id = newId; c.m = tick(p.tombs[newId], now);
    if (it.tr === "main") c.o = orderKey(p, iid, now);
    else c.at = it.at + itemDur(it);
    var n = normItem(c, newId);
    if (!n) return d;
    p.items[newId] = n;
    return merge(d, null);
  }
  // The sound of a video clip becomes its own clip on a sound track,
  // and the video goes silent.
  function detachSound(data, pid, iid, now, newId, track) {
    var d = clone(data), p = d.projects[pid], it = p && p.items[iid];
    if (!it || it.k !== "video" || it.mu || !isId(newId) || p.items[newId]) return d;
    var pl = placeOf(p, iid);
    var a = normItem({
      id: newId, k: "audio", tr: track === "a2" ? "a2" : "a1", src: it.src, len: it.len, "in": it["in"], out: it.out,
      sp: it.sp, vol: it.vol, fi: it.fi, fo: it.fo, at: pl.start, m: tick(p.tombs[newId], now)
    }, newId);
    if (!a) return d;
    p.items[newId] = a;
    it.mu = true; it.m = tick(it.m, now);
    return merge(d, null);
  }

  // Relink with a different file: every clip that used oldId uses
  // newId (its length clamps in/out points to the new file).
  function replaceSrc(data, pid, oldId, newId, len, now) {
    var d = clone(data), p = d.projects[pid];
    if (!p) return d;
    Object.keys(p.items).forEach(function (k) {
      var it = p.items[k];
      if (it.src !== oldId) return;
      var next = JSON.parse(JSON.stringify(it));
      next.src = newId;
      if (it.k === "video" || it.k === "audio") {
        next.len = len || 0;
        if (len > 0 && next.out > len) { next.out = len; next["in"] = Math.min(next["in"], Math.max(0, len - MIN)); }
      }
      var n = normItem(next, k);
      if (!n) return;
      n.m = tick(it.m, now);
      p.items[k] = n;
    });
    return merge(d, null);
  }

  // Undo / redo: bring a project back to an earlier copy of itself.
  // Every item that differs gets a fresh m (and items gone since then
  // come back newer than their tombstone), so the restore is an edit
  // like any other and travels through sync.
  function restoreProject(data, pid, snap, now) {
    var d = clone(data), p = d.projects[pid];
    var wrap = { projects: {} };
    wrap.projects[pid] = snap;
    var s = snap ? merge(wrap, null).projects[pid] : null;
    if (!p || !s) return d;
    var f = normFields(p), fs = normFields(s), changed = false;
    ["name", "ar", "fps", "bg", "vs"].forEach(function (k) { if (f[k] !== fs[k]) { p[k] = fs[k]; changed = true; } });
    if (changed) p.m = tick(p.m, now);
    Object.keys(p.items).forEach(function (k) {
      if (!s.items[k]) { p.tombs[k] = tick(p.items[k].m, now); delete p.items[k]; }
    });
    Object.keys(s.items).forEach(function (k) {
      var want = JSON.parse(JSON.stringify(s.items[k])), cur = p.items[k];
      if (cur) { want.m = cur.m; if (JSON.stringify(want) === JSON.stringify(cur)) return; }
      want.m = tick(Math.max(cur ? cur.m : 0, p.tombs[k] || 0), now);
      p.items[k] = want;
    });
    return merge(d, null);
  }

  // Bring a deleted project back (undo): a fresh edit newer than its
  // tombstone, so every device sees it return (R17).
  function undeleteProject(data, snap, now) {
    var d = clone(data);
    if (!snap || !isId(snap.id) || d.projects[snap.id]) return d;
    var wrap = { projects: {} };
    wrap.projects[snap.id] = snap;
    var s = merge(wrap, null).projects[snap.id];
    if (!s) return d;
    var m = tick(Math.max(d.tombs[snap.id] || 0, lastEdit(s)), now);
    s.m = m;
    Object.keys(s.items).forEach(function (k) { s.items[k].m = m; });
    d.projects[snap.id] = s;
    return merge(d, null);
  }

  // ---------- Small helpers for the app ----------
  function projectList(data) {
    var ps = (data && data.projects) || {};
    return Object.keys(ps).map(function (k) { return ps[k]; })
      .sort(function (a, b) { var ma = lastEdit(a), mb = lastEdit(b); return ma !== mb ? mb - ma : cmpStr(a.id, b.id); });
  }
  function fmtTime(sec, withFrames, fps) {
    sec = Math.max(0, sec || 0);
    var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = Math.floor(sec) % 60;
    var out = (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s;
    if (withFrames) { var f = Math.floor((sec - Math.floor(sec)) * (fps || 30) + 1e-6); out += "." + (f < 10 ? "0" : "") + f; }
    return out;
  }
  function exportName(name, ext) {
    var base = String(name || "montage").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "montage";
    return base + "." + (ext === "webm" ? "webm" : "mp4");
  }

  var api = {
    VER: VER, MIN: MIN, MAX_ITEMS: MAX_ITEMS, KINDS: KINDS, TRACKS: TRACKS, TRACK_KINDS: TRACK_KINDS,
    RATIOS: Object.keys(RATIOS), FPS: FPS.slice(), TRANSITIONS: TRANSITIONS.slice(), FILTERS: FILTERS.slice(), ANIMS: ANIMS.slice(),
    isId: isId, isPicture: isPicture, isVideo: isVideo, isSound: isSound,
    normItem: normItem, merge: merge, lastEdit: lastEdit,
    itemDur: itemDur, trackItems: trackItems, mainSeq: mainSeq, placeOf: placeOf, duration: duration,
    outputSize: outputSize, framePlan: framePlan, soundPlan: soundPlan, gainAt: gainAt, fadeAt: fadeAt, mediaOf: mediaOf,
    newProject: newProject, setProject: setProject, delProject: delProject,
    addItem: addItem, setItem: setItem, delItem: delItem, moveMain: moveMain,
    split: split, duplicate: duplicate, detachSound: detachSound, restoreProject: restoreProject, undeleteProject: undeleteProject, replaceSrc: replaceSrc,
    projectList: projectList, fmtTime: fmtTime, exportName: exportName
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MontageCore = api;
})(typeof window !== "undefined" ? window : this);
