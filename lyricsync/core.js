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
//            p (1 = starts a new verse) }
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
    return out;
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
    return { id: id, name: oneLine(raw.name, MAX_NAME), ar: oneLine(raw.ar, MAX_NAME), al: oneLine(raw.al, MAX_NAME),
             lg: oneLine(raw.lg, 20), dur: tm(raw.dur) || 0, au: au, ln: ln, mtime: ms(raw.mtime) };
  }

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
      return out;
    });
  }

  // ---------- Syncing (each returns a new lines array) ----------
  function copyLines(lines) { return lines.map(function (l) { return Object.assign({}, l); }); }
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
    var k = prevTimed(out, i);
    if (k >= 0 && out[k].e !== null && out[k].e > t) out[k].e = out[k].s < t ? t : null;
    return out;
  }
  // Hold release or "End": line i ends at t (later than its start).
  function endAt(lines, i, t) {
    var out = copyLines(lines);
    if (!out[i] || out[i].s === null) return out;
    t = Math.round(t);
    out[i].e = t > out[i].s ? t : null;
    return out;
  }
  function clearTime(lines, i) {
    var out = copyLines(lines);
    if (out[i]) { out[i].s = null; out[i].e = null; }
    return out;
  }
  function clearAll(lines) {
    return lines.map(function (l) { var o = Object.assign({}, l); o.s = null; o.e = null; return o; });
  }
  // Moves the start (and an explicit end with it, when the line keeps
  // its length) by d ms; never below zero.
  function nudge(lines, i, d) {
    var out = copyLines(lines), l = out[i];
    if (!l || l.s === null) return out;
    var s = Math.max(0, l.s + Math.round(d));
    if (l.e !== null) l.e = Math.max(s + 1, l.e + (s - l.s));
    l.s = s;
    return out;
  }
  function setStart(lines, i, t) {
    var out = copyLines(lines), l = out[i];
    if (!l || t === null || !isFinite(t)) return out;
    l.s = Math.max(0, Math.min(MAX_MS, Math.round(t)));
    if (l.e !== null && l.e <= l.s) l.e = null;
    return out;
  }
  // Shifts every timed line (a global offset), never below zero.
  function shiftAll(lines, d) {
    return lines.map(function (l) {
      var o = Object.assign({}, l);
      if (o.s !== null) { o.s = Math.max(0, o.s + Math.round(d)); if (o.e !== null) o.e = Math.max(o.s + 1, o.e + Math.round(d)); }
      return o;
    });
  }

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
    lines.forEach(function (l, i) { if (l.s !== null && l.t) list.push({ i: i, id: l.id, t: l.t, s: l.s, e: l.e, p: l.p ? 1 : 0, ex: l.e !== null ? 1 : 0 }); });
    list.sort(function (a, b) { return a.s - b.s || a.i - b.i; });
    list.forEach(function (x, k) {
      var nx = list[k + 1];
      var end = x.e;
      if (end === null) end = nx ? nx.s : (dur && dur > x.s ? Math.min(dur, x.s + 10000) : x.s + DEFAULT_LAST);
      if (nx && end > nx.s) end = nx.s;            // never overlaps the next line
      x.e = Math.max(x.s + 1, end);
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

  var API = {
    VER: VER, MAX_LINES: MAX_LINES, MAX_LINE: MAX_LINE, MAX_PROJECTS: MAX_PROJECTS,
    empty: empty, normalize: normalize, merge: merge, serialize: serialize, cleanProject: cleanProject,
    find: find, live: live, put: put, remove: remove, newProject: newProject, newId: newId,
    splitText: splitText, toText: toText, relyric: relyric,
    startAt: startAt, endAt: endAt, clearTime: clearTime, clearAll: clearAll, nudge: nudge, setStart: setStart, shiftAll: shiftAll,
    nextUntimed: nextUntimed, prevTimed: prevTimed, nextTimed: nextTimed, timedCount: timedCount,
    timed: timed, lineAt: lineAt, fmt: fmt, parseTime: parseTime
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.LyricsyncCore = API;
})(typeof window !== "undefined" ? window : globalThis);
