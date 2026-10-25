// ============================================================
// orOS Publishing — data model, ISBN and barcode math (pure, no DOM)
// Loaded by index.html before app.js, by search.js callers and by
// Node in the tests. For any small publisher: nothing here names a
// real house.
// Data in localStorage "oros-publish-data" (slice "publish"):
//   { ver: 1,
//     titles: [{ id, m, t, sub, ser, sn, st, rel "YYYY-MM-DD"|"", lang,
//                ppl: [{ r, n, crm? }], fmts: [{ id, k, isbn, price,
//                pages, w, h, sp, wt, bind, paper, dur, note }],
//                blurb, bio, kw, notes, cov, plan?, roy? }],
//                roy (wave P6): royalty terms [{ id, n, pct, base
//                "list"|"net", k "" | format kind, adv }]
//                rc (wave P8): review copies [{ id, n, out, email, d,
//                st "sent"|"rev"|"no", url, q, rd, fu }]
//     blocks: [{ id, m, p, note }],      ISBN blocks: p = the prefix as
//                the agency gave it, with hyphens ("978-618-5321")
//     isbnx:  [{ id, m, note }],         numbers used outside the app or
//                spoiled; id = the 13 digits
//     stmts:  [{ id, m, n, from, to, cur, rows, rec, due, paid, v }]
//                royalty statements as issued (wave P6, royalty.js)
//     subs:   [{ id, m, n, email, t, d, st, note, ans, ti }]
//                manuscripts sent to the publisher (wave P7): st new |
//                read | short | yes | no; ans = day last answered; ti =
//                the title made from it
//     set:    { m, cur, imp, tpl?, subDays? }, imp = the publisher's
//                name (covers, press texts); tpl (wave P7) = the
//                person's own texts { ack, no, yes, con } ("" = the
//                built-in one), subDays = days before an unanswered
//                submission is flagged (90); unknown fields ride along
//     tombs:  { id: ms } }
//   Later waves add lists of { id, m, … } rows; until a device knows a
//   list it keeps and merges it as it came (LWW by m per id), so an
//   older device never drops what a newer one wrote (forward safe).
//   A title keeps fields it does not know the same way.
// Sync rules (OROS_BIBLE.md Part I, Part VI):
//   - merge(a, b) === merge(b, a): union by id, the newer m wins, a
//     tie goes to the larger JSON (R5), never "local wins";
//   - merge(a, a) === a, so a pull never makes the slice dirty;
//   - a tombstone at least as new as the row deletes it, a newer edit
//     brings it back (R17);
//   - no uid() or Date.now() inside the merge; bad rows are dropped;
//   - serialize() is canonical: lists sorted by id, keys in order.
// The cover picture is never stored here: only its path on the orOS
// disk (/internal/Publishing/Covers/…), the file travels with Vault.
// ============================================================
(function (root) {
  "use strict";

  var VER = 1;
  var LISTS = ["titles", "blocks", "isbnx", "stmts", "subs", "posts"];
  var STATUS = ["idea", "prod", "out", "oop"];
  var FMT_KINDS = ["pb", "hb", "eb", "ab", "ot"];
  var ROLES = ["a", "t", "i", "e", "c", "n", "o"];
  var MAX_PPL = 12, MAX_FMTS = 8, MAX_ROWS = 5000, MAX_EXTRA = 8000;
  var COVER_DIR = "/internal/Publishing/Covers";
  var COVER_RE = /^[a-z0-9-]{1,80}\.(jpg|png)$/;
  var CURS = /^[A-Z]{3}$/;

  // ---------- small checks ----------
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  function str(v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, " ").slice(0, max) : ""; }
  function line(v, max) { return str(v, max * 2).replace(/[\r\n\t]+/g, " ").trim().slice(0, max); }
  function text(v, max) { return str(v, max).replace(/\r\n?/g, "\n"); }
  function ms(v) { return typeof v === "number" && isFinite(v) && v > 0 ? Math.floor(v) : 0; }
  function num(v, min, max, dec) {
    var n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(",", ".")) : NaN;
    if (!isFinite(n) || n < min || n > max) return 0;
    var k = Math.pow(10, dec || 0);
    return Math.round(n * k) / k;
  }
  function okYmd(s) {
    var m = YMD_RE.exec(typeof s === "string" ? s : "");
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1450 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
    var leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  }
  function okId(v) { return typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v); }
  function byId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
  function oneOf(v, list, def) { return list.indexOf(v) >= 0 ? v : def; }
  function canon(v) {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") {
      var o = {};
      Object.keys(v).sort().forEach(function (k) { if (v[k] !== undefined) o[k] = canon(v[k]); });
      return o;
    }
    return v;
  }
  // A JSON-safe copy of what we do not know, or null when it is too big
  // or not plain data.
  function plain(v, depth) {
    if (v === null || typeof v === "boolean" || typeof v === "string") return v;
    if (typeof v === "number") return isFinite(v) ? v : null;
    if ((depth || 0) > 4) return null;
    if (Array.isArray(v)) return v.slice(0, 500).map(function (x) { return plain(x, (depth || 0) + 1); });
    if (v && typeof v === "object") {
      var o = {};
      Object.keys(v).slice(0, 100).forEach(function (k) {
        if (k === "__proto__" || k === "constructor" || k === "prototype") return;
        o[k] = plain(v[k], (depth || 0) + 1);
      });
      return o;
    }
    return null;
  }

  // ---------- ISBN ----------
  function digits(s) { return typeof s === "string" ? s.replace(/[\s‐-―-]/g, "") : ""; }
  function check13(d12) {
    if (!/^\d{12}$/.test(d12)) return null;
    var sum = 0;
    for (var i = 0; i < 12; i++) sum += (+d12[i]) * (i % 2 ? 3 : 1);
    return String((10 - sum % 10) % 10);
  }
  function check10(d9) {
    if (!/^\d{9}$/.test(d9)) return null;
    var sum = 0;
    for (var i = 0; i < 9; i++) sum += (+d9[i]) * (10 - i);
    var c = (11 - sum % 11) % 11;
    return c === 10 ? "X" : String(c);
  }
  // Any spelling of an ISBN-13 or ISBN-10 → { ok, isbn (13 digits),
  // why }. why: "" | "len" | "check" | "prefix".
  function parseIsbn(s) {
    var d = digits(typeof s === "string" ? s.replace(/^\s*isbn(-1[03])?:?\s*/i, "") : "").toUpperCase();
    if (/^\d{9}[\dX]$/.test(d)) {
      if (check10(d.slice(0, 9)) !== d[9]) return { ok: false, isbn: "", why: "check" };
      var d12 = "978" + d.slice(0, 9);
      return { ok: true, isbn: d12 + check13(d12), why: "" };
    }
    if (!/^\d{13}$/.test(d)) return { ok: false, isbn: "", why: "len" };
    if (!/^97[89]/.test(d)) return { ok: false, isbn: "", why: "prefix" };
    if (check13(d.slice(0, 12)) !== d[12]) return { ok: false, isbn: "", why: "check" };
    return { ok: true, isbn: d, why: "" };
  }
  // ISBN-10 of a 978 number ("" for 979).
  function isbn10(isbn) {
    if (!/^978\d{10}$/.test(isbn || "")) return "";
    var d9 = isbn.slice(3, 12);
    return d9 + check10(d9);
  }
  // A block prefix "978-618-5321": 3 groups, digits only, 978/979, and
  // 9-11 digits in all (so the block holds 10, 100 or 1000 numbers).
  function parseBlock(p) {
    var s = line(p, 40).replace(/[\s‐-―]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    var parts = s.split("-");
    var d = parts.join("");
    if (!/^\d+$/.test(d) || !/^97[89]/.test(d) || d.length < 9 || d.length > 11) return null;
    if (parts.length < 2 || parts.some(function (x) { return !x; })) return null;
    return { p: s, d: d, n: 12 - d.length, size: Math.pow(10, 12 - d.length) };
  }
  function pad(n, w) { var s = String(n); while (s.length < w) s = "0" + s; return s; }
  // The i-th number of a block (0-based), or "" when outside.
  function blockIsbn(b, i) {
    var pb = parseBlock(b && b.p);
    if (!pb || !(i >= 0 && i < pb.size) || Math.floor(i) !== i) return "";
    var d12 = pb.d + pad(i, pb.n);
    return d12 + check13(d12);
  }
  function inBlock(b, isbn) {
    var pb = parseBlock(b && b.p);
    return !!pb && typeof isbn === "string" && isbn.length === 13 && isbn.indexOf(pb.d) === 0;
  }
  // Hyphenated for people inside a known block (its own groups); other
  // numbers stay plain digits (the groups need the agency's tables).
  function hyphen(isbn, blocks) {
    if (!/^\d{13}$/.test(isbn || "")) return isbn || "";
    var list = blocks || [];
    for (var i = 0; i < list.length; i++) {
      var pb = parseBlock(list[i] && list[i].p);
      if (pb && isbn.indexOf(pb.d) === 0) return pb.p + "-" + isbn.slice(pb.d.length, 12) + "-" + isbn[12];
    }
    return isbn;
  }

  // ---------- EAN-13 bars ----------
  var EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
  var EAN_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
  var EAN_P = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
  function ean13(code) {
    if (!/^\d{13}$/.test(code || "") || check13(code.slice(0, 12)) !== code[12]) return null;
    var par = EAN_P[+code[0]], out = "101";
    for (var i = 1; i <= 6; i++) out += (par[i - 1] === "L" ? EAN_L : EAN_G)[+code[i]];
    out += "01010";
    for (var j = 7; j <= 12; j++) out += EAN_L[+code[j]].replace(/[01]/g, function (c) { return c === "0" ? "1" : "0"; });
    return out + "101";
  }
  // A book barcode as SVG: "ISBN 978-…" above, the bars (guards longer),
  // the digits below. 1 unit = 1 module (0.33 mm at 100 %: the SVG
  // carries width/height in mm). Only digits and hyphens reach the
  // markup, so nothing a person typed can inject anything.
  function barcodeSvg(isbn, blocks, opts) {
    var bars = ean13(isbn);
    if (!bars) return "";
    var o = opts || {}, mod = 0.33 * (o.scale || 1);
    var q = 11, top = o.noTitle ? 2 : 12, bh = 60, gh = 66, w = 95 + q + 7, h = top + gh + 10;
    var guard = { 0: 1, 1: 1, 2: 1, 45: 1, 46: 1, 47: 1, 48: 1, 49: 1, 92: 1, 93: 1, 94: 1 };
    var rects = [];
    for (var i = 0; i < bars.length; i++) {
      if (bars[i] !== "1") continue;
      var j = i;
      while (j < bars.length && bars[j] === "1" && !!guard[j] === !!guard[i]) j++;
      rects.push('<rect x="' + (i + q) + '" y="' + top + '" width="' + (j - i) + '" height="' + (guard[i] ? gh : bh) + '"/>');
      i = j - 1;
    }
    var f = 'font-family="OCR-B, Consolas, monospace" font-size="9" text-anchor="middle"';
    var y = top + bh + 8.5;
    var txt = '<text x="' + (q - 5) + '" y="' + y + '" ' + f + '>' + isbn[0] + '</text>' +
      '<text x="' + (q + 3 + 21) + '" y="' + y + '" ' + f + ' textLength="40">' + isbn.slice(1, 7) + '</text>' +
      '<text x="' + (q + 50 + 21) + '" y="' + y + '" ' + f + ' textLength="40">' + isbn.slice(7) + '</text>';
    var title = o.noTitle ? "" : '<text x="' + (q + 47.5) + '" y="9" ' + f.replace('font-size="9"', 'font-size="8"') +
      ' textLength="95" lengthAdjust="spacingAndGlyphs">ISBN ' + hyphen(isbn, blocks).replace(/[^\d-]/g, "") + '</text>';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + (w * mod).toFixed(2) + 'mm" height="' + (h * mod).toFixed(2) +
      'mm" viewBox="0 0 ' + w + " " + h + '"><rect width="' + w + '" height="' + h + '" fill="#fff"/><g fill="#000">' +
      rects.join("") + title + txt + "</g></svg>";
  }

  // ---------- rows ----------
  function cleanPerson(raw) {
    if (!raw || typeof raw !== "object") return null;
    var n = line(raw.n, 120);
    if (!n) return null;
    var p = { r: oneOf(raw.r, ROLES, "a"), n: n };
    if (okId(raw.crm)) p.crm = raw.crm;
    return p;
  }
  function cleanFmt(raw) {
    if (!raw || typeof raw !== "object" || !okId(raw.id)) return null;
    var pi = parseIsbn(typeof raw.isbn === "string" ? raw.isbn : "");
    var out = {
      id: raw.id, k: oneOf(raw.k, FMT_KINDS, "pb"), isbn: pi.ok ? pi.isbn : "",
      price: num(raw.price, 0, 1e6, 2), pages: num(raw.pages, 0, 100000, 0),
      w: num(raw.w, 0, 2000, 1), h: num(raw.h, 0, 2000, 1), sp: num(raw.sp, 0, 500, 1),
      wt: num(raw.wt, 0, 100000, 0), bind: line(raw.bind, 60), paper: line(raw.paper, 80),
      dur: num(raw.dur, 0, 100000, 0), note: line(raw.note, 200)
    };
    // the shop product made from it (wave P2): Connected services account + product id
    var wid = raw.wp && typeof raw.wp === "object" ? num(raw.wp.id, 0, 1e12, 0) : 0;
    if (wid > 0 && okId(raw.wp.a)) out.wp = { a: raw.wp.a, id: wid };
    return out;
  }
  var TITLE_KEYS = ["id", "m", "t", "sub", "ser", "sn", "st", "rel", "lang", "ppl", "fmts", "blurb", "bio", "kw", "notes", "cov", "plan", "roy", "rc"];
  // Release plan (wave P4): the steps from manuscript to presentation,
  // each with a date counted back from the release date (days).
  var STAGES = ["ms", "ed", "p1", "cov", "p2", "isbn", "p3", "print", "pres", "x"];
  var STAGE_DAYS = { ms: -120, ed: -90, p1: -60, cov: -50, p2: -45, isbn: -40, p3: -30, print: -21, pres: 14 };
  var MAX_PLAN = 20;
  function cleanStep(raw) {
    if (!raw || typeof raw !== "object" || !okId(raw.id)) return null;
    var k = oneOf(raw.k, STAGES, "x");
    var o = { id: raw.id, k: k, d: okYmd(raw.d) ? raw.d : "", done: raw.done === 1 ? 1 : 0 };
    var n = line(raw.n, 80);
    if (n) o.n = n;
    if (k === "x" && !n) return null;          // an own step needs its name
    return o;
  }
  // Royalty terms (wave P6): who is paid, pct of the list price or of
  // what came in (net), on one format kind or all ("" ), and the
  // advance paid on signing (currency units), recouped first.
  var ROY_BASES = ["list", "net"], MAX_ROY = 8;
  function cleanRoy(raw) {
    if (!raw || typeof raw !== "object" || !okId(raw.id)) return null;
    var n = line(raw.n, 120);
    if (!n) return null;
    return {
      id: raw.id, n: n, pct: num(raw.pct, 0, 100, 2), base: oneOf(raw.base, ROY_BASES, "list"),
      k: FMT_KINDS.indexOf(raw.k) >= 0 ? raw.k : "", adv: num(raw.adv, 0, 1e7, 2)
    };
  }
  // A royalty statement as issued: a record, so later edits of terms or
  // sales never change what was sent. rows: one per title format,
  // rec: one per term (advance before, earned, payable), sums in cents.
  var MAX_STMT_ROWS = 300;
  function cents(v) { return typeof v === "number" && isFinite(v) && Math.abs(v) <= 1e12 ? Math.round(v) : 0; }
  function cleanStmt(raw) {
    if (!raw || typeof raw !== "object" || !okId(raw.id)) return null;
    var n = line(raw.n, 120);
    if (!n || !okYmd(raw.from) || !okYmd(raw.to) || raw.from > raw.to) return null;
    var rows = (Array.isArray(raw.rows) ? raw.rows : []).slice(0, MAX_STMT_ROWS).map(function (r) {
      if (!r || typeof r !== "object" || !okId(r.ti) || !okId(r.tr)) return null;
      var o = { ti: r.ti, tr: r.tr, t: line(r.t, 200), k: FMT_KINDS.indexOf(r.k) >= 0 ? r.k : "",
                isbn: /^\d{13}$/.test(r.isbn || "") ? r.isbn : "", q: num(r.q, -1e7, 1e7, 3),
                base: oneOf(r.base, ROY_BASES, "list"), u: num(r.u, 0, 1e9, 2), b: cents(r.b),
                pct: num(r.pct, 0, 100, 2), e: cents(r.e) };
      return o.t ? o : null;
    }).filter(Boolean);
    var rec = (Array.isArray(raw.rec) ? raw.rec : []).slice(0, MAX_STMT_ROWS).map(function (r) {
      if (!r || typeof r !== "object" || !okId(r.ti) || !okId(r.tr)) return null;
      return { ti: r.ti, tr: r.tr, adv: cents(r.adv), left: cents(r.left), e: cents(r.e), pay: cents(r.pay) };
    }).filter(Boolean);
    var o = { id: raw.id, m: ms(raw.m), n: n, from: raw.from, to: raw.to,
              cur: typeof raw.cur === "string" && CURS.test(raw.cur) ? raw.cur : "EUR",
              rows: rows, rec: rec, due: cents(raw.due), paid: okYmd(raw.paid) ? raw.paid : "", note: text(raw.note, 1000) };
    if (raw.v === 1) o.v = 1;
    return o;
  }
  // A review copy (wave P8): who got the book (n, their outlet, e-mail),
  // the day it went out (d), and what came of it: st sent | rev (a
  // review came: its https link, a quote, its day rd) | no (none will
  // come). fu = the day of the last follow-up.
  var RC_ST = ["sent", "rev", "no"], MAX_RC = 150, RC_DAYS = 21;
  function cleanRc(raw) {
    if (!raw || typeof raw !== "object" || !okId(raw.id)) return null;
    var n = line(raw.n, 120), o = line(raw.out, 120);
    if (!n && !o) return null;
    var email = line(raw.email, 200), url = line(raw.url, 500);
    return {
      id: raw.id, n: n, out: o, email: /^[^\s@<>]+@[^\s@<>]+$/.test(email) ? email : "", d: okYmd(raw.d) ? raw.d : "",
      st: oneOf(raw.st, RC_ST, "sent"), url: /^https:\/\/[^\s<>"]+$/.test(url) ? url : "", q: text(raw.q, 600).trim(),
      rd: okYmd(raw.rd) ? raw.rd : "", fu: okYmd(raw.fu) ? raw.fu : ""
    };
  }
  // Copies to follow up: sent, no review yet, and `days` (21) since
  // they went out or since the last follow-up. → [{ title, rc }]
  function rcDue(d, today, days) {
    var n = typeof days === "number" && days > 0 ? days : RC_DAYS, lim = addDays(today, -n), out = [];
    ((d && d.titles) || []).forEach(function (t) {
      (t.rc || []).forEach(function (x) {
        if (x.st !== "sent" || !x.d) return;
        var since = x.fu && x.fu > x.d ? x.fu : x.d;
        if (since <= lim) out.push({ title: t, rc: x });
      });
    });
    return out.sort(function (a, b) { return a.rc.d < b.rc.d ? -1 : a.rc.d > b.rc.d ? 1 : byId(a.rc, b.rc); });
  }
  // The quotes of a title's reviews, newest first: [{ q, who, url }]
  function quotes(t) {
    return (t.rc || []).filter(function (x) { return x.st === "rev" && x.q; })
      .sort(function (a, b) { return (a.rd || "") < (b.rd || "") ? 1 : (a.rd || "") > (b.rd || "") ? -1 : byId(a, b); })
      .map(function (x) { return { q: x.q, who: x.out || x.n, url: x.url }; });
  }
  // Everyone a copy went to, across titles (for the name list): newest
  // details per name
  function pressList(d) {
    var by = {};
    ((d && d.titles) || []).forEach(function (t) {
      (t.rc || []).forEach(function (x) {
        var k = fold(x.n || x.out);
        if (!k) return;
        if (!by[k] || (x.d || "") > (by[k].d || "")) by[k] = { n: x.n, out: x.out, email: x.email, d: x.d };
      });
    });
    return Object.keys(by).sort().map(function (k) { return by[k]; });
  }
  // A manuscript sent in (wave P7). Only what the person typed or Mail
  // passed on; the e-mail itself stays in Mail.
  var SUB_ST = ["new", "read", "short", "yes", "no"];
  function cleanSub(raw) {
    if (!raw || typeof raw !== "object" || !okId(raw.id)) return null;
    var n = line(raw.n, 120), email = line(raw.email, 200);
    if (!n && !email) return null;
    var o = { id: raw.id, m: ms(raw.m), n: n, email: /^[^\s@<>]+@[^\s@<>]+$/.test(email) ? email : "",
              t: line(raw.t, 200), d: okYmd(raw.d) ? raw.d : "", st: oneOf(raw.st, SUB_ST, "new"),
              note: text(raw.note, 4000), ans: okYmd(raw.ans) ? raw.ans : "" };
    if (okId(raw.ti)) o.ti = raw.ti;
    return o;
  }
  // Waiting too long: still new or being read, never answered (or
  // answered only before it arrived) and older than `days`.
  function subsLate(d, today, days) {
    var n = typeof days === "number" && days > 0 ? days : 90;
    var lim = addDays(today, -n);
    return ((d && d.subs) || []).filter(function (x) {
      return (x.st === "new" || x.st === "read") && x.d && x.d <= lim && (!x.ans || x.ans < x.d);
    }).sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : byId(a, b); });
  }
  // A planned social post (wave P12): written once, on its day (and
  // hour) Publishing shows it as due; it is posted by the person, from
  // the network's own page (intent links: no keys, works for anyone).
  // img = a picture on the orOS disk (a title's cover or a file from
  // Files), never the bytes.
  var POST_NETS = ["mastodon", "bluesky", "x", "threads", "facebook", "linkedin", "instagram"];
  var POST_MAX = { mastodon: 500, bluesky: 300, x: 280, threads: 500, facebook: 63206, linkedin: 3000, instagram: 2200 };
  var DISK_RE = /^\/internal\/[^\u0000-\u001f]{1,300}$/;
  function cleanPost(raw) {
    if (!raw || typeof raw !== "object" || !okId(raw.id) || !okYmd(raw.d)) return null;
    var tx = text(raw.tx, 5000), img = typeof raw.img === "string" && DISK_RE.test(raw.img) && raw.img.indexOf("/../") < 0 && !/\/\.\.?$/.test(raw.img) ? raw.img : "";
    if (!tx.trim() && !img) return null;
    var nets = [];
    (Array.isArray(raw.nets) ? raw.nets : []).forEach(function (n) { if (POST_NETS.indexOf(n) >= 0 && nets.indexOf(n) < 0) nets.push(n); });
    nets.sort(function (a, b) { return POST_NETS.indexOf(a) - POST_NETS.indexOf(b); });
    var o = { id: raw.id, m: ms(raw.m), d: raw.d, at: typeof raw.at === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.at) ? raw.at : "",
              tx: tx, img: img, nets: nets, done: okYmd(raw.done) ? raw.done : "" };
    if (okId(raw.ti)) o.ti = raw.ti;
    return o;
  }
  // Posts not marked posted whose day (and hour, when given) has come,
  // oldest first. now = "YYYY-MM-DD HH:MM" (local time).
  function postsDue(d, now) {
    var day = String(now || "").slice(0, 10), hm = String(now || "").slice(11, 16);
    return ((d && d.posts) || []).filter(function (p) {
      return !p.done && (p.d < day || (p.d === day && (!p.at || !hm || p.at <= hm)));
    }).sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : (a.at < b.at ? -1 : a.at > b.at ? 1 : byId(a, b)); });
  }
  // The network's own "new post" page with the text in it; "" when the
  // network has none (Facebook, Instagram: copy, then open the app) or
  // no Mastodon server is set. inst = the person's Mastodon server.
  var MAST_RE = /^(?=.{3,100}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
  function postUrl(net, tx, inst) {
    var q = encodeURIComponent(String(tx || ""));
    switch (net) {
      case "mastodon": return MAST_RE.test(inst || "") ? "https://" + inst + "/share?text=" + q : "";
      case "bluesky": return "https://bsky.app/intent/compose?text=" + q;
      case "x": return "https://x.com/intent/post?text=" + q;
      case "threads": return "https://www.threads.net/intent/post?text=" + q;
      case "linkedin": return "https://www.linkedin.com/feed/?shareActive=true&text=" + q;
      default: return "";
    }
  }
  var POST_HOME = { facebook: "https://www.facebook.com/", instagram: "https://www.instagram.com/" };
  // characters as the networks count them (code points)
  function postLen(tx) { return Array.from(String(tx || "")).length; }

  // {name} → vars.name in a template; unknown names stay as written
  function fillTpl(tpl, vars) {
    return String(tpl || "").replace(/\{([a-z]{1,12})\}/g, function (all, k) {
      return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : all;
    });
  }
  function cleanTitle(raw) {
    if (!raw || typeof raw !== "object" || !okId(raw.id)) return null;
    var t = line(raw.t, 200);
    if (!t) return null;
    var fids = {};
    var out = {
      id: raw.id, m: ms(raw.m), t: t, sub: line(raw.sub, 200), ser: line(raw.ser, 120), sn: line(raw.sn, 12),
      st: oneOf(raw.st, STATUS, "idea"), rel: okYmd(raw.rel) ? raw.rel : "", lang: line(raw.lang, 40),
      ppl: (Array.isArray(raw.ppl) ? raw.ppl : []).map(cleanPerson).filter(Boolean).slice(0, MAX_PPL),
      fmts: (Array.isArray(raw.fmts) ? raw.fmts : []).map(cleanFmt).filter(function (f) {
        if (!f || fids[f.id]) return false;
        fids[f.id] = 1;
        return true;
      }).slice(0, MAX_FMTS),
      blurb: text(raw.blurb, 4000), bio: text(raw.bio, 3000), kw: line(raw.kw, 400), notes: text(raw.notes, 4000),
      cov: typeof raw.cov === "string" && COVER_RE.test(raw.cov) ? raw.cov : ""
    };
    var sids = {};
    var plan = (Array.isArray(raw.plan) ? raw.plan : []).map(cleanStep).filter(function (x) {
      if (!x || sids[x.id]) return false;
      sids[x.id] = 1;
      return true;
    }).slice(0, MAX_PLAN);
    if (plan.length) out.plan = plan;
    var rids = {};
    var roy = (Array.isArray(raw.roy) ? raw.roy : []).map(cleanRoy).filter(function (x) {
      if (!x || rids[x.id]) return false;
      rids[x.id] = 1;
      return true;
    }).slice(0, MAX_ROY);
    if (roy.length) out.roy = roy;
    var cids = {};
    var rc = (Array.isArray(raw.rc) ? raw.rc : []).map(cleanRc).filter(function (x) {
      if (!x || cids[x.id]) return false;
      cids[x.id] = 1;
      return true;
    }).slice(0, MAX_RC);
    if (rc.length) out.rc = rc;
    // Fields of a later version ride along unchanged (bounded).
    var extra = {}, any = false;
    Object.keys(raw).forEach(function (k) {
      if (TITLE_KEYS.indexOf(k) >= 0 || !/^[a-z][A-Za-z0-9]{0,23}$/.test(k)) return;
      extra[k] = plain(raw[k]);
      any = true;
    });
    if (any && JSON.stringify(extra).length <= MAX_EXTRA) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
    return out;
  }
  function cleanBlock(raw) {
    if (!raw || typeof raw !== "object" || !okId(raw.id)) return null;
    var pb = parseBlock(raw.p);
    if (!pb) return null;
    return { id: raw.id, m: ms(raw.m), p: pb.p, note: line(raw.note, 200) };
  }
  function cleanX(raw) {
    if (!raw || typeof raw !== "object") return null;
    var pi = parseIsbn(typeof raw.id === "string" ? raw.id : "");
    if (!pi.ok || pi.isbn !== raw.id) return null;
    return { id: raw.id, m: ms(raw.m), note: line(raw.note, 200) };
  }
  // A row of a list this version does not know: needs id + m, plain data.
  function cleanUnknown(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !okId(raw.id)) return null;
    var p = plain(raw);
    if (!p || JSON.stringify(p).length > MAX_EXTRA) return null;
    p.m = ms(raw.m);
    return p;
  }
  var CLEAN = { titles: cleanTitle, blocks: cleanBlock, isbnx: cleanX, stmts: cleanStmt, subs: cleanSub, posts: cleanPost };

  function empty() { return { ver: VER, titles: [], blocks: [], isbnx: [], stmts: [], subs: [], set: { m: 0, cur: "EUR", imp: "" }, tombs: {} }; }

  function cleanSet(raw) {
    var s = raw && typeof raw === "object" ? raw : {};
    var out = { m: ms(s.m), cur: typeof s.cur === "string" && CURS.test(s.cur) ? s.cur : "EUR", imp: line(s.imp, 120) };
    // wave P7: own texts for answers and the contract, days to answer
    if (s.tpl && typeof s.tpl === "object") {
      var tp = {};
      TPL_KEYS.forEach(function (k) { var v = text(s.tpl[k], k === "con" ? 20000 : 6000); if (v.trim()) tp[k] = v; });
      if (Object.keys(tp).length) out.tpl = tp;
    }
    var sd = num(s.subDays, 0, 365, 0);
    if (sd) out.subDays = sd;
    // wave P12: the person's Mastodon server, for "post" links
    var ma = line(s.mast, 100).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (MAST_RE.test(ma)) out.mast = ma;
    // Settings of a later version ride along unchanged (bounded).
    var extra = {}, any = false;
    Object.keys(s).forEach(function (k) {
      if (SET_KEYS.indexOf(k) >= 0 || !/^[a-z][A-Za-z0-9]{0,23}$/.test(k)) return;
      extra[k] = plain(s[k]);
      any = true;
    });
    if (any && JSON.stringify(extra).length <= MAX_EXTRA) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
    return out;
  }
  var SET_KEYS = ["m", "cur", "imp", "tpl", "subDays", "mast"];
  var TPL_KEYS = ["ack", "no", "yes", "con"];

  function newer(a, b) {
    if (a.m !== b.m) return a.m > b.m;
    return JSON.stringify(canon(a)) > JSON.stringify(canon(b));
  }

  function mergeLists(list) {
    var rows = {}, tombs = {}, set = null, unknown = {};
    LISTS.forEach(function (k) { rows[k] = {}; });
    list.forEach(function (d) {
      if (!d || typeof d !== "object") return;
      LISTS.forEach(function (k) {
        (Array.isArray(d[k]) ? d[k] : []).forEach(function (raw) {
          var r = CLEAN[k](raw);
          if (r && (!rows[k][r.id] || newer(r, rows[k][r.id]))) rows[k][r.id] = r;
        });
      });
      Object.keys(d).forEach(function (k) {
        if (LISTS.indexOf(k) >= 0 || !/^[a-z][a-z0-9]{1,15}$/.test(k) || !Array.isArray(d[k]) ||
            k === "tombs" || k === "set" || k === "ver") return;
        var bag = unknown[k] = unknown[k] || {};
        d[k].forEach(function (raw) {
          var r = cleanUnknown(raw);
          if (r && (!bag[r.id] || newer(r, bag[r.id]))) bag[r.id] = r;
        });
      });
      var s = cleanSet(d.set);
      if (!set || newer(s, set)) set = s;
      var t = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      Object.keys(t).forEach(function (id) {
        var at = ms(t[id]);
        if (at && id.length <= 64 && at > (tombs[id] || 0)) tombs[id] = at;
      });
    });
    var out = empty();
    function live(bag) {
      return Object.keys(bag).map(function (id) { return bag[id]; })
        .filter(function (r) { return !(tombs[r.id] >= r.m); })
        .sort(byId).slice(0, MAX_ROWS);
    }
    LISTS.forEach(function (k) { out[k] = live(rows[k]); });
    Object.keys(unknown).sort().forEach(function (k) { out[k] = live(unknown[k]).map(canon); });
    out.set = set || cleanSet(null);
    var tk = {};
    Object.keys(tombs).sort().forEach(function (id) { tk[id] = tombs[id]; });
    delete out.tombs;
    out.tombs = tk;
    return out;
  }

  function normalize(d) { return mergeLists([d]); }
  function merge(a, b) { return mergeLists([a, b]); }
  function serialize(d) { return JSON.stringify(normalize(d)); }

  // ---------- edits (the app passes the clock in) ----------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function bump(old, now) { return Math.max(now, (old || 0) + 1); }

  // Put a row (title, block, ISBN note) in its list; the stamp is newer
  // than the copy it replaces.
  function put(d, list, row, now) {
    var out = normalize(d);
    if (LISTS.indexOf(list) < 0) return out;
    var old = out[list].filter(function (r) { return r.id === row.id; })[0];
    var r = CLEAN[list](Object.assign({}, row, { m: bump(old && old.m, now) }));
    if (!r) return out;
    out[list] = out[list].filter(function (x) { return x.id !== r.id; }).concat([r]);
    if (out.tombs[r.id] >= r.m) delete out.tombs[r.id];
    return normalize(out);
  }
  function remove(d, list, id, now) {
    var out = normalize(d);
    var old = (out[list] || []).filter(function (r) { return r.id === id; })[0];
    if (!old) return out;
    out.tombs[id] = bump(old.m, now);
    return normalize(out);
  }
  function setCur(d, cur, now) {
    if (!CURS.test(cur || "")) return normalize(d);
    return setSet(d, { cur: cur }, now);
  }
  // patch: { cur?, imp? } → one settings write (other fields kept)
  function setSet(d, patch, now) {
    var out = normalize(d);
    var s = Object.assign({}, out.set, patch || {});
    s.m = bump(out.set.m, now);
    out.set = cleanSet(s);
    return out;
  }
  function find(d, list, id) { return ((d && d[list]) || []).filter(function (r) { return r.id === id; })[0] || null; }

  // ---------- ISBN register ----------
  // Every number in use: { isbn: [{ title, fmt } | { x: true }] }
  function used(d) {
    var u = Object.create(null);
    (d.titles || []).forEach(function (t) {
      (t.fmts || []).forEach(function (f) {
        if (!f.isbn) return;
        (u[f.isbn] = u[f.isbn] || []).push({ title: t.id, fmt: f.id });
      });
    });
    (d.isbnx || []).forEach(function (x) { (u[x.id] = u[x.id] || []).push({ x: true }); });
    return u;
  }
  // Numbers given to more than one format (or to a format and marked
  // used elsewhere): [{ isbn, uses }]
  function clashes(d) {
    var u = used(d);
    return Object.keys(u).sort().filter(function (k) { return u[k].length > 1; })
      .map(function (k) { return { isbn: k, uses: u[k] }; });
  }
  // The first free number of a block, skipping what is used and `skip`
  // (numbers the app already offered in this edit). "" = block full.
  function nextFree(d, blockId, skip) {
    var b = find(d, "blocks", blockId), pb = b && parseBlock(b.p);
    if (!pb) return "";
    var u = used(d), s = skip || [];
    for (var i = 0; i < pb.size; i++) {
      var n = blockIsbn(b, i);
      if (!u[n] && s.indexOf(n) < 0) return n;
    }
    return "";
  }
  // Per block: { id, p, size, used, free, rows: [{ i, isbn, uses }] }
  // rows only for numbers in use (the free ones are counted).
  function blockUsage(d, blockId) {
    var b = find(d, "blocks", blockId), pb = b && parseBlock(b.p);
    if (!pb) return null;
    var u = used(d), rows = [];
    Object.keys(u).sort().forEach(function (k) {
      if (k.indexOf(pb.d) === 0) rows.push({ i: +k.slice(pb.d.length, 12), isbn: k, uses: u[k] });
    });
    return { id: b.id, p: pb.p, size: pb.size, used: rows.length, free: pb.size - rows.length, rows: rows };
  }

  // ---------- titles ----------
  function fold(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ς/g, "σ");   // i18n-inline-ok: Greek final sigma folds to σ for search
  }
  function authors(t) {
    return (t.ppl || []).filter(function (p) { return p.r === "a"; }).map(function (p) { return p.n; });
  }
  function haystack(t) {
    var parts = [t.t, t.sub, t.ser, t.kw, t.notes, t.blurb];
    (t.ppl || []).forEach(function (p) { parts.push(p.n); });
    (t.fmts || []).forEach(function (f) { parts.push(f.isbn, isbn10(f.isbn)); });
    return fold(parts.join(" "));
  }
  // filter: { q, st } ; sort: "rel" (newest release first, no date last),
  // "t" (A-Z), "m" (last edited)
  function list(d, filter, sort, locale) {
    var f = filter || {}, words = fold(f.q || "").split(/\s+/).filter(Boolean);
    var digitsQ = digits(f.q || "");
    var rows = (d.titles || []).filter(function (t) {
      if (f.st && t.st !== f.st) return false;
      if (!words.length) return true;
      var h = haystack(t);
      if (/^\d{9,13}X?$/i.test(digitsQ) && h.indexOf(digitsQ.toLowerCase()) >= 0) return true;
      return words.every(function (w) { return h.indexOf(w) >= 0; });
    });
    var coll = typeof Intl !== "undefined" && Intl.Collator ? new Intl.Collator(locale || "en", { sensitivity: "base", numeric: true }) : null;
    function cmpT(a, b) { return coll ? coll.compare(a.t, b.t) : (a.t < b.t ? -1 : a.t > b.t ? 1 : 0); }
    rows.sort(function (a, b) {
      if (sort === "t") return cmpT(a, b) || byId(a, b);
      if (sort === "m") return b.m - a.m || byId(a, b);
      if (a.rel !== b.rel) return !a.rel ? 1 : !b.rel ? -1 : a.rel < b.rel ? 1 : -1;
      return cmpT(a, b) || byId(a, b);
    });
    return rows;
  }
  // What is missing before a title can go out: ["isbn", "price", …]
  function gaps(t) {
    var g = [];
    if (!authors(t).length) g.push("author");
    if (!t.fmts.length) g.push("fmt");
    t.fmts.forEach(function (f) {
      if (!f.isbn && g.indexOf("isbn") < 0) g.push("isbn");
      if (!f.price && g.indexOf("price") < 0) g.push("price");
      if ((f.k === "pb" || f.k === "hb") && !f.pages && g.indexOf("pages") < 0) g.push("pages");
    });
    if (!t.blurb.trim()) g.push("blurb");
    if (!t.rel) g.push("rel");
    if (!t.cov) g.push("cov");
    return g;
  }
  function coverPath(name) { return typeof name === "string" && COVER_RE.test(name) ? COVER_DIR + "/" + name : null; }
  function coversInUse(d) { return (d.titles || []).map(function (t) { return t.cov; }).filter(Boolean); }

  // A new title from another app's prefill ({ new: {…} } deep link):
  // only known, cleaned fields; never an id or stamp from outside.
  function fromPrefill(p, id, now, fmtId) {
    var src = p && typeof p === "object" ? p : {};
    var raw = {
      id: id, m: now, t: src.t || src.title, sub: src.sub, ser: src.ser, st: src.st, rel: src.rel,
      lang: src.lang, blurb: src.blurb, bio: src.bio, kw: src.kw, notes: src.notes,
      ppl: Array.isArray(src.ppl) ? src.ppl : (typeof src.author === "string" ? [{ r: "a", n: src.author }] : []),
      fmts: src.isbn || src.price || src.pages ? [{ id: fmtId, k: src.k || "pb", isbn: src.isbn, price: src.price, pages: src.pages }] : []
    };
    var t = cleanTitle(raw);
    if (!t) return null;
    Object.keys(t).forEach(function (k) { if (TITLE_KEYS.indexOf(k) < 0) delete t[k]; });
    return t;
  }

  // ---------- Release plan (wave P4) ----------
  function addDays(ymd, n) {
    var p = ymd.split("-"), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return d.toISOString().slice(0, 10);
  }
  // The standard steps dated back from the release date. Steps already
  // in the plan keep their id, their done mark and their own name; a
  // done step keeps its date; own steps ("x") stay as they are.
  function makePlan(rel, plan, newId) {
    if (!okYmd(rel)) return (plan || []).slice();
    var have = {};
    (plan || []).forEach(function (s) { if (s.k !== "x" && !have[s.k]) have[s.k] = s; });
    var out = STAGES.filter(function (k) { return k !== "x"; }).map(function (k) {
      var old = have[k];
      var d = old && old.done && old.d ? old.d : addDays(rel, STAGE_DAYS[k]);
      var s = { id: old ? old.id : newId(), k: k, d: d, done: old ? old.done : 0 };
      if (old && old.n) s.n = old.n;
      return s;
    });
    (plan || []).forEach(function (s) { if (s.k === "x") out.push(s); });
    return sortPlan(out).slice(0, MAX_PLAN);
  }
  function sortPlan(plan) {
    return plan.slice().sort(function (a, b) {
      if (!a.d !== !b.d) return a.d ? -1 : 1;
      return a.d < b.d ? -1 : a.d > b.d ? 1 : STAGES.indexOf(a.k) - STAGES.indexOf(b.k);
    });
  }
  // Where a title stands on a day: steps not done whose date has passed
  // (late), and the next open step.
  function planState(t, today) {
    var open = sortPlan((t.plan || []).filter(function (s) { return !s.done && s.d; }));
    return {
      late: open.filter(function (s) { return s.d < today; }),
      next: open.filter(function (s) { return s.d >= today; })[0] || null,
      done: (t.plan || []).filter(function (s) { return s.done; }).length,
      total: (t.plan || []).length
    };
  }
  // Calendar rows (publish/feed.js): release dates of titles not yet
  // out of print, and every open step with a date.
  function byDay(d) {
    var out = {};
    function add(day, row) { (out[day] = out[day] || []).push(row); }
    ((d && d.titles) || []).forEach(function (t) {
      if (t.st === "oop") return;
      if (t.rel) add(t.rel, { title: t.id, k: "rel", t: t.t });
      (t.plan || []).forEach(function (s) { if (!s.done && s.d) add(s.d, { title: t.id, k: s.k, n: s.n || "", t: t.t, step: s.id }); });
    });
    // wave P12: planned posts not yet posted, "Post 10:00 · first words…"
    ((d && d.posts) || []).forEach(function (p) {
      if (p.done) return;
      var first = p.tx.replace(/\s+/g, " ").trim();
      if (first.length > 50) first = first.slice(0, 49).trim() + "…";
      add(p.d, { title: p.ti || "", k: "post", n: p.at, t: first, post: p.id });
    });
    return out;
  }

  // ---------- To other apps (wave P2) ----------
  // Each builder is pure: the app sends what it returns through the
  // shell (WooCommerce via orosLinks, the others as deep links), and
  // nothing is saved there until the person saves it.
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function paras(s) {
    return String(s || "").split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean)
      .map(function (p) { return "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>"; }).join("");
  }
  // a number as WooCommerce's decimal text: at most 3 decimals, no trailing zeros
  function wcDec(v) {
    if (!(v > 0) || v >= 1e6) return "";
    var s = (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, "");
    return s === "0" ? "" : s;
  }
  var WEIGHT_G = { kg: 1000, g: 1, lbs: 453.59237, oz: 28.349523125 };
  var LEN_MM = { m: 1000, cm: 10, mm: 1, "in": 25.4, yd: 914.4 };
  var DRAFT_BYTES = 15000;          // the relay takes 16 KB per request
  function utf8Len(s) { return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s).length : unescape(encodeURIComponent(s)).length; }
  // A format as a WooCommerce draft product body (POST /products).
  // o: { label: format name added to the product name ("" = none),
  //      about: heading over the biography, wu / du: the shop's weight
  //      and dimension units ("" = unknown: no weight / dimensions),
  //      price: false leaves the price out (another currency) }
  function shopDraft(t, f, o) {
    o = o || {};
    var name = line(t.t + (o.label ? " (" + o.label + ")" : ""), 200);
    var b = { name: name, type: "simple", status: "draft" };
    if (f.isbn) b.sku = f.isbn;
    if (o.price !== false && f.price > 0) b.regular_price = f.price.toFixed(2);
    var by = authors(t);
    if (by.length) b.short_description = "<p>" + esc(by.join(", ")) + "</p>";
    var blurb = paras(t.blurb), bio = paras(t.bio);
    var desc = blurb + (bio ? "<h3>" + esc(o.about || "") + "</h3>" + bio : "");
    if (f.k === "eb" || f.k === "ab") b.virtual = true;
    else {
      var wu = WEIGHT_G[o.wu], du = LEN_MM[o.du];
      var w = wu && f.wt ? wcDec(f.wt / wu) : "";
      if (w) b.weight = w;
      if (du) {
        var dm = {}, any = false;
        [["length", f.h], ["width", f.w], ["height", f.sp]].forEach(function (x) {
          var v = x[1] ? wcDec(x[1] / du) : "";
          if (v) { dm[x[0]] = v; any = true; }
        });
        if (any) b.dimensions = dm;
      }
    }
    // fits the relay: the biography goes first, then the blurb is cut
    function size(d) { var c = Object.assign({}, b); if (d) c.description = d; return utf8Len(JSON.stringify(c)); }
    function fits(d) { return d.length <= 8000 && size(d) <= DRAFT_BYTES; }
    if (desc && !fits(desc)) desc = blurb;
    var keep = String(t.blurb || "").length;
    while (desc && !fits(desc)) {
      keep = Math.floor(keep * 0.8);
      desc = keep > 0 ? paras(String(t.blurb).slice(0, keep).trim() + "…") : "";
    }
    if (desc) b.description = desc;
    return b;
  }
  // A Stock item prefill ({ newItem } deep link): price in cents.
  function stockPrefill(t, f, label) {
    var p = { name: line(t.t + (label ? " (" + label + ")" : ""), 120), note: authors(t).join(", ") };
    if (f.isbn) { p.sku = f.isbn; p.bc = f.isbn; }
    if (f.price > 0) p.price = Math.round(f.price * 100);
    return p;
  }
  // Newsletter blocks (asAdd deep link): heading, text, and a button
  // to the shop page when the person has one.
  function newsBlocks(t, o) {
    o = o || {};
    var head = [t.sub, authors(t).join(", ")].filter(Boolean).join("\n");
    var out = [{ k: "h", t: line(t.t, 300) }];
    var txt = [head, t.blurb].filter(Boolean).join("\n\n");
    if (txt) out.push({ k: "p", t: txt.slice(0, 4000) });
    // reviews (wave P8): the two newest quotes
    var qs = quotes(t).slice(0, 2).map(function (x) { return "“" + x.q + "” — " + x.who; });
    if (qs.length) out.push({ k: "p", t: qs.join("\n\n").slice(0, 2000) });
    if (o.href && /^https:\/\/[^\s]+$/.test(o.href) && o.btn) out.push({ k: "btn", t: line(o.btn, 80), href: o.href });
    return out;
  }
  // A press release (Writer newDoc): plain text, paragraphs on blank
  // lines. S: the strings in the app's language (see app.js "pr.*").
  function pressRelease(t, fmts, S, o) {
    o = o || {};
    function f(k, vars) {
      var s = S[k] || "";
      Object.keys(vars || {}).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
      return s;
    }
    var by = authors(t).join(", ");
    var parts = [S.head];
    var lead = o.imp ? (by ? f("leadImp", { imp: o.imp, t: t.t, a: by }) : f("leadImpNoA", { imp: o.imp, t: t.t }))
                     : (by ? f("lead", { t: t.t, a: by }) : f("leadNoA", { t: t.t }));
    parts.push(lead + (o.rel ? " " + f("rel", { d: o.rel }) : ""));
    if (t.sub) parts.push(t.sub);
    if (t.blurb) parts.push(t.blurb.trim());
    if (t.bio) parts.push(S.about + "\n" + t.bio.trim());
    var rows = [];
    (fmts || []).forEach(function (x) {
      var bits = [x.label];
      if (x.isbn) bits.push("ISBN " + x.isbn);
      if (x.pages) bits.push(f("pages", { n: x.pages }));
      if (x.price) bits.push(x.price);
      rows.push(bits.join(" · "));
    });
    if (rows.length) parts.push(S.details + "\n" + rows.join("\n"));
    if (o.imp) parts.push(S.contact + "\n" + o.imp);
    return { title: line(f("docTitle", { t: t.t }), 200), text: parts.filter(Boolean).join("\n\n") };
  }

  var API = {
    VER: VER, LISTS: LISTS, STATUS: STATUS, FMT_KINDS: FMT_KINDS, ROLES: ROLES, MAX_PPL: MAX_PPL, MAX_FMTS: MAX_FMTS,
    COVER_DIR: COVER_DIR, COVER_RE: COVER_RE,
    empty: empty, normalize: normalize, merge: merge, serialize: serialize, canon: canon,
    uid: uid, put: put, remove: remove, setCur: setCur, setSet: setSet, find: find,
    check13: check13, check10: check10, parseIsbn: parseIsbn, isbn10: isbn10, parseBlock: parseBlock,
    blockIsbn: blockIsbn, inBlock: inBlock, hyphen: hyphen, ean13: ean13, barcodeSvg: barcodeSvg,
    used: used, clashes: clashes, nextFree: nextFree, blockUsage: blockUsage,
    fold: fold, authors: authors, list: list, gaps: gaps, okYmd: okYmd, num: num,
    coverPath: coverPath, coversInUse: coversInUse, fromPrefill: fromPrefill,
    shopDraft: shopDraft, stockPrefill: stockPrefill, newsBlocks: newsBlocks, pressRelease: pressRelease,
    STAGES: STAGES, STAGE_DAYS: STAGE_DAYS, MAX_PLAN: MAX_PLAN, addDays: addDays, makePlan: makePlan, sortPlan: sortPlan,
    planState: planState, byDay: byDay,
    ROY_BASES: ROY_BASES, MAX_ROY: MAX_ROY, cleanRoy: cleanRoy, cleanStmt: cleanStmt,
    SUB_ST: SUB_ST, TPL_KEYS: TPL_KEYS, cleanSub: cleanSub, subsLate: subsLate, fillTpl: fillTpl,
    RC_ST: RC_ST, RC_DAYS: RC_DAYS, MAX_RC: MAX_RC, cleanRc: cleanRc, rcDue: rcDue, quotes: quotes, pressList: pressList,
    POST_NETS: POST_NETS, POST_MAX: POST_MAX, POST_HOME: POST_HOME, cleanPost: cleanPost, postsDue: postsDue, postUrl: postUrl, postLen: postLen
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosPublishCore = API;
})(typeof window !== "undefined" ? window : globalThis);
