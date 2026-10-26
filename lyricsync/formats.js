// ============================================================
// orOS Lyric Sync — file formats (pure, no DOM)
// Export: LRC, Enhanced LRC (word stamps), SRT, WebVTT (word karaoke
// tags), TTML (line or word timing, singers as agents), ASS karaoke,
// JSON (our own, lossless) and plain text. Import: the same, read as data only (imported text is
// never markup: the app shows it with textContent).
//   toLrc(project) · toElrc · toSrt · toVtt · toTtml · toAss · toJson · toText
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
  function toLrc(p, enhanced) {
    var out = [];
    if (p.name) out.push("[ti:" + oneLine(p.name) + "]");
    if (p.ar) out.push("[ar:" + oneLine(p.ar) + "]");
    if (p.al) out.push("[al:" + oneLine(p.al) + "]");
    if (p.dur) out.push("[length:" + C.fmt(p.dur, "lrc").slice(0, 5) + "]");
    out.push("[re:" + CREDIT + "]");
    var L = list(p);
    L.forEach(function (x, k) {
      if (enhanced && x.words) {
        out.push("[" + C.fmt(x.s, "lrc") + "]" + x.words.map(function (w) { return "<" + C.fmt(w.s, "lrc") + ">" + w.t; }).join(" ") +
                 " <" + C.fmt(x.e, "lrc") + ">");
      } else out.push("[" + C.fmt(x.s, "lrc") + "]" + x.t);
      var nx = L[k + 1];
      if (x.ex && (!nx || nx.s - x.e >= 500)) out.push("[" + C.fmt(x.e, "lrc") + "]");
    });
    return out.join("\n") + "\n";
  }

  function toElrc(p) { return toLrc(p, true); }

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
      var body = x.words ? x.words.map(function (w, k) { return (k ? "<" + C.fmt(w.s, "vtt") + ">" : "") + escVtt(w.t); }).join(" ") : escVtt(x.t);
      return C.fmt(x.s, "vtt") + " --> " + C.fmt(x.e, "vtt") + "\n" + body + "\n";
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
    var byWord = L.some(function (x) { return x.words; });
    var names = singers(p), used = {};
    L.forEach(function (x) { used[x.v] = 1; });
    var o = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"' +
        ' xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="' + (byWord ? "Word" : "Line") + '" xml:lang="' + escXml(p.lg || "") + '">',
      "  <head>", "    <metadata>"];
    if (p.name) o.push("      <ttm:title>" + escXml(p.name) + "</ttm:title>");
    [1, 2, 3, 4].forEach(function (v) {
      if (!used[v] || !names[v - 1]) return;
      o.push('      <ttm:agent type="person" xml:id="v' + v + '"><ttm:name type="full">' + escXml(names[v - 1]) + "</ttm:name></ttm:agent>");
    });
    o.push("    </metadata>", "  </head>", '  <body dur="' + C.fmt(end, "vtt") + '">');
    divs.forEach(function (d) {
      o.push('    <div begin="' + C.fmt(d[0].s, "vtt") + '" end="' + C.fmt(d[d.length - 1].e, "vtt") + '">');
      d.forEach(function (x) {
        var body = x.words ? x.words.map(function (w) {
          return '<span begin="' + C.fmt(w.s, "vtt") + '" end="' + C.fmt(w.e, "vtt") + '">' + escXml(w.t) + "</span>";
        }).join(" ") : escXml(x.t);
        o.push('      <p begin="' + C.fmt(x.s, "vtt") + '" end="' + C.fmt(x.e, "vtt") + '"' + (names[x.v - 1] ? ' ttm:agent="v' + x.v + '"' : "") + ">" + body + "</p>");
      });
      o.push("    </div>");
    });
    o.push("  </body>", "</tt>");
    return o.join("\n") + "\n";
  }

  // Singer names: vn, else the artist as singer 1.
  function singers(p) {
    var n = (p.vn || []).slice(0, 4);
    if (!n[0] && p.ar) n[0] = p.ar;
    return n;
  }

  // ASS (Advanced SubStation Alpha) karaoke for video tools (Aegisub,
  // ffmpeg, VLC): one Dialogue per line, {\kf} per word in centiseconds.
  function assTime(t) {
    t = Math.max(0, Math.round(t / 10));
    var h = Math.floor(t / 360000), m = Math.floor(t / 6000) % 60, sc = Math.floor(t / 100) % 60, cs = t % 100;
    return h + ":" + (m < 10 ? "0" : "") + m + ":" + (sc < 10 ? "0" : "") + sc + "." + (cs < 10 ? "0" : "") + cs;
  }
  function escAss(t) { return String(t).replace(/\\/g, "\\\u200b").replace(/[{}]/g, function (c) { return c === "{" ? "(" : ")"; }); }
  function toAss(p) {
    var names = singers(p);
    var o = ["[Script Info]", "; " + CREDIT, "Title: " + oneLine([p.ar, p.name].filter(Boolean).join(" - ")), "ScriptType: v4.00+",
      "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 0", "", "[V4+ Styles]",
      "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
      "Style: Default,Arial,72,&H0037AFD4,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,4,2,2,60,60,80,1",
      "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"];
    list(p).forEach(function (x) {
      var txt = x.words ? x.words.map(function (w) { return "{\\kf" + Math.max(1, Math.round((w.e - w.s) / 10)) + "}" + escAss(w.t); }).join(" ")
                        : "{\\kf" + Math.max(1, Math.round((x.e - x.s) / 10)) + "}" + escAss(x.t);
      if (x.words && x.words[0].s > x.s) txt = "{\\k" + Math.round((x.words[0].s - x.s) / 10) + "}" + txt;
      o.push("Dialogue: 0," + assTime(x.s) + "," + assTime(x.e) + ",Default," + oneLine(names[x.v - 1] || "").replace(/,/g, " ") + ",0,0,0,," + txt);
    });
    return o.join("\n") + "\n";
  }

  // Our own format: every line, timed or not, with its explicit end.
  function toJson(p) {
    return JSON.stringify({
      format: "oros-lyrics", version: 1, title: p.name || "", artist: p.ar || "", album: p.al || "",
      language: p.lg || "", duration: p.dur || 0, singers: p.vn || [],
      lines: (p.ln || []).map(function (l) {
        var o = { text: l.t, start: l.s, end: l.e };
        if (l.p) o.verse = true;
        if (l.v) o.singer = l.v;
        if (l.w) o.words = l.w.slice();
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
      // Enhanced LRC: <mm:ss.xx> before a word gives that word's start;
      // a last stamp with no word after it ends the line.
      var wre = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>([^<]*)/g, wm, wl = null, wEnd = null;
      if (/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/.test(line)) {
        wl = [];
        var head = line.split("<")[0];
        C.words(head).forEach(function () { wl.push(null); });
        while ((wm = wre.exec(line))) {
          var at = lrcTime(wm[1], wm[2], wm[3]), ws = C.words(wm[4]);
          if (!ws.length) { wEnd = at; continue; }
          ws.forEach(function (x, k) { wl.push(k ? null : at); });
        }
      }
      var t = clean(line.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, " ").replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, ""));
      stamps.forEach(function (s) { rows.push({ s: s, t: t, n: n, w: stamps.length === 1 ? wl : null, we: stamps.length === 1 ? wEnd : null }); });
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
      var row = { t: r.t, s: s, e: r.we !== null && r.we !== undefined && r.we - off > s ? r.we - off : null, p: gap ? 1 : 0 };
      if (r.w) row.w = r.w.map(function (x) { return x === null ? null : Math.max(0, x - off); });
      res.lines.push(row);
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
        var body = rows.slice(k + 1).join(" "), wl = null;
        var s0 = cueMs(m[1], m[2], m[3], m[4]);
        if (kind === "vtt" && /<\d{2}:\d{2}(?::\d{2})?\.\d{3}>/.test(body)) {
          wl = [];
          body.replace(/<[^>]*>/g, function (tag) { return /^<\d/.test(tag) ? tag : ""; }).split(/(<[\d:.]+>)/).forEach(function (part, j, arr) {
            if (/^<[\d:.]+>$/.test(part)) return;
            var at = j === 0 ? s0 : vttTag(arr[j - 1]);
            C.words(decode(part)).forEach(function (x, q) { wl.push(q ? null : at); });
          });
        }
        body = clean(kind === "vtt" ? decode(stripTags(body)) : body.replace(/<\/?(?:i|b|u|font)\b[^>]*>/gi, "").replace(/\{\\[^}]*\}/g, ""));
        var s = cueMs(m[1], m[2], m[3], m[4]), e = cueMs(m[5], m[6], m[7], m[8]);
        if (body) res.lines.push({ t: body, s: s, e: e > s ? e : null, p: 0, w: wl && wl.length === C.words(body).length ? wl : null });
        break;
      }
    });
    res.lines.sort(function (a, b) { return a.s - b.s; });
    return res;
  }

  function vttTag(tag) {
    var m = /^<(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})>$/.exec(tag || "");
    return m ? cueMs(m[1], m[2], m[3], m[4]) : null;
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
    var agr = /<ttm:agent\b([^>]*)>([\s\S]*?)<\/ttm:agent>/gi, am;
    res.vn = [];
    while ((am = agr.exec(text))) {
      var vid = /^v([1-4])$/.exec(attr(" " + am[1], "xml:id")), nm = /<ttm:name[^>]*>([\s\S]*?)<\/ttm:name>/i.exec(am[2]);
      if (vid && nm) res.vn[+vid[1] - 1] = clean(decode(stripTags(nm[1])));
    }
    if (res.vn[0]) res.ar = res.vn[0];
    var body = text.replace(/<head\b[\s\S]*?<\/head>/i, "");
    var re = /<div\b[^>]*>|<p\b([^>]*)>([\s\S]*?)<\/p>/gi, m, newDiv = false;
    while ((m = re.exec(body))) {
      if (m[0].charAt(1).toLowerCase() === "d") { newDiv = res.lines.length > 0; continue; }
      var s = ttmlTime(attr(" " + m[1], "begin")), e = ttmlTime(attr(" " + m[1], "end"));
      var inner = m[2].replace(/<br\s*\/?>/gi, " ");
      var t = clean(decode(stripTags(inner.replace(/<\/span>\s*<span/gi, "</span> <span"))));
      if (!t) continue;
      // word timing: <span begin=…>word</span>, one per word
      var spans = [], sm, sre = /<span\b([^>]*)>([^<]*)<\/span>/gi;
      while ((sm = sre.exec(inner))) { var sb = ttmlTime(attr(" " + sm[1], "begin")); if (sb !== null && clean(decode(sm[2]))) spans.push([sb, C.words(decode(sm[2])).length]); }
      var wl = null;
      if (spans.length) {
        wl = [];
        spans.forEach(function (x) { for (var q = 0; q < x[1]; q++) wl.push(q ? null : x[0]); });
        if (wl.length !== C.words(t).length) wl = null;
      }
      var ag = attr(" " + m[1], "ttm:agent"), vm = /^v([1-4])$/.exec(ag);
      // Apple writes words as <span>s with no space between some of them:
      // the step above only adds one where the source had whitespace.
      res.lines.push({ t: t, s: s, e: s !== null && e !== null && e > s ? e : null, p: newDiv ? 1 : 0, w: wl, v: vm ? +vm[1] : 1 });
      newDiv = false;
    }
    return res;
  }

  // ASS / SSA: Dialogue lines (Start, End, Text); {\k} karaoke tags give
  // the words' starts.
  function parseAss(text) {
    var res = { kind: "ass", name: "", ar: "", al: "", lg: "", lines: [] }, fmt = null;
    var tm2 = function (v) { var m = /^(\d+):(\d{2}):(\d{2})[.:](\d{2})$/.exec(String(v).trim()); return m ? ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4] * 10 : null; };
    text.split(/\r\n?|\n/).forEach(function (row) {
      var ti = /^Title:\s*(.*)$/.exec(row);
      if (ti && !res.name) { res.name = clean(ti[1]); return; }
      var f = /^Format:\s*(.*)$/.exec(row);
      if (f) { var cols = f[1].split(",").map(function (x) { return x.trim().toLowerCase(); }); if (cols.indexOf("text") >= 0) fmt = cols; return; }
      var d = /^Dialogue:\s*(.*)$/.exec(row);
      if (!d || !fmt) return;
      var parts = d[1].split(","), n = fmt.length;
      var f2 = parts.slice(0, n - 1).concat([parts.slice(n - 1).join(",")]);
      var s = tm2(f2[fmt.indexOf("start")]), e = tm2(f2[fmt.indexOf("end")]), raw = f2[n - 1] || "";
      if (s === null) return;
      var wl = [], at = s, pending = null;
      raw.replace(/\\[Nn]/g, " ").split(/(\{[^}]*\})/).forEach(function (part) {
        if (/^\{/.test(part)) {
          var k = /\\k[fo]?(\d+)/i.exec(part);
          if (k) { if (pending !== null) at = pending; pending = at + +k[1] * 10; wl.push({ at: at, t: "" }); }
          return;
        }
        if (wl.length) wl[wl.length - 1].t += part; else wl.push({ at: null, t: part });
      });
      var t = clean(wl.map(function (x) { return x.t; }).join(""));
      if (!t) return;
      var w = [];
      wl.forEach(function (x) { C.words(x.t).forEach(function (q, j) { w.push(j ? null : x.at); }); });
      var hasW = wl.filter(function (x) { return x.at !== null && C.words(x.t).length; }).length > 1 && w.length === C.words(t).length;
      res.lines.push({ t: t, s: s, e: e !== null && e > s ? e : null, p: 0, w: hasW ? w.map(function (x, j) { return j === 0 && x === null ? s : x; }) : null });
    });
    res.lines.sort(function (a, b) { return a.s - b.s; });
    return res;
  }

  function parseJson(text) {
    var d = JSON.parse(text);
    if (!d || d.format !== "oros-lyrics" || !Array.isArray(d.lines)) throw new Error("format");
    var num = function (v) { return typeof v === "number" && isFinite(v) && v >= 0 ? Math.round(v) : null; };
    return {
      kind: "json", name: clean(d.title || ""), ar: clean(d.artist || ""), al: clean(d.album || ""), lg: clean(d.language || "").slice(0, 20),
      dur: num(d.duration) || 0, vn: Array.isArray(d.singers) ? d.singers.filter(function (x) { return typeof x === "string"; }).slice(0, 4) : [],
      lines: d.lines.filter(function (l) { return l && typeof l.text === "string" && clean(l.text); }).map(function (l) {
        var s = num(l.start), e = num(l.end);
        return { t: clean(l.text), s: s, e: s !== null && e !== null && e > s ? e : null, p: l.verse ? 1 : 0,
                 w: Array.isArray(l.words) ? l.words.map(function (x) { return x === null ? null : num(x); }) : null, v: l.singer };
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
    if (ext === "ass" || ext === "ssa") return "ass";
    var head = text.slice(0, 2000);
    if (/^\uFEFF?WEBVTT/.test(head)) return "vtt";
    if (/<tt[\s>]/i.test(head)) return "ttml";
    if (/^\uFEFF?\s*\{/.test(head) && /"oros-lyrics"/.test(head)) return "json";
    if (/^\[Script Info\]/m.test(head) && /^\[Events\]|^Dialogue:/m.test(text)) return "ass";
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
    else if (k === "ass") r = parseAss(text);
    else r = parseText(text);
    r.lines = r.lines.slice(0, C.MAX_LINES).map(function (l) {
      var o = { t: l.t.slice(0, C.MAX_LINE), s: l.s, e: l.e, p: l.p ? 1 : 0 };
      if (l.w && l.t.length <= C.MAX_LINE) o.w = l.w;
      if (l.v === 2 || l.v === 3 || l.v === 4) o.v = l.v;
      return o;
    });
    if (r.vn) r.vn = r.vn.map(function (x) { return clean(x || "").slice(0, 60); });
    if (!r.lines.length) throw new Error("format");
    return r;
  }

  var EXPORTS = {
    lrc:  { ext: ".lrc",  mime: "application/x-lrc", fn: function (p) { return toLrc(p, false); } },
    elrc: { ext: ".lrc",  mime: "application/x-lrc", fn: toElrc, words: true },
    srt:  { ext: ".srt",  mime: "application/x-subrip", fn: toSrt },
    vtt:  { ext: ".vtt",  mime: "text/vtt", fn: toVtt },
    ttml: { ext: ".ttml", mime: "application/ttml+xml", fn: toTtml },
    ass:  { ext: ".ass",  mime: "text/x-ssa", fn: toAss },
    json: { ext: ".json", mime: "application/json", fn: toJson },
    txt:  { ext: ".txt",  mime: "text/plain", fn: toText }
  };

  var API = {
    toLrc: toLrc, toElrc: toElrc, toAss: toAss, toSrt: toSrt, toVtt: toVtt, toTtml: toTtml, toJson: toJson, toText: toText,
    parse: parse, kindOf: kindOf, ttmlTime: ttmlTime, EXPORTS: EXPORTS
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.LyricsyncFormats = API;
})(typeof window !== "undefined" ? window : globalThis);
