// ============================================================
// orOS Email Signature — pure core (v1.0.0)
// No DOM, no storage. One copy of the logic for the app, the
// universal search provider and the tests (tests/signature.test.js).
//
// Data (synced slice "signature", key oros-signature-data):
//   { ver: 1, sigs: [sig], tombs: { id: m } }
//   sig = { id, m, nm (label), lang en|el, tpl,
//           f:  { name, pron, title, dept, company, vat, phone, mobile,
//                 email, web, addr, line, legal },
//           so: [{ k (social kind), u (url) }]          ≤ 8
//           cta: { t, u }                               a button
//           st: { acc, txt, font, size, shape, div, icons, lab, logoW, photoW },
//           im: { logo:  { a?, u?, w, h },              a = asset id on the
//                 photo: { a?, u?, w, h },                  orOS disk (designkit
//                 ban:   { a?, u?, w, h, link, from, to } }  assets), u = https
//           qr: 0|1 }                                   a vCard QR code
//   Merge: per signature the newer m wins (equal m: the larger
//   canonical JSON), tombstones remove what is not newer (delete wins
//   ties), lists sorted by id (R5, R17, R26). Images are never stored
//   here (R30): only the asset id or the web address.
//
// The HTML a signature becomes is BUILT, never typed: every value is
// escaped, links must be http(s) / mailto / tel, colours #rrggbb,
// fonts from a fixed list, image sources a data:image/png|jpeg URL or
// an https address. Tables + inline styles only (Outlook, Gmail),
// no classes, no <style>, no SVG, no web fonts.
//
// UMD: module.exports in Node, window.SignatureCore in the browser.
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Constants + helpers ----------
  var VERSION   = "1.0.0";
  var DATA_VER  = 1;
  var DATA_KEY  = "oros-signature-data";
  var PREFS_KEY = "oros-signature-prefs";
  var MAX_SIGS  = 30;
  var MAX_SOCIAL = 8;
  var GMAIL_LIMIT = 10000;          // characters Gmail accepts in a signature
  var MAX_IMG_SRC = 160000;         // data: URL length of one embedded picture
  var ID_RE     = /^s[0-9a-z]{6,24}$/;
  var ASSET_RE  = /^[0-9a-f]{64}\.(png|jpg)$/;
  var DAY_RE    = /^\d{4}-\d{2}-\d{2}$/;
  var HEX_RE    = /^#[0-9a-f]{6}$/;
  var IMG_DATA_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+\/]+=*$/;

  var TEMPLATES = ["classic", "side", "minimal", "bar", "compact", "plain"];
  var LANGS = ["en", "el"];

  // Email-safe font stacks: no web fonts (most clients drop them).
  var FONTS = {
    arial:    "Arial, Helvetica, sans-serif",
    helvetica: "Helvetica, Arial, sans-serif",
    verdana:  "Verdana, Geneva, sans-serif",
    tahoma:   "Tahoma, Verdana, sans-serif",
    trebuchet: "'Trebuchet MS', Arial, sans-serif",
    segoe:    "'Segoe UI', Arial, sans-serif",
    georgia:  "Georgia, 'Times New Roman', serif",
    times:    "'Times New Roman', Times, serif",
    palatino: "'Palatino Linotype', Palatino, Georgia, serif",
    courier:  "'Courier New', Courier, monospace"
  };
  var FONT_NAMES = {
    arial: "Arial", helvetica: "Helvetica", verdana: "Verdana", tahoma: "Tahoma",
    trebuchet: "Trebuchet MS", segoe: "Segoe UI", georgia: "Georgia", times: "Times New Roman",
    palatino: "Palatino", courier: "Courier New"
  };

  // Social profiles: the label and the short mark drawn on the icon
  // (letters on a circle, drawn by the app: no brand artwork, no CDN).
  var SOCIAL = {
    linkedin:  { n: "LinkedIn",  g: "in" },
    facebook:  { n: "Facebook",  g: "f" },
    instagram: { n: "Instagram", g: "IG" },
    x:         { n: "X",         g: "X" },
    youtube:   { n: "YouTube",   g: "\u25B6" },
    tiktok:    { n: "TikTok",    g: "TT" },
    github:    { n: "GitHub",    g: "GH" },
    mastodon:  { n: "Mastodon",  g: "M" },
    bluesky:   { n: "Bluesky",   g: "B" },
    threads:   { n: "Threads",   g: "@" },
    whatsapp:  { n: "WhatsApp",  g: "WA" },
    other:     { n: "",          g: "\u2197" }
  };
  var SOCIAL_KEYS = Object.keys(SOCIAL);

  var LIM = { nm: 60, name: 80, pron: 30, title: 80, dept: 80, company: 100, vat: 30, phone: 40,
              mobile: 40, email: 120, web: 300, addr: 200, line: 160, legal: 800, url: 1000, ctaT: 40 };
  var FIELDS = ["name", "pron", "title", "dept", "company", "vat", "phone", "mobile", "email", "web", "addr", "line", "legal"];

  // Words the signature itself prints, in its own language.
  var WORDS = {
    en: { phone: "Phone", mobile: "Mobile", email: "Email", web: "Web", vat: "VAT no.",
          lphone: "T", lmobile: "M", lemail: "E", lweb: "W", cta: "Book a meeting", other: "Website" },
    el: { phone: "Τηλ.", mobile: "Κιν.", email: "Email", web: "Web", vat: "ΑΦΜ",
          lphone: "Τ", lmobile: "Κ", lemail: "E", lweb: "W", cta: "Κλείστε ραντεβού", other: "Ιστότοπος" }
  };

  var DEFAULT_ST = { acc: "#2b6cb0", txt: "#333333", font: "arial", size: 13, shape: "square",
                     div: 1, icons: 1, lab: "l", logoW: 120, photoW: 72 };

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function clamp(v, lo, hi, d) { v = Math.round(+v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; }
  // One line: control characters out, spaces collapsed.
  function one(s, max) {
    return (typeof s === "string" ? s : "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, max || 200);
  }
  // A block: new lines kept (at most two in a row), the rest as one().
  function block(s, max) {
    return (typeof s === "string" ? s : "").replace(/\r\n?/g, "\n").split("\n").map(function (l) { return one(l, max); })
      .join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max || 800);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function hex(v) { v = typeof v === "string" ? v.trim().toLowerCase() : ""; return HEX_RE.test(v) ? v : ""; }
  function day(v) {
    if (typeof v !== "string" || !DAY_RE.test(v)) return "";
    var d = new Date(v + "T00:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : "";
  }

  // ---------- 2. Links ----------
  // http(s) only; a bare "example.com" gets https://. "" when unsafe.
  function webUrl(v) {
    var s = one(v, LIM.url).replace(/\s+/g, "");
    if (!s) return "";
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
      if (/^\/\//.test(s)) s = "https:" + s;
      else s = "https://" + s;
    }
    if (!/^https?:\/\/[^\/\s?#@]+\.[^\/\s?#]+/i.test(s) && !/^https?:\/\/localhost\b/i.test(s)) return "";
    if (/[<>"'`\\]/.test(s)) return "";
    return s;
  }
  function httpsUrl(v) { var u = webUrl(v); return /^https:\/\//i.test(u) ? u : ""; }
  function mailUrl(v) {
    var s = one(v, LIM.email).replace(/^mailto:/i, "");
    return /^[^\s@<>"'`\\,;:()?&\/=#]+@[^\s@<>"'`\\,;:()?&\/=#]+\.[^\s@<>"'`\\,;:()?&\/=#]+$/.test(s) ? "mailto:" + s : "";
  }
  function telUrl(v) {
    var s = one(v, LIM.phone);
    var digits = s.replace(/[^\d+]/g, "");
    if (digits.indexOf("+") > 0) digits = digits.charAt(0) + digits.slice(1).replace(/\+/g, "");
    return /^\+?\d{3,20}$/.test(digits) ? "tel:" + digits : "";
  }
  // What a web link shows: no scheme, no trailing slash.
  function showUrl(u) { return u.replace(/^https?:\/\//i, "").replace(/^www\./i, "www.").replace(/\/$/, ""); }
  function imgSrc(v) {
    if (typeof v !== "string") return "";
    if (IMG_DATA_RE.test(v)) return v.length <= MAX_IMG_SRC ? v : "";
    return httpsUrl(v);
  }

  // ---------- 3. Normalize ----------
  function normImg(x, banner) {
    if (!x || typeof x !== "object") return null;
    var a = typeof x.a === "string" && ASSET_RE.test(x.a) ? x.a : "";
    var u = httpsUrl(x.u);
    if (!a && !u) return null;
    var o = {};
    if (a) o.a = a;
    if (u) o.u = u;
    o.w = clamp(x.w, 0, 20000, 0);
    o.h = clamp(x.h, 0, 20000, 0);
    if (banner) {
      o.link = webUrl(x.link);
      o.from = day(x.from);
      o.to = day(x.to);
      o.bw = clamp(x.bw, 200, 600, 400);
    }
    return o;
  }
  function normSt(s) {
    s = s && typeof s === "object" ? s : {};
    var d = DEFAULT_ST;
    return {
      acc: hex(s.acc) || d.acc,
      txt: hex(s.txt) || d.txt,
      font: FONTS[s.font] ? s.font : d.font,
      size: clamp(s.size, 11, 16, d.size),
      shape: s.shape === "round" ? "round" : "square",
      div: s.div === 0 ? 0 : 1,
      icons: s.icons === 0 ? 0 : 1,
      lab: s.lab === "w" || s.lab === "n" ? s.lab : "l",
      logoW: clamp(s.logoW, 40, 240, d.logoW),
      photoW: clamp(s.photoW, 40, 120, d.photoW)
    };
  }
  function normFields(f) {
    f = f && typeof f === "object" ? f : {};
    var o = {};
    FIELDS.forEach(function (k) {
      o[k] = k === "legal" ? block(f[k], LIM.legal) : (k === "addr" ? block(f[k], LIM.addr) : one(f[k], LIM[k]));
    });
    return o;
  }
  function normSig(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id)) return null;
    if (!isInt(x.m) || x.m <= 0) return null;
    var so = [];
    (Array.isArray(x.so) ? x.so : []).forEach(function (s) {
      if (so.length >= MAX_SOCIAL || !s || !SOCIAL[s.k]) return;
      var u = webUrl(s.u);
      if (u) so.push({ k: s.k, u: u });
    });
    var im = {}, ix = x.im && typeof x.im === "object" ? x.im : {};
    var lg = normImg(ix.logo), ph = normImg(ix.photo), bn = normImg(ix.ban, true);
    if (lg) im.logo = lg;
    if (ph) im.photo = ph;
    if (bn) im.ban = bn;
    var cta = x.cta && typeof x.cta === "object" ? { t: one(x.cta.t, LIM.ctaT), u: webUrl(x.cta.u) } : { t: "", u: "" };
    return {
      id: x.id, m: x.m,
      nm: one(x.nm, LIM.nm),
      lang: LANGS.indexOf(x.lang) >= 0 ? x.lang : "en",
      tpl: TEMPLATES.indexOf(x.tpl) >= 0 ? x.tpl : "classic",
      f: normFields(x.f),
      so: so,
      cta: cta,
      st: normSt(x.st),
      im: im,
      qr: x.qr === 1 ? 1 : 0
    };
  }

  // ---------- 4. Merge ----------
  function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }
  // merge(A, B) with B optional: also the normalizer.
  function merge(A, B) {
    var a = A && typeof A === "object" ? A : {}, b = B && typeof B === "object" ? B : {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object" || Array.isArray(tm)) return;
      Object.keys(tm).forEach(function (k) {
        if (!ID_RE.test(k) || !isInt(tm[k]) || tm[k] <= 0) return;
        if (!(k in tombs) || tm[k] > tombs[k]) tombs[k] = tm[k];
      });
    });
    var best = {};
    [a.sigs, b.sigs].forEach(function (list) {
      (Array.isArray(list) ? list : []).forEach(function (x) {
        var s = normSig(x);
        if (s) best[s.id] = newer(best[s.id], s);
      });
    });
    var sigs = [];
    Object.keys(best).sort(cmpStr).forEach(function (k) {
      if (k in tombs && tombs[k] >= best[k].m) return;
      sigs.push(best[k]);
    });
    var t = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (k) { t[k] = tombs[k]; });
    return { ver: DATA_VER, sigs: sigs, tombs: t };
  }
  function empty() { return { ver: DATA_VER, sigs: [], tombs: {} }; }
  function parse(raw) {
    if (typeof raw !== "string" || !raw) return empty();
    try { return merge(JSON.parse(raw), null); } catch (e) { return empty(); }
  }
  function byId(data, id) {
    for (var i = 0; i < data.sigs.length; i++) if (data.sigs[i].id === id) return data.sigs[i];
    return null;
  }
  function newId(rand) {
    var r = typeof rand === "function" ? rand : Math.random, s = "s";
    for (var i = 0; i < 12; i++) s += "0123456789abcdefghijklmnopqrstuvwxyz".charAt(Math.floor(r() * 36));
    return s;
  }
  function blank(id, now, lang) {
    return normSig({ id: id, m: now, nm: "", lang: lang === "el" ? "el" : "en", tpl: "classic",
                     f: {}, so: [], cta: {}, st: {}, im: {}, qr: 0 });
  }
  // Put a signature in (new or changed): its m is moved past the old
  // one and past its tombstone, so the change always wins.
  function put(data, sig, now) {
    var cur = merge(data, null), old = byId(cur, sig.id);
    if (!old && cur.sigs.length >= MAX_SIGS) return { data: cur, ok: false, why: "full" };
    var m = Math.max(now, old ? old.m + 1 : 0, (cur.tombs[sig.id] || 0) + 1);
    var s = normSig(Object.assign({}, sig, { m: m }));
    if (!s) return { data: cur, ok: false, why: "bad" };
    cur.sigs = cur.sigs.filter(function (x) { return x.id !== s.id; }).concat([s]);
    return { data: merge(cur, null), ok: true, sig: s };
  }
  function remove(data, id, now) {
    var cur = merge(data, null), old = byId(cur, id);
    if (!old) return cur;
    var add = {};
    add[id] = Math.max(now, old.m);
    return merge(cur, { tombs: add });
  }
  // A copy under a new id (Duplicate), label "… (copy)".
  function duplicate(sig, id, now, suffix) {
    var c = JSON.parse(JSON.stringify(sig));
    c.id = id; c.m = now;
    c.nm = one((sig.nm || sig.f.name || "") + " " + (suffix || "(copy)"), LIM.nm);
    return normSig(c);
  }
  function label(sig, fallback) {
    return sig.nm || sig.f.name || sig.f.company || fallback || "";
  }

  // ---------- 5. Building the HTML ----------
  // opts: { target: "embed" | "web" | "mail", today: "YYYY-MM-DD",
  //         short: bool (the short version for replies),
  //         src: { logo, photo, ban, qr, social: { kind: src } } }
  // Image sources are resolved by the app (data: from the orOS disk,
  // or the https address) and checked again here.
  function pick(sig, which, target, src) {
    var im = sig.im[which];
    var s = src && src[which];
    if (which === "qr") return sig.qr && target !== "web" ? imgSrc(s) : "";
    if (!im) return "";
    if (target === "web") return im.u || "";                 // Gmail / Outlook web: hosted only
    var e = imgSrc(s);
    return e || im.u || "";
  }
  function bannerOn(sig, today) {
    var b = sig.im.ban;
    if (!b) return false;
    var d = day(today) || "";
    if (d && b.from && d < b.from) return false;
    if (d && b.to && d > b.to) return false;
    return true;
  }
  function size(im, w, fallbackRatio) {
    var ratio = im && im.w > 0 && im.h > 0 ? im.h / im.w : (fallbackRatio || 1);
    return { w: Math.round(w), h: Math.max(1, Math.round(w * ratio)) };
  }
  function imgTag(src, wh, alt, round, extra) {
    return '<img src="' + esc(src) + '" width="' + wh.w + '" height="' + wh.h + '" alt="' + esc(alt) +
      '" style="display:block;border:0;outline:none;text-decoration:none;width:' + wh.w + 'px;height:' + wh.h +
      'px;' + (round ? "border-radius:50%;" : "") + (extra || "") + '">';
  }
  function linkTag(href, inner, color, extra) {
    return '<a href="' + esc(href) + '" style="color:' + color + ';text-decoration:none;' + (extra || "") + '">' + inner + '</a>';
  }

  // The pieces every template is made of; "" when empty.
  function parts(sig, opts) {
    var st = sig.st, f = sig.f, W = WORDS[sig.lang] || WORDS.en, target = opts.target || "embed";
    var src = opts.src || {};
    var font = FONTS[st.font], sz = st.size, acc = st.acc, txt = st.txt;
    var base = "font-family:" + font + ";font-size:" + sz + "px;line-height:1.45;color:" + txt + ";";
    var P = { base: base, acc: acc, txt: txt, sz: sz, font: font };
    var dim = "color:" + txt + ";opacity:0.85;";

    P.nameAcc = f.name ? '<span style="font-size:' + (sz + 4) + 'px;font-weight:bold;color:' + acc + ';">' + esc(f.name) + '</span>' +
      (f.pron ? '<span style="font-size:' + (sz - 1) + 'px;color:#888888;">&nbsp;(' + esc(f.pron) + ')</span>' : "") : "";
    P.name = f.name ? '<span style="font-size:' + (sz + 4) + 'px;font-weight:bold;color:' + txt + ';">' + esc(f.name) + '</span>' +
      (f.pron ? '<span style="font-size:' + (sz - 1) + 'px;color:#888888;">&nbsp;(' + esc(f.pron) + ')</span>' : "") : "";
    var role = [f.title, f.dept].filter(Boolean).map(esc).join(", ");
    P.role = role ? '<span style="' + dim + '">' + role + '</span>' : "";
    P.company = f.company ? '<span style="font-weight:bold;color:' + acc + ';">' + esc(f.company) + '</span>' : "";
    P.vat = f.vat ? '<span style="font-size:' + (sz - 1) + 'px;color:#888888;">' + esc(W.vat) + " " + esc(f.vat) + '</span>' : "";

    function lab(kind) {
      if (st.lab === "n") return "";
      var w = st.lab === "w" ? W[kind] : W["l" + kind];
      return '<span style="font-weight:bold;color:' + acc + ';">' + esc(w) + '</span>&nbsp;';
    }
    var lines = [];
    var tp = telUrl(f.phone), tm = telUrl(f.mobile), me = mailUrl(f.email), wu = webUrl(f.web);
    if (f.phone) lines.push(lab("phone") + (tp ? linkTag(tp, esc(f.phone), txt) : esc(f.phone)));
    if (f.mobile) lines.push(lab("mobile") + (tm ? linkTag(tm, esc(f.mobile), txt) : esc(f.mobile)));
    if (me) lines.push(lab("email") + linkTag(me, esc(f.email), txt));
    if (wu) lines.push(lab("web") + linkTag(wu, esc(showUrl(wu)), txt));
    P.contacts = lines;
    P.addr = f.addr ? '<span style="' + dim + '">' + esc(f.addr).replace(/\n/g, "<br>") + '</span>' : "";
    P.line = f.line ? '<span style="font-style:italic;color:' + txt + ';">' + esc(f.line) + '</span>' : "";

    // Social: drawn icons (embedded) or words (web target, or icons off)
    var so = [];
    sig.so.forEach(function (s) {
      var name = SOCIAL[s.k].n || W.other;
      var ic = st.icons && target !== "web" ? imgSrc(src.social && src.social[s.k]) : "";
      if (ic) so.push(linkTag(s.u, imgTag(ic, { w: 22, h: 22 }, name, false, "display:inline-block;"), acc));
      else so.push(linkTag(s.u, esc(name), acc, "font-weight:bold;"));
    });
    P.socialIcons = st.icons && target !== "web" && so.length && so[0].indexOf("<img") >= 0;
    P.social = so.length ? so.join(P.socialIcons ? "&nbsp;&nbsp;" : '<span style="color:#aaaaaa;">&nbsp;|&nbsp;</span>') : "";

    // The button: a "bulletproof" table cell, so Outlook draws it too
    var cu = sig.cta.u;
    P.cta = cu ? '<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;"><tr>' +
      '<td bgcolor="' + acc + '" style="background-color:' + acc + ';border-radius:4px;padding:6px 14px;">' +
      linkTag(cu, esc(sig.cta.t || W.cta), "#ffffff", "font-family:" + font + ";font-size:" + sz + "px;font-weight:bold;display:inline-block;") +
      '</td></tr></table>' : "";

    var logo = pick(sig, "logo", target, src), photo = pick(sig, "photo", target, src);
    var alt = f.company || f.name || "";
    P.logo = logo ? imgTag(logo, size(sig.im.logo, st.logoW, 0.4), alt, false) : "";
    // photos are square (the app crops embedded ones, round ones too)
    P.photo = photo ? imgTag(photo, { w: st.photoW, h: st.photoW }, f.name || alt, st.shape === "round", "object-fit:cover;") : "";
    // the small square picture of the Compact template
    P.thumb = photo ? imgTag(photo, { w: 48, h: 48 }, f.name || alt, st.shape === "round", "object-fit:cover;")
      : (logo ? imgTag(logo, size(sig.im.logo, 48, 0.4), alt, false) : "");
    var ban = bannerOn(sig, opts.today) ? pick(sig, "ban", target, src) : "";
    if (ban) {
      var b = sig.im.ban, bt = imgTag(ban, size(b, b.bw || 400, 0.25), alt, false);
      P.ban = b.link ? '<a href="' + esc(b.link) + '" style="text-decoration:none;">' + bt + '</a>' : bt;
    } else P.ban = "";
    var qr = pick(sig, "qr", target, src);
    P.qr = qr ? imgTag(qr, { w: 76, h: 76 }, "vCard", false) : "";
    P.legal = f.legal ? '<span style="font-size:' + Math.max(10, sz - 3) + 'px;line-height:1.35;color:#8a8a8a;">' +
      esc(f.legal).replace(/\n/g, "<br>") + '</span>' : "";
    return P;
  }

  function row(inner, pad) {
    return inner ? '<tr><td style="padding:' + (pad || "0") + ';">' + inner + '</td></tr>' : "";
  }
  function table(rows, extra) {
    return '<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;' + (extra || "") + '">' + rows + '</table>';
  }
  // Rows under the main block: social, button, banner, legal text.
  function tail(P, short) {
    if (short) return "";
    return row(P.social, "8px 0 0 0") + row(P.cta, "10px 0 0 0") + row(P.ban, "12px 0 0 0") + row(P.legal, "12px 0 0 0");
  }
  function textBlock(P, short, opts) {
    var r = row(P.name) + row(P.role) + row(P.company);
    if (short) return r + row(P.contacts.slice(0, 2).join("&nbsp;&nbsp;"), "4px 0 0 0");
    r += row(P.contacts.join("<br>"), "6px 0 0 0") + row(P.addr) + row(P.vat) + row(P.line, "6px 0 0 0");
    return r;
  }

  var TPL = {
    classic: function (P, short) {
      var div = P.st.div ? '<tr><td style="padding:8px 0;"><table cellpadding="0" cellspacing="0" border="0" role="presentation" width="60"><tr><td height="2" bgcolor="' + P.acc + '" style="height:2px;line-height:2px;font-size:0;background-color:' + P.acc + ';">&nbsp;</td></tr></table></td></tr>' : "";
      var head = short ? "" : row(P.logo, "0 0 10px 0");
      var top = row(P.name) + row(P.role) + row(P.company);
      var rest = short ? row(P.contacts.slice(0, 2).join("&nbsp;&nbsp;"), "4px 0 0 0")
        : div + row(P.contacts.join("<br>")) + row(P.addr) + row(P.vat) + row(P.line, "6px 0 0 0");
      var body = table(head + top + rest + tail(P, short));
      return P.qr && !short ? table('<tr><td valign="top" style="padding-right:16px;">' + body + '</td><td valign="bottom">' + P.qr + '</td></tr>') : body;
    },
    side: function (P, short) {
      var pic = P.photo || P.logo;
      var left = pic ? '<td valign="top" style="padding:0 14px 0 0;' + (P.st.div ? "border-right:2px solid " + P.acc + ";" : "") + '">' +
        pic + (P.photo && P.logo && !short ? '<div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>' + P.logo : "") +
        (P.qr && !short ? '<div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>' + P.qr : "") + '</td>' : "";
      var right = '<td valign="top" style="padding:0 0 0 ' + (pic ? 14 : 0) + 'px;">' + table(textBlock(P, short)) + '</td>';
      return table('<tr>' + left + right + '</tr>' + (short ? "" : '<tr><td colspan="2">' + table(tail(P, false)) + '</td></tr>'));
    },
    minimal: function (P, short) {
      var first = [P.name, P.role].filter(Boolean).join('<span style="color:#aaaaaa;">&nbsp;|&nbsp;</span>');
      var second = [P.company].concat(short ? P.contacts.slice(0, 1) : P.contacts).filter(Boolean)
        .join('<span style="color:#aaaaaa;">&nbsp;|&nbsp;</span>');
      return table(row(first) + row(second, "2px 0 0 0") + (short ? "" : row(P.addr) + row(P.vat) + row(P.line, "4px 0 0 0")) + tail(P, short));
    },
    bar: function (P, short) {
      var named = P.nameAcc;
      var inner = row(P.logo && !short ? P.logo : "", "0 0 8px 0") + row(named) + row(P.role) + row(P.company) +
        (short ? row(P.contacts.slice(0, 2).join("&nbsp;&nbsp;"), "4px 0 0 0")
               : row(P.contacts.join("<br>"), "6px 0 0 0") + row(P.addr) + row(P.vat) + row(P.line, "6px 0 0 0") + tail(P, false));
      return table('<tr><td width="4" bgcolor="' + P.acc + '" style="width:4px;background-color:' + P.acc + ';font-size:0;line-height:0;">&nbsp;</td>' +
        '<td valign="top" style="padding:2px 0 2px 12px;">' + table(inner) + '</td>' +
        (P.qr && !short ? '<td valign="bottom" style="padding-left:14px;">' + P.qr + '</td>' : "") + '</tr>');
    },
    compact: function (P, short) {
      var head = P.thumb ? table('<tr><td valign="middle" style="padding-right:10px;">' + P.thumb + '</td><td valign="middle">' + table(row(P.name) + row(P.role)) + '</td></tr>')
        : table(row(P.name) + row(P.role));
      return table(row(head) + row(P.company, "4px 0 0 0") + row((short ? P.contacts.slice(0, 2) : P.contacts).join("<br>"), "4px 0 0 0") +
        (short ? "" : row(P.line, "4px 0 0 0")) + tail(P, short));
    },
    plain: function (P, short) {
      return table(row(P.name) + row(P.role) + row(P.company) + row((short ? P.contacts.slice(0, 2) : P.contacts).join("<br>"), "4px 0 0 0") +
        (short ? "" : row(P.addr) + row(P.vat) + row(P.line, "4px 0 0 0") + row(P.social, "6px 0 0 0") +
        row(P.cta ? linkTag(P.ctaUrl, esc(P.ctaText), P.acc, "font-weight:bold;") : "", "6px 0 0 0") + row(P.legal, "10px 0 0 0")));
    }
  };

  function build(sig, opts) {
    opts = opts || {};
    sig = normSig(sig);
    if (!sig) return { html: "", text: "" };
    var target = opts.target === "web" || opts.target === "mail" ? opts.target : "embed";
    if (target === "mail") return { html: buildMail(sig, opts), text: toText(sig, opts) };
    var o = Object.assign({}, opts, { target: target });
    if (sig.tpl === "plain") o = Object.assign({}, o, { src: {} });
    var P = parts(sig, o);
    P.st = sig.st;
    P.ctaUrl = sig.cta.u; P.ctaText = sig.cta.t || (WORDS[sig.lang] || WORDS.en).cta;
    if (sig.tpl === "plain") { P.logo = P.photo = P.thumb = P.ban = P.qr = ""; }
    var inner = TPL[sig.tpl](P, !!opts.short);
    var html = '<div style="' + P.base + '">' + inner + '</div>';
    return { html: html, text: toText(sig, opts) };
  }

  // orOS Mail keeps only simple formatting (bold, colour, links,
  // pictures; mail/rich.js clean()), so its version is lines, not tables.
  function buildMail(sig, opts) {
    var f = sig.f, st = sig.st, W = WORDS[sig.lang] || WORDS.en, src = (opts && opts.src) || {}, out = [];
    var short = !!(opts && opts.short);
    function col(s) { return '<span style="color:' + st.acc + '">' + s + '</span>'; }
    function a(href, s) { return '<a href="' + esc(href) + '">' + s + '</a>'; }
    var logo = sig.tpl === "plain" || short ? "" : (imgSrc(src.logo) || (sig.im.logo && sig.im.logo.u) || "");
    if (logo && /^data:/.test(logo) && logo.length > 120 * 1024) logo = sig.im.logo && sig.im.logo.u || "";
    if (logo) {
      var wh = size(sig.im.logo, Math.min(st.logoW, 300), 0.4);
      out.push('<div><img src="' + esc(logo) + '" alt="' + esc(f.company || f.name) + '" width="' + wh.w + '" height="' + Math.min(600, wh.h) + '"></div>');
    }
    if (f.name) out.push("<div><b>" + esc(f.name) + "</b>" + (f.pron ? " (" + esc(f.pron) + ")" : "") + "</div>");
    var role = [f.title, f.dept].filter(Boolean).map(esc).join(", ");
    if (role) out.push("<div>" + role + "</div>");
    if (f.company) out.push("<div><b>" + col(esc(f.company)) + "</b></div>");
    function lab(k) { return st.lab === "n" ? "" : col("<b>" + esc(st.lab === "w" ? W[k] : W["l" + k]) + "</b>") + " "; }
    var me = mailUrl(f.email), wu = webUrl(f.web), c = [];
    if (f.phone) c.push(lab("phone") + esc(f.phone));
    if (f.mobile) c.push(lab("mobile") + esc(f.mobile));
    if (me) c.push(lab("email") + a(me, esc(f.email)));
    if (wu) c.push(lab("web") + a(wu, esc(showUrl(wu))));
    (short ? c.slice(0, 2) : c).forEach(function (l) { out.push("<div>" + l + "</div>"); });
    if (!short) {
      if (f.addr) out.push("<div>" + esc(f.addr).replace(/\n/g, "<br>") + "</div>");
      if (f.vat) out.push("<div>" + esc(W.vat) + " " + esc(f.vat) + "</div>");
      if (f.line) out.push("<div><i>" + esc(f.line) + "</i></div>");
      if (sig.so.length) out.push("<div>" + sig.so.map(function (s) { return a(s.u, esc(SOCIAL[s.k].n || W.other)); }).join(" | ") + "</div>");
      if (sig.cta.u) out.push("<div><b>" + a(sig.cta.u, esc(sig.cta.t || W.cta)) + "</b></div>");
      if (f.legal) out.push('<div><span style="color:#8a8a8a">' + esc(f.legal).replace(/\n/g, "<br>") + "</span></div>");
    }
    return out.join("");
  }

  // The plain-text version (text-only clients, the .txt file, and
  // the text part of every message).
  function toText(sig, opts) {
    sig = normSig(sig);
    if (!sig) return "";
    var f = sig.f, W = WORDS[sig.lang] || WORDS.en, st = sig.st, short = !!(opts && opts.short), L = [];
    if (f.name) L.push(f.name + (f.pron ? " (" + f.pron + ")" : ""));
    var role = [f.title, f.dept].filter(Boolean).join(", ");
    if (role) L.push(role);
    if (f.company) L.push(f.company);
    function lab(k) { return st.lab === "n" ? "" : (st.lab === "w" ? W[k] : W["l" + k]) + ": "; }
    var c = [];
    if (f.phone) c.push(lab("phone") + f.phone);
    if (f.mobile) c.push(lab("mobile") + f.mobile);
    if (mailUrl(f.email)) c.push(lab("email") + f.email);
    var wu = webUrl(f.web);
    if (wu) c.push(lab("web") + showUrl(wu));
    L = L.concat(short ? c.slice(0, 2) : c);
    if (!short) {
      if (f.addr) L = L.concat(f.addr.split("\n"));
      if (f.vat) L.push(W.vat + " " + f.vat);
      if (f.line) L.push(f.line);
      sig.so.forEach(function (s) { L.push((SOCIAL[s.k].n || W.other) + ": " + s.u); });
      if (sig.cta.u) L.push((sig.cta.t || W.cta) + ": " + sig.cta.u);
      if (f.legal) { L.push(""); L = L.concat(f.legal.split("\n")); }
    }
    return L.join("\n");
  }

  // A whole .html file (Thunderbird "Use HTML from a file", Outlook's
  // Signatures folder, Apple Mail, a browser to copy from).
  function htmlFile(sig, inner) {
    var title = esc(label(sig, "Signature"));
    return '<!DOCTYPE html>\n<html lang="' + sig.lang + '">\n<head>\n<meta charset="utf-8">\n<title>' + title +
      '</title>\n</head>\n<body style="margin:0;padding:16px;background:#ffffff;">\n' + inner + '\n</body>\n</html>\n';
  }

  // ---------- 6. Checks ----------
  // → [{ lvl: "warn" | "info", code, n? }] for the "Check" panel.
  function relLum(h) {
    var c = [1, 3, 5].map(function (i) {
      var v = parseInt(h.substr(i, 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) {
    var x = relLum(a), y = relLum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function checks(sig, opts) {
    sig = normSig(sig);
    opts = opts || {};
    var out = [];
    if (!sig) return out;
    var f = sig.f, target = opts.target || "embed";
    if (!f.name && !f.company) out.push({ lvl: "warn", code: "noname" });
    if (f.email && !mailUrl(f.email)) out.push({ lvl: "warn", code: "bademail" });
    if (f.web && !webUrl(f.web)) out.push({ lvl: "warn", code: "badweb" });
    if ((f.phone && !telUrl(f.phone)) || (f.mobile && !telUrl(f.mobile))) out.push({ lvl: "info", code: "badphone" });
    if (contrast(sig.st.acc, "#ffffff") < 3) out.push({ lvl: "warn", code: "lowacc" });
    if (contrast(sig.st.txt, "#ffffff") < 4.5) out.push({ lvl: "warn", code: "lowtxt" });
    if (target === "web") {
      ["logo", "photo", "ban"].forEach(function (k) {
        var im = sig.im[k];
        if (im && !im.u && sig.tpl !== "plain") out.push({ lvl: "warn", code: "needurl", n: k });
      });
      if (sig.qr) out.push({ lvl: "info", code: "noqrweb" });
      if (sig.so.length && sig.st.icons) out.push({ lvl: "info", code: "iconsweb" });
    }
    if (sig.im.ban && !bannerOn(sig, opts.today)) out.push({ lvl: "info", code: "banoff" });
    var len = typeof opts.html === "string" ? opts.html.length : 0;
    if (target === "web" && len > GMAIL_LIMIT) out.push({ lvl: "warn", code: "gmail", n: len });
    if (len > 100000) out.push({ lvl: "warn", code: "big", n: len });
    if (f.legal.length > 600) out.push({ lvl: "info", code: "longlegal" });
    return out;
  }

  // ---------- 7. vCard (the QR code) ----------
  function vtext(s) { return String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([;,])/g, "\\$1"); }
  function vcard(sig) {
    var f = sig.f, L = ["BEGIN:VCARD", "VERSION:3.0"];
    var parts = f.name.split(" "), last = parts.length > 1 ? parts.pop() : "", first = parts.join(" ");
    L.push("N:" + vtext(last) + ";" + vtext(first) + ";;;");
    L.push("FN:" + vtext(f.name || f.company));
    if (f.company) L.push("ORG:" + vtext(f.company) + (f.dept ? ";" + vtext(f.dept) : ""));
    if (f.title) L.push("TITLE:" + vtext(f.title));
    if (telUrl(f.mobile)) L.push("TEL;TYPE=CELL:" + telUrl(f.mobile).slice(4));
    if (telUrl(f.phone)) L.push("TEL;TYPE=WORK,VOICE:" + telUrl(f.phone).slice(4));
    if (mailUrl(f.email)) L.push("EMAIL;TYPE=INTERNET:" + f.email);
    if (webUrl(f.web)) L.push("URL:" + webUrl(f.web));
    if (f.addr) L.push("ADR;TYPE=WORK:;;" + vtext(f.addr.replace(/\n/g, ", ")) + ";;;;");
    L.push("END:VCARD");
    return L.join("\r\n");
  }

  // ---------- 8. Filling from other orOS apps ----------
  // Invoices business profile (OrosInvoicesCore normSeller fields).
  function fromInvoices(p) {
    p = p || {};
    var addr = [p.addr, p.country].map(function (x) { return one(x, 120); }).filter(Boolean).join(", ");
    return { company: one(p.trade || p.name, LIM.company), vat: one(p.afm, LIM.vat), phone: one(p.phone, LIM.phone),
             email: one(p.email, LIM.email), web: one(p.web, LIM.web), addr: addr };
  }
  // A Contacts card.
  function fromContact(c) {
    c = c || {};
    function first(list, pred) {
      list = Array.isArray(list) ? list : [];
      for (var i = 0; i < list.length; i++) if (list[i] && typeof list[i].v === "string" && list[i].v.trim() && (!pred || pred(list[i]))) return list[i].v;
      return "";
    }
    var name = [c.given, c.middle, c.family].map(function (x) { return one(x, 60); }).filter(Boolean).join(" ") || one(c.nickname, 60);
    var mob = first(c.phones, function (p) { return p.type === "mobile"; });
    var tel = first(c.phones, function (p) { return p.type !== "mobile"; });
    var a = Array.isArray(c.addresses) && c.addresses[0] ? c.addresses[0] : null;
    var addr = a ? [a.street, [a.zip, a.city].map(function (x) { return one(x, 60); }).filter(Boolean).join(" "), a.region, a.country]
      .map(function (x) { return one(x, 120); }).filter(Boolean).join(", ") : "";
    return { name: one(name, LIM.name), title: one(c.jobTitle, LIM.title), company: one(c.org, LIM.company),
             phone: one(tel, LIM.phone), mobile: one(mob, LIM.phone), email: one(first(c.emails), LIM.email),
             web: one(first(c.websites), LIM.web), addr: one(addr, LIM.addr) };
  }
  // Atelier brand kit (AtelierBrand record): colours + body font.
  var ATELIER_FONTS = { sans: "arial", serif: "georgia", mono: "courier" };
  function fromBrand(b) {
    b = b || {};
    var out = {};
    var cols = (Array.isArray(b.colors) ? b.colors : []).map(function (c) { return hex(c && c.c); }).filter(Boolean);
    // the first colour that reads on white is the accent
    for (var i = 0; i < cols.length; i++) if (contrast(cols[i], "#ffffff") >= 3) { out.acc = cols[i]; break; }
    var dark = cols.filter(function (c) { return contrast(c, "#ffffff") >= 7; });
    if (dark.length && dark[0] !== out.acc) out.txt = dark[0];
    var slot = b.fonts && (b.fonts.t || b.fonts.h);
    if (slot && typeof slot.f === "string") {
      if (ATELIER_FONTS[slot.f]) out.font = ATELIER_FONTS[slot.f];
      else {
        var nm = slot.f.replace(/^fs_/, "").replace(/_/g, "");
        Object.keys(FONTS).forEach(function (k) { if (nm.indexOf(k) === 0) out.font = k; });
      }
    }
    var lg = (Array.isArray(b.logos) ? b.logos : []).filter(function (l) { return l && ASSET_RE.test(l.a); })
      .sort(function (x, y) { return (x.pos || 0) - (y.pos || 0); });
    out.logos = lg.map(function (l) { return { a: l.a, w: l.w, h: l.h, nm: one(l.nm, 80) }; });
    return out;
  }

  // ---------- 9. Team signatures (CSV → one file per person) ----------
  // RFC 4180 with , or ; (Excel in Greek uses ;), quotes, new lines in quotes.
  function parseCSV(text) {
    text = String(text || "").replace(/^\uFEFF/, "");
    var firstLine = text.split(/\r?\n/)[0] || "";
    var sep = (firstLine.split(";").length > firstLine.split(",").length) ? ";" : ",";
    if (firstLine.split("\t").length > Math.max(firstLine.split(";").length, firstLine.split(",").length)) sep = "\t";
    var rows = [], rowA = [], cell = "", q = false, i = 0;
    for (; i < text.length; i++) {
      var ch = text.charAt(i);
      if (q) {
        if (ch === '"') { if (text.charAt(i + 1) === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
        continue;
      }
      if (ch === '"') { q = true; continue; }
      if (ch === sep) { rowA.push(cell); cell = ""; continue; }
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text.charAt(i + 1) === "\n") i++;
        rowA.push(cell); rows.push(rowA); rowA = []; cell = "";
        if (rows.length > 2000) break;
        continue;
      }
      cell += ch;
    }
    if (cell || rowA.length) { rowA.push(cell); rows.push(rowA); }
    return rows.filter(function (r) { return r.some(function (c) { return c.trim(); }); });
  }
  // Header names (EN + EL) → field keys.
  var HEAD = {
    name: ["name", "full name", "fullname", "όνομα", "ονοματεπώνυμο"],
    pron: ["pronouns", "αντωνυμίες"],
    title: ["title", "job title", "position", "role", "θέση", "τίτλος", "ιδιότητα"],
    dept: ["department", "dept", "team", "τμήμα"],
    email: ["email", "e-mail", "mail", "ηλ. ταχυδρομείο"],
    phone: ["phone", "telephone", "tel", "work phone", "τηλέφωνο", "τηλ.", "τηλ"],
    mobile: ["mobile", "cell", "mobile phone", "κινητό", "κιν."],
    photo: ["photo", "photo url", "picture", "image", "φωτογραφία"]
  };
  function fold(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim(); }
  function teamRows(text) {
    var rows = parseCSV(text);
    if (rows.length < 2) return { people: [], cols: [] };
    var map = {}, cols = [];
    rows[0].forEach(function (h, i) {
      var fh = fold(h);
      Object.keys(HEAD).forEach(function (k) {
        if (map[k] === undefined && HEAD[k].some(function (x) { return fold(x) === fh; })) { map[k] = i; cols.push(k); }
      });
    });
    if (map.name === undefined) return { people: [], cols: cols, error: "noname" };
    var people = [];
    rows.slice(1).forEach(function (r) {
      var p = {};
      Object.keys(map).forEach(function (k) { p[k] = one(r[map[k]] || "", k === "photo" ? LIM.url : LIM[k]); });
      if (p.name && people.length < 500) people.push(p);
    });
    return { people: people, cols: cols };
  }
  // The signature for one person: the person's fields over the template.
  function forPerson(sig, p) {
    var c = JSON.parse(JSON.stringify(sig));
    ["name", "pron", "title", "dept", "email", "phone", "mobile"].forEach(function (k) {
      if (p[k] !== undefined) c.f[k] = p[k];
    });
    // the template's own photo is someone else's: only the table's
    var u = httpsUrl(p.photo || "");
    if (u) c.im.photo = { u: u, w: 0, h: 0 };
    else delete c.im.photo;
    c.nm = p.name;
    return normSig(c);
  }
  // A file name from a label: letters, digits, - and _ (Greek kept).
  function fileStem(s, fallback) {
    var n = String(s || "").normalize("NFC").replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "").slice(0, 60);
    return n || fallback || "signature";
  }

  // ---------- 10. A small ZIP writer (stored entries, no compression) ----------
  var CRC = null;
  function crc32(bytes) {
    if (!CRC) {
      CRC = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        CRC[n] = c >>> 0;
      }
    }
    var x = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) x = CRC[(x ^ bytes[i]) & 0xFF] ^ (x >>> 8);
    return (x ^ 0xFFFFFFFF) >>> 0;
  }
  function utf8(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    return new Uint8Array(Buffer.from(s, "utf8"));
  }
  // files: [{ name, text }] → Uint8Array. Names are UTF-8 (flag bit 11).
  function zip(files, date) {
    var d = date instanceof Date ? date : new Date();
    var dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
    var dosDate = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var locals = [], centrals = [], off = 0, used = {};
    files.forEach(function (f) {
      var nm = f.name, k = 2;
      while (used[nm]) nm = f.name.replace(/(\.[^.]*)?$/, function (ext) { return "-" + k + (ext || ""); }), k++;
      used[nm] = 1;
      var name = utf8(nm), data = utf8(f.text), crc = crc32(data);
      var lh = new Uint8Array(30 + name.length), v = new DataView(lh.buffer);
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true);
      v.setUint16(8, 0, true); v.setUint16(10, dosTime, true); v.setUint16(12, dosDate, true);
      v.setUint32(14, crc, true); v.setUint32(18, data.length, true); v.setUint32(22, data.length, true);
      v.setUint16(26, name.length, true); v.setUint16(28, 0, true);
      lh.set(name, 30);
      var ch = new Uint8Array(46 + name.length), w = new DataView(ch.buffer);
      w.setUint32(0, 0x02014b50, true); w.setUint16(4, 20, true); w.setUint16(6, 20, true); w.setUint16(8, 0x0800, true);
      w.setUint16(10, 0, true); w.setUint16(12, dosTime, true); w.setUint16(14, dosDate, true);
      w.setUint32(16, crc, true); w.setUint32(20, data.length, true); w.setUint32(24, data.length, true);
      w.setUint16(28, name.length, true); w.setUint32(42, off, true);
      ch.set(name, 46);
      locals.push(lh, data); centrals.push(ch);
      off += lh.length + data.length;
    });
    var cdSize = centrals.reduce(function (s, c) { return s + c.length; }, 0);
    var end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    var all = locals.concat(centrals, [end]), total = all.reduce(function (s, c) { return s + c.length; }, 0);
    var out = new Uint8Array(total), p = 0;
    all.forEach(function (c) { out.set(c, p); p += c.length; });
    return out;
  }

  // ---------- 11. Prefs (this device) ----------
  var TARGETS = ["gmail", "outlookweb", "outlook", "thunderbird", "apple", "oros", "other"];
  // Which kind of HTML a mail client takes: hosted pictures only (web),
  // embedded pictures, or orOS Mail's simple formatting.
  function targetKind(t) {
    return t === "gmail" || t === "outlookweb" ? "web" : (t === "oros" ? "mail" : "embed");
  }
  function normPrefs(p) {
    p = p && typeof p === "object" ? p : {};
    return { cur: typeof p.cur === "string" && ID_RE.test(p.cur) ? p.cur : "",
             target: TARGETS.indexOf(p.target) >= 0 ? p.target : "gmail",
             dark: p.dark === true, phone: p.phone === true };
  }

  var API = {
    VERSION: VERSION, DATA_VER: DATA_VER, DATA_KEY: DATA_KEY, PREFS_KEY: PREFS_KEY, MAX_SIGS: MAX_SIGS,
    MAX_SOCIAL: MAX_SOCIAL, GMAIL_LIMIT: GMAIL_LIMIT, TEMPLATES: TEMPLATES, FONTS: FONTS, FONT_NAMES: FONT_NAMES,
    SOCIAL: SOCIAL, SOCIAL_KEYS: SOCIAL_KEYS, LIM: LIM, FIELDS: FIELDS, WORDS: WORDS, DEFAULT_ST: DEFAULT_ST,
    TARGETS: TARGETS, ID_RE: ID_RE, ASSET_RE: ASSET_RE,
    one: one, block: block, esc: esc, hex: hex, day: day,
    webUrl: webUrl, httpsUrl: httpsUrl, mailUrl: mailUrl, telUrl: telUrl, showUrl: showUrl, imgSrc: imgSrc,
    normSig: normSig, normSt: normSt, merge: merge, empty: empty, parse: parse, byId: byId, newId: newId,
    blank: blank, put: put, remove: remove, duplicate: duplicate, label: label,
    build: build, buildMail: buildMail, toText: toText, htmlFile: htmlFile, bannerOn: bannerOn,
    contrast: contrast, checks: checks, vcard: vcard,
    fromInvoices: fromInvoices, fromContact: fromContact, fromBrand: fromBrand,
    parseCSV: parseCSV, teamRows: teamRows, forPerson: forPerson, fileStem: fileStem,
    crc32: crc32, zip: zip, targetKind: targetKind, normPrefs: normPrefs
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && root.document) root.SignatureCore = API;
})(typeof window !== "undefined" ? window : globalThis);
