// ============================================================
// orOS Mail — MIME toolkit (pure, no DOM)
// Decodes what the relay hands over (base64 of raw bytes) into
// text: header unfolding, RFC 2047 encoded words, RFC 2231
// parameters, quoted-printable / base64 bodies, charsets
// (TextDecoder: UTF-8, ISO-8859-7, Windows-1253, …), multipart
// trees, addresses, dates, modified UTF-7 folder names, and the
// link splitter used for plain-text bodies.
// Byte data is carried as "binary strings" (one char = one byte).
// Exposed as window.orosMailMime; module.exports in Node (tests).
// ============================================================
(function (root) {
  "use strict";

  // ---------- bytes ----------
  function b64ToBin(s) {
    try { return atob(String(s || "").replace(/[^A-Za-z0-9+/=]/g, "")); }
    catch (e) {
      // tolerate a truncated tail: drop the incomplete quantum
      var t = String(s || "").replace(/[^A-Za-z0-9+/]/g, "");
      t = t.slice(0, t.length - (t.length % 4));
      try { return atob(t); } catch (e2) { return ""; }
    }
  }
  function binToBytes(s) {
    var u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
    return u;
  }
  function binToB64(s) { return btoa(s); }

  var CHARSET_ALIASES = {
    "utf8": "utf-8", "unicode-1-1-utf-8": "utf-8",
    "iso8859-7": "iso-8859-7", "greek": "iso-8859-7", "elot_928": "iso-8859-7",
    "cp1253": "windows-1253", "win-1253": "windows-1253", "x-mac-greek": "x-mac-cyrillic"
  };
  function decodeCharset(bin, charset) {
    var cs = String(charset || "utf-8").trim().toLowerCase().replace(/^"|"$/g, "");
    if (cs === "us-ascii" || cs === "ascii") return decodeRaw(bin);   // undeclared 8-bit: UTF-8 when valid
    cs = CHARSET_ALIASES[cs] || cs;
    if (cs === "x-mac-cyrillic" && charset && /greek/i.test(charset)) cs = "windows-1253";
    var bytes = binToBytes(bin);
    try { return new TextDecoder(cs).decode(bytes); }
    catch (e) {
      try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch (e2) { return new TextDecoder("windows-1252").decode(bytes); }
    }
  }
  // Raw 8-bit header text (no charset declared): UTF-8 when valid.
  function decodeRaw(bin) {
    if (!/[\x80-\xff]/.test(bin)) return bin;
    try { return new TextDecoder("utf-8", { fatal: true }).decode(binToBytes(bin)); }
    catch (e) { return new TextDecoder("windows-1252").decode(binToBytes(bin)); }
  }

  // ---------- transfer encodings ----------
  function qpDecode(s, header) {
    if (header) s = s.replace(/_/g, " ");
    return s.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, function (m, h) {
      return String.fromCharCode(parseInt(h, 16));
    });
  }
  function decodeTransfer(bin, cte) {
    cte = String(cte || "").trim().toLowerCase();
    if (cte === "base64") return b64ToBin(bin);
    if (cte === "quoted-printable") return qpDecode(bin, false);
    return bin;
  }

  // ---------- RFC 2047 ----------
  var EW = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;
  function decodeWords(bin) {
    bin = String(bin || "");
    var out = "", last = 0, m, pend = null;   // pend: {cs, bytes}
    function flush() {
      if (pend) { out += decodeCharset(pend.bytes, pend.cs); pend = null; }
    }
    EW.lastIndex = 0;
    while ((m = EW.exec(bin)) !== null) {
      var gap = bin.slice(last, m.index);
      var cs = m[1].split("*")[0];
      var bytes = /b/i.test(m[2]) ? b64ToBin(m[3]) : qpDecode(m[3], true);
      if (pend && /^\s*$/.test(gap)) {
        // whitespace between two encoded words is not text (RFC 2047 §6.2);
        // same charset: join the bytes (a character may be split)
        if (pend.cs.toLowerCase() === cs.toLowerCase()) pend.bytes += bytes;
        else { flush(); pend = { cs: cs, bytes: bytes }; }
      } else {
        flush();
        out += decodeRaw(gap);
        pend = { cs: cs, bytes: bytes };
      }
      last = EW.lastIndex;
    }
    flush();
    return out + decodeRaw(bin.slice(last));
  }

  // ---------- headers ----------
  function splitHead(bin) {
    var m = /\r?\n\r?\n/.exec(bin);
    if (!m) return { head: bin, body: "" };
    return { head: bin.slice(0, m.index), body: bin.slice(m.index + m[0].length) };
  }
  function parseHeaders(head) {
    var map = {};
    String(head || "").replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/).forEach(function (line) {
      var i = line.indexOf(":");
      if (i <= 0) return;
      var k = line.slice(0, i).trim().toLowerCase();
      if (!/^[\x21-\x7e]+$/.test(k)) return;
      (map[k] = map[k] || []).push(line.slice(i + 1).trim());
    });
    return map;
  }
  function h1(map, k) { return map[k] ? map[k][0] : ""; }

  // "text/plain; charset=utf-8; name*=utf-8''%CE%91" (RFC 2045 + 2231)
  function parseParams(v) {
    v = String(v || "");
    var parts = [], cur = "", q = false;
    for (var i = 0; i < v.length; i++) {
      var c = v[i];
      if (c === "\"" && v[i - 1] !== "\\") q = !q;
      if (c === ";" && !q) { parts.push(cur); cur = ""; } else cur += c;
    }
    parts.push(cur);
    var res = { value: parts.shift().trim().toLowerCase(), params: {} };
    var cont = {};
    parts.forEach(function (p) {
      var j = p.indexOf("=");
      if (j < 0) return;
      var k = p.slice(0, j).trim().toLowerCase();
      var val = p.slice(j + 1).trim();
      if (val[0] === "\"") val = val.slice(1, val.lastIndexOf("\"") > 0 ? val.lastIndexOf("\"") : undefined).replace(/\\(.)/g, "$1");
      var m = /^([^*]+)(?:\*(\d+))?(\*)?$/.exec(k);
      if (!m) return;
      if (m[2] !== undefined || m[3]) {
        (cont[m[1]] = cont[m[1]] || []).push({ n: m[2] === undefined ? 0 : +m[2], v: val, enc: !!m[3] });
      } else if (res.params[m[1]] === undefined) {
        res.params[m[1]] = decodeWords(val);
      }
    });
    Object.keys(cont).forEach(function (k) {
      var segs = cont[k].sort(function (a, b) { return a.n - b.n; });
      var cs = "utf-8", bin = "";
      segs.forEach(function (s, idx) {
        var v2 = s.v;
        if (s.enc) {
          if (idx === 0) {
            var mm = /^([^']*)'[^']*'([\s\S]*)$/.exec(v2);
            if (mm) { cs = mm[1] || cs; v2 = mm[2]; }
          }
          v2 = v2.replace(/%([0-9A-Fa-f]{2})/g, function (x, hh) { return String.fromCharCode(parseInt(hh, 16)); });
        }
        bin += v2;
      });
      res.params[k] = decodeCharset(bin, cs);
    });
    return res;
  }

  // ---------- addresses ----------
  // Works on the DECODED header text.
  function parseAddresses(s) {
    s = String(s || "");
    var out = [], cur = "", q = false, ang = 0, par = 0;
    function push() {
      var t = cur.trim();
      cur = "";
      if (!t) return;
      t = t.replace(/^[^:<"]*:\s*/, function (g) { return /@/.test(g) ? g : ""; }); // group name
      t = t.replace(/;\s*$/, "");
      var m = /^(.*)<([^<>]*)>\s*$/.exec(t);
      var name = "", addr = "";
      if (m) { name = m[1]; addr = m[2]; }
      else {
        var c = /\(([^()]*)\)/.exec(t);
        addr = t.replace(/\([^()]*\)/g, "");
        name = c ? c[1] : "";
      }
      name = name.trim().replace(/^"([\s\S]*)"$/, "$1").replace(/\\(.)/g, "$1").trim();
      addr = addr.trim().replace(/^mailto:/i, "");
      if (!addr && !name) return;
      out.push({ name: name, addr: addr });
    }
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === "\"" && s[i - 1] !== "\\") q = !q;
      else if (!q && c === "<") ang++;
      else if (!q && c === ">") ang = Math.max(0, ang - 1);
      else if (!q && c === "(") par++;
      else if (!q && c === ")") par = Math.max(0, par - 1);
      if (c === "," && !q && !ang && !par) { push(); continue; }
      cur += c;
    }
    push();
    return out;
  }

  // ---------- dates ----------
  var MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  var ZONES = { ut: 0, utc: 0, gmt: 0, z: 0, est: -300, edt: -240, cst: -360, cdt: -300,
                mst: -420, mdt: -360, pst: -480, pdt: -420 };
  // RFC 5322 date or IMAP INTERNALDATE ("06-Oct-2026 23:15:50 +0000") → ms, 0 if unknown.
  function parseDate(s) {
    s = String(s || "").replace(/\([^)]*\)/g, " ").trim();
    var m = /(\d{1,2})[\s-]+([A-Za-z]{3})[a-z]*[\s-]+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|[A-Za-z]{1,4})?/.exec(s);
    if (!m) return 0;
    var mon = MON[m[2].toLowerCase()];
    if (mon === undefined) return 0;
    var y = +m[3];
    if (y < 100) y += y < 50 ? 2000 : 1900;
    var off = 0, z = m[7];
    if (z && /^[+-]\d{4}$/.test(z)) off = (z[0] === "-" ? -1 : 1) * (+z.slice(1, 3) * 60 + +z.slice(3, 5));
    else if (z && ZONES[z.toLowerCase()] !== undefined) off = ZONES[z.toLowerCase()];
    var t = Date.UTC(y, mon, +m[1], +m[4], +m[5], +(m[6] || 0)) - off * 60000;
    return isFinite(t) ? t : 0;
  }

  // ---------- header summary (list rows) ----------
  function summary(hdrBin) {
    var hm = parseHeaders(splitHead(hdrBin).head);
    function addrs(k) { return parseAddresses(decodeWords(h1(hm, k))); }
    var ct = parseParams(h1(hm, "content-type") || "text/plain");
    return {
      from: addrs("from")[0] || { name: "", addr: "" },
      to: addrs("to"),
      cc: addrs("cc"),
      replyTo: addrs("reply-to"),
      subject: decodeWords(h1(hm, "subject")).replace(/\s+/g, " ").trim(),
      date: parseDate(h1(hm, "date")),
      messageId: h1(hm, "message-id").trim(),
      inReplyTo: h1(hm, "in-reply-to").trim(),
      att: ct.value === "multipart/mixed" ||
           (ct.value.indexOf("multipart/") !== 0 && ct.value.indexOf("text/") !== 0)
    };
  }

  // ---------- message tree ----------
  var MAX_DEPTH = 12;
  function parsePart(bin, depth, path) {
    var hb = splitHead(bin);
    var hm = parseHeaders(hb.head);
    var ct = parseParams(h1(hm, "content-type") || "text/plain; charset=us-ascii");
    if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(ct.value)) ct.value = "text/plain";
    var cd = parseParams(h1(hm, "content-disposition"));
    var node = {
      path: path,
      headers: hm,
      type: ct.value,
      params: ct.params,
      disposition: cd.value || "",
      filename: cd.params.filename || ct.params.name || "",
      cid: h1(hm, "content-id").replace(/^\s*<|>\s*$/g, "").trim(),
      parts: [],
      body: ""
    };
    if (node.type.indexOf("multipart/") === 0 && ct.params.boundary && depth < MAX_DEPTH) {
      var b = "--" + ct.params.boundary;
      var chunks = hb.body.split(b);
      // chunks[0] = preamble; the last one starts with "--" (epilogue)
      for (var i = 1; i < chunks.length; i++) {
        var c = chunks[i];
        if (c.slice(0, 2) === "--") break;
        c = c.replace(/^[ \t]*\r?\n/, "").replace(/\r?\n$/, "");
        node.parts.push(parsePart(c, depth + 1, path + "." + node.parts.length));
      }
      if (!node.parts.length) { node.type = "text/plain"; node.body = hb.body; }
      return node;
    }
    if (node.type.indexOf("multipart/") === 0) node.type = "text/plain";   // no boundary / too deep
    node.body = decodeTransfer(hb.body, h1(hm, "content-transfer-encoding"));
    return node;
  }

  function parseMessage(bin) {
    var root = parsePart(String(bin || ""), 0, "1");
    var res = { headers: root.headers, html: null, text: null, attachments: [], cids: {}, ics: [] };
    var seq = 0;

    function asText(n) { return decodeCharset(n.body, n.params.charset || "utf-8").replace(/\r\n?/g, "\n"); }
    function isAttachment(n) {
      if (n.disposition === "attachment") return true;
      if (n.type.indexOf("text/") === 0 || n.type.indexOf("multipart/") === 0) return false;
      return true;
    }
    function addAtt(n) {
      var name = n.filename || (n.type === "message/rfc822" ? "message.eml" : (n.type === "text/calendar" ? "invite.ics" : "part-" + (++seq)));
      var a = { id: n.path, name: String(name).replace(/[\\/\0\r\n]/g, "_").slice(0, 200), type: n.type,
                size: n.body.length, cid: n.cid, inline: n.disposition === "inline", data: n.body };
      res.attachments.push(a);
      if (n.cid) res.cids[n.cid] = a;
      if (n.type === "text/calendar") res.ics.push(asText(n));
      return a;
    }
    // Returns {html?, text?} chosen from a subtree, used for alternatives.
    function body(n) {
      if (n.type === "multipart/alternative") {
        var best = {};
        n.parts.forEach(function (p) {
          var b = body(p);
          if (b.html !== undefined) best.html = b.html;
          if (b.text !== undefined) best.text = b.text;
        });
        return best;
      }
      if (n.type.indexOf("multipart/") === 0) {
        var first = null;
        n.parts.forEach(function (p, i) {
          var isRoot = n.type === "multipart/related" ? i === 0 : !first;
          if (isRoot && !isAttachment(p) && (p.type.indexOf("multipart/") === 0 || p.type === "text/html" || p.type === "text/plain")) {
            var b = body(p);
            if (b.html !== undefined || b.text !== undefined) {
              if (!first) first = b;
              else {
                if (b.text !== undefined) first.text = (first.text || "") + "\n\n" + b.text;
                if (b.html !== undefined) first.html = (first.html || "") + "<hr>" + b.html;
              }
              return;
            }
          }
          if (p.type.indexOf("multipart/") === 0) { walkRest(p); return; }
          if (!isAttachment(p) && first && (p.type === "text/plain" || p.type === "text/html")) {
            if (p.type === "text/plain") first.text = (first.text || "") + "\n\n" + asText(p);
            else first.html = (first.html || "") + "<hr>" + asText(p);
            return;
          }
          if (p.type === "text/calendar" && !p.filename && p.disposition !== "attachment") { addAtt(p); return; }
          addAtt(p);
        });
        return first || {};
      }
      if (n.type === "text/html" && !isAttachment(n)) return { html: asText(n) };
      if (n.type === "text/plain" && !isAttachment(n)) return { text: asText(n) };
      addAtt(n);
      return {};
    }
    function walkRest(n) {
      n.parts.forEach(function (p) {
        if (p.type.indexOf("multipart/") === 0) walkRest(p);
        else addAtt(p);
      });
    }
    var b = body(root);
    if (b.html !== undefined) res.html = b.html;
    if (b.text !== undefined) res.text = b.text;
    if (res.html === null && res.text === null) res.text = "";
    return res;
  }

  // ---------- modified UTF-7 (IMAP folder names, RFC 3501 §5.1.3) ----------
  function utf7Decode(s) {
    return String(s || "").replace(/&([^-]*)-/g, function (m, b) {
      if (b === "") return "&";
      var bin = b64ToBin(b.replace(/,/g, "/") + "===".slice((b.length + 3) % 4));
      var out = "";
      for (var i = 0; i + 1 < bin.length; i += 2) out += String.fromCharCode((bin.charCodeAt(i) << 8) | bin.charCodeAt(i + 1));
      return out;
    });
  }

  // ---------- plain-text links ----------
  // Splits text into [{t}] and [{t, href}] runs: http(s), www., mailto,
  // bare e-mail addresses. Trailing punctuation stays outside.
  var LINK = /\b(?:https?:\/\/|www\.)[^\s<>"«»]+|\bmailto:[^\s<>"«»]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  function splitLinks(text) {
    var out = [], last = 0, m;
    text = String(text || "");
    LINK.lastIndex = 0;
    while ((m = LINK.exec(text)) !== null) {
      var raw = m[0];
      for (;;) {                         // trailing punctuation; ")" only when unbalanced
        var last1 = raw.slice(-1);
        if (/[.,;:!?\]}'»]/.test(last1)) { raw = raw.slice(0, -1); continue; }
        if (last1 === ")" && raw.split(")").length > raw.split("(").length) { raw = raw.slice(0, -1); continue; }
        break;
      }
      if (m.index > last) out.push({ t: text.slice(last, m.index) });
      var href = /^www\./i.test(raw) ? "https://" + raw : (/^(https?|mailto):/i.test(raw) ? raw : "mailto:" + raw);
      out.push({ t: raw, href: href });
      last = m.index + raw.length;
      LINK.lastIndex = last;
    }
    if (last < text.length) out.push({ t: text.slice(last) });
    return out;
  }

  // ---------- iCalendar (VEVENT summary, for the invite card) ----------
  function parseIcs(text) {
    var lines = String(text || "").replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
    var ev = null, out = [];
    lines.forEach(function (l) {
      if (/^BEGIN:VEVENT/i.test(l)) { ev = {}; return; }
      if (/^END:VEVENT/i.test(l)) { if (ev) out.push(ev); ev = null; return; }
      if (!ev) return;
      var i = l.indexOf(":");
      if (i < 0) return;
      var k = l.slice(0, i).split(";")[0].toUpperCase();
      var v = l.slice(i + 1).replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
      if (k === "SUMMARY" || k === "LOCATION" || k === "DESCRIPTION") ev[k.toLowerCase()] = v;
      if (k === "DTSTART" || k === "DTEND") ev[k.toLowerCase()] = icsDate(v, l.slice(0, i));
    });
    return out;
  }
  function icsDate(v, keyPart) {
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/.exec(v);
    if (!m) return null;
    var allDay = !m[4];
    return { y: +m[1], mo: +m[2], d: +m[3], h: allDay ? 0 : +m[4], mi: allDay ? 0 : +m[5],
             utc: !!m[7], allDay: allDay, tz: (/TZID=([^;:]+)/i.exec(keyPart || "") || [])[1] || "" };
  }

  var api = {
    b64ToBin: b64ToBin, binToB64: binToB64, decodeCharset: decodeCharset, decodeWords: decodeWords,
    qpDecode: qpDecode, parseHeaders: parseHeaders, parseParams: parseParams,
    parseAddresses: parseAddresses, parseDate: parseDate, summary: summary,
    parseMessage: parseMessage, utf7Decode: utf7Decode, splitLinks: splitLinks, parseIcs: parseIcs
  };
  root.orosMailMime = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
