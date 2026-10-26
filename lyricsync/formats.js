// ============================================================
// orOS Lyric Sync — file formats (pure, no DOM)
// Export: LRC, SRT, WebVTT, TTML, JSON (our own, lossless) and
// plain text. Import: the same, read as data only (imported text is
// never markup: the app shows it with textContent).
//   toLrc(project) · toSrt · toVtt · toTtml · toJson · toText
//   parse(fileName, text) → { kind, name, ar, al, lg, lines: [{ t, s, e, p }] }
//     (s/e in ms or null; throws Error("format") when nothing fits)
// Times come from LyricsyncCore.timed(): every exported line has an
// end, and no line overlaps the next.
// ============================================================
(function (root) {
  "use strict";

  var C = typeof module !== "undefined" && module.exports ? require("./core.js") : root.LyricsyncCore;
  var CREDIT = "orOS Lyric Sync";
  var MAX_IN = 4 * 1024 * 1024;          // characters of an imported file

  function list(p) { return C.timed(p.ln || [], p.dur || 0); }
  function oneLine(v) { return String(v || "").replace(/[\r\n]+/g, " ").trim(); }

  // ---------- Export ----------
  // LRC: header tags, then "[mm:ss.xx]text". A line with its own end
  // and a pause after it gets an empty stamp, so players clear it.
  function toLrc(p) {
    var out = [];
    if (p.name) out.push("[ti:" + oneLine(p.name) + "]");
    if (p.ar) out.push("[ar:" + oneLine(p.ar) + "]");
    if (p.al) out.push("[al:" + oneLine(p.al) + "]");
    if (p.dur) out.push("[length:" + C.fmt(p.dur, "lrc").slice(0, 5) + "]");
    out.push("[re:" + CREDIT + "]");
    var L = list(p);
    L.forEach(function (x, k) {
      out.push("[" + C.fmt(x.s, "lrc") + "]" + x.t);
      var nx = L[k + 1];
      if (x.ex && (!nx || nx.s - x.e >= 500)) out.push("[" + C.fmt(x.e, "lrc") + "]");
    });
    return out.join("\n") + "\n";
  }

  function toSrt(p) {
    return list(p).map(function (x, k) {
      return (k + 1) + "\n" + C.fmt(x.s, "srt") + " --> " + C.fmt(x.e, "srt") + "\n" + x.t + "\n";
    }).join("\n");
  }

  function escVtt(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function toVtt(p) {
    var head = "WEBVTT";
    var title = [p.name, p.ar].filter(Boolean).map(oneLine).join(" · ");
    if (title) head += "\n\nNOTE " + title.replace(/-->/g, "→");
    return head + "\n\n" + list(p).map(function (x) {
      return C.fmt(x.s, "vtt") + " --> " + C.fmt(x.e, "vtt") + "\n" + escVtt(x.t) + "\n";
    }).join("\n");
  }

  function escXml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  }
  // TTML in the shape Apple Music, YouTube and DistroKid take: one <div>
  // per verse, one <p> per line, clock times hh:mm:ss.mmm.
  function toTtml(p) {
    var L = list(p), divs = [];
    L.forEach(function (x, k) { if (!k || x.p) divs.push([]); divs[divs.length - 1].push(x); });
    var end = Math.max(p.dur || 0, L.length ? L[L.length - 1].e : 0);
    var o = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"' +
        ' xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Line" xml:lang="' + escXml(p.lg || "") + '">',
      "  <head>", "    <metadata>"];
    if (p.name) o.push("      <ttm:title>" + escXml(p.name) + "</ttm:title>");
    if (p.ar) o.push('      <ttm:agent type="person" xml:id="v1"><ttm:name type="full">' + escXml(p.ar) + "</ttm:name></ttm:agent>");
    o.push("    </metadata>", "  </head>", '  <body dur="' + C.fmt(end, "vtt") + '">');
    divs.forEach(function (d) {
      o.push('    <div begin="' + C.fmt(d[0].s, "vtt") + '" end="' + C.fmt(d[d.length - 1].e, "vtt") + '">');
      d.forEach(function (x) {
        o.push('      <p begin="' + C.fmt(x.s, "vtt") + '" end="' + C.fmt(x.e, "vtt") + '"' + (p.ar ? ' ttm:agent="v1"' : "") + ">" + escXml(x.t) + "</p>");
      });
      o.push("    </div>");
    });
    o.push("  </body>", "</tt>");
    return o.join("\n") + "\n";
  }

  // Our own format: every line, timed or not, with its explicit end.
  function toJson(p) {
    return JSON.stringify({
      format: "oros-lyrics", version: 1, title: p.name || "", artist: p.ar || "", album: p.al || "",
      language: p.lg || "", duration: p.dur || 0,
      lines: (p.ln || []).map(function (l) {
        var o = { text: l.t, start: l.s, end: l.e };
        if (l.p) o.verse = true;
        return o;
      })
    }, null, 2) + "\n";
  }

  function toText(p) { return C.toText(p.ln || []) + "\n"; }

  // ---------- Import ----------
  function decode(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, function (m, e) {
      var k = e.toLowerCase();
      if (k === "amp") return "&"; if (k === "lt") return "<"; if (k === "gt") return ">";
      if (k === "quot") return "\""; if (k === "apos") return "'"; if (k === "nbsp") return " ";
      var n = k.charAt(1) === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return n > 0 && n < 0x110000 && n !== 0xFFFE ? String.fromCodePoint(n) : "";
    });
  }
  function stripTags(s) { return String(s).replace(/<[^>]*>/g, "").replace(/\{\\[^}]*\}/g, ""); }
  function clean(s) { return String(s).replace(/\s+/g, " ").trim(); }

  function lrcTime(m, s, f) {
    var frac = f ? Math.round(+("0." + f) * 1000) : 0;
    return (+m * 60 + +s) * 1000 + frac;
  }
  function parseLrc(text) {
    var res = { kind: "lrc", name: "", ar: "", al: "", lg: "", lines: [] }, off = 0, rows = [];
    text.split(/\r\n?|\n/).forEach(function (raw, n) {
      var line = raw.trim(), stamps = [], m;
      var meta = /^\[(ti|ar|al|offset|la|lang):([^\]]*)\]$/i.exec(line);
      if (meta) {
        var k = meta[1].toLowerCase(), v = clean(meta[2]);
        if (k === "ti") res.name = v; else if (k === "ar") res.ar = v; else if (k === "al") res.al = v;
        else if (k === "offset") off = parseInt(v, 10) || 0; else res.lg = v.slice(0, 20);
        return;
      }
      var re = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
      while ((m = re.exec(line))) { stamps.push(lrcTime(m[1], m[2], m[3])); line = line.slice(m[0].length); }
      if (!stamps.length) return;
      // Enhanced LRC word stamps <mm:ss.xx> and A2 inline stamps go;
      // the words stay.
      var t = clean(line.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, "").replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, ""));
      stamps.forEach(function (s) { rows.push({ s: s, t: t, n: n }); });
    });
    rows.sort(function (a, b) { return a.s - b.s || a.n - b.n; });
    var gap = false;
    rows.forEach(function (r) {
      var s = Math.max(0, r.s - off);
      if (!r.t) {                                  // an empty stamp ends the line before it
        var last = res.lines[res.lines.length - 1];
        if (last && last.e === null && s > last.s) last.e = s;
        gap = res.lines.length > 0;
        return;
      }
      res.lines.push({ t: r.t, s: s, e: null, p: gap ? 1 : 0 });
      gap = false;
    });
    return res;
  }

  var CUE = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/;
  function cueMs(h, m, s, f) { return ((+(h || 0) * 60 + +m) * 60 + +s) * 1000 + Math.round(+("0." + f) * 1000); }
  function parseCues(text, kind) {
    var res = { kind: kind, name: "", ar: "", al: "", lg: "", lines: [] };
    text.replace(/\r\n?/g, "\n").split(/\n\s*\n/).forEach(function (block) {
      var rows = block.split("\n"), k;
      for (k = 0; k < rows.length; k++) {
        var m = CUE.exec(rows[k]);
        if (!m) continue;
        var body = rows.slice(k + 1).join(" ");
        body = clean(kind === "vtt" ? decode(stripTags(body)) : body.replace(/<\/?(?:i|b|u|font)\b[^>]*>/gi, "").replace(/\{\\[^}]*\}/g, ""));
        var s = cueMs(m[1], m[2], m[3], m[4]), e = cueMs(m[5], m[6], m[7], m[8]);
        if (body) res.lines.push({ t: body, s: s, e: e > s ? e : null, p: 0 });
        break;
      }
    });
    res.lines.sort(function (a, b) { return a.s - b.s; });
    return res;
  }

  // TTML time expressions: clock (h:m:s.f, m:s.f, h:m:s:frames) or
  // offset (12.5s, 1500ms, 2m, 1h, plain seconds).
  function ttmlTime(v) {
    v = String(v || "").trim();
    var m;
    if ((m = /^(\d+):(\d{1,2}):(\d{1,2})(?:\.(\d+))?$/.exec(v))) return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + (m[4] ? Math.round(+("0." + m[4]) * 1000) : 0);
    if ((m = /^(\d+):(\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(v))) return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + Math.round(+m[4] * 1000 / 30);
    if ((m = /^(\d+):(\d{1,2})(?:\.(\d+))?$/.exec(v))) return (+m[1] * 60 + +m[2]) * 1000 + (m[3] ? Math.round(+("0." + m[3]) * 1000) : 0);
    if ((m = /^(\d+(?:\.\d+)?)(h|m|s|ms)?$/.exec(v))) {
      var x = +m[1], u = m[2] || "s";
      return Math.round(u === "h" ? x * 3600000 : u === "m" ? x * 60000 : u === "ms" ? x : x * 1000);
    }
    return null;
  }
  function attr(tag, name) {
    var m = new RegExp("\\s" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)')").exec(tag);
    return m ? decode(m[2] !== undefined ? m[2] : m[3]) : "";
  }
  function parseTtml(text) {
    var res = { kind: "ttml", name: "", ar: "", al: "", lg: "", lines: [] };
    var tt = /<tt\b[^>]*>/i.exec(text);
    if (tt) res.lg = attr(tt[0], "xml:lang").slice(0, 20);
    var ti = /<ttm:title[^>]*>([\s\S]*?)<\/ttm:title>/i.exec(text);
    if (ti) res.name = clean(decode(stripTags(ti[1])));
    var ag = /<ttm:name[^>]*>([\s\S]*?)<\/ttm:name>/i.exec(text);
    if (ag) res.ar = clean(decode(stripTags(ag[1])));
    var body = text.replace(/<head\b[\s\S]*?<\/head>/i, "");
    var re = /<div\b[^>]*>|<p\b([^>]*)>([\s\S]*?)<\/p>/gi, m, newDiv = false;
    while ((m = re.exec(body))) {
      if (m[0].charAt(1).toLowerCase() === "d") { newDiv = res.lines.length > 0; continue; }
      var s = ttmlTime(attr(" " + m[1], "begin")), e = ttmlTime(attr(" " + m[1], "end"));
      var t = clean(decode(stripTags(m[2].replace(/<br\s*\/?>/gi, " ").replace(/<\/span>\s*<span/gi, "</span> <span"))));
      if (!t) continue;
      // Apple writes words as <span>s with no space between some of them:
      // the step above only adds one where the source had whitespace.
      res.lines.push({ t: t, s: s, e: s !== null && e !== null && e > s ? e : null, p: newDiv ? 1 : 0 });
      newDiv = false;
    }
    return res;
  }

  function parseJson(text) {
    var d = JSON.parse(text);
    if (!d || d.format !== "oros-lyrics" || !Array.isArray(d.lines)) throw new Error("format");
    var num = function (v) { return typeof v === "number" && isFinite(v) && v >= 0 ? Math.round(v) : null; };
    return {
      kind: "json", name: clean(d.title || ""), ar: clean(d.artist || ""), al: clean(d.album || ""), lg: clean(d.language || "").slice(0, 20),
      dur: num(d.duration) || 0,
      lines: d.lines.filter(function (l) { return l && typeof l.text === "string" && clean(l.text); }).map(function (l) {
        var s = num(l.start), e = num(l.end);
        return { t: clean(l.text), s: s, e: s !== null && e !== null && e > s ? e : null, p: l.verse ? 1 : 0 };
      })
    };
  }

  function parseText(text) {
    return { kind: "txt", name: "", ar: "", al: "", lg: "", lines: C.splitText(text).map(function (l) { return { t: l.t, s: null, e: null, p: l.p }; }) };
  }

  function kindOf(name, text) {
    var ext = (/\.([a-z0-9]+)$/i.exec(name || "") || [])[1];
    ext = ext ? ext.toLowerCase() : "";
    if (ext === "lrc" || ext === "elrc") return "lrc";
    if (ext === "srt") return "srt";
    if (ext === "vtt") return "vtt";
    if (ext === "ttml" || ext === "dfxp" || ext === "xml") return "ttml";
    if (ext === "json") return "json";
    var head = text.slice(0, 2000);
    if (/^\uFEFF?WEBVTT/.test(head)) return "vtt";
    if (/<tt[\s>]/i.test(head)) return "ttml";
    if (/^\uFEFF?\s*\{/.test(head) && /"oros-lyrics"/.test(head)) return "json";
    if (/^\s*\d+\s*\n\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/m.test(head.replace(/\r/g, ""))) return "srt";
    if (/^\s*\[\d{1,3}:\d{1,2}([.:]\d{1,3})?\]/m.test(head)) return "lrc";
    return "txt";
  }

  function parse(name, text) {
    text = String(text || "").slice(0, MAX_IN).replace(/^\uFEFF/, "");
    var k = kindOf(name, text), r;
    if (k === "lrc") r = parseLrc(text);
    else if (k === "srt" || k === "vtt") r = parseCues(text, k);
    else if (k === "ttml") r = parseTtml(text);
    else if (k === "json") r = parseJson(text);
    else r = parseText(text);
    r.lines = r.lines.slice(0, C.MAX_LINES).map(function (l) { return { t: l.t.slice(0, C.MAX_LINE), s: l.s, e: l.e, p: l.p ? 1 : 0 }; });
    if (!r.lines.length) throw new Error("format");
    return r;
  }

  var EXPORTS = {
    lrc:  { ext: ".lrc",  mime: "application/x-lrc", fn: toLrc },
    srt:  { ext: ".srt",  mime: "application/x-subrip", fn: toSrt },
    vtt:  { ext: ".vtt",  mime: "text/vtt", fn: toVtt },
    ttml: { ext: ".ttml", mime: "application/ttml+xml", fn: toTtml },
    json: { ext: ".json", mime: "application/json", fn: toJson },
    txt:  { ext: ".txt",  mime: "text/plain", fn: toText }
  };

  var API = {
    toLrc: toLrc, toSrt: toSrt, toVtt: toVtt, toTtml: toTtml, toJson: toJson, toText: toText,
    parse: parse, kindOf: kindOf, ttmlTime: ttmlTime, EXPORTS: EXPORTS
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.LyricsyncFormats = API;
})(typeof window !== "undefined" ? window : globalThis);
