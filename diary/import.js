// ============================================================
// orOS One-Sentence Diary — import.js (pure, no storage)
// Days written in other journaling apps, read as DATA only:
//   - Day One   "Export › JSON": a ZIP with Journal.json (or one
//               <Journal name>.json per journal) { metadata, entries }
//               and photos/<md5>.<type>; the .json alone works too
//   - Journey   a ZIP of one JSON file per entry (text in HTML or
//               Markdown, date_journal in ms) and the photo files
//   - Diaro     DiaroBackup.xml (alone or in its ZIP, photos under
//               media/photo/): the diaro_entries, diaro_locations
//               and diaro_attachments tables
//   - Daylio    the CSV export: note_title / note of each row (the
//               moods belong to the Mood app)
// Every entry becomes { ms, ymd, md, loc, wx, ph }; group() makes
// one item per day (several entries joined in time order with a
// rule), plan() decides against the diary what may be written
// (never over the user's own text), apply() makes ONE new data with
// the stamps of an ordinary edit, revert() undoes it with newer
// stamps (tombstones), so sync merges it like any other change.
// Nothing from a file is run or inserted as HTML: HTML is read in an
// inert DOMParser document (or a plain tag scan without one) and
// turned into the diary's small Markdown, which the app shows with
// textContent. The Diaro XML is read with a small text scanner.
// Needs DiaryCore (core.js) and OrosImportKit (../importkit.js); ZIP
// files need AtelierZip (../atelier/zip.js).
// UMD: module.exports in Node (tests), window.OrosDiaryImport.
// Sections:
//   1. Text: HTML → Markdown, the day's line, weather, place, dates
//   2. Sources: Day One, Journey, Diaro, Daylio
//   3. Detect + read (file or ZIP)
//   4. Group, plan, apply, revert
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module === "object" && module.exports && typeof require === "function";
  function kit() { return NODE ? require("../importkit.js") : root.OrosImportKit; }
  function core() { return NODE ? require("./core.js") : root.DiaryCore; }

  var MAX_FILE    = 300 * 1024 * 1024;   // a ZIP with photos, as given
  var MAX_JSON    = 60 * 1024 * 1024;    // one inflated JSON / XML entry
  var MAX_ENTRY   = 2 * 1024 * 1024;     // one Journey entry file
  var MAX_PHOTO   = 40 * 1024 * 1024;    // one photo (as the app's own picker)
  var MAX_ENTRIES = 20000;
  var MAX_FILES   = 20000;               // JSON files read from a ZIP
  var MAX_TEXT    = 40000;               // one entry's text, characters
  var LINE_MAX    = 280;
  var RULE        = "\n\n---\n\n";
  var SOURCES = { dayone: "Day One", journey: "Journey", diaro: "Diaro", daylio: "Daylio" };
  var IMG_RE = /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i;

  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function str(v) { return typeof v === "string" ? v : (typeof v === "number" && isFinite(v) ? String(v) : ""); }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function base(name) { return String(name || "").split("/").pop(); }

  // ---------- 1. Text ----------
  var NAMED = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
    rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", laquo: "«", raquo: "»", deg: "°", euro: "€", middot: "·" };
  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,8});/gi, function (m0, e) {
      if (e.charAt(0) === "#") {
        var n = e.charAt(1).toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        if (!isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return "";
        return String.fromCodePoint(n);
      }
      var v = NAMED[e.toLowerCase()];
      return v === undefined ? m0 : v;
    });
  }
  function looksHtml(s) { return /<\/?(p|div|br|span|b|i|u|strong|em|ul|ol|li|h[1-6]|a|blockquote|pre|code|img|hr|font|table)\b[^>]*>/i.test(s); }
  function safeHref(u) {
    u = String(u || "").trim();
    return /^(https?:\/\/|mailto:)[^\s<>"'`()]+$/i.test(u) ? u : null;
  }

  // HTML → the diary's Markdown. In a browser: an INERT document
  // (DOMParser never runs scripts or loads anything) walked node by
  // node; only text comes out. Without DOMParser: a tag scan.
  var SKIP_TAGS = { script: 1, style: 1, template: 1, noscript: 1, iframe: 1, object: 1, embed: 1, svg: 1, math: 1, head: 1, title: 1, select: 1, button: 1, textarea: 1 };
  var BLOCK_TAGS = { p: 1, div: 1, section: 1, article: 1, header: 1, footer: 1, main: 1, aside: 1, figure: 1, figcaption: 1, table: 1, tr: 1, pre: 1, ul: 1, ol: 1, dl: 1, dt: 1, dd: 1, address: 1 };
  function domToMd(doc) {
    var out = [], count = 0;
    function txt(n, pre) {
      var s = n.nodeValue || "";
      return pre ? s : s.replace(/\s+/g, " ");
    }
    function inl(node, depth, pre) {
      var s = "";
      if (depth > 60 || count > 200000) return s;
      for (var c = node.firstChild; c; c = c.nextSibling) {
        count++;
        if (c.nodeType === 3) { s += txt(c, pre); continue; }
        if (c.nodeType !== 1) continue;
        var tag = c.nodeName.toLowerCase();
        if (SKIP_TAGS[tag]) continue;
        if (tag === "br") { s += "\n"; continue; }
        if (tag === "img") continue;
        var inner = inl(c, depth + 1, pre || tag === "pre");
        if (tag === "b" || tag === "strong") s += inner.trim() ? "**" + inner.trim() + "**" : inner;
        else if (tag === "i" || tag === "em") s += inner.trim() ? "*" + inner.trim() + "*" : inner;
        else if (tag === "code") s += inner ? "`" + inner.replace(/`/g, "'") + "`" : "";
        else if (tag === "a") {
          var h = safeHref(c.getAttribute("href"));
          s += h && inner.trim() ? "[" + inner.trim().replace(/[\[\]]/g, "") + "](" + h + ")" : inner;
        } else if (tag === "li") s += "\n" + ((c.parentNode && c.parentNode.nodeName.toLowerCase() === "ol") ? "1. " : "- ") + inner.trim();
        else if (/^h[1-6]$/.test(tag)) s += "\n\n" + "###".slice(0, Math.min(3, +tag.charAt(1))) + " " + inner.replace(/\s+/g, " ").trim() + "\n\n";
        else if (tag === "blockquote") s += "\n\n" + inner.trim().split("\n").map(function (l) { return "> " + l; }).join("\n") + "\n\n";
        else if (tag === "hr") s += "\n\n---\n\n";
        else if (BLOCK_TAGS[tag]) s += "\n\n" + inner + "\n\n";
        else s += inner;
      }
      return s;
    }
    out.push(inl(doc.body || doc, 0, false));
    return out.join("");
  }
  function scanToMd(html) {
    var s = html.replace(/<(script|style|template|noscript|iframe|object|svg|head|title|textarea)\b[\s\S]*?<\/\1\s*>/gi, "");
    s = s.replace(/<br\s*\/?>/gi, "\n")
      .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, function (m, t, x) { return x.trim() ? "**" + x.trim() + "**" : x; })
      .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, function (m, t, x) { return x.trim() ? "*" + x.trim() + "*" : x; })
      .replace(/<a\b[^>]*?href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a\s*>/gi, function (m, h, x) {
        var u = safeHref(decodeEntities(h)), t = x.replace(/<[^>]*>/g, "").trim();
        return u && t ? "[" + t.replace(/[\[\]]/g, "") + "](" + u + ")" : x;
      })
      .replace(/<h([1-6])\b[^>]*>/gi, function (m, l) { return "\n\n" + "###".slice(0, Math.min(3, +l)) + " "; })
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<hr\b[^>]*>/gi, "\n\n---\n\n")
      .replace(/<blockquote\b[^>]*>/gi, "\n\n> ")
      .replace(/<\/li\s*>/gi, "")
      .replace(/<\/(p|div|h[1-6]|ul|ol|blockquote|tr|table|pre|section|article)\s*>/gi, "\n\n")
      .replace(/<[^>]*>/g, "");
    return decodeEntities(s);
  }
  function tidy(md) {
    return String(md || "").replace(/\r\n?/g, "\n").replace(/ /g, " ")
      .split("\n").map(function (l) { return l.replace(/[ \t]+$/, "").replace(/^[ \t]+(?![-*>]|\d+[.)])/, ""); }).join("\n")
      .replace(/\n{3,}/g, "\n\n").trim();
  }
  function htmlToMd(html) {
    var s = str(html);
    if (!s) return "";
    if (s.length > MAX_TEXT * 4) s = s.slice(0, MAX_TEXT * 4);
    if (typeof root.DOMParser === "function") {
      try {
        var doc = new root.DOMParser().parseFromString("<!doctype html><html><body>" + s + "</body></html>", "text/html");
        return tidy(domToMd(doc));
      } catch (e) {}
    }
    return tidy(scanToMd(s));
  }
  // Any entry text → Markdown (HTML converted, the rest kept).
  function toMd(v) {
    var s = str(v);
    if (s.length > MAX_TEXT * 4) s = s.slice(0, MAX_TEXT * 4);
    s = looksHtml(s) ? htmlToMd(s) : tidy(s);
    return kit().cleanText(s, MAX_TEXT);
  }

  // The day's line: the first sentence (or first line) in plain text,
  // ≤ 280 characters, cut at a word with "…" when longer.
  function plainLine(l) {
    return l.replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d{1,3}[.)]\s+)/, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__|`)/g, "").replace(/(^|\s)[*_](\S)/g, "$1$2").replace(/(\S)[*_](?=\s|$|[.,!?;:])/g, "$1")
      .replace(/\\([\\`*_\[\]()#>-])/g, "$1")
      .replace(/\s+/g, " ").trim();
  }
  function clip(s, n) {
    var a = Array.from(s);
    if (a.length <= n) return s;
    var cut = a.slice(0, n - 1).join(""), sp = cut.lastIndexOf(" ");
    if (sp > n * 0.6) cut = cut.slice(0, sp);
    return cut.replace(/[\s,;:.\-–—]+$/, "") + "…";
  }
  function firstLine(md) {
    var lines = String(md || "").split("\n");
    for (var i = 0; i < lines.length; i++) {
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[i])) continue;
      var l = plainLine(lines[i]);
      if (!l) continue;
      var m = /^(.+?[.!?…;;])(?=\s|$)/.exec(l);
      return clip(m && Array.from(m[1]).length >= 2 ? m[1] : l, LINE_MAX);
    }
    return "";
  }

  // Weather words (Day One, Journey) → WMO code, as in the Weather
  // app's groups. Unknown words → no weather.
  function wmo(words) {
    var s = String(words || "").toLowerCase().replace(/[-_]+/g, " ");
    if (!s.trim()) return null;
    if (/thunder|storm|lightning/.test(s)) return 95;
    if (/sleet|freezing rain|ice/.test(s)) return 66;
    if (/snow|flurr|blizzard/.test(s)) return /shower/.test(s) ? 85 : 73;
    if (/drizzle/.test(s)) return 53;
    if (/shower/.test(s)) return 80;
    if (/rain/.test(s)) return 63;
    if (/fog|mist|haze|smoke|dust/.test(s)) return 45;
    if (/overcast|mostly cloudy/.test(s)) return 3;
    if (/partly|mostly sunny|mostly clear|few clouds|scattered|broken|cloudy/.test(s)) return /^cloudy$/.test(s.trim()) ? 3 : 2;
    if (/clear|sunny|fair/.test(s)) return 0;
    return null;
  }
  function wxOf(words, tempC) {
    var c = wmo(words);
    if (c === null) return null;
    var o = { c: c };
    if (isNum(tempC) && Math.abs(tempC) < 80) o.hi = Math.round(tempC * 10) / 10;
    return o;
  }
  function locOf(name, la, lo) {
    var o = {}, n = kit().clean(name, 80);
    if (n) o.n = n;
    la = typeof la === "string" ? parseFloat(la) : la;
    lo = typeof lo === "string" ? parseFloat(lo) : lo;
    if (isNum(la) && isNum(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180 && !(la === 0 && lo === 0)) {
      o.la = Math.round(la * 100) / 100; o.lo = Math.round(lo * 100) / 100;
    }
    return (o.n || o.la !== undefined) ? o : null;
  }

  // The calendar day of an instant where it was written: an IANA zone
  // ("Europe/Athens"), an offset ("+02:00", "GMT+2"), else this device.
  function ymdIn(ms, tz) {
    if (!isNum(ms)) return "";
    var z = str(tz).trim(), m = /^(?:GMT|UTC)?\s*([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(z);
    if (m) {
      var off = (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +(m[3] || 0));
      if (Math.abs(off) <= 14 * 60) {
        var u = new Date(ms + off * 60000);
        return u.getUTCFullYear() + "-" + p2(u.getUTCMonth() + 1) + "-" + p2(u.getUTCDate());
      }
    }
    if (z && /^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+){0,2}$/.test(z)) {
      try {
        var parts = new Intl.DateTimeFormat("en-CA", { timeZone: z, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
        var o = {};
        parts.forEach(function (p) { o[p.type] = p.value; });
        if (o.year && o.month && o.day) return o.year + "-" + o.month + "-" + o.day;
      } catch (e) {}
    }
    var d = new Date(ms);
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  }
  function entry(ms, ymd, md, loc, wx, ph) {
    if (!ymd || !core().isYmd(ymd)) return null;
    md = str(md);
    if (!md.trim()) return null;
    return { ms: isNum(ms) ? ms : 0, ymd: ymd, md: md, loc: loc || null, wx: wx || null, ph: ph || [] };
  }

  // ---------- 2. Sources ----------
  // photos: { lowercased base name or md5 → zip entry name }
  function photoIndex(names) {
    var idx = {};
    (names || []).forEach(function (n) {
      if (!IMG_RE.test(n)) return;
      var b = base(n).toLowerCase();
      if (!idx[b]) idx[b] = n;
      var stem = b.replace(/\.[^.]+$/, "");
      if (!idx["#" + stem]) idx["#" + stem] = n;
    });
    return idx;
  }

  // Day One: Markdown with backslash escapes and dayone-moment:// refs.
  function dayOneText(e) {
    var s = str(e.text);
    if (!s && typeof e.richText === "string") {
      var rt = kit().json(e.richText);
      if (rt && Array.isArray(rt.contents)) s = rt.contents.map(function (c) { return c && typeof c.text === "string" ? c.text : ""; }).join("");
    }
    s = s.slice(0, MAX_TEXT * 2)
      .replace(/!\[[^\]]*\]\(dayone-moment:[^)]*\)/gi, "")
      .replace(/\(?dayone-moment:\/\/?[^\s)]*\)?/gi, "")
      .replace(/\\([.!+=~|{}<>"':,;?&%$@^])/g, "$1");
    return toMd(s);
  }
  function fromDayOne(list, photos) {
    var out = [];
    list.slice(0, MAX_ENTRIES).forEach(function (e) {
      if (!e || typeof e !== "object") return;
      var ms = Date.parse(str(e.creationDate));
      if (!isFinite(ms)) return;
      var L = e.location && typeof e.location === "object" ? e.location : null;
      var loc = L ? locOf(L.placeName || L.localityName || (L.region && L.region.identifier) || "", L.latitude, L.longitude) : null;
      var W = e.weather && typeof e.weather === "object" ? e.weather : null;
      var wx = W ? wxOf(W.conditionsDescription || W.weatherCode, W.temperatureCelsius) : null;
      var ph = [];
      (Array.isArray(e.photos) ? e.photos : []).forEach(function (p) {
        if (!p || typeof p !== "object") return;
        var md5 = str(p.md5).toLowerCase(), n = md5 && photos["#" + md5];
        if (n && ph.indexOf(n) < 0) ph.push(n);
      });
      var x = entry(ms, ymdIn(ms, e.timeZone), dayOneText(e), loc, wx, ph);
      if (x) out.push(x);
    });
    return out;
  }

  function isJourney(o) { return !!o && typeof o === "object" && !Array.isArray(o) && "date_journal" in o && "text" in o; }
  function fromJourney(list, photos) {
    var out = [];
    list.slice(0, MAX_ENTRIES).forEach(function (e) {
      if (!isJourney(e)) return;
      var ms = typeof e.date_journal === "number" ? e.date_journal : kit().parseDate(e.date_journal);
      if (!isFinite(ms)) return;
      var W = e.weather && typeof e.weather === "object" ? e.weather : null;
      var wx = W && W.id !== -1 ? wxOf(W.description, typeof W.degree_c === "number" && W.degree_c > -273 ? W.degree_c : NaN) : null;
      var ph = [];
      (Array.isArray(e.photos) ? e.photos : []).forEach(function (p) {
        var n = typeof p === "string" ? photos[base(p).toLowerCase()] : null;
        if (n && ph.indexOf(n) < 0) ph.push(n);
      });
      var x = entry(ms, ymdIn(ms, e.timezone), toMd(e.text), locOf(e.address, e.lat, e.lon), wx, ph);
      if (x) out.push(x);
    });
    return out;
  }

  // Diaro XML: <table name="…"><r><field>value</field>…</r></table>.
  function xmlValue(v) {
    var m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(v);
    return m ? m[1] : decodeEntities(v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
  }
  function xmlTables(xml) {
    var out = {}, re = /<table\s+name\s*=\s*["']([A-Za-z0-9_]+)["']\s*>([\s\S]*?)<\/table\s*>/g, m;
    while ((m = re.exec(xml))) {
      var rows = [], rre = /<r\b[^>]*>([\s\S]*?)<\/r\s*>/g, r;
      while ((r = rre.exec(m[2])) && rows.length < MAX_ENTRIES * 2) {
        var o = {}, fre = /<([A-Za-z0-9_]+)\b[^>]*?(?:\/>|>([\s\S]*?)<\/\1\s*>)/g, f;
        while ((f = fre.exec(r[1]))) o[f[1]] = f[2] === undefined ? "" : xmlValue(f[2]);
        rows.push(o);
      }
      out[m[1]] = rows;
    }
    return out;
  }
  function fromDiaro(xml, photos) {
    var T = xmlTables(xml), locs = {}, att = {}, out = [];
    (T.diaro_locations || []).forEach(function (l) { if (l.uid) locs[l.uid] = l; });
    (T.diaro_attachments || []).forEach(function (a) {
      if (!a.entry_uid || (a.type && a.type !== "photo")) return;
      var n = photos[base(a.filename).toLowerCase()];
      if (!n) return;
      (att[a.entry_uid] = att[a.entry_uid] || []).push({ n: n, pos: +a.position || 0 });
    });
    (T.diaro_entries || []).slice(0, MAX_ENTRIES).forEach(function (e) {
      var ms = /^\d{9,14}$/.test(str(e.date).trim()) ? +e.date : kit().parseDate(e.date);
      if (!isFinite(ms)) return;
      var title = kit().clean(e.title, 300), body = toMd(e.text);
      var md = title ? "### " + title + (body ? "\n\n" + body : "") : body;
      var L = e.location_uid && locs[e.location_uid];
      var loc = L ? locOf(L.title || L.address, L.lat, L.lng || L.lon) : null;
      var ph = (att[e.uid] || []).sort(function (a, b) { return a.pos - b.pos; }).map(function (a) { return a.n; });
      var x = entry(ms, ymdIn(ms, e.tz_offset), md, loc, null, ph);
      if (x) out.push(x);
    });
    return out;
  }

  function isDaylio(head) {
    return !!kit().detect(head, [{ id: "daylio", need: ["full_date", "note"] }, { id: "daylio", need: ["full_date", "mood", "note_title"] }]);
  }
  function fromDaylio(text) {
    var K = kit(), R = K.records(text), out = [];
    if (!isDaylio(R.head)) return out;
    R.rows.slice(0, MAX_ENTRIES).forEach(function (r) {
      var ymd = K.ymd(K.get(r, ["full_date"]));
      if (!ymd) return;
      var title = K.clean(toMd(K.get(r, ["note_title"])).replace(/\n+/g, " "), 300);
      var body = toMd(K.get(r, ["note"]));
      var md = title ? "### " + title + (body ? "\n\n" + body : "") : body;
      var ms = K.parseDate(ymd + " " + K.clean(K.get(r, ["time"]), 20));
      if (!isFinite(ms)) ms = K.parseDate(ymd);
      var x = entry(ms, ymd, md, null, null, []);
      if (x) out.push(x);
    });
    return out;
  }

  // ---------- 3. Detect + read ----------
  function result(source, entries, zip, photos) {
    if (!entries.length) return null;
    var nph = 0;
    entries.forEach(function (e) { nph += e.ph.length; });
    return { source: source, name: SOURCES[source], entries: entries, zip: zip || null, photos: nph };
  }
  // A single (non-ZIP) file's text → result | null.
  function readText(text) {
    var s = String(text || "").replace(/^﻿/, "");
    var t = s.trim();
    if (!t) return null;
    if (t.charAt(0) === "<") return /<table\s+name\s*=\s*["']diaro_entries["']/.test(t) ? result("diaro", fromDiaro(t, {})) : null;
    if (t.charAt(0) === "{" || t.charAt(0) === "[") {
      var j = kit().json(t);
      if (j && !Array.isArray(j) && Array.isArray(j.entries)) return result("dayone", fromDayOne(j.entries, {}));
      if (isJourney(j)) return result("journey", fromJourney([j], {}));
      if (Array.isArray(j) && j.some(isJourney)) return result("journey", fromJourney(j, {}));
      return null;
    }
    var head = kit().csv(s.slice(0, 4000), { maxRows: 1 }).head;
    if (isDaylio(head)) return result("daylio", fromDaylio(s));
    return null;
  }
  function readZip(zip) {
    var K = kit(), names = zip.names, photos = photoIndex(names);
    var xml = names.filter(function (n) { return /\.xml$/i.test(n); });
    var diaro = xml.filter(function (n) { return /diarobackup\.xml$/i.test(n); })[0] || xml[0];
    function bytesText(n, max) { return zip.bytes(n, max).then(function (b) { return b ? K.text(b) : ""; }); }
    if (diaro) {
      return bytesText(diaro, MAX_JSON).then(function (x) {
        return /<table\s+name\s*=\s*["']diaro_entries["']/.test(x) ? result("diaro", fromDiaro(x, photos), zip) : null;
      });
    }
    var jsons = names.filter(function (n) { return /\.json$/i.test(n) && !/(^|\/)(__macosx|\.)/i.test(n); }).slice(0, MAX_FILES);
    var csvs = names.filter(function (n) { return /\.csv$/i.test(n); });
    if (!jsons.length) {
      if (!csvs.length) return Promise.resolve(null);
      return bytesText(csvs[0], MAX_JSON).then(function (s) { var r = readText(s); return r ? r : null; });
    }
    // Day One: a few big journal files; Journey: many small entry files.
    var big = jsons.filter(function (n) { return zip.size(n) > MAX_ENTRY; });
    var dayone = [], journey = [], i = 0, chain = Promise.resolve();
    jsons.forEach(function (n) {
      chain = chain.then(function () {
        if (++i > MAX_FILES) return;
        return bytesText(n, big.indexOf(n) >= 0 ? MAX_JSON : MAX_ENTRY).then(function (s) {
          var j = K.json(s);
          if (j && !Array.isArray(j) && Array.isArray(j.entries)) dayone = dayone.concat(j.entries.slice(0, MAX_ENTRIES - dayone.length));
          else if (isJourney(j) && journey.length < MAX_ENTRIES) journey.push(j);
        }).catch(function () {});
      });
    });
    return chain.then(function () {
      if (dayone.length) return result("dayone", fromDayOne(dayone, photos), zip);
      if (journey.length) return result("journey", fromJourney(journey, photos), zip);
      return null;
    });
  }
  // file: { name, bytes } (OrosImportKit.readFile) → Promise<result | null>
  // result: { source, name, entries, zip, photos }; null = not one of
  // these apps (the caller tries its own formats).
  function read(file) {
    var K = kit();
    try {
      if (!file || !file.bytes) return Promise.resolve(null);
      if (K.isZip(file.bytes)) return readZip(K.unzip(file.bytes));
      if (file.bytes.length > MAX_JSON) return Promise.resolve(null);
      return Promise.resolve(readText(K.text(file.bytes)));
    } catch (e) { return Promise.reject(e); }
  }

  // ---------- 4. Group, plan, apply, revert ----------
  // One item per day, entries in time order: { ymd, n, line, md, full,
  // loc, wx, ph }. md is the long entry ("" when the whole text is just
  // the line); full is what goes under a line the user already wrote.
  function group(entries) {
    var C = core(), by = {};
    (entries || []).forEach(function (e) { (by[e.ymd] = by[e.ymd] || []).push(e); });
    return Object.keys(by).sort().map(function (ymd) {
      var list = by[ymd].sort(function (a, b) { return a.ms - b.ms; });
      var md = C.cleanMd(list.map(function (e) { return e.md.trim(); }).join(RULE));
      var line = C.cleanText(firstLine(md));
      if (!line) return null;
      var ph = [];
      list.forEach(function (e) { e.ph.forEach(function (n) { if (ph.indexOf(n) < 0) ph.push(n); }); });
      var loc = null, wx = null;
      list.forEach(function (e) { if (!loc && e.loc) loc = C.normLoc(e.loc); if (!wx && e.wx) wx = C.normWx(e.wx); });
      var only = md.replace(/\s+/g, " ").trim() === line;
      return { ymd: ymd, n: list.length, line: line, md: only ? "" : md, full: md, loc: loc, wx: wx, ph: ph.slice(0, C.PH_MAX) };
    }).filter(Boolean);
  }

  // What an import would do to `data`. Never over the user's text:
  //   new    — the day has no line and no long text: line + long entry
  //   append — the day has a line but no long text: the long entry only
  //   had    — the day's long entry already has text: skipped
  //   dup    — the same text is already there (an earlier import)
  // Place, weather and photos fill only what the day does not have.
  function plan(data, days) {
    var C = core(), cur = C.mergeDiary(data, null), items = [], had = 0, dup = 0, photos = 0;
    (days || []).forEach(function (d) {
      var line = cur.days[d.ymd], L = C.longOf(cur, d.ymd);
      if (L.md && L.md === d.full) { dup++; return; }
      if (line && line.t === d.line && !L.md && !d.md) { dup++; return; }
      if (L.md) { had++; return; }
      var it = { ymd: d.ymd, mode: line ? "append" : "new", day: d };
      it.ph = Math.min(d.ph.length, Math.max(0, C.PH_MAX - L.ph.length));
      photos += it.ph;
      items.push(it);
    });
    var keys = (days || []).map(function (d) { return d.ymd; });
    var n = 0;
    (days || []).forEach(function (d) { n += d.n; });
    return {
      items: items, had: had, dup: dup, photos: photos, days: keys.length, entries: n,
      add: items.filter(function (i) { return i.mode === "new"; }).length,
      append: items.filter(function (i) { return i.mode === "append"; }).length,
      from: keys[0] || "", to: keys[keys.length - 1] || ""
    };
  }

  // The plan → ONE new data (input untouched). phNames: { ymd: [orOS
  // photo file names already written] }. → { data, undo, added,
  // appended } — undo holds only what revert() needs.
  function apply(data, pl, now, phNames) {
    var C = core(), cur = C.mergeDiary(data, null), patch = { days: {}, long: {} };
    var undo = { lines: [], long: {} }, added = 0, appended = 0;
    (pl.items || []).forEach(function (it) {
      var y = it.ymd, d = it.day, L = C.longOf(cur, y), old = (cur.long && cur.long[y]) || {};
      var lp = {}, prev = {};
      function put(f, v) { lp[f] = { v: v, m: Math.max(now, old[f] ? old[f].m + 1 : 0) }; prev[f] = { was: L[f], now: v }; }
      if (it.mode === "new") {
        if (cur.days[y]) return;                         // written meanwhile
        patch.days[y] = { t: d.line, e: "", m: Math.max(now, (cur.tombs[y] || 0) + 1) };
        undo.lines.push({ ymd: y, t: d.line });
        added++;
        if (d.md) put("md", d.md);
      } else {
        if (L.md) return;
        put("md", d.full);
        appended++;
      }
      if (d.loc && !L.loc) put("loc", d.loc);
      if (d.wx && !L.wx) put("wx", d.wx);
      var ph = (phNames && phNames[y]) || [];
      if (ph.length && L.ph.length < C.PH_MAX) put("ph", L.ph.concat(ph).slice(0, C.PH_MAX));
      if (Object.keys(lp).length) { patch.long[y] = lp; undo.long[y] = prev; }
    });
    return { data: C.mergeDiary(cur, patch), undo: undo, added: added, appended: appended };
  }

  // Undo an apply(): the lines it added get a tombstone, the fields it
  // set get their old values back, all with newer stamps, so a copy
  // that already synced the import is undone too. A line or field
  // changed since the import is left alone.
  function revert(data, undo, now) {
    var C = core(), cur = C.mergeDiary(data, null), patch = { days: {}, tombs: {}, long: {} };
    (undo.lines || []).forEach(function (l) {
      var d = cur.days[l.ymd];
      if (d && d.t === l.t) patch.tombs[l.ymd] = Math.max(now, d.m + 1);
    });
    Object.keys(undo.long || {}).forEach(function (y) {
      var prev = undo.long[y], old = (cur.long && cur.long[y]) || {}, lp = {};
      Object.keys(prev).forEach(function (f) {
        if (!old[f] || JSON.stringify(old[f].v) !== JSON.stringify(normed(C, f, prev[f].now))) return;
        lp[f] = { v: prev[f].was, m: Math.max(now, old[f].m + 1) };
      });
      if (Object.keys(lp).length) patch.long[y] = lp;
    });
    return C.mergeDiary(cur, patch);
  }
  function normed(C, f, v) {
    var probe = { days: {}, long: {} };
    probe.long["2000-01-01"] = {};
    probe.long["2000-01-01"][f] = { v: v, m: 1 };
    var m = C.mergeDiary(probe, null).long;
    return m && m["2000-01-01"] && m["2000-01-01"][f] ? m["2000-01-01"][f].v : v;
  }

  var API = {
    SOURCES: SOURCES, MAX_FILE: MAX_FILE, MAX_PHOTO: MAX_PHOTO,
    htmlToMd: htmlToMd, toMd: toMd, firstLine: firstLine, wmo: wmo, ymdIn: ymdIn, xmlTables: xmlTables,
    fromDayOne: fromDayOne, fromJourney: fromJourney, fromDiaro: fromDiaro, fromDaylio: fromDaylio,
    readText: readText, read: read, group: group, plan: plan, apply: apply, revert: revert
  };
  if (NODE) module.exports = API;
  else root.OrosDiaryImport = API;
})(typeof window !== "undefined" ? window : globalThis);
