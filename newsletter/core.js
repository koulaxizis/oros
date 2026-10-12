// ============================================================
// orOS Newsletter — shared core (pure, no DOM)
// The model of the synced slice "newsletter" (oros-newsletter-data):
// normalize, the symmetric sync merge, subscriber status, ids and
// tokens, audiences, imports (CSV, pasted addresses), CSV export,
// the pre-send check, Inbox requests (subscribe / confirm /
// unsubscribe by e-mail) and delivery-failure reports (DSN), the
// sending-provider presets and the daily limit.
// Exposed as window.OrosNewsletterCore; module.exports in Node (tests).
//
// Data (v1):
//   { ver: 1,
//     chans:  [{ id, m, name, kind: "mail"|"smtp", acct, preset, host, port, sec, user,
//                inbox, rate (s between messages), cap (messages a day),
//                via: "smtp"|"api" (a provider's HTTP API, phase 3C), dom (Mailgun domain) }],
//     lists:  [{ id, m, name, chan, from, fromName, reply, lang, addr, why, theme, color, salt }],
//     subs:   [{ id, m, list, email, name, lang, tags[], src, basis, at, conf, off, offSt, inv, bnc, c }],
//     issues: [{ id, m, list, subj, pre, fmt: "blocks"|"md", blocks[], md, tags[], seg,
//                l2: { lang, subj, pre, fmt, blocks[], md }|null   (the other-language version),
//                st: "draft"|"sched"|"sending"|"paused"|"sent", when (sched: start time),
//                lock: { dev, at }|null, start, done, n, err, fail: { subId: code } }],
//     segs:   [{ id, m, list, name, tags[], match: "any"|"all", lang: ""|"en"|"el" }],
//     tpls:   [{ id, m, name, subj, pre, fmt, blocks[], md, l2 }],
//     rss:    [{ id, m, list, url, name, every: "day"|"week"|"month", wd, hour,
//                mode: "draft"|"send", max, seg, last (newest item used), ran, dev, on }],
//   issues may carry imp: 1 (imported from an archive: sent elsewhere).
//     sent:   { issueId: [subId, …] },     grow-only while an issue is out
//     supp:   [hash, …] }                   grow-only suppression list
//   Every record may instead be a tombstone { id, m, del: 1 }.
// A subscriber's status is never stored: it comes from three event
// times (status()), so two devices always agree on it after a merge.
// ============================================================
(function (root) {
  "use strict";

  var STORAGE_KEY = "oros-newsletter-data";
  var LIM = {
    chans: 10, lists: 20, subs: 5000, issues: 200, blocks: 60, text: 20000, md: 50000,
    name: 120, subj: 200, pre: 200, tags: 20, tag: 40, fail: 500, why: 1000, addr: 600,
    imgBytes: 400 * 1024, email: 254, segs: 50, tpls: 50, rss: 20, archive: 500,
    dataChars: 2500000
  };
  var KINDS = ["mail", "smtp"];
  var SECS = { 465: "tls", 587: "starttls" };
  var THEMES = ["classic", "warm", "dark", "plain"];
  var BASES = ["consent", "customer", "optin"];
  var SRCS = ["manual", "paste", "csv", "contacts", "mail", "crm", "form"];
  var OFF_STS = ["off", "bounce", "spam"];
  var ISSUE_STS = ["draft", "sched", "sending", "paused", "sent"];
  var BLOCK_KINDS = ["h", "p", "img", "btn", "hr", "cols"];
  var LOCK_STALE = 15 * 60 * 1000;       // a sending device silent this long lets another take over
  var SOFT_LIMIT = 3;                    // soft bounces before an address counts as bounced

  // Sending providers (SMTP). Starting points: the user checks the
  // host and their plan's limits in the provider's own docs.
  var PRESETS = {
    brevo:      { host: "smtp-relay.brevo.com", port: 587, rate: 1, cap: 300 },
    ses:        { host: "email-smtp.eu-west-1.amazonaws.com", port: 587, rate: 1, cap: 200 },
    mailgun:    { host: "smtp.mailgun.org", port: 587, rate: 1, cap: 100 },
    "mailgun-eu": { host: "smtp.eu.mailgun.org", port: 587, rate: 1, cap: 100 },
    postmark:   { host: "smtp.postmarkapp.com", port: 587, rate: 1, cap: 100, hdr: ["X-PM-Message-Stream", "broadcast"] },
    sendgrid:   { host: "smtp.sendgrid.net", port: 587, rate: 1, cap: 100, user: "apikey" },
    smtp2go:    { host: "mail.smtp2go.com", port: 587, rate: 1, cap: 200 },
    gmail:      { host: "smtp.gmail.com", port: 465, rate: 6, cap: 450 },
    other:      { host: "", port: 587, rate: 6, cap: 450 }
  };
  var MAIL_DEFAULTS = { rate: 6, cap: 450 };   // an ordinary mailbox (Mail account)
  // Providers whose HTTP API the relay's "papi" operation reaches
  // (relay/papi.js): up to API_BATCH messages per relay call, and their
  // bounces, complaints and unsubscribes can be read back.
  var API_PROVS = { brevo: 1, postmark: 1, sendgrid: 1, mailgun: 1, "mailgun-eu": 1 };
  var API_BATCH = 40;

  // ---------- small helpers ----------
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function nat(v, max) { return isInt(v) && v >= 0 && v <= (max || 9e15) ? v : 0; }
  function clamp(v, lo, hi, dflt) { return isInt(v) && v >= lo && v <= hi ? v : dflt; }
  function oneLine(v, max) {
    return typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  }
  function multi(v, max) {
    return typeof v === "string"
      ? v.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").replace(/[ \t]+$/gm, "").slice(0, max)
      : "";
  }
  function validId(v) { return typeof v === "string" && /^[a-z0-9][a-z0-9-]{2,39}$/.test(v); }
  var ADDR = /^[^\s@<>()",;:\\\[\]]+@[^\s@<>()",;:\\\[\]]+\.[^\s@<>()",;:\\\[\]]+$/;
  function validEmail(v) { return typeof v === "string" && v.length <= LIM.email && ADDR.test(v); }
  function normEmail(v) {
    var e = typeof v === "string" ? v.trim().replace(/^mailto:/i, "") : "";
    return validEmail(e) ? e : "";
  }
  function emailKey(e) { return String(e || "").trim().toLowerCase(); }
  function validHost(h) {
    if (typeof h !== "string") return false;
    h = h.trim().toLowerCase();
    return h.length >= 4 && h.length <= 253 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h) &&
           !/^[0-9.]+$/.test(h);
  }
  function validColor(c) { return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c); }
  function safeUrl(u) {
    u = typeof u === "string" ? u.trim() : "";
    if (u.length > 2000 || /[\x00-\x20"'<>\\`]/.test(u)) return "";
    return /^(https?:\/\/[^\/\s]+|mailto:[^\s]+@)/i.test(u) ? u : "";
  }
  function fold(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ς/g, "σ");
  }

  // cyrb53 (public domain, bryc): a fast 53-bit string hash, the same
  // in every browser and in Node. Ids and tokens only, never secrets.
  function hash53(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    var n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    var s = n.toString(36);
    while (s.length < 11) s = "0" + s;
    return s;
  }
  // The same address on the same list is the same subscriber on every
  // device: two devices adding it never make two records.
  function subId(listId, email) { return "s" + hash53(listId + "|" + emailKey(email)); }
  function suppHash(email) { return "x" + hash53("supp|" + emailKey(email)); }
  // The unsubscribe / confirm token of a subscriber (never stored):
  // derived from the list's random salt, so it can't be guessed from
  // the address, and it is the same on every device.
  function token(list, sid) { return "nl-" + hash53((list && list.salt || "") + "|" + sid); }
  // The code people put in the subject to subscribe to a list.
  function listCode(list) { return "nl-" + String(list && list.salt || "").slice(0, 6); }
  function randomId(prefix, rnd) {
    var r = rnd || Math.random, s = "";
    for (var i = 0; i < 10; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(r() * 36));
    return prefix + s;
  }

  // ---------- normalize ----------
  function tomb(x) { return { id: x.id, m: nat(x.m), del: 1 }; }
  function normTags(v) {
    var seen = {}, out = [];
    (Array.isArray(v) ? v : []).forEach(function (t) {
      var s = oneLine(t, LIM.tag);
      var k = fold(s);
      if (s && !seen[k] && out.length < LIM.tags) { seen[k] = 1; out.push(s); }
    });
    return out.sort();
  }
  function normChan(x) {
    var kind = KINDS.indexOf(x.kind) >= 0 ? x.kind : "mail";
    var o = { id: x.id, m: nat(x.m), name: oneLine(x.name, LIM.name), kind: kind,
              acct: "", preset: "", host: "", port: 587, sec: "starttls", user: "", inbox: "", via: "smtp", dom: "",
              rate: clamp(x.rate, 1, 600, kind === "mail" ? MAIL_DEFAULTS.rate : 1),
              cap: clamp(x.cap, 1, 100000, kind === "mail" ? MAIL_DEFAULTS.cap : 300) };
    if (kind === "mail") {
      o.acct = typeof x.acct === "string" && /^[a-z0-9]{6,40}$/.test(x.acct) ? x.acct : "";
      o.inbox = o.acct;
    } else {
      o.preset = PRESETS[x.preset] ? x.preset : "other";
      o.host = validHost(x.host) ? x.host.trim().toLowerCase() : "";
      o.port = SECS[x.port] ? x.port : 587;
      o.sec = SECS[o.port];
      o.user = oneLine(x.user, 320);
      o.inbox = typeof x.inbox === "string" && /^[a-z0-9]{6,40}$/.test(x.inbox) ? x.inbox : "";
      if (x.via === "api" && API_PROVS[o.preset]) {
        o.via = "api";
        if (/^mailgun/.test(o.preset) && validHost(x.dom)) o.dom = x.dom.trim().toLowerCase();
      }
    }
    return o;
  }
  function isApi(ch) { return !!ch && ch.kind === "smtp" && ch.via === "api"; }
  function normList(x) {
    return {
      id: x.id, m: nat(x.m), name: oneLine(x.name, LIM.name),
      chan: validId(x.chan) ? x.chan : "",
      from: normEmail(x.from), fromName: oneLine(x.fromName, LIM.name),
      reply: normEmail(x.reply), lang: x.lang === "el" ? "el" : "en",
      addr: multi(x.addr, LIM.addr).trim(), why: multi(x.why, LIM.why).trim(),
      theme: THEMES.indexOf(x.theme) >= 0 ? x.theme : "classic",
      color: validColor(x.color) ? x.color.toLowerCase() : "#2f6fde",
      salt: typeof x.salt === "string" && /^[a-z0-9]{8,32}$/.test(x.salt) ? x.salt : hash53("salt|" + x.id),
      form: normForm(x.form)
    };
  }
  // The web sign-up form + one-click unsubscribe kept by the relay
  // (relay/newsletter.js): its list key k, secret sec and private key
  // (RSA-OAEP-256 JWK). They guard only sign-ups for this list's data,
  // so they sync with it. dev: the device that collects (pulls) them.
  var JWK_PARTS = ["n", "e", "d", "p", "q", "dp", "dq", "qi"];
  function normForm(f) {
    if (!f || typeof f !== "object") return null;
    if (typeof f.k !== "string" || !/^[a-z0-9]{16}$/.test(f.k)) return null;
    if (typeof f.sec !== "string" || !/^[A-Za-z0-9]{32}$/.test(f.sec)) return null;
    var j = f.priv;
    if (!j || typeof j !== "object" || j.kty !== "RSA") return null;
    var priv = { kty: "RSA", alg: "RSA-OAEP-256" };
    for (var i = 0; i < JWK_PARTS.length; i++) {
      var v = j[JWK_PARTS[i]];
      if (typeof v !== "string" || !/^[A-Za-z0-9_-]{1,700}$/.test(v)) return null;
      priv[JWK_PARTS[i]] = v;
    }
    var back = safeUrl(f.back);
    return { k: f.k, sec: f.sec, priv: priv, back: /^https:\/\//i.test(back) && back.length <= 300 ? back : "",
             dev: typeof f.dev === "string" && /^[a-z0-9]{6,20}$/.test(f.dev) ? f.dev : "", at: nat(f.at) };
  }
  // The public half (what the relay keeps) of a form's private key.
  function formPub(f) { return f && f.priv ? { kty: "RSA", alg: "RSA-OAEP-256", n: f.priv.n, e: f.priv.e } : null; }
  // The subscriber's token as the relay's unsubscribe path wants it.
  function unsubPath(l, s) { return l && l.form && s ? "/nl/u/" + l.form.k + "/" + token(l, s.id).slice(3) : ""; }
  // The HTML form for the user's own site: no script, a hidden field
  // bots fill in (honeypot), the list's language.
  function formHtml(l, relay, words) {
    if (!l || !l.form) return "";
    var e = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]; }); };
    return "<form method=\"post\" action=\"" + e(relay + "/nl/s/" + l.form.k) + "\">\n" +
      "  <input type=\"email\" name=\"email\" required maxlength=\"254\" placeholder=\"" + e(words.email) + "\" aria-label=\"" + e(words.email) + "\">\n" +
      "  <input type=\"text\" name=\"name\" maxlength=\"120\" placeholder=\"" + e(words.name) + "\" aria-label=\"" + e(words.name) + "\">\n" +
      "  <input type=\"hidden\" name=\"lang\" value=\"" + l.lang + "\">\n" +
      "  <div style=\"position:absolute;left:-5000px\" aria-hidden=\"true\"><input type=\"text\" name=\"website\" tabindex=\"-1\" autocomplete=\"off\"></div>\n" +
      "  <button type=\"submit\">" + e(words.btn) + "</button>\n" +
      "</form>";
  }
  function normSub(x) {
    var email = normEmail(x.email);
    if (!email || !validId(x.list)) return null;
    var off = nat(x.off);
    return {
      id: x.id, m: nat(x.m), list: x.list, email: email, name: oneLine(x.name, LIM.name),
      lang: x.lang === "el" || x.lang === "en" ? x.lang : "",
      tags: normTags(x.tags),
      src: SRCS.indexOf(x.src) >= 0 ? x.src : "manual",
      basis: BASES.indexOf(x.basis) >= 0 ? x.basis : "consent",
      at: nat(x.at), conf: nat(x.conf), off: off,
      offSt: off ? (OFF_STS.indexOf(x.offSt) >= 0 ? x.offSt : "off") : "",
      inv: nat(x.inv), bnc: clamp(x.bnc, 0, 99, 0),
      c: typeof x.c === "string" && x.c.length <= 60 && !/[\x00-\x1f]/.test(x.c) ? x.c : ""
    };
  }
  function normBlock(b) {
    if (!b || typeof b !== "object" || BLOCK_KINDS.indexOf(b.k) < 0) return null;
    switch (b.k) {
      case "h": return { k: "h", t: oneLine(b.t, 300) };
      case "p": return { k: "p", t: multi(b.t, LIM.text) };
      case "btn": return { k: "btn", t: oneLine(b.t, 80), href: safeUrl(b.href) };
      case "hr": return { k: "hr" };
      case "cols": return { k: "cols", a: multi(b.a, LIM.text), b: multi(b.b, LIM.text) };
      case "img":
        return { k: "img",
                 f: typeof b.f === "string" && /^\/internal\/Newsletter\/[A-Za-z0-9._-]{1,80}\.(jpg|png)$/.test(b.f) ? b.f : "",
                 alt: oneLine(b.alt, 300), href: safeUrl(b.href),
                 w: clamp(b.w, 1, 4000, 600), h: clamp(b.h, 1, 8000, 400), b: clamp(b.b, 0, 10000000, 0) };
    }
    return null;
  }
  function normIssue(x) {
    var fail = {};
    if (x.fail && typeof x.fail === "object") {
      Object.keys(x.fail).sort().slice(0, LIM.fail).forEach(function (k) {
        if (validId(k)) fail[k] = oneLine(x.fail[k], 40) || "error";
      });
    }
    var lock = null;
    if (x.lock && typeof x.lock === "object" && typeof x.lock.dev === "string" && /^[a-z0-9]{6,20}$/.test(x.lock.dev)) {
      lock = { dev: x.lock.dev, at: nat(x.lock.at) };
    }
    var st = ISSUE_STS.indexOf(x.st) >= 0 ? x.st : "draft";
    var when = st === "sched" ? nat(x.when) : 0;
    if (st === "sched" && !when) st = "draft";
    var c = normContent(x);
    return {
      id: x.id, m: nat(x.m), list: validId(x.list) ? x.list : "",
      subj: c.subj, pre: c.pre, fmt: c.fmt, blocks: c.blocks, md: c.md,
      tags: normTags(x.tags), seg: validId(x.seg) ? x.seg : "",
      l2: normL2(x.l2),
      st: st, when: when, lock: st === "sending" || st === "sched" ? lock : null,
      start: nat(x.start), done: st === "sent" ? nat(x.done) : 0, n: nat(x.n),
      err: oneLine(x.err, 300), fail: fail, imp: x.imp === 1 && st === "sent" ? 1 : 0
    };
  }
  // The written part of an issue or template (subject … Markdown).
  function normContent(x) {
    return {
      subj: oneLine(x.subj, LIM.subj), pre: oneLine(x.pre, LIM.pre),
      fmt: x.fmt === "md" ? "md" : "blocks",
      blocks: (Array.isArray(x.blocks) ? x.blocks : []).map(normBlock).filter(Boolean).slice(0, LIM.blocks),
      md: multi(x.md, LIM.md)
    };
  }
  function normL2(v) {
    if (!v || typeof v !== "object" || (v.lang !== "en" && v.lang !== "el")) return null;
    var c = normContent(v);
    c.lang = v.lang;
    return c;
  }
  function normSeg(x) {
    if (!validId(x.list)) return null;
    return { id: x.id, m: nat(x.m), list: x.list, name: oneLine(x.name, LIM.name), tags: normTags(x.tags),
             match: x.match === "all" ? "all" : "any", lang: x.lang === "en" || x.lang === "el" ? x.lang : "" };
  }
  function normTpl(x) {
    var c = normContent(x);
    return { id: x.id, m: nat(x.m), name: oneLine(x.name, LIM.name), subj: c.subj, pre: c.pre, fmt: c.fmt,
             blocks: c.blocks, md: c.md, l2: normL2(x.l2) };
  }
  // A feed that becomes issues (RSS to e-mail), run by the device that
  // set it up (dev), on its schedule; `last` is the date of the newest
  // article already used, `ran` when it last ran.
  var EVERY = ["day", "week", "month"];
  function normRss(x) {
    if (!validId(x.list)) return null;
    var url = safeUrl(x.url);
    if (!/^https?:/i.test(url)) return null;
    return { id: x.id, m: nat(x.m), list: x.list, url: url, name: oneLine(x.name, LIM.name),
             every: EVERY.indexOf(x.every) >= 0 ? x.every : "week", wd: clampInt(x.wd, 0, 6, 1), hour: clampInt(x.hour, 0, 23, 9),
             mode: x.mode === "send" ? "send" : "draft", max: clampInt(x.max, 1, 20, 10), seg: validId(x.seg) ? x.seg : "",
             last: nat(x.last), ran: nat(x.ran),
             dev: typeof x.dev === "string" && /^[a-z0-9]{6,20}$/.test(x.dev) ? x.dev : "", on: x.on === 0 ? 0 : 1 };
  }
  function clampInt(v, lo, hi, def) {
    v = Math.round(Number(v));
    return isFinite(v) && v >= lo && v <= hi ? v : def;
  }
  function byId(a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); }
  function normColl(arr, fn, max) {
    var seen = {}, out = [];
    (Array.isArray(arr) ? arr : []).forEach(function (x) {
      if (!x || typeof x !== "object" || !validId(x.id) || seen[x.id]) return;
      var r = x.del ? tomb(x) : fn(x);
      if (!r) return;
      seen[x.id] = 1;
      out.push(r);
    });
    out.sort(byId);
    return max ? out.slice(0, max) : out;
  }
  function empty() { return { ver: 1, chans: [], lists: [], subs: [], issues: [], segs: [], tpls: [], rss: [], sent: {}, supp: [] }; }
  function normalize(d) {
    d = d && typeof d === "object" ? d : {};
    var o = empty();
    o.chans = normColl(d.chans, normChan, 200);
    o.lists = normColl(d.lists, normList, 400);
    var liveLists = {};
    o.lists.forEach(function (l) { if (!l.del) liveLists[l.id] = 1; });
    // a subscriber / issue of a deleted (or unknown) list goes with it
    o.subs = normColl(d.subs, normSub, 40000).filter(function (s) { return s.del || liveLists[s.list]; });
    o.issues = normColl(d.issues, normIssue, 2000).filter(function (x) { return x.del || liveLists[x.list]; });
    o.segs = normColl(d.segs, normSeg, 400).filter(function (x) { return x.del || liveLists[x.list]; });
    o.tpls = normColl(d.tpls, normTpl, 400);
    o.rss = normColl(d.rss, normRss, 200).filter(function (x) { return x.del || liveLists[x.list]; });
    var open = {};
    o.issues.forEach(function (x) { if (!x.del && (x.st === "sending" || x.st === "paused")) open[x.id] = 1; });
    var sent = d.sent && typeof d.sent === "object" ? d.sent : {};
    Object.keys(sent).sort().forEach(function (k) {
      if (!open[k] || !Array.isArray(sent[k])) return;
      var seen = {}, ids = [];
      sent[k].forEach(function (s) { if (validId(s) && !seen[s]) { seen[s] = 1; ids.push(s); } });
      if (ids.length) o.sent[k] = ids.sort();
    });
    var sp = {};
    (Array.isArray(d.supp) ? d.supp : []).forEach(function (h) { if (typeof h === "string" && /^x[0-9a-z]{11}$/.test(h)) sp[h] = 1; });
    o.supp = Object.keys(sp).sort();
    return o;
  }
  function parse(raw) {
    if (raw === null || raw === undefined || raw === "") return empty();
    try {
      var d = JSON.parse(raw);
      return d && typeof d === "object" ? normalize(d) : null;
    } catch (e) { return null; }
  }

  // ---------- subscriber status ----------
  // Three event times decide: the latest of "subscribed" (at),
  // "confirmed" (conf) and "left" (off).
  function status(s) {
    if (!s || s.del) return "";
    if (s.off && s.off > Math.max(s.at, s.conf)) return s.offSt || "off";
    return s.conf && s.conf >= s.at ? "on" : "pend";
  }

  // ---------- merge (symmetric: merge(a, b) equals merge(b, a)) ----------
  function cmpRec(a, b) {
    if (a.m !== b.m) return a.m > b.m ? a : b;
    if (!!a.del !== !!b.del) return a.del ? a : b;       // delete wins ties
    var ja = JSON.stringify(a), jb = JSON.stringify(b);
    return ja >= jb ? a : b;
  }
  var OFF_RANK = { off: 1, bounce: 2, spam: 3 };
  function mergeSub(a, b) {
    var w = cmpRec(a, b);
    if (a.del || b.del) return w;
    var o = JSON.parse(JSON.stringify(w));
    o.at = Math.max(a.at, b.at);
    o.conf = Math.max(a.conf, b.conf);
    o.inv = Math.max(a.inv, b.inv);
    o.bnc = Math.max(a.bnc, b.bnc);
    var src = a.off !== b.off ? (a.off > b.off ? a : b) : ((OFF_RANK[a.offSt] || 0) >= (OFF_RANK[b.offSt] || 0) ? a : b);
    o.off = src.off;
    o.offSt = src.off ? src.offSt : "";
    return o;
  }
  function mergeColl(a, b, fn) {
    var map = {};
    (a || []).forEach(function (x) { map[x.id] = x; });
    (b || []).forEach(function (x) { map[x.id] = map[x.id] ? (fn || cmpRec)(map[x.id], x) : x; });
    return Object.keys(map).map(function (k) { return map[k]; });
  }
  function mergeNewsletter(a, b) {
    var A = normalize(a), B = normalize(b);
    var o = {
      ver: 1,
      chans: mergeColl(A.chans, B.chans),
      lists: mergeColl(A.lists, B.lists),
      subs: mergeColl(A.subs, B.subs, mergeSub),
      issues: mergeColl(A.issues, B.issues),
      segs: mergeColl(A.segs, B.segs),
      tpls: mergeColl(A.tpls, B.tpls),
      rss: mergeColl(A.rss, B.rss),
      sent: {},
      supp: A.supp.concat(B.supp)
    };
    [A.sent, B.sent].forEach(function (s) {
      Object.keys(s).forEach(function (k) { o.sent[k] = (o.sent[k] || []).concat(s[k]); });
    });
    return normalize(o);
  }

  // ---------- lookups ----------
  function live(arr) { return (arr || []).filter(function (x) { return x && !x.del; }); }
  function find(arr, id) {
    for (var i = 0; i < (arr || []).length; i++) if (arr[i].id === id && !arr[i].del) return arr[i];
    return null;
  }
  function list(d, id) { return find(d.lists, id); }
  function chan(d, id) { return find(d.chans, id); }
  function issue(d, id) { return find(d.issues, id); }
  function sub(d, id) { return find(d.subs, id); }
  function subsOf(d, listId) { return live(d.subs).filter(function (s) { return s.list === listId; }); }
  function counts(d, listId) {
    var c = { all: 0, on: 0, pend: 0, off: 0, bounce: 0, spam: 0 };
    subsOf(d, listId).forEach(function (s) { c.all++; c[status(s)]++; });
    return c;
  }
  function allTags(d, listId) {
    var seen = {};
    subsOf(d, listId).forEach(function (s) { s.tags.forEach(function (t) { seen[t] = 1; }); });
    return Object.keys(seen).sort(function (x, y) { return fold(x) < fold(y) ? -1 : 1; });
  }
  function byToken(d) {
    var lists = {}, map = {};
    live(d.lists).forEach(function (l) { lists[l.id] = l; });
    live(d.subs).forEach(function (s) { if (lists[s.list]) map[token(lists[s.list], s.id)] = s; });
    return map;
  }
  function byCode(d) {
    var map = {};
    live(d.lists).forEach(function (l) { map[listCode(l)] = l; });
    return map;
  }

  // ---------- audience + sending progress ----------
  // Does a subscriber fit a segment? tags: any or all of them (none:
  // everyone); lang: the subscriber's language (or the list's).
  function segMatch(seg, s, list) {
    if (seg.lang && (s.lang || (list && list.lang) || "en") !== seg.lang) return false;
    if (!seg.tags.length) return true;
    var have = {};
    s.tags.forEach(function (t) { have[fold(t)] = 1; });
    var hit = seg.tags.filter(function (t) { return have[fold(t)]; }).length;
    return seg.match === "all" ? hit === seg.tags.length : hit > 0;
  }
  function seg(d, id) { return find(d.segs, id); }
  function segsOf(d, listId) { return live(d.segs).filter(function (g) { return g.list === listId; }); }
  // Active subscribers of the issue's list: those of its segment, or
  // with any of its tags (no tags: everyone), in id order.
  function audience(d, x) {
    var g = x.seg ? seg(d, x.seg) : null;
    if (x.seg && (!g || g.list !== x.list)) return [];      // its segment was deleted: nobody, never everyone
    var l = list(d, x.list);
    var want = {};
    (x.tags || []).forEach(function (t) { want[fold(t)] = 1; });
    var any = !(x.tags && x.tags.length);
    return subsOf(d, x.list).filter(function (s) {
      if (status(s) !== "on") return false;
      if (g) return segMatch(g, s, l);
      if (any) return true;
      return s.tags.some(function (t) { return want[fold(t)]; });
    });
  }
  // The language a subscriber reads: their own, else the list's.
  function langOf(s, l) { return (s && s.lang) || (l && l.lang) || "en"; }
  // The version of an issue (or template) for one language: the
  // second-language version when it is that language, else the main.
  function contentFor(x, lang) {
    var v = x.l2 && x.l2.lang === lang ? x.l2 : x;
    return { id: x.id, list: x.list, subj: v.subj, pre: v.pre, fmt: v.fmt, blocks: v.blocks, md: v.md };
  }
  // A scheduled issue whose time has come, on the device that
  // scheduled it (lock.dev: the sending passwords live there).
  function schedMine(x, dev) { return x.st === "sched" && (!dev || !x.lock || x.lock.dev === dev); }
  function schedDue(d, now, dev) {
    return live(d.issues).filter(function (x) { return schedMine(x, dev) && x.when <= now; })
      .sort(function (a, b) { return a.when - b.when || (a.id < b.id ? -1 : 1); });
  }
  function sentSet(d, issueId) {
    var m = {};
    (d.sent[issueId] || []).forEach(function (id) { m[id] = 1; });
    return m;
  }
  // → { total, sent, failed, left, next (subscriber or null) }
  // The next n subscribers of an issue's audience still to send to
  // (in the order progress() walks them).
  function nextSubs(d, x, n) {
    var done = sentSet(d, x.id), fail = x.fail || {}, out = [];
    audience(d, x).forEach(function (s) { if (out.length < n && !done[s.id] && !fail[s.id]) out.push(s); });
    return out;
  }
  function progress(d, x) {
    var aud = audience(d, x), done = sentSet(d, x.id), fail = x.fail || {};
    var sent = Object.keys(done).length, failed = Object.keys(fail).length, next = null, left = 0;
    aud.forEach(function (s) {
      if (done[s.id] || fail[s.id]) return;
      left++;
      if (!next) next = s;
    });
    if (x.st === "sent") return { total: x.n + failed, sent: x.n, failed: failed, left: 0, next: null };
    return { total: sent + failed + left, sent: sent, failed: failed, left: left, next: next };
  }
  // Who may send the issue now: this device holds the lock, or the
  // lock is free or stale.
  function canSend(x, dev, now) {
    if (x.st !== "sending") return false;
    return !x.lock || x.lock.dev === dev || now - x.lock.at > LOCK_STALE;
  }
  // Pending subscribers whose confirmation request has not gone out yet.
  function invitesDue(d, listId) {
    return subsOf(d, listId).filter(function (s) { return status(s) === "pend" && s.inv < s.at; });
  }
  // Device-local daily counter { chanId: { d: "YYYY-MM-DD", n } }.
  function usedToday(used, chanId, dayKey) {
    var u = used && used[chanId];
    return u && u.d === dayKey ? nat(u.n) : 0;
  }

  // ---------- imports ----------
  function parseCsv(text) {
    text = String(text || "").replace(/^﻿/, "");
    var first = text.split(/\r?\n/)[0] || "";
    var delims = [",", ";", "\t"], delim = ",", best = -1;
    delims.forEach(function (c) { var n = first.split(c).length; if (n > best) { best = n; delim = c; } });
    var rows = [], row = [], cur = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (q) {
        if (ch === "\"") {
          if (text.charAt(i + 1) === "\"") { cur += "\""; i++; } else q = false;
        } else cur += ch;
        continue;
      }
      if (ch === "\"" && cur === "") { q = true; continue; }
      if (ch === delim) { row.push(cur); cur = ""; continue; }
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text.charAt(i + 1) === "\n") i++;
        row.push(cur); cur = "";
        if (row.some(function (c) { return c.trim(); })) rows.push(row);
        row = [];
        if (rows.length > LIM.subs * 4) break;
        continue;
      }
      cur += ch;
    }
    row.push(cur);
    if (row.some(function (c) { return c.trim(); })) rows.push(row);
    return rows;
  }
  // CSV rows → [{ email, name, tags[], lang }] + how many rows had no address.
  function peopleFromRows(rows) {
    if (!rows.length) return { people: [], bad: 0 };
    var head = rows[0].map(function (h) { return fold(String(h).trim()).replace(/[\s_-]+/g, ""); });
    var col = function (re) { for (var i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; };
    var ie = col(/^(e?mail|emailaddress|email1|ηλεκτρονικοταχυδρομειο|διευθυνσηemail)$/);
    var hasHead = ie >= 0;
    var iname = col(/^(name|fullname|ονομα|ονοματεπωνυμο|displayname)$/);
    var ifirst = col(/^(firstname|first|givenname|μικροονομα)$/);
    var ilast = col(/^(lastname|last|surname|familyname|επωνυμο)$/);
    var itags = col(/^(tags?|groups?|labels?|ετικετεσ|ομαδεσ)$/);
    var ilang = col(/^(lang|language|γλωσσα)$/);
    var body = rows;
    if (hasHead) body = rows.slice(1);
    else {
      // no header: the first column holding an address in the first row
      ie = rows[0].findIndex(function (c) { return validEmail(String(c).trim()); });
      if (ie < 0) return { people: [], bad: rows.length };
    }
    var people = [], bad = 0;
    body.forEach(function (r) {
      var email = normEmail(String(r[ie] || ""));
      if (!email) { bad++; return; }
      var name = iname >= 0 ? String(r[iname] || "") : "";
      if (!name && (ifirst >= 0 || ilast >= 0)) name = [ifirst >= 0 ? r[ifirst] : "", ilast >= 0 ? r[ilast] : ""].join(" ");
      var tags = itags >= 0 ? String(r[itags] || "").split(/[,;|]/) : [];
      var lang = ilang >= 0 ? fold(String(r[ilang] || "")).trim() : "";
      people.push({ email: email, name: oneLine(name, LIM.name), tags: normTags(tags),
                    lang: /^(el|gr|ελληνικα|greek)/.test(lang) ? "el" : (/^(en|english|αγγλικα)/.test(lang) ? "en" : "") });
    });
    return { people: people, bad: bad };
  }
  // Pasted text: "Name <a@b>, c@d" or one per line.
  function peopleFromText(text) {
    var people = [], bad = 0;
    String(text || "").split(/[\n,;]+/).forEach(function (p) {
      p = p.trim();
      if (!p) return;
      var m = /^(.*?)<\s*([^<>\s]+)\s*>\s*$/.exec(p);
      var name = m ? m[1].trim().replace(/^"(.*)"$/, "$1") : "";
      var email = normEmail(m ? m[2] : p);
      if (!email) { bad++; return; }
      people.push({ email: email, name: oneLine(name, LIM.name), tags: [], lang: "" });
    });
    return { people: people, bad: bad };
  }
  // What adding `people` to a list would do. Nothing is changed.
  //   → { add: [subscriber], dup, supp, left, over, bad }
  // dup: already on the list (kept as they are); supp: deleted for good
  // earlier; left: unsubscribed or bounced earlier (an import never
  // brings them back); over: past the subscriber limit.
  function planImport(d, listId, people, opts) {
    opts = opts || {};
    var now = opts.now || Date.now();
    var basis = BASES.indexOf(opts.basis) >= 0 ? opts.basis : "optin";
    var src = SRCS.indexOf(opts.src) >= 0 ? opts.src : "csv";
    var supp = {};
    d.supp.forEach(function (h) { supp[h] = 1; });
    var existing = {};
    d.subs.forEach(function (s) { existing[s.id] = s; });
    var room = LIM.subs - live(d.subs).length;
    var out = { add: [], dup: 0, supp: 0, left: 0, over: 0, bad: opts.bad || 0 };
    var seen = {};
    people.forEach(function (p) {
      var id = subId(listId, p.email);
      if (seen[id]) { out.dup++; return; }
      seen[id] = 1;
      var cur = existing[id];
      if (cur && !cur.del) {
        if (OFF_STS.indexOf(status(cur)) >= 0) out.left++;
        else out.dup++;
        return;
      }
      if (supp[suppHash(p.email)]) { out.supp++; return; }
      if (out.add.length >= room) { out.over++; return; }
      out.add.push(normSub({
        id: id, m: Math.max(now, cur ? cur.m + 1 : 0), list: listId, email: p.email, name: p.name,
        lang: p.lang, tags: (p.tags || []).concat(opts.tags || []), src: src, basis: basis,
        at: now, conf: basis === "optin" ? 0 : now, c: p.c || ""
      }));
    });
    return out;
  }

  // ---------- export ----------
  function csvCell(v) {
    var s = String(v === undefined || v === null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;                   // no formulas in Excel / Calc
    return /[";\n\r]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
  }
  function iso(ms) { return ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : ""; }
  // heads: column titles in the user's language; st(s) → status name
  function subsCsv(d, listId, heads, stName, basisName) {
    var lines = [heads.map(csvCell).join(";")];
    subsOf(d, listId).sort(function (a, b) { return a.email < b.email ? -1 : 1; }).forEach(function (s) {
      lines.push([s.email, s.name, s.lang, s.tags.join(", "), stName(status(s)), s.src, basisName(s.basis),
                  iso(s.at), iso(s.conf), iso(s.off)].map(csvCell).join(";"));
    });
    return "﻿" + lines.join("\r\n") + "\r\n";
  }
  // Everything kept about one person (right of access).
  function personData(d, email) {
    var k = emailKey(email);
    return {
      email: email,
      exported: new Date().toISOString(),
      subscriptions: live(d.subs).filter(function (s) { return emailKey(s.email) === k; }).map(function (s) {
        var l = list(d, s.list) || {};
        return { list: l.name || "", name: s.name, language: s.lang, tags: s.tags, status: status(s),
                 source: s.src, basis: s.basis, consentText: l.why || "",
                 subscribed: s.at ? new Date(s.at).toISOString() : "",
                 confirmed: s.conf ? new Date(s.conf).toISOString() : "",
                 left: s.off ? new Date(s.off).toISOString() : "",
                 invitationSent: s.inv ? new Date(s.inv).toISOString() : "", bounces: s.bnc };
      })
    };
  }

  // ---------- pre-send check ----------
  // {name}, {first}, {name|friend}, {first|friend} are the only
  // placeholders; anything else in braces is probably a typo.
  function badPlaceholders(text) {
    var m, re = /\{([^{}\n]{0,80})\}/g;
    while ((m = re.exec(String(text || "")))) {
      if (!/^(name|first)(\|[^{}|]{0,60})?$/.test(m[1])) return true;
    }
    return false;
  }
  // info: { imgBytes, chan (resolved or null), inbox (bool), aud (number) }
  // → [{ lvl: "err"|"warn", k }]
  function preflight(d, x, info) {
    info = info || {};
    var out = [];
    var add = function (lvl, k) { out.push({ lvl: lvl, k: k }); };
    var l = list(d, x.list);
    // the main version and, when there is one, the other language
    [x].concat(x.l2 ? [x.l2] : []).forEach(function (v) {
      if (!v.subj) add("err", "noSubj");
      else {
        if (v.subj.length > 90) add("warn", "longSubj");
        var letters = v.subj.replace(/[^A-Za-zΑ-Ωα-ωΆ-ώ]/g, "");
        if (letters.length >= 8 && letters === letters.toUpperCase()) add("warn", "shouty");
        if (/!!|\$\$\$|€€€/.test(v.subj)) add("warn", "shouty");
      }
      var hasBody = v.fmt === "md" ? !!v.md.trim() : v.blocks.some(function (b) {
        if (b.k === "img") return !!b.f;
        return b.k !== "hr" && !!(b.t || b.a || b.b);
      });
      if (!hasBody) add("err", "noBody");
      if (v.fmt === "blocks" && v.blocks.some(function (b) { return (b.k === "btn" && (!b.href || !b.t)) || (b.k === "img" && !b.f); })) {
        add("err", "badBlock");
      }
      var text = v.fmt === "md" ? v.md : v.blocks.map(function (b) { return [b.t, b.a, b.b].join(" "); }).join(" ");
      if (badPlaceholders(text + " " + v.subj)) add("warn", "placeholder");
    });
    if (!l || !l.addr) add("err", "noAddr");
    if (!l || !l.from) add("err", "noFrom");
    if (!info.chan) add("err", "noChan");
    // Brevo's API can't carry pictures inside a message (no Content-ID)
    else if (isApi(info.chan) && info.chan.preset === "brevo" &&
             [x].concat(x.l2 ? [x.l2] : []).some(function (v) { return v.fmt === "blocks" && v.blocks.some(function (b) { return b.k === "img" && b.f; }); })) {
      add("err", "apiImg");
    }
    if (info.inbox === false) add("warn", "noInbox");
    if ((info.imgBytes || 0) > LIM.imgBytes) add("warn", "bigImgs");
    if (x.seg && !seg(d, x.seg)) add("err", "segGone");
    else if (!(info.aud > 0)) add("err", "noAudience");
    // keep each finding once, errors first
    var seen = {};
    return out.filter(function (r) { var k = r.lvl + r.k; if (seen[k]) return false; seen[k] = 1; return true; })
      .sort(function (a, b) { return a.lvl === b.lvl ? 0 : (a.lvl === "err" ? -1 : 1); });
  }

  // ---------- Inbox requests ----------
  // The subject of a request e-mail: "unsubscribe nl-…", "confirm nl-…",
  // "subscribe nl-…" (also after "Re:" and similar).
  function classify(subject) {
    var s = String(subject || "").toLowerCase();
    var m = /\b(unsubscribe|subscribe|confirm)\s+(nl-[a-z0-9]{6,11})\b/.exec(s);
    if (!m) return null;
    var tok = m[2];
    if (m[1] === "subscribe") return tok.length === 9 ? { act: "sub", code: tok } : null;
    return tok.length === 14 ? { act: m[1] === "confirm" ? "confirm" : "unsub", tok: tok } : null;
  }
  function isBounceFrom(addr, name) {
    return /^(mailer-daemon|postmaster|mail-daemon|bounce[s]?)@/i.test(String(addr || "")) ||
           /mail delivery (sub)?system|mail delivery subsystem|delivery status notification/i.test(String(name || ""));
  }
  // A delivery-failure report (RFC 3464, plus the common
  // X-Failed-Recipients header) → [{ addr, hard }]. "delayed" reports
  // are ignored: the server is still trying.
  function parseDsn(raw) {
    var text = String(raw || "").replace(/\r\n?/g, "\n");
    var out = [], seen = {};
    var push = function (addr, hard) {
      var e = normEmail(String(addr || "").replace(/^<|>$/g, ""));
      if (!e || seen[emailKey(e)]) return;
      seen[emailKey(e)] = 1;
      out.push({ addr: e, hard: hard });
    };
    var xf = /^X-Failed-Recipients:\s*(.+(?:\n[ \t].+)*)/im.exec(text);
    if (xf) xf[1].split(/[,\s]+/).forEach(function (a) { if (a) push(a, true); });
    var cur = null;
    var flush = function () {
      if (cur && cur.addr && cur.action === "failed") push(cur.addr, !/^4/.test(cur.status || "5"));
      cur = null;
    };
    text.split("\n").forEach(function (line) {
      var m;
      if ((m = /^Final-Recipient:\s*[a-z0-9-]+\s*;\s*(\S+)/i.exec(line))) { flush(); cur = { addr: m[1] }; return; }
      if (!cur) return;
      if ((m = /^Action:\s*([a-z]+)/i.exec(line))) cur.action = m[1].toLowerCase();
      else if ((m = /^Status:\s*([245]\.\d{1,3}\.\d{1,3})/i.exec(line))) cur.status = m[1];
      else if (!line.trim()) flush();
    });
    flush();
    return out;
  }

  // ---------- the issue as a web page / file name ----------
  function slug(s) {
    return fold(s).replace(/[^a-z0-9α-ω]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)
      .replace(/σ(?=-|$)/g, "ς") || "issue";
  }

  // ---------- backup ----------
  function toBackup(d) { return JSON.stringify({ app: "newsletter", ver: 1, data: normalize(d) }); }
  function fromBackup(text) {
    try {
      var j = JSON.parse(text);
      if (!j || j.app !== "newsletter" || !j.data || typeof j.data !== "object") return null;
      return normalize(j.data);
    } catch (e) { return null; }
  }

  // ---------- RSS to e-mail ----------
  // The next run after `after` (local time): every day at `hour`, every
  // week on weekday `wd` (0 = Sunday), every month on the 1st.
  function rssNext(r, after) {
    var d = new Date(after);
    d.setMinutes(0, 0, 0);
    d.setHours(r.hour);
    if (r.every === "month") { d.setDate(1); if (d.getTime() <= after) d.setMonth(d.getMonth() + 1); return d.getTime(); }
    if (d.getTime() <= after) d.setDate(d.getDate() + 1);
    if (r.every === "week") while (d.getDay() !== r.wd) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  // Due on this device: on, set up here, and its time came since it last
  // ran (a new feed waits for its first slot).
  function rssDue(d, now, dev) {
    return live(d.rss).filter(function (r) {
      return r.on && (!r.dev || r.dev === dev) && now >= rssNext(r, r.ran || r.m);
    });
  }
  // Articles newer than the last ones used (all the newest on the first
  // run), newest first, at most r.max. items: Reader's parsed items.
  function rssPick(r, items) {
    return (items || []).filter(function (it) { return it && it.title && safeUrl(it.link) && (!r.last || (it.date || 0) > r.last); })
      .sort(function (a, b) { return (b.date || 0) - (a.date || 0); }).slice(0, r.max);
  }
  var MORE = { en: "Read more", el: "Διαβάστε περισσότερα" };
  // A feed's text as one plain paragraph: nothing at its start that the
  // Markdown reader would take for a heading, list, picture or button.
  function mdLine(s) { return oneLine(s, 600).replace(/^(?:[#>*_+=|-]|\d+[.)]|!?\[+|\s)+/, ""); }
  // The issue's Markdown: per article a heading, its picture, a few
  // lines and a button to the article.
  function digestMd(items, lang) {
    return items.map(function (it) {
      var out = ["## " + oneLine(it.title, 300)];
      var img = safeUrl(it.img);
      if (/^https:\/\/[^)\s]+$/.test(img)) out.push("![](" + img + ")");
      var snip = oneLine(it.snip, 600);
      if (snip) out.push(mdLine(snip));
      out.push("[[" + (MORE[lang] || MORE.en) + "](" + safeUrl(it.link).replace(/\)/g, "%29") + ")]");
      return out.join("\n\n");
    }).join("\n\n---\n\n").slice(0, LIM.md);
  }
  // A new issue (draft) from a feed run.
  function digestIssue(r, l, items, id) {
    var lang = (l && l.lang) || "en";
    var first = items[0] ? oneLine(items[0].title, 160) : "";
    return normIssue({ id: id, m: 0, list: r.list, seg: r.seg, fmt: "md", md: digestMd(items, lang),
                       subj: r.name ? r.name + (first ? ": " + first : "") : first,
                       pre: items.slice(1, 4).map(function (it) { return oneLine(it.title, 80); }).join(" · "),
                       tags: [], st: "draft" });
  }

  // ---------- provider HTTP APIs (phase 3C) ----------
  // The request that checks an API key (relay "papi").
  function apiCheckReq(ch) {
    var p = ch.preset;
    if (p === "brevo") return { m: "GET", path: "/account" };
    if (p === "postmark") return { m: "GET", path: "/server" };
    if (p === "sendgrid") return { m: "GET", path: "/user/profile" };
    return { m: "GET", path: "/domains/" + ch.dom };
  }
  function ymd(ms) { return new Date(ms).toISOString().slice(0, 10); }
  // Requests that read bounces, complaints and unsubscribes since `since`
  // (ms) → [{ m, path, k }], k says how to read the answer (apiEvents).
  function apiEventReqs(ch, since, now) {
    var p = ch.preset, from = ymd(since), to = ymd(now), secs = Math.floor(since / 1000);
    var q = function (path, k) { return { m: "GET", path: path, k: k }; };
    if (p === "brevo") {
      return ["hardBounces", "spam", "unsubscribed"].map(function (ev) {
        return q("/smtp/statistics/events?event=" + ev + "&limit=500&offset=0&startDate=" + from + "&endDate=" + to, ev);
      });
    }
    if (p === "postmark") return [q("/bounces?count=500&offset=0&fromdate=" + from, "bounces")];
    if (p === "sendgrid") {
      return ["bounces", "spam_reports", "unsubscribes"].map(function (k) { return q("/suppression/" + k + "?start_time=" + secs + "&limit=500", k); });
    }
    return ["bounces", "complaints", "unsubscribes"].map(function (k) { return q("/" + ch.dom + "/" + k + "?limit=1000", k); });
  }
  // One answer of apiEventReqs → [{ addr, ev: "bounce"|"spam"|"off", at (ms, 0 unknown) }]
  // (soft bounces are left out: the provider retries them itself)
  function apiEvents(prov, k, body) {
    var j = null;
    try { j = JSON.parse(body); } catch (e) { return []; }
    var out = [];
    var add = function (addr, ev, at) {
      addr = normEmail(addr);
      if (addr && out.length < 2000) out.push({ addr: addr, ev: ev, at: isFinite(at) && at > 0 ? at : 0 });
    };
    var arr = function (v) { return Array.isArray(v) ? v : []; };
    if (prov === "brevo") {
      var bev = { hardBounces: "bounce", spam: "spam", unsubscribed: "off" }[k];
      arr(j && j.events).forEach(function (e) { if (e && bev) add(e.email, bev, Date.parse(e.date)); });
    } else if (prov === "postmark") {
      var ptype = { HardBounce: "bounce", BadEmailAddress: "bounce", SpamComplaint: "spam", Unsubscribe: "off" };
      arr(j && j.Bounces).forEach(function (b) { if (b && ptype[b.Type]) add(b.Email, ptype[b.Type], Date.parse(b.BouncedAt)); });
    } else if (prov === "sendgrid") {
      var sev = { bounces: "bounce", spam_reports: "spam", unsubscribes: "off" }[k];
      arr(j).forEach(function (e) { if (e && sev) add(e.email, sev, typeof e.created === "number" ? e.created * 1000 : 0); });
    } else {
      var mev = { bounces: "bounce", complaints: "spam", unsubscribes: "off" }[k];
      arr(j && j.items).forEach(function (e) {
        // Mailgun keeps soft failures out of "bounces" unless they turned permanent (5xx)
        if (e && mev && (mev !== "bounce" || !e.code || /^5/.test(String(e.code)))) add(e.address, mev, Date.parse(e.created_at));
      });
    }
    return out;
  }
  // One send answer ({ status, body } | { err }) → { k: "ok"|"refused"|"auth"|"rate"|"retry"|"no", msg }
  function apiOutcome(prov, r) {
    if (!r || r.err || !r.status) return { k: "retry", msg: r && r.err || "" };
    var st = r.status, j = null;
    try { j = JSON.parse(r.body || "null"); } catch (e) {}
    var text = j ? (j.Message || j.message || (Array.isArray(j.errors) && j.errors[0] && j.errors[0].message) || "") : "";
    var msg = oneLine("HTTP " + st + (text ? " " + text : ""), 120);
    if (st >= 200 && st < 300) {
      if (prov === "postmark" && j && j.ErrorCode) {            // Postmark answers some refusals with 200
        return j.ErrorCode === 300 || j.ErrorCode === 406 ? { k: "refused", msg: msg } : { k: "no", msg: msg };
      }
      return { k: "ok", msg: "" };
    }
    if (st === 401 || st === 403) return { k: "auth", msg: msg };
    if (st === 429) return { k: "rate", msg: msg };
    if (st >= 500) return { k: "retry", msg: msg };
    // a refused address (and not the whole message)
    if (prov === "postmark" && j && (j.ErrorCode === 300 || j.ErrorCode === 406)) return { k: "refused", msg: msg };
    if (prov === "sendgrid" && j && Array.isArray(j.errors) && j.errors.some(function (e) { return e && /^personalizations\.\d+\.to/.test(e.field || ""); })) {
      return { k: "refused", msg: msg };
    }
    if (prov === "brevo" && j && /email/i.test(String(j.message || "")) && /invalid|not valid|blocked|blacklist/i.test(String(j.message || ""))) return { k: "refused", msg: msg };
    return { k: "no", msg: msg };
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY, LIM: LIM, PRESETS: PRESETS, MAIL_DEFAULTS: MAIL_DEFAULTS, SECS: SECS,
    THEMES: THEMES, BASES: BASES, OFF_STS: OFF_STS, LOCK_STALE: LOCK_STALE, SOFT_LIMIT: SOFT_LIMIT,
    validEmail: validEmail, normEmail: normEmail, emailKey: emailKey, validHost: validHost, validColor: validColor,
    safeUrl: safeUrl, fold: fold, hash53: hash53, subId: subId, suppHash: suppHash, token: token, listCode: listCode,
    randomId: randomId, oneLine: oneLine, multi: multi,
    empty: empty, normalize: normalize, parse: parse, normBlock: normBlock, normSub: normSub,
    normChan: normChan, normList: normList, normIssue: normIssue,
    status: status, mergeNewsletter: mergeNewsletter, normSeg: normSeg, normTpl: normTpl, normL2: normL2,
    segMatch: segMatch, seg: seg, segsOf: segsOf, langOf: langOf, contentFor: contentFor, schedDue: schedDue, schedMine: schedMine,
    live: live, list: list, chan: chan, issue: issue, sub: sub, subsOf: subsOf, counts: counts, allTags: allTags,
    byToken: byToken, byCode: byCode,
    audience: audience, sentSet: sentSet, progress: progress, canSend: canSend, invitesDue: invitesDue, usedToday: usedToday,
    parseCsv: parseCsv, peopleFromRows: peopleFromRows, peopleFromText: peopleFromText, planImport: planImport,
    csvCell: csvCell, subsCsv: subsCsv, personData: personData,
    preflight: preflight, badPlaceholders: badPlaceholders, classify: classify, isBounceFrom: isBounceFrom, parseDsn: parseDsn, slug: slug,
    toBackup: toBackup, fromBackup: fromBackup,
    normForm: normForm, formPub: formPub, unsubPath: unsubPath, formHtml: formHtml,
    API_PROVS: API_PROVS, API_BATCH: API_BATCH, isApi: isApi, nextSubs: nextSubs,
    apiCheckReq: apiCheckReq, apiEventReqs: apiEventReqs, apiEvents: apiEvents, apiOutcome: apiOutcome,
    normRss: normRss, rssNext: rssNext, rssDue: rssDue, rssPick: rssPick, digestMd: digestMd, digestIssue: digestIssue
  };
  root.OrosNewsletterCore = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
