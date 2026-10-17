// ============================================================
// orOS Bookmarks — pure logic (wave 35), loaded by bookmarks.js and
// by the Node tests (tests/bookmarks-core.test.js). No DOM, no
// storage, no network: everything here is a function of its input.
//
// window.OrosBookmarksCore (module.exports in Node):
//   Folder tree (folders = { id: { id, name, pos, parent?, modified } })
//     parentOf(folders, id)        effective parent ("" = top level):
//                                  missing parent, the root folder or a
//                                  cycle all count as top level (a cycle
//                                  breaks at its smallest id), so two
//                                  devices that nested A in B and B in A
//                                  at once see the same tree, and nothing
//                                  is rewritten to get there.
//     pathIds(folders, id)         [top, …, id]
//     childrenOf(folders, pid)     ids, by pos then id
//     isInside(folders, id, anc)   id is anc or below it
//     canMoveFolder(folders, id, np)
//     treeList(folders, skip?)     [{ id, depth }] depth first
//   Addresses
//     normUrl(raw)                 http(s) address or null
//     dupeKey(raw)                 one key for "the same page"
//     dupeGroups(items)            [[oldest, …], …]
//     mergeInto(keep, others)      the fields a merge gives the keeper
//   Link check
//     classify(askedUrl, answer)   { s: ok|dead|moved|err|skip, code?, to? }
//     sanChk, sanArch, sideMerge   the side records (merged by "at")
//   Import / export
//     decode(s), parseCsv(text)
//     parseNetscape(text), buildNetscape(tree)
//     parsePocketHtml(text), parseCsvImport(text)
//     parseImport(text, name)      -> { kind, entries[] }
//       entry = { url, title, path[], tags[], note, added (ms|0), fav }
//   Saved copy (archive) on the orOS disk
//     archiveName(item), archiveId(name), archiveDoc(rec), readArchive(text)
// ============================================================
(function (root) {
  "use strict";

  var ROOT = "unsorted";
  var RE_ID = /^[A-Za-z0-9_-]{1,64}$/;
  var MAX_DEPTH = 64;

  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function str(v) { return typeof v === "string" ? v : ""; }

  // ---------- Folder tree ----------
  function rawParent(folders, id) {
    var f = own(folders, id) ? folders[id] : null;
    var p = f && typeof f.parent === "string" ? f.parent : "";
    if (!p || p === id || p === ROOT || id === ROOT || !own(folders, p)) return "";
    return p;
  }

  function parentOf(folders, id) {
    var p = rawParent(folders, id);
    if (!p) return "";
    // walk up; a loop that comes back to id breaks at its smallest id
    var seen = [id], cur = p;
    for (var n = 0; cur && n < MAX_DEPTH; n++) {
      var at = seen.indexOf(cur);
      if (at >= 0) {
        var loop = seen.slice(at);
        if (at === 0) {
          var min = loop.slice().sort()[0];
          return min === id ? "" : p;
        }
        return p;                       // id only leads into a loop
      }
      seen.push(cur);
      cur = rawParent(folders, cur);
    }
    return n >= MAX_DEPTH ? "" : p;
  }

  function pathIds(folders, id) {
    if (!own(folders, id)) return [];
    var out = [id], cur = id;
    for (var n = 0; n < MAX_DEPTH; n++) {
      cur = parentOf(folders, cur);
      if (!cur || out.indexOf(cur) >= 0) break;
      out.unshift(cur);
    }
    return out;
  }

  function byPos(folders) {
    return function (a, b) {
      var pa = Number(folders[a].pos) || 0, pb = Number(folders[b].pos) || 0;
      return (pa - pb) || (a < b ? -1 : a > b ? 1 : 0);
    };
  }

  function childrenOf(folders, pid) {
    pid = pid || "";
    return Object.keys(folders || {}).filter(function (id) {
      return parentOf(folders, id) === pid;
    }).sort(byPos(folders));
  }

  function isInside(folders, id, anc) {
    return pathIds(folders, id).indexOf(anc) >= 0;
  }

  // A folder may go to the top level ("") or into any other folder
  // that is not itself, below itself, or the Unsorted folder.
  function canMoveFolder(folders, id, np) {
    if (!own(folders, id) || id === ROOT) return false;
    if (!np) return true;
    if (!own(folders, np) || np === ROOT || np === id) return false;
    return !isInside(folders, np, id);
  }

  // Depth-first order with depth; skip = an id whose branch is left out.
  function treeList(folders, skip) {
    var out = [];
    (function walk(pid, depth) {
      if (depth > MAX_DEPTH) return;
      childrenOf(folders, pid).forEach(function (id) {
        if (id === skip) return;
        out.push({ id: id, depth: depth });
        walk(id, depth + 1);
      });
    })("", 0);
    return out;
  }

  // ---------- Addresses ----------
  function normUrl(raw) {
    var u = String(raw == null ? "" : raw).trim();
    if (!u) return null;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) u = "https://" + u.replace(/^\/+/, "");
    try {
      var x = new URL(u);
      if (x.protocol !== "http:" && x.protocol !== "https:") return null;
      if (!x.hostname) return null;
      return x.href.replace(/\/$/, "");
    } catch (e) { return null; }
  }

  // Tracking parameters that never change the page.
  var TRACK = /^(utm_[a-z_]+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|yclid|_hsenc|_hsmi|mkt_tok|ref_src|oly_enc_id|oly_anon_id|vero_id|__s)$/i;

  // One rule for the quick-add guard, imports and the duplicate
  // finder: scheme, "www.", host case, default port, fragment,
  // trailing slashes and tracking parameters do not count; the rest
  // of the query does (sorted, so ?a=1&b=2 is ?b=2&a=1).
  function dupeKey(raw) {
    var u = String(raw == null ? "" : raw).trim();
    u = u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    u = u.replace(/#.*$/, "");
    var m = u.match(/^([^\/?#]*)([^?#]*)(\?[^#]*)?/) || ["", "", "", ""];
    var host = (m[1] || "").toLowerCase().replace(/^www\./, "").replace(/:(80|443)$/, "").replace(/\.$/, "");
    var path = (m[2] || "").replace(/\/+$/, "");
    var q = (m[3] || "").slice(1);
    var parts = q ? q.split("&").filter(function (p) {
      if (!p) return false;
      var k = p.split("=")[0];
      try { k = decodeURIComponent(k.replace(/\+/g, " ")); } catch (e) {}
      return !TRACK.test(k);
    }).sort() : [];
    return host + path + (parts.length ? "?" + parts.join("&") : "");
  }

  function idCmp(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }

  function dupeGroups(items) {
    var by = {};
    Object.keys(items || {}).sort().forEach(function (id) {
      var it = items[id];
      if (!it || typeof it.url !== "string") return;
      var k = dupeKey(it.url);
      (by[k] = by[k] || []).push(it);
    });
    return Object.keys(by).filter(function (k) { return by[k].length > 1; })
      .map(function (k) {
        return by[k].sort(function (a, b) { return ((a.added || 0) - (b.added || 0)) || idCmp(a, b); });
      })
      .sort(function (g1, g2) { return (g2.length - g1.length) || idCmp(g1[0], g2[0]); });
  }

  // What the oldest copy gains from the others: every tag (first seen
  // first, ≤ 12), every different description (joined), the star if
  // any copy had it, visits added, the latest visit, the newest check
  // and saved copy. Title, address and folder stay the keeper's.
  function mergeInto(keep, others) {
    var tags = (keep.tags || []).slice(), notes = [], seenNote = {};
    function addNote(n) {
      n = str(n).trim();
      if (n && !seenNote[n.toLowerCase()]) { seenNote[n.toLowerCase()] = 1; notes.push(n); }
    }
    addNote(keep.note);
    var out = { tags: null, note: "", fav: keep.fav === true, visits: keep.visits || 0,
                lastVisit: keep.lastVisit || 0, chk: keep.chk || null, arch: keep.arch || null };
    (others || []).forEach(function (o) {
      (o.tags || []).forEach(function (tg) {
        if (tags.length < 12 && tags.map(function (x) { return x.toLowerCase(); }).indexOf(String(tg).toLowerCase()) < 0) tags.push(tg);
      });
      addNote(o.note);
      if (o.fav === true) out.fav = true;
      out.visits += o.visits || 0;
      out.lastVisit = Math.max(out.lastVisit, o.lastVisit || 0);
      out.chk = sideMerge(out.chk, o.chk);
      if (o.arch && o.arch.f && !(out.arch && out.arch.f)) out.arch = o.arch;
    });
    out.tags = tags;
    out.note = notes.join("\n\n").slice(0, 1024);
    return out;
  }

  // ---------- Link check ----------
  // answer: what orosFeedsFetch.fetchFeeds gives for one address:
  // { status, finalUrl } or { err }.
  function classify(asked, a) {
    if (!a || typeof a !== "object") return { s: "err" };
    if (a.err) {
      var e = String(a.err);
      if (e === "type" || e === "too-big") return { s: "ok" };        // it answered
      if (e === "network") return { s: "dead", code: 0 };             // no such site / refused
      if (e === "host" || e === "url" || e === "port") return { s: "skip" };
      return { s: "err" };                                            // timeout, relay, budget…
    }
    var st = a.status | 0;
    if (st === 404 || st === 410) return { s: "dead", code: st };
    if (st >= 200 && st < 300 || st === 304) {
      var fin = str(a.finalUrl || a.url);
      if (fin && /^https?:\/\//i.test(fin) && dupeKey(fin) !== dupeKey(asked)) return { s: "moved", code: st, to: fin.slice(0, 2048) };
      return { s: "ok", code: st };
    }
    return { s: "err", code: st };                                    // 401/403/429/5xx: not proven dead
  }

  var CHK_S = { ok: 1, dead: 1, moved: 1, err: 1, skip: 1 };
  function ts(v) { return typeof v === "number" && isFinite(v) && v > 0 && v < 1e15 ? Math.floor(v) : 0; }

  function sanChk(c) {
    if (!c || typeof c !== "object" || !CHK_S[c.s] || !ts(c.at)) return null;
    var out = { s: c.s, at: ts(c.at) };
    var code = parseInt(c.code, 10);
    if (code >= 0 && code < 1000 && c.code !== undefined) out.code = code;
    if (c.s === "moved" && typeof c.to === "string" && /^https?:\/\/\S{1,2040}$/i.test(c.to)) out.to = c.to;
    if (c.s === "moved" && !out.to) out.s = "ok";
    return out;
  }

  // f = file name in /internal/Bookmarks/Archive ("" = the copy was
  // removed), n = characters of text, img = pictures kept inside.
  function sanArch(a) {
    if (!a || typeof a !== "object" || !ts(a.at)) return null;
    var f = typeof a.f === "string" && /^[A-Za-z0-9 ._()\[\]-]{1,120}\.html$/.test(a.f) && a.f.indexOf("..") < 0 ? a.f : "";
    var out = { at: ts(a.at), f: f };
    if (f) {
      var n = parseInt(a.n, 10);
      if (n > 0) out.n = Math.min(n, 1e8);
      if (a.img === 1) out.img = 1;
    }
    return out;
  }

  function canonJson(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canonJson(v[k]); }).join(",") + "}";
  }

  // Side records ride on a bookmark without moving its "modified":
  // the newer "at" wins on its own (equal: the larger canonical JSON),
  // so a link check on one device never undoes an edit on another.
  function sideMerge(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    if (a.at !== b.at) return a.at > b.at ? a : b;
    return canonJson(b) >= canonJson(a) ? b : a;
  }

  // ---------- Text helpers ----------
  var NAMED = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0", ndash: "\u2013",
                mdash: "\u2014", hellip: "\u2026", laquo: "\u00ab", raquo: "\u00bb", rsquo: "\u2019",
                lsquo: "\u2018", rdquo: "\u201d", ldquo: "\u201c", copy: "\u00a9", reg: "\u00ae", middot: "\u00b7" };
  function decode(s) {
    return String(s == null ? "" : s).replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,15});/g, function (m, e) {
      if (e.charAt(0) === "#") {
        var n = e.charAt(1) === "x" || e.charAt(1) === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        if (!(n > 0 && n <= 0x10ffff) || (n >= 0xd800 && n <= 0xdfff)) return "\ufffd";
        return String.fromCodePoint(n);
      }
      return own(NAMED, e) ? NAMED[e] : m;
    });
  }
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/\x22/g, "&quot;");
  }
  function stripTags(s) { return String(s || "").replace(/<[^>]*>/g, ""); }
  function oneLine(s) { return String(s || "").replace(/\s+/g, " ").trim(); }

  function attrOf(attrs, name) {
    var re = new RegExp("(?:^|\\s)" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i");
    var m = re.exec(attrs || "");
    return m ? decode(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]) : "";
  }

  function splitTags(s, sep) {
    var seen = {}, out = [];
    String(s || "").split(sep || /[,|]/).forEach(function (x) {
      x = oneLine(x).replace(/^#/, "").slice(0, 32);
      if (!x || seen[x.toLowerCase()]) return;
      seen[x.toLowerCase()] = 1;
      if (out.length < 12) out.push(x);
    });
    return out;
  }

  // seconds or milliseconds since 1970, or an ISO date -> ms (0 = none)
  function when(v) {
    var s = String(v == null ? "" : v).trim();
    if (!s) return 0;
    var t;
    if (/^\d{1,16}$/.test(s)) {
      t = Number(s);
      if (t < 1e11) t *= 1000;                   // seconds
      else if (t > 1e14) t /= 1000;              // microseconds (Firefox's dateAdded)
    } else t = Date.parse(s);
    if (!isFinite(t) || t < 315532800000 || t > 4102444800000) return 0;   // 1980..2100
    return Math.floor(t);
  }

  function entry(url, title, path, tags, note, added, fav) {
    return { url: String(url || "").trim(), title: oneLine(title).slice(0, 256), path: path || [],
             tags: tags || [], note: String(note || "").trim().slice(0, 1024), added: added || 0, fav: fav === true };
  }

  // ---------- Netscape bookmark file ----------
  // Token scan of the raw text (a DOM walk mangles the <DT><DL> soup).
  // Folders nest by <DL> depth; TAGS, ADD_DATE and the <DD> after a
  // link (its description) come along. Browsers, Raindrop, Pinboard
  // and Linkding all write this shape.
  function parseNetscape(text) {
    var out = [], stack = [], pending = null, last = null;
    var RE = /<dl\b[^>]*>|<\/dl\s*>|<h3\b[^>]*>([\s\S]*?)<\/h3\s*>|<a\b([^>]*)>([\s\S]*?)<\/a\s*>|<dd\b[^>]*>([\s\S]*?)(?=<dt\b|<\/?dl\b|<dd\b|<h3\b|$)/gi;
    var m;
    text = String(text || "");
    while ((m = RE.exec(text))) {
      var tok = m[0];
      if (/^<dl\b/i.test(tok)) { stack.push(pending); pending = null; last = null; }
      else if (/^<\/dl/i.test(tok)) { stack.pop(); last = null; }
      else if (m[1] !== undefined) { pending = oneLine(decode(stripTags(m[1]))).slice(0, 64) || null; last = null; }
      else if (m[2] !== undefined) {
        var attrs = m[2], href = attrOf(attrs, "href");
        if (!href) { last = null; continue; }
        var fav = /^(1|true|yes)$/i.test(attrOf(attrs, "data-important") || attrOf(attrs, "data-fav"));
        last = entry(href, decode(stripTags(m[3])), stack.filter(Boolean),
          splitTags(attrOf(attrs, "tags"), /,/), "", when(attrOf(attrs, "add_date")), fav);
        out.push(last);
      } else if (m[4] !== undefined) {
        if (last && !last.note) {
          last.note = decode(stripTags(m[4].replace(/<br\s*\/?>/gi, "\n"))).replace(/[ \t]+/g, " ")
            .replace(/\s*\n\s*/g, "\n").trim().slice(0, 1024);
        }
        last = null;
      }
    }
    return out;
  }

  // tree: { name, items[{url,title,tags,note,added,modified}], folders[tree] }
  // Items of the top node sit at the top of the file (Unsorted).
  function buildNetscape(tree) {
    var L = [
      "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
      "<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->",
      "<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=UTF-8\">",
      "<TITLE>Bookmarks</TITLE>",
      "<H1>Bookmarks</H1>",
      "<DL><p>"
    ];
    var n = 0;
    function secs(v) { return Math.floor((Number(v) || 0) / 1000); }
    function items(list, ind) {
      list.forEach(function (it) {
        var a = ind + "<DT><A HREF=\"" + escHtml(it.url) + "\" ADD_DATE=\"" + secs(it.added) + "\"";
        if (it.modified) a += " LAST_MODIFIED=\"" + secs(it.modified) + "\"";
        var tags = (it.tags || []).map(function (tg) { return oneLine(String(tg).replace(/,/g, " ")); }).filter(Boolean);
        if (tags.length) a += " TAGS=\"" + escHtml(tags.join(",")) + "\"";
        a += ">" + escHtml(it.title || it.url) + "</A>";
        L.push(a);
        if (it.note) L.push(ind + "<DD>" + escHtml(it.note).replace(/\r?\n/g, "<br>"));
        n++;
      });
    }
    function folder(f, ind) {
      L.push(ind + "<DT><H3" + (f.added ? " ADD_DATE=\"" + secs(f.added) + "\"" : "") + ">" + escHtml(f.name) + "</H3>");
      L.push(ind + "<DL><p>");
      (f.folders || []).forEach(function (c) { folder(c, ind + "    "); });
      items(f.items || [], ind + "    ");
      L.push(ind + "</DL><p>");
    }
    (tree.folders || []).forEach(function (c) { folder(c, "    "); });
    items(tree.items || [], "    ");
    L.push("</DL><p>");
    return { text: L.join("\n") + "\n", count: n };
  }

  // ---------- Pocket's HTML export ----------
  // <h1>Unread</h1><ul><li><a href time_added tags>…</a></li></ul>
  // <h1>Read Archive</h1><ul>…</ul>   -> folder Pocket, archive below it
  function parsePocketHtml(text, names) {
    names = names || {};
    var top = names.pocket || "Pocket", arch = names.archive || "Archive";
    var out = [], section = "", m;
    var RE = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>|<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
    text = String(text || "");
    while ((m = RE.exec(text))) {
      if (m[1] !== undefined) { section = oneLine(decode(stripTags(m[1]))); continue; }
      var href = attrOf(m[2], "href");
      if (!href) continue;
      var archived = /archive/i.test(section);
      out.push(entry(href, decode(stripTags(m[3])), archived ? [top, arch] : [top],
        splitTags(attrOf(m[2], "tags"), /[,|]/), "", when(attrOf(m[2], "time_added")), false));
    }
    return out;
  }

  // ---------- CSV ----------
  // RFC 4180: quotes, doubled quotes, commas and newlines inside quotes.
  function parseCsv(text) {
    text = String(text || "").replace(/^\ufeff/, "");
    var rows = [], row = [], cell = "", q = false, i = 0, c;
    for (; i < text.length; i++) {
      c = text.charAt(i);
      if (q) {
        if (c === "\"") {
          if (text.charAt(i + 1) === "\"") { cell += "\""; i++; } else q = false;
        } else cell += c;
      } else if (c === "\"") q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text.charAt(i + 1) === "\n") i++;
        row.push(cell); cell = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell);
    if (row.length > 1 || row[0] !== "") rows.push(row);
    return rows;
  }

  // Pocket CSV:   title,url,time_added,tags,status   (tags split by |)
  // Raindrop CSV: id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite
  // Others: any CSV with a url / link / href column.
  function parseCsvImport(text, names) {
    names = names || {};
    var rows = parseCsv(text);
    if (rows.length < 2) return { kind: "", entries: [] };
    var head = rows[0].map(function (h) { return oneLine(h).toLowerCase(); });
    function col() {
      for (var i = 0; i < arguments.length; i++) { var k = head.indexOf(arguments[i]); if (k >= 0) return k; }
      return -1;
    }
    var cu = col("url", "link", "href", "address"), ct = col("title", "name"), cn = col("note", "description", "notes", "comment"),
        ce = col("excerpt"), cf = col("folder", "collection", "path"), cg = col("tags", "tag", "labels"),
        cd = col("created", "time_added", "added", "date_added", "add_date", "date"), cs = col("status"),
        cv = col("favorite", "favourite", "important", "starred");
    if (cu < 0) return { kind: "", entries: [] };
    var kind = col("time_added") >= 0 && cs >= 0 ? "pocket" : (col("excerpt") >= 0 && col("highlights") >= 0 ? "raindrop" : "csv");
    var top = names.pocket || "Pocket", arch = names.archive || "Archive";
    var out = [];
    rows.slice(1).forEach(function (r) {
      function v(k) { return k >= 0 && k < r.length ? r[k] : ""; }
      var url = v(cu).trim();
      if (!url) return;
      var path = [];
      if (kind === "pocket") path = /archive/i.test(v(cs)) ? [top, arch] : [top];
      else if (cf >= 0) {
        path = v(cf).split("/").map(oneLine).filter(Boolean).map(function (x) { return x.slice(0, 64); });
        if (path.length === 1 && /^unsorted$/i.test(path[0])) path = [];
      }
      var note = v(cn).trim() || (ce >= 0 ? v(ce).trim() : "");
      out.push(entry(url, v(ct), path, splitTags(v(cg), kind === "pocket" ? /[|,]/ : /[,|]/), note,
        when(v(cd)), /^(1|true|yes)$/i.test(v(cv).trim())));
    });
    return { kind: kind, entries: out };
  }

  function parseImport(text, name, names) {
    text = String(text || "");
    var lower = text.slice(0, 4000).toLowerCase();
    var isHtml = /^\s*(<!doctype|<html|<meta|<title|<h1|<dl|<!--)/i.test(text) || /\.html?$/i.test(name || "");
    if (!isHtml && (/\.csv$/i.test(name || "") || /^[^<\n]*,[^<\n]*(url|link|href)/i.test(text.slice(0, 500)))) {
      return parseCsvImport(text, names);
    }
    if (/<title>\s*pocket export/i.test(lower) || (/time_added=/i.test(lower) && !/<dl\b/i.test(lower))) {
      return { kind: "pocket", entries: parsePocketHtml(text, names) };
    }
    var nets = parseNetscape(text);
    if (nets.length) return { kind: /raindrop/i.test(lower) ? "raindrop" : "netscape", entries: nets };
    return { kind: "", entries: [] };
  }

  // ---------- Saved copy (archive) ----------
  function slug(s) {
    var x = String(s || "").normalize ? String(s || "").normalize("NFKD") : String(s || "");
    x = x.replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
    return x || "page";
  }
  function archiveName(it) { return slug(it.title || "") + " [" + it.id + "].html"; }
  function archiveId(name) {
    var m = /\[([A-Za-z0-9_-]{1,64})\]\.html$/.exec(String(name || ""));
    return m ? m[1] : "";
  }

  // rec = { id, url, title, at, html (already sanitised), img }
  // A plain page that also reads well when opened from Files; the
  // marks around the article let Bookmarks find it again.
  function archiveDoc(rec) {
    var E = escHtml;
    var d = new Date(rec.at || 0).toISOString();
    return "<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\">" +
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:" + (rec.img ? " https: http:" : "") + "\">" +
      "<meta name=\"referrer\" content=\"no-referrer\">" +
      "<meta name=\"oros-bookmark\" content=\"" + E(rec.id) + "\">" +
      "<meta name=\"oros-source\" content=\"" + E(rec.url) + "\">" +
      "<meta name=\"oros-saved\" content=\"" + E(d) + "\">" +
      "<title>" + E(rec.title || rec.url) + "</title>" +
      "<style>body{max-width:720px;margin:0 auto;padding:16px;font:17px/1.6 Georgia,serif}img{max-width:100%;height:auto}</style>" +
      "</head><body>\n<header><h1>" + E(rec.title || rec.url) + "</h1><p><a href=\"" + E(rec.url) + "\">" + E(rec.url) + "</a></p></header>\n" +
      "<!--oros-article-->\n<article>" + String(rec.html || "") + "</article>\n<!--/oros-article-->\n</body></html>\n";
  }

  function readArchive(text) {
    text = String(text || "");
    var a = text.indexOf("<!--oros-article-->"), b = text.lastIndexOf("<!--/oros-article-->");
    if (a < 0 || b < a) return null;
    var body = text.slice(a + 19, b).trim().replace(/^<article>/i, "").replace(/<\/article>$/i, "");
    function meta(n) {
      var m = new RegExp("<meta name=\"" + n + "\" content=\"([^\"]*)\">").exec(text.slice(0, a));
      return m ? decode(m[1]) : "";
    }
    var t = /<title>([\s\S]*?)<\/title>/i.exec(text.slice(0, a));
    var url = meta("oros-source");
    return { id: meta("oros-bookmark"), url: /^https?:\/\//i.test(url) ? url : "",
             at: Date.parse(meta("oros-saved")) || 0, title: t ? decode(t[1]) : "", html: body };
  }

  var api = {
    ROOT: ROOT, RE_ID: RE_ID,
    parentOf: parentOf, pathIds: pathIds, childrenOf: childrenOf, isInside: isInside,
    canMoveFolder: canMoveFolder, treeList: treeList,
    normUrl: normUrl, dupeKey: dupeKey, dupeGroups: dupeGroups, mergeInto: mergeInto,
    classify: classify, sanChk: sanChk, sanArch: sanArch, sideMerge: sideMerge, canonJson: canonJson,
    decode: decode, escHtml: escHtml, parseCsv: parseCsv, splitTags: splitTags, when: when,
    parseNetscape: parseNetscape, buildNetscape: buildNetscape, parsePocketHtml: parsePocketHtml,
    parseCsvImport: parseCsvImport, parseImport: parseImport,
    archiveName: archiveName, archiveId: archiveId, archiveDoc: archiveDoc, readArchive: readArchive
  };
  root.OrosBookmarksCore = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
