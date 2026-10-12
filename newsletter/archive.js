// ============================================================
// orOS Newsletter — past issues from other services (v1.0.0)
// Reads what Buttondown, MailerLite and similar services export and
// turns it into issues (Markdown), never running anything in it:
//   - .md / .markdown / .txt, with or without a front matter block
//     (subject | title, date | publish_date | sent_at …); HTML inside
//     the body is converted too (Buttondown keeps some)
//   - .html / .htm: one campaign per file (MailerLite "download HTML",
//     saved e-mails); subject from <title> or the first heading
//   - .csv with a subject column and a body column (html, body,
//     content, text, markdown); rows without a body are skipped
//   - .json: an array of { subject, body | html | content, date }
// HTML → Markdown is a small tag reader: headings, paragraphs, line
// breaks, lists, rules, links, https pictures, bold and italic; the
// rest becomes plain text. Scripts, styles and comments are dropped.
// Pure, no DOM: window.OrosNewsletterArchive; module.exports in Node.
// ============================================================
(function (root) {
  "use strict";
  var C = root.OrosNewsletterCore || (typeof require === "function" ? require("./core.js") : null);

  var MAX_FILE = 5 * 1024 * 1024;     // characters per file
  var ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
              laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", copy: "©", reg: "®", euro: "€",
              middot: "·", bull: "•", trade: "™", zwnj: "", zwj: "", shy: "" };
  function entities(s) {
    return String(s || "").replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z]{2,8});/g, function (m, e) {
      if (e[0] === "#") {
        var n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000) ? String.fromCodePoint(n) : "";
      }
      return ENT[e] !== undefined ? ENT[e] : (ENT[e.toLowerCase()] !== undefined ? ENT[e.toLowerCase()] : m);
    });
  }
  function attr(tag, name) {
    var m = new RegExp("\\s" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i").exec(tag);
    return m ? entities(m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3])).trim() : "";
  }
  function squash(s) { return s.replace(/[ \t\f\v\u00a0]+/g, " "); }

  // ---------- HTML → Markdown ----------
  // keep: the text is Markdown with some HTML in it (keep its lines)
  function htmlToMd(html, keep) {
    var s = String(html || "").slice(0, MAX_FILE);
    s = s.replace(/<!--[\s\S]*?-->/g, "")
         .replace(/<(script|style|head|noscript|template|svg|object|iframe|title)\b[\s\S]*?<\/\1\s*>/gi, "")
         .replace(/<(script|style|head|noscript|template|svg|object|iframe)\b[^>]*>/gi, "");
    var out = "", link = null, linkText = "", inPre = false;
    var re = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|([^<]+)|</g, m;
    function put(t) { if (link) linkText += t; else out += t; }
    function br(n) { if (link) { linkText += " "; return; } out += n === 2 ? "\n\n" : "\n"; }
    while ((m = re.exec(s))) {
      if (m[2] !== undefined) { put(inPre || keep ? entities(m[2]) : squash(entities(m[2]).replace(/[\r\n]+/g, " "))); continue; }
      if (m[1] === undefined) { put("<"); continue; }
      var tag = m[0], name = m[1].toLowerCase(), close = tag[1] === "/";
      switch (name) {
        case "h1": case "h2": case "h3":
          if (!close) { br(2); put("## "); } else br(2); break;
        case "h4": case "h5": case "h6":
          if (!close) { br(2); put("**"); } else { put("**"); br(2); } break;
        case "p": case "div": case "section": case "article": case "table": case "tr": case "blockquote":
        case "header": case "footer": case "ul": case "ol": case "center": case "figure":
          br(2); break;
        case "td": case "th": if (close) put(" "); break;
        case "br": br(1); break;
        case "li": if (!close) { br(1); put("- "); } break;
        case "hr": br(2); put("---"); br(2); break;
        case "pre": inPre = !close; br(2); break;
        case "strong": case "b": put("**"); break;
        case "em": case "i": put("*"); break;
        case "a":
          if (!close) { link = C.safeUrl(attr(tag, "href")) || null; linkText = ""; }
          else if (link !== null) {
            var tx = linkText.replace(/\s+/g, " ").trim(), u = link;
            link = null;
            if (tx) out += "[" + tx.replace(/[\[\]]/g, "") + "](" + u.replace(/\)/g, "%29") + ")";
          }
          break;
        case "img": {
          var src = C.safeUrl(attr(tag, "src")), w = Number(attr(tag, "width")) || 0;
          if (/^https:\/\/[^)\s]+$/.test(src) && !(w && w < 40) && !/(pixel|track|open)\.(gif|png)|\/o\.gif|spacer/i.test(src)) {
            var alt = attr(tag, "alt").replace(/[\[\]\n]/g, "").slice(0, 200);
            var keep = link;
            link = null;
            out += "\n\n![" + alt + "](" + src + ")\n\n";
            link = keep;
          }
          break;
        }
        default: break;
      }
    }
    return tidy(out);
  }
  function tidy(md) {
    return String(md || "").split("\n").map(function (l) { return l.replace(/^[ \t]+|[ \t]+$/g, ""); })
      .join("\n").replace(/\*\*\s*\*\*/g, "").replace(/(^|\n)(## |- )\s*(?=\n|$)/g, "$1")
      .replace(/\n{3,}/g, "\n\n").trim().slice(0, C.LIM.md);
  }
  function looksHtml(s) { return /<(p|div|h[1-6]|br|img|a|table|ul|ol|strong|em)\b[^>]*>/i.test(s); }

  // ---------- dates ----------
  function date(v) {
    if (v === null || v === undefined || v === "") return 0;
    if (typeof v === "number") return v > 1e11 ? v : v * 1000;
    var s = String(v).trim().replace(/^["']|["']$/g, "");
    var t = Date.parse(s);
    if (!isFinite(t)) { var m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
      if (m) t = new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 9), +(m[5] || 0)).getTime(); }
    return isFinite(t) && t > 0 && t < 4102444800000 ? t : 0;
  }

  // ---------- per format ----------
  var SUBJ = ["subject", "title", "name", "θέμα", "τίτλος"];
  var BODY = ["markdown", "body", "html", "content", "text", "html_content", "content_html", "plain_text"];
  var DATE = ["publish_date", "sent_at", "send_time", "date", "published", "published_at", "creation_date", "created", "created_at", "ημερομηνία"];
  function pick(o, keys) {
    var low = {};
    Object.keys(o).forEach(function (k) { low[String(k).toLowerCase().trim().replace(/[\s-]+/g, "_")] = o[k]; });
    for (var i = 0; i < keys.length; i++) if (low[keys[i]] !== undefined && low[keys[i]] !== null && String(low[keys[i]]).trim()) return low[keys[i]];
    return "";
  }
  function item(subj, d, body) {
    body = String(body || "");
    var md = looksHtml(body) ? htmlToMd(body, !/^\s*</.test(body)) : tidy(body);
    subj = C.oneLine(subj, C.LIM.subj);
    if (!md && !subj) return null;
    return { subj: subj, date: date(d), md: md };
  }
  function fromMarkdown(name, text) {
    var fm = {}, body = String(text || "").replace(/^\ufeff/, "");
    var m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body);
    if (m) {
      m[1].split(/\r?\n/).forEach(function (l) {
        var kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(l);
        if (kv) fm[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, "");
      });
      body = body.slice(m[0].length);
    }
    var subj = pick(fm, SUBJ);
    if (!subj) {
      var h = /^\s*#{1,3}\s+(.+)$/m.exec(body);
      subj = h ? h[1] : String(name || "").replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
    }
    return [item(subj, pick(fm, DATE), body)].filter(Boolean);
  }
  function fromHtml(name, text) {
    var s = String(text || "");
    var t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(s), h = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/i.exec(s);
    var strip = function (x) { return entities(String(x || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(); };
    var subj = strip(t && t[1]) || strip(h && h[1]) || String(name || "").replace(/\.[^.]+$/, "");
    var meta = /<meta[^>]+(?:name|property)=["'](?:date|article:published_time|dc\.date)["'][^>]*>/i.exec(s);
    var b = /<body[^>]*>([\s\S]*)<\/body>/i.exec(s);
    return [item(subj, meta ? attr(meta[0], "content") : "", b ? b[1] : s)].filter(Boolean);
  }
  function fromRows(rows) {
    return rows.map(function (o) {
      var body = pick(o, BODY);
      if (!String(body).trim()) return null;
      return item(pick(o, SUBJ), pick(o, DATE), body);
    }).filter(Boolean);
  }
  function fromCsv(text) {
    var rows = C.parseCsv(text);
    if (rows.length < 2) return [];
    var head = rows[0];
    return fromRows(rows.slice(1).map(function (r) {
      var o = {};
      head.forEach(function (k, i) { o[k] = r[i]; });
      return o;
    }));
  }
  function fromJson(text) {
    var j = null;
    try { j = JSON.parse(text); } catch (e) { return []; }
    if (j && !Array.isArray(j)) j = j.results || j.emails || j.campaigns || j.data || null;
    return Array.isArray(j) ? fromRows(j.filter(function (o) { return o && typeof o === "object"; })) : [];
  }
  var EXT = /\.(md|markdown|txt|html?|csv|json)$/i;
  function supported(name) { return EXT.test(String(name || "")) && !/(^|\/)(__MACOSX|\.)/.test(String(name)); }
  // One file → [{ subj, date, md }]
  function parseFile(name, text) {
    var n = String(name || "").toLowerCase();
    text = String(text || "").slice(0, MAX_FILE);
    if (/\.html?$/.test(n)) return fromHtml(name, text);
    if (/\.csv$/.test(n)) return fromCsv(text);
    if (/\.json$/.test(n)) return fromJson(text);
    if (/\.(md|markdown|txt)$/.test(n)) return fromMarkdown(name, text);
    return [];
  }
  // Items → issues for a list: "archive" (already sent elsewhere,
  // kept for the record and the web page) or "draft". The id comes
  // from the subject and date, so importing twice adds nothing.
  function toIssues(items, listId, mode, now) {
    var seen = {};
    return items.map(function (it) {
      var id = "i" + C.hash53("imp|" + it.subj + "|" + it.date + "|" + it.md.length);
      if (seen[id]) return null;
      seen[id] = 1;
      var done = it.date || now;
      return C.normIssue(mode === "draft"
        ? { id: id, m: 0, list: listId, subj: it.subj, fmt: "md", md: it.md, st: "draft" }
        : { id: id, m: 0, list: listId, subj: it.subj, fmt: "md", md: it.md, st: "sent", start: done, done: done, n: 0, imp: 1 });
    }).filter(Boolean);
  }

  var api = { htmlToMd: htmlToMd, parseFile: parseFile, supported: supported, toIssues: toIssues, date: date };
  root.OrosNewsletterArchive = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
