// ============================================================
// orOS Television — pure logic (Wave 43): M3U playlists, XMLTV
// programme guides, now/next, the guide timeline and the synced
// list of playlist / guide addresses.
// No DOM, no network. window.orosTvCore in the app, module.exports
// in Node (tests/television.test.js).
//
//   parseM3U(text)             -> { channels[], groups[], epgUrls[], skipped, truncated }
//   parseXMLTV(text, opts)     -> { channels{id:{names[], icon}}, progs{id:[prog]}, count, truncated }
//                                 prog = { s, e, t, st, d, c } (ms, ms, title, sub-title, desc, category)
//   xmltvTime(str)             -> ms | NaN
//   buildIndex(guides[])       -> { byKey{}, byName{} }
//   lookup(index, ch)          -> prog[] (tvg-id, then id, then name)
//   nowNext(progs, now)        -> { now, next, pct }
//   dayRange(ts), ymd(ts)      -> local day bounds / "YYYY-MM-DD"
//   layoutRow(progs, from, to, pxPerMin) -> [{ p, left, width }]
//   normSources(obj), mergeSources(remote, local)   (sync slice)
// Everything that came from a playlist or a guide is plain text
// here; the app escapes it before it reaches HTML. Logos: https only.
// ============================================================
(function (root) {
  "use strict";

  var MAX_CHANNELS = 50000;      // one playlist
  var MAX_PROGS = 300000;        // one guide (after the window filter)
  var MAX_SOURCES = 100;         // synced addresses
  var MAX_URL = 2048;

  function str(v) { return typeof v === "string" ? v : (v == null ? "" : String(v)); }
  function clip(s, n) { s = str(s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

  // 64-bit-ish id from two 32-bit FNV-1a variants (stable across devices).
  function hash(s) {
    s = str(s);
    var h1 = 0x811c9dc5, h2 = 0x01000193 ^ s.length;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 ^= c; h1 = Math.imul(h1, 0x01000193);
      h2 ^= c; h2 = Math.imul(h2 ^ (h2 >>> 15), 0x2c1b3c6d);
    }
    return ("0000000" + (h1 >>> 0).toString(16)).slice(-8) + ("0000000" + (h2 >>> 0).toString(16)).slice(-8);
  }

  function httpUrl(u) {
    u = str(u).trim();
    return (u.length <= MAX_URL && /^https?:\/\/[^\s"'<>]+$/i.test(u)) ? u : "";
  }
  function safeLogo(u) {
    u = str(u).trim();
    return (u.length <= MAX_URL && /^https:\/\/[^\s"'<>]+$/i.test(u)) ? u : "";
  }

  // ---------- M3U ----------

  // key="value" / key='value' / key=value pairs of an #EXTINF or #EXTM3U line.
  function parseAttrs(s) {
    var out = {}, re = /([A-Za-z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"',]+))/g, m;
    while ((m = re.exec(s))) {
      var k = m[1].toLowerCase();
      if (!(k in out)) out[k] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]);
    }
    return out;
  }

  // "#EXTINF:-1 tvg-id="a,b" group-title="x",Name" -> attrs + name
  // (the name starts after the first comma outside quotes).
  function splitExtinf(line) {
    var body = line.slice(line.indexOf(":") + 1), q = "", i;
    for (i = 0; i < body.length; i++) {
      var ch = body.charAt(i);
      if (q) { if (ch === q) q = ""; }
      else if (ch === '"' || ch === "'") q = ch;
      else if (ch === ",") break;
    }
    return { attrs: parseAttrs(body.slice(0, i)), name: body.slice(i + 1) };
  }

  function tailName(url) {
    var p = url.replace(/[?#].*$/, "").split("/").filter(Boolean);
    try { return decodeURIComponent(p[p.length - 1] || url); } catch (e) { return p[p.length - 1] || url; }
  }

  function parseM3U(text) {
    text = str(text).replace(/^\ufeff/, "");
    var lines = text.split(/\r\n|\n|\r/);
    var res = { channels: [], groups: [], epgUrls: [], skipped: 0, truncated: false };
    var seen = {}, gseen = {}, pend = null, grp = "";
    for (var n = 0; n < lines.length; n++) {
      var line = lines[n].trim();
      if (!line) continue;
      if (line.charAt(0) === "#") {
        var up = line.slice(0, 8).toUpperCase();
        if (up.slice(0, 7) === "#EXTM3U") {
          var ha = parseAttrs(line.slice(7));
          ["url-tvg", "x-tvg-url", "tvg-url"].forEach(function (k) {
            str(ha[k]).split(",").forEach(function (u) {
              u = httpUrl(u);
              if (u && res.epgUrls.indexOf(u) < 0 && res.epgUrls.length < 5) res.epgUrls.push(u);
            });
          });
        } else if (up === "#EXTINF:") {
          pend = splitExtinf(line); grp = "";
        } else if (line.slice(0, 8).toUpperCase() === "#EXTGRP:") {
          grp = line.slice(8).trim();
        }
        continue;
      }
      var url = httpUrl(line);
      if (!url) { res.skipped++; pend = null; grp = ""; continue; }
      if (res.channels.length >= MAX_CHANNELS) { res.truncated = true; break; }
      var a = pend ? pend.attrs : {};
      var id = "m3u:" + hash(url);
      if (seen[id]) { pend = null; grp = ""; continue; }
      seen[id] = 1;
      var group = clip(a["group-title"] || grp, 100);
      var name = clip((pend && pend.name) || a["tvg-name"] || tailName(url), 200) || url;
      res.channels.push({
        id: id, name: name, url: url,
        logo: safeLogo(a["tvg-logo"] || a["logo"]),
        group: group,
        tvgId: clip(a["tvg-id"], 200),
        tvgName: clip(a["tvg-name"], 200),
        chno: clip(a["tvg-chno"] || a["channel-number"], 10)
      });
      if (group && !gseen[group]) { gseen[group] = 1; res.groups.push(group); }
      pend = null; grp = "";
    }
    return res;
  }

  // ---------- XMLTV ----------

  var ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  function decodeText(s) {
    s = str(s);
    // CDATA keeps its text as is; everything else: tags out, entities in.
    var out = "", i = 0;
    while (i < s.length) {
      var c = s.indexOf("<![CDATA[", i);
      var part = c < 0 ? s.slice(i) : s.slice(i, c);
      out += part.replace(/<[^>]*>/g, "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
        if (e.charAt(0) === "#") {
          var cp = e.charAt(1).toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
          return (cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) ? String.fromCodePoint(cp) : "";
        }
        return ENT[e.toLowerCase()] !== undefined ? ENT[e.toLowerCase()] : m;
      });
      if (c < 0) break;
      var end = s.indexOf("]]>", c + 9);
      if (end < 0) { out += s.slice(c + 9); break; }
      out += s.slice(c + 9, end);
      i = end + 3;
    }
    return out;
  }

  function xmlAttrs(s) {
    var out = {}, re = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, m;
    while ((m = re.exec(s))) {
      var k = m[1].toLowerCase();
      if (!(k in out)) out[k] = decodeText(m[2] !== undefined ? m[2] : m[3]);
    }
    return out;
  }

  // Every <tag ...>text</tag> inside a block -> [{ lang, text }]
  function children(block, tag) {
    var out = [], re = new RegExp("<" + tag + "\\b([^>]*?)(/?)>", "gi"), m;
    while ((m = re.exec(block))) {
      var a = xmlAttrs(m[1]);
      if (m[2] === "/") { out.push({ a: a, text: "" }); continue; }
      var close = block.indexOf("</" + tag, re.lastIndex);
      if (close < 0) break;
      out.push({ a: a, text: decodeText(block.slice(re.lastIndex, close)) });
      re.lastIndex = close;
    }
    return out;
  }

  function pickLang(list, lang) {
    if (!list.length) return "";
    if (lang) {
      for (var i = 0; i < list.length; i++) {
        if (str(list[i].a.lang).toLowerCase().slice(0, 2) === lang) return list[i].text;
      }
    }
    return list[0].text;
  }

  // "20261014183000 +0300" -> ms. No zone: UTC (xmltv.dtd).
  function xmltvTime(s) {
    var m = /^\s*(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?\s*(Z|[+-]\d{2}:?\d{2})?/.exec(str(s));
    if (!m) return NaN;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    if (m[7] && m[7] !== "Z") {
      var z = m[7].replace(":", ""), sign = z.charAt(0) === "-" ? -1 : 1;
      t -= sign * (parseInt(z.slice(1, 3), 10) * 60 + parseInt(z.slice(3, 5), 10)) * 60000;
    }
    return t;
  }

  // opts: { from, to (ms window, a programme must overlap it), lang ("en"/"el") }
  function parseXMLTV(text, opts) {
    opts = opts || {};
    text = str(text);
    var from = typeof opts.from === "number" ? opts.from : -Infinity;
    var to = typeof opts.to === "number" ? opts.to : Infinity;
    var lang = str(opts.lang).slice(0, 2).toLowerCase();
    var res = { channels: {}, progs: {}, count: 0, truncated: false };
    if (!/<tv\b/i.test(text)) return res;
    var re = /<(channel|programme)\b([^>]*?)(\/?)>/gi, m;
    while ((m = re.exec(text))) {
      var tag = m[1].toLowerCase(), a = xmlAttrs(m[2]), body = "";
      if (m[3] !== "/") {
        var close = text.indexOf("</" + m[1], re.lastIndex);
        if (close < 0) break;
        body = text.slice(re.lastIndex, close);
        re.lastIndex = close;
      }
      if (tag === "channel") {
        var cid = clip(a.id, 200);
        if (!cid || res.channels[cid]) continue;
        var icon = children(body, "icon")[0];
        res.channels[cid] = {
          names: children(body, "display-name").map(function (x) { return clip(x.text, 200); }).filter(Boolean).slice(0, 6),
          icon: icon ? safeLogo(icon.a.src) : ""
        };
        continue;
      }
      var ch = clip(a.channel, 200), s = xmltvTime(a.start), e = xmltvTime(a.stop);
      if (!ch || isNaN(s)) continue;
      if (isNaN(e) || e <= s) e = s + 30 * 60000;   // no stop: until the next one (fixed below)
      if (e <= from || s >= to) continue;
      if (res.count >= MAX_PROGS) { res.truncated = true; break; }
      var p = { s: s, e: e, t: clip(pickLang(children(body, "title"), lang), 200) };
      if (!a.stop) p.open = 1;
      var st = clip(pickLang(children(body, "sub-title"), lang), 200);
      var d = clip(pickLang(children(body, "desc"), lang), 600);
      var c = clip(pickLang(children(body, "category"), lang), 60);
      if (st) p.st = st;
      if (d) p.d = d;
      if (c) p.c = c;
      (res.progs[ch] = res.progs[ch] || []).push(p);
      res.count++;
    }
    Object.keys(res.progs).forEach(function (k) { res.progs[k] = tidy(res.progs[k]); });
    return res;
  }

  // Sort, drop repeated starts, close open-ended programmes at the next start.
  function tidy(list) {
    list.sort(function (x, y) { return x.s - y.s || y.e - x.e; });
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (out.length && out[out.length - 1].s === p.s) continue;
      if (out.length && out[out.length - 1].open) {
        var prev = out[out.length - 1];
        prev.e = p.s; delete prev.open;
      }
      out.push(p);
    }
    out.forEach(function (p) { delete p.open; });
    return out;
  }

  // ---------- matching ----------

  function epgKey(id) { return str(id).trim().toLowerCase().replace(/@.*$/, ""); }

  function nameKey(name) {
    var s = str(name);
    try { s = s.normalize("NFD"); } catch (e) {}
    s = s.replace(/[\u0300-\u036f]/g, "").toLowerCase()
         .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
         .replace(/\b(hd|fhd|uhd|sd|4k|hevc|h265|1080[pi]?|720p|576[pi]?|480p)\b/g, " ");
    return s.replace(/[^\p{L}\p{N}]+/gu, "");
  }

  // guides: [{ channels, progs }] (several sources merge; earlier wins on equal starts)
  function buildIndex(guides) {
    var idx = { byKey: {}, byName: {} };
    (guides || []).forEach(function (g) {
      if (!g || !g.progs) return;
      Object.keys(g.progs).forEach(function (id) {
        var k = epgKey(id);
        if (!k) return;
        idx.byKey[k] = idx.byKey[k] ? tidy(idx.byKey[k].concat(g.progs[id].map(copyProg))) : g.progs[id].map(copyProg);
      });
      Object.keys(g.channels || {}).forEach(function (id) {
        var k = epgKey(id);
        (g.channels[id].names || []).forEach(function (n) {
          var nk = nameKey(n);
          if (nk && !(nk in idx.byName)) idx.byName[nk] = k;
        });
      });
    });
    return idx;
  }
  function copyProg(p) { var o = {}; for (var k in p) o[k] = p[k]; return o; }

  // ch: { tvgId, id, tvgName, name }
  function lookup(idx, ch) {
    if (!idx || !ch) return null;
    var keys = [epgKey(ch.tvgId), epgKey(ch.id)];
    for (var i = 0; i < keys.length; i++) if (keys[i] && idx.byKey[keys[i]]) return idx.byKey[keys[i]];
    var names = [ch.tvgName, ch.name];
    for (var j = 0; j < names.length; j++) {
      var nk = nameKey(names[j]);
      if (nk && idx.byName[nk] && idx.byKey[idx.byName[nk]]) return idx.byKey[idx.byName[nk]];
    }
    return null;
  }

  // ---------- now / next ----------

  function nowNext(progs, now) {
    var r = { now: null, next: null, pct: 0 };
    if (!progs || !progs.length) return r;
    var lo = 0, hi = progs.length;          // first programme with s > now
    while (lo < hi) { var mid = (lo + hi) >> 1; if (progs[mid].s <= now) lo = mid + 1; else hi = mid; }
    var cur = lo - 1;
    if (cur >= 0 && progs[cur].e > now) {
      r.now = progs[cur];
      r.pct = Math.max(0, Math.min(100, Math.round((now - r.now.s) * 100 / (r.now.e - r.now.s))));
    }
    if (lo < progs.length) r.next = progs[lo];
    return r;
  }

  function dayRange(ts) {
    var d = new Date(ts);
    var start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    return { start: start, end: end };
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(ts) { var d = new Date(ts); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function hhmm(ts) { var d = new Date(ts); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }

  // Programmes of one channel placed on a [from, to) timeline.
  function layoutRow(progs, from, to, pxPerMin) {
    var out = [];
    (progs || []).forEach(function (p) {
      if (p.e <= from || p.s >= to) return;
      var a = Math.max(p.s, from), b = Math.min(p.e, to);
      out.push({ p: p, left: Math.round((a - from) / 60000 * pxPerMin), width: Math.max(1, Math.round((b - a) / 60000 * pxPerMin)) });
    });
    return out;
  }

  // Keep only what a day view needs (cache per day).
  function windowGuide(g, from, to) {
    var out = { channels: g.channels || {}, progs: {}, count: 0 };
    Object.keys(g.progs || {}).forEach(function (k) {
      var l = g.progs[k].filter(function (p) { return p.e > from && p.s < to; });
      if (l.length) { out.progs[k] = l; out.count += l.length; }
    });
    // channels without programmes in the window are dropped too
    var ch = {};
    Object.keys(out.channels).forEach(function (k) { if (out.progs[k]) ch[k] = out.channels[k]; });
    out.channels = ch;
    return out;
  }

  // ---------- synced list of addresses (TELEVISION slice) ----------
  // sources: [{ id, kind: "m3u" | "xmltv", url, name, mtime }], srcDel: { id: ms }
  // Both keys are written only when non-empty, so old data stays byte-identical.

  function sourceId(kind, url) { return (kind === "xmltv" ? "x" : "m") + hash(str(url).trim()); }

  function normSource(s) {
    if (!s || typeof s !== "object") return null;
    var kind = s.kind === "xmltv" ? "xmltv" : (s.kind === "m3u" ? "m3u" : "");
    var url = httpUrl(s.url);
    if (!kind || !url || typeof s.mtime !== "number" || !isFinite(s.mtime)) return null;
    if (typeof s.id !== "string" || !/^[mx][0-9a-f]{16}$/.test(s.id)) return null;
    return { id: s.id, kind: kind, url: url, name: clip(s.name, 120), mtime: s.mtime };
  }

  function canonSources(list, del) {
    var map = {};
    (Array.isArray(list) ? list : []).forEach(function (s) {
      s = normSource(s);
      if (!s) return;
      var ex = map[s.id];
      if (!ex || s.mtime > ex.mtime || (s.mtime === ex.mtime && JSON.stringify(s) > JSON.stringify(ex))) map[s.id] = s;
    });
    var dl = {};
    Object.keys(del && typeof del === "object" ? del : {}).sort().forEach(function (k) {
      if (/^[mx][0-9a-f]{16}$/.test(k) && typeof del[k] === "number" && isFinite(del[k])) dl[k] = del[k];
    });
    var ids = Object.keys(map).sort().slice(0, MAX_SOURCES);
    return { sources: ids.map(function (k) { return map[k]; }), srcDel: dl };
  }

  // In place, on the slice object: canonical order, empty keys dropped.
  function normSources(obj) {
    if (!obj || typeof obj !== "object") return obj;
    var c = canonSources(obj.sources, obj.srcDel);
    delete obj.sources; delete obj.srcDel;
    if (c.sources.length) obj.sources = c.sources;
    if (Object.keys(c.srcDel).length) obj.srcDel = c.srcDel;
    return obj;
  }

  // Union by id, LWW by mtime (tie: larger JSON), tombs max-union,
  // a tomb wins ties, a newer edit resurrects.
  function mergeSources(remote, local) {
    remote = remote || {}; local = local || {};
    var del = {};
    [remote.srcDel, local.srcDel].forEach(function (d) {
      Object.keys(d && typeof d === "object" ? d : {}).forEach(function (k) {
        if (typeof d[k] === "number") del[k] = Math.max(del[k] || 0, d[k]);
      });
    });
    var all = canonSources([].concat(Array.isArray(remote.sources) ? remote.sources : [],
                                     Array.isArray(local.sources) ? local.sources : []), del);
    var out = {};
    out.sources = all.sources.filter(function (s) { return s.mtime > (all.srcDel[s.id] || 0); });
    out.srcDel = all.srcDel;
    return normSources(out);
  }

  function liveSources(obj) {
    var del = (obj && obj.srcDel) || {};
    return ((obj && obj.sources) || []).filter(function (s) { return s && s.mtime > (del[s.id] || 0); });
  }

  // A short readable name for an address: host + last path part.
  function nameFromUrl(u) {
    var m = /^https?:\/\/([^\/?#]+)([^?#]*)/i.exec(str(u));
    if (!m) return clip(u, 120);
    var last = m[2].split("/").filter(Boolean).pop() || "";
    try { last = decodeURIComponent(last); } catch (e) {}
    return clip(m[1].replace(/^www\./i, "") + (last ? " · " + last : ""), 120);
  }

  // gzip (XMLTV .xml.gz) -> bytes; anything else unchanged.
  function gunzipIfNeeded(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes || []);
    if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return Promise.resolve(bytes);
    if (typeof DecompressionStream !== "function") return Promise.reject(new Error("gzip"));
    var ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(ds).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  var api = {
    MAX_CHANNELS: MAX_CHANNELS, MAX_PROGS: MAX_PROGS, MAX_SOURCES: MAX_SOURCES,
    hash: hash, httpUrl: httpUrl, safeLogo: safeLogo,
    parseM3U: parseM3U, parseXMLTV: parseXMLTV, xmltvTime: xmltvTime, decodeText: decodeText,
    epgKey: epgKey, nameKey: nameKey, buildIndex: buildIndex, lookup: lookup,
    nowNext: nowNext, dayRange: dayRange, ymd: ymd, hhmm: hhmm, layoutRow: layoutRow, windowGuide: windowGuide,
    sourceId: sourceId, normSources: normSources, mergeSources: mergeSources, liveSources: liveSources,
    nameFromUrl: nameFromUrl, gunzipIfNeeded: gunzipIfNeeded
  };
  root.orosTvCore = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
