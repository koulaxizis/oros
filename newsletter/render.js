// ============================================================
// orOS Newsletter — the e-mail itself (pure, no DOM)
// Blocks or Markdown → e-mail HTML (tables + inline styles, 600 px,
// four themes, columns that stack on a phone without media queries)
// and the plain-text twin; personal greetings; the footer with the
// unsubscribe link; the confirmation request; the web page of an
// issue; the RFC 5322 message (built with Mail's compose.js plus the
// List-Unsubscribe / List-Id headers).
// Everything written by the user is escaped; links are http(s) or
// mailto only. Exposed as window.OrosNewsletterRender; module.exports
// in Node (tests).
// ============================================================
(function (root) {
  "use strict";

  var C = root.OrosNewsletterCore || (typeof require === "function" ? require("./core.js") : null);
  var SO = root.OrosNewsletterSocial || (typeof require === "function" ? require("./social.js") : null);

  var STR = {
    en: {
      why: "You receive this because you subscribed to {l}.",
      unsub: "Unsubscribe", unsubText: "To unsubscribe, send an e-mail to {a} with the subject: unsubscribe {t}",
      unsubHint: "The link opens an e-mail with everything filled in: just send it.",
      unsubWeb: "One click, nothing else to do.", unsubWebText: "To unsubscribe, open: {u}",
      web: "Newsletter archive",
      confSubj: "Please confirm: {l}",
      confHi: "Hello{n},",
      confBody: "Someone (we hope you) asked to receive {l} at this address. To confirm, send the e-mail the button below prepares for you. If it wasn't you, ignore this message and you won't hear from us again.",
      confBtn: "Yes, subscribe me",
      confText: "To confirm, send an e-mail to {a} with the subject: confirm {t}",
      test: "[Test] "
    },
    el: {
      why: "Το λαμβάνεις επειδή έχεις εγγραφεί στο {l}.",
      unsub: "Κατάργηση εγγραφής", unsubText: "Για κατάργηση εγγραφής, στείλε email στο {a} με θέμα: unsubscribe {t}",
      unsubHint: "Ο σύνδεσμος ανοίγει ένα email έτοιμο: απλώς στείλ' το.",
      unsubWeb: "Ένα κλικ, τίποτε άλλο.", unsubWebText: "Για κατάργηση εγγραφής, άνοιξε: {u}",
      web: "Αρχείο τευχών",
      confSubj: "Επιβεβαίωσε την εγγραφή: {l}",
      confHi: "Γεια σου{n},",
      confBody: "Κάποιος (ελπίζουμε εσύ) ζήτησε να λαμβάνει το {l} σε αυτή τη διεύθυνση. Για να το επιβεβαιώσεις, στείλε το email που ετοιμάζει το κουμπί παρακάτω. Αν δεν ήσουν εσύ, αγνόησε αυτό το μήνυμα και δεν θα ξανακούσεις από εμάς.",
      confBtn: "Ναι, θέλω να εγγραφώ",
      confText: "Για επιβεβαίωση, στείλε email στο {a} με θέμα: confirm {t}",
      test: "[Δοκιμή] "
    }
  };
  function S(lang, k, p) {
    var s = (STR[lang] || STR.en)[k];
    if (p) Object.keys(p).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }

  var THEMES = {
    classic: { bg: "#f2f3f5", card: "#ffffff", text: "#1f2328", dim: "#6b7280", line: "#e5e7eb", pad: 32 },
    warm:    { bg: "#f6efe3", card: "#fffaf2", text: "#2b2118", dim: "#7a6a58", line: "#eadfcd", pad: 32 },
    dark:    { bg: "#111318", card: "#1b1e25", text: "#e8eaed", dim: "#9aa0a6", line: "#2c313a", pad: 32 },
    plain:   { bg: "#ffffff", card: "#ffffff", text: "#222222", dim: "#666666", line: "#e5e5e5", pad: 8 }
  };
  var FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  function esc(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  // White or near-black text on the accent colour, whichever reads better.
  function onColor(hex) {
    var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
    if (!m) return "#ffffff";
    var lum = function (v) { v = parseInt(v, 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    var L = 0.2126 * lum(m[1]) + 0.7152 * lum(m[2]) + 0.0722 * lum(m[3]);
    return L > 0.45 ? "#111111" : "#ffffff";
  }

  // ---------- personal greetings ----------
  // {name}, {first}, with a fallback after "|": {first|friend}
  function personalize(s, sub) {
    var name = sub && sub.name ? sub.name : "";
    var first = name.split(/\s+/)[0] || "";
    return String(s || "").replace(/\{(name|first)(?:\|([^{}|]{0,60}))?\}/g, function (m, k, fb) {
      var v = k === "first" ? first : name;
      return v || (fb || "");
    });
  }

  // ---------- inline text ----------
  // **bold**, *italic*, [text](https://…). Everything else is text.
  var INLINE = /\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)|\*\*([^*\n]{1,500})\*\*|\*([^*\s\n][^*\n]{0,499})\*/g;
  function inlineHtml(text, accent) {
    var out = "", last = 0, m;
    INLINE.lastIndex = 0;
    text = String(text || "");
    while ((m = INLINE.exec(text))) {
      out += esc(text.slice(last, m.index));
      if (m[1] !== undefined) {
        var u = C.safeUrl(m[2]);
        out += u ? "<a href=\"" + esc(u) + "\" style=\"color:" + accent + ";text-decoration:underline\">" + esc(m[1]) + "</a>"
                 : esc(m[0]);
      } else if (m[3] !== undefined) out += "<strong>" + esc(m[3]) + "</strong>";
      else out += "<em>" + esc(m[4]) + "</em>";
      last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  }
  function inlineText(text) {
    return String(text || "").replace(INLINE, function (all, t, u, b, i) {
      if (t !== undefined) { var su = C.safeUrl(u); return su ? t + " (" + su.replace(/^mailto:/i, "") + ")" : all; }
      return b !== undefined ? b : i;
    });
  }

  // A paragraph block: lines; "- " / "1. " lines become lists.
  function groups(text) {
    var out = [], cur = null;
    String(text || "").split("\n").forEach(function (line) {
      var ul = /^\s*[-•*]\s+(.*)$/.exec(line), ol = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line);
      var kind = ul ? "ul" : (ol ? "ol" : (line.trim() ? "p" : ""));
      if (!kind) { cur = null; return; }
      if (!cur || cur.kind !== kind) { cur = { kind: kind, items: [] }; out.push(cur); }
      cur.items.push(ul ? ul[1] : (ol ? ol[1] : line.trim()));
    });
    return out;
  }
  function paraHtml(text, th, accent) {
    var p = "margin:0 0 16px;font-size:16px;line-height:1.6;color:" + th.text;
    return groups(text).map(function (g) {
      if (g.kind === "p") return "<p style=\"" + p + "\">" + g.items.map(function (l) { return inlineHtml(l, accent); }).join("<br>") + "</p>";
      return "<" + g.kind + " style=\"" + p + ";padding-left:22px\">" + g.items.map(function (l) {
        return "<li style=\"margin:0 0 6px\">" + inlineHtml(l, accent) + "</li>";
      }).join("") + "</" + g.kind + ">";
    }).join("");
  }
  function paraText(text) {
    return groups(text).map(function (g) {
      if (g.kind === "p") return g.items.map(inlineText).join("\n");
      return g.items.map(function (l, i) { return (g.kind === "ol" ? (i + 1) + ". " : "- ") + inlineText(l); }).join("\n");
    }).join("\n\n");
  }

  // ---------- Markdown → blocks ----------
  // # / ## headings, paragraphs, lists, ---, ![alt](https://…) pictures,
  // [[Button text](https://…)] buttons.
  function mdToBlocks(md) {
    var blocks = [], para = [];
    var flush = function () { if (para.length) { blocks.push({ k: "p", t: para.join("\n") }); para = []; } };
    String(md || "").replace(/\r\n?/g, "\n").split("\n").forEach(function (line) {
      var m;
      if (/^\s*$/.test(line)) { flush(); return; }
      if ((m = /^\s{0,3}#{1,3}\s+(.+?)\s*#*\s*$/.exec(line))) { flush(); blocks.push({ k: "h", t: m[1] }); return; }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); blocks.push({ k: "hr" }); return; }
      if ((m = /^\s*!\[([^\]]{0,300})\]\((https?:\/\/[^)\s]{1,2000})\)\s*$/.exec(line))) {
        flush(); blocks.push({ k: "img", url: C.safeUrl(m[2]), alt: m[1] }); return;
      }
      if ((m = /^\s*\[\[([^\]]{1,80})\]\(([^)\s]{1,2000})\)\]\s*$/.exec(line))) {
        flush(); blocks.push({ k: "btn", t: m[1], href: C.safeUrl(m[2]) }); return;
      }
      para.push(line);
    });
    flush();
    return blocks.slice(0, C.LIM.blocks * 4);
  }
  function blocksOf(x) { return x.fmt === "md" ? mdToBlocks(x.md) : x.blocks; }

  // ---------- the list's look ----------
  var FONTS = {
    sans: FONT,
    serif: "Georgia,'Times New Roman',Times,serif",
    mono: "Menlo,Consolas,'Courier New',monospace"
  };
  var HEAD_PX = { 1: 28, 2: 22, 3: 18 };
  var HEAD_SCALE = { s: 0.86, m: 1, l: 1.18 };
  var RADIUS = { round: 8, square: 0, pill: 999 };
  // st: what every block needs to know about the list's look
  function lookOf(l, th) {
    var y = (l && l.sty) || {};
    var accent = (l && l.color) || "#2f6fde";
    return { th: th, accent: accent, link: y.link || accent, font: FONTS[y.font] || FONT,
             hs: HEAD_SCALE[y.hs] || 1, rad: RADIUS[y.btn] === undefined ? 8 : RADIUS[y.btn], bg: y.bg || th.bg };
  }

  // ---------- one block ----------
  function buttonHtml(x, st, line, full) {
    var a = st.accent, r = st.rad;
    var cell = line ? "border:2px solid " + a + ";border-radius:" + r + "px" : "border-radius:" + r + "px;background:" + a;
    return "<td align=\"center\" style=\"" + cell + "\"><a href=\"" + esc(x.href) + "\" style=\"display:" + (full ? "block" : "inline-block") +
      ";padding:" + (line ? "10px 20px" : "12px 22px") + ";font-family:" + st.font + ";font-size:16px;font-weight:700;color:" +
      (line ? a : onColor(a)) + ";text-decoration:none;border-radius:" + r + "px\">" + esc(x.t) + "</a></td>";
  }
  function blockCore(b, st, img, t) {
    var th = st.th, lc = st.link;
    switch (b.k) {
      case "h": {
        var lv = b.lv === 1 || b.lv === 3 ? b.lv : 2;
        var px = Math.round(HEAD_PX[lv] * st.hs);
        return "<h" + lv + " style=\"margin:8px 0 14px;font-size:" + px + "px;line-height:1.3;font-weight:700;font-family:" + st.font + ";color:" + th.text + "\">" +
               inlineHtml(t(b.t), lc) + "</h" + lv + ">";
      }
      case "p": return paraHtml(t(b.t), th, lc);
      case "list": {
        var items = String(t(b.t) || "").split("\n").map(function (x) { return x.replace(/^\s*(?:[-\u2022*]|\d{1,3}[.)])\s+/, "").trim(); }).filter(Boolean);
        if (!items.length) return "";
        var tag = b.ord ? "ol" : "ul";
        return "<" + tag + " style=\"margin:0 0 16px;padding-left:22px;font-size:16px;line-height:1.6;color:" + th.text + "\">" + items.map(function (x) {
          return "<li style=\"margin:0 0 6px\">" + inlineHtml(x, lc) + "</li>";
        }).join("") + "</" + tag + ">";
      }
      case "quote": {
        if (!b.t) return "";
        var q = "<blockquote style=\"margin:0 0 16px;padding:4px 0 4px 16px;border-left:4px solid " + st.accent + "\">" +
          "<p style=\"margin:0;font-size:18px;line-height:1.55;font-style:italic;color:" + th.text + "\">" +
          String(t(b.t)).split("\n").map(function (x) { return inlineHtml(x, lc); }).join("<br>") + "</p>";
        if (b.by) q += "<p style=\"margin:8px 0 0;font-size:14px;color:" + th.dim + "\">\u2014 " + esc(t(b.by)) + "</p>";
        return q + "</blockquote>";
      }
      case "sp": return "<div style=\"height:" + b.h + "px;line-height:" + b.h + "px;font-size:1px\">&#8202;</div>";
      case "hr":
        return "<hr style=\"border:0;border-top:" + (b.w || 1) + "px " + (b.st || "solid") + " " + (b.c || th.line) + ";margin:24px auto;width:" + (b.wd || 100) + "%\">";
      case "btn": {
        var all = C.buttonsOf(b).filter(function (x) { return x.href && x.t; }).map(function (x) { return { t: t(x.t), href: x.href }; });
        if (!all.length) return "";
        var line = b.st === "line", full = all.length === 1 && b.full === 1;
        var cells = all.map(function (x, i) {
          return (i ? "<td style=\"width:12px\"></td>" : "") + buttonHtml(x, st, line, full);
        }).join("");
        var align = b.al === "center" || b.al === "right" ? " align=\"" + b.al + "\"" : "";
        return "<table role=\"presentation\"" + align + " cellpadding=\"0\" cellspacing=\"0\" border=\"0\"" + (full ? " width=\"100%\"" : "") +
               " style=\"margin:8px " + (b.al === "center" ? "auto" : "0") + " 20px\"><tr>" + cells + "</tr></table>";
      }
      case "img": {
        var src = b.url || (img ? img(b) : "");
        if (!src) return "";
        var w = Math.min(b.w || 536, 536);
        var tg = "<img src=\"" + esc(src) + "\" alt=\"" + esc(b.alt || "") + "\" width=\"" + w + "\" style=\"display:block;width:100%;max-width:" + w +
                  "px;height:auto;border:0;margin:0 auto 16px;border-radius:6px\">";
        return b.href ? "<a href=\"" + esc(b.href) + "\">" + tg + "</a>" : tg;
      }
      case "cols": {
        var col = function (s) {
          return "<div style=\"display:inline-block;vertical-align:top;width:100%;max-width:258px;margin:0 4px\">" + paraHtml(t(s), th, lc) + "</div>";
        };
        return "<div style=\"font-size:0;text-align:left\">" + col(b.a) + col(b.b) + "</div>";
      }
      case "head": {
        var al = C.alignOf(b), parts = [];
        var logo = b.f && img ? img({ f: b.f }) : "";
        if (logo) {
          var lw = Math.min(b.lw || 140, 300), lh = Math.round(lw * (b.h || 1) / (b.w || 1));
          parts.push("<img src=\"" + esc(logo) + "\" alt=\"" + esc(b.t || "") + "\" width=\"" + lw + "\" height=\"" + lh +
                     "\" style=\"display:" + (al === "center" ? "block;margin:0 auto 12px" : "inline-block;margin:0 0 12px") + ";width:" + lw + "px;max-width:100%;height:auto;border:0\">");
        }
        if (b.t) parts.push("<p style=\"margin:0 0 4px;font-size:" + Math.round(24 * st.hs) + "px;line-height:1.25;font-weight:800;font-family:" + st.font + ";color:" + th.text + "\">" + esc(t(b.t)) + "</p>");
        if (b.sub) parts.push("<p style=\"margin:0 0 6px;font-size:14px;line-height:1.5;color:" + th.dim + "\">" + esc(t(b.sub)) + "</p>");
        var ls = (b.links || []).filter(function (x) { return x.t && x.href; });
        if (ls.length) {
          parts.push("<p style=\"margin:8px 0 0;font-size:14px;line-height:1.6\">" + ls.map(function (x) {
            return "<a href=\"" + esc(x.href) + "\" style=\"color:" + lc + ";text-decoration:none;font-weight:700\">" + esc(t(x.t)) + "</a>";
          }).join("<span style=\"color:" + th.dim + "\">&nbsp;&nbsp;·&nbsp;&nbsp;</span>") + "</p>");
        }
        if (!parts.length) return "";
        return "<div style=\"text-align:" + al + ";margin:0 0 20px;padding-bottom:16px;border-bottom:1px solid " + th.line + "\">" + parts.join("") + "</div>";
      }
      case "social": return socialRow(b, b.sz, img, C.alignOf(b), "0 0 16px");
      case "foot": {
        var fa = C.alignOf(b);
        var row = socialRow(b, 24, img, fa, "0 0 10px");
        var ft = b.t ? "<p style=\"margin:0;font-size:13px;line-height:1.6;color:" + th.dim + "\">" +
          String(t(b.t)).split("\n").map(function (x) { return inlineHtml(x, lc); }).join("<br>") + "</p>" : "";
        if (!row && !ft) return "";
        return "<div style=\"text-align:" + fa + ";margin:20px 0 0;padding-top:16px;border-top:1px solid " + th.line + "\">" + row + ft + "</div>";
      }
    }
    return "";      // a block from a newer orOS: not drawn here
  }
  // A row of social icons (PNG pictures drawn when sending)
  function socialRow(b, sz, img, al, margin) {
    var items = (b.items || []).filter(function (x) { return x.href && SO.NETS[x.n]; });
    if (!items.length || !img) return "";
    var cells = items.map(function (x, i) {
      var src = img({ f: SO.key(x.n, b.st || "c", sz) });
      if (!src) return "";
      var name = SO.NETS[x.n].name;
      return (i ? "<td style=\"width:8px\"></td>" : "") + "<td><a href=\"" + esc(x.href) + "\"><img src=\"" + esc(src) + "\" alt=\"" + esc(name) +
             "\" title=\"" + esc(name) + "\" width=\"" + sz + "\" height=\"" + sz + "\" style=\"display:block;width:" + sz + "px;height:" + sz + "px;border:0\"></a></td>";
    }).join("");
    if (!cells) return "";
    return "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"" + (al !== "left" ? " align=\"" + al + "\"" : "") +
           " style=\"margin:" + (al === "center" ? margin.replace(/^0 0/, "0 auto") : margin) + "\"><tr>" + cells + "</tr></table>" +
           (al !== "left" ? "<div style=\"clear:both;line-height:0;font-size:0\"></div>" : "");
  }
  function socialText(b) {
    return (b.items || []).filter(function (x) { return x.href && SO.NETS[x.n]; })
      .map(function (x) { return SO.NETS[x.n].name + ": " + x.href.replace(/^mailto:/i, ""); }).join("\n");
  }
  // A block with its own alignment / padding / background is wrapped
  // in a one-cell table; on a coloured background the text switches to
  // white or near-black, whichever reads.
  function blockHtml(b, st, img, sub) {
    var t = function (s) { return personalize(s, sub); };
    if (!b.al && !b.pad && !b.bg) return blockCore(b, st, img, t);
    var s2 = st;
    if (b.bg) {
      var ink = onColor(b.bg);
      s2 = {}; Object.keys(st).forEach(function (k) { s2[k] = st[k]; });
      s2.th = { bg: st.th.bg, card: b.bg, text: ink, dim: ink === "#ffffff" ? "#e5e7eb" : "#4b5563", line: ink === "#ffffff" ? "#f3f4f6" : "#6b7280", pad: st.th.pad };
      if (onColor(st.link) === ink) s2.link = ink;         // a link the same tone as the background would vanish
    }
    var inner = blockCore(b, s2, img, t);
    if (!inner) return "";
    var al = C.alignOf(b);
    return "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"" + (b.bg ? " bgcolor=\"" + b.bg + "\"" : "") +
      " style=\"margin:0 0 12px" + (b.bg ? ";background:" + b.bg + ";border-radius:6px" : "") + "\"><tr><td align=\"" + al + "\" style=\"text-align:" + al +
      ";padding:" + (b.pad || 0) + "px " + (b.bg ? 16 : 0) + "px\">" + inner + "</td></tr></table>";
  }
  function blockText(b, sub) {
    var t = function (s) { return personalize(s, sub); };
    switch (b.k) {
      case "h": { var h = inlineText(t(b.t)); return h + "\n" + new Array(Math.min(h.length, 60) + 1).join(b.lv === 3 ? "-" : "="); }
      case "p": return paraText(t(b.t));
      case "list":
        return String(t(b.t) || "").split("\n").map(function (x) { return x.replace(/^\s*(?:[-\u2022*]|\d{1,3}[.)])\s+/, "").trim(); }).filter(Boolean)
          .map(function (x, i) { return (b.ord ? (i + 1) + ". " : "- ") + inlineText(x); }).join("\n");
      case "quote":
        return b.t ? String(t(b.t)).split("\n").map(function (x) { return "> " + inlineText(x); }).join("\n") + (b.by ? "\n\u2014 " + t(b.by) : "") : "";
      case "hr": return "----------";
      case "btn":
        return C.buttonsOf(b).filter(function (x) { return x.href && x.t; })
          .map(function (x) { return t(x.t) + ": " + x.href.replace(/^mailto:/i, ""); }).join("\n");
      case "img": return b.alt ? "[" + b.alt + "]" + (b.href ? " " + b.href : "") : "";
      case "cols": return [paraText(t(b.a)), paraText(t(b.b))].filter(Boolean).join("\n\n");
      case "head":
        return [b.t ? t(b.t).toUpperCase() : "", b.sub ? t(b.sub) : "",
                (b.links || []).filter(function (x) { return x.t && x.href; }).map(function (x) { return t(x.t) + ": " + x.href.replace(/^mailto:/i, ""); }).join("\n")]
          .filter(Boolean).join("\n") + "\n" + new Array(31).join("=");
      case "social": return socialText(b);
      case "foot": return new Array(31).join("-") + "\n" + [socialText(b), b.t ? paraText(t(b.t)) : ""].filter(Boolean).join("\n\n");
    }
    return "";
  }

  // ---------- the whole e-mail ----------
  // o: { issue, list, sub (null on the web page / a test), lang,
  //      img(block) → src, unsub (mailto: URL or ""), unsubWeb (https: or ""), tok, mailbox, test }
  // → { subject, html (for compose.js: inside <body>), text }
  function email(o) {
    var lang = o.lang === "el" ? "el" : "en", l = o.list;
    var x = o.issue.l2 ? C.contentFor(o.issue, lang) : o.issue;     // the version in their language
    var th = THEMES[l.theme] || THEMES.classic, accent = l.color || "#2f6fde";
    var st = lookOf(l, th);
    var body = blocksOf(x).map(function (b) { return blockHtml(b, st, o.img, o.sub); }).join("");
    var foot = footer(o, th, accent, lang);
    var pre = x.pre ? "<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all\">" + esc(personalize(x.pre, o.sub)) +
                      new Array(40).join("&#8204;&nbsp;") + "</div>" : "";
    var html = pre +
      "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"background:" + st.bg + "\"><tr><td align=\"center\" style=\"padding:24px 8px\">" +
      "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"max-width:600px;background:" + th.card +
      (l.theme === "plain" ? "" : ";border-radius:12px;border-top:4px solid " + accent) + "\"><tr><td style=\"padding:" + th.pad + "px;font-family:" + st.font +
      ";color:" + th.text + ";text-align:left\">" + body + "</td></tr></table>" + foot + "</td></tr></table>";
    var text = blocksOf(x).map(function (b) { return blockText(b, o.sub); }).filter(Boolean).join("\n\n") + "\n\n-- \n" + footText(o, lang);
    var subj = personalize(x.subj, o.sub);
    return { subject: (o.test ? S(lang, "test") : "") + subj, html: html, text: text };
  }
  function footer(o, th, accent, lang) {
    var l = o.list, p = [];
    var small = "margin:0 0 8px;font-size:12px;line-height:1.5;color:" + th.dim;
    if (o.why !== false) p.push("<p style=\"" + small + "\">" + esc(l.why || S(lang, "why", { l: l.name })).replace(/\n/g, "<br>") + "</p>");
    if (l.addr) p.push("<p style=\"" + small + "\">" + esc(l.addr).replace(/\n/g, "<br>") + "</p>");
    // the relay's one-click page when the list has a web form, else the mailto
    var web = o.unsubWeb && /^https:\/\//.test(o.unsubWeb) ? o.unsubWeb : "";
    if (o.unsub || web) {
      p.push("<p style=\"" + small + "\"><a href=\"" + esc(web || o.unsub) + "\" style=\"color:" + th.dim + ";text-decoration:underline\">" + esc(S(lang, "unsub")) +
             "</a> · " + esc(S(lang, web ? "unsubWeb" : "unsubHint")) + "</p>");
    }
    return "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"max-width:600px\"><tr><td style=\"padding:16px " +
           (o.list.theme === "plain" ? 8 : 24) + "px;font-family:" + FONT + ";text-align:center\">" + p.join("") + "</td></tr></table>";
  }
  function footText(o, lang) {
    var l = o.list, p = [l.why || S(lang, "why", { l: l.name })];
    if (l.addr) p.push(l.addr);
    if (o.unsubWeb && /^https:\/\//.test(o.unsubWeb)) p.push(S(lang, "unsubWebText", { u: o.unsubWeb }));
    if (o.unsub && o.mailbox && o.tok) p.push(S(lang, "unsubText", { a: o.mailbox, t: o.tok }));
    return p.join("\n\n");
  }

  // The request to confirm a subscription (double opt-in).
  // o: { list, sub, lang, mailbox, tok, confirm (mailto: URL) }
  function confirmEmail(o) {
    var l = o.list, lang = o.lang === "el" ? "el" : "en";
    var first = o.sub && o.sub.name ? " " + o.sub.name.split(/\s+/)[0] : "";
    var x = { fmt: "blocks", subj: S(lang, "confSubj", { l: l.name }), pre: "", blocks: [
      { k: "p", t: S(lang, "confHi", { n: first }) },
      { k: "p", t: S(lang, "confBody", { l: l.name }) },
      { k: "btn", t: S(lang, "confBtn"), href: o.confirm }
    ] };
    var out = email({ issue: x, list: l, sub: null, lang: lang, img: null, unsub: "", why: false });
    var text = [S(lang, "confHi", { n: first }), S(lang, "confBody", { l: l.name }),
                S(lang, "confText", { a: o.mailbox, t: o.tok }), l.addr].filter(Boolean).join("\n\n");
    return { subject: out.subject, html: out.html, text: text };
  }

  // The issue as a standalone web page (for an archive on your site):
  // no greeting name, no unsubscribe link.
  function webPage(o) {
    var e = email({ issue: o.issue, list: o.list, sub: null, lang: o.lang, img: o.img, unsub: "" });
    return "<!DOCTYPE html>\n<html lang=\"" + (o.lang === "el" ? "el" : "en") + "\"><head><meta charset=\"utf-8\">" +
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>" + esc(e.subject) + "</title></head>" +
      "<body style=\"margin:0;padding:0\">" + e.html + "</body></html>\n";
  }

  // ---------- the message ----------
  // M = Mail's compose.js (window.orosMailCompose).
  // o: { from{name,addr}, to{name,addr}, reply, subject, text, html,
  //      inline[{cid,type,bin}], listId, listName, unsub (mailto:), unsubWeb (https:), tag,
  //      hdr ([name, value] extra header of the provider) }
  // → { bin, messageId, rcpt[] }
  // The list headers of one message → [[name, value], …] (ASCII)
  function listHeaders(M, o) {
    var out = [];
    var dom = String(o.from.addr).split("@")[1] || "localhost";
    if (o.listId) {
      out.push(["List-Id", (o.listName ? M.encodeWords(String(o.listName).replace(/[<>"]/g, "")) + " " : "") +
                           "<" + o.listId + ".newsletter." + dom.toLowerCase().replace(/[^a-z0-9.-]/g, "") + ">"]);
    }
    // RFC 8058: the https one-click address first (when the list has a
    // web form), the mailto as the fallback
    var web = o.unsubWeb && /^https:\/\/[\x21-\x7e]+$/.test(o.unsubWeb) && !/[<>]/.test(o.unsubWeb) ? o.unsubWeb : "";
    if (o.unsub || web) out.push(["List-Unsubscribe", [web, o.unsub].filter(Boolean).map(function (u) { return "<" + u + ">"; }).join(", ")]);
    if (web) out.push(["List-Unsubscribe-Post", "List-Unsubscribe=One-Click"]);
    if (o.tag) out.push(["X-Oros-Newsletter", String(o.tag).replace(/[^a-z0-9-]/gi, "")]);
    if (o.hdr && /^[A-Za-z0-9-]{1,40}$/.test(o.hdr[0]) && /^[\x20-\x7e]{1,200}$/.test(o.hdr[1])) out.push([o.hdr[0], o.hdr[1]]);
    return out;
  }
  function message(M, o) {
    var built = M.build({ from: o.from, to: [o.to], cc: [], bcc: [], subject: o.subject, text: o.text,
                          html: o.html, inline: o.inline || [] });
    var CRLF = "\r\n", h = "";
    if (o.reply && C.validEmail(o.reply)) h += "Reply-To: " + M.fmtAddr({ name: "", addr: o.reply }) + CRLF;
    listHeaders(M, o).forEach(function (x) { h += x[0] + ": " + x[1] + CRLF; });
    built.bin = h + built.bin;
    return built;
  }
  // The same message as one request of the relay's "papi" operation
  // (relay/papi.js) in the provider's own format. Mailgun takes the MIME
  // bytes; the others JSON, with the pictures as inline attachments.
  function apiReq(M, prov, dom, o) {
    if (prov === "mailgun" || prov === "mailgun-eu") {
      return { m: "POST", path: "/" + dom + "/messages.mime", type: "multipart/form-data", to: o.to.addr, mime: M.b64(message(M, o).bin) };
    }
    var hdrs = listHeaders(M, o), reply = o.reply && C.validEmail(o.reply) ? o.reply : "";
    var inline = (o.inline || []).map(function (i) {
      return { cid: i.cid, type: i.type, name: i.cid.replace(/@oros$/, ""), b64: btoa(i.bin) };
    });
    var obj = function (pairs) { var h = {}; pairs.forEach(function (x) { h[x[0]] = x[1]; }); return h; };
    var who = function (a) { var r = { email: a.addr }; if (a.name) r.name = a.name; return r; };
    var body;
    if (prov === "brevo") {
      body = { sender: who(o.from), to: [who(o.to)], subject: o.subject, htmlContent: o.html, textContent: o.text, headers: obj(hdrs) };
      if (reply) body.replyTo = { email: reply };
      if (o.tag) body.tags = [String(o.tag).replace(/[^a-z0-9-]/gi, "")];
    } else if (prov === "postmark") {
      // UTF-8 names as they are (the JSON is UTF-8), quoted
      var fmt = function (a) { return a.name ? "\"" + String(a.name).replace(/[\\"\r\n]/g, "") + "\" <" + a.addr + ">" : a.addr; };
      body = { From: fmt(o.from), To: fmt(o.to), Subject: o.subject, HtmlBody: o.html, TextBody: o.text, MessageStream: "broadcast",
               Headers: hdrs.filter(function (x) { return x[0] !== "X-PM-Message-Stream"; }).map(function (x) { return { Name: x[0], Value: x[1] }; }) };
      if (reply) body.ReplyTo = reply;
      if (o.tag) body.Tag = String(o.tag).replace(/[^a-z0-9-]/gi, "");
      if (inline.length) body.Attachments = inline.map(function (i) { return { Name: i.name, Content: i.b64, ContentType: i.type, ContentID: "cid:" + i.cid }; });
    } else {
      body = { personalizations: [{ to: [who(o.to)] }], from: who(o.from), subject: o.subject,
               content: [{ type: "text/plain", value: o.text }, { type: "text/html", value: o.html }], headers: obj(hdrs) };
      if (reply) body.reply_to = { email: reply };
      if (inline.length) body.attachments = inline.map(function (i) { return { content: i.b64, type: i.type, filename: i.name, disposition: "inline", content_id: i.cid }; });
    }
    return { m: "POST", path: prov === "brevo" ? "/smtp/email" : prov === "postmark" ? "/email" : "/mail/send", body: JSON.stringify(body) };
  }
  // mailto: URL whose subject the app reads back from the Inbox.
  function mailto(addr, subject) { return "mailto:" + addr + "?subject=" + encodeURIComponent(subject); }

  var api = {
    THEMES: THEMES, esc: esc, onColor: onColor, personalize: personalize, inlineHtml: inlineHtml, inlineText: inlineText,
    mdToBlocks: mdToBlocks, blocksOf: blocksOf, email: email, confirmEmail: confirmEmail, webPage: webPage,
    message: message, listHeaders: listHeaders, apiReq: apiReq, mailto: mailto
  };
  root.OrosNewsletterRender = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
