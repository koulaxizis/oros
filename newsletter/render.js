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

  var STR = {
    en: {
      why: "You receive this because you subscribed to {l}.",
      unsub: "Unsubscribe", unsubText: "To unsubscribe, send an e-mail to {a} with the subject: unsubscribe {t}",
      unsubHint: "The link opens an e-mail with everything filled in: just send it.",
      friend: "", web: "Newsletter archive",
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
      friend: "", web: "Αρχείο τευχών",
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

  // ---------- one block ----------
  function blockHtml(b, th, accent, img, sub) {
    var t = function (s) { return personalize(s, sub); };
    switch (b.k) {
      case "h":
        return "<h2 style=\"margin:8px 0 14px;font-size:22px;line-height:1.3;font-weight:700;color:" + th.text + "\">" + inlineHtml(t(b.t), accent) + "</h2>";
      case "p": return paraHtml(t(b.t), th, accent);
      case "hr": return "<hr style=\"border:0;border-top:1px solid " + th.line + ";margin:24px 0\">";
      case "btn": {
        if (!b.href || !b.t) return "";
        return "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 20px\"><tr>" +
          "<td style=\"border-radius:8px;background:" + accent + "\"><a href=\"" + esc(b.href) + "\" style=\"display:inline-block;padding:12px 22px;" +
          "font-family:" + FONT + ";font-size:16px;font-weight:700;color:" + onColor(accent) + ";text-decoration:none;border-radius:8px\">" +
          esc(t(b.t)) + "</a></td></tr></table>";
      }
      case "img": {
        var src = b.url || (img ? img(b) : "");
        if (!src) return "";
        var w = Math.min(b.w || 536, 536);
        var tag = "<img src=\"" + esc(src) + "\" alt=\"" + esc(b.alt || "") + "\" width=\"" + w + "\" style=\"display:block;width:100%;max-width:" + w +
                  "px;height:auto;border:0;margin:0 auto 16px;border-radius:6px\">";
        return b.href ? "<a href=\"" + esc(b.href) + "\">" + tag + "</a>" : tag;
      }
      case "cols": {
        var col = function (s) {
          return "<div style=\"display:inline-block;vertical-align:top;width:100%;max-width:258px;margin:0 4px\">" + paraHtml(t(s), th, accent) + "</div>";
        };
        return "<div style=\"font-size:0;text-align:left\">" + col(b.a) + col(b.b) + "</div>";
      }
    }
    return "";
  }
  function blockText(b, sub) {
    var t = function (s) { return personalize(s, sub); };
    switch (b.k) {
      case "h": { var h = inlineText(t(b.t)); return h + "\n" + new Array(Math.min(h.length, 60) + 1).join("="); }
      case "p": return paraText(t(b.t));
      case "hr": return "----------";
      case "btn": return b.href && b.t ? t(b.t) + ": " + b.href.replace(/^mailto:/i, "") : "";
      case "img": return b.alt ? "[" + b.alt + "]" + (b.href ? " " + b.href : "") : "";
      case "cols": return [paraText(t(b.a)), paraText(t(b.b))].filter(Boolean).join("\n\n");
    }
    return "";
  }

  // ---------- the whole e-mail ----------
  // o: { issue, list, sub (null on the web page / a test), lang,
  //      img(block) → src, unsub (mailto: URL or ""), tok, mailbox, test }
  // → { subject, html (for compose.js: inside <body>), text }
  function email(o) {
    var lang = o.lang === "el" ? "el" : "en", l = o.list;
    var x = o.issue.l2 ? C.contentFor(o.issue, lang) : o.issue;     // the version in their language
    var th = THEMES[l.theme] || THEMES.classic, accent = l.color || "#2f6fde";
    var body = blocksOf(x).map(function (b) { return blockHtml(b, th, accent, o.img, o.sub); }).join("");
    var foot = footer(o, th, accent, lang);
    var pre = x.pre ? "<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all\">" + esc(personalize(x.pre, o.sub)) +
                      new Array(40).join("&#8204;&nbsp;") + "</div>" : "";
    var html = pre +
      "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"background:" + th.bg + "\"><tr><td align=\"center\" style=\"padding:24px 8px\">" +
      "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"max-width:600px;background:" + th.card +
      (l.theme === "plain" ? "" : ";border-radius:12px;border-top:4px solid " + accent) + "\"><tr><td style=\"padding:" + th.pad + "px;font-family:" + FONT +
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
    if (o.unsub) {
      p.push("<p style=\"" + small + "\"><a href=\"" + esc(o.unsub) + "\" style=\"color:" + th.dim + ";text-decoration:underline\">" + esc(S(lang, "unsub")) +
             "</a> · " + esc(S(lang, "unsubHint")) + "</p>");
    }
    return "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"max-width:600px\"><tr><td style=\"padding:16px " +
           (o.list.theme === "plain" ? 8 : 24) + "px;font-family:" + FONT + ";text-align:center\">" + p.join("") + "</td></tr></table>";
  }
  function footText(o, lang) {
    var l = o.list, p = [l.why || S(lang, "why", { l: l.name })];
    if (l.addr) p.push(l.addr);
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
  //      inline[{cid,type,bin}], listId, listName, unsub (mailto:), tag,
  //      hdr ([name, value] extra header of the provider) }
  // → { bin, messageId, rcpt[] }
  function message(M, o) {
    var built = M.build({ from: o.from, to: [o.to], cc: [], bcc: [], subject: o.subject, text: o.text,
                          html: o.html, inline: o.inline || [] });
    var CRLF = "\r\n", h = "";
    var dom = String(o.from.addr).split("@")[1] || "localhost";
    if (o.reply && C.validEmail(o.reply)) h += "Reply-To: " + M.fmtAddr({ name: "", addr: o.reply }) + CRLF;
    if (o.listId) {
      h += "List-Id: " + (o.listName ? M.encodeWords(String(o.listName).replace(/[<>"]/g, "")) + " " : "") +
           "<" + o.listId + ".newsletter." + dom.toLowerCase().replace(/[^a-z0-9.-]/g, "") + ">" + CRLF;
    }
    if (o.unsub) h += "List-Unsubscribe: <" + o.unsub + ">" + CRLF;
    if (o.tag) h += "X-Oros-Newsletter: " + String(o.tag).replace(/[^a-z0-9-]/gi, "") + CRLF;
    if (o.hdr && /^[A-Za-z0-9-]{1,40}$/.test(o.hdr[0]) && /^[\x20-\x7e]{1,200}$/.test(o.hdr[1])) h += o.hdr[0] + ": " + o.hdr[1] + CRLF;
    built.bin = h + built.bin;
    return built;
  }
  // mailto: URL whose subject the app reads back from the Inbox.
  function mailto(addr, subject) { return "mailto:" + addr + "?subject=" + encodeURIComponent(subject); }

  var api = {
    THEMES: THEMES, esc: esc, onColor: onColor, personalize: personalize, inlineHtml: inlineHtml, inlineText: inlineText,
    mdToBlocks: mdToBlocks, blocksOf: blocksOf, email: email, confirmEmail: confirmEmail, webPage: webPage,
    message: message, mailto: mailto
  };
  root.OrosNewsletterRender = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
