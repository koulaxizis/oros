// ============================================================
// orOS Wiki — import.js: import from other wikis (v1.0.0, wave 4)
// Pure (no DOM writes, no storage), so the app and the Node tests run
// the same code. One flow for every source:
//   files → readBundle (text files + picture loaders, ZIPs inside
//   ZIPs) → detect → parse (pages with link and picture tokens) →
//   plan (stable ids: add / update / same / edited) → apply (one new
//   data object + undo info) → undo
// Sources (auto-detected):
//   - Markdown files or a .zip of them (Obsidian, our own export…)
//   - Notion "Markdown & CSV" export: ids stripped from names,
//     subpages → a category named after their page, links between
//     pages kept, pictures kept, CSV databases → a table article
//   - TiddlyWiki: JSON export, .tid files, or the whole .html file
//     (tiddler store JSON or the older storeArea), WikiText → our
//     markup; system tiddlers ($:/…) skipped
//   - MediaWiki XML dump (Special:Export): latest revision, main
//     namespace, wikitext through WikiIO.wtConvert
//   - Confluence space export (HTML .zip): HTML → our markup through
//     an inert tree (DOMParser in the browser, a small tag scanner in
//     Node), breadcrumbs → categories, links between pages kept
// Tokens inside parsed text (control characters never kept from a
// file): "\u0004n\u0004" = link target refs[n] (resolved to the final
// title by plan/apply), "\u0002n\u0002[alt,opts]\u0003" = picture
// pics[n] (an orOS disk id once stored).
// Stable ids: article id = "a" + hash(wiki, source, page key); the
// revision id of an imported text carries the hash of its source and
// of the text itself, so a later import can tell "untouched since the
// import" (update it) from "edited by you" (left alone).
// Exposes window.OrosWikiImport (browser) / module.exports (Node).
// Sections:
//   1. Helpers (text, tokens, ids)
//   2. Reading files (ZIPs inside ZIPs)
//   3. Detect
//   4. Markdown + Notion
//   5. TiddlyWiki
//   6. MediaWiki
//   7. Confluence (HTML → our markup)
//   8. Plan, apply, undo
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports;
  var C = NODE ? require("./core.js") : root.WikiCore;
  // io.js loads after this file in the page: looked up when used
  function io() { return NODE ? require("./io.js") : root.WikiIO; }
  function KIT() { return NODE ? require("../importkit.js") : root.OrosImportKit; }

  var VERSION = "1.0.0";
  var MAX_PAGES = 2000;                   // articles in one import (WikiIO.MAX_IMPORT)
  var MAX_DOCS = 6000;                    // text files read from one import
  var MAX_PICS = 600;                     // pictures stored by one import
  var MAX_ENTRY_TEXT = 8 * 1024 * 1024;   // one text file inside a ZIP
  var MAX_INNER_ZIP = 120 * 1024 * 1024;  // a ZIP inside a ZIP
  var MAX_ROWS = 1000, MAX_COLS = 30;     // one Notion database table
  var MAX_NODES = 200000;                 // HTML elements in one page
  var ACCEPT = ".oroswiki,.md,.markdown,.txt,.zip,.json,.html,.htm,.xml,.tid,.csv,text/markdown,text/plain,text/html,application/json,application/xml,text/xml,application/zip,application/x-oros-wiki";

  var TEXT_EXT = /\.(md|markdown|txt|csv|html?|json|xml|tid)$/i;
  var MD_EXT = /\.(md|markdown|txt)$/i;
  var PIC_EXT = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;
  var NOTION_ID = /^(.*?)\s+([0-9a-f]{32})$/i;

  // ---------- 1. Helpers ----------
  function str(v) { return typeof v === "string" ? v : ""; }
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  // Text from a file: one kind of line end, no control characters
  // (our tokens use some of them, so a file can never forge one).
  function clean(s) {
    return str(s).replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  }
  function normPath(p) {
    var out = [];
    str(p).replace(/\\/g, "/").split("/").forEach(function (s) {
      if (!s || s === ".") return;
      if (s === "..") out.pop(); else out.push(s);
    });
    return out.join("/");
  }
  function dirOf(p) { var i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }
  function baseOf(p) { return p.slice(p.lastIndexOf("/") + 1); }
  function dec(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  var ENT = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", ndash: "–", mdash: "—", hellip: "…",
    laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", middot: "·", copy: "©", reg: "®",
    trade: "™", deg: "°", times: "×", euro: "€", pound: "£", larr: "←", rarr: "→", zwj: "", zwnj: "", shy: "" };
  function ent(s) {
    return str(s).replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, function (m, e) {
      if (e.charAt(0) === "#") {
        var n = e.charAt(1).toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 31 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000) && n !== 127 ? String.fromCodePoint(n) : "";
      }
      var k = e.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENT, k) ? ENT[k] : m;
    });
  }
  // Split on ``` fences: code parts stay as written.
  function outsideCode(text, fn) {
    var out = [], cur = [], code = false;
    str(text).split("\n").forEach(function (l) {
      if (/^\s*```/.test(l)) {
        if (!code) { if (cur.length) out.push(fn(cur.join("\n"))); cur = [l]; code = true; }
        else { cur.push(l); out.push(cur.join("\n")); cur = []; code = false; }
        return;
      }
      cur.push(l);
    });
    if (cur.length) out.push(code ? cur.join("\n") : fn(cur.join("\n")));
    return out.join("\n");
  }
  // Markdown special characters in plain text (one line).
  function escInline(s) { return str(s).replace(/[\\`*_~\[\]|^{}>]/g, "\\$&"); }
  // A label inside [[…|label]] or [label](…): plain, one line.
  function plainLabel(s) { return str(s).replace(/[\[\]|\u0001-\u0005]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200); }
  function pad(h, n) { return (new Array(n + 1).join("0") + h).slice(-n); }
  function h7(s) { return pad(KIT().hash(s), 7); }

  // The result of parse: pages + the tables the tokens point into.
  function newRes(source) {
    return { source: source, name: "", pages: [], refs: [], refIx: {}, pics: [], picIx: {}, skipped: { system: 0, other: 0, empty: 0, cut: 0 }, range: null, main: "" };
  }
  // A link token for page `key` (fb: the title to use when that page
  // is not part of this import).
  function ref(res, key, fb) {
    var k = "k:" + key;
    if (res.refIx[k] === undefined) { res.refIx[k] = res.refs.length; res.refs.push({ key: key, fb: C.cleanTitle(fb) }); }
    return "\u0004" + res.refIx[k] + "\u0004";
  }
  // [[token|label]] (the label goes when it equals the final title)
  function linkTok(res, key, fb, label) {
    var l = plainLabel(label || fb);
    return "[[" + ref(res, key, fb) + (l ? "|" + l : "") + "]]";
  }
  // A picture token for a bundle picture (lower-case path), or "".
  function picTok(res, key, alt, opts) {
    if (!key) return "";
    if (res.picIx[key] === undefined) {
      if (res.pics.length >= MAX_PICS) return "";
      res.picIx[key] = res.pics.length;
      res.pics.push(key);
    }
    return "\u0002" + res.picIx[key] + "\u0002" + JSON.stringify([plainLabel(alt), str(opts)]) + "\u0003";
  }
  // A picture of the bundle seen from folder dir: its path, else the
  // only picture with that file name.
  function picAt(pics, dir, p) {
    p = dec(str(p).split(/[?#]/)[0]);
    if (!p || /^[a-z][a-z0-9+.-]*:/i.test(p)) return "";
    var path = normPath((dir ? dir + "/" : "") + p).toLowerCase();
    if (pics[path]) return path;
    var base = baseOf(path), hit = "";
    Object.keys(pics).some(function (k) { if (baseOf(k) === base) { hit = k; return true; } return false; });
    return hit;
  }
  function addRange(res, ms) {
    if (!(ms > 0) || !isFinite(ms)) return;
    if (!res.range) res.range = [ms, ms];
    else { res.range[0] = Math.min(res.range[0], ms); res.range[1] = Math.max(res.range[1], ms); }
  }
  function addPage(res, p) {
    if (res.pages.length >= MAX_PAGES) { res.skipped.cut++; return false; }
    p.cats = (p.cats || []).map(C.cleanTitle).filter(Boolean);
    p.t = C.cleanTitle(p.t);
    p.x = str(p.x).replace(/\s+$/, "");
    res.pages.push(p);
    return true;
  }

  // ---------- 2. Reading files ----------
  // items: [{ name, bytes: Uint8Array }]; Zip: AtelierZip (only needed
  // when an item is a ZIP). → Promise<{ docs: [{ path, text }],
  // pics: { lower path: { path, load() → Promise<Uint8Array> } } }>
  function readBundle(items, Zip) {
    var K = KIT(), docs = [], pics = {}, nPics = 0, chain = Promise.resolve();
    function addDoc(path, text) { if (docs.length < MAX_DOCS && text !== null) docs.push({ path: path, text: clean(text) }); }
    function addPic(path, load) {
      var k = path.toLowerCase();
      if (pics[k] || nPics >= MAX_PICS * 4) return;
      pics[k] = { path: path, load: load };
      nPics++;
    }
    function fromZip(bytes, depth) {
      var z = Zip.open(bytes), c = Promise.resolve();
      z.names.forEach(function (n) {
        var p = normPath(n);
        if (!p || /(^|\/)(__MACOSX|\.)/.test(p)) return;
        if (/\.zip$/i.test(p)) {
          // Notion wraps big exports as ZIPs inside a ZIP
          if (depth < 2) c = c.then(function () { return z.bytes(n, MAX_INNER_ZIP); })
            .then(function (b) { if (b && K.isZip(b)) return fromZip(b, depth + 1); })
            .catch(function () {});
        } else if (TEXT_EXT.test(p)) {
          c = c.then(function () { if (docs.length < MAX_DOCS) return z.text(n, MAX_ENTRY_TEXT); return null; })
            .then(function (x) { addDoc(p, x); }, function () {});
        } else if (PIC_EXT.test(p)) {
          addPic(p, function () { return z.bytes(n, 40 * 1024 * 1024); });
        }
      });
      return c;
    }
    (items || []).forEach(function (it) {
      var name = normPath(str(it.name)) || "file";
      chain = chain.then(function () {
        if (K.isZip(it.bytes)) {
          if (!Zip) throw new Error("zip");
          return fromZip(it.bytes, 0);
        }
        if (PIC_EXT.test(name)) { addPic(name, function () { return Promise.resolve(it.bytes); }); return null; }
        addDoc(name, K.text(it.bytes));
        return null;
      });
    });
    return chain.then(function () {
      docs.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
      return { docs: docs, pics: pics };
    });
  }

  // ---------- 3. Detect ----------
  function isTiddlerList(j) {
    return Array.isArray(j) && j.length > 0 && j.some(function (t) { return isObj(t) && typeof t.title === "string"; }) &&
      j.every(function (t) { return isObj(t) && typeof t.title === "string" && (t.text === undefined || typeof t.text === "string"); });
  }
  var TW_HTML = /class\s*=\s*["']?[^"'>]*tiddlywiki-tiddler-store|id\s*=\s*["']?storeArea\b/i;
  // → "tiddlywiki" | "mediawiki" | "notion" | "confluence" | "markdown" | ""
  function detect(b) {
    var docs = (b && b.docs) || [];
    var i, d, ext;
    for (i = 0; i < docs.length; i++) {
      d = docs[i];
      ext = (/\.([a-z]+)$/i.exec(d.path) || ["", ""])[1].toLowerCase();
      if (ext === "tid") return "tiddlywiki";
      if (ext === "json" && /^\s*\[/.test(d.text) && isTiddlerList(KIT().json(d.text))) return "tiddlywiki";
      if ((ext === "html" || ext === "htm") && TW_HTML.test(d.text)) return "tiddlywiki";
      if (ext === "xml" && /<mediawiki[\s>]/i.test(d.text.slice(0, 4000))) return "mediawiki";
    }
    var notion = docs.some(function (x) {
      return /\.(md|csv)$/i.test(x.path) && x.path.split("/").some(function (s) { return NOTION_ID.test(s.replace(/(_all)?\.(md|csv)$/i, "")); });
    });
    if (notion) return "notion";
    var html = docs.filter(function (x) { return /\.html?$/i.test(x.path); });
    if (html.some(function (x) { return /atlassian|confluence|id\s*=\s*["']?main-content/i.test(x.text.slice(0, 200000)); })) return "confluence";
    if (docs.some(function (x) { return MD_EXT.test(x.path); })) return "markdown";
    return "";
  }

  // ---------- 4. Markdown + Notion ----------
  var MEDIA_DIR = /^(media|attachments|assets|images|_resources|resources)$/i;
  function fromMarkdownFiles(b, o) {
    var res = newRes("markdown");
    var docs = b.docs.filter(function (d) { return MD_EXT.test(d.path); });
    // one shared top folder (a zipped vault) is not a category
    var tops = {};
    docs.forEach(function (d) { tops[d.path.indexOf("/") > 0 ? d.path.split("/")[0] : ""] = 1; });
    var keys = Object.keys(tops), strip = keys.length === 1 && keys[0] ? keys[0] + "/" : "";
    if (strip) res.name = C.cleanTitle(keys[0]);
    var byPath = {}, byName = {}, first = [];
    docs.forEach(function (d) {
      var a = io().fromMarkdown(baseOf(d.path), d.text, null);
      var key = "md:" + d.path.toLowerCase();
      first.push({ d: d, key: key, t: a.t });
      byPath[d.path.toLowerCase()] = first[first.length - 1];
      var bn = baseOf(d.path).toLowerCase();
      if (!byName[bn]) byName[bn] = first[first.length - 1];
    });
    first.forEach(function (f) {
      var dir = dirOf(f.d.path);
      var a = io().fromMarkdown(baseOf(f.d.path), f.d.text, {
        img: function (p, alt, opts) { return picTok(res, picAt(b.pics, dir, p), alt, opts); },
        page: function (p) {
          var hit = byPath[normPath((dir ? dir + "/" : "") + p).toLowerCase()] || byName[baseOf(p).toLowerCase()];
          return hit ? ref(res, hit.key, hit.t) : "";
        }
      });
      var cats = a.cats.slice();
      var rel = f.d.path.slice(f.d.path.indexOf(strip) === 0 ? strip.length : 0).split("/");
      var folder = rel.length > 1 ? C.cleanTitle(rel[rel.length - 2]) : "";
      if (folder && C.fold(folder) !== C.fold(a.t) && !MEDIA_DIR.test(folder)) cats.unshift(folder);
      if (!a.x.trim() && !cats.length) res.skipped.empty++;
      addPage(res, { key: f.key, t: a.t || o.untitled, x: a.x, cats: cats, parent: "" });
    });
    return res;
  }

  // "Page 1a2b…(32 hex)" → { name, id }
  function notionName(seg) {
    var m = NOTION_ID.exec(seg);
    return m ? { name: m[1].trim(), id: m[2].toLowerCase() } : { name: seg.trim(), id: "" };
  }
  function fromNotion(b, o) {
    var res = newRes("notion");
    var list = [], ids = {}, allCsv = {};
    b.docs.forEach(function (d) {
      var m = /^(.*)\.(md|markdown|csv)$/i.exec(baseOf(d.path));
      if (!m) return;
      var isCsv = m[2].toLowerCase() === "csv", stem = m[1], all = false;
      if (isCsv && /_all$/i.test(stem)) { stem = stem.slice(0, -4); all = true; }
      var n = notionName(stem);
      var it = { d: d, csv: isCsv, all: all, stem: stem, name: n.name, id: n.id, dir: dirOf(d.path) };
      if (isCsv && n.id) {
        // "DB id.csv" and "DB id_all.csv": the _all one has every row
        if (allCsv[n.id] && (allCsv[n.id].all || !all)) return;
        if (allCsv[n.id]) list.splice(list.indexOf(allCsv[n.id]), 1);
        allCsv[n.id] = it;
      }
      list.push(it);
    });
    // keys, titles, the folder each page keeps its subpages in
    var byPath = {}, folders = {}, tops = {};
    list.forEach(function (it) {
      it.key = "notion:" + (it.id ? it.id + (it.csv ? ".csv" : "") : it.d.path.toLowerCase());
      if (it.csv) it.t = it.name;
      else {
        var a = io().fromMarkdown(it.name + ".md", it.d.text, null);
        it.t = a.t || it.name;
      }
      it.t = C.cleanTitle(it.t) || o.untitled;
      byPath[it.d.path.toLowerCase()] = it;
      if (it.id && !ids[it.id]) ids[it.id] = it;
      var dirL = it.dir.toLowerCase();
      [it.stem, it.name].forEach(function (s) {
        var f = ((dirL ? dirL + "/" : "") + s).toLowerCase();
        if (!folders[f] || folders[f].csv) folders[f] = it;
      });
      tops[it.dir.split("/")[0]] = 1;
    });
    var tk = Object.keys(tops);
    if (tk.length === 1 && tk[0] && !/^export[-_ ]/i.test(tk[0])) res.name = notionName(tk[0]).name;
    list.forEach(function (it) {
      var par = folders[it.dir.toLowerCase()];
      it.parent = par && par !== it ? par : null;
    });
    function target(dir, p) {
      var path = dec(str(p).split("#")[0].split("?")[0]);
      var hit = byPath[normPath((dir ? dir + "/" : "") + path).toLowerCase()];
      if (hit) return hit;
      var m = /([0-9a-f]{32})(?:\.(md|csv)|$)/i.exec(path.replace(/_all(\.csv)$/i, "$1"));
      return m ? ids[m[1].toLowerCase()] || null : null;
    }
    // parents before their subpages, then by path
    function depth(it) { var n = 0, p = it.parent; while (p && n < 60) { n++; p = p.parent; } return n; }
    list.sort(function (a, b) { return depth(a) - depth(b) || (a.d.path < b.d.path ? -1 : 1); });
    list.forEach(function (it) {
      var x;
      if (it.csv) x = notionTable(res, it, list);
      else {
        // links to databases and to notion.so pages, before the Markdown pass
        var pre = outsideCode(it.d.text, function (s) {
          return s.replace(/\[([^\]\n]+)\]\(\s*<?([^)\s>]+)>?\s*\)/g, function (m, label, url) {
            if (/^!/.test(m)) return m;
            var hit = null;
            if (/\.csv$/i.test(dec(url))) hit = target(it.dir, url);
            else if (/^https?:\/\/(www\.)?notion\.(so|site)\//i.test(url)) {
              var id = /([0-9a-f]{32})(?:[?#]|$)/i.exec(url.replace(/-/g, ""));
              hit = id ? ids[id[1].toLowerCase()] : null;
            }
            return hit ? linkTok(res, hit.key, hit.t, label) : m;
          }).replace(/!\[\]\(\s*<?([^)\s>]+)>?/g, function (m, p) {
            return "![" + notionName(baseOf(dec(p)).replace(/\.[a-z0-9]+$/i, "")).name.replace(/[\[\]]/g, "") + "](" + p;
          });
        });
        var a = io().fromMarkdown(it.name + ".md", pre, {
          img: function (p, alt, opts) { return picTok(res, picAt(b.pics, it.dir, p), alt, opts); },
          page: function (p) { var hit = target(it.dir, p); return hit ? ref(res, hit.key, hit.t) : ""; }
        });
        x = a.x;
        if (!x.trim()) res.skipped.empty++;
      }
      addPage(res, { key: it.key, t: it.t, x: x, cats: [], parent: it.parent ? it.parent.key : "" });
    });
    var top = list.filter(function (it) { return !it.parent; })[0];
    res.main = top ? top.key : "";
    return res;
  }
  // A Notion database (CSV) → a table; the first column links to the
  // row pages (in the database's folder) when they came along.
  function notionTable(res, it, list) {
    var t = KIT().csv(it.d.text);
    var head = (t.head || []).slice(0, MAX_COLS);
    if (!head.length) return "";
    var rows = (t.rows || []).filter(function (r) { return r.some(function (c) { return str(c).trim(); }); });
    if (rows.length > MAX_ROWS) rows = rows.slice(0, MAX_ROWS);
    var kids = {};
    list.forEach(function (p) { if (p.parent === it && !p.csv) kids[C.fold(p.t)] = p; });
    function cell(v) { return C.escMd(str(v)).slice(0, 2000); }
    var body = rows.map(function (r) {
      return head.map(function (h, i) {
        var v = str(r[i]);
        var kid = i === 0 ? kids[C.fold(C.cleanTitle(v))] : null;
        return kid ? linkTok(res, kid.key, kid.t, v) : cell(v);
      });
    });
    return C.tableText(head.map(cell), body, []);
  }

  // ---------- 5. TiddlyWiki ----------
  function attrs(s) {
    var o = {}, re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g, m;
    while ((m = re.exec(str(s)))) o[m[1].toLowerCase()] = ent(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4]);
    return o;
  }
  // The tiddlers of a whole TiddlyWiki file, read as text (nothing in
  // it runs): the JSON store (5.2+) or the older storeArea divs.
  function twFromHtml(html) {
    var out = [], re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, m;
    while ((m = re.exec(html))) {
      if (!/tiddlywiki-tiddler-store/i.test(m[1])) continue;
      var j = KIT().json(m[2]);
      if (Array.isArray(j)) out = out.concat(j);
    }
    if (out.length) return out;
    var at = html.search(/<div\b[^>]*\bid\s*=\s*["']?storeArea\b/i);
    if (at < 0) return out;
    var area = html.slice(at), d, dre = /<div\b([^>]*\btitle\s*=[^>]*)>([\s\S]*?)<\/div>/gi;
    while ((d = dre.exec(area))) {
      var a = attrs(d[1]);
      if (typeof a.title !== "string") continue;
      var pre = /<pre\b[^>]*>([\s\S]*?)<\/pre>/i.exec(d[2]);
      a.text = ent(pre ? pre[1] : d[2].replace(/\\n/g, "\n"));
      out.push(a);
    }
    return out;
  }
  function twFromTid(text) {
    var o = {}, lines = text.split("\n"), i = 0;
    for (; i < lines.length; i++) {
      if (!lines[i].trim()) { i++; break; }
      var m = /^([\w:.-]+):\s?(.*)$/.exec(lines[i]);
      if (!m) break;
      o[m[1].toLowerCase()] = m[2];
    }
    o.text = lines.slice(i).join("\n");
    return o;
  }
  // "YYYYMMDDhhmmssSSS" (UTC) → ms or 0
  function twDate(s) {
    var m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?(\d{3})?$/.exec(str(s).trim());
    if (!m) return 0;
    var ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), +(m[7] || 0));
    return isFinite(ms) && ms > 0 ? ms : 0;
  }
  // "[[two words]] one" or an array → ["two words", "one"]
  function twTags(v) {
    if (Array.isArray(v)) return v.filter(function (x) { return typeof x === "string"; });
    var out = [], s = str(v), re = /\[\[([^\]]+)\]\]|(\S+)/g, m;
    while ((m = re.exec(s))) out.push(m[1] || m[2]);
    return out;
  }
  // WikiText → our markup. link(target, label) → markup.
  function twText(src, link) {
    var keep = [];
    function hold(s) { keep.push(s); return "\u0001" + (keep.length - 1) + "\u0001"; }
    function inl(s) {
      return s.replace(/''(.+?)''/g, "**$1**")
        .replace(/\/\/(\S(?:.*?\S)?)\/\//g, "*$1*")
        .replace(/__(.+?)__/g, "$1").replace(/\^\^(.+?)\^\^/g, "$1").replace(/,,(.+?),,/g, "$1")
        .replace(/@@(?:\.[\w-]+\s)?(.+?)@@/g, "$1");
    }
    var text = outsideCode(src, function (s) {
      s = s.replace(/``([\s\S]*?)``|`([^`\n]+)`/g, function (m, a, b2) { return hold("`" + str(a || b2).replace(/`/g, "'") + "`"); });
      s = s.replace(/<<[\s\S]*?>>/g, "");
      s = s.replace(/<!--[\s\S]*?-->/g, "");
      s = s.replace(/\{\{\{[\s\S]*?\}\}\}/g, "");
      s = s.replace(/\[img(?:\s[^\[\]]*)?\[([^\]\n]*)\]\]/gi, function (m, body) {
        var bar = body.indexOf("|");
        return bar > 0 ? escInline(body.slice(0, bar).trim()) : "";
      });
      s = s.replace(/\[ext\[([^\]\n]*)\]\]/gi, function (m, body) {
        var bar = body.lastIndexOf("|"), url = (bar >= 0 ? body.slice(bar + 1) : body).trim();
        var label = bar >= 0 ? body.slice(0, bar).trim() : "";
        var u = C.safeUrl(url);
        return u ? hold("[" + plainLabel(label || url) + "](" + u + ")") : escInline(label || url);
      });
      s = s.replace(/\[\[([^\]\n]+?)\]\]/g, function (m, body) {
        var bar = body.indexOf("|");
        var label = bar >= 0 ? body.slice(0, bar).trim() : "", to = (bar >= 0 ? body.slice(bar + 1) : body).trim();
        if (/^[a-z][a-z0-9+.-]*:/i.test(to) && !/^\$:/.test(to)) {
          var u = C.safeUrl(to);
          return u ? hold("[" + plainLabel(label || to) + "](" + u + ")") : escInline(label || to);
        }
        return hold(link(to, label));
      });
      s = s.replace(/\{\{([^{}\n]*)\}\}/g, function (m, body) {
        var to = body.split("||")[0].split("!!")[0].split("##")[0].trim();
        return to && !/^\$:/.test(to) ? hold(link(to, "")) : "";
      });
      s = s.replace(/\bhttps?:\/\/[^\s<>\[\]"']+/g, function (u) { return C.safeUrl(u) ? hold(u) : u; });
      s = s.replace(/<\/?[a-z$][\w.$-]*(\s[^<>]*)?\/?>/gi, "");
      // block by block
      var lines = s.split("\n"), out = [], i = 0, quote = false;
      while (i < lines.length) {
        var l = lines[i];
        if (/^<<<\s*/.test(l)) { quote = !quote; out.push(""); i++; continue; }
        if (/^\|.*\|[hkcf]?\s*$/.test(l)) {
          var rows = [], head = null;
          while (i < lines.length && /^\|.*\|[hkcf]?\s*$/.test(lines[i])) {
            var row = lines[i].trim(), kind = /\|([hkcf])$/.exec(row);
            row = kind ? row.slice(0, -1) : row;
            var cells = row.slice(1, -1).split("|").map(function (c) { return inl(ent(c.replace(/^!/, "")).trim()); });
            if (kind && kind[1] === "h" && !head) head = cells;
            else if (!kind || kind[1] === "f") rows.push(cells);
            i++;
          }
          if (!head) head = rows.shift() || [];
          out.push("", hold(C.tableText(head, rows, [])), "");
          continue;
        }
        var h = /^(!{1,6})\s*(.*)$/.exec(l);
        if (h) {
          var lv = Math.min(4, h[1].length + 1), eq = new Array(lv + 1).join("=");
          var ht = inl(h[2]).trim();
          if (ht) out.push("", eq + " " + ht + " " + eq, "");
          i++;
          continue;
        }
        var li = /^([*#;:>]+)\s*(.*)$/.exec(l);
        if (li) {
          var marks = li[1], last = marks.charAt(marks.length - 1), body = inl(li[2]).trim();
          var ind = new Array(Math.min(marks.length, 4)).join("  ");
          if (/^>+$/.test(marks)) out.push("> " + body);
          else if (last === "*") out.push(ind + "- " + body);
          else if (last === "#") out.push(ind + "1. " + body);
          else if (last === ";") out.push("", "**" + body + "**");
          else if (body) out.push(body);
          i++;
          continue;
        }
        var x = inl(l);
        out.push(quote && x.trim() ? "> " + x : x);
        i++;
      }
      return out.join("\n");
    });
    for (var g = 0; g < 4 && /\u0001\d+\u0001/.test(text); g++) {
      text = text.replace(/\u0001(\d+)\u0001/g, function (m, n) { return keep[Number(n)] || ""; });
    }
    return ent(text).replace(/\n{3,}/g, "\n\n").trim();
  }
  function fromTiddlyWiki(b, o) {
    var res = newRes("tiddlywiki"), all = [];
    b.docs.forEach(function (d) {
      if (/\.tid$/i.test(d.path)) all.push(twFromTid(d.text));
      else if (/\.json$/i.test(d.path)) { var j = KIT().json(d.text); if (isTiddlerList(j)) all = all.concat(j); }
      else if (/\.html?$/i.test(d.path) && TW_HTML.test(d.text)) all = all.concat(twFromHtml(d.text));
    });
    var byTitle = {}, list = [];
    all.forEach(function (t) {
      if (!isObj(t) || typeof t.title !== "string") return;
      var title = t.title;
      if (/^\$:\/SiteTitle$/.test(title)) res.name = C.cleanTitle(str(t.text));
      if (/^\$:\//.test(title) || t["draft.of"] || /^Draft (\d+ )?of '/.test(title)) { res.skipped.system++; return; }
      var type = str(t.type).trim().toLowerCase();
      if (type && !/^text\/(vnd\.tiddlywiki|x-tiddlywiki|x-markdown|markdown|plain)$/.test(type)) { res.skipped.other++; return; }
      var k = C.fold(C.cleanTitle(title));
      if (!k) return;
      if (byTitle[k]) list.splice(list.indexOf(byTitle[k]), 1);
      byTitle[k] = { t: t, title: C.cleanTitle(title), type: type };
      list.push(byTitle[k]);
    });
    list.forEach(function (it) {
      it.key = "tw:" + C.fold(it.title);
      var c = twDate(it.t.created), m = twDate(it.t.modified);
      addRange(res, c); addRange(res, m);
      it.c = c;
    });
    function link(to, label) {
      var hit = byTitle[C.fold(C.cleanTitle(to))];
      if (hit) return linkTok(res, hit.key, hit.title, label || to);
      var t = C.cleanTitle(to);
      if (!t) return escInline(label);
      var l = plainLabel(label);
      return "[[" + t + (l && C.fold(l) !== C.fold(t) ? "|" + l : "") + "]]";
    }
    list.forEach(function (it) {
      var text = clean(str(it.t.text)), x;
      if (/markdown/.test(it.type)) x = io().mdBody(text, {});
      else if (it.type === "text/plain") x = text ? "```\n" + text.replace(/```/g, "'''") + "\n```" : "";
      else x = twText(text, link);
      var cats = twTags(it.t.tags).filter(function (g) { return !/^\$:\//.test(g); });
      if (!x.trim()) res.skipped.empty++;
      addPage(res, { key: it.key, t: it.title, x: x, cats: cats, parent: "", c: it.c });
    });
    // the default tiddlers ($:/DefaultTiddlers) are not read: the main
    // page of a new wiki is the first tiddler, or one called like it
    var main = list.filter(function (it) { return /^(home|main page|start|getting ?started|αρχική)$/i.test(it.title); })[0] || list[0];
    res.main = main ? main.key : "";
    return res;
  }

  // ---------- 6. MediaWiki ----------
  function tag(s, name) {
    var m = new RegExp("<" + name + "\\b[^>]*>([\\s\\S]*?)</" + name + ">").exec(s);
    return m ? ent(m[1]) : "";
  }
  function fromMediaWiki(b, o) {
    var res = newRes("mediawiki");
    var pages = [], cats = ["category", "κατηγορία", "κατηγορια"];
    b.docs.forEach(function (d) {
      if (!/\.xml$/i.test(d.path) || !/<mediawiki[\s>]/i.test(d.text.slice(0, 4000))) return;
      var xml = d.text;
      if (!res.name) res.name = C.cleanTitle(tag(xml.slice(0, 20000), "sitename"));
      var nre = /<namespace\b[^>]*\bkey="14"[^>]*>([^<]*)<\/namespace>/g, nm;
      while ((nm = nre.exec(xml.slice(0, 40000)))) if (nm[1].trim()) cats.push(ent(nm[1]).trim().toLowerCase());
      var re = /<page>([\s\S]*?)<\/page>/g, m;
      while ((m = re.exec(xml))) {
        var body = m[1], title = tag(body, "title"), ns = tag(body, "ns").trim();
        if (!title) continue;
        if (ns && ns !== "0") { res.skipped.other++; continue; }
        var best = null, rre = /<revision>([\s\S]*?)<\/revision>/g, r;
        while ((r = rre.exec(body))) {
          var ts = tag(r[1], "timestamp").trim();
          if (!best || ts >= best.ts) best = { ts: ts, rev: r[1] };
        }
        if (!best) continue;
        var tm = /<text\b[^>]*?(?:\/>|>([\s\S]*?)<\/text>)/.exec(best.rev);
        addRange(res, Date.parse(best.ts));
        pages.push({ title: C.cleanTitle(title), text: clean(ent(tm && tm[1] ? tm[1] : "")) });
      }
    });
    var byTitle = {};
    pages.forEach(function (p) { if (p.title) byTitle[C.fold(p.title)] = p; });
    var list = Object.keys(byTitle).map(function (k) { return byTitle[k]; });
    list.sort(function (a, b) { return pages.indexOf(a) - pages.indexOf(b); });
    list.forEach(function (p) { p.key = "mw:" + C.fold(p.title); });
    var catRe = new RegExp("\\[\\[\\s*(?:" + cats.map(function (c) { return c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("|") + ")\\s*:\\s*([^\\]|\\n]+)(?:\\|[^\\]\\n]*)?\\]\\]", "gi");
    list.forEach(function (p) {
      var pc = [], x;
      var src = p.text.replace(catRe, function (m, c) { pc.push(c.trim()); return ""; });
      var rd = /^\s*#\s*(redirect|ανακατεύθυνση|ανακατευθυνση)\s*:?\s*\[\[([^\]|#\n]+)/i.exec(src);
      if (rd) {
        var to = byTitle[C.fold(C.cleanTitle(rd[2]))];
        x = "#REDIRECT " + (to ? linkTok(res, to.key, to.title, to.title) : "[[" + C.cleanTitle(rd[2]) + "]]");
      } else {
        x = io().wtConvert(src, { lang: o.lang, title: p.title });
        x = titleLinks(res, x, byTitle);
      }
      if (!x.trim()) res.skipped.empty++;
      addPage(res, { key: p.key, t: p.title, x: x, cats: pc, parent: "" });
    });
    var main = list.filter(function (p) { return /^(main page|κύρια σελίδα|κυρια σελιδα)$/i.test(p.title); })[0] || list[0];
    res.main = main ? main.key : "";
    return res;
  }
  // [[Title…]] links to pages of this import → tokens (so they follow a
  // renamed title). byTitle: fold(title) → { key, title }
  function titleLinks(res, x, byTitle) {
    return outsideCode(x, function (s) {
      return s.replace(/\[\[([^\[\]\n|#\u0004]+)(#[^\[\]\n|]*)?(?:\|([^\[\]\n]*))?\]\]/g, function (m, to, frag, label) {
        if (/^\s*:?\s*(category|κατηγορ|file|image|αρχε|εικον)[^:]*:/i.test(to)) return m;
        var hit = byTitle[C.fold(C.cleanTitle(to))];
        if (!hit) return m;
        var l = plainLabel(label || to);
        return "[[" + ref(res, hit.key, hit.title) + str(frag).replace(/[\]\[|]/g, "") + (l ? "|" + l : "") + "]]";
      });
    });
  }

  // ---------- 7. Confluence ----------
  // A light tree: element { n: tag, a: { attr: value }, c: [nodes] },
  // text = a string. Built from an inert DOMParser document in the
  // browser; in Node by a small tag scanner (same shape).
  var VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/;
  var SKIP_TAG = /^(script|style|noscript|template|head|title|iframe|object|embed|svg|math|form|button|input|select|textarea|canvas|audio|video|map)$/;
  var KEEP_ATTR = { href: 1, src: 1, alt: 1, id: 1, "class": 1, title: 1, "data-syntaxhighlighter-params": 1 };
  function fromDom(node, budget) {
    if (node.nodeType === 3) return node.nodeValue || "";
    if (node.nodeType !== 1 || budget.n-- <= 0) return null;
    var n = String(node.nodeName || "").toLowerCase(), a = {};
    for (var i = 0; node.attributes && i < node.attributes.length; i++) {
      var at = node.attributes[i];
      if (KEEP_ATTR[at.name.toLowerCase()]) a[at.name.toLowerCase()] = at.value;
    }
    var el = { n: n, a: a, c: [] };
    if (n === "title") { el.c.push(node.textContent || ""); return el; }
    for (var k = node.firstChild; k; k = k.nextSibling) { var c = fromDom(k, budget); if (c !== null) el.c.push(c); }
    return el;
  }
  // The tag scanner: enough for exported pages (optional end tags of
  // p, li, td, tr closed where a browser would close them).
  function scanHtml(html) {
    var rootEl = { n: "#root", a: {}, c: [] }, stack = [rootEl], count = 0;
    var re = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\?[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|[^<]+|</g;
    var m;
    function top() { return stack[stack.length - 1]; }
    function closeTo(names, stop) {
      for (var i = stack.length - 1; i > 0; i--) {
        if (stop && stop.test(stack[i].n)) return;
        if (names.test(stack[i].n)) { stack.length = i; return; }
      }
    }
    while ((m = re.exec(html)) && count < MAX_NODES) {
      var s = m[0];
      if (m[1]) {                                     // end tag
        var en = m[1].toLowerCase();
        for (var i = stack.length - 1; i > 0; i--) if (stack[i].n === en) { stack.length = i; break; }
        continue;
      }
      if (m[2]) {                                     // start tag
        var n = m[2].toLowerCase(), a = attrs(m[3]), el = { n: n, a: {}, c: [] };
        Object.keys(a).forEach(function (k) { if (KEEP_ATTR[k]) el.a[k] = a[k]; });
        count++;
        if (/^(script|style|textarea|title)$/.test(n)) {
          var end = html.toLowerCase().indexOf("</" + n, re.lastIndex);
          var raw = html.slice(re.lastIndex, end < 0 ? html.length : end);
          re.lastIndex = end < 0 ? html.length : html.indexOf(">", end) + 1 || html.length;
          if (n === "title") { el.c.push(ent(raw)); top().c.push(el); }
          continue;
        }
        if (/^(p|div|ul|ol|table|h[1-6]|pre|blockquote|hr|section|dl)$/.test(n)) closeTo(/^p$/, /^(td|th|li|div|blockquote|section)$/);
        if (n === "li") closeTo(/^li$/, /^(ul|ol)$/);
        if (n === "td" || n === "th") closeTo(/^(td|th)$/, /^(tr|table)$/);
        if (n === "tr") closeTo(/^tr$/, /^(table|thead|tbody|tfoot)$/);
        top().c.push(el);
        if (!VOID.test(n) && !m[4]) stack.push(el);
        continue;
      }
      if (s.charAt(0) === "<" && s.length > 1) continue;  // comment, doctype
      top().c.push(ent(s));
    }
    return rootEl;
  }
  function htmlTree(html) {
    if (root && typeof root.DOMParser === "function") {
      try {
        // An inert document: scripts never run, nothing loads.
        var doc = new root.DOMParser().parseFromString(html, "text/html");
        return fromDom(doc.documentElement, { n: MAX_NODES });
      } catch (e) {}
    }
    return scanHtml(html);
  }
  function find(node, fn, depth) {
    if (!node || typeof node === "string" || (depth || 0) > 400) return null;
    if (fn(node)) return node;
    for (var i = 0; i < node.c.length; i++) { var r = find(node.c[i], fn, (depth || 0) + 1); if (r) return r; }
    return null;
  }
  function findAll(node, fn, out, depth) {
    out = out || [];
    if (!node || typeof node === "string" || (depth || 0) > 400) return out;
    if (fn(node)) out.push(node);
    node.c.forEach(function (k) { findAll(k, fn, out, (depth || 0) + 1); });
    return out;
  }
  function textOf(node) {
    if (typeof node === "string") return node;
    if (!node || SKIP_TAG.test(node.n) && node.n !== "title") return "";
    return node.c.map(textOf).join(node.n === "br" ? "\n" : "");
  }
  function hasClass(node, c) { return (" " + str(node.a["class"]) + " ").indexOf(" " + c + " ") >= 0; }
  var BLOCK = /^(p|div|section|article|main|header|footer|aside|nav|h[1-6]|ul|ol|dl|dt|dd|pre|table|blockquote|hr|figure|figcaption|center|details|summary|body|html|#root)$/;

  // HTML tree → our markup. cx: { link(href) → markup | "", img(src, alt) → markup | "" }
  function htmlToMarkup(node, cx) {
    function inline(n, depth) {
      if (typeof n === "string") return escInline(n.replace(/\s+/g, " "));
      if (depth > 60 || SKIP_TAG.test(n.n)) return "";
      var kids = function () { return n.c.map(function (k) { return inline(k, depth + 1); }).join(""); };
      var wrap = function (mark) {
        var s = kids(), lead = /^\s*/.exec(s)[0], tail = /\s*$/.exec(s)[0], core = s.trim();
        return core ? lead + mark + core + mark + tail : s;
      };
      switch (n.n) {
        case "br": return " ";
        case "strong": case "b": return wrap("**");
        case "em": case "i": case "cite": case "var": return wrap("*");
        case "del": case "s": case "strike": return wrap("~~");
        case "code": case "kbd": case "tt": case "samp":
          var c = textOf(n).replace(/\s+/g, " ").replace(/`/g, "'");
          return c.trim() ? "`" + c + "`" : c;
        case "img":
          return cx.img(str(n.a.src), str(n.a.alt || n.a.title)) || "";
        case "a":
          var label = plainLabel(textOf(n));
          var href = str(n.a.href).trim();
          var imgs = findAll(n, function (x) { return x.n === "img"; });
          if (!label && imgs.length) return kids();
          if (!href || href.charAt(0) === "#") return kids();
          var l = cx.link(href, label);
          if (l) return l;
          var u = C.safeUrl(href);
          return u ? "[" + (label || u) + "](" + u + ")" : kids();
        default:
          var s = kids();
          return BLOCK.test(n.n) || /^(li|td|th|tr)$/.test(n.n) ? " " + s + " " : s;
      }
    }
    function para(s) {
      s = s.replace(/\s+/g, " ").trim();
      if (/^(#|=|>|-|\+|\d+[.)])(\s|$)/.test(s)) s = "\\" + s;
      return s;
    }
    function list(n, depth, out) {
      var num = n.n === "ol", ind = new Array(Math.min(depth, 4) + 1).join("  ");
      n.c.forEach(function (li) {
        if (typeof li === "string" || li.n !== "li") {
          if (typeof li !== "string" && (li.n === "ul" || li.n === "ol")) list(li, depth + 1, out);
          return;
        }
        var subs = [], text = li.c.map(function (k) {
          if (typeof k !== "string" && (k.n === "ul" || k.n === "ol")) { subs.push(k); return " "; }
          return inline(k, 1);
        }).join("");
        text = text.replace(/\s+/g, " ").trim();
        if (text) out.push(ind + (num ? "1. " : "- ") + text);
        subs.forEach(function (s) { list(s, depth + 1, out); });
      });
    }
    function table(n) {
      // rows of this table, not of a table inside a cell
      var rows = (function walk(x, out, d) {
        x.c.forEach(function (k) {
          if (typeof k === "string") return;
          if (k.n === "tr") out.push(k);
          else if (k.n !== "table" && d < 6) walk(k, out, d + 1);
        });
        return out;
      })(n, [], 0).slice(0, 2000);
      var cells = rows.map(function (tr) {
        return tr.c.filter(function (c) { return typeof c !== "string" && (c.n === "td" || c.n === "th"); });
      }).filter(function (r) { return r.length; });
      if (!cells.length) return "";
      var conv = function (r) { return r.slice(0, 50).map(function (c) { return inline(c, 1).replace(/\s+/g, " ").trim(); }); };
      var head = cells.shift();
      return C.tableText(conv(head), cells.map(conv), []);
    }
    function blocks(n, out, depth) {
      var buf = "";
      function flush() { var p = para(buf); if (p) out.push(p); buf = ""; }
      (n.c || []).forEach(function (k) {
        if (typeof k === "string") { buf += inline(k, depth); return; }
        if (SKIP_TAG.test(k.n)) return;
        var h = /^h([1-6])$/.exec(k.n);
        if (h) {
          flush();
          var lv = Math.max(2, Math.min(4, Number(h[1]))), eq = new Array(lv + 1).join("=");
          var ht = inline(k, depth).replace(/\s+/g, " ").trim();
          if (ht) out.push(eq + " " + ht + " " + eq);
          return;
        }
        if (k.n === "ul" || k.n === "ol") { flush(); var l = []; list(k, 0, l); if (l.length) out.push(l.join("\n")); return; }
        if (k.n === "pre") {
          flush();
          var code = textOf(k).replace(/^\n+|\s+$/g, "").replace(/```/g, "'''");
          if (code) out.push("```\n" + code + "\n```");
          return;
        }
        if (k.n === "table") { flush(); var t = table(k); if (t) out.push(t); return; }
        if (k.n === "hr") { flush(); out.push("---"); return; }
        if (k.n === "blockquote") {
          flush();
          var q = [];
          blocks(k, q, depth + 1);
          if (q.length) out.push(q.join("\n\n").split("\n").map(function (x) { return "> " + x; }).join("\n"));
          return;
        }
        if (BLOCK.test(k.n) && depth < 80) { flush(); blocks(k, out, depth + 1); return; }
        buf += inline(k, depth);
      });
      flush();
    }
    var out = [];
    blocks(node, out, 0);
    return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function fromConfluence(b, o) {
    var res = newRes("confluence");
    var html = b.docs.filter(function (d) {
      return /\.html?$/i.test(d.path) && !/(^|\/)(attachments|images|styles|thumbnails)\//i.test(d.path);
    });
    var index = html.filter(function (d) { return /(^|\/)index\.html?$/i.test(d.path); })[0];
    var space = "";
    if (index) {
      var it0 = htmlTree(index.text);
      space = C.cleanTitle(textOf(find(it0, function (x) { return x.n === "title"; }) || ""));
      res.name = space;
    }
    var list = [], byPath = {}, byId = {};
    html.forEach(function (d) {
      if (d === index) return;
      var tree = htmlTree(d.text);
      var title = textOf(find(tree, function (x) { return x.n === "title"; }) || "").replace(/\s+/g, " ").trim();
      var tt = find(tree, function (x) { return x.a && x.a.id === "title-text"; });
      if (tt) title = textOf(tt).replace(/\s+/g, " ").trim();
      if (space && title.indexOf(space + " : ") === 0) title = title.slice(space.length + 3);
      else if (/ : /.test(title) && !tt) title = title.slice(title.indexOf(" : ") + 3);
      if (!title) { var h1 = find(tree, function (x) { return x.n === "h1"; }); title = h1 ? textOf(h1) : ""; }
      if (!title) title = baseOf(d.path).replace(/\.html?$/i, "").replace(/_\d+$/, "").replace(/[-_+]/g, " ");
      var it = { d: d, tree: tree, t: C.cleanTitle(title) || o.untitled, key: "cf:" + d.path.toLowerCase(), dir: dirOf(d.path) };
      list.push(it);
      byPath[d.path.toLowerCase()] = it;
      var pid = /(?:^|_)(\d{3,})\.html?$/i.exec(baseOf(d.path));
      if (pid) byId[pid[1]] = it;
    });
    function target(dir, href) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^https?:/i.test(href)) return null;
      var pid = /[?&]pageId=(\d+)/.exec(href);
      if (pid && byId[pid[1]]) return byId[pid[1]];
      if (/^https?:/i.test(href)) return null;
      var p = dec(href.split("#")[0].split("?")[0]);
      return p ? byPath[normPath((dir ? dir + "/" : "") + p).toLowerCase()] || null : null;
    }
    list.forEach(function (it) {
      // breadcrumbs: the last page before this one is its parent
      var bc = find(it.tree, function (x) { return x.a && x.a.id === "breadcrumbs"; });
      it.parent = null;
      if (bc) findAll(bc, function (x) { return x.n === "a"; }).forEach(function (a) {
        var hit = target(it.dir, str(a.a.href));
        if (hit && hit !== it) it.parent = hit;
      });
    });
    function depth(it) { var n = 0, p = it.parent; while (p && n < 60) { n++; p = p.parent; } return n; }
    list.sort(function (a, b) { return depth(a) - depth(b) || (a.d.path < b.d.path ? -1 : 1); });
    list.forEach(function (it) {
      var main = find(it.tree, function (x) { return x.a && x.a.id === "main-content"; }) ||
        find(it.tree, function (x) { return x.n === "body"; }) || it.tree;
      var x = htmlToMarkup(main, {
        link: function (href, label) {
          var hit = target(it.dir, href);
          if (hit) return linkTok(res, hit.key, hit.t, label || hit.t);
          if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^\/\//.test(href)) return escInline(label);   // attachment / missing page
          return "";
        },
        img: function (src, alt) {
          if (/(^|\/)images\/icons\//i.test(src)) return escInline(alt);
          return picTok(res, picAt(b.pics, it.dir, src), alt, "") || escInline(alt);
        }
      });
      if (!x.trim()) res.skipped.empty++;
      it.tree = null;
      addPage(res, { key: it.key, t: it.t, x: x, cats: [], parent: it.parent ? it.parent.key : "" });
    });
    var top = list.filter(function (it) { return !it.parent; })[0];
    res.main = top ? top.key : "";
    return res;
  }

  // files bundle → parse result (or null when nothing is recognised).
  // o: { lang, untitled }
  function parse(b, o) {
    o = o || {};
    o.untitled = o.untitled || "Untitled";
    var src = detect(b);
    var res = src === "tiddlywiki" ? fromTiddlyWiki(b, o) : src === "mediawiki" ? fromMediaWiki(b, o) :
      src === "notion" ? fromNotion(b, o) : src === "confluence" ? fromConfluence(b, o) :
      src === "markdown" ? fromMarkdownFiles(b, o) : null;
    if (!res) return null;
    // two pages with one key (e.g. one tiddler in two files): the last wins
    var seen = {};
    for (var i = res.pages.length - 1; i >= 0; i--) {
      if (seen[res.pages[i].key]) res.pages.splice(i, 1);
      else seen[res.pages[i].key] = 1;
    }
    return res;
  }

  // ---------- 8. Plan, apply, undo ----------
  function artId(wid, source, key) {
    var s = wid + "|" + source + "|" + key;
    return "a" + h7(s) + h7("~" + s + "|2");
  }
  // Tokens hashed by what they point at (their numbers depend on the
  // order pages were read in).
  function srcHash(res, p) {
    var x = p.x.replace(/\u0004(\d+)\u0004/g, function (m, n) { var r = res.refs[Number(n)]; return "\u0004" + (r ? r.key : "") + "\u0004"; })
      .replace(/\u0002(\d+)\u0002/g, function (m, n) { return "\u0002" + (res.pics[Number(n)] || "") + "\u0002"; });
    return h7([p.t, p.parent || "", p.cats.join("|"), x].join("\n"));
  }
  function textHash(id, t, x) { return h7(id + "\n" + t + "\n" + x); }
  // r + source hash (7) + text hash (7) + time (8)
  function importRev(sh, id, t, x, m) { return "r" + sh + textHash(id, t, x) + pad(Number(m).toString(36), 8).slice(-8); }
  // An article untouched since an import: its revision says so, the
  // hash matches its text, and no parallel edit is waiting.
  function untouched(a) {
    return !!a && typeof a.r === "string" && a.r.length === 23 && !(a.alt && a.alt.length) &&
      a.r.slice(8, 15) === textHash(a.id, a.t, a.x);
  }
  // → { wiki, items: [{ page, id, act: add|update|same|edited|cut, title, cur }], n: { … }, titleOf }
  function plan(data, wid, res, o) {
    o = o || {};
    var arts = (data && data.arts) || [], byId = {};
    arts.forEach(function (a) { byId[a.id] = a; });
    var items = res.pages.map(function (p) {
      var id = artId(wid, res.source, p.key), cur = byId[id] || null, sh = srcHash(res, p), act;
      if (cur && cur.w !== wid) cur = null;
      if (!cur) act = "add";
      else if (!untouched(cur)) act = "edited";
      else act = cur.r.slice(1, 8) === sh ? "same" : "update";
      return { page: p, id: id, sh: sh, cur: cur, act: act, title: cur ? cur.t : "" };
    });
    var mine = {};
    items.forEach(function (it) { if (it.act === "add" || it.act === "update") mine[it.id] = 1; });
    var taken = {}, live = arts.filter(function (a) { return a.w === wid; });
    live.forEach(function (a) { if (!mine[a.id]) taken[C.fold(a.t)] = true; });
    var room = Math.max(0, (C.MAX_ARTS || 5000) - live.length);
    var n = { add: 0, update: 0, same: 0, edited: 0, cut: 0, renamed: 0 }, titleOf = {};
    items.forEach(function (it) {
      if (it.act === "add") {
        if (room <= 0) { it.act = "cut"; n.cut++; return; }
        room--;
      }
      if (it.act === "add" || it.act === "update") {
        it.title = io().uniqueTitle(it.page.t, taken, o.untitled || "Untitled");
        if (C.fold(it.title) !== C.fold(it.page.t)) n.renamed++;
      }
      n[it.act]++;
      titleOf[it.page.key] = it.title;
    });
    return { wiki: wid, items: items, n: n, titleOf: titleOf };
  }
  // The final text of a page: links → titles, pictures → disk ids,
  // categories at the end.
  function finalText(res, pl, p, o) {
    var x = p.x.replace(/\[\[\u0004(\d+)\u0004([^\]|\n]*)(?:\|([^\]\n]*))?\]\]/g, function (m, n, frag, label) {
      var r = res.refs[Number(n)], t = r ? pl.titleOf[r.key] || r.fb : "";
      label = str(label).trim();
      if (!t) return escInline(label);
      return "[[" + t + frag + (label && C.fold(label) !== C.fold(t) ? "|" + label : "") + "]]";
    }).replace(/\u0004\d+\u0004/g, "");
    x = x.replace(/\u0002(\d+)\u0002([^\u0003]*)\u0003/g, function (m, n, j) {
      var a = ["", ""];
      try { a = JSON.parse(j); } catch (e) {}
      var id = (o.picIds || [])[Number(n)];
      return id ? io().mediaFile(id, str(a[0]), str(a[1]), o.lang) : escInline(str(a[0]));
    }).replace(/[\u0001-\u0005]/g, "");
    var cats = [], seen = {};
    (p.parent && pl.titleOf[p.parent] ? [pl.titleOf[p.parent]] : []).concat(p.cats).forEach(function (c) {
      var k = C.fold(c);
      if (k && !seen[k]) { seen[k] = 1; cats.push(c); }
    });
    if (cats.length) x = x.replace(/\s+$/, "") + (x.trim() ? "\n\n" : "") + cats.map(function (c) { return "[[" + (o.catWord || "Category") + ":" + c + "]]"; }).join("\n");
    return x.replace(/\r\n?/g, "\n").slice(0, C.MAX_TEXT);
  }
  // → { data, info, added: [art], updated: [{ art, prev }] } (data is a
  // new object; nothing is changed in place).
  // o: { now, sum, lang, catWord, picIds, newWiki: { id, n } | null, main }
  function apply(data, pl, res, o) {
    o = o || {};
    var out = { ver: 1, wikis: data.wikis.slice(), arts: data.arts.slice(), tombs: Object.assign({}, data.tombs) };
    var m = Math.max(Number(o.now) || Date.now(), 1), info = { wiki: "", added: [], updated: [], r: {} };
    var added = [], updated = [], pos = {};
    out.arts.forEach(function (a, i) { pos[a.id] = i; });
    pl.items.forEach(function (it) {
      if (it.act !== "add" && it.act !== "update") return;
      var t = C.cleanTitle(it.title), x = finalText(res, pl, it.page, o);
      var cur = it.act === "update" ? it.cur : null;
      var mm = Math.max(m++, (out.tombs[it.id] || 0) + 1, cur ? cur.m + 1 : 0);
      var art = C.normArt({
        id: it.id, m: mm, w: pl.wiki, t: t, x: x, r: importRev(it.sh, it.id, t, x, mm),
        anc: cur ? [cur.r].concat(cur.anc) : [], alt: [], s: o.sum || "", c: cur ? cur.c : (it.page.c && it.page.c < mm ? it.page.c : mm)
      });
      if (!art) return;
      info.r[art.id] = art.r;
      if (cur) {
        out.arts[pos[cur.id]] = art;
        updated.push({ art: art, prev: cur });
        info.updated.push(cur);
      } else {
        out.arts.push(art);
        added.push(art);
        info.added.push(art.id);
      }
    });
    if (o.newWiki && (added.length || updated.length)) {
      var mainItem = pl.items.filter(function (it) { return it.page.key === res.main && info.r[it.id]; })[0];
      out.wikis.push({ id: o.newWiki.id, m: m++, n: str(o.newWiki.n).replace(/\s+/g, " ").trim().slice(0, 80), main: mainItem ? mainItem.id : (added[0] ? added[0].id : "") });
      info.wiki = o.newWiki.id;
    }
    return { data: out, info: info, added: added, updated: updated };
  }
  // Undo an import: articles it added go (unless edited since), the
  // ones it updated get their earlier text back as a newer revision
  // (sync-safe: newer tombstones, descendants of the import revision).
  function undo(data, info, now) {
    var out = { ver: 1, wikis: data.wikis.slice(), arts: data.arts.slice(), tombs: Object.assign({}, data.tombs) };
    var m = Math.max(Number(now) || Date.now(), 1), gone = {}, back = [];
    var byId = {};
    out.arts.forEach(function (a) { byId[a.id] = a; });
    (info.added || []).forEach(function (id) {
      var cur = byId[id];
      if (!cur || cur.r !== info.r[id]) return;           // changed since: kept
      out.tombs[id] = Math.max(m, cur.m + 1);
      gone[id] = 1;
    });
    (info.updated || []).forEach(function (prev) {
      var cur = byId[prev.id];
      if (!cur || cur.r !== info.r[prev.id]) return;
      var mm = Math.max(m++, cur.m + 1);
      var sh = untouched(prev) ? prev.r.slice(1, 8) : "0000000";
      back.push(C.normArt({
        id: prev.id, m: mm, w: prev.w, t: prev.t, x: prev.x, r: importRev(sh, prev.id, prev.t, prev.x, mm),
        anc: [cur.r].concat(cur.anc), alt: [], s: prev.s || "", c: prev.c
      }));
    });
    var backIx = {};
    back.forEach(function (a) { if (a) backIx[a.id] = a; });
    out.arts = out.arts.filter(function (a) { return !gone[a.id]; }).map(function (a) { return backIx[a.id] || a; });
    if (info.wiki && !out.arts.some(function (a) { return a.w === info.wiki; })) {
      var w = out.wikis.filter(function (x) { return x.id === info.wiki; })[0];
      out.tombs[info.wiki] = Math.max(m, w ? w.m + 1 : 0);
      out.wikis = out.wikis.filter(function (x) { return x.id !== info.wiki; });
    }
    return out;
  }

  var API = {
    VERSION: VERSION, ACCEPT: ACCEPT, MAX_PAGES: MAX_PAGES,
    readBundle: readBundle, detect: detect, parse: parse, plan: plan, apply: apply, undo: undo,
    artId: artId, untouched: untouched, twText: twText, twDate: twDate, twFromHtml: twFromHtml,
    htmlTree: htmlTree, scanHtml: scanHtml, htmlToMarkup: htmlToMarkup, notionName: notionName
  };
  if (NODE) module.exports = API;
  if (root && root.document) root.OrosWikiImport = API;
})(typeof window !== "undefined" ? window : globalThis);
