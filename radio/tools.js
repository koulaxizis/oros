// ============================================================
// orOS Radio — tools.js (wave 42, v1.0.0)
// Loaded twice, like Podcasts' host files: by the Radio app frame
// (radio/index.html, before radio.js: the pure helpers below) and
// injected by radio.js into the SHELL window, where engine() starts
// the parts that must outlive the app window:
//   - "what was playing": the song title of the station, read from the
//     stream's own ICY metadata (a short fetch with Icy-MetaData: 1,
//     only when the stream allows CORS), else from an Icecast server's
//     /status-json.xsl; kept device-local in "oros-radio-history".
//     radio-browser.info has no now-playing data, so a station that
//     allows neither shows no titles;
//   - recording: a copy of the stream (fetch, CORS needed), saved
//     to the orOS disk under /internal/Radio/ (orosFS);
//   - the gentle fade-in of a wake-up alarm (shell alarm engine calls
//     window.__orosRadioEngine.wake(station) when an alarm Radio
//     linked to a station rings).
// window.OrosRadioTools (module.exports in Node).
// Sections: 1. Pure helpers  2. Wake rows (synced)  3. Engine (shell)
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Pure helpers ----------
  var LIM = { hist: 300, title: 200, recBytes: 200 * 1024 * 1024, recMs: 4 * 3600000, icyBytes: 65536 };
  function clean(s, max) {
    if (typeof s !== "string") return "";
    s = s.replace(/[\u0000-\u001f\u007f\u200b\u2028\u2029\ufeff]/g, " ").replace(/\s+/g, " ").trim();
    return max && s.length > max ? s.slice(0, max).trim() : s;
  }
  // Sleep timer fade: full volume until the last fadeMs, then down to
  // 0 at until (a squared curve sounds even to the ear).
  function fadeVolume(base, now, until, fadeMs) {
    base = +base >= 0 && +base <= 1 ? +base : 1;
    var left = until - now;
    if (!(fadeMs > 0) || left >= fadeMs) return base;
    if (left <= 0) return 0;
    var k = left / fadeMs;
    return Math.round(base * k * k * 1000) / 1000;
  }
  // Wake-up fade-in: from 5% of the target to the target over durMs.
  function fadeIn(target, start, now, durMs) {
    target = +target > 0 && +target <= 1 ? +target : 1;
    if (!(durMs > 0) || now - start >= durMs) return target;
    var k = Math.max(0, (now - start) / durMs);
    return Math.round(target * (0.05 + 0.95 * k) * 1000) / 1000;
  }
  // How long the sleep fade lasts: a minute, a quarter of short timers.
  function fadeLength(totalMs) { return Math.max(5000, Math.min(60000, Math.round((+totalMs || 0) / 4))); }

  // Bytes → text: UTF-8 when it is valid, else Latin-1 (old Shoutcast).
  function decode(bytes) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch (e) {
      var s = "";
      for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return s;
    }
  }
  var MARK = [83, 116, 114, 101, 97, 109, 84, 105, 116, 108, 101, 61, 39];   // "StreamTitle='"
  // The first StreamTitle='…'; in a chunk of an ICY stream (the metadata
  // block sits every icy-metaint bytes; scanning finds it without the
  // header, which CORS often hides). null = no metadata block seen.
  function scanIcy(bytes) {
    if (!bytes || !bytes.length) return null;
    var n = bytes.length, m = MARK.length;
    outer: for (var i = 0; i + m <= n; i++) {
      for (var j = 0; j < m; j++) if (bytes[i + j] !== MARK[j]) continue outer;
      var start = i + m, end = -1;
      for (var k = start; k + 1 < n && k < start + 1024; k++) {
        if (bytes[k] === 39 && bytes[k + 1] === 59) { end = k; break; }     // ';
        if (bytes[k] === 0) break;
      }
      if (end < 0) {
        // The block pads with zeros; a title without the closing '; ends there.
        var z = start;
        while (z < n && z < start + 1024 && bytes[z] !== 0) z++;
        end = z;
        while (end > start && (bytes[end - 1] === 59 || bytes[end - 1] === 39)) end--;
      }
      return cleanTitle(decode(bytes.subarray ? bytes.subarray(start, end) : bytes.slice(start, end)));
    }
    return null;
  }
  // A title worth keeping: not empty, not a dash, not the station's own
  // name over and over, not a stream address.
  function cleanTitle(s, stationName) {
    s = clean(s, LIM.title);
    if (!s || /^[-–—\s.|_]+$/.test(s) || /^(https?:|www\.)/i.test(s)) return "";
    if (/^(unknown|untitled|n\/a|null|undefined)$/i.test(s)) return "";
    if (stationName && s.toLowerCase() === clean(stationName, 200).toLowerCase()) return "";
    return s;
  }
  // "Artist - Title" → { artist, title } (the usual ICY shape).
  function splitTitle(s) {
    s = clean(s, LIM.title);
    var m = s.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    return m ? { artist: m[1], title: m[2] } : { artist: "", title: s };
  }
  // Icecast: the server's JSON status page, and the mount of a stream.
  function icecastStatusUrl(stream) {
    try { var x = new URL(stream); return /^https?:$/.test(x.protocol) ? x.origin + "/status-json.xsl" : ""; }
    catch (e) { return ""; }
  }
  function mountOf(u) {
    try { return new URL(u).pathname.replace(/\/+$/, "") || "/"; } catch (e) { return ""; }
  }
  function parseIcecast(json, stream) {
    var src = json && json.icestats && json.icestats.source;
    if (!src) return "";
    var list = Array.isArray(src) ? src : [src], mount = mountOf(stream), hit = null;
    list.forEach(function (s) {
      if (!hit && s && typeof s === "object" && mountOf(String(s.listenurl || "")) === mount) hit = s;
    });
    if (!hit && list.length === 1) hit = list[0];
    if (!hit || typeof hit !== "object") return "";
    var title = typeof hit.title === "string" ? hit.title : "";
    if (typeof hit.artist === "string" && hit.artist && title && title.indexOf(hit.artist) < 0) title = hit.artist + " - " + title;
    return cleanTitle(title);
  }
  // Song history (device-local): newest first, no repeat of the same
  // song on the same station back to back, capped.
  //   entry = { t: ms, u: stationuuid, n: station name, s: song }
  function historyAdd(list, e) {
    list = Array.isArray(list) ? list.filter(function (x) { return x && typeof x.s === "string" && +x.t > 0; }) : [];
    if (!e || !clean(e.s) || !(+e.t > 0)) return list;
    var row = { t: Math.floor(+e.t), u: clean(e.u, 80), n: clean(e.n, 120), s: clean(e.s, LIM.title) };
    var lastHere = null;
    for (var i = 0; i < list.length; i++) if (list[i].u === row.u) { lastHere = list[i]; break; }
    if (lastHere && lastHere.s === row.s) return list;
    return [row].concat(list).slice(0, LIM.hist);
  }
  // Recording file: "/internal/Radio/2026-10-14 08.30 Station.mp3".
  function recExt(type, url, codec) {
    var t = String(type || "").toLowerCase(), c = String(codec || "").toLowerCase();
    if (/mpegurl|x-scpls|audio\/x-mpegurl/.test(t) || /\.m3u8?(\?|$)/i.test(url || "")) return "";
    if (/mpeg|mp3/.test(t)) return "mp3";
    if (/aacp|aac|mp4a|x-aac/.test(t)) return "aac";
    if (/ogg|opus|vorbis/.test(t)) return /opus/.test(t) || c === "opus" ? "opus" : "ogg";
    if (/flac/.test(t)) return "flac";
    if (/wav|wave/.test(t)) return "wav";
    if (/mp4|m4a/.test(t)) return "m4a";
    if (/webm/.test(t)) return "webm";
    if (/^mp3$/.test(c)) return "mp3";
    if (/aac/.test(c)) return "aac";
    if (/ogg|vorbis/.test(c)) return "ogg";
    if (c === "opus") return "opus";
    if (c === "flac") return "flac";
    return /^(audio\/|application\/octet-stream|$)/.test(t) ? "mp3" : "";
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function recPath(name, ms, ext) {
    var d = new Date(ms);
    var safe = clean(name, 80).replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, " ").replace(/\s+/g, " ").replace(/^[.\s]+|[.\s]+$/g, "") || "Radio";
    return "/internal/Radio/" + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
      pad(d.getHours()) + "." + pad(d.getMinutes()) + " " + safe + "." + (ext || "mp3");
  }
  // Next time a clock time comes (today if still ahead, else tomorrow).
  function nextAt(hh, mm, now) {
    hh = +hh; mm = +mm;
    if (!(hh >= 0 && hh < 24 && mm >= 0 && mm < 60)) return 0;
    var d = new Date(now);
    d.setHours(Math.floor(hh), Math.floor(mm), 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  function fmtBytes(b) {
    b = +b || 0;
    return b < 1048576 ? Math.max(1, Math.round(b / 1024)) + " KB" : (Math.round(b / 104857.6) / 10) + " MB";
  }
  function fmtClock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    return (h ? h + ":" + pad(m) : m) + ":" + pad(s % 60);
  }

  // ---------- 2. Wake rows (synced in the radio slice) ----------
  // wake: { alarmId: { m: ms, st: station | null } } — st null is a
  // removal (tombstone). LWW per alarm id by m; equal m → larger JSON.
  // Rows removed more than 90 days before the newest row are dropped
  // (deterministic: both devices see the same newest m).
  var WAKE_MAX = 50, WAKE_TOMB = 90 * 86400000;
  function normWakeStation(s) {
    if (!s || typeof s !== "object" || typeof s.stationuuid !== "string" || !s.stationuuid) return null;
    var url = typeof s.url_resolved === "string" && /^https?:\/\//i.test(s.url_resolved) ? s.url_resolved.slice(0, 2000) : "";
    if (!url) return null;
    return { stationuuid: s.stationuuid.slice(0, 80), name: clean(s.name, 120), url_resolved: url,
      favicon: typeof s.favicon === "string" && /^https:\/\//i.test(s.favicon) ? s.favicon.slice(0, 2000) : "",
      codec: clean(s.codec, 20), bitrate: +s.bitrate > 0 && +s.bitrate < 10000 ? Math.floor(+s.bitrate) : 0,
      country: clean(s.country, 80), countrycode: clean(s.countrycode, 4) };
  }
  function normWake(w) {
    var out = {};
    if (!w || typeof w !== "object" || Array.isArray(w)) return out;
    Object.keys(w).forEach(function (id) {
      var r = w[id];
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(id) || !r || typeof r !== "object") return;
      var m = +r.m;
      if (!(isFinite(m) && m > 0)) return;
      out[id] = { m: Math.floor(m), st: r.st === null ? null : normWakeStation(r.st) };
      if (r.st !== null && !out[id].st) delete out[id];
    });
    var newest = 0;
    Object.keys(out).forEach(function (id) { if (out[id].m > newest) newest = out[id].m; });
    var ids = Object.keys(out).filter(function (id) { return out[id].st || out[id].m >= newest - WAKE_TOMB; });
    ids.sort(function (a, b) { return (out[b].m - out[a].m) || (a < b ? -1 : a > b ? 1 : 0); });
    var keep = {};
    ids.slice(0, WAKE_MAX).sort().forEach(function (id) { keep[id] = out[id]; });
    return keep;
  }
  function mergeWake(a, b) {
    var A = normWake(a), B = normWake(b), out = {};
    Object.keys(A).concat(Object.keys(B)).forEach(function (id) {
      var x = A[id], y = B[id];
      if (!x || !y) { out[id] = x || y; return; }
      if (x.m !== y.m) { out[id] = x.m > y.m ? x : y; return; }
      out[id] = JSON.stringify(x) >= JSON.stringify(y) ? x : y;
    });
    return normWake(out);
  }

  // ---------- 3. Engine (shell window) ----------
  function engine(w) {
    if (w.__orosRadioEngine && w.__orosRadioEngine.v >= 1) return w.__orosRadioEngine;
    var HIST_KEY = "oros-radio-history";
    var subs = [];
    var E = { v: 1, now: null, rec: null, method: {}, timer: null, busy: false, uuid: "", wakeT: null };
    function notify() {
      for (var i = subs.length - 1; i >= 0; i--) { try { subs[i](E); } catch (e) { subs.splice(i, 1); } }
    }
    function host() {
      var h = w.__orosRadioHost;
      return h && h.audio && h.api ? h : null;
    }
    function readHist() { try { return JSON.parse(w.localStorage.getItem(HIST_KEY) || "[]"); } catch (e) { return []; } }
    function writeHist(l) { try { w.localStorage.setItem(HIST_KEY, JSON.stringify(l)); } catch (e) {} }
    function st() { var h = host(); return h ? h.api.getState() : null; }

    // --- now playing ---
    // ICY: read up to 64 KB of the stream with Icy-MetaData: 1, then stop.
    function icy(url) {
      var ctl = new w.AbortController(), seen = 0, chunks = [];
      var timer = w.setTimeout(function () { ctl.abort(); }, 15000);
      return w.fetch(url, { mode: "cors", credentials: "omit", cache: "no-store", headers: { "Icy-MetaData": "1" }, signal: ctl.signal })
        .then(function (r) {
          if (!r.ok || !r.body || !r.body.getReader) throw new Error("no");
          var rd = r.body.getReader();
          return (function pump() {
            return rd.read().then(function (x) {
              if (x.done) return null;
              chunks.push(x.value); seen += x.value.length;
              var all = new Uint8Array(seen), o = 0;
              chunks.forEach(function (c) { all.set(c, o); o += c.length; });
              var title = scanIcy(all);
              if (title !== null || seen >= LIM.icyBytes) return title;
              return pump();
            });
          })().then(function (title) { try { ctl.abort(); } catch (e) {} return title; });
        })
        .then(function (t) { w.clearTimeout(timer); return t; }, function (e) { w.clearTimeout(timer); throw e; });
    }
    function icecast(url) {
      var su = icecastStatusUrl(url);
      if (!su) return Promise.reject(new Error("no"));
      var ctl = new w.AbortController(), timer = w.setTimeout(function () { ctl.abort(); }, 10000);
      return w.fetch(su, { mode: "cors", credentials: "omit", cache: "no-store", signal: ctl.signal }).then(function (r) {
        if (!r.ok) throw new Error("no");
        return r.json();
      }).then(function (j) {
        w.clearTimeout(timer);
        if (!j || !j.icestats) throw new Error("no");
        return parseIcecast(j, url);
      }, function (e) { w.clearTimeout(timer); throw e; });
    }
    // method per station (this session): "icy" | "icecast" | "none"
    function poll() {
      var s = st();
      if (!s || !s.current || !s.playing || E.busy) return;
      var cur = s.current, uuid = cur.stationuuid, url = cur.url_resolved, m = E.method[uuid];
      if (m === "none") return;
      E.busy = true;
      // ICY first (null = the stream carries no metadata), then Icecast's
      // status page; a station that answers neither is left alone.
      var p = m === "icecast" ? icecast(url) : icy(url).then(function (t) {
        if (t === null) throw new Error("noicy");
        E.method[uuid] = "icy";
        return t;
      }).catch(function (e) {
        if (m === "icy") throw e;                 // worked before: a passing failure
        return icecast(url).then(function (t) { E.method[uuid] = "icecast"; return t; });
      });
      p.then(function (title) {
        E.busy = false;
        var s2 = st();
        if (!s2 || !s2.current || s2.current.stationuuid !== uuid) return;
        title = cleanTitle(title || "", cur.name);
        if (!title) { if (E.now && E.now.u === uuid) { E.now = null; notify(); } return; }
        if (!E.now || E.now.u !== uuid || E.now.s !== title) {
          E.now = { u: uuid, s: title, t: Date.now(), via: E.method[uuid] };
          writeHist(historyAdd(readHist(), { t: Date.now(), u: uuid, n: cur.name, s: title }));
          notify();
        }
      }, function () {
        E.busy = false;
        if (!m) { E.method[uuid] = "none"; notify(); }
      });
    }
    function startPolling() {
      if (E.timer) return;
      E.timer = w.setInterval(function () {
        var s = st();
        if (!s || !s.playing) { stopPolling(); return; }
        poll();
      }, 30000);
      poll();
    }
    function stopPolling() { if (E.timer) { w.clearInterval(E.timer); E.timer = null; } }

    // --- recording ---
    function fsApi() { return w.orosFS && typeof w.orosFS.write === "function" ? w.orosFS : null; }
    function recStart(station, cb) {
      if (E.rec) return Promise.resolve({ ok: false, code: "busy" });
      if (!fsApi()) return Promise.resolve({ ok: false, code: "nofs" });
      if (!station || !station.url_resolved) return Promise.resolve({ ok: false, code: "nostation" });
      var ctl = new w.AbortController();
      var rec = { st: station, at: Date.now(), bytes: 0, chunks: [], ctl: ctl, ext: "", type: "", path: "", saved: 0, flushT: null, cb: cb || null };
      return w.fetch(station.url_resolved, { mode: "cors", credentials: "omit", cache: "no-store", signal: ctl.signal }).then(function (r) {
        if (!r.ok || !r.body || !r.body.getReader) { try { ctl.abort(); } catch (e) {} return { ok: false, code: "http" }; }
        rec.type = (r.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
        rec.ext = recExt(rec.type, station.url_resolved, station.codec);
        if (!rec.ext) { try { ctl.abort(); } catch (e) {} return { ok: false, code: "format" }; }
        rec.path = recPath(station.name, rec.at, rec.ext);
        E.rec = rec;
        var rd = r.body.getReader();
        (function pump() {
          rd.read().then(function (x) {
            if (E.rec !== rec) return;
            if (x.done) { recStop("ended"); return; }
            rec.chunks.push(x.value); rec.bytes += x.value.length;
            if (rec.bytes >= LIM.recBytes || Date.now() - rec.at >= LIM.recMs) { recStop("limit"); return; }
            pump();
          }, function () { if (E.rec === rec) recStop("net"); });
        })();
        // Written to the disk every 5 minutes too, so a closed tab
        // keeps what was recorded until then.
        rec.flushT = w.setInterval(function () { if (E.rec === rec) save(rec); }, 300000);
        notify();
        return { ok: true, path: rec.path };
      }, function () { return { ok: false, code: "cors" }; });
    }
    function save(rec) {
      var fs = fsApi();
      if (!fs || !rec.bytes) return Promise.resolve(false);
      var blob = new w.Blob(rec.chunks, { type: rec.type || "audio/mpeg" });
      return fs.write(rec.path, blob).then(function () { rec.saved = rec.bytes; return true; }, function () { return false; });
    }
    function recStop(why) {
      var rec = E.rec;
      if (!rec) return Promise.resolve(null);
      E.rec = null;
      if (rec.flushT) w.clearInterval(rec.flushT);
      try { rec.ctl.abort(); } catch (e) {}
      notify();
      return save(rec).then(function (ok) {
        var out = { ok: ok, path: rec.path, bytes: rec.bytes, ms: Date.now() - rec.at, why: why || "user" };
        if (rec.cb) { try { rec.cb(out); } catch (e) {} }
        E.last = out;
        notify();
        return out;
      });
    }

    // --- wake-up (called by the shell's alarm engine) ---
    function wake(station) {
      var h = host();
      if (!h || !station || !station.url_resolved) return false;
      var a = h.audio, target = a.volume > 0.05 ? a.volume : 1, t0 = Date.now();
      a.volume = fadeIn(target, t0, t0, 30000);
      h.api.play(station);
      if (E.wakeT) w.clearInterval(E.wakeT);
      E.wakeT = w.setInterval(function () {
        var v = fadeIn(target, t0, Date.now(), 30000);
        try { a.volume = v; } catch (e) {}
        if (v >= target) { w.clearInterval(E.wakeT); E.wakeT = null; }
      }, 500);
      return true;
    }

    // Follow the host: titles while playing; a recording ends with its station.
    var hooked = null;
    function hook() {
      var h = host();
      if (!h || hooked === h) return;
      hooked = h;
      h.api.subscribe(function () {
        var s = h.api.getState();
        var uuid = s.current ? s.current.stationuuid : "";
        if (uuid !== E.uuid) { E.uuid = uuid; E.now = null; notify(); }
        if (E.rec && E.rec.st.stationuuid !== uuid) recStop("station");
        if (s.playing) startPolling(); else stopPolling();
      });
    }
    E.api = {
      hook: hook,
      now: function () { var s = st(); return E.now && s && s.current && s.current.stationuuid === E.now.u ? E.now : null; },
      method: function (uuid) { return E.method[uuid] || ""; },
      history: readHist,
      clearHistory: function () { writeHist([]); notify(); },
      recStart: recStart,
      recStop: recStop,
      recState: function () { var r = E.rec; return r ? { at: r.at, bytes: r.bytes, path: r.path, uuid: r.st.stationuuid } : null; },
      lastRec: function () { return E.last || null; },
      wake: wake,
      pollNow: poll,
      subscribe: function (fn) { subs.push(fn); return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; }
    };
    E.wake = wake;
    w.__orosRadioEngine = E;
    hook();
    return E;
  }

  var api = {
    LIM: LIM, clean: clean, fadeVolume: fadeVolume, fadeIn: fadeIn, fadeLength: fadeLength,
    scanIcy: scanIcy, cleanTitle: cleanTitle, splitTitle: splitTitle, icecastStatusUrl: icecastStatusUrl, mountOf: mountOf,
    parseIcecast: parseIcecast, historyAdd: historyAdd, recExt: recExt, recPath: recPath, nextAt: nextAt,
    fmtBytes: fmtBytes, fmtClock: fmtClock,
    normWakeStation: normWakeStation, normWake: normWake, mergeWake: mergeWake,
    engine: engine
  };
  root.OrosRadioTools = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
