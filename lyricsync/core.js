// ============================================================
// orOS Lyric Sync — data model and timing (pure, no DOM)
// Loaded by index.html before app.js, and by Node in the tests.
// Data in localStorage "oros-lyricsync-data" (synced as slice
// "lyricsync"; the audio never travels, see app.js):
//   { ver: 1, items: [project], tombs: { id: ms } }
//   project = { id, name, ar (artist), al (album), lg (language),
//               dur (song length, ms), au: { n, z } | null (the
//               audio file's name and size, to find it again),
//               ln: [line], mtime }
//   line = { id, t (text), s (start ms | null), e (end ms | null),
//            p (1 = starts a new verse), w (wave 2: one start per word
//            of t, ms | null, never before s, never going back),
//            v (wave 2: singer 2-4; none = singer 1) }
//   project.vn = singer names (wave 2), at most 4
// A line's end is optional: with none it ends where the next timed
// line starts (Tap mode); Hold mode and "End" write it.
// Sync rules (OROS_BIBLE.md Part I, Part VI):
//   - merge(a, b) === merge(b, a): union by project id, the newer
//     mtime wins, a tie goes to the larger JSON (never "local wins");
//   - merge(a, a) === a, so a pull never makes the slice dirty;
//   - a tombstone at least as new as the project deletes it, a newer
//     edit brings it back (R17);
//   - no id, Date.now() or Math.random() inside the merge;
//   - serialize() is canonical: projects sorted by id, tombs by key.
// ============================================================
(function (root) {
  "use strict";

  var VER = 1;
  var MAX_PROJECTS = 300, MAX_LINES = 2000, MAX_LINE = 500, MAX_NAME = 200;
  var MAX_MS = 6 * 3600 * 1000;           // six hours: anything later is broken input
  var DEFAULT_LAST = 5000;                // the last line's length when nothing else says

  function empty() { return { ver: VER, items: [], tombs: {} }; }

  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function ms(v) { return typeof v === "number" && isFinite(v) && v > 0 ? Math.floor(v) : 0; }
  function tm(v) { return typeof v === "number" && isFinite(v) && v >= 0 && v <= MAX_MS ? Math.round(v) : null; }
  function oneLine(v, max) { return str(v, max * 2).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }

  function newId(prefix, rand) {
    var r = rand || Math.random, s = "";
    while (s.length < 10) s += Math.floor(r() * 36).toString(36);
    return (prefix || "") + s;
  }

  // A bad line or project is dropped, never repaired with a fresh id.
  function cleanLine(raw) {
    if (!raw || typeof raw !== "object") return null;
    var id = str(raw.id, 40);
    if (!id) return null;
    var s = tm(raw.s), e = tm(raw.e);
    if (s === null || (e !== null && e <= s)) e = null;
    var out = { id: id, t: oneLine(raw.t, MAX_LINE), s: s, e: e };
    if (raw.p === 1) out.p = 1;
    var w = cleanWords(raw.w, out);
    if (w) out.w = w;
    if (raw.v === 2 || raw.v === 3 || raw.v === 4) out.v = raw.v;
    return out;
  }
  function words(t) { return String(t || "").split(/\s+/).filter(Boolean); }
  // Word starts: one per word, the first never before the line's start,
  // each never before the one before; anything else drops them all.
  function cleanWords(w, l) {
    if (!Array.isArray(w) || l.s === null) return null;
    var n = words(l.t).length;
    if (!n || w.length !== n) return null;
    var last = l.s, any = false, out = [];
    for (var k = 0; k < n; k++) {
      var v = w[k] === null ? null : tm(w[k]);
      if (w[k] !== null && v === null) return null;
      if (v !== null) { if (v < last || (l.e !== null && v >= l.e)) return null; last = v; any = true; }
      out.push(v);
    }
    return any ? out : null;
  }
  function cleanProject(raw) {
    if (!raw || typeof raw !== "object") return null;
    var id = str(raw.id, 64);
    if (!id) return null;
    var seen = {}, ln = [];
    (Array.isArray(raw.ln) ? raw.ln : []).forEach(function (l) {
      var c = cleanLine(l);
      if (c && !seen[c.id] && ln.length < MAX_LINES) { seen[c.id] = 1; ln.push(c); }
    });
    var au = null;
    if (raw.au && typeof raw.au === "object" && typeof raw.au.n === "string" && raw.au.n) {
      au = { n: oneLine(raw.au.n, MAX_NAME), z: ms(raw.au.z) };
    }
    var out = { id: id, name: oneLine(raw.name, MAX_NAME), ar: oneLine(raw.ar, MAX_NAME), al: oneLine(raw.al, MAX_NAME),
             lg: oneLine(raw.lg, 20), dur: tm(raw.dur) || 0, au: au, ln: ln, mtime: ms(raw.mtime) };
    var src = diskPath(raw.src);
    if (src) out.src = src;
    if (Array.isArray(raw.vn)) {
      var vn = raw.vn.slice(0, 4).map(function (x) { return oneLine(x, 60); });
      while (vn.length && !vn[vn.length - 1]) vn.pop();
      if (vn.length) out.vn = vn;
    }
    return out;
  }

  // Wave 3: the song's file on the orOS disk ("/internal/Music/…"),
  // so every device finds it through Vault Drive. Only a clean
  // absolute path under /internal is kept.
  function diskPath(v) {
    if (typeof v !== "string" || v.length > 1024 || v.indexOf("/internal/") !== 0) return "";
    if (/[\u0000-\u001f\\]/.test(v) || /\/\.{1,2}(\/|$)/.test(v) || /\/\//.test(v) || /\/$/.test(v)) return "";
    return v;
  }
  // The lyrics file Music reads next to a song: same name, .lrc.
  function lrcPath(src) {
    src = diskPath(src);
    if (!src) return "";
    var slash = src.lastIndexOf("/"), dot = src.lastIndexOf(".");
    return (dot > slash + 1 ? src.slice(0, dot) : src) + ".lrc";
  }
  function fileOf(src) { return String(src || "").split("/").pop(); }

  function newer(a, b) {
    if (a.mtime !== b.mtime) return a.mtime > b.mtime;
    return JSON.stringify(a) > JSON.stringify(b);
  }
  function byId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }

  function mergeLists(list) {
    var items = {}, tombs = {};
    list.forEach(function (d) {
      if (!d || typeof d !== "object") return;
      if (d.tombs && typeof d.tombs === "object") {
        Object.keys(d.tombs).forEach(function (k) {
          var v = ms(d.tombs[k]);
          if (v && k.length <= 64 && (!tombs[k] || v > tombs[k])) tombs[k] = v;
        });
      }
      (Array.isArray(d.items) ? d.items : []).forEach(function (raw) {
        var p = cleanProject(raw);
        if (!p) return;
        if (!items[p.id] || newer(p, items[p.id])) items[p.id] = p;
      });
    });
    var out = empty();
    Object.keys(items).forEach(function (id) {
      if (!(tombs[id] >= items[id].mtime)) out.items.push(items[id]);
    });
    out.items.sort(byId);
    if (out.items.length > MAX_PROJECTS) {
      // Keep the newest; the order of the rule is pure (mtime, then id).
      out.items = out.items.slice().sort(function (a, b) { return b.mtime - a.mtime || byId(a, b); })
        .slice(0, MAX_PROJECTS).sort(byId);
    }
    Object.keys(tombs).sort().forEach(function (k) { out.tombs[k] = tombs[k]; });
    return out;
  }

  function normalize(d) { return mergeLists([d]); }
  function merge(a, b) { return mergeLists([a, b]); }
  function serialize(d) { return JSON.stringify(normalize(d)); }

  function find(d, id) { return d.items.filter(function (p) { return p.id === id; })[0] || null; }
  // Newest first, for the list of songs.
  function live(d) { return d.items.slice().sort(function (a, b) { return b.mtime - a.mtime || byId(a, b); }); }

  // The newest song made from this disk file, or null.
  function bySrc(d, src) {
    src = diskPath(src);
    if (!src) return null;
    return live(d).filter(function (p) { return p.src === src; })[0] || null;
  }

  function put(d, p, now) {
    var c = cleanProject(Object.assign({}, p, { mtime: Math.max(ms(now), (p.mtime || 0) + 1) }));
    var items = d.items.filter(function (x) { return x.id !== c.id; });
    items.push(c);
    var tombs = Object.assign({}, d.tombs);
    delete tombs[c.id];
    return normalize({ ver: VER, items: items, tombs: tombs });
  }
  function remove(d, id, now) {
    var tombs = Object.assign({}, d.tombs);
    var p = find(d, id);
    tombs[id] = Math.max(ms(now), p ? p.mtime : 0);
    return normalize({ ver: VER, items: d.items.filter(function (x) { return x.id !== id; }), tombs: tombs });
  }

  function newProject(name, now, rand) {
    return cleanProject({ id: newId("s", rand), name: name || "", ln: [], mtime: ms(now) || 1 });
  }

  // ---------- Lyrics text ↔ lines ----------
  // A blank line between two lines starts a new verse (p: 1).
  function splitText(text) {
    var out = [], gap = false;
    String(text || "").replace(/\r\n?/g, "\n").split("\n").forEach(function (raw) {
      var t = oneLine(raw, MAX_LINE);
      if (!t) { gap = out.length > 0; return; }
      if (out.length < MAX_LINES) out.push({ t: t, p: gap ? 1 : 0 });
      gap = false;
    });
    return out;
  }
  function toText(lines) {
    return lines.map(function (l, i) { return (i && l.p ? "\n" : "") + l.t; }).join("\n");
  }

  // New lyrics text for existing lines: the lines that stay the same
  // (longest common run, in order) keep their id and times, so a typo
  // fix elsewhere never loses the timing already done.
  function relyric(lines, text, rand) {
    var neu = splitText(text), a = lines.map(function (l) { return l.t; }), b = neu.map(function (l) { return l.t; });
    var n = a.length, m = b.length, i, j;
    var L = [];
    for (i = 0; i <= n; i++) { L.push(new Array(m + 1).fill(0)); }
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) {
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
    var keep = new Array(m).fill(-1);
    i = 0; j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { keep[j] = i; i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) i++;
      else j++;
    }
    return neu.map(function (l, k) {
      var old = keep[k] >= 0 ? lines[keep[k]] : null;
      var out = old ? { id: old.id, t: l.t, s: old.s, e: old.e } : { id: newId("l", rand), t: l.t, s: null, e: null };
      if (l.p) out.p = 1;
      if (old && old.w) out.w = old.w.slice();
      if (old && old.v) out.v = old.v;
      return out;
    });
  }

  // ---------- Syncing (each returns a new lines array) ----------
  function copyLines(lines) { return lines.map(function (l) { var o = Object.assign({}, l); if (l.w) o.w = l.w.slice(); return o; }); }
  // Drops word times that no longer fit the line (start, end, order).
  function fixWords(l) { var w = cleanWords(l.w, l); if (w) l.w = w; else delete l.w; return l; }
  function prevTimed(lines, i) { for (var k = i - 1; k >= 0; k--) if (lines[k].s !== null) return k; return -1; }
  function nextTimed(lines, i) { for (var k = i + 1; k < lines.length; k++) if (lines[k].s !== null) return k; return -1; }

  // Tap: line i starts at t (its own end is cleared: it ends at the next
  // start unless "End" is pressed); an earlier line's end never goes
  // past it.
  function startAt(lines, i, t) {
    var out = copyLines(lines);
    if (!out[i]) return out;
    t = Math.max(0, Math.round(t));
    out[i].s = t; out[i].e = null;
    if (out[i].w) { var d = out[i].w[0] !== null ? t - out[i].w[0] : 0; out[i].w = out[i].w.map(function (x) { return x === null ? null : x + d; }); fixWords(out[i]); }
    var k = prevTimed(out, i);
    if (k >= 0 && out[k].e !== null && out[k].e > t) { out[k].e = out[k].s < t ? t : null; fixWords(out[k]); }
    return out;
  }
  // Hold release or "End": line i ends at t (later than its start).
  function endAt(lines, i, t) {
    var out = copyLines(lines);
    if (!out[i] || out[i].s === null) return out;
    t = Math.round(t);
    out[i].e = t > out[i].s ? t : null;
    fixWords(out[i]);
    return out;
  }
  function clearTime(lines, i) {
    var out = copyLines(lines);
    if (out[i]) { out[i].s = null; out[i].e = null; delete out[i].w; }
    return out;
  }
  function clearAll(lines) {
    return lines.map(function (l) { var o = Object.assign({}, l); o.s = null; o.e = null; delete o.w; return o; });
  }
  // Moves the start (and an explicit end with it, when the line keeps
  // its length) by d ms; never below zero.
  function nudge(lines, i, d) {
    var out = copyLines(lines), l = out[i];
    if (!l || l.s === null) return out;
    var s = Math.max(0, l.s + Math.round(d)), dd = s - l.s;
    if (l.e !== null) l.e = Math.max(s + 1, l.e + dd);
    if (l.w) l.w = l.w.map(function (x) { return x === null ? null : x + dd; });
    l.s = s;
    return out;
  }
  function setStart(lines, i, t) {
    var out = copyLines(lines), l = out[i];
    if (!l || t === null || !isFinite(t)) return out;
    var s = Math.max(0, Math.min(MAX_MS, Math.round(t)));
    if (l.w && l.s !== null) { var dd = s - l.s; l.w = l.w.map(function (x) { return x === null ? null : x + dd; }); }
    l.s = s;
    if (l.e !== null && l.e <= l.s) l.e = null;
    fixWords(l);
    return out;
  }
  // Shifts every timed line (a global offset), never below zero.
  function shiftAll(lines, d) {
    return lines.map(function (l) {
      var o = Object.assign({}, l);
      if (o.s !== null) {
        var s0 = o.s;
        o.s = Math.max(0, o.s + Math.round(d));
        if (o.e !== null) o.e = Math.max(o.s + 1, o.e + (o.s - s0));
        if (l.w) o.w = l.w.map(function (x) { return x === null ? null : x + (o.s - s0); });
      }
      return o;
    });
  }

  // ---------- Words (wave 2) ----------
  // Word k of line i starts at t. Word 0 also starts the line (as a
  // tap would); later words that now come before t lose their time.
  function wordAt(lines, i, k, t) {
    var out = copyLines(lines), l = out[i];
    if (!l) return out;
    var n = words(l.t).length;
    if (k < 0 || k >= n) return out;
    t = Math.max(0, Math.round(t));
    if (k === 0 || l.s === null || t < l.s) {
      out = startAt(out, i, t);
      l = out[i];
      if (!l.w) l.w = new Array(n).fill(null);
    }
    if (!l.w) l.w = new Array(n).fill(null);
    if (l.e !== null && t >= l.e) l.e = null;
    for (var j = 0; j < k; j++) if (l.w[j] !== null && l.w[j] > t) l.w[j] = null;
    l.w[k] = t;
    for (j = k + 1; j < n; j++) if (l.w[j] !== null && l.w[j] < t) l.w[j] = null;
    fixWords(l);
    return out;
  }
  // Drag on the waveform: word k (or the line's start, k = -1) moves to
  // t, held between its neighbours.
  function moveMark(lines, i, k, t) {
    var out = copyLines(lines), l = out[i];
    if (!l || l.s === null) return out;
    t = Math.round(t);
    if (k < 0) {
      var lo = 0, kp = prevTimed(out, i);
      if (kp >= 0) lo = out[kp].s + 1;
      var tied = !!(l.w && l.w[0] === l.s), hi = Infinity, j0;
      if (l.w) for (j0 = tied ? 1 : 0; j0 < l.w.length; j0++) if (l.w[j0] !== null) { hi = l.w[j0]; break; }
      var kn = nextTimed(out, i); if (kn >= 0) hi = Math.min(hi, out[kn].s - 1);
      var ns = Math.max(lo, Math.min(hi, t));
      if (tied) l.w[0] = ns;
      l.s = ns;
      if (l.e !== null && l.e <= l.s) l.e = null;
      fixWords(l);
      return out;
    }
    if (!l.w || l.w[k] === null) return out;
    var a = l.s, b = l.e !== null ? l.e - 1 : Infinity, j;
    for (j = k - 1; j >= 0; j--) if (l.w[j] !== null) { a = l.w[j]; break; }
    for (j = k + 1; j < l.w.length; j++) if (l.w[j] !== null) { b = l.w[j]; break; }
    l.w[k] = Math.max(a, Math.min(b, t));
    if (k === 0 && l.w[0] < l.s) l.w[0] = l.s;
    return out;
  }
  function clearWords(lines, i) { var out = copyLines(lines); if (out[i]) delete out[i].w; return out; }
  function wordsDone(l) { return !!(l && l.w && l.w.every(function (x) { return x !== null; })); }
  function wordCount(lines) { return lines.filter(wordsDone).length; }

  // The first line without a time, from index `from` (the sync cursor).
  function nextUntimed(lines, from) {
    for (var k = Math.max(0, from || 0); k < lines.length; k++) if (lines[k].s === null) return k;
    return lines.length;
  }
  function timedCount(lines) { return lines.filter(function (l) { return l.s !== null; }).length; }

  // ---------- Timed lines for playback and export ----------
  // → [{ i, id, t, s, e, p, ex }] in time order, every line with an
  // end: its own (ex: 1), else the next start, else the song's end
  // (at most 10 s later) or 5 s.
  function timed(lines, dur) {
    var list = [];
    lines.forEach(function (l, i) { if (l.s !== null && l.t) list.push({ i: i, id: l.id, t: l.t, s: l.s, e: l.e, p: l.p ? 1 : 0, ex: l.e !== null ? 1 : 0, v: l.v || 1, w: wordsDone(l) ? l.w : null }); });
    list.sort(function (a, b) { return a.s - b.s || a.i - b.i; });
    list.forEach(function (x, k) {
      var nx = list[k + 1];
      var end = x.e;
      if (end === null) end = nx ? nx.s : (dur && dur > x.s ? Math.min(dur, x.s + 10000) : x.s + DEFAULT_LAST);
      if (nx && end > nx.s) end = nx.s;            // never overlaps the next line
      x.e = Math.max(x.s + 1, end);
      // words: [{ t, s, e }] when every word has a time (wave 2)
      if (x.w) {
        var ws = words(x.t), wt = x.w;
        if (wt[wt.length - 1] >= x.e) x.words = null;
        else x.words = ws.map(function (t, k) { return { t: t, s: wt[k], e: k + 1 < ws.length ? wt[k + 1] : x.e }; });
      } else x.words = null;
      delete x.w;
    });
    return list;
  }
  // The index (in timed()) of the line playing at t, or -1.
  function lineAt(list, t) {
    var lo = 0, hi = list.length - 1, k = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (list[mid].s <= t) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    return k >= 0 && t < list[k].e ? k : -1;
  }

  // ---------- Times as text ----------
  function pad(n, w) { n = String(n); while (n.length < w) n = "0" + n; return n; }
  // kind: "lrc" mm:ss.xx · "srt" hh:mm:ss,mmm · "vtt" hh:mm:ss.mmm ·
  // "clock" m:ss.xx (on screen)
  function fmt(t, kind) {
    t = Math.max(0, Math.round(t || 0));
    var h = Math.floor(t / 3600000), m = Math.floor(t / 60000) % 60, s = Math.floor(t / 1000) % 60, f = t % 1000;
    if (kind === "srt" || kind === "vtt") return pad(h, 2) + ":" + pad(m, 2) + ":" + pad(s, 2) + (kind === "srt" ? "," : ".") + pad(f, 3);
    var cs = Math.floor(f / 10), tm2 = h * 60 + m;
    if (kind === "lrc") return pad(tm2, 2) + ":" + pad(s, 2) + "." + pad(cs, 2);
    return tm2 + ":" + pad(s, 2) + "." + pad(cs, 2);
  }
  // "1:02.5", "62.5", "1:02:03.25", "00:01:02,500" → ms, or null.
  function parseTime(v) {
    var m = /^\s*(?:(\d{1,2}):)?(?:(\d{1,3}):)?(\d{1,5})(?:[.,](\d{1,3}))?\s*$/.exec(String(v || ""));
    if (!m) return null;
    var h = 0, mi = 0;
    if (m[1] !== undefined && m[2] !== undefined) { h = +m[1]; mi = +m[2]; }
    else if (m[1] !== undefined) mi = +m[1];
    else if (m[2] !== undefined) mi = +m[2];
    var f = m[4] ? Math.round(+("0." + m[4]) * 1000) : 0;
    var t = ((h * 60 + mi) * 60 + +m[3]) * 1000 + f;
    return t <= MAX_MS ? t : null;
  }

  // ---------- Quality check (wave 2) ----------
  // → [{ i, code }] in line order. Codes: "untimed", "order" (earlier
  // than a line above), "short" (on screen under 0.4 s), "long" (over
  // 80 characters), "label" ([Chorus], (x2): distributors want only
  // sung words), "words" (some words timed, not all), "gap" (on screen
  // 15 s or more: mark its end).
  function issues(lines, dur) {
    var out = [], last = -1, ends = {};
    timed(lines, dur).forEach(function (x) { ends[x.i] = x; });
    lines.forEach(function (l, i) {
      var txt = [];
      if (l.t.length > 80) txt.push({ i: i, code: "long" });
      if (/^\s*[\[(][^\])]*[\])]\s*$/.test(l.t) || /\(\s*(?:x\s*\d+|\d+\s*x)\s*\)|\b[x×]\s?\d\b/i.test(l.t)) txt.push({ i: i, code: "label" });
      if (l.s === null) { out.push({ i: i, code: "untimed" }); out.push.apply(out, txt); return; }
      if (l.s < last) out.push({ i: i, code: "order" });
      last = Math.max(last, l.s);
      var x = ends[i];
      if (x && x.e - x.s < 400) out.push({ i: i, code: "short" });
      if (x && !x.ex && x.e - x.s >= 15000) out.push({ i: i, code: "gap" });
      out.push.apply(out, txt);
      if (l.w && !wordsDone(l)) out.push({ i: i, code: "words" });
    });
    return out;
  }

  var API = {
    VER: VER, MAX_LINES: MAX_LINES, MAX_LINE: MAX_LINE, MAX_PROJECTS: MAX_PROJECTS,
    empty: empty, normalize: normalize, merge: merge, serialize: serialize, cleanProject: cleanProject,
    find: find, live: live, put: put, remove: remove, newProject: newProject, newId: newId,
    splitText: splitText, toText: toText, relyric: relyric,
    startAt: startAt, endAt: endAt, clearTime: clearTime, clearAll: clearAll, nudge: nudge, setStart: setStart, shiftAll: shiftAll,
    nextUntimed: nextUntimed, prevTimed: prevTimed, nextTimed: nextTimed, timedCount: timedCount,
    timed: timed, lineAt: lineAt, fmt: fmt, parseTime: parseTime,
    words: words, wordAt: wordAt, moveMark: moveMark, clearWords: clearWords, wordsDone: wordsDone, wordCount: wordCount, issues: issues,
    diskPath: diskPath, lrcPath: lrcPath, fileOf: fileOf, bySrc: bySrc
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.LyricsyncCore = API;
})(typeof window !== "undefined" ? window : globalThis);
