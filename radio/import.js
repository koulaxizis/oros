// ============================================================
// orOS Radio — import.js (pure logic: "Import stations")
// Reads a list of stations the person exported from another player,
// as DATA only (nothing is run, nothing becomes HTML):
//   - M3U / M3U8  "#EXTINF:-1 [tvg-logo=…],Name" then the URL; a bare
//                 URL line is a station too (named after its host)
//   - RadioDroid  Favourites › Save as M3U: the same, with a
//                 "#RADIOBROWSERUUID:<uuid>" line per station, so the
//                 station keeps its radio-browser.info id
//   - PLS         [playlist] FileN= / TitleN=
//   - XSPF        <track><location> <title> [<image>]</track>
//   - a CSV       name,url (header optional; logo column optional)
//   parseText(text, name) → { source, stations: [{ name, url, logo,
//                             uuid }] } or { error: "bad"|"empty"|"big" }
//   readBytes(bytes, name) → Promise of the same
//   plan(res, cur, opts)   → what an import would ADD to the current
//                            favourites (radio.js slice { favorites,
//                            deleted }): new stations and, listed with
//                            their reason, what is skipped
// orOS plays https streams only (RX-HTTPS, radio.js secureStreamUrl):
// an http station is skipped with the reason "http", unless
// opts.upgrade — then it is tried over https, like the app does for an
// http station of the directory (https:// + the same address).
// Stable ids: "imp-" + hash of the stream URL (or the RadioDroid uuid),
// so importing the same file twice adds nothing. Duplicates (same
// URL) inside the file or already among the favourites are skipped.
// Caps: file size, stations, name / URL length.
// Needs OrosImportKit (../importkit.js).
// UMD: window.OrosRadioImport in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var K = (typeof module !== "undefined" && module.exports && typeof require === "function")
    ? require("../importkit.js") : root.OrosImportKit;

  var MAX_FILE = 5 * 1024 * 1024;
  var MAX_STATIONS = 2000;
  var NAME_LEN = 200;
  var URL_LEN = 2000;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // a link to another playlist, not a stream: the audio element can't
  // play it (radio-browser resolves these to url_resolved; a file can't)
  var PLAYLIST_RE = /\.(pls|m3u|asx|xspf|ram|wax)(?:[?#].*)?$/i;

  // ---------- 1. Values ----------
  function cleanUrl(v) {
    var s = String(v == null ? "" : v).trim();
    if (!s || s.length > URL_LEN || /[\s\u0000-\u001f\u007f"<>\\]/.test(s)) return "";
    return /^https?:\/\/[^\/?#]+/i.test(s) ? s : "";
  }
  function hostOf(u) {
    var m = /^https?:\/\/(?:[^@\/?#]*@)?([^\/?#:]+)/i.exec(u || "");
    return m ? m[1].toLowerCase() : "";
  }
  // the dedupe key: scheme dropped (an http and an https address of one
  // stream are the same station), host lower case, no trailing "/"
  function urlKey(u) {
    var m = /^https?:\/\/([^\/?#]+)(.*)$/i.exec(String(u || "").trim());
    if (!m) return "";
    return m[1].toLowerCase().replace(/:(80|443)$/, "") + m[2].replace(/\/+$/, "");
  }
  function decodeXml(s) {
    return String(s == null ? "" : s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/gi, function (all, e) {
        var k = e.toLowerCase();
        if (k === "amp") return "&";
        if (k === "lt") return "<";
        if (k === "gt") return ">";
        if (k === "quot") return "\"";
        if (k === "apos") return "'";
        var n = k.charAt(1) === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
        return n > 31 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
      });
  }

  // ---------- 2. Collecting ----------
  function collector(source) {
    var list = [];
    return {
      add: function (name, url, logo, uuid) {
        if (list.length >= MAX_STATIONS) return;
        var raw = String(url == null ? "" : url).trim();
        if (!raw) return;
        list.push({
          name: K.clean(name, NAME_LEN),
          url: raw.slice(0, URL_LEN + 1),
          logo: cleanUrl(logo),
          uuid: UUID_RE.test(String(uuid || "")) ? String(uuid).toLowerCase() : ""
        });
      },
      done: function () {
        if (!list.length) return { error: "empty", source: source };
        return { source: source, stations: list };
      }
    };
  }

  // ---------- 3. Parsers ----------
  // #EXTINF:-1 tvg-logo="…" group-title="…",Name
  function extinf(line) {
    var body = line.replace(/^#EXTINF:\s*/i, "");
    // the name follows the first comma that is not inside quotes
    var q = false, cut = -1;
    for (var i = 0; i < body.length; i++) {
      var c = body.charAt(i);
      if (c === "\"") q = !q;
      else if (c === "," && !q) { cut = i; break; }
    }
    var attrs = cut >= 0 ? body.slice(0, cut) : body, name = cut >= 0 ? body.slice(cut + 1) : "";
    var logo = /tvg-logo\s*=\s*"([^"]*)"/i.exec(attrs) || /tvg-logo\s*=\s*([^\s,]+)/i.exec(attrs);
    var tname = /tvg-name\s*=\s*"([^"]*)"/i.exec(attrs);
    return { name: name.trim() || (tname ? tname[1] : ""), logo: logo ? logo[1] : "" };
  }
  function parseM3u(text) {
    var lines = text.split(/\r\n?|\n/), cur = null, uuid = "", rd = false;
    var c = null, items = [];
    lines.forEach(function (ln) {
      var s = ln.trim();
      if (!s) return;
      if (/^#EXTINF:/i.test(s)) { cur = extinf(s); return; }
      if (/^#RADIOBROWSERUUID:/i.test(s)) { uuid = s.replace(/^#RADIOBROWSERUUID:\s*/i, ""); rd = true; return; }
      if (s.charAt(0) === "#") return;                     // #EXTM3U, #EXTVLCOPT, comments
      items.push({ name: cur ? cur.name : "", url: s, logo: cur ? cur.logo : "", uuid: uuid });
      cur = null; uuid = "";
    });
    c = collector(rd ? "radiodroid" : "m3u");
    items.forEach(function (it) { c.add(it.name, it.url, it.logo, it.uuid); });
    return c.done();
  }
  function parsePls(text) {
    var files = {}, titles = {};
    text.split(/\r\n?|\n/).forEach(function (ln) {
      var m = /^\s*(file|title)(\d{1,5})\s*=\s*(.*)$/i.exec(ln);
      if (!m) return;
      (m[1].toLowerCase() === "file" ? files : titles)[+m[2]] = m[3].trim();
    });
    var c = collector("pls");
    Object.keys(files).map(Number).sort(function (a, b) { return a - b; }).forEach(function (n) {
      c.add(titles[n] || "", files[n], "", "");
    });
    return c.done();
  }
  function tag(block, name) {
    var m = new RegExp("<(?:[\\w-]+:)?" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?" + name + "\\s*>", "i").exec(block);
    return m ? decodeXml(m[1]).trim() : "";
  }
  function parseXspf(text) {
    var c = collector("xspf"), re = /<(?:[\w-]+:)?track(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?track\s*>/gi, m, n = 0;
    while ((m = re.exec(text)) && n++ < MAX_STATIONS) {
      c.add(tag(m[1], "title") || tag(m[1], "creator"), tag(m[1], "location"), tag(m[1], "image"), "");
    }
    return c.done();
  }
  // i18n-inline-ok: the Greek CSV column names below are parser data (headers of imported files), not UI text
  var CSV_NAME = ["name", "station", "station name", "title", "όνομα", "σταθμός"];
  var CSV_URL = ["url", "stream", "stream url", "streamurl", "url_resolved", "link", "address", "location", "διεύθυνση"];
  var CSV_LOGO = ["logo", "favicon", "icon", "image", "tvg-logo"];
  var CSV_UUID = ["stationuuid", "uuid"];
  function parseCsv(text) {
    var t = K.csv(text, { maxRows: MAX_STATIONS + 1 }), c = collector("csv");
    var nc = K.col(t.head, CSV_NAME), uc = K.col(t.head, CSV_URL);
    var lc = K.col(t.head, CSV_LOGO), ic = K.col(t.head, CSV_UUID);
    var rows = t.rows;
    if (uc === -1) {
      // no header: "name,url" (or "url,name") from the first line on
      // (read again with a dummy first line: the kit trims header cells)
      rows = K.csv("x\n" + text, { delim: t.delim, maxRows: MAX_STATIONS + 1 }).rows;
      var first = rows[0] || [];
      for (var i = 0; i < first.length && uc === -1; i++) if (cleanUrl(first[i])) uc = i;
      if (uc === -1) return { error: "bad" };
      nc = uc === 0 ? (first.length > 1 ? 1 : -1) : 0;
      lc = -1; ic = -1;
    }
    rows.forEach(function (r) {
      c.add(nc !== -1 ? r[nc] : "", r[uc], lc !== -1 ? r[lc] : "", ic !== -1 ? r[ic] : "");
    });
    return c.done();
  }

  // ---------- 4. Detect + read ----------
  function parseText(text, name) {
    text = String(text == null ? "" : text);
    if (text.length > MAX_FILE) return { error: "big" };
    var t0 = text.replace(/^﻿/, "").replace(/^\s+/, "");
    if (!t0) return { error: "empty" };
    var ext = (/\.([a-z0-9]{1,5})$/i.exec(String(name || "")) || [])[1];
    ext = ext ? ext.toLowerCase() : "";
    if (/^<\?xml|^<playlist/i.test(t0) || ext === "xspf") return parseXspf(t0);
    if (/^\[playlist\]/i.test(t0) || ext === "pls" || /^\s*file1\s*=/im.test(t0.slice(0, 2000))) return parsePls(t0);
    if (/^#EXTM3U/i.test(t0) || /^#EXTINF:/im.test(t0.slice(0, 4000)) || ext === "m3u" || ext === "m3u8") return parseM3u(t0);
    var r = parseCsv(t0);
    if (!r.error) return r;
    // a plain list of addresses, one per line
    if (/^https?:\/\//i.test(t0)) return parseM3u(t0);
    return r;
  }
  function readBytes(bytes, name) {
    if (!bytes || bytes.length > MAX_FILE) return Promise.resolve({ error: "big" });
    var txt;
    try { txt = K.text(bytes); } catch (e) { return Promise.resolve({ error: "bad" }); }
    return Promise.resolve(parseText(txt, name));
  }

  // ---------- 5. Plan against the current favourites ----------
  // cur = { favorites: [{ stationuuid, url_resolved, … }] };
  // opts.upgrade: try http stations over https instead of skipping them.
  // → { add: [{ stationuuid, name, url_resolved, favicon?, up? }],
  //     skip: [{ name, url, why: "http"|"bad"|"playlist"|"have"|"dup" }],
  //     stats: { found, add, http, have, dup, bad, up } }
  function plan(res, cur, opts) {
    opts = opts || {};
    var favs = (cur && Array.isArray(cur.favorites)) ? cur.favorites : [];
    var haveUrl = {}, haveId = {};
    favs.forEach(function (f) {
      if (!f) return;
      if (f.stationuuid) haveId[String(f.stationuuid).toLowerCase()] = true;
      var k = urlKey(f.url_resolved);
      if (k) haveUrl[k] = true;
    });
    var seen = {}, add = [], skip = [];
    var st = { found: 0, add: 0, http: 0, have: 0, dup: 0, bad: 0, up: 0 };
    ((res && res.stations) || []).forEach(function (s) {
      st.found++;
      var url = cleanUrl(s.url), name = s.name || hostOf(url) || "";
      function skipIt(why) { skip.push({ name: name, url: K.clean(s.url, 300), why: why }); st[why === "playlist" ? "bad" : why]++; }
      if (!url) { skipIt("bad"); return; }
      if (PLAYLIST_RE.test(url.replace(/[?#].*$/, ""))) { skipIt("playlist"); return; }
      var up = false;
      if (!/^https:\/\//i.test(url)) {
        if (!opts.upgrade) { skipIt("http"); return; }
        url = "https://" + url.slice(7);              // RX-HTTPS: the same address over https
        up = true;
      }
      var key = urlKey(url);
      if (seen[key]) { skipIt("dup"); return; }
      seen[key] = true;
      var id = s.uuid ? s.uuid : "imp-" + K.hash(key);
      if (haveUrl[key] || haveId[id.toLowerCase()]) { skipIt("have"); return; }
      var rec = { stationuuid: id, name: name || url, url_resolved: url };
      if (s.logo && /^https:\/\//i.test(s.logo)) rec.favicon = s.logo;
      if (up) { rec.up = true; st.up++; }
      add.push(rec);
      st.add++;
    });
    return { add: add, skip: skip, stats: st };
  }

  var API = { MAX_FILE: MAX_FILE, MAX_STATIONS: MAX_STATIONS, parseText: parseText, readBytes: readBytes, plan: plan, urlKey: urlKey };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.OrosRadioImport = API;
})(typeof self !== "undefined" ? self : this);
