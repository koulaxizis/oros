// ============================================================
// orOS Lyric Sync — sets.js (Songbook S3, pure)
// Setlists: ordered lists of songs for a gig or a rehearsal, each song
// with its own key for this set (the song itself is not changed), and
// notes. Synced as their OWN slice "songbook" (key oros-songbook-data),
// apart from the songs, because a Lyric Sync build from before S3 would
// drop an unknown top-level field of the "lyricsync" slice.
//
// SONGBOOK v1 { ver: 1, sets: [{ id "t…", name, date? "YYYY-MM-DD",
//   nt?, items: [{ s: song id, key?, nt? }], mtime }], tombs: { id: ms } }
// LWW per set by mtime (equal: the longer canonical JSON, then the
// larger one), tombstones (≥ hides, a newer edit comes back), sets
// sorted by id, at most 200 sets × 100 songs (R5, R17, R26). A bad set
// or item is dropped, never repaired.
// Also: ChordPro bundles ({new_song} between songs) and a text list.
// Exposes LyricsyncSets (browser) or module.exports (Node).
// ============================================================
(function (root) {
  "use strict";

  var C = typeof module !== "undefined" && module.exports ? require("./core.js") : root.LyricsyncCore;

  var VER = 1, MAX_SETS = 200, MAX_ITEMS = 100, MAX_NAME = 120, MAX_NOTE = 2000, MAX_ITEM_NOTE = 200;
  var MAX_BUNDLE = 300;

  function empty() { return { ver: VER, sets: [], tombs: {} }; }
  function ms(v) { return typeof v === "number" && isFinite(v) && v > 0 ? Math.floor(v) : 0; }
  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function oneLine(v, max) { return str(v, max * 2).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
  function note(v, max) { return str(v, max).replace(/\r\n?/g, "\n"); }
  function isId(v, p) { return typeof v === "string" && v.length >= 2 && v.length <= 40 && v.charAt(0) === p && /^[a-z0-9]+$/.test(v); }
  function isDate(v) {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    var y = +v.slice(0, 4), m = +v.slice(5, 7), d = +v.slice(8, 10);
    if (m < 1 || m > 12 || d < 1) return false;
    return d <= [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }

  function cleanItem(raw) {
    if (!raw || typeof raw !== "object" || !isId(raw.s, "s")) return null;
    var it = { s: raw.s };
    if (C.isKey(raw.key)) it.key = raw.key;
    var n = note(raw.nt, MAX_ITEM_NOTE).trim();
    if (n) it.nt = n;
    return it;
  }
  function cleanSet(raw) {
    if (!raw || typeof raw !== "object" || !isId(raw.id, "t")) return null;
    var mt = ms(raw.mtime);
    if (!mt || !Array.isArray(raw.items)) return null;
    var s = { id: raw.id, name: oneLine(raw.name, MAX_NAME), items: [] };
    if (isDate(raw.date)) s.date = raw.date;
    var n = note(raw.nt, MAX_NOTE).trim();
    if (n) s.nt = n;
    raw.items.slice(0, MAX_ITEMS).forEach(function (x) { var it = cleanItem(x); if (it) s.items.push(it); });
    s.mtime = mt;
    return s;
  }

  function newer(a, b) {
    if (a.mtime !== b.mtime) return a.mtime > b.mtime;
    var ja = JSON.stringify(a), jb = JSON.stringify(b);
    if (ja.length !== jb.length) return ja.length > jb.length;
    return ja > jb;
  }
  function byId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }

  function mergeLists(list) {
    var sets = {}, tombs = {};
    list.forEach(function (d) {
      if (!d || typeof d !== "object") return;
      if (d.tombs && typeof d.tombs === "object") {
        Object.keys(d.tombs).forEach(function (k) {
          var v = ms(d.tombs[k]);
          if (v && k && k.length <= 64 && (!tombs[k] || v > tombs[k])) tombs[k] = v;
        });
      }
      (Array.isArray(d.sets) ? d.sets : []).forEach(function (raw) {
        var s = cleanSet(raw);
        if (!s) return;
        if (!sets[s.id] || newer(s, sets[s.id])) sets[s.id] = s;
      });
    });
    var out = empty();
    Object.keys(sets).forEach(function (id) { if (!(tombs[id] >= sets[id].mtime)) out.sets.push(sets[id]); });
    out.sets.sort(byId);
    if (out.sets.length > MAX_SETS) {
      out.sets = out.sets.slice().sort(function (a, b) { return b.mtime - a.mtime || byId(a, b); }).slice(0, MAX_SETS).sort(byId);
    }
    Object.keys(tombs).sort().forEach(function (k) { out.tombs[k] = tombs[k]; });
    return out;
  }
  function normalize(d) { return mergeLists([d]); }
  function merge(a, b) { return mergeLists([a, b]); }
  function serialize(d) { return JSON.stringify(normalize(d)); }

  function find(d, id) { return d.sets.filter(function (s) { return s.id === id; })[0] || null; }
  // For the list: the next dated sets first (soonest first), then the
  // undated and past ones, newest edit first. today = "YYYY-MM-DD".
  function live(d, today) {
    return d.sets.slice().sort(function (a, b) {
      var fa = a.date && a.date >= today, fb = b.date && b.date >= today;
      if (fa !== fb) return fa ? -1 : 1;
      if (fa && a.date !== b.date) return a.date < b.date ? -1 : 1;
      return b.mtime - a.mtime || byId(a, b);
    });
  }
  function put(d, s, now) {
    var c = cleanSet(Object.assign({}, s, { mtime: Math.max(ms(now), (s.mtime || 0) + 1) }));
    if (!c) return d;
    var sets = d.sets.filter(function (x) { return x.id !== c.id; });
    sets.push(c);
    var tombs = Object.assign({}, d.tombs);
    delete tombs[c.id];
    return normalize({ ver: VER, sets: sets, tombs: tombs });
  }
  function remove(d, id, now) {
    var tombs = Object.assign({}, d.tombs), s = find(d, id);
    tombs[id] = Math.max(ms(now), s ? s.mtime : 0);
    return normalize({ ver: VER, sets: d.sets.filter(function (x) { return x.id !== id; }), tombs: tombs });
  }
  function newSet(name, now, rand) {
    return cleanSet({ id: C.newId("t", rand), name: name || "", items: [], mtime: ms(now) || 1 });
  }

  // ---------- Editing a set (each → a new set object, not yet put) ----------
  function copy(s) { return Object.assign({}, s, { items: s.items.map(function (x) { return Object.assign({}, x); }) }); }
  function addSong(s, songId) {
    var o = copy(s);
    if (o.items.length < MAX_ITEMS && isId(songId, "s")) o.items.push({ s: songId });
    return o;
  }
  function removeAt(s, i) { var o = copy(s); o.items.splice(i, 1); return o; }
  function move(s, i, to) {
    var o = copy(s);
    if (i < 0 || i >= o.items.length) return o;
    to = Math.max(0, Math.min(o.items.length - 1, to));
    var it = o.items.splice(i, 1)[0];
    o.items.splice(to, 0, it);
    return o;
  }
  function setItem(s, i, fields) {
    var o = copy(s), it = o.items[i];
    if (!it) return o;
    if ("key" in fields) { if (C.isKey(fields.key)) it.key = fields.key; else delete it.key; }
    if ("nt" in fields) { var n = note(fields.nt, MAX_ITEM_NOTE).trim(); if (n) it.nt = n; else delete it.nt; }
    return o;
  }
  // The songs of a set that still exist, in order, with their index.
  function songsOf(s, songs) {
    var by = {};
    (songs.items || []).forEach(function (p) { by[p.id] = p; });
    var out = [];
    s.items.forEach(function (it, i) { if (by[it.s]) out.push({ i: i, item: it, song: by[it.s] }); });
    return out;
  }

  // ---------- Key for this set ----------
  var PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function pcOf(key) { return (PC[key.charAt(0)] + (key.charAt(1) === "#" ? 1 : key.charAt(1) === "b" ? 11 : 0)) % 12; }
  // Semitones up from the song's key to the key for this set (0..11);
  // 0 when either is missing.
  function steps(songKey, setKey) {
    if (!C.isKey(songKey) || !C.isKey(setKey)) return 0;
    return (pcOf(setKey) - pcOf(songKey) + 12) % 12;
  }
  // The keys a song can take in a set: same mode as its own key.
  var MAJ = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  var MIN = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"];
  function keysLike(songKey) {
    if (!C.isKey(songKey)) return [];
    return /m$/.test(songKey) ? MIN.slice() : MAJ.slice();
  }

  // ---------- Bundles and lists ----------
  // A ChordPro bundle → one text per song ({new_song} / {ns} between).
  function splitBundle(text) {
    var out = [], cur = [];
    String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n").forEach(function (line) {
      if (/^\s*\{\s*(new_song|ns)\s*\}\s*$/i.test(line)) { out.push(cur.join("\n")); cur = []; }
      else cur.push(line);
    });
    out.push(cur.join("\n"));
    return out.filter(function (x) { return /\S/.test(x); }).slice(0, MAX_BUNDLE);
  }
  function joinBundle(texts) { return texts.map(function (x) { return String(x).replace(/\s+$/, ""); }).join("\n\n{new_song}\n\n") + "\n"; }
  // The set as a plain list: "1. Name · Artist · Key" a line.
  function toList(s, songs, opts) {
    opts = opts || {};
    var show = opts.show || function (k) { return k; };
    var head = [s.name || opts.untitled || ""];
    if (s.date) head.push(s.date);
    var out = [head.filter(Boolean).join(" · ")];
    if (s.nt) out.push(s.nt);
    out.push("");
    songsOf(s, songs).forEach(function (x, n) {
      var key = x.item.key || x.song.key;
      var bits = [x.song.name || opts.untitled || "", x.song.ar || "", key ? show(key) : ""].filter(Boolean);
      out.push((n + 1) + ". " + bits.join(" · ") + (x.item.nt ? " (" + x.item.nt.replace(/\n/g, " ") + ")" : ""));
    });
    return out.join("\n") + "\n";
  }

  var API = {
    VER: VER, MAX_SETS: MAX_SETS, MAX_ITEMS: MAX_ITEMS, MAX_BUNDLE: MAX_BUNDLE,
    empty: empty, normalize: normalize, merge: merge, serialize: serialize, find: find, live: live,
    put: put, remove: remove, newSet: newSet, isDate: isDate,
    addSong: addSong, removeAt: removeAt, move: move, setItem: setItem, songsOf: songsOf,
    steps: steps, keysLike: keysLike, splitBundle: splitBundle, joinBundle: joinBundle, toList: toList
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.LyricsyncSets = API;
})(typeof window !== "undefined" ? window : globalThis);
