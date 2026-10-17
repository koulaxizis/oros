// ============================================================
// orOS Music — mixes.js (pure logic for wave 5b, v1.0.0)
// Everything here works on data the app hands it; no DOM, no
// storage, no fetch. Node tests load it with core.js
// (tests/music-mixes.test.js).
//   1. Seeded randomness (a mix stays the same all day)
//   2. Smart mixes from the listening history on this device:
//      Daily mix, On repeat, Repeat rewind, Song radio
//   3. "My year in music" (recap) from the yearly stats
//   4. Spotify import: the user's own data export (Playlist*.json,
//      YourLibrary.json) or a CSV (Exportify, TuneMyMusic…), and
//      matching its songs to songs Music can play
//   5. MusicBrainz release search → the best match (covers from the
//      Cover Art Archive)
// ============================================================
(function (root) {
  "use strict";
  var C = root.OrosMusicCore || (typeof require === "function" ? require("./core.js").OrosMusicCore : null);
  var DAY = 86400000;

  // ---------- 1. Seeded randomness ----------
  function rng(seed) {
    var x = (C.hash(String(seed)).split("").reduce(function (a, ch) { return (a * 36 + parseInt(ch, 36)) % 2147483647; }, 7)) || 1;
    return function () { x = (x * 48271) % 2147483647; return (x - 1) / 2147483646; };
  }
  function shuffle(list, rnd) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function dayOf(now) { var d = new Date(now); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }

  // ---------- 2. Smart mixes ----------
  // pool: every song Music can play here ({ k, t, a, al?, g?, … }),
  // hist: the host's history { c: {k: plays}, l: {k: last ms}, r },
  // liked: { k: 1 }. → [item] (at most `max`).
  function byKey(pool) { var m = {}; (pool || []).forEach(function (x) { if (x && x.k && !m[x.k]) m[x.k] = x; }); return m; }
  function hc(hist) { return (hist && hist.c) || {}; }
  function hl(hist) { return (hist && hist.l) || {}; }
  function take(out, seen, list, n, max) {
    for (var i = 0; i < list.length && n > 0 && out.length < max; i++) {
      var x = list[i];
      if (!x || seen[x.k]) continue;
      seen[x.k] = 1; out.push(x); n--;
    }
  }
  function onRepeat(pool, hist, now, max) {
    max = max || 30;
    var P = byKey(pool), c = hc(hist), l = hl(hist);
    return Object.keys(c).filter(function (k) { return P[k] && c[k] >= 2 && now - (l[k] || 0) < 30 * DAY; })
      .sort(function (a, b) { return c[b] - c[a] || (l[b] || 0) - (l[a] || 0); }).slice(0, max).map(function (k) { return P[k]; });
  }
  function rewind(pool, hist, now, max) {
    max = max || 30;
    var P = byKey(pool), c = hc(hist), l = hl(hist);
    return Object.keys(c).filter(function (k) { return P[k] && c[k] >= 3 && now - (l[k] || 0) > 60 * DAY; })
      .sort(function (a, b) { return c[b] - c[a]; }).slice(0, max).map(function (k) { return P[k]; });
  }
  // Favourite artists: folded names by plays.
  function topArtists(pool, hist, n) {
    var P = byKey(pool), c = hc(hist), by = {};
    Object.keys(c).forEach(function (k) { var x = P[k]; if (x && x.a) { var f = C.fold(x.a); by[f] = (by[f] || 0) + c[k]; } });
    return Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }).slice(0, n);
  }
  // Daily mix: favourites from the last month, liked songs not played
  // for two weeks, more by the favourite artists, then anything; the
  // same order all day.
  function daily(pool, hist, liked, now, max) {
    max = max || 40;
    var rnd = rng("daily|" + dayOf(now)), out = [], seen = {}, l = hl(hist);
    var all = shuffle((pool || []).filter(Boolean), rnd);
    take(out, seen, shuffle(onRepeat(pool, hist, now, 40), rnd), Math.round(max * 0.3), max);
    take(out, seen, all.filter(function (x) { return liked && liked[x.k] && now - (l[x.k] || 0) > 14 * DAY; }), Math.round(max * 0.3), max);
    var fav = {};
    topArtists(pool, hist, 8).forEach(function (f) { fav[f] = 1; });
    take(out, seen, all.filter(function (x) { return fav[C.fold(x.a)]; }), Math.round(max * 0.3), max);
    take(out, seen, all, max, max);
    return shuffle(out, rnd);
  }
  // Song radio: the song, then more by its artist, songs of its genre,
  // and songs by artists that share playlists with it; mixed, liked
  // and often played songs a little earlier.
  function radio(seed, pool, pls, hist, liked, now, max) {
    max = max || 50;
    if (!seed || !seed.k) return [];
    var rnd = rng("radio|" + seed.k + "|" + dayOf(now)), c = hc(hist);
    var fa = C.fold(seed.a), fg = C.fold(seed.g || ""), near = {};
    (pls || []).forEach(function (p) {
      var it = (p && p.it) || [];
      if (!it.some(function (x) { return x && C.fold(x.a) === fa; })) return;
      it.forEach(function (x) { var f = x && C.fold(x.a); if (f && f !== fa) near[f] = (near[f] || 0) + 1; });
    });
    var weight = function (x) { return 1 + (liked && liked[x.k] ? 1 : 0) + Math.min(2, (c[x.k] || 0) / 5) + rnd(); };
    var sorted = function (l) { return l.map(function (x) { return [weight(x), x]; }).sort(function (a, b) { return b[0] - a[0]; }).map(function (p) { return p[1]; }); };
    var others = (pool || []).filter(function (x) { return x && x.k !== seed.k; });
    var same = sorted(others.filter(function (x) { return fa && C.fold(x.a) === fa; }));
    var genre = sorted(others.filter(function (x) { return fg && C.fold(x.g || "") === fg && C.fold(x.a) !== fa; }));
    var nearL = sorted(others.filter(function (x) { return near[C.fold(x.a)]; }));
    var out = [seed], seen = {};
    seen[seed.k] = 1;
    // Interleave: artist, near artist, genre, … so no artist runs long.
    var lists = [same, nearL, genre], idx = [0, 0, 0];
    for (var guard = 0; out.length < max && guard < max * 4; guard++) {
      var li = guard % 3, L = lists[li];
      while (idx[li] < L.length && seen[L[idx[li]].k]) idx[li]++;
      if (idx[li] < L.length) { var x = L[idx[li]++]; seen[x.k] = 1; out.push(x); }
      if (idx.every(function (v, i) { return v >= lists[i].length; })) break;
    }
    return out;
  }

  // ---------- 3. My year in music ----------
  // stats: core.normStats(). → null when the year has no plays.
  function recap(stats, year) {
    var Y = stats && stats.y && stats.y[String(year)];
    if (!Y || !Y.n) return null;
    var songs = Object.keys(Y.k).sort(function (a, b) { return Y.k[b] - Y.k[a]; }).slice(0, 10).map(function (k) { return { ref: Y.i[k], n: Y.k[k] }; });
    var artists = Object.keys(Y.a).sort(function (a, b) { return Y.a[b][1] - Y.a[a][1]; }).slice(0, 5).map(function (f) { return { name: Y.a[f][0], n: Y.a[f][1] }; });
    var top = 0;
    Y.m.forEach(function (v, i) { if (v > Y.m[top]) top = i; });
    return { year: +year, plays: Y.n, minutes: Math.round(Y.s / 60), songs: songs, artists: artists, months: Y.m.slice(), topMonth: Y.m[top] ? top : -1,
      distinct: Object.keys(Y.k).length };
  }
  function years(stats) { return Object.keys((stats && stats.y) || {}).filter(function (y) { return stats.y[y].n > 0; }).sort().reverse(); }

  // ---------- 4. Spotify import ----------
  // A CSV line → fields (quotes, doubled quotes, commas or semicolons).
  function csvRows(text, sep) {
    text = String(text || "").replace(/^﻿/, "");
    if (!sep) { var first = text.split("\n")[0]; sep = (first.split(";").length > first.split(",").length) ? ";" : ","; }
    var rows = [], row = [], f = "", q = false;
    for (var i = 0; i < text.length && rows.length < 20001; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { row.push(f); f = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(f); f = "";
        if (row.length > 1 || row[0]) rows.push(row);
        row = [];
      } else f += ch;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  var COLS = {
    t: ["track name", "track", "name", "title", "song", "song name", "trackname"],
    a: ["artist name(s)", "artist name", "artist names", "artists", "artist", "artistname"],
    al: ["album name", "album", "albumname"],
    d: ["duration (ms)", "duration_ms", "duration", "track duration (ms)"]
  };
  function firstArtist(s) { return C.clean(String(s || "").split(/\s*[;|]\s*|,\s+/)[0]); }
  function entry(t, a, al, ms) {
    t = C.clean(t); a = firstArtist(a);
    if (!t) return null;
    var o = { t: t, a: a };
    if (C.clean(al)) o.al = C.clean(al);
    if (+ms > 1000) o.d = Math.round(+ms / 1000);
    return o;
  }
  function parseCsv(text, name) {
    var rows = csvRows(text);
    if (rows.length < 2) return null;
    var head = rows[0].map(function (h) { return C.clean(h).toLowerCase(); }), col = {};
    Object.keys(COLS).forEach(function (k) { for (var i = 0; i < COLS[k].length; i++) { var j = head.indexOf(COLS[k][i]); if (j >= 0) { col[k] = j; return; } } });
    if (col.t == null) return null;
    var it = [];
    rows.slice(1).forEach(function (r) {
      var e = entry(r[col.t], col.a != null ? r[col.a] : "", col.al != null ? r[col.al] : "", col.d != null ? r[col.d] : 0);
      if (e && it.length < C.LIM.items) it.push(e);
    });
    return { lists: [{ n: C.clean(C.stem(name || "")) || "Spotify", it: it }], liked: [] };
  }
  // Spotify's own export: Playlist1.json ({ playlists: [{ name, items:
  // [{ track: { trackName, artistName, albumName } }] }] }) and
  // YourLibrary.json ({ tracks: [{ artist, album, track }] }). Episodes
  // and local files are skipped.
  function parseSpotifyJson(o) {
    var out = { lists: [], liked: [] };
    if (!o || typeof o !== "object") return null;
    var pls = Array.isArray(o.playlists) ? o.playlists : Array.isArray(o) && o.length && o[0] && o[0].items ? o : null;
    (pls || []).slice(0, C.LIM.pls).forEach(function (p) {
      if (!p || typeof p !== "object") return;
      var it = [];
      (Array.isArray(p.items) ? p.items : []).forEach(function (x) {
        var tr = x && x.track;
        if (!tr || typeof tr !== "object") return;
        var e = entry(tr.trackName, tr.artistName, tr.albumName, 0);
        if (e && it.length < C.LIM.items) it.push(e);
      });
      out.lists.push({ n: C.clean(p.name, C.LIM.plName) || "Spotify", it: it });
    });
    (Array.isArray(o.tracks) ? o.tracks : []).forEach(function (x) {
      if (!x || typeof x !== "object") return;
      var e = entry(x.track, x.artist, x.album, 0);
      if (e && out.liked.length < C.LIM.likes) out.liked.push(e);
    });
    return out.lists.length || out.liked.length ? out : null;
  }
  // → { lists: [{ n, it: [entry] }], liked: [entry] } or null.
  function parseExport(name, text) {
    var s = String(text || "").trim();
    if (/^[[{]/.test(s)) { try { return parseSpotifyJson(JSON.parse(s)); } catch (e) { return null; } }
    return parseCsv(s, name);
  }
  // Song titles differ in small ways between services: "Song -
  // Remastered 2011", "Song (feat. X)", "Song [Live]".
  function normTitle(t) {
    return C.fold(String(t || "").replace(/\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo|demo|bonus).*$/i, "")
      .replace(/\s*[([][^)\]]*(feat|ft\.|with|remaster|version|edit|live|mono|stereo|bonus)[^)\]]*[)\]]/gi, ""));
  }
  // An index over songs Music can play: entry → song or null.
  function matcher(pool) {
    var exact = {}, title = {};
    (pool || []).forEach(function (x) {
      if (!x || !x.t) return;
      var nt = normTitle(x.t), fa = C.fold(firstArtist(x.a));
      var k1 = nt + "|" + fa;
      if (!exact[k1]) exact[k1] = x;
      (title[nt] = title[nt] || []).push(x);
    });
    return function (e) {
      if (!e) return null;
      var nt = normTitle(e.t), fa = C.fold(e.a);
      if (exact[nt + "|" + fa]) return exact[nt + "|" + fa];
      var cands = title[nt] || [];
      for (var i = 0; i < cands.length; i++) {
        var ca = C.fold(cands[i].a);
        if (fa && ca && (ca.indexOf(fa) >= 0 || fa.indexOf(ca) >= 0)) return cands[i];
      }
      return null;
    };
  }

  // ---------- 5. MusicBrainz ----------
  function luceneQ(s) { return '"' + String(s).replace(/[\\"]/g, "\\$&") + '"'; }
  function mbUrl(album, artist) {
    album = C.clean(album); artist = C.clean(artist);
    if (!album) return "";
    return "https://musicbrainz.org/ws/2/release/?fmt=json&limit=10&query=" +
      encodeURIComponent("release:" + luceneQ(album) + (artist ? " AND artist:" + luceneQ(artist) : ""));
  }
  // The best release: same title (folded), same artist when known,
  // score ≥ 80, a front cover in the Cover Art Archive when it says so.
  // → { id, year } or null.
  function mbPick(json, album, artist) {
    var rel = json && Array.isArray(json.releases) ? json.releases : [];
    var fa = C.fold(artist), ft = C.fold(album), best = null, bs = -1;
    rel.forEach(function (r) {
      if (!r || typeof r !== "object" || typeof r.id !== "string" || !/^[0-9a-f-]{36}$/.test(r.id)) return;
      if (C.fold(r.title) !== ft || (+r.score || 0) < 80) return;
      var by = Array.isArray(r["artist-credit"]) ? r["artist-credit"].map(function (a) { return a && typeof a === "object" ? (a.name || "") : ""; }).join(" ") : "";
      if (fa && C.fold(by).indexOf(fa) < 0 && fa.indexOf(C.fold(by)) < 0) return;
      var ca = r["cover-art-archive"], sc = (+r.score || 0) + (ca && ca.front ? 50 : 0) + (r.status === "Official" ? 5 : 0);
      if (sc > bs) { best = r; bs = sc; }
    });
    if (!best) return null;
    var y = parseInt(String(best.date || "").slice(0, 4), 10);
    return { id: best.id, year: y > 1800 && y < 3000 ? y : 0 };
  }
  function caaUrl(id) { return /^[0-9a-f-]{36}$/.test(id) ? "https://coverartarchive.org/release/" + id + "/front-500" : ""; }

  var api = {
    VERSION: "1.0.0", rng: rng, shuffle: shuffle,
    onRepeat: onRepeat, rewind: rewind, daily: daily, radio: radio, topArtists: topArtists,
    recap: recap, years: years,
    csvRows: csvRows, parseExport: parseExport, normTitle: normTitle, matcher: matcher,
    mbUrl: mbUrl, mbPick: mbPick, caaUrl: caaUrl
  };
  root.OrosMusicMixes = api;
  if (typeof module !== "undefined" && module.exports) module.exports = { OrosMusicMixes: api };
})(typeof window !== "undefined" ? window : globalThis);
